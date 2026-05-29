// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, test, vi } from "vitest";
import {
  InlineReferenceComposer,
  type InlineComposerSnapshot,
  type InlineReferenceComposerHandle
} from "./InlineReferenceComposer";

describe("InlineReferenceComposer", () => {
  test("inserts clicked references at the saved caret position inside prose", () => {
    const snapshots: InlineComposerSnapshot[] = [];
    const ref = createRef<InlineReferenceComposerHandle>();
    render(
      <InlineReferenceComposer
        placeholder="输入"
        ref={ref}
        onChange={(snapshot) => snapshots.push(snapshot)}
        onOpenReference={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const editor = screen.getByRole("textbox", { name: "智能体输入" });
    editor.textContent = "根据生成商品图";
    const textNode = editor.firstChild;
    if (!textNode) {
      throw new Error("editor text node was not created");
    }
    const range = document.createRange();
    range.setStart(textNode, 2);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.keyUp(editor);

    ref.current?.insertReference({
      fileName: "style.jpg",
      filePath: "/project/style.jpg",
      id: "ref-style",
      previewUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
    });

    expect(snapshots.at(-1)).toEqual({
      referenceImagePaths: ["/project/style.jpg"],
      text: "根据【图片1】 生成商品图"
    });
  });

  test("serializes inline image chips in dragged visual order", () => {
    const snapshots: InlineComposerSnapshot[] = [];
    const ref = createRef<InlineReferenceComposerHandle>();
    render(
      <InlineReferenceComposer
        placeholder="输入"
        ref={ref}
        onChange={(snapshot) => snapshots.push(snapshot)}
        onOpenReference={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    ref.current?.insertReference({
      fileName: "a.jpg",
      filePath: "/project/a.jpg",
      id: "ref-a",
      previewUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
    });
    ref.current?.insertReference({
      fileName: "b.jpg",
      filePath: "/project/b.jpg",
      id: "ref-b",
      previewUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
    });

    const editor = screen.getByRole("textbox", { name: "智能体输入" });
    const chipsBeforeDrag = Array.from(editor.querySelectorAll<HTMLElement>(".inline-reference-chip"));
    const dropRange = document.createRange();
    dropRange.setStart(editor, 0);
    dropRange.collapse(true);
    const originalCaretRangeFromPoint = document.caretRangeFromPoint;
    document.caretRangeFromPoint = vi.fn(() => dropRange);
    const dataTransfer = createDataTransfer();

    fireEvent.dragStart(chipsBeforeDrag[1], { dataTransfer });
    fireEvent.drop(editor, { clientX: 0, clientY: 0, dataTransfer });
    document.caretRangeFromPoint = originalCaretRangeFromPoint;

    const chipsAfterDrag = Array.from(editor.querySelectorAll<HTMLElement>(".inline-reference-chip"));
    expect(chipsAfterDrag.map((chip) => chip.querySelector("img")?.getAttribute("alt"))).toEqual(["b.jpg", "a.jpg"]);
    expect(snapshots.at(-1)).toEqual({
      referenceImagePaths: ["/project/b.jpg", "/project/a.jpg"],
      text: "【图片1】 【图片2】"
    });
  });

  test("restores copied inline reference chips from clipboard html", () => {
    const snapshots: InlineComposerSnapshot[] = [];
    render(
      <InlineReferenceComposer
        placeholder="输入"
        onChange={(snapshot) => snapshots.push(snapshot)}
        onOpenReference={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const editor = screen.getByRole("textbox", { name: "智能体输入" });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) =>
          type === "text/html"
            ? '根据 <span data-batchimager-reference-path="/project/ref-a.jpg" data-batchimager-reference-name="ref-a.jpg">【图片1】</span> 生成细节图'
            : "",
        items: []
      }
    });

    expect(editor.querySelectorAll(".inline-reference-chip")).toHaveLength(1);
    expect(snapshots.at(-1)).toEqual({
      referenceImagePaths: ["/project/ref-a.jpg"],
      text: "根据 【图片1】 生成细节图"
    });
  });

  test("restores copied rendered prompt references from clipboard html", () => {
    const snapshots: InlineComposerSnapshot[] = [];
    render(
      <InlineReferenceComposer
        placeholder="输入"
        onChange={(snapshot) => snapshots.push(snapshot)}
        onOpenReference={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const editor = screen.getByRole("textbox", { name: "智能体输入" });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) =>
          type === "text/html"
            ? [
                "分别生成 ",
                '<button class="inline-message-reference" data-batchimager-reference-path="/project/product-a.jpg" data-batchimager-reference-name="product-a.jpg">',
                '<img src="batchimager-test://product-a" alt="【图片1】"><span>图片1</span>',
                "</button>",
                " 的商品图"
              ].join("")
            : "",
        items: []
      }
    });

    expect(editor.querySelectorAll(".inline-reference-chip")).toHaveLength(1);
    expect(snapshots.at(-1)).toEqual({
      referenceImagePaths: ["/project/product-a.jpg"],
      text: "分别生成 【图片1】 的商品图"
    });
  });
});

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: vi.fn(),
    getData: vi.fn((type: string) => values.get(type) ?? ""),
    setData: vi.fn((type: string, value: string) => {
      values.set(type, value);
    }),
    setDragImage: vi.fn()
  };
}
