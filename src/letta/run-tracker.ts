import type { SDKMessage } from "@letta-ai/letta-agent-sdk";

/**
 * What the bridge should do with one SDK message.
 * - pass: hand it to the normal mapping (render, or end the turn on a result).
 * - drop: stale or unattributable; do not render it.
 * - foreign: output from a run the agent started on its own (a task
 *   notification); not this turn's reply, but the agent's to say.
 * - hold: its run is not classified yet; `release()` returns it once the run
 *   turns out to be ours (its echo or loop_status names it).
 * - skip-result: a result for runs this turn did not start; keep reading.
 * - end: this turn's runs are finished but the SDK will not send their result.
 */
export type RunVerdict = "pass" | "drop" | "foreign" | "hold" | "skip-result" | "end";

/** Prefix of every otid the bot sends, so Discord turns are told apart from the agent's own inputs. */
export const OTID_PREFIX = "discord-";

/**
 * Tracks which runs a Discord turn started, so output from other runs in the
 * same conversation (task-notification turns, background subagents) is never
 * posted as this turn's reply.
 *
 * Observed on the runtime (2026-10-07 captures):
 * - Our message is echoed as a `user_message` stream event carrying our `otid`
 *   and the `run_id` it started. Other inputs (task notifications) are echoed
 *   with their own otid.
 * - Continuation runs (after a client tool) have no echo but appear in
 *   `loop_status.activeRunIds`. Background subagent runs stream into the same
 *   session but never appear there.
 * - A foreign run's `result` can consume the SDK's turn; our own run then
 *   finishes with no result, only `loop_status` back at WAITING_ON_INPUT.
 *
 * Until the runtime shows it reports runs (any echo with a run id, or any
 * `loop_status`), the tracker passes everything through, so runtimes without
 * them behave as before.
 */
export class RunTracker {
  readonly ours = new Set<string>();
  readonly foreign = new Set<string>();
  /** Runs that have produced output; an echo inside one is an injection, not its start. */
  private readonly active = new Set<string>();
  echoSeen = false;
  /** The runtime reports runs, so unclaimed output can be treated as foreign. */
  tracksRuns: boolean;
  private skippedResult = false;
  /** Output from runs not yet known to be ours or foreign, in arrival order. */
  private readonly held = new Map<string, SDKMessage[]>();
  /** Held output whose run turned out to be foreign, awaiting `releaseForeign()`. */
  private foreignOut: SDKMessage[] = [];

  constructor(
    readonly otid: string,
    sessionTracksRuns: boolean,
  ) {
    this.tracksRuns = sessionTracksRuns;
  }

  /** Runs already known to be the agent's own (seen before this turn began). */
  markForeign(runs: Iterable<string>) {
    for (const r of runs) {
      this.foreign.add(r);
      this.ours.delete(r);
    }
  }

  private get strict(): boolean {
    return this.tracksRuns;
  }

