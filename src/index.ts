import { loadConfig } from "./config.ts";
import { createDiscordClient, startDiscord } from "./discord/gateway.ts";
import { createDiscordToolFactory } from "./discord/tools.ts";
import { startHealthServer } from "./health.ts";
import { createAgentBridge } from "./letta/bridge.ts";
import { RouteStore } from "./letta/store.ts";
import { log, setLogLevel } from "./log.ts";

async function main() {
  const config = loadConfig();
  setLogLevel(config.LOG_LEVEL);

  if (config.APPROVAL_MODE === "admins" && config.DISCORD_ADMIN_USER_IDS.length === 0 && config.DISCORD_ADMIN_ROLE_IDS.length === 0) {
    log.warn("APPROVAL_MODE=admins but no admins are configured; tool approvals will time out", {
      hint: "set DISCORD_ADMIN_USER_IDS or DISCORD_ADMIN_ROLE_IDS",
    });
  }

  const store = new RouteStore(config.DATA_DIR);
  const client = createDiscordClient();
  const bridge = createAgentBridge(config, {
    store,
    toolFactory: createDiscordToolFactory({ client: client as never, config }),
  });

  const discord = await startDiscord(config, bridge, store, client);
  const health = startHealthServer(config.HEALTH_PORT, {
    discordReady: () => discord.ready(),
    routes: () => store.count(),
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down", { signal });
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref?.();
    await discord.stop().catch((e) => log.warn("discord stop failed", { err: String(e) }));
    await bridge.shutdown().catch((e) => log.warn("bridge shutdown failed", { err: String(e) }));
    health?.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("fatal", { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
