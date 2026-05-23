// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { renderWithBatchImager } from "../test/renderWithBatchImager";
import { AppToolbar } from "./AppToolbar";

function renderToolbar() {
  renderWithBatchImager(
    <AppToolbar
      columns={4}
      imageCount={2}
      onColumnsChange={vi.fn()}
      onImport={vi.fn()}
      onNewProject={vi.fn()}
      onOpenProject={vi.fn()}
      onOpenLogs={vi.fn()}
    />
  );
}

describe("AppToolbar menu behavior", () => {
  test("does not expose unavailable batch and more actions", () => {
    renderToolbar();

    expect(screen.queryByRole("button", { name: "批量处理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更多操作" })).not.toBeInTheDocument();
  });
});
