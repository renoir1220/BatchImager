// @vitest-environment jsdom

import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import type {
  AgentPermissionRequest,
  AgentPreflightRequest,
  ProjectManagerState,
  ProjectSnapshot,
  SendAgentMessageResponse
} from "../electron/ipcTypes";
import { createEsseImagePreflightExecutor } from "../electron/services/esseImagePreflightExecutor";
import { createProjectSnapshotWorkspaceRuntime } from "../electron/services/esseWorkspaceRuntime";
import type { UnifiedImageGenerationRequest } from "../electron/services/imageGenerationService";
import { ProjectMutationSink } from "../electron/services/projectMutationSink";
import type { ProductImageResult } from "../electron/services/tuziImageApi";
import { App } from "./App";
import { renderBatchImagerAppE2e, type BatchImagerAppE2eHarness } from "./test/batchImagerAppE2eHarness";

describe("BatchImager app e2e harness", () => {
  test("drives project conversation into an agent image-generation preflight and generated workspace update", async () => {
    const user = userEvent.setup();
    let resolveAgentMessage: ((response: SendAgentMessageResponse) => void) | undefined;
    const harness = renderBatchImagerAppE2e(<App />, {
      initialSnapshot: makeProjectSnapshot(),
      onSendAgentMessage: (request) =>
        new Promise((resolve) => {
          expect(request.providerId).toBe("esse");
          expect(request.messages.at(-1)).toMatchObject({ content: "把图1做成白底商品图", role: "user" });
          expect(request.selectedSessionId).toBe("img-1");
          expect(request.sessions).toEqual([
            expect.objectContaining({
              currentImagePath: "/tmp/batchimager-e2e/images/original/flower.jpg",
              fileName: "flower.jpg",
              id: "img-1"
            })
          ]);
          resolveAgentMessage = resolve;
        })
    });

    await importInitialImages(user);
    await user.click(screen.getByRole("tab", { name: "Esse" }));
    await user.type(screen.getByRole("textbox", { name: "Esse 输入" }), "把图1做成白底商品图");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(harness.mocks.sendAgentMessage).toHaveBeenCalledTimes(1));

    act(() => {
      harness.emitPreflightRequest(makeGenerationPreflightRequest());
    });

    expect(await screen.findByRole("region", { name: "Esse 生成确认" })).toBeInTheDocument();
    expect(screen.getByText("生成图片")).toBeInTheDocument();
    expect(screen.getByText("保持花瓶主体，生成白底电商主图")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "目标 图1 flower.jpg" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "执行" }));

    await waitFor(() =>
      expect(harness.mocks.respondAgentPreflight).toHaveBeenCalledWith({
        decision: "execute",
        requestId: "preflight-generate-1"
      })
    );

    act(() => {
      harness.emitProjectSnapshotUpdate(withGeneratedImageResult(harness.getSnapshot()));
    });
    await act(async () => {
      resolveAgentMessage?.({ providerId: "esse", reply: "已提交生成任务，完成后会出现在工作区。" });
    });

    const generatedImage = await screen.findByAltText("生成-flower.jpg");
    expect(generatedImage).toHaveAttribute(
      "src",
      "batchimager-test://%2Ftmp%2Fbatchimager-e2e%2Fimages%2Fgenerated%2Fflower-white.png"
    );
    expect(screen.getByRole("region", { name: "Esse 生成任务" })).toBeInTheDocument();
    expect(screen.getByText("已提交生成任务，完成后会出现在工作区。")).toBeInTheDocument();
  });

  test("drives agent permission into a workspace mutation snapshot update", async () => {
    const user = userEvent.setup();
    let resolveAgentMessage: ((response: SendAgentMessageResponse) => void) | undefined;
    const harness = renderBatchImagerAppE2e(<App />, {
      initialSnapshot: makeProjectSnapshot([
        makeSession({ id: "img-1", fileName: "flower.jpg", filePath: "/tmp/batchimager-e2e/images/original/flower.jpg" }),
        makeSession({ id: "img-2", fileName: "lamp.jpg", filePath: "/tmp/batchimager-e2e/images/original/lamp.jpg" })
      ]),
      onSendAgentMessage: () =>
        new Promise((resolve) => {
          resolveAgentMessage = resolve;
        })
    });

    await importInitialImages(user);
    await user.click(screen.getByRole("tab", { name: "Esse" }));
    await user.type(screen.getByRole("textbox", { name: "Esse 输入" }), "把图1重命名成主图.jpg");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(harness.mocks.sendAgentMessage).toHaveBeenCalledTimes(1));

    act(() => {
      harness.emitPermissionRequest(makeRenamePermissionRequest());
    });

    expect(await screen.findByRole("region", { name: "Esse 操作确认" })).toBeInTheDocument();
    expect(screen.getByText("重命名图片")).toBeInTheDocument();
    expect(screen.getByText("rename_session")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "允许一次" }));

    await waitFor(() =>
      expect(harness.mocks.respondAgentPermission).toHaveBeenCalledWith({
        decision: "allow-once",
        requestId: "permission-rename-1"
      })
    );

    act(() => {
      harness.emitProjectSnapshotUpdate(withRenamedFirstSession(harness.getSnapshot()));
    });
    await act(async () => {
      resolveAgentMessage?.({ providerId: "esse", reply: "已把图1重命名为主图.jpg。" });
    });

    expect(await screen.findByAltText("主图.jpg")).toBeInTheDocument();
    expect(screen.queryByAltText("flower.jpg")).not.toBeInTheDocument();
    expect(screen.getByText("已把图1重命名为主图.jpg。")).toBeInTheDocument();
  });

  test("persists a null selected session when the last workspace image is deleted", async () => {
    const user = userEvent.setup();
    const harness = renderBatchImagerAppE2e(<App />, {
      initialSnapshot: makeProjectSnapshot()
    });

    await importInitialImages(user);
    await user.click(await screen.findByRole("button", { name: "删除图片" }));
    await user.click(screen.getByRole("button", { name: "确认删除图片" }));

    await waitFor(() => expect(harness.getSnapshot().sessions).toHaveLength(0));
    expect(harness.getSnapshot().selectedSessionId).toBeNull();
    expect(harness.mocks.saveProjectSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedSessionId: null,
        sessions: []
      })
    );
  });

  test("executes an approved agent image preflight through the shared workbench executor", async () => {
    const user = userEvent.setup();
    let resolveAgentMessage: ((response: SendAgentMessageResponse) => void) | undefined;
    const generatedRequests: UnifiedImageGenerationRequest[] = [];
    const generation = createDeferred<ProductImageResult>();
    const preflightRequest = makeGenerationPreflightRequest();
    let runApprovedPreflight: () => Promise<void> = async () => undefined;
    const harness = renderBatchImagerAppE2e(<App />, {
      initialSnapshot: makeProjectSnapshot(),
      onRespondAgentPreflight: async (response) => {
        if (response.requestId === preflightRequest.requestId && response.decision === "execute") {
          await runApprovedPreflight();
        }
        return { accepted: true };
      },
      onSendAgentMessage: () =>
        new Promise((resolve) => {
          resolveAgentMessage = resolve;
        })
    });
    const runtime = createProjectSnapshotWorkspaceRuntime({
      initialSnapshot: harness.getSnapshot(),
      sink: new ProjectMutationSink<ProjectSnapshot>({
        applyTransaction: async (mutator) => {
          const nextSnapshot = mutator(harness.getSnapshot());
          harness.setSnapshot(nextSnapshot);
          return nextSnapshot;
        },
        broadcast: (snapshot) => {
          harness.emitProjectSnapshotUpdate(snapshot);
        }
      })
    });
    const executor = createEsseImagePreflightExecutor({
      generateImage: async (request) => {
        generatedRequests.push(request);
        return await generation.promise;
      },
      makeBatchTaskId: () => "batch-e2e-real-executor",
      makeSessionId: () => "img-generated-1",
      projectDirectory: "/tmp/batchimager-e2e"
    });
    runApprovedPreflight = async () => {
      const tool = preflightRequest.payload.tool;
      if (tool === "package_generated_images") {
        throw new Error("image preflight e2e cannot execute package preflight requests");
      }
      const result = await executor(
        {
          commands: preflightRequest.payload.commands,
          tool
        },
        runtime
      );
      expect(result).toMatchObject({ affectedSessionIds: ["img-generated-1"], ok: true });
    };

    await importInitialImages(user);
    await user.click(screen.getByRole("tab", { name: "Esse" }));
    await user.type(screen.getByRole("textbox", { name: "Esse 输入" }), "直接执行共享生成链路");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(harness.mocks.sendAgentMessage).toHaveBeenCalledTimes(1));

    act(() => {
      harness.emitPreflightRequest(preflightRequest);
    });

    await user.click(await screen.findByRole("button", { name: "执行" }));

    await waitFor(() => expect(generatedRequests).toHaveLength(1));
    expect(generatedRequests[0]).toMatchObject({
      imagePath: "/tmp/batchimager-e2e/images/original/flower.jpg",
      mode: "edit",
      prompt: "保持花瓶主体，生成白底电商主图",
      sessionId: "img-generated-1"
    });
    expect(await screen.findByAltText("生成-flower.jpg")).toBeInTheDocument();
    expect(harness.getSnapshot().sessions.find((session) => session.id === "img-generated-1")).toMatchObject({
      fileName: "生成-flower.jpg",
      originatedFromGeneration: true,
      status: "generating"
    });
    expect(screen.getByRole("region", { name: "Esse 生成任务" })).toBeInTheDocument();

    generation.resolve({
      outputPath: "/tmp/batchimager-e2e/images/generated/shared-executor-output.png",
      requestSize: "auto"
    });
    await act(async () => {
      resolveAgentMessage?.({ providerId: "esse", reply: "共享生成执行链路已完成。" });
    });

    const generatedImage = await screen.findByAltText("生成-flower.jpg");
    await waitFor(() =>
      expect(generatedImage).toHaveAttribute(
        "src",
        "batchimager-test://%2Ftmp%2Fbatchimager-e2e%2Fimages%2Fgenerated%2Fshared-executor-output.png"
      )
    );
    expect(harness.getSnapshot().sessions.find((session) => session.id === "img-generated-1")).toMatchObject({
      generatedFilePath: "/tmp/batchimager-e2e/images/generated/shared-executor-output.png",
      generatedFilePaths: ["/tmp/batchimager-e2e/images/generated/shared-executor-output.png"],
      status: "completed"
    });
    expect(screen.queryByRole("region", { name: "Esse 生成确认" })).not.toBeInTheDocument();
    expect(screen.getByText("共享生成执行链路已完成。")).toBeInTheDocument();
  });
});

