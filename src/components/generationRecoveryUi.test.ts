import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

function readProjectFile(filePath: string): string {
  return readFileSync(resolve(process.cwd(), filePath), "utf8");
}

describe("generation recovery UI", () => {
  test("failed image cells expose an icon-only retry action in the status corner", () => {
    const imageCell = readProjectFile("src/components/ImageCell.tsx");
    const workspace = readProjectFile("src/components/ImageWorkspace.tsx");
    const styles = readProjectFile("src/styles.css");

    expect(imageCell).toContain("onRetry");
    expect(imageCell).toContain("aria-label=\"重试生成\"");
    expect(imageCell).toContain("RetryIcon");
    expect(workspace).toContain("onRetrySession");
    expect(styles).toContain(".status-retry-button");
  });

  test("renderer reports running generation work to the main process for close protection", () => {
    const app = readProjectFile("src/App.tsx");
    const preload = readProjectFile("electron/preload.ts");
    const main = readProjectFile("electron/main.ts");

    expect(app).toContain("runningWorkCount");
    expect(app).toContain("setRunningWorkCount(runningWorkCount)");
    expect(preload).toContain("app:set-running-work-count");
    expect(main).toContain("showRunningWorkCloseDialog");
  });
});
