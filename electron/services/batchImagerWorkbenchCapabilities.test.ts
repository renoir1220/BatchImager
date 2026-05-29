import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  isFirstControlledExtensionCapability,
  listBatchImagerWorkbenchCapabilities
} from "./batchImagerWorkbenchCapabilities";

describe("batchImagerWorkbenchCapabilities", () => {
  test("documents the first BatchImager capability surface for controlled agent extensions", () => {
    const capabilities = listBatchImagerWorkbenchCapabilities();

    expect(capabilities.map((capability) => capability.id)).toEqual([
      "get_project_overview",
      "list_sessions",
      "get_session_records",
      "read_image_metadata",
      "list_reference_images",
      "list_remembered_preferences",
      "scan_unreferenced_files"
    ]);
    expect(capabilities.every((capability) => capability.owner === "BatchImager")).toBe(true);
    expect(capabilities.every((capability) => capability.phase === "first-controlled-extension")).toBe(true);
  });

  test("separates product capabilities from generic file tools", () => {
    expect(isFirstControlledExtensionCapability("list_sessions")).toBe(true);
    expect(isFirstControlledExtensionCapability("read_project_file")).toBe(false);
    expect(isFirstControlledExtensionCapability("bash")).toBe(false);
  });

  test("keeps the human design database aligned with the first capability batch", async () => {
    const designPath = path.join(process.cwd(), "docs", "tools-design.json");
    const design = JSON.parse(await readFile(designPath, "utf8")) as {
      tools: Array<{
        followUp?: { action?: string };
        migration?: { batch?: string; status?: string };
        name: string;
      }>;
    };
    const firstBatch = design.tools
      .filter((tool) => tool.migration?.batch === "first-controlled-extension" && tool.migration.status === "已完成")
      .map((tool) => tool.name);

    expect(firstBatch).toEqual(listBatchImagerWorkbenchCapabilities().map((capability) => capability.id));
    expect(firstBatch).not.toContain("read_project_file");
  });
});