async function importInitialImages(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getAllByRole("button", { name: "导入图片" })[0]);
}

function makeGenerationPreflightRequest(): AgentPreflightRequest {
  return {
    payload: {
      commands: [
        {
          displayLabel: "img-1",
          mode: "edit",
          prompt: "保持花瓶主体，生成白底电商主图",
          target: { sourceSessionId: "img-1", type: "new" }
        }
      ],
      estimatedApiCalls: 1,
      tool: "generate_image"
    },
    requestId: "preflight-generate-1"
  };
}

function makeRenamePermissionRequest(): AgentPermissionRequest {
  return {
    payload: {
      affectedDisplayLabel: "img-1",
      affectedFileName: "flower.jpg",
      label: "重命名图片",
      params: { fileName: "主图.jpg", sessionId: "img-1" },
      requiresPreflight: false,
      risk: "safe-write",
      targetKey: "img-1",
      toolName: "rename_session"
    },
    requestId: "permission-rename-1"
  };
}

function withGeneratedImageResult(snapshot: ProjectSnapshot): ProjectSnapshot {
  const generatedSessionId = "img-generated-1";
  const generatedPath = "/tmp/batchimager-e2e/images/generated/flower-white.png";
  const nextProjectManagerState = markPreflightDecision(
    appendBatchTaskMessage(snapshot.projectManagerState ?? emptyProjectManagerState(), generatedSessionId),
    "preflight-generate-1",
    "execute"
  );

  return {
    ...snapshot,
    project: {
      ...snapshot.project,
      imageCount: snapshot.sessions.length + 1
    },
    projectManagerState: nextProjectManagerState,
    selectedSessionId: generatedSessionId,
    sessions: [
      ...snapshot.sessions,
      {
        chatMessages: [
          {
            content: "智能体生成完成：保持花瓶主体，生成白底电商主图",
            contextType: "generated-image",
            generatedFilePath: generatedPath,
            id: "msg-generated-1",
            role: "context"
          }
        ],
        chatStatus: "idle",
        fileName: "生成-flower.jpg",
        filePath: generatedPath,
        generatedFilePath: generatedPath,
        generatedFilePaths: [generatedPath],
        generationMode: "edit",
        id: generatedSessionId,
        originatedFromGeneration: true,
        showOriginalInList: false,
        status: "completed"
      }
    ]
  };
}

