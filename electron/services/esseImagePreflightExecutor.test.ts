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
  test("executes confirmed existing-image generation as a new workspace image", async () => {
    let snapshot = createSnapshot({
      projectManagerState: {
        conversation: { id: "conv_1", messages: [] },
        plans: []
      }
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
      makeSessionId: () => "sess_new_1",
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

    expect(result).toEqual({ affectedSessionIds: ["sess_new_1"], ok: true, summary: "已提交 1 个生成任务。完成后会自动出现在工作区。" });
    await waitUntil(() => generatedRequests.length === 1 && snapshot.sessions[1]?.status === "generating");
    expect(generatedRequests).toEqual([
      {
        imagePath: "/project/original/a.jpg",
        mode: "edit",
        prompt: "保留主体，换成白底主图",
        signal: generatedRequests[0].signal,
        sessionId: "sess_new_1"
      }
    ]);
    expect(snapshot.sessions[0].generatedFilePath).toBeUndefined();
    expect(snapshot.sessions[1]).toMatchObject({
      fileName: "生成-a.jpg",
      filePath: "/project/original/a.jpg",
      id: "sess_new_1",
      originatedFromGeneration: true
    });

    generation.resolve({ outputPath: "/project/images/generated/out-1.png", requestSize: "auto" });
    await waitUntil(() => snapshot.sessions[1]?.status === "completed");
    expect(snapshot.sessions[0].generatedFilePath).toBeUndefined();
    expect(snapshot.sessions[1]?.generatedFilePath).toBe("/project/images/generated/out-1.png");
    expect(snapshot.sessions[1]?.generatedFilePaths).toEqual(["/project/images/generated/out-1.png"]);
    expect(snapshot.sessions[1]?.chatMessages.at(-1)).toMatchObject({
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
      makeSessionId: () => "sess_ref_1",
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
    await waitUntil(() => snapshot.sessions.find((session) => session.id === "sess_ref_1")?.status === "completed");
  });

  test("resolves turn attachment reference ids without persisting a project reference", async () => {
    let snapshot = createSnapshot({
      projectManagerState: {
        conversation: { id: "conv_1", messages: [] },
        plans: []
      }
    });
    const generation = createDeferred<ProductImageResult>();
    const generatedRequests: UnifiedImageGenerationRequest[] = [];
    const runtime = createRuntime(snapshot, (nextSnapshot) => {
      snapshot = nextSnapshot;
    }, ["/project/uploads/room.png"]);
    const executor = createEsseImagePreflightExecutor({
      generateImage: async (request) => {
        generatedRequests.push(request);
        return await generation.promise;
      },
      makeSessionId: () => "sess_turn_ref_1",
      projectDirectory: "/project"
    });

    await executor(
      {
        commands: [
          {
            displayLabel: "img-1",
            mode: "edit",
            prompt: "按附件场景重做",
            referenceImageIds: ["turn-ref-1"],
            target: { sessionId: "sess_1", type: "existing" }
          }
        ],
        tool: "generate_image"
      },
      runtime
    );

    await waitUntil(() => generatedRequests.length === 1);
    expect(generatedRequests[0]).toMatchObject({
      referenceImagePaths: ["/project/uploads/room.png"]
    });
    expect(snapshot.referenceImages).toBeUndefined();
    expect(snapshot.projectManagerState?.conversation.messages.at(-1)?.batchTask?.referenceImages).toEqual([
      {
        filePath: "/project/uploads/room.png",
        id: "turn-ref-1",
        label: "本轮参考图 1"
      }
    ]);
    generation.resolve({ outputPath: "/project/images/generated/out-turn-ref.png", requestSize: "auto" });
    await waitUntil(() => snapshot.sessions.find((session) => session.id === "sess_turn_ref_1")?.status === "completed");
  });

  test("resolves workspace reference image ids from list_sessions into generation requests", async () => {
    let snapshot = createSnapshot({
      projectManagerState: {
        conversation: { id: "conv_1", messages: [] },
        plans: []
      },
      sessions: [
        {
          chatMessages: [],
          chatStatus: "idle",
          fileName: "a.jpg",
          filePath: "/project/original/a.jpg",
          id: "sess_1",
          status: "idle"
        },
        {
          chatMessages: [],
          chatStatus: "idle",
          fileName: "scene.jpg",
          filePath: "/project/original/scene.jpg",
          generatedFilePath: "/project/generated/scene-current.png",
          generatedFilePaths: ["/project/generated/scene-current.png"],
          id: "sess_scene",
          status: "completed"
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
      makeSessionId: () => "sess_workspace_ref_1",
      projectDirectory: "/project"
    });

    await executor(
      {
        commands: [
          {
            displayLabel: "img-1",
            mode: "edit",
            prompt: "按参考场景重做",
            referenceImageIds: ["workspace-ref-sess_scene"],
            target: { sessionId: "sess_1", type: "existing" }
          }
        ],
        tool: "generate_image"
      },
      runtime
    );

    await waitUntil(() => generatedRequests.length === 1);
    expect(generatedRequests[0]).toMatchObject({
      referenceImagePaths: ["/project/generated/scene-current.png"]
    });
    expect(snapshot.projectManagerState?.conversation.messages.at(-1)?.batchTask?.referenceImages).toEqual([
      {
        filePath: "/project/generated/scene-current.png",
        id: "workspace-ref-sess_scene",
        label: "图2 scene.jpg"
      }
    ]);
    generation.resolve({ outputPath: "/project/images/generated/out-workspace-ref.png", requestSize: "auto" });
    await waitUntil(() => snapshot.sessions.find((session) => session.id === "sess_workspace_ref_1")?.status === "completed");
  });

  test("resolves multiple reference image ids from project, workspace, and current-turn attachments", async () => {
    let snapshot = createSnapshot({
      projectManagerState: {
        conversation: { id: "conv_1", messages: [] },
        plans: []
      },
      referenceImages: [
        {
          filePath: "/project/references/style.png",
          id: "ref_style",
          label: "项目风格参考"
        }
      ],
      sessions: [
        {
          chatMessages: [],
          chatStatus: "idle",
          fileName: "product.jpg",
          filePath: "/project/original/product.jpg",
          id: "sess_product",
          status: "idle"
        },
        {
          chatMessages: [],
          chatStatus: "idle",
          fileName: "scene.jpg",
          filePath: "/project/original/scene.jpg",
          id: "sess_scene",
          status: "idle"
        }
      ]
    });
    const generation = createDeferred<ProductImageResult>();
    const generatedRequests: UnifiedImageGenerationRequest[] = [];
    const runtime = createRuntime(snapshot, (nextSnapshot) => {
      snapshot = nextSnapshot;
    }, ["/project/uploads/material.png"]);
    const executor = createEsseImagePreflightExecutor({
      generateImage: async (request) => {
        generatedRequests.push(request);
        return await generation.promise;
      },
      makeSessionId: () => "sess_multi_ref_1",
      projectDirectory: "/project"
    });

    await executor(
      {
        commands: [
          {
            displayLabel: "img-1",
            mode: "edit",
            prompt: "按多张参考图重做商品图",
            referenceImageIds: ["workspace-ref-sess_scene", "turn-ref-1", "ref_style"],
            target: { sessionId: "sess_product", type: "existing" }
          }
        ],
        tool: "generate_image"
      },
      runtime
    );

    await waitUntil(() => generatedRequests.length === 1);
    expect(generatedRequests[0]).toMatchObject({
      imagePath: "/project/original/product.jpg",
      sessionId: "sess_multi_ref_1",
      referenceImagePaths: ["/project/original/scene.jpg", "/project/uploads/material.png", "/project/references/style.png"]
    });
    expect(snapshot.sessions.find((session) => session.id === "sess_multi_ref_1")?.chatMessages.at(-1)).toMatchObject({
      content: "来自 Esse智能体：按多张参考图重做商品图\n参考图：3 张",
      contextType: "esse-task",
      referenceFilePaths: ["/project/original/scene.jpg", "/project/uploads/material.png", "/project/references/style.png"],
      sourceFilePath: "/project/original/product.jpg"
    });
    expect(snapshot.projectManagerState?.conversation.messages.at(-1)?.batchTask?.referenceImages).toEqual([
      {
        filePath: "/project/original/scene.jpg",
        id: "workspace-ref-sess_scene",
        label: "图2 scene.jpg"
      },
      {
        filePath: "/project/uploads/material.png",
        id: "turn-ref-1",
        label: "本轮参考图 1"
      },
      {
        filePath: "/project/references/style.png",
        id: "ref_style",
        label: "项目风格参考"
      }
    ]);
    generation.resolve({ outputPath: "/project/images/generated/out-multi-ref.png", requestSize: "auto" });
    await waitUntil(() => snapshot.sessions.find((session) => session.id === "sess_multi_ref_1")?.status === "completed");
  });

  test("submits clicked-image batch pairs to the image edit path as ordered references after approval", async () => {
    const projectDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-clicked-refs-"));
    let snapshot = createSnapshot({
      project: { ...createSnapshot().project, directory: projectDirectory },
      projectManagerState: {
        conversation: { id: "conv_1", messages: [] },
        plans: []
      }
    });
    const generatedRequests: UnifiedImageGenerationRequest[] = [];
    const generations = new Map<string, Deferred<ProductImageResult>>();
    const runtime = createRuntime(snapshot, (nextSnapshot) => {
      snapshot = nextSnapshot;
    }, [
      "/project/clicked/detail-style.png",
      "/project/clicked/product-a.png",
      "/project/clicked/product-b.png"
    ]);
    let nextSessionIndex = 0;
    const executor = createEsseImagePreflightExecutor({
      createSeed: async ({ sessionId }) => {
        const seedPath = path.join(projectDirectory, "images", "generated", "seeds", `${sessionId}.png`);
        await mkdir(path.dirname(seedPath), { recursive: true });
        await writeFile(seedPath, "seed");
        return seedPath;
      },
      generateImage: async (request) => {
        generatedRequests.push(request);
        const generation = createDeferred<ProductImageResult>();
        generations.set(request.sessionId, generation);
        return await generation.promise;
      },
      makeSessionId: () => `sess_clicked_${++nextSessionIndex}`,
      projectDirectory
    });

    const result = await executor(
      {
        commands: [
          {
            mode: "generate",
            prompt: "根据点击的图片1风格，为点击的图片2生成细节商品图",
            referenceImageIds: ["turn-ref-2", "turn-ref-1"],
            target: { fileName: "product-a-detail.png", type: "new" }
          },
          {
            mode: "generate",
            prompt: "根据点击的图片1风格，为点击的图片3生成细节商品图",
            referenceImageIds: ["turn-ref-3", "turn-ref-1"],
            target: { fileName: "product-b-detail.png", type: "new" }
          }
        ],
        tool: "run_batch_generation"
      },
      runtime
    );

    expect(result).toEqual({
      affectedSessionIds: ["sess_clicked_1", "sess_clicked_2"],
      ok: true,
      summary: "已提交 2 个生成任务。完成后会自动出现在工作区。"
    });
    await waitUntil(() => generatedRequests.length === 2);
    expect(generatedRequests.map((request) => ({
      mode: request.mode,
      prompt: request.prompt,
      referenceImagePaths: request.referenceImagePaths,
      sessionId: request.sessionId
    }))).toEqual([
      {
        mode: "generate",
        prompt: "根据点击的图片1风格，为点击的图片2生成细节商品图",
        referenceImagePaths: ["/project/clicked/product-a.png", "/project/clicked/detail-style.png"],
        sessionId: "sess_clicked_1"
      },
      {
        mode: "generate",
        prompt: "根据点击的图片1风格，为点击的图片3生成细节商品图",
        referenceImagePaths: ["/project/clicked/product-b.png", "/project/clicked/detail-style.png"],
        sessionId: "sess_clicked_2"
      }
    ]);
    expect(snapshot.projectManagerState?.conversation.messages.at(-1)?.batchTask?.referenceImages).toEqual([
      {
        filePath: "/project/clicked/product-a.png",
        id: "turn-ref-2",
        label: "本轮参考图 2"
      },
      {
        filePath: "/project/clicked/detail-style.png",
        id: "turn-ref-1",
        label: "本轮参考图 1"
      },
      {
        filePath: "/project/clicked/product-b.png",
        id: "turn-ref-3",
        label: "本轮参考图 3"
      }
    ]);

    generations.get("sess_clicked_1")?.resolve({ outputPath: "/project/generated/product-a-detail.png", requestSize: "auto" });
    generations.get("sess_clicked_2")?.resolve({ outputPath: "/project/generated/product-b-detail.png", requestSize: "auto" });
    await waitUntil(() => snapshot.sessions.filter((session) => session.status === "completed").length === 2);
  });

  test("preserves scene base images as the first edit input for turn-reference scene replacement", async () => {
    const projectDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-scene-base-refs-"));
    let snapshot = createSnapshot({
      project: { ...createSnapshot().project, directory: projectDirectory },
      projectManagerState: {
        conversation: { id: "conv_1", messages: [] },
        plans: []
      }
    });
    const generatedRequests: UnifiedImageGenerationRequest[] = [];
    const generations = new Map<string, Deferred<ProductImageResult>>();
    const runtime = createRuntime(snapshot, (nextSnapshot) => {
      snapshot = nextSnapshot;
    }, [
      "/project/clicked/plant-a.png",
      "/project/clicked/plant-b.png",
      "/project/clicked/leaf.png",
      "/project/clicked/scale.png",
      "/project/clicked/window-scene.png"
    ]);
    let nextSessionIndex = 0;
    const executor = createEsseImagePreflightExecutor({
      createSeed: async ({ sessionId }) => {
        const seedPath = path.join(projectDirectory, "images", "generated", "seeds", `${sessionId}.png`);
        await mkdir(path.dirname(seedPath), { recursive: true });
        await writeFile(seedPath, "seed");
        return seedPath;
      },
      generateImage: async (request) => {
        generatedRequests.push(request);
        const generation = createDeferred<ProductImageResult>();
        generations.set(request.sessionId, generation);
        return await generation.promise;
      },
      makeSessionId: () => `sess_scene_${++nextSessionIndex}`,
      projectDirectory
    });

    await executor(
      {
        commands: [
          {
            displayLabel: "scene_from_img1",
            mode: "generate",
            prompt: "以场景图为待保留场景，将目标植物自然替换进去，大小参考按大小参考执行。",
            referenceImageIds: ["turn-ref-5", "turn-ref-1", "turn-ref-4"],
            referenceImageNames: ["场景图", "目标植物", "大小参考"],
            target: { fileName: "scene_from_img1.png", type: "new" }
          },
          {
            displayLabel: "scene_from_img2",
            mode: "generate",
            prompt: "以场景图为待保留场景，将目标植物自然替换进去，大小参考按大小参考执行。",
            referenceImageIds: ["turn-ref-5", "turn-ref-2", "turn-ref-4"],
            referenceImageNames: ["场景图", "目标植物", "大小参考"],
            target: { fileName: "scene_from_img2.png", type: "new" }
          }
        ],
        tool: "run_batch_generation"
      },
      runtime
    );

    await waitUntil(() => generatedRequests.length === 2);
    expect(generatedRequests.map((request) => request.referenceImagePaths)).toEqual([
      ["/project/clicked/window-scene.png", "/project/clicked/plant-a.png", "/project/clicked/scale.png"],
      ["/project/clicked/window-scene.png", "/project/clicked/plant-b.png", "/project/clicked/scale.png"]
    ]);
    expect(generatedRequests[0]?.prompt).toBe(
      "本次上传给图像 API 的图片局部命名：第1张 = 场景图；第2张 = 目标植物；第3张 = 大小参考。\n以场景图为待保留场景，将目标植物自然替换进去，大小参考按大小参考执行。"
    );
    expect(generatedRequests[0]?.prompt).not.toContain("【图片5】");
    expect(snapshot.projectManagerState?.conversation.messages.at(-1)?.batchTask?.referenceImages).toEqual([
      {
        filePath: "/project/clicked/window-scene.png",
        id: "turn-ref-5",
        label: "本轮参考图 5"
      },
      {
        filePath: "/project/clicked/plant-a.png",
        id: "turn-ref-1",
        label: "本轮参考图 1"
      },
      {
        filePath: "/project/clicked/scale.png",
        id: "turn-ref-4",
        label: "本轮参考图 4"
      },
      {
        filePath: "/project/clicked/plant-b.png",
        id: "turn-ref-2",
        label: "本轮参考图 2"
      }
    ]);

    generations.get("sess_scene_1")?.resolve({ outputPath: "/project/generated/scene-1.png", requestSize: "auto" });
    generations.get("sess_scene_2")?.resolve({ outputPath: "/project/generated/scene-2.png", requestSize: "auto" });
    await waitUntil(() => snapshot.sessions.filter((session) => session.status === "completed").length === 2);
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

  test("creates a new editable session from a source session after approval instead of requiring a separate duplicate tool call", async () => {
    let snapshot = createSnapshot({
      projectManagerState: {
        conversation: { id: "conv_1", messages: [] },
        plans: []
      },
      sessions: [
        {
          chatMessages: [{ content: "原图会话", id: "msg_1", role: "assistant" }],
          chatStatus: "idle",
          fileName: "source.jpg",
          filePath: "/project/original/source.jpg",
          generatedFilePath: "/project/generated/source-current.png",
          generatedFilePaths: ["/project/generated/source-current.png"],
          id: "sess_source",
          showOriginalInList: false,
          status: "completed"
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
      makeSessionId: () => "sess_new_copy",
      projectDirectory: "/project"
    });

    const result = await executor(
      {
        commands: [
          {
            displayLabel: "img-1",
            mode: "edit",
            prompt: "基于源图生成一张新商品图，保留原图不动",
            target: { fileName: "source-new.jpg", sourceSessionId: "sess_source", type: "new" }
          }
        ],
        tool: "generate_image"
      },
      runtime
    );

    expect(result).toEqual({ affectedSessionIds: ["sess_new_copy"], ok: true, summary: "已提交 1 个生成任务。完成后会自动出现在工作区。" });
    await waitUntil(() => generatedRequests.length === 1);
    expect(generatedRequests[0]).toMatchObject({
      imagePath: "/project/generated/source-current.png",
      mode: "edit",
      sessionId: "sess_new_copy"
    });
    expect(snapshot.sessions).toHaveLength(2);
    expect(snapshot.sessions[0]).toMatchObject({
      fileName: "source.jpg",
      generatedFilePath: "/project/generated/source-current.png",
      status: "completed"
    });
    expect(snapshot.sessions[1]).toMatchObject({
      chatMessages: [
        {
          content: "来自 Esse智能体：基于源图生成一张新商品图，保留原图不动",
          contextType: "esse-task",
          role: "context",
          sourceFilePath: "/project/generated/source-current.png"
        }
      ],
      fileName: "source-new.jpg",
      filePath: "/project/generated/source-current.png",
      id: "sess_new_copy",
      originatedFromGeneration: true,
      status: "generating"
    });

    generation.resolve({ outputPath: "/project/images/generated/out-new-copy.png", requestSize: "auto" });
    await waitUntil(() => snapshot.sessions[1]?.status === "completed");
    expect(snapshot.sessions[1]?.chatMessages).toMatchObject([
      {
        contextType: "esse-task",
        sourceFilePath: "/project/generated/source-current.png"
      },
      {
        contextType: "generated-image",
        generatedFilePath: "/project/images/generated/out-new-copy.png"
      }
    ]);
    expect(snapshot.sessions[1]?.generatedFilePaths).toEqual(["/project/images/generated/out-new-copy.png"]);
    expect(snapshot.sessions[0]?.generatedFilePaths).toEqual(["/project/generated/source-current.png"]);
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
    let nextGeneratedSessionIndex = 0;
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
      makeSessionId: () => `sess_generated_${++nextGeneratedSessionIndex}`,
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

    expect(result).toEqual({ affectedSessionIds: ["sess_generated_1", "sess_generated_2"], ok: true, summary: "已提交 2 个生成任务。完成后会自动出现在工作区。" });
    await waitUntil(() => generatedRequests.length === 2);
    expect(registrySnapshots).toEqual([
      {
        activeSessionIds: ["sess_generated_1", "sess_generated_2"],
        batchTaskId: "batch_1",
        projectDirectory: "/project",
        retryCounts: {}
      },
      {
        activeSessionIds: ["sess_generated_1", "sess_generated_2"],
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
            displayLabel: "生成-a.jpg",
            mode: "edit",
            promptSummary: "第一张换白底",
            sessionId: "sess_generated_1"
          },
          {
            displayLabel: "生成-b.jpg",
            mode: "edit",
            promptSummary: "第二张换白底",
            sessionId: "sess_generated_2"
          }
        ]
      },
      contextType: "esse-batch-task",
      role: "context"
    });
    expect(registry.has("batch_1")).toBe(true);

    generations.get("sess_generated_1")?.resolve({ outputPath: "/project/images/generated/sess_1.png", requestSize: "auto" });
    await waitUntil(() => registry.getSnapshot("batch_1")?.activeSessionIds.join(",") === "sess_generated_2");
    generations.get("sess_generated_2")?.resolve({ outputPath: "/project/images/generated/sess_2.png", requestSize: "auto" });
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
      makeSessionId: () => "sess_abort_1",
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
    expect(result).toEqual({ affectedSessionIds: ["sess_abort_1"], ok: true, summary: "已提交 1 个生成任务。完成后会自动出现在工作区。" });
    await waitUntil(() => snapshot.sessions.find((session) => session.id === "sess_abort_1")?.status === "failed");
    expect(registry.has("batch_1")).toBe(false);
    expect(snapshot.sessions[0].generatedFilePath).toBeUndefined();
    expect(snapshot.sessions.find((session) => session.id === "sess_abort_1")?.errorMessage).toBe("已取消");
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

function createRuntime(initialSnapshot: ProjectSnapshot, onPersist: (snapshot: ProjectSnapshot) => void, turnReferenceImagePaths: string[] = []) {
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
    getState: runtime.getState,
    getTurnReferenceImagePaths: () => turnReferenceImagePaths
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
