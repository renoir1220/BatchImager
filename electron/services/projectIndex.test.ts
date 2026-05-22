import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createProject } from "./projectStore";
import { listProjectEntries, rememberProjectDirectory } from "./projectIndex";

const tempRoots: string[] = [];

describe("projectIndex", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { force: true, recursive: true })));
    tempRoots.length = 0;
  });

  test("lists default projects newest first", async () => {
    const root = await makeTempRoot();
    const projectsDirectory = path.join(root, "projects");
    const indexFilePath = path.join(root, "project-index.json");
    const older = await createProject({
      makeId: () => "older",
      makeNow: () => new Date("2026-05-21T10:00:00.000Z"),
      projectsDirectory
    });
    const newer = await createProject({
      makeId: () => "newer",
      makeNow: () => new Date("2026-05-21T11:00:00.000Z"),
      projectsDirectory
    });

    const entries = await listProjectEntries({ indexFilePath, projectsDirectory });

    expect(entries.map((entry) => entry.directory)).toEqual([newer.project.directory, older.project.directory]);
    expect(entries[0]).toMatchObject({
      isExternal: false,
      isUnavailable: false,
      summary: {
        id: "newer",
        imageCount: 0,
        name: "项目 05-21 11:00"
      }
    });
    expect(entries[1].summary?.name).toBe("项目 05-21 10:00");
  });

  test("remembers external projects and de-dupes normalized paths", async () => {
    const root = await makeTempRoot();
    const projectsDirectory = path.join(root, "projects");
    const indexFilePath = path.join(root, "project-index.json");
    const externalRoot = path.join(root, "external");
    const external = await createProject({
      makeId: () => "external-project",
      makeNow: () => new Date("2026-05-21T12:00:00.000Z"),
      projectsDirectory: externalRoot
    });

    await rememberProjectDirectory({ indexFilePath, projectDirectory: external.project.directory });
    await rememberProjectDirectory({ indexFilePath, projectDirectory: external.project.directory.toUpperCase() });

    const entries = await listProjectEntries({ indexFilePath, projectsDirectory });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      directory: external.project.directory,
      isExternal: true,
      isUnavailable: false,
      summary: {
        id: "external-project"
      }
    });
  });

  test("keeps missing remembered projects visible as unavailable", async () => {
    const root = await makeTempRoot();
    const projectsDirectory = path.join(root, "projects");
    const indexFilePath = path.join(root, "project-index.json");
    const missingProjectDirectory = path.join(root, "missing-project");

    await mkdir(projectsDirectory, { recursive: true });
    await rememberProjectDirectory({ indexFilePath, projectDirectory: missingProjectDirectory });

    const entries = await listProjectEntries({ indexFilePath, projectsDirectory });

    expect(entries).toEqual([
      {
        directory: missingProjectDirectory,
        isExternal: true,
        isUnavailable: true
      }
    ]);
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "batchimager-index-"));
  tempRoots.push(root);
  return root;
}
