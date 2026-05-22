import type { ProjectListEntry } from "../ipcTypes";
import { listProjectEntries, type ProjectIndexOptions } from "./projectIndex";
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
