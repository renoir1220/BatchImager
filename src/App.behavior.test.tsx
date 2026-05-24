// @vitest-environment jsdom

import { act, screen, waitFor } from "@testing-library/react";
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

    const imageCell = await screen.findByTitle("双击查看大图");
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

function makeSession() {
  return {
    chatMessages: [],
    chatStatus: "idle" as const,
    fileName: "flower.jpg",
    filePath: "/tmp/batchimager-preview/images/original/flower.jpg",
    id: "img-1",
    status: "idle" as const
  };
}
