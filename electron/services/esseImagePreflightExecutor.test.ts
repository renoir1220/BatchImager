import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { ProjectSnapshot } from "../ipcTypes";
import { createEsseImagePreflightExecutor } from "./esseImagePreflightExecutor";
import { ProjectMutationSink } from "./projectMutationSink";
import { createProjectSnapshotWorkspaceRuntime } from "./esseWorkspaceRuntime";
import type { ImageGenerationExecutor, UnifiedImageGenerationRequest } from "./imageGenerationService";

describe("esseImagePreflightExecutor", () => {
  test("executes confirmed existing-image generation and writes the generated result through the mutation sink", async () => {
    let snapshot = createSnapshot();
    const generatedRequests: UnifiedImageGenerationRequest[] = [];
    const runtime = createRuntime(snapshot, (nextSnapshot) => {
      snapshot = nextSnapshot;
    });
    const executor = createEsseImagePreflightExecutor({
      generateImage: createFakeGenerator(generatedRequests, "/project/images/generated/out-1.png"),
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

    expect(result).toEqual({ affectedSessionIds: ["sess_1"], ok: true, summary: "图片生成完成。" });
    expect(generatedRequests).toEqual([
      {
        imagePath: "/project/original/a.jpg",
        mode: "edit",
        prompt: "保留主体，换成白底主图",
        sessionId: "sess_1"
      }
    ]);
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
    const generatedRequests: UnifiedImageGenerationRequest[] = [];
    const runtime = createRuntime(snapshot, (nextSnapshot) => {
      snapshot = nextSnapshot;
    });
    const executor = createEsseImagePreflightExecutor({
      createSeed: async ({ sessionId }) => path.join(projectDirectory, "images", "generated", "seeds", `${sessionId}.png`),
      generateImage: createFakeGenerator(generatedRequests, path.join(projectDirectory, "images", "generated", "new-output.png")),
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

    expect(result).toEqual({ affectedSessionIds: ["sess_new"], ok: true, summary: "图片生成完成。" });
    expect(generatedRequests).toEqual([
      {
        imagePath: path.join(projectDirectory, "images", "generated", "seeds", "sess_new.png"),
        mode: "generate",
        prompt: "新增一张场景图",
        sessionId: "sess_new",
        size: "2048x1152"
      }
    ]);
    expect(snapshot.sessions.map((session) => session.id)).toEqual(["sess_1", "sess_new"]);
    expect(snapshot.selectedSessionId).toBe("sess_new");
    expect(snapshot.sessions[1]).toMatchObject({
      fileName: "scene.png",
      generatedFilePath: path.join(projectDirectory, "images", "generated", "new-output.png"),
      generatedFilePaths: [path.join(projectDirectory, "images", "generated", "new-output.png")],
      status: "completed"
    });
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

function createFakeGenerator(requests: UnifiedImageGenerationRequest[], outputPath: string): ImageGenerationExecutor {
  return async (request) => {
    requests.push(request);
    return {
      outputPath,
      requestSize: request.size ?? "auto"
    };
  };
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
