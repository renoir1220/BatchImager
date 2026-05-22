import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createProject,
  importImagesToProject,
  openProject,
  readProjectSummary,
  renameProject,
  saveProjectSnapshot
} from "./projectStore";
import type { PersistedImageSession } from "../ipcTypes";

const tempRoots: string[] = [];

describe("projectStore", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { force: true, recursive: true })));
    tempRoots.length = 0;
  });

  test("creates an anonymous project with a sqlite database and image directories", async () => {
    const root = await makeTempRoot();

    const snapshot = await createProject({
      makeId: () => "project-1",
      makeNow: () => new Date("2026-05-21T15:00:00.000Z"),
      projectsDirectory: root
    });

    expect(snapshot.project).toEqual({
      createdAt: "2026-05-21T15:00:00.000Z",
      directory: path.join(root, "project-1"),
      id: "project-1",
      imageCount: 0,
      name: "项目 05-21 15:00",
      updatedAt: "2026-05-21T15:00:00.000Z"
    });
    expect(snapshot.sessions).toEqual([]);
    await expect(stat(path.join(root, "project-1", "project.sqlite"))).resolves.toMatchObject({ isFile: expect.any(Function) });
    await expect(stat(path.join(root, "project-1", "images", "original"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(path.join(root, "project-1", "images", "generated"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(stat(path.join(root, "project-1", "references"))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  test("imports supported images by copying files into the project and skipping duplicate source paths", async () => {
    const root = await makeTempRoot();
    const source = path.join(root, "warehouse shot.JPG");
    const ignored = path.join(root, "notes.txt");
    await writeFile(source, new Uint8Array([1, 2, 3]));
    await writeFile(ignored, "not an image");

    const project = await createProject({
      makeId: () => "project-1",
      makeNow: () => new Date("2026-05-21T15:00:00.000Z"),
      projectsDirectory: root
    });

    const snapshot = await importImagesToProject(project.project.directory, [source, ignored, source], {
      makeNow: () => new Date("2026-05-21T15:01:00.000Z")
    });

    expect(snapshot.project.imageCount).toBe(1);
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]).toMatchObject({
      chatMessages: [],
      chatStatus: "idle",
      fileName: "warehouse shot.JPG",
      id: "img-1",
      status: "idle"
    });
    expect(snapshot.sessions[0].filePath).toBe(path.join(project.project.directory, "images", "original", "img-1-warehouse-shot.jpg"));
    await expect(readFile(snapshot.sessions[0].filePath)).resolves.toEqual(Buffer.from([1, 2, 3]));

    const reopened = await openProject(project.project.directory);
    expect(reopened.sessions).toEqual(snapshot.sessions);
  });

  test("persists image session state and chat history in sqlite", async () => {
    const root = await makeTempRoot();
    const project = await createProject({
      makeId: () => "project-1",
      makeNow: () => new Date("2026-05-21T15:00:00.000Z"),
      projectsDirectory: root
    });
    const sessions: PersistedImageSession[] = [
      {
        chatMessages: [
          { content: "生成白底图", id: "m-1", role: "user" },
          {
            content: "生成完成，已加入会话上下文。",
            contextType: "generated-image",
            generatedFilePath: path.join(project.project.directory, "images", "generated", "out.png"),
            id: "m-2",
            role: "context"
          }
        ],
        chatStatus: "idle",
        fileName: "flower.png",
        filePath: path.join(project.project.directory, "images", "original", "img-1-flower.png"),
        generatedFilePath: path.join(project.project.directory, "images", "generated", "out.png"),
        generatedFilePaths: [path.join(project.project.directory, "images", "generated", "out.png")],
        id: "img-1",
        lastPrompt: "白底商品图",
        showOriginalInList: false,
        status: "completed"
      }
    ];

    const saved = await saveProjectSnapshot(project.project.directory, {
      selectedSessionId: "img-1",
      sessions
    });

    expect(saved.sessions).toEqual(sessions);
    expect(saved.selectedSessionId).toBe("img-1");

    const reopened = await openProject(project.project.directory);
    expect(reopened.sessions).toEqual(sessions);
    expect(reopened.selectedSessionId).toBe("img-1");
    expect(reopened.project.imageCount).toBe(1);
  });

  test("renames a project and keeps the name inside the project database", async () => {
    const root = await makeTempRoot();
    const project = await createProject({
      makeId: () => "project-1",
      makeNow: () => new Date("2026-05-21T15:00:00.000Z"),
      projectsDirectory: root
    });

    const renamed = await renameProject(project.project.directory, "花材白底图");

    expect(renamed.project.name).toBe("花材白底图");
    await expect(openProject(project.project.directory)).resolves.toMatchObject({
      project: {
        name: "花材白底图"
      }
    });
  });

  test("reads a lightweight project summary without loading chat messages", async () => {
    const root = await makeTempRoot();
    const project = await createProject({
      makeId: () => "project-1",
      makeNow: () => new Date("2026-05-21T15:00:00.000Z"),
      projectsDirectory: root
    });
    await saveProjectSnapshot(project.project.directory, {
      selectedSessionId: "img-1",
      sessions: [
        {
          chatMessages: [{ content: "生成白底图", id: "m-1", role: "user" }],
          chatStatus: "idle",
          fileName: "flower.png",
          filePath: path.join(project.project.directory, "images", "original", "img-1-flower.png"),
          generatedFilePath: path.join(project.project.directory, "images", "generated", "out.png"),
          generatedFilePaths: [path.join(project.project.directory, "images", "generated", "out.png")],
          id: "img-1",
          status: "completed"
        }
      ]
    });

    const summary = await readProjectSummary(project.project.directory);

    expect(summary).toEqual({
      createdAt: "2026-05-21T15:00:00.000Z",
      directory: project.project.directory,
      id: "project-1",
      imageCount: 1,
      name: "项目 05-21 15:00",
      previewSourcePaths: [path.join(project.project.directory, "images", "generated", "out.png")],
      updatedAt: expect.any(String)
    });
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "batchimager-projects-"));
  tempRoots.push(root);
  return root;
}
