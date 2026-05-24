// @vitest-environment jsdom

import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { renderWithBatchImager } from "../test/renderWithBatchImager";
import type { ImageSession } from "../types/image";
import { SessionPanel } from "./SessionPanel";

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