function withRenamedFirstSession(snapshot: ProjectSnapshot): ProjectSnapshot {
  return {
    ...snapshot,
    projectManagerState: markPermissionDecision(
      snapshot.projectManagerState ?? emptyProjectManagerState(),
      "permission-rename-1",
      "allow-once"
    ),
    sessions: snapshot.sessions.map((session) =>
      session.id === "img-1"
        ? {
            ...session,
            fileName: "主图.jpg"
          }
        : session
    )
  };
}

function appendBatchTaskMessage(state: ProjectManagerState, sessionId: string): ProjectManagerState {
  return {
    ...state,
    conversation: {
      ...state.conversation,
      messages: [
        ...state.conversation.messages,
        {
          batchTask: {
            batchTaskId: "batch-e2e-1",
            items: [
              {
                command: makeGenerationPreflightRequest().payload.commands[0],
                displayLabel: "img-1",
                mode: "edit",
                promptSummary: "保持花瓶主体，生成白底电商主图",
                sessionId
              }
            ]
          },
          content: "",
          contextType: "agent-batch-task",
          id: "batch-task-message-1",
          role: "context"
        }
      ]
    }
  };
}

function markPreflightDecision(
  state: ProjectManagerState,
  requestId: string,
  decision: "execute" | "modify" | "cancel"
): ProjectManagerState {
  return {
    ...state,
    conversation: {
      ...state.conversation,
      messages: state.conversation.messages.map((message) =>
        message.preflightRequest?.requestId === requestId ? { ...message, preflightDecision: decision } : message
      )
    }
  };
}

