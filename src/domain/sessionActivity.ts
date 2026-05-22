import type { AppLogEntry } from "../../electron/ipcTypes";

const DEFAULT_ACTIVITY_LIMIT = 8;
const PROJECT_MANAGER_CONTEXTS = new Set(["esse-agent", "project-manager"]);

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

export function getProjectManagerActivityLogs(logs: AppLogEntry[], limit = DEFAULT_ACTIVITY_LIMIT): AppLogEntry[] {
  return logs.filter((entry) => entry.context && PROJECT_MANAGER_CONTEXTS.has(entry.context)).slice(-limit);
}
