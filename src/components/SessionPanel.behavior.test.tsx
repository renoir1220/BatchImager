// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { renderWithBatchImager } from "../test/renderWithBatchImager";
import type { ImageSession } from "../types/image";
import { SessionPanel } from "./SessionPanel";
import { BATCHIMAGER_IMAGE_DRAG_TYPE } from "./workspaceImageDrag";

describe("SessionPanel behavior", () => {
  test("does not send the message when Enter confirms IME composition", () => {
    const onSendMessage = vi.fn();

    renderWithBatchImager(
      <SessionPanel
        activityLogs={[]}
        selectedSession={makeSession()}
        onCopyImage={vi.fn()}
        onOpenImagePreview={vi.fn()}
        onSendMessage={onSendMessage}
        onStopWork={vi.fn()}
      />
    );

    const composer = screen.getByRole("textbox");

    fireEvent.change(composer, { target: { value: "english" } });
    fireEvent.keyDown(composer, { code: "Enter", isComposing: true, key: "Enter" });

    expect(onSendMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(composer, { code: "Enter", key: "Enter" });

    expect(onSendMessage).toHaveBeenCalledWith("sess_1", "english", undefined, []);
  });

  test("renders a deleted generated-record placeholder instead of a broken image", () => {
    renderWithBatchImager(
      <SessionPanel
        activityLogs={[]}
        selectedSession={makeSession({
          chatMessages: [
            {
              content: "旧生成结果",
              contextType: "generated-image",
              id: "msg-deleted",
              role: "assistant"
            }
          ]
        })}
        onCopyImage={vi.fn()}
        onOpenImagePreview={vi.fn()}
        onSendMessage={vi.fn()}
        onStopWork={vi.fn()}
      />
    );

    expect(screen.getByLabelText("生成记录已删除")).toBeInTheDocument();
    expect(screen.getByText("这条生成记录已从工作区删除")).toBeInTheDocument();
    expect(screen.queryByAltText("生成结果")).not.toBeInTheDocument();
  });

  test("renders dispatched agent task prompt with input and reference images", () => {
    renderWithBatchImager(
      <SessionPanel
        activityLogs={[]}
        selectedSession={makeSession({
          chatMessages: [
            {
              content: "来自智能体：基于图1生成商品图\n参考图：2 张",
              contextType: "agent-task",
              id: "msg-task",
              referenceFilePaths: ["/project/ref-a.jpg", "/project/ref-b.jpg"],
              role: "context",
              sourceFilePath: "/project/source-current.jpg"
            }
          ],
          status: "generating"
        })}
        onCopyImage={vi.fn()}
        onOpenImagePreview={vi.fn()}
        onSendMessage={vi.fn()}
        onStopWork={vi.fn()}
      />
    );

    expect(screen.getByText(/来自智能体：基于图1生成商品图/)).toBeInTheDocument();
    expect(screen.getByText("输入图")).toBeInTheDocument();
    expect(screen.getByText("source-current.jpg")).toBeInTheDocument();
    expect(screen.getByText("参考图")).toBeInTheDocument();
    expect(screen.getByText("2 张")).toBeInTheDocument();
    expect(screen.getByAltText("输入图")).toBeInTheDocument();
    expect(screen.getAllByAltText("参考图")).toHaveLength(2);
  });

  test("accepts dropped workspace images as reference thumbnails instead of composer text", () => {
    renderWithBatchImager(
      <SessionPanel
        activityLogs={[]}
        selectedSession={makeSession()}
        onCopyImage={vi.fn()}
        onOpenImagePreview={vi.fn()}
        onSendMessage={vi.fn()}
        onStopWork={vi.fn()}
      />
    );

    const composer = screen.getByRole("textbox") as HTMLTextAreaElement;
    const imagePath = "/project/images/generated/hero.png";

    fireEvent.drop(composer, {
      dataTransfer: {
        files: [],
        getData: (type: string) =>
          type === BATCHIMAGER_IMAGE_DRAG_TYPE
            ? JSON.stringify({ fileName: "hero.png", imagePath, sessionId: "sess_2" })
            : imagePath,
        types: [BATCHIMAGER_IMAGE_DRAG_TYPE, "text/plain"]
      }
    });

    expect(composer.value).toBe("");
    expect(screen.getByAltText("hero.png")).toBeInTheDocument();
  });

  test("grows the current-image composer until its maximum height", async () => {
    renderWithBatchImager(
      <SessionPanel
        activityLogs={[]}
        selectedSession={makeSession()}
        onCopyImage={vi.fn()}
        onOpenImagePreview={vi.fn()}
        onSendMessage={vi.fn()}
        onStopWork={vi.fn()}
      />
    );

    const composer = screen.getByRole("textbox") as HTMLTextAreaElement;
    Object.defineProperty(composer, "scrollHeight", { configurable: true, value: 220 });
    const getComputedStyleSpy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      maxHeight: "104px"
    } as CSSStyleDeclaration);

    try {
      fireEvent.change(composer, {
        target: {
          value: ["第一行", "第二行", "第三行", "第四行", "第五行"].join("\n")
        }
      });

      await waitFor(() => expect(composer.style.height).toBe("104px"));
      expect(composer.style.overflowY).toBe("auto");
    } finally {
      getComputedStyleSpy.mockRestore();
    }
  });
});

function makeSession(overrides: Partial<ImageSession> = {}): ImageSession {
  return {
    chatMessages: [],
    chatStatus: "idle",
    fileName: "source.jpg",
    filePath: "/project/images/original/source.jpg",
    id: "sess_1",
    status: "idle",
    ...overrides
  };
}
