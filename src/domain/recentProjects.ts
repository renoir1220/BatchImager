import type { ProjectListEntry } from "../../electron/ipcTypes";

export function selectRecentProjects(
  projects: ProjectListEntry[],
  limit?: number
): ProjectListEntry[] {
  const availableProjects = projects.filter((project) => !project.isUnavailable);
  return typeof limit === "number" ? availableProjects.slice(0, limit) : availableProjects;
}
