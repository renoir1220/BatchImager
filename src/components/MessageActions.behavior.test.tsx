// @vitest-environment jsdom

import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderWithBatchImager } from "../test/renderWithBatchImager";
import { MessageActions } from "./MessageActions";

describe("MessageActions behavior", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("turns the copy icon into a completed action icon after copy succeeds", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    renderWithBatchImager(<MessageActions content="复制这条消息" />);

    fireEvent.click(screen.getByRole("button", { name: "复制消息" }));

    expect(writeText).toHaveBeenCalledWith("复制这条消息");
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "复制完成" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1400);
    });

    expect(screen.getByRole("button", { name: "复制消息" })).toBeInTheDocument();
  });
});
