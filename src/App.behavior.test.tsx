// @vitest-environment jsdom

import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { ProjectSnapshot } from "../electron/ipcTypes";
import { renderWithBatchImager } from "./test/renderWithBatchImager";
import { App } from "./App";

describe("App image preview behavior", () => {
  test("keeps the image preview open when a project snapshot update follows the opening double click", async () => {
    const user = userEvent.setup();
    let snapshotListener: ((snapshot: ProjectSnapshot) => void) | undefined;
    const snapshot = makeProjectSnapshot();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn()
      }
    });

    renderWithBatchImager(<App />, {
      createProject: vi.fn().mockResolvedValue(makeProjectSnapshot([])),
      getLogs: vi.fn().mockResolvedValue([]),
      importImages: vi.fn().mockResolvedValue(snapshot),
      listProjects: vi.fn().mockResolvedValue([]),
      saveProjectSnapshot: vi.fn().mockImplementation(async () => {
        queueMicrotask(() => snapshotListener?.(snapshot));
        return snapshot;
      }),
      setRunningWorkCount: vi.fn(),
      subscribeEssePreflightRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeLogs: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectSnapshotUpdates: vi.fn().mockImplementation((listener) => {
        snapshotListener = listener;
        return () => undefined;
      }),
      subscribeProjectThumbnailUpdates: vi.fn().mockReturnValue(() => undefined)
    });

    await user.click(screen.getAllByRole("button", { name: "导入图片" })[0]);

    const imageCell = await screen.findByTitle("双击查看大图，右键打开菜单");
    await user.dblClick(imageCell);

    expect(screen.getByRole("dialog", { name: "flower.jpg" })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("dialog", { name: "flower.jpg" })).toBeInTheDocument());
  });

  test("does not persist stale sessions when confirming an Esse preflight request", async () => {
    const user = userEvent.setup();
    let preflightListener: Parameters<NonNullable<Window["batchImager"]>["subscribeEssePreflightRequests"]>[0] | undefined;
    const snapshot = makeProjectSnapshot();
    const saveProjectSnapshot = vi.fn().mockResolvedValue(snapshot);
    const respondEssePreflight = vi.fn().mockResolvedValue({ accepted: true });

    renderWithBatchImager(<App />, {
      createProject: vi.fn().mockResolvedValue(makeProjectSnapshot([])),
      getLogs: vi.fn().mockResolvedValue([]),
      importImages: vi.fn().mockResolvedValue(snapshot),
      listProjects: vi.fn().mockResolvedValue([]),
      respondEssePreflight,
      saveProjectSnapshot,
      setRunningWorkCount: vi.fn(),
      subscribeEssePermissionRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePreflightRequests: vi.fn().mockImplementation((listener) => {
        preflightListener = listener;
        return () => undefined;
      }),
      subscribeLogs: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectSnapshotUpdates: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectThumbnailUpdates: vi.fn().mockReturnValue(() => undefined)
    });

    await user.click(screen.getAllByRole("button", { name: "导入图片" })[0]);

    act(() => {
      preflightListener?.({
        payload: {
          commands: [
            {
              displayLabel: "img-1",
              mode: "edit",
              prompt: "改成温馨室内家居商品图",
              target: { sessionId: "img-1", type: "existing" }
            }
          ],
          estimatedApiCalls: 1,
          tool: "generate_image"
        },
        requestId: "preflight-1"
      });
    });
    await waitFor(() => expect(saveProjectSnapshot).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("tab", { name: "Esse" }));
    await user.click(screen.getByRole("button", { name: "执行" }));

    await waitFor(() => expect(respondEssePreflight).toHaveBeenCalledWith({ decision: "execute", requestId: "preflight-1" }));
    expect(saveProjectSnapshot).toHaveBeenCalledTimes(1);
  });

  test("marks the current image as generating when the chat image tool starts", async () => {
    const user = userEvent.setup();
    let generationStartedListener:
      | Parameters<NonNullable<Window["batchImager"]>["subscribeChatImageGenerationStarted"]>[0]
      | undefined;
    const snapshot = makeProjectSnapshot();
    const saveProjectSnapshot = vi.fn().mockResolvedValue(snapshot);

    renderWithBatchImager(<App />, {
      createProject: vi.fn().mockResolvedValue(makeProjectSnapshot([])),
      getLogs: vi.fn().mockResolvedValue([]),
      importImages: vi.fn().mockResolvedValue(snapshot),
      listProjects: vi.fn().mockResolvedValue([]),
      saveProjectSnapshot,
      setRunningWorkCount: vi.fn(),
      subscribeChatImageGenerationStarted: vi.fn().mockImplementation((listener) => {
        generationStartedListener = listener;
        return () => undefined;
      }),
      subscribeEssePermissionRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePreflightRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeLogs: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectSnapshotUpdates: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectThumbnailUpdates: vi.fn().mockReturnValue(() => undefined)
    });

    await user.click(screen.getAllByRole("button", { name: "导入图片" })[0]);

    act(() => {
      generationStartedListener?.({
        prompt: "重新生成叶片细节",
        sessionId: "img-1",
        sourceImagePath: "/tmp/batchimager-preview/images/original/flower.jpg"
      });
    });

    await waitFor(() =>
      expect(saveProjectSnapshot).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sessions: [expect.objectContaining({ id: "img-1", lastPrompt: "重新生成叶片细节", status: "generating" })]
        })
      )
    );
  });

  test("single-clicking a workspace image queues it as an inline Esse reference", async () => {
    const user = userEvent.setup();
    const snapshot = makeProjectSnapshot();

    renderWithBatchImager(<App />, {
      createProject: vi.fn().mockResolvedValue(makeProjectSnapshot([])),
      getLogs: vi.fn().mockResolvedValue([]),
      importImages: vi.fn().mockResolvedValue(snapshot),
      listProjects: vi.fn().mockResolvedValue([]),
      saveProjectSnapshot: vi.fn().mockResolvedValue(snapshot),
      setRunningWorkCount: vi.fn(),
      subscribeChatImageGenerationStarted: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePermissionRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePreflightRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeLogs: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectSnapshotUpdates: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectThumbnailUpdates: vi.fn().mockReturnValue(() => undefined)
    });

    await user.click(screen.getAllByRole("button", { name: "导入图片" })[0]);
    await user.click(await screen.findByAltText("flower.jpg"));

    expect(screen.getByRole("tab", { name: "Esse" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Esse 输入" })).toHaveTextContent("图片1"));
  });

  test("ctrl-clicking a workspace image selects it for the current image chat", async () => {
    const user = userEvent.setup();
    const snapshot = makeProjectSnapshot([
      makeSession({ id: "img-1", fileName: "flower.jpg", filePath: "/tmp/batchimager-preview/images/original/flower.jpg" }),
      makeSession({ id: "img-2", fileName: "lamp.jpg", filePath: "/tmp/batchimager-preview/images/original/lamp.jpg" })
    ]);
    const saveProjectSnapshot = vi.fn().mockResolvedValue(snapshot);

    renderWithBatchImager(<App />, {
      createProject: vi.fn().mockResolvedValue(makeProjectSnapshot([])),
      getLogs: vi.fn().mockResolvedValue([]),
      importImages: vi.fn().mockResolvedValue(snapshot),
      listProjects: vi.fn().mockResolvedValue([]),
      saveProjectSnapshot,
      setRunningWorkCount: vi.fn(),
      subscribeChatImageGenerationStarted: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePermissionRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePreflightRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeLogs: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectSnapshotUpdates: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectThumbnailUpdates: vi.fn().mockReturnValue(() => undefined)
    });

    await user.click(screen.getAllByRole("button", { name: "导入图片" })[0]);
    fireEvent.click(await screen.findByAltText("lamp.jpg"), { ctrlKey: true });

    expect(screen.getByRole("tab", { name: "当前图片" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(saveProjectSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ selectedSessionId: "img-2" }))
    );
  });

  test("mac ctrl-click selects the image before the context menu can consume the click", async () => {
    const user = userEvent.setup();
    const snapshot = makeProjectSnapshot([
      makeSession({ id: "img-1", fileName: "flower.jpg", filePath: "/tmp/batchimager-preview/images/original/flower.jpg" }),
      makeSession({ id: "img-2", fileName: "lamp.jpg", filePath: "/tmp/batchimager-preview/images/original/lamp.jpg" })
    ]);
    const saveProjectSnapshot = vi.fn().mockResolvedValue(snapshot);

    renderWithBatchImager(<App />, {
      createProject: vi.fn().mockResolvedValue(makeProjectSnapshot([])),
      getLogs: vi.fn().mockResolvedValue([]),
      importImages: vi.fn().mockResolvedValue(snapshot),
      listProjects: vi.fn().mockResolvedValue([]),
      saveProjectSnapshot,
      setRunningWorkCount: vi.fn(),
      subscribeChatImageGenerationStarted: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePermissionRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePreflightRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeLogs: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectSnapshotUpdates: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectThumbnailUpdates: vi.fn().mockReturnValue(() => undefined)
    });

    await user.click(screen.getAllByRole("button", { name: "导入图片" })[0]);
    const image = await screen.findByAltText("lamp.jpg");
    fireEvent.mouseDown(image, { button: 0, ctrlKey: true });
    fireEvent.contextMenu(image, { ctrlKey: true });

    expect(screen.getByRole("tab", { name: "当前图片" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(saveProjectSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ selectedSessionId: "img-2" }))
    );
  });

  test("toolbar opens the selected workspace image in Finder", async () => {
    const user = userEvent.setup();
    const snapshot = makeProjectSnapshot([
      makeSession({ id: "img-1", fileName: "flower.jpg", filePath: "/tmp/batchimager-preview/images/original/flower.jpg" }),
      makeSession({ id: "img-2", fileName: "lamp.jpg", filePath: "/tmp/batchimager-preview/images/original/lamp.jpg" })
    ]);
    const showFileInFolder = vi.fn().mockResolvedValue({ ok: true });

    renderWithBatchImager(<App />, {
      createProject: vi.fn().mockResolvedValue(makeProjectSnapshot([])),
      getLogs: vi.fn().mockResolvedValue([]),
      importImages: vi.fn().mockResolvedValue(snapshot),
      listProjects: vi.fn().mockResolvedValue([]),
      saveProjectSnapshot: vi.fn().mockResolvedValue(snapshot),
      setRunningWorkCount: vi.fn(),
      showFileInFolder,
      subscribeChatImageGenerationStarted: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePermissionRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePreflightRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeLogs: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectSnapshotUpdates: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectThumbnailUpdates: vi.fn().mockReturnValue(() => undefined)
    });

    await user.click(screen.getAllByRole("button", { name: "导入图片" })[0]);
    fireEvent.mouseDown(await screen.findByAltText("lamp.jpg"), { button: 0, ctrlKey: true });
    fireEvent.contextMenu(screen.getByAltText("lamp.jpg"), { ctrlKey: true });
    await user.click(screen.getByRole("button", { name: "在文件夹中打开" }));

    await waitFor(() => expect(showFileInFolder).toHaveBeenCalledWith({ filePath: "/tmp/batchimager-preview/images/original/lamp.jpg" }));
  });

  test("workspace image context menu copies, exports, and deletes the clicked image", async () => {
    const user = userEvent.setup();
    const snapshot = makeProjectSnapshot([
      makeSession({ id: "img-1", fileName: "flower.jpg", filePath: "/tmp/batchimager-preview/images/original/flower.jpg" }),
      makeSession({ id: "img-2", fileName: "lamp.jpg", filePath: "/tmp/batchimager-preview/images/original/lamp.jpg" })
    ]);
    const copyImageToClipboard = vi.fn().mockResolvedValue({ ok: true });
    const exportImages = vi.fn().mockResolvedValue({ outputPath: "/Users/test/Desktop/lamp.jpg.zip" });
    const showFileInFolder = vi.fn().mockResolvedValue({ ok: true });

    renderWithBatchImager(<App />, {
      copyImageToClipboard,
      createProject: vi.fn().mockResolvedValue(makeProjectSnapshot([])),
      exportImages,
      getLogs: vi.fn().mockResolvedValue([]),
      importImages: vi.fn().mockResolvedValue(snapshot),
      listProjects: vi.fn().mockResolvedValue([]),
      saveProjectSnapshot: vi.fn().mockResolvedValue(snapshot),
      setRunningWorkCount: vi.fn(),
      showFileInFolder,
      subscribeChatImageGenerationStarted: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePermissionRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePreflightRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeLogs: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectSnapshotUpdates: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectThumbnailUpdates: vi.fn().mockReturnValue(() => undefined)
    });

    await user.click(screen.getAllByRole("button", { name: "导入图片" })[0]);
    const lampImage = await screen.findByAltText("lamp.jpg");

    fireEvent.contextMenu(lampImage, { clientX: 180, clientY: 120 });
    await user.click(screen.getByRole("menuitem", { name: "复制到剪贴板" }));
    expect(copyImageToClipboard).toHaveBeenCalledWith({ imagePath: "/tmp/batchimager-preview/images/original/lamp.jpg" });

    fireEvent.contextMenu(lampImage, { clientX: 180, clientY: 120 });
    await user.click(screen.getByRole("menuitem", { name: "导出" }));
    await waitFor(() =>
      expect(exportImages).toHaveBeenCalledWith({
        fileName: "lamp.jpg.zip",
        imagePaths: ["/tmp/batchimager-preview/images/original/lamp.jpg"]
      })
    );
    expect(showFileInFolder).toHaveBeenCalledWith({ filePath: "/Users/test/Desktop/lamp.jpg.zip" });

    fireEvent.contextMenu(lampImage, { clientX: 180, clientY: 120 });
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(screen.queryByAltText("lamp.jpg")).not.toBeInTheDocument();
  });

  test("current image chat edits the selected source cell by default", async () => {
    const user = userEvent.setup();
    const snapshot = makeProjectSnapshot();
    const saveProjectSnapshot = vi.fn().mockImplementation(async (request) => ({ ...snapshot, ...request }));
    const sendChatMessage = vi.fn().mockResolvedValue({
      assistantMessage: "已改成白底商品图。",
      generationMode: "edit",
      generatedImagePath: "/tmp/batchimager-preview/images/generated/product-white.png",
      sessionId: "img-1"
    });

    renderWithBatchImager(<App />, {
      createProject: vi.fn().mockResolvedValue(makeProjectSnapshot([])),
      getLogs: vi.fn().mockResolvedValue([]),
      importImages: vi.fn().mockResolvedValue(snapshot),
      listProjects: vi.fn().mockResolvedValue([]),
      saveProjectSnapshot,
      sendChatMessage,
      setRunningWorkCount: vi.fn(),
      subscribeChatImageGenerationStarted: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePermissionRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePreflightRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeLogs: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectSnapshotUpdates: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectThumbnailUpdates: vi.fn().mockReturnValue(() => undefined)
    });

    await user.click(screen.getAllByRole("button", { name: "导入图片" })[0]);
    await user.type(await screen.findByRole("textbox"), "换成白底商品图");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      const lastRequest = saveProjectSnapshot.mock.calls.at(-1)?.[0];
      expect(lastRequest?.sessions).toHaveLength(1);
      expect(lastRequest?.sessions[0]).toMatchObject({
        generatedFilePath: "/tmp/batchimager-preview/images/generated/product-white.png",
        id: "img-1",
        status: "completed"
      });
    });
    expect(sendChatMessage).toHaveBeenCalledWith(expect.objectContaining({ generationMode: "edit" }));
  });

  test("current image chat adds a new workspace image only when the tool explicitly generated a new image", async () => {
    const user = userEvent.setup();
    const snapshot = makeProjectSnapshot();
    const saveProjectSnapshot = vi.fn().mockImplementation(async (request) => ({ ...snapshot, ...request }));

    renderWithBatchImager(<App />, {
      createProject: vi.fn().mockResolvedValue(makeProjectSnapshot([])),
      getLogs: vi.fn().mockResolvedValue([]),
      importImages: vi.fn().mockResolvedValue(snapshot),
      listProjects: vi.fn().mockResolvedValue([]),
      saveProjectSnapshot,
      sendChatMessage: vi.fn().mockResolvedValue({
        assistantMessage: "已生成新的白底商品图。",
        generationMode: "generate",
        generatedImagePath: "/tmp/batchimager-preview/images/generated/product-white.png",
        sessionId: "img-1"
      }),
      setRunningWorkCount: vi.fn(),
      subscribeChatImageGenerationStarted: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePermissionRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePreflightRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeLogs: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectSnapshotUpdates: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectThumbnailUpdates: vi.fn().mockReturnValue(() => undefined)
    });

    await user.click(screen.getAllByRole("button", { name: "导入图片" })[0]);
    await user.type(await screen.findByRole("textbox"), "新生成一张白底商品图");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      const lastRequest = saveProjectSnapshot.mock.calls.at(-1)?.[0];
      expect(lastRequest?.sessions).toHaveLength(2);
    });
    const lastRequest = saveProjectSnapshot.mock.calls.at(-1)?.[0];
    expect(lastRequest.sessions[0].id).toBe("img-1");
    expect(lastRequest.sessions[0].generatedFilePath).toBeUndefined();
    expect(lastRequest.sessions[1]).toMatchObject({
      filePath: "/tmp/batchimager-preview/images/generated/product-white.png",
      originatedFromGeneration: true,
      status: "completed"
    });
  });

  test("streams Esse assistant text into the project conversation before the final response", async () => {
    const user = userEvent.setup();
    let esseUpdateListener:
      | Parameters<NonNullable<Window["batchImager"]>["subscribeEsseAssistantMessageUpdates"]>[0]
      | undefined;
    let esseOperationId = "";
    let resolveEsseMessage: ((value: { reply: string }) => void) | undefined;
    const snapshot = makeProjectSnapshot();

    renderWithBatchImager(<App />, {
      createProject: vi.fn().mockResolvedValue(makeProjectSnapshot([])),
      getLogs: vi.fn().mockResolvedValue([]),
      importImages: vi.fn().mockResolvedValue(snapshot),
      listProjects: vi.fn().mockResolvedValue([]),
      saveProjectSnapshot: vi.fn().mockResolvedValue(snapshot),
      sendEsseMessage: vi.fn().mockImplementation(
        (request: { operationId?: string }) => {
          esseOperationId = request.operationId ?? "";
          return new Promise((resolve) => {
            resolveEsseMessage = resolve;
          });
        }
      ),
      setRunningWorkCount: vi.fn(),
      subscribeChatImageGenerationStarted: vi.fn().mockReturnValue(() => undefined),
      subscribeEsseAssistantMessageUpdates: vi.fn().mockImplementation((listener) => {
        esseUpdateListener = listener;
        return () => undefined;
      }),
      subscribeEssePermissionRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeEssePreflightRequests: vi.fn().mockReturnValue(() => undefined),
      subscribeLogs: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectSnapshotUpdates: vi.fn().mockReturnValue(() => undefined),
      subscribeProjectThumbnailUpdates: vi.fn().mockReturnValue(() => undefined)
    });

    await user.click(screen.getAllByRole("button", { name: "导入图片" })[0]);
    await user.click(screen.getByRole("tab", { name: "Esse" }));
    await user.type(screen.getByRole("textbox", { name: "Esse 输入" }), "帮我做商品图");
    await user.click(screen.getByRole("button", { name: "发送" }));

    act(() => {
      esseUpdateListener?.({ content: "我先拆成两个任务", operationId: esseOperationId });
    });

    expect(await screen.findByText("我先拆成两个任务")).toBeInTheDocument();

    act(() => {
      resolveEsseMessage?.({ reply: "我先拆成两个任务，已输出确认卡。" });
    });

    expect(await screen.findByText("我先拆成两个任务，已输出确认卡。")).toBeInTheDocument();
    expect(screen.queryByText("我先拆成两个任务")).not.toBeInTheDocument();
  });

});

function makeProjectSnapshot(sessions = [makeSession()]): ProjectSnapshot {
  return {
    project: {
      createdAt: "2026-05-24T00:00:00.000Z",
      directory: "/tmp/batchimager-preview",
      id: "project-1",
      imageCount: sessions.length,
      name: "预览项目",
      updatedAt: "2026-05-24T00:00:00.000Z"
    },
    projectManagerState: {
      conversation: { id: "project-manager-1", messages: [] },
      plans: []
    },
    selectedSessionId: sessions[0]?.id ?? null,
    sessions
  };
}

function makeSession(overrides: Partial<ReturnType<typeof makeSessionBase>> = {}) {
  return {
    ...makeSessionBase(),
    ...overrides
  };
}

function makeSessionBase() {
  return {
    chatMessages: [],
    chatStatus: "idle" as const,
    fileName: "flower.jpg",
    filePath: "/tmp/batchimager-preview/images/original/flower.jpg",
    id: "img-1",
    status: "idle" as const
  };
}
