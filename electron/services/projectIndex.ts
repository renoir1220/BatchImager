import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectSummary } from "../ipcTypes";
import { readProjectSummary } from "./projectStore";

interface ProjectIndexFile {
  projectDirectories: string[];
}

export interface ProjectIndexOptions {
  indexFilePath: string;
  projectsDirectory: string;
}

export interface RememberProjectDirectoryOptions {
  indexFilePath: string;
  projectDirectory: string;
}

export interface ProjectListEntry {
  directory: string;
  isExternal: boolean;
  isUnavailable: boolean;
  summary?: ProjectSummary;
}

export async function rememberProjectDirectory(options: RememberProjectDirectoryOptions): Promise<void> {
  const index = await readProjectIndex(options.indexFilePath);
  const projectDirectory = path.resolve(options.projectDirectory);
  const normalizedProjectDirectory = normalizeProjectPath(projectDirectory);

  if (!index.projectDirectories.some((directory) => normalizeProjectPath(directory) === normalizedProjectDirectory)) {
    index.projectDirectories.push(projectDirectory);
    await writeProjectIndex(options.indexFilePath, index);
  }
}

export async function listProjectEntries(options: ProjectIndexOptions): Promise<ProjectListEntry[]> {
  await mkdir(options.projectsDirectory, { recursive: true });

  const defaultProjectDirectories = await listDefaultProjectDirectories(options.projectsDirectory);
  const rememberedProjectDirectories = (await readProjectIndex(options.indexFilePath)).projectDirectories.map((directory) =>
    path.resolve(directory)
  );
  const directories = dedupeProjectDirectories([...defaultProjectDirectories, ...rememberedProjectDirectories]);
  const defaultRoots = new Set(defaultProjectDirectories.map(normalizeProjectPath));
  const entries = await Promise.all(
    directories.map(async (directory): Promise<ProjectListEntry> => {
      try {
        const summary = await readProjectSummary(directory);
        return {
          directory,
          isExternal: !defaultRoots.has(normalizeProjectPath(directory)),
          isUnavailable: false,
          summary
        };
      } catch {
        return {
          directory,
          isExternal: true,
          isUnavailable: true
        };
      }
    })
  );

  return entries.sort(compareProjectEntries);
}

async function listDefaultProjectDirectories(projectsDirectory: string): Promise<string[]> {
  try {
    const entries = await readdir(projectsDirectory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(projectsDirectory, entry.name));
  } catch {
    return [];
  }
}

async function readProjectIndex(indexFilePath: string): Promise<ProjectIndexFile> {
  try {
    const parsed = JSON.parse(await readFile(indexFilePath, "utf8")) as Partial<ProjectIndexFile>;
    return {
      projectDirectories: Array.isArray(parsed.projectDirectories)
        ? parsed.projectDirectories.filter((directory): directory is string => typeof directory === "string")
        : []
    };
  } catch {
    return { projectDirectories: [] };
  }
}

async function writeProjectIndex(indexFilePath: string, index: ProjectIndexFile): Promise<void> {
  await mkdir(path.dirname(indexFilePath), { recursive: true });
  await writeFile(indexFilePath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

function dedupeProjectDirectories(projectDirectories: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const directory of projectDirectories) {
    const resolvedDirectory = path.resolve(directory);
    const normalizedDirectory = normalizeProjectPath(resolvedDirectory);
    if (!seen.has(normalizedDirectory)) {
      seen.add(normalizedDirectory);
      result.push(resolvedDirectory);
    }
  }

  return result;
}

function compareProjectEntries(left: ProjectListEntry, right: ProjectListEntry): number {
  if (left.isUnavailable !== right.isUnavailable) {
    return left.isUnavailable ? 1 : -1;
  }

  return getSortableDate(right) - getSortableDate(left);
}

function getSortableDate(entry: ProjectListEntry): number {
  return entry.summary ? new Date(entry.summary.updatedAt).getTime() : 0;
}

function normalizeProjectPath(projectDirectory: string): string {
  return path.resolve(projectDirectory).toLowerCase();
}
