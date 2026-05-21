import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

function readProjectFile(filePath: string): string {
  return readFileSync(resolve(process.cwd(), filePath), "utf8");
}

describe("session activity UI", () => {
  test("passes current session progress logs into the session panel", () => {
    expect(readProjectFile("src/App.tsx")).toContain("getSessionActivityLogs");
    expect(readProjectFile("src/App.tsx")).toContain("activityLogs={selectedSessionActivityLogs}");
  });

  test("renders detailed model and image generation progress in the session panel", () => {
    const source = readProjectFile("src/components/SessionPanel.tsx");

    expect(source).toContain("activityLogs");
    expect(source).toContain("session-activity");
    expect(source).not.toContain("模型思考中...");
  });
});
