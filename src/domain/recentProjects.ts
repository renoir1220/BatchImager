import type { ProjectListEntry } from "../../electron/ipcTypes";

const DEFAULT_RECENT_PROJECT_LIMIT = 5;

export function selectRecentProjects(
  projects: ProjectListEntry[],
  limit: number = DEFAULT_RECENT_PROJECT_LIMIT
): ProjectListEntry[] {
  return projects.filter((project) => !project.isUnavailable).slice(0, limit);
}
