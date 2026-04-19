type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function resolveLevel(): Level {
  const raw = (process.env.NEXT_PUBLIC_LOG_LEVEL ?? "").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

function log(level: Level, msg: string, meta?: unknown) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[resolveLevel()]) return;
  const payload = meta === undefined ? "" : meta;
  const line = `[${level}] ${msg}`;
  switch (level) {
    case "debug":
      // eslint-disable-next-line no-console
      console.debug(line, payload);
      break;
    case "info":
      // eslint-disable-next-line no-console
      console.info(line, payload);
      break;
    case "warn":
      console.warn(line, payload);
      break;
    case "error":
      console.error(line, payload);
      break;
  }
}

export const logger = {
  debug: (msg: string, meta?: unknown) => log("debug", msg, meta),
  info: (msg: string, meta?: unknown) => log("info", msg, meta),
  warn: (msg: string, meta?: unknown) => log("warn", msg, meta),
  error: (msg: string, meta?: unknown) => log("error", msg, meta),
};
