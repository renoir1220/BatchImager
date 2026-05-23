// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { renderWithBatchImager } from "../test/renderWithBatchImager";
import { BatchDialog } from "./BatchDialog";
import { ImagePreviewDialog } from "./ImagePreviewDialog";
import { ProjectListDialog } from "./ProjectListDialog";

describe("BatchDialog behavior", () => {
  test("closes from the Escape key", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderWithBatchImager(<BatchDialog imageCount={2} onClose={onClose} onGenerate={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "批量处理" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ProjectListDialog behavior", () => {
  test("closes from the Escape key", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderWithBatchImager(
      <ProjectListDialog
        isLoading={false}
        projects={[]}
        onAddDirectory={vi.fn()}
        onClose={onClose}
        onOpenProject={vi.fn()}
        onRefresh={vi.fn()}
        onRenameProject={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "打开项目" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ImagePreviewDialog behavior", () => {
  test("closes from the Escape key", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderWithBatchImager(
      <ImagePreviewDialog
        images={[{ label: "样图", path: "C:/tmp/sample.png" }]}
        title="图片预览"
        onClose={onClose}
      />
    );

    expect(screen.getByRole("dialog", { name: "图片预览" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("offers zoom, fit, and fullscreen controls", () => {
    renderWithBatchImager(
      <ImagePreviewDialog
        images={[{ label: "样图", path: "C:/tmp/sample.png" }]}
        title="图片预览"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "放大" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "缩小" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "适应窗口" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全屏查看" })).toBeInTheDocument();
  });
});