  see(msg: SDKMessage): RunVerdict {
    const m = msg as unknown as Record<string, unknown>;
    switch (msg.type) {
      case "stream_event": {
        const ev = (m.event ?? {}) as Record<string, unknown>;
        const run = typeof ev.run_id === "string" ? ev.run_id : undefined;
        // An echo without a run id is a queued copy; the run starts later.
        if (ev.message_type === "user_message" && run) {
          this.tracksRuns = true;
          if (ev.otid === this.otid) {
            this.echoSeen = true;
            this.claim(run);
          } else if (!(this.ours.has(run) && this.active.has(run))) {
            // Letta Code can inject a task notification into a run already in
            // progress; that run stays ours. Only a run the echo starts is foreign.
            this.foreign.add(run);
            this.ours.delete(run);
            const held = this.held.get(run);
            if (held) this.foreignOut.push(...held);
            this.held.delete(run);
          }
        }
        return "pass";
      }
      case "loop_status": {
        this.tracksRuns = true;
        const runs = Array.isArray(m.activeRunIds) ? (m.activeRunIds as string[]) : [];
        if (this.echoSeen) for (const r of runs) if (!this.foreign.has(r)) this.claim(r);
        // Our run ended after a foreign result took the SDK's turn: nothing
        // else will close this one.
        if (this.skippedResult && this.ours.size > 0 && m.status === "WAITING_ON_INPUT" && runs.length === 0) {
          return "end";
        }
        return "pass";
      }
      case "result": {
        if (!this.strict) return "pass";
        const runs = Array.isArray(m.runIds) ? (m.runIds as string[]) : [];
        // A result's runIds list every run that streamed during the SDK turn,
        // background subagents included, so it ends our turn but claims nothing.
        if (runs.some((r) => this.ours.has(r))) return "pass";
        if (this.echoSeen && runs.length === 0) return "pass";
        this.skippedResult = true;
        return "skip-result";
      }
      case "assistant":
      case "reasoning":
      case "tool_call":
      case "tool_result": {
        if (!this.strict) return "pass";
        const run = typeof m.runId === "string" ? m.runId : undefined;
        if (!run) return this.echoSeen ? "pass" : "drop";
        if (this.ours.has(run)) {
          this.active.add(run);
          return "pass";
        }
        if (this.foreign.has(run)) return "foreign";
        // Unclassified: the echo or status that names this run may still be on its way.
        const list = this.held.get(run) ?? [];
        list.push(msg);
        this.held.set(run, list);
        return "hold";
      }
      default:
        return "pass";
    }
  }

  /** Held output whose run has since been claimed, in arrival order. */
  release(): SDKMessage[] {
    const out: SDKMessage[] = [];
    for (const [run, list] of this.held) {
      if (!this.ours.has(run)) continue;
      out.push(...list);
      this.held.delete(run);
      this.active.add(run);
    }
    return out;
  }

  /** Held output whose run has since been echoed as the agent's own input. */
  releaseForeign(): SDKMessage[] {
    const out = this.foreignOut;
    this.foreignOut = [];
    return out;
  }

  /** Runs whose output was held and never claimed (background subagents). */
  unclaimed(): string[] {
    return [...this.held.keys()];
  }

  private claim(run: string) {
    this.ours.add(run);
    this.foreign.delete(run);
  }
}

/** What to do with one SDK message that arrived outside a Discord turn. */
export type BackgroundVerdict = "post" | "end" | "ignore";

/**
 * Picks out the agent's own runs between Discord turns: runs started by an
 * input that is not a Discord message (a task notification), and runs listed
 * in `loop_status`. Background subagent runs stream into the same session but
 * get neither, so their output is never posted; the agent reports on them
 * itself.
 */
export class BackgroundRuns {
  private readonly own = new Set<string>();
  private readonly discord = new Set<string>();

  /** Runs this classifier posts, so a Discord turn starting mid-run leaves them alone. */
  ownRuns(): Iterable<string> {
    return this.own;
  }

  see(msg: SDKMessage): BackgroundVerdict {
    const m = msg as unknown as Record<string, unknown>;
    switch (msg.type) {
      case "stream_event": {
        const ev = (m.event ?? {}) as Record<string, unknown>;
        const run = typeof ev.run_id === "string" ? ev.run_id : undefined;
        if (ev.message_type !== "user_message" || !run) return "ignore";
        if (typeof ev.otid === "string" && ev.otid.startsWith(OTID_PREFIX)) this.discord.add(run);
        else this.own.add(run);
        return "ignore";
      }
      case "loop_status": {
        const runs = Array.isArray(m.activeRunIds) ? (m.activeRunIds as string[]) : [];
        for (const r of runs) if (!this.discord.has(r)) this.own.add(r);
        return m.status === "WAITING_ON_INPUT" && runs.length === 0 ? "end" : "ignore";
      }
      case "result":
        return "end";
      case "assistant":
      case "reasoning":
      case "tool_call":
      case "tool_result": {
        const run = typeof m.runId === "string" ? m.runId : undefined;
        return run && this.own.has(run) ? "post" : "ignore";
      }
      default:
        return "ignore";
    }
  }
}
