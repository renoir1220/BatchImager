import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { ProjectSnapshot } from "../ipcTypes";
import type { ProductImageResult } from "./tuziImageApi";
import { EsseBatchTaskRegistry } from "./esseBatchTaskRegistry";
import { createEsseImagePreflightExecutor } from "./esseImagePreflightExecutor";
import { ProjectMutationSink } from "./projectMutationSink";
import { createProjectSnapshotWorkspaceRuntime } from "./esseWorkspaceRuntime";
import type { UnifiedImageGenerationRequest } from "./imageGenerationService";

describe("esseImagePreflightExecutor", () => {
  test("executes confirmed existing-image generation and writes the generated result through the mutation sink", async () => {
    let snapshot = createSnapshot();
    const generation = createDeferred<ProductImageResult>();
    const generatedRequests: UnifiedImageGenerationRequest[] = [];
    const runtime = createRuntime(snapshot, (nextSnapshot) => {
      snapshot = nextSnapshot;
    });
    const executor = createEsseImagePreflightExecutor({
      generateImage: async (request) => {
        generatedRequests.push(request);
        return await generation.promise;
      },
      projectDirectory: "/project"
    });

    const result = await executor(
      {
        commands: [
          {
            displayLabel: "img-1",
            mode: "edit",
            prompt: "保留主体，换成白底主图",
            target: { sessionId: "sess_1", type: "existing" }
          }
        ],
        tool: "generate_image"
      },
      runtime
    );

    expect(result).toEqual({ affectedSessionIds: ["sess_1"], ok: true, summary: "已提交 1 个生成任务。完成后会自动出现在工作区。" });
    await waitUntil(() => generatedRequests.length === 1 && snapshot.sessions[0].status === "generating");
    expect(generatedRequests).toEqual([
      {
        imagePath: "/project/original/a.jpg",
        mode: "edit",
        prompt: "保留主体，换成白底主图",
        signal: generatedRequests[0].signal,
        sessionId: "sess_1"
      }
    ]);
    expect(snapshot.sessions[0].generatedFilePath).toBeUndefined();

    generation.resolve({ outputPath: "/project/images/generated/out-1.png", requestSize: "auto" });
    await waitUntil(() => snapshot.sessions[0].status === "completed");
    expect(snapshot.sessions[0].generatedFilePath).toBe("/project/images/generated/out-1.png");
    expect(snapshot.sessions[0].generatedFilePaths).toEqual(["/project/images/generated/out-1.png"]);
    expect(snapshot.sessions[0].chatMessages.at(-1)).toMatchObject({
      contextType: "generated-image",
      generatedFilePath: "/project/images/generated/out-1.png",
      role: "context"
    });
  });

  test("creates a new session only after preflight execution and then writes the generated result", async () => {
    const projectDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-preflight-exec-"));
    let snapshot = createSnapshot({ project: { ...createSnapshot().project, directory: projectDirectory } });
    const generation = createDeferred<ProductImageResult>();
    const generatedRequests: UnifiedImageGenerationRequest[] = [];
    const runtime = createRuntime(snapshot, (nextSnapshot) => {
      snapshot = nextSnapshot;
    });
    const executor = createEsseImagePreflightExecutor({
      createSeed: async ({ sessionId }) => {
        const seedPath = path.join(projectDirectory, "images", "generated", "seeds", `${sessionId}.png`);
        await mkdir(path.dirname(seedPath), { recursive: true });
        await writeFile(seedPath, "seed");
        return seedPath;
      },
      generateImage: async (request) => {
        generatedRequests.push(request);
        return await generation.promise;
      },
      makeSessionId: () => "sess_new",
      projectDirectory
    });

    const result = await executor(
      {
        commands: [
          {
            mode: "generate",
            prompt: "新增一张场景图",
            size: "2048x1152",
            target: { fileName: "scene.png", type: "new" }
          }
        ],
        tool: "generate_image"
      },
      runtime
    );

    expect(result).toEqual({ affectedSessionIds: ["sess_new"], ok: true, summary: "已提交 1 个生成任务。完成后会自动出现在工作区。" });
    await waitUntil(() => generatedRequests.length === 1 && snapshot.sessions[1]?.status === "generating");
    expect(generatedRequests).toEqual([
      {
        imagePath: path.join(projectDirectory, "images", "generated", "seeds", "sess_new.png"),
        mode: "generate",
        prompt: "新增一张场景图",
        signal: generatedRequests[0].signal,
        sessionId: "sess_new",
        size: "2048x1152"
      }
    ]);
    expect(snapshot.sessions.map((session) => session.id)).toEqual(["sess_1", "sess_new"]);
    expect(snapshot.selectedSessionId).toBe("sess_new");
    const generatedPath = path.join(projectDirectory, "images", "generated", "new-output.png");
    expect(snapshot.sessions[1]).toMatchObject({
      fileName: "scene.png",
      filePath: path.join(projectDirectory, "images", "generated", "seeds", "sess_new.png"),
      originatedFromGeneration: true,
      status: "generating"
    });

    generation.resolve({ outputPath: generatedPath, requestSize: "2048x1152" });
    await waitUntil(() => snapshot.sessions[1]?.status === "completed");
    expect(snapshot.sessions[1]).toMatchObject({
      fileName: "scene.png",
      filePath: generatedPath,
      generatedFilePath: generatedPath,
      generatedFilePaths: [generatedPath],
      originatedFromGeneration: true,
      status: "completed"
    });
    await expect(access(path.join(projectDirectory, "images", "generated", "seeds", "sess_new.png"))).rejects.toThrow();
  });

  test("registers batch item controllers and cleans them as each item finishes", async () => {
    let snapshot = createSnapshot({
      sessions: [
        ...createSnapshot().sessions,
        {
          chatMessages: [],
          chatStatus: "idle",
          fileName: "b.jpg",
          filePath: "/project/original/b.jpg",
          id: "sess_2",
          status: "idle"
        }
      ]
    });
    const registry = new EsseBatchTaskRegistry();
    const generations = new Map<string, Deferred<ProductImageResult>>();
    const registrySnapshots: unknown[] = [];
    const generatedRequests: UnifiedImageGenerationRequest[] = [];
    const runtime = createRuntime(snapshot, (nextSnapshot) => {
      snapshot = nextSnapshot;
    });
    const executor = createEsseImagePreflightExecutor({
      batchTaskRegistry: registry,
      generateImage: async (request) => {
        const generation = createDeferred<ProductImageResult>();
        generations.set(request.sessionId, generation);
        registrySnapshots.push(registry.getSnapshot("batch_1"));
        generatedRequests.push(request);
        return await generation.promise;
      },
      makeBatchTaskId: () => "batch_1",
      projectDirectory: "/project"
    });

    const result = await executor(
      {
        commands: [
          {
            mode: "edit",
            prompt: "第一张换白底",
            target: { sessionId: "sess_1", type: "existing" }
          },
          {
            mode: "edit",
            prompt: "第二张换白底",
            target: { sessionId: "sess_2", type: "existing" }
          }
        ],
        tool: "run_batch_generation"
      },
      runtime
    );

    expect(result).toEqual({ affectedSessionIds: ["sess_1", "sess_2"], ok: true, summary: "已提交 2 个生成任务。完成后会自动出现在工作区。" });
    await waitUntil(() => generatedRequests.length === 2);
    expect(registrySnapshots).toEqual([
      {
        activeSessionIds: ["sess_1", "sess_2"],
        batchTaskId: "batch_1",
        projectDirectory: "/project",
        retryCounts: {}
      },
      {
        activeSessionIds: ["sess_1", "sess_2"],
        batchTaskId: "batch_1",
        projectDirectory: "/project",
        retryCounts: {}
      }
    ]);
    expect(generatedRequests.map((request) => request.signal?.aborted)).toEqual([false, false]);
    expect(registry.has("batch_1")).toBe(true);

    generations.get("sess_1")?.resolve({ outputPath: "/project/images/generated/sess_1.png", requestSize: "auto" });
    await waitUntil(() => registry.getSnapshot("batch_1")?.activeSessionIds.join(",") === "sess_2");
    generations.get("sess_2")?.resolve({ outputPath: "/project/images/generated/sess_2.png", requestSize: "auto" });
    await waitUntil(() => !registry.has("batch_1"));
    expect(registry.has("batch_1")).toBe(false);
  });

  test("aborts batch item controllers from the parent operation signal and cleans the registry", async () => {
    let snapshot = createSnapshot();
    const parentController = new AbortController();
    const registry = new EsseBatchTaskRegistry();
    const runtime = createRuntime(snapshot, (nextSnapshot) => {
      snapshot = nextSnapshot;
    });
    const executor = createEsseImagePreflightExecutor({
      batchTaskRegistry: registry,
      generateImage: async (request) => {
        parentController.abort();
        expect(request.signal?.aborted).toBe(true);
        throw new Error("aborted");
      },
      makeBatchTaskId: () => "batch_1",
      projectDirectory: "/project",
      signal: parentController.signal
    });

    const result = await executor(
      {
        commands: [
          {
            mode: "edit",
            prompt: "换白底",
            target: { sessionId: "sess_1", type: "existing" }
          }
        ],
        tool: "run_batch_generation"
      },
      runtime
    );
    expect(result).toEqual({ affectedSessionIds: ["sess_1"], ok: true, summary: "已提交 1 个生成任务。完成后会自动出现在工作区。" });
    await waitUntil(() => snapshot.sessions[0].status === "failed");
    expect(registry.has("batch_1")).toBe(false);
    expect(snapshot.sessions[0].generatedFilePath).toBeUndefined();
    expect(snapshot.sessions[0].errorMessage).toBe("已取消");
  });
});

function createRuntime(initialSnapshot: ProjectSnapshot, onPersist: (snapshot: ProjectSnapshot) => void) {
  const sink = new ProjectMutationSink<ProjectSnapshot>({
    applyTransaction: async (mutator) => {
      const next = mutator(runtime.getState());
      onPersist(next);
      return next;
    }
  });
  const runtime = createProjectSnapshotWorkspaceRuntime({ initialSnapshot, sink });
  return {
    applyMutation: runtime.applyMutation,
    getState: runtime.getState
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for asynchronous generation update.");
}

function createSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    project: {
      createdAt: "2026-05-24T00:00:00.000Z",
      directory: "/project",
      id: "project_1",
      imageCount: 1,
      name: "测试项目",
      updatedAt: "2026-05-24T00:00:00.000Z"
    },
    selectedSessionId: "sess_1",
    sessions: [
      {
        chatMessages: [],
        chatStatus: "idle",
        fileName: "a.jpg",
        filePath: "/project/original/a.jpg",
        id: "sess_1",
        status: "idle"
      }
    ],
    ...overrides
  };
}
