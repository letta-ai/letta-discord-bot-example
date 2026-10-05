import { log } from "./log.ts";

export interface HealthSource {
  discordReady(): boolean;
  routes(): number;
}

export function startHealthServer(port: number, src: HealthSource): { stop(): void } | null {
  if (!port) return null;
  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/healthz" || url.pathname === "/") {
        const ready = src.discordReady();
        return Response.json({ ok: ready, discord: ready ? "ready" : "connecting", routes: src.routes() }, { status: ready ? 200 : 503 });
      }
      return new Response("not found", { status: 404 });
    },
  });
  log.info("health server listening", { port: server.port });
  return { stop: () => server.stop(true) };
}