function markPermissionDecision(
  state: ProjectManagerState,
  requestId: string,
  decision: "allow-once" | "allow-session" | "deny"
): ProjectManagerState {
  return {
    ...state,
    conversation: {
      ...state.conversation,
      messages: state.conversation.messages.map((message) =>
        message.permissionRequest?.requestId === requestId ? { ...message, permissionDecision: decision } : message
      )
    }
  };
}

function emptyProjectManagerState(): ProjectManagerState {
  return {
    conversation: { id: "project-manager-e2e", messages: [] },
    plans: []
  };
}

function makeProjectSnapshot(sessions = [makeSession()]): ProjectSnapshot {
  return {
    project: {
      createdAt: "2026-05-28T00:00:00.000Z",
      directory: "/tmp/batchimager-e2e",
      id: "project-e2e",
      imageCount: sessions.length,
      name: "E2E 项目",
      updatedAt: "2026-05-28T00:00:00.000Z"
    },
    projectManagerState: emptyProjectManagerState(),
    selectedSessionId: sessions[0]?.id ?? null,
    sessions
  };
}

function makeSession(overrides: Partial<ProjectSnapshot["sessions"][number]> = {}): ProjectSnapshot["sessions"][number] {
  return {
    chatMessages: [],
    chatStatus: "idle",
    fileName: "flower.jpg",
    filePath: "/tmp/batchimager-e2e/images/original/flower.jpg",
    id: "img-1",
    status: "idle",
    ...overrides
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}
