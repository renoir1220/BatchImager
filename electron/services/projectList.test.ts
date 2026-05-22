import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createProject, saveProjectSnapshot } from "./projectStore";
import { getProjectThumbnailPath } from "./projectThumbnails";
import { listProjectCards } from "./projectList";

const tempRoots: string[] = [];

describe("projectList", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { force: true, recursive: true })));
    tempRoots.length = 0;
  });

  test("returns project summaries with existing cached thumbnail paths", async () => {
    const root = await makeTempRoot();
    const projectsDirectory = path.join(root, "projects");
    const indexFilePath = path.join(root, "project-index.json");
    const project = await createProject({
      makeId: () => "project-1",
      makeNow: () => new Date("2026-05-21T15:00:00.000Z"),
      projectsDirectory
    });
    const generatedPath = path.join(project.project.directory, "images", "generated", "out.png");
    await saveProjectSnapshot(project.project.directory, {
      sessions: [
        {
          chatMessages: [],
          chatStatus: "idle",
          fileName: "flower.png",
          filePath: path.join(project.project.directory, "images", "original", "img-1-flower.png"),
          generatedFilePath: generatedPath,
          generatedFilePaths: [generatedPath],
          id: "img-1",
          status: "completed"
        }
      ]
    });
    const cachedThumbnailPath = getProjectThumbnailPath(project.project.directory, generatedPath);
    await mkdir(path.dirname(cachedThumbnailPath), { recursive: true });
    await writeFile(cachedThumbnailPath, "cached");

    const cards = await listProjectCards({ indexFilePath, projectsDirectory });

    expect(cards).toEqual([
      {
        directory: project.project.directory,
        isExternal: false,
        isUnavailable: false,
        thumbnailPaths: [cachedThumbnailPath],
        summary: {
          createdAt: "2026-05-21T15:00:00.000Z",
          directory: project.project.directory,
          id: "project-1",
          imageCount: 1,
          name: "项目 05-21 15:00",
          previewSourcePaths: [generatedPath],
          updatedAt: expect.any(String)
        }
      }
    ]);
  });

  test("returns unavailable remembered projects without thumbnail paths", async () => {
    const root = await makeTempRoot();
    const projectsDirectory = path.join(root, "projects");
    const indexFilePath = path.join(root, "project-index.json");
    const missingProjectDirectory = path.join(root, "missing");
    await mkdir(path.dirname(indexFilePath), { recursive: true });
    await writeFile(indexFilePath, JSON.stringify({ projectDirectories: [missingProjectDirectory] }), "utf8");

    const cards = await listProjectCards({ indexFilePath, projectsDirectory });

    expect(cards).toEqual([
      {
        directory: missingProjectDirectory,
        isExternal: true,
        isUnavailable: true,
        thumbnailPaths: []
      }
    ]);
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "batchimager-list-"));
  tempRoots.push(root);
  return root;
}
