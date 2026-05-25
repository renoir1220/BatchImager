import { rm } from "node:fs/promises";
import path from "node:path";
import type { ProjectListEntry } from "../ipcTypes";
import { listProjectEntries, removeProjectDirectoryFromIndex, type ProjectIndexOptions } from "./projectIndex";
import { readProjectSummary } from "./projectStore";
import { readExistingProjectThumbnailPaths } from "./projectThumbnails";

export async function listProjectCards(options: ProjectIndexOptions): Promise<ProjectListEntry[]> {
  const entries = await listProjectEntries(options);

  return Promise.all(
    entries.map(async (entry): Promise<ProjectListEntry> => ({
      ...entry,
      thumbnailPaths: entry.summary
        ? await readExistingProjectThumbnailPaths(entry.directory, entry.summary.previewSourcePaths)
        : []
    }))
  );
}

export async function deleteProject(options: ProjectIndexOptions & { projectDirectory: string }): Promise<ProjectListEntry[]> {
  const projectDirectory = path.resolve(options.projectDirectory);
  const canDeleteDirectory = isDirectDefaultProject(projectDirectory, options.projectsDirectory) || (await canReadProjectSummary(projectDirectory));

  if (canDeleteDirectory) {
    await rm(projectDirectory, { force: true, recursive: true });
  }

  await removeProjectDirectoryFromIndex({
    indexFilePath: options.indexFilePath,
    projectDirectory
  });

  return listProjectCards(options);
}

async function canReadProjectSummary(projectDirectory: string): Promise<boolean> {
  try {
    await readProjectSummary(projectDirectory);
    return true;
  } catch {
    return false;
  }
}

function isDirectDefaultProject(projectDirectory: string, projectsDirectory: string): boolean {
  const relativePath = path.relative(path.resolve(projectsDirectory), projectDirectory);

  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath) && !relativePath.includes(path.sep);
}
