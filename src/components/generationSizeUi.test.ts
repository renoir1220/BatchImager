import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

function readProjectFile(filePath: string): string {
  return readFileSync(resolve(process.cwd(), filePath), "utf8");
}

describe("generation size UI wiring", () => {
  test("batch dialog and session panel share the same generation size control", () => {
    expect(readProjectFile("src/components/BatchDialog.tsx")).toContain("GenerationSizeControl");
    expect(readProjectFile("src/components/SessionPanel.tsx")).toContain("GenerationSizeControl");
  });

  test("batch and chat requests carry an optional selected output size", () => {
    expect(readProjectFile("src/App.tsx")).toContain("outputSize");
    expect(readProjectFile("electron/ipcTypes.ts")).toContain("outputSize?: string");
  });
});
