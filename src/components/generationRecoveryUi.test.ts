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

  test("renderer can cancel active generation or agent operations", () => {
    const app = readProjectFile("src/App.tsx");
    const preload = readProjectFile("electron/preload.ts");
    const main = readProjectFile("electron/main.ts");

    expect(app).toContain("operationId");
    expect(app).toContain("cancelOperation");
    expect(preload).toContain("app:cancel-operation");
    expect(main).toContain("activeOperationControllers");
    expect(main).toContain("withCancelableOperation");
  });

  test("renderer can cancel Esse batch task items through main-process registry IPC", () => {
    const preload = readProjectFile("electron/preload.ts");
    const main = readProjectFile("electron/main.ts");

    expect(preload).toContain("cancelEsseBatchTaskItem");
    expect(preload).toContain("esse:batch-task-cancel-item");
    expect(preload).toContain("cancelEsseBatchTaskAll");
    expect(preload).toContain("esse:batch-task-cancel-all");
    expect(preload).toContain("retryEsseBatchTaskItem");
    expect(preload).toContain("esse:batch-task-retry-item");
    expect(preload).toContain("retryEsseBatchTaskFailed");
    expect(preload).toContain("esse:batch-task-retry-failed");
    expect(main).toContain("esseBatchTaskRegistry.cancelItem");
    expect(main).toContain("esseBatchTaskRegistry.cancelAll");
    expect(main).toContain("retryEsseBatchTaskItem");
  });

  test("macOS red close exits the app instead of leaving it running without windows", () => {
    const main = readProjectFile("electron/main.ts");
    const windowAllClosedHandler = main.match(/app\.on\("window-all-closed", \(\) => \{(?<body>[\s\S]*?)\n\}\);/)?.groups?.body ?? "";

    expect(windowAllClosedHandler).toContain("app.quit()");
    expect(windowAllClosedHandler).not.toContain('process.platform !== "darwin"');
  });
});
