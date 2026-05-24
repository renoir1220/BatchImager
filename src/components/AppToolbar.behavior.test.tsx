// @vitest-environment jsdom

import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { renderWithBatchImager } from "../test/renderWithBatchImager";
import { AppToolbar } from "./AppToolbar";

function renderToolbar() {
  const onColumnsChange = vi.fn();

  renderWithBatchImager(
    <AppToolbar
      columns={4}
      logCount={2}
      onColumnsChange={onColumnsChange}
      onImport={vi.fn()}
      onNewProject={vi.fn()}
      onOpenProject={vi.fn()}
      onOpenLogs={vi.fn()}
      onOpenSettings={vi.fn()}
    />
  );

  return { onColumnsChange };
}

describe("AppToolbar menu behavior", () => {
  test("does not expose unavailable batch and more actions", () => {
    renderToolbar();

    expect(screen.queryByRole("button", { name: "批量处理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更多操作" })).not.toBeInTheDocument();
  });

  test("changes workspace columns through a slider", () => {
    const { onColumnsChange } = renderToolbar();

    const slider = screen.getByRole("slider", { name: "列数" });
    expect(slider).toHaveAttribute("min", "2");
    expect(slider).toHaveAttribute("max", "6");
    expect(slider).toHaveValue("4");

    fireEvent.change(slider, { target: { value: "5" } });

    expect(onColumnsChange).toHaveBeenCalledWith(5);
  });

  test("renders logs as an icon count without image status text", () => {
    renderToolbar();

    const logsButton = screen.getByRole("button", { name: "打开日志，2 条" });
    expect(logsButton).toHaveTextContent("2");
    expect(logsButton).not.toHaveTextContent("日志");
    expect(screen.queryByText(/张图片/)).not.toBeInTheDocument();
    expect(screen.queryByText("等待导入")).not.toBeInTheDocument();
  });

  test("renders settings as an icon button", () => {
    renderToolbar();

    expect(screen.getByRole("button", { name: "打开设置" })).toBeInTheDocument();
    expect(screen.queryByText("设置")).not.toBeInTheDocument();
  });
});
