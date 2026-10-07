type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold: Level =
  (process.env.LOG_LEVEL as Level) || (process.env.NODE_ENV === "test" ? "error" : "info");

export function setLogLevel(level: Level) {
  threshold = level;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (order[level] < order[threshold]) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => emit("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => emit("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => emit("error", m, f),
};
