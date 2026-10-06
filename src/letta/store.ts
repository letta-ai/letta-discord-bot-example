import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface RouteRecord {
  routeKey: string;
  conversationId: string;
  createdAt: string;
  lastActiveAt: string;
}

/** Routing index only. Letta owns the transcript; this maps Discord surfaces to conversations. */
export class RouteStore {
  private db: Database;

  constructor(dataDir: string | ":memory:") {
    if (dataDir === ":memory:") {
      this.db = new Database(":memory:");
    } else {
      mkdirSync(dataDir, { recursive: true });
      this.db = new Database(join(dataDir, "routes.sqlite"), { create: true });
    }
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS routes (
      route_key TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL
    )`);
    // Routes pinned by the routing table. Their conversation comes from the
    // table, so only activity is recorded (it lets follow-ups skip the mention).
    this.db.exec(`CREATE TABLE IF NOT EXISTS pinned_routes (
      route_key TEXT PRIMARY KEY,
      last_active_at TEXT NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS bot_threads (
      thread_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    )`);
  }

  get(routeKey: string): RouteRecord | null {
    const row = this.db
      .query<{ route_key: string; conversation_id: string; created_at: string; last_active_at: string }, [string]>(
        "SELECT * FROM routes WHERE route_key = ?",
      )
      .get(routeKey);
    return row
      ? {
          routeKey: row.route_key,
          conversationId: row.conversation_id,
          createdAt: row.created_at,
          lastActiveAt: row.last_active_at,
        }
      : null;
  }

  set(routeKey: string, conversationId: string): RouteRecord {
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO routes (route_key, conversation_id, created_at, last_active_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(route_key) DO UPDATE SET conversation_id = ?2, created_at = ?3, last_active_at = ?3`,
      )
      .run(routeKey, conversationId, now);
    return { routeKey, conversationId, createdAt: now, lastActiveAt: now };
  }

  touch(routeKey: string): void {
    this.db.query("UPDATE routes SET last_active_at = ? WHERE route_key = ?").run(new Date().toISOString(), routeKey);
  }

  delete(routeKey: string): void {
    this.db.query("DELETE FROM routes WHERE route_key = ?").run(routeKey);
  }

  count(): number {
    return this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM routes").get()?.n ?? 0;
  }

  touchPinned(routeKey: string): void {
    this.db
      .query(
        `INSERT INTO pinned_routes (route_key, last_active_at) VALUES (?1, ?2)
         ON CONFLICT(route_key) DO UPDATE SET last_active_at = ?2`,
      )
      .run(routeKey, new Date().toISOString());
  }

  pinnedLastActive(routeKey: string): string | undefined {
    return this.db
      .query<{ last_active_at: string }, [string]>("SELECT last_active_at FROM pinned_routes WHERE route_key = ?")
      .get(routeKey)?.last_active_at;
  }

  /** Threads the bot created or adopted; follow-ups there need no mention. */
  markBotThread(threadId: string): void {
    this.db
      .query("INSERT OR IGNORE INTO bot_threads (thread_id, created_at) VALUES (?, ?)")
      .run(threadId, new Date().toISOString());
  }

  isBotThread(threadId: string): boolean {
    return !!this.db.query("SELECT 1 FROM bot_threads WHERE thread_id = ?").get(threadId);
  }

  close(): void {
    this.db.close();
  }
}
