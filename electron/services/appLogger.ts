export type AppLogLevel = "debug" | "info" | "warn" | "error";

export interface AppLogEntry {
  context?: string;
  level: AppLogLevel;
  message: string;
  timestamp: string;
}

export interface BackendLogOptions {
  context?: string;
  detail?: string;
  error?: unknown;
  publicMessage?: string;
  data?: Record<string, unknown>;
}

export interface AppLogger {
  debug: (message: string, options?: BackendLogOptions) => void;
  error: (message: string, options?: BackendLogOptions) => void;
  getEntries: () => AppLogEntry[];
  info: (message: string, options?: BackendLogOptions) => void;
  subscribe: (listener: (entry: AppLogEntry) => void) => () => void;
  warn: (message: string, options?: BackendLogOptions) => void;
}

interface AppLoggerOptions {
  maxEntries?: number;
  now?: () => Date;
  writeLine: (line: string) => Promise<void>;
}

const DEFAULT_MAX_ENTRIES = 500;

export function createAppLogger(options: AppLoggerOptions): AppLogger {
  const entries: AppLogEntry[] = [];
  const listeners = new Set<(entry: AppLogEntry) => void>();
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = options.now ?? (() => new Date());

  function log(level: AppLogLevel, message: string, logOptions: BackendLogOptions = {}): void {
    const timestamp = now().toISOString();
    const backendEntry = {
      context: logOptions.context,
      data: logOptions.data,
      detail: logOptions.detail,
      error: serializeError(logOptions.error),
      level,
      message,
      timestamp
    };

    writeBackendLine(options.writeLine, JSON.stringify(backendEntry));
    writeConsole(level, backendEntry);

    if (!logOptions.publicMessage) {
      return;
    }

    const publicEntry: AppLogEntry = {
      context: logOptions.context,
      level,
      message: logOptions.publicMessage,
      timestamp
    };
    entries.push(publicEntry);

    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries);
    }

    for (const listener of listeners) {
      listener(publicEntry);
    }
  }

  return {
    debug: (message, logOptions) => log("debug", message, logOptions),
    error: (message, logOptions) => log("error", message, logOptions),
    getEntries: () => [...entries],
    info: (message, logOptions) => log("info", message, logOptions),
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    warn: (message, logOptions) => log("warn", message, logOptions)
  };
}

function writeBackendLine(writeLine: (line: string) => Promise<void>, line: string): void {
  void writeLine(line).catch((error) => {
    console.error("[BatchImager] Failed to write log file", error);
  });
}

function writeConsole(level: AppLogLevel, entry: Record<string, unknown>): void {
  const args = ["[BatchImager]", entry];

  if (level === "error") {
    console.error(...args);
  } else if (level === "warn") {
    console.warn(...args);
  } else {
    console.info(...args);
  }
}

function serializeError(error: unknown): Record<string, unknown> | undefined {
  if (!error) {
    return undefined;
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack
    };
  }

  return { message: String(error) };
}
