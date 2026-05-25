// @vitest-environment jsdom

import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithBatchImager } from "../test/renderWithBatchImager";
import { GenerationSizeControl } from "./GenerationSizeControl";

describe("GenerationSizeControl behavior", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        removeItem: vi.fn((key: string) => {
          storage.delete(key);
        }),
        setItem: vi.fn((key: string, value: string) => {
          storage.set(key, value);
        })
      }
    });
  });

  test("opens from the left icon and selects a resolution ratio preset", () => {
    const handleSelectedValueChange = vi.fn();

    renderWithBatchImager(
      <GenerationSizeControl
        customValue=""
        idPrefix="test"
        label="生成尺寸："
        selectedValue=""
        onCustomValueChange={vi.fn()}
        onSelectedValueChange={handleSelectedValueChange}
      />
    );

    fireEvent.click(screen.getByLabelText("生成尺寸：自动"));
    expect(screen.getByRole("dialog", { name: "选择生成尺寸" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "4K" }));
    expect(handleSelectedValueChange).toHaveBeenLastCalledWith("3840x3840");
    fireEvent.click(screen.getByRole("option", { name: /9:16/ }));

    expect(handleSelectedValueChange).toHaveBeenLastCalledWith("2160x3840");
    expect(storage.get("batchimager:generation-size")).toBe("2160x3840");
    expect(storage.get("batchimager:generation-size-resolution")).toBe("4k");
    expect(storage.get("batchimager:generation-size-ratio")).toBe("9:16");
  });

  test("shows the same ratio choices for every resolution", () => {
    renderWithBatchImager(
      <GenerationSizeControl
        customValue=""
        idPrefix="test"
        label="生成尺寸："
        selectedValue=""
        onCustomValueChange={vi.fn()}
        onSelectedValueChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText("生成尺寸：自动"));
    for (const resolution of ["1K", "2K", "4K"]) {
      fireEvent.click(screen.getByRole("tab", { name: resolution }));
      expect(screen.getByRole("option", { name: /1:1/ })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /3:2/ })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /2:3/ })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /16:9/ })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /9:16/ })).toBeInTheDocument();
    }
  });

  test("restores the last selected size as the default", () => {
    storage.set("batchimager:generation-size", "2048x1152");
    const handleSelectedValueChange = vi.fn();

    renderWithBatchImager(
      <GenerationSizeControl
        customValue=""
        idPrefix="test"
        label="生成尺寸："
        selectedValue=""
        onCustomValueChange={vi.fn()}
        onSelectedValueChange={handleSelectedValueChange}
      />
    );

    expect(handleSelectedValueChange).toHaveBeenCalledWith("2048x1152");
  });
});
