// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { AppLogEntry } from "../../electron/ipcTypes";
import { renderWithBatchImager } from "../test/renderWithBatchImager";
import { LogPanel } from "./LogPanel";

describe("LogPanel behavior", () => {
  test("shows the newest log entries first", () => {
    renderWithBatchImager(<LogPanel logs={[log("旧记录", "2026-05-24T08:00:00.000Z"), log("新记录", "2026-05-24T08:01:00.000Z")]} onClose={vi.fn()} />);

    const logListText = screen.getByLabelText("日志列表").textContent ?? "";

    expect(logListText.indexOf("新记录")).toBeLessThan(logListText.indexOf("旧记录"));
  });

  test("closes from the Escape key", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderWithBatchImager(<LogPanel logs={[log("生成完成", "2026-05-24T08:02:00.000Z")]} onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "运行日志" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function log(message: string, timestamp: string): AppLogEntry {
  return {
    level: "info",
    message,
    timestamp
  };
}
