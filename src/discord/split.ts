export const DISCORD_MAX = 2000;
export const DEFAULT_SPLIT = 1990;

/**
 * Split text into Discord-sized chunks. Prefers paragraph, then line, then
 * word boundaries, and keeps ``` code fences balanced across chunks by closing
 * the fence at the end of a chunk and reopening it (with its language) at the
 * start of the next.
 */
export function splitForDiscord(text: string, max = DEFAULT_SPLIT): string[] {
  const out: string[] = [];
  let rest = text.replace(/\r\n/g, "\n");
  let openFence: string | null = null; // e.g. "```ts"

  while (rest.length > 0) {
    const prefix = openFence ? `${openFence}\n` : "";
    const budget = max - prefix.length - 4; // room for closing "\n```"
    if (prefix.length + rest.length <= max) {
      out.push(prefix + rest);
      break;
    }
    let cut = findCut(rest, budget);
    let chunk = rest.slice(0, cut);
    rest = rest.slice(cut).replace(/^\n/, "");

    const fenceAtEnd = trackFence(openFence, chunk);
    let body = prefix + chunk;
    if (fenceAtEnd) body = body.replace(/\n?$/, "\n```");
    out.push(body);
    openFence = fenceAtEnd;
  }
  return out.filter((c) => c.trim().length > 0);
}

function findCut(s: string, budget: number): number {
  if (s.length <= budget) return s.length;
  const window = s.slice(0, budget);
  for (const sep of ["\n\n", "\n", " "]) {
    const i = window.lastIndexOf(sep);
    if (i > budget * 0.5) return i + (sep === " " ? 1 : 0);
  }
  return budget;
}

/** Returns the fence opener still open after this chunk, or null. */
function trackFence(open: string | null, chunk: string): string | null {
  let current = open;
  for (const line of chunk.split("\n")) {
    const m = line.match(/^\s*(```+)(\S*)/);
    if (!m) continue;
    current = current ? null : `${m[1]}${m[2] ?? ""}`;
  }
  return current;
}
