import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

function readProjectFile(filePath: string): string {
  return readFileSync(resolve(process.cwd(), filePath), "utf8");
}

describe("ImageCell actions", () => {
  test("offers a two-step icon-only delete action inside the image area", () => {
    const imageCell = readProjectFile("src/components/ImageCell.tsx");
    const workspace = readProjectFile("src/components/ImageWorkspace.tsx");
    const styles = readProjectFile("src/styles.css");

    expect(imageCell).toContain("onDelete");
    expect(imageCell).toContain("isDeleteConfirming");
    expect(imageCell).toContain("TrashIcon");
    expect(imageCell).not.toContain("🗑");
    expect(imageCell).toContain("aria-label={isDeleteConfirming ? \"确认删除图片\" : \"删除图片\"}");
    expect(imageCell).toContain("event.stopPropagation()");
    expect(workspace).toContain("onDeleteSession");
    expect(styles).toContain(".image-delete-button");
    expect(styles).toContain(".image-delete-button.confirming");
  });
});
