import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { ProjectSnapshot } from "../ipcTypes";
import type { ProductImageResult } from "./tuziImageApi";
import { EsseBatchTaskRegistry } from "./esseBatchTaskRegistry";
import { createEsseImagePreflightExecutor, retryEsseBatchTaskItem } from "./esseImagePreflightExecutor";
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

  test("resolves project-level reference image ids for generation requests", async () => {
    let snapshot = createSnapshot({
      referenceImages: [
        {
          filePath: "/project/references/style.png",
          id: "ref_style",
          label: "风格参考"
        }
      ]
    });
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

    await executor(
      {
        commands: [
          {
            displayLabel: "img-1",
            mode: "edit",
            prompt: "按参考图风格重做",
            referenceImageIds: ["ref_style"],
            target: { sessionId: "sess_1", type: "existing" }
          }
        ],
        tool: "generate_image"
      },
      runtime
    );

    await waitUntil(() => generatedRequests.length === 1);
    expect(generatedRequests[0]).toMatchObject({
      referenceImagePaths: ["/project/references/style.png"]
    });
    generation.resolve({ outputPath: "/project/images/generated/out-ref.png", requestSize: "auto" });
    await waitUntil(() => snapshot.sessions[0].status === "completed");
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
      projectManagerState: {
        conversation: {
          id: "conv_1",
          messages: []
        },
        plans: []
      },
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
    expect(snapshot.projectManagerState?.conversation.messages.at(-1)).toMatchObject({
      batchTask: {
        batchTaskId: "batch_1",
        items: [
          {
            displayLabel: "a.jpg",
            mode: "edit",
            promptSummary: "第一张换白底",
            sessionId: "sess_1"
          },
          {
            displayLabel: "b.jpg",
            mode: "edit",
            promptSummary: "第二张换白底",
            sessionId: "sess_2"
          }
        ]
      },
      contextType: "esse-batch-task",
      role: "context"
    });
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

  test("retries a failed batch task item from the persisted card command", async () => {
    let snapshot = createSnapshotWithBatchTask({
      sessionStatus: "failed"
    });
    const registry = new EsseBatchTaskRegistry();
    const generation = createDeferred<ProductImageResult>();
    const generatedRequests: UnifiedImageGenerationRequest[] = [];
    const runtime = createRuntime(snapshot, (nextSnapshot) => {
      snapshot = nextSnapshot;
    });

    const result = await retryEsseBatchTaskItem(
      { batchTaskId: "batch_1", sessionId: "sess_1" },
      {
        batchTaskRegistry: registry,
        generateImage: async (request) => {
          generatedRequests.push(request);
          return await generation.promise;
        },
        projectDirectory: "/project"
      },
      runtime
    );

    expect(result).toEqual({ accepted: true, retryCount: 1, sessionId: "sess_1" });
    await waitUntil(() => generatedRequests.length === 1 && snapshot.sessions[0].status === "generating");
    expect(snapshot.sessions[0].errorMessage).toBeUndefined();
    expect(generatedRequests[0]).toMatchObject({
      imagePath: "/project/original/a.jpg",
      mode: "edit",
      prompt: "第一张换白底",
      sessionId: "sess_1"
    });
    expect(registry.getSnapshot("batch_1")).toEqual({
      activeSessionIds: ["sess_1"],
      batchTaskId: "batch_1",
      projectDirectory: "/project",
      retryCounts: { sess_1: 1 }
    });

    generation.resolve({ outputPath: "/project/images/generated/retry.png", requestSize: "auto" });
    await waitUntil(() => snapshot.sessions[0].status === "completed");
    expect(snapshot.sessions[0].generatedFilePath).toBe("/project/images/generated/retry.png");
    expect(registry.has("batch_1")).toBe(false);
  });

  test("rejects batch task retry for non-failed sessions or exhausted retry counts", async () => {
    let snapshot = createSnapshotWithBatchTask({
      sessionStatus: "completed"
    });
    const registry = new EsseBatchTaskRegistry();
    const runtime = createRuntime(snapshot, (nextSnapshot) => {
      snapshot = nextSnapshot;
    });

    await expect(retryEsseBatchTaskItem(
      { batchTaskId: "batch_1", sessionId: "sess_1" },
      {
        batchTaskRegistry: registry,
        generateImage: async () => ({ outputPath: "/unused.png", requestSize: "auto" }),
        projectDirectory: "/project"
      },
      runtime
    )).resolves.toEqual({ accepted: false, reason: "session is not in failed state" });

    snapshot = createSnapshotWithBatchTask({
      sessionStatus: "failed"
    });
    const retryRuntime = createRuntime(snapshot, (nextSnapshot) => {
      snapshot = nextSnapshot;
    });
    registry.recordRetry("batch_1", "sess_1");
    registry.recordRetry("batch_1", "sess_1");
    registry.recordRetry("batch_1", "sess_1");

    await expect(retryEsseBatchTaskItem(
      { batchTaskId: "batch_1", sessionId: "sess_1" },
      {
        batchTaskRegistry: registry,
        generateImage: async () => ({ outputPath: "/unused.png", requestSize: "auto" }),
        projectDirectory: "/project"
      },
      retryRuntime
    )).resolves.toEqual({ accepted: false, reason: "retry limit reached" });
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

function createSnapshotWithBatchTask(options: { sessionStatus: ProjectSnapshot["sessions"][number]["status"] }): ProjectSnapshot {
  return createSnapshot({
    projectManagerState: {
      conversation: {
        id: "conv_1",
        messages: [
          {
            batchTask: {
              batchTaskId: "batch_1",
              items: [
                {
                  command: {
                    mode: "edit",
                    prompt: "第一张换白底",
                    target: { sessionId: "sess_1", type: "existing" }
                  },
                  displayLabel: "a.jpg",
                  mode: "edit",
                  promptSummary: "第一张换白底",
                  sessionId: "sess_1"
                }
              ]
            },
            content: "",
            contextType: "esse-batch-task",
            id: "batch-message-1",
            role: "context"
          }
        ]
      },
      plans: []
    },
    sessions: [
      {
        chatMessages: [],
        chatStatus: "idle",
        errorMessage: options.sessionStatus === "failed" ? "网络错误" : undefined,
        fileName: "a.jpg",
        filePath: "/project/original/a.jpg",
        id: "sess_1",
        status: options.sessionStatus
      }
    ]
  });
}
