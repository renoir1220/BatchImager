import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  applyProjectSnapshotMutation,
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

    let nextSessionId = 1;
    const snapshot = await importImagesToProject(project.project.directory, [source, ignored, source], {
      makeSessionId: () => `sess_test_${nextSessionId++}`,
      makeNow: () => new Date("2026-05-21T15:01:00.000Z")
    });

    expect(snapshot.project.imageCount).toBe(1);
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]).toMatchObject({
      chatMessages: [],
      chatStatus: "idle",
      fileName: "warehouse shot.JPG",
      id: "sess_test_1",
      status: "idle"
    });
    expect(snapshot.sessions[0].filePath).toBe(path.join(project.project.directory, "images", "original", "sess_test_1-warehouse-shot.jpg"));
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
        filePath: path.join(project.project.directory, "images", "original", "sess_test_1-flower.png"),
        generationMode: "generate",
        generatedFilePath: path.join(project.project.directory, "images", "generated", "out.png"),
        generatedFilePaths: [path.join(project.project.directory, "images", "generated", "out.png")],
        id: "sess_test_1",
        lastPrompt: "白底商品图",
        showOriginalInList: false,
        status: "completed"
      }
    ];

    const saved = await saveProjectSnapshot(project.project.directory, {
      selectedSessionId: "sess_test_1",
      sessions
    });

    expect(saved.sessions).toEqual(sessions);
    expect(saved.selectedSessionId).toBe("sess_test_1");

    const reopened = await openProject(project.project.directory);
    expect(reopened.sessions).toEqual(sessions);
    expect(reopened.selectedSessionId).toBe("sess_test_1");
    expect(reopened.project.imageCount).toBe(1);
  });

  test("persists project manager state in project_state json", async () => {
    const root = await makeTempRoot();
    const project = await createProject({
      makeId: () => "project-1",
      makeNow: () => new Date("2026-05-21T15:00:00.000Z"),
      projectsDirectory: root
    });
    const projectManagerState = {
      conversation: {
        currentPlanId: "plan-1",
        id: "project-manager",
        messages: [{ content: "做一批白底主图", id: "pm-1", role: "user" as const }]
      },
      plans: [
        {
          commands: [
            {
              constraints: ["保留主体"],
              id: "cmd-1",
              instruction: "生成白底图",
              planId: "plan-1",
              source: "project-manager" as const,
              targetSessionId: "sess_test_1"
            }
          ],
          globalInstruction: "统一白底",
          id: "plan-1",
          status: "draft" as const,
          targetSessionIds: ["sess_test_1"],
          title: "白底主图"
        }
      ]
    };

    await saveProjectSnapshot(project.project.directory, {
      projectManagerState,
      selectedSessionId: null,
      sessions: []
    });

    await expect(openProject(project.project.directory)).resolves.toMatchObject({
      projectManagerState
    });
  });

  test("applies a project snapshot mutation transactionally", async () => {
    const root = await makeTempRoot();
    const project = await createProject({
      makeId: () => "project-1",
      makeNow: () => new Date("2026-05-21T15:00:00.000Z"),
      projectsDirectory: root
    });
    await saveProjectSnapshot(project.project.directory, {
      selectedSessionId: "sess_test_1",
      sessions: [
        {
          chatMessages: [],
          chatStatus: "idle",
          fileName: "flower.png",
          filePath: path.join(project.project.directory, "images", "original", "sess_test_1-flower.png"),
          id: "sess_test_1",
          status: "idle"
        }
      ]
    });

    const mutated = await applyProjectSnapshotMutation(
      project.project.directory,
      (snapshot) => ({
        projectManagerState: snapshot.projectManagerState,
        selectedSessionId: "sess_test_1",
        sessions: snapshot.sessions.map((session) =>
          session.id === "sess_test_1"
            ? {
                ...session,
                generatedFilePath: path.join(project.project.directory, "images", "generated", "out.png"),
                generatedFilePaths: [path.join(project.project.directory, "images", "generated", "out.png")],
                status: "completed"
              }
            : session
        )
      }),
      () => new Date("2026-05-21T15:10:00.000Z")
    );

    expect(mutated.sessions[0]).toMatchObject({
      generatedFilePath: path.join(project.project.directory, "images", "generated", "out.png"),
      generatedFilePaths: [path.join(project.project.directory, "images", "generated", "out.png")],
      status: "completed"
    });
    await expect(openProject(project.project.directory)).resolves.toMatchObject({
      sessions: mutated.sessions
    });
  });

  test("leaves the persisted snapshot unchanged when a project snapshot mutation throws", async () => {
    const root = await makeTempRoot();
    const project = await createProject({
      makeId: () => "project-1",
      makeNow: () => new Date("2026-05-21T15:00:00.000Z"),
      projectsDirectory: root
    });
    await saveProjectSnapshot(project.project.directory, {
      selectedSessionId: "sess_test_1",
      sessions: [
        {
          chatMessages: [],
          chatStatus: "idle",
          fileName: "flower.png",
          filePath: path.join(project.project.directory, "images", "original", "sess_test_1-flower.png"),
          id: "sess_test_1",
          status: "idle"
        }
      ]
    });
    const before = await openProject(project.project.directory);

    await expect(
      applyProjectSnapshotMutation(project.project.directory, () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    await expect(openProject(project.project.directory)).resolves.toEqual(before);
  });

  test("rolls back the whole project snapshot mutation when row writes fail", async () => {
    const root = await makeTempRoot();
    const project = await createProject({
      makeId: () => "project-1",
      makeNow: () => new Date("2026-05-21T15:00:00.000Z"),
      projectsDirectory: root
    });
    await saveProjectSnapshot(project.project.directory, {
      selectedSessionId: "sess_test_1",
      sessions: [
        {
          chatMessages: [],
          chatStatus: "idle",
          fileName: "flower.png",
          filePath: path.join(project.project.directory, "images", "original", "sess_test_1-flower.png"),
          id: "sess_test_1",
          status: "idle"
        }
      ]
    });
    const before = await openProject(project.project.directory);
    const duplicatedSession = {
      chatMessages: [],
      chatStatus: "idle" as const,
      fileName: "duplicate.png",
      filePath: path.join(project.project.directory, "images", "original", "duplicate.png"),
      id: "sess_duplicate",
      status: "idle" as const
    };

    await expect(
      applyProjectSnapshotMutation(project.project.directory, (snapshot) => ({
        projectManagerState: snapshot.projectManagerState,
        selectedSessionId: snapshot.selectedSessionId,
        sessions: [duplicatedSession, duplicatedSession]
      }))
    ).rejects.toThrow();

    await expect(openProject(project.project.directory)).resolves.toEqual(before);
  });

  test("migrates legacy img-number session ids when opening an old project", async () => {
    const root = await makeTempRoot();
    const project = await createProject({
      makeId: () => "project-1",
      makeNow: () => new Date("2026-05-21T15:00:00.000Z"),
      projectsDirectory: root
    });
    const projectManagerState = {
      conversation: {
        currentPlanId: "plan-1",
        id: "project-manager",
        messages: [{ content: "做一批白底主图", id: "pm-1", role: "user" as const }]
      },
      plans: [
        {
          commands: [
            {
              constraints: ["保留主体"],
              id: "cmd-1",
              instruction: "生成白底图",
              planId: "plan-1",
              source: "project-manager" as const,
              sourceSessionId: "img-1",
              targetSessionId: "img-1"
            }
          ],
          globalInstruction: "统一白底",
          id: "plan-1",
          reports: [
            {
              commandId: "cmd-1",
              status: "completed" as const,
              summary: "完成",
              targetSessionId: "img-1"
            }
          ],
          status: "draft" as const,
          targetSessionIds: ["img-1"],
          title: "白底主图"
        }
      ]
    };

    await saveProjectSnapshot(project.project.directory, {
      projectManagerState,
      selectedSessionId: "img-1",
      sessions: [
        {
          chatMessages: [],
          chatStatus: "idle",
          fileName: "flower.png",
          filePath: path.join(project.project.directory, "images", "original", "img-1-flower.png"),
          id: "img-1",
          status: "idle"
        }
      ]
    });

    const reopened = await openProject(project.project.directory);
    const migratedId = reopened.sessions[0]?.id;

    expect(migratedId).toMatch(/^sess_/);
    expect(migratedId).not.toBe("img-1");
    expect(reopened.selectedSessionId).toBe(migratedId);
    expect(reopened.projectManagerState?.plans[0]?.targetSessionIds).toEqual([migratedId]);
    expect(reopened.projectManagerState?.plans[0]?.commands[0]).toMatchObject({
      sourceSessionId: migratedId,
      targetSessionId: migratedId
    });
    expect(reopened.projectManagerState?.plans[0]?.reports?.[0]?.targetSessionId).toBe(migratedId);
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
      selectedSessionId: "sess_test_1",
      sessions: [
        {
          chatMessages: [{ content: "生成白底图", id: "m-1", role: "user" }],
          chatStatus: "idle",
          fileName: "flower.png",
          filePath: path.join(project.project.directory, "images", "original", "sess_test_1-flower.png"),
          generatedFilePath: path.join(project.project.directory, "images", "generated", "out.png"),
          generatedFilePaths: [path.join(project.project.directory, "images", "generated", "out.png")],
          id: "sess_test_1",
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
