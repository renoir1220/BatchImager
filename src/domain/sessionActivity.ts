import type { AppLogEntry } from "../../electron/ipcTypes";

const DEFAULT_ACTIVITY_LIMIT = 8;

export function getSessionActivityLogs(
  logs: AppLogEntry[],
  sessionId: string | null,
  limit = DEFAULT_ACTIVITY_LIMIT
): AppLogEntry[] {
  if (!sessionId) {
    return [];
  }

  const contexts = new Set([`chat:${sessionId}`, `image:${sessionId}`]);

  return logs.filter((entry) => entry.context && contexts.has(entry.context)).slice(-limit);
}
