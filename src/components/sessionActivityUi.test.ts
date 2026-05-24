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

  test("uses one lightweight agent status line for Esse and image sessions", () => {
    const appSource = readProjectFile("src/App.tsx");
    const sessionPanelSource = readProjectFile("src/components/SessionPanel.tsx");
    const panelSource = readProjectFile("src/components/ProjectPlanPanel.tsx");
    const statusLineSource = readProjectFile("src/components/AgentStatusLine.tsx");
    const styles = readProjectFile("src/styles.css");

    expect(appSource).toContain("getProjectManagerActivityLogs");
    expect(appSource).toContain("activityLogs={projectManagerActivityLogs}");
    expect(panelSource).toContain("<AgentStatusLine");
    expect(sessionPanelSource).toContain("<AgentStatusLine");
    expect(statusLineSource).toContain("agent-status-line");
    expect(statusLineSource).toContain("agent-status-text");
    expect(panelSource).toContain("currentActivityLog");
    expect(sessionPanelSource).toContain("currentActivityLog");
    expect(panelSource).not.toContain("Esse 状态");
    expect(sessionPanelSource).not.toContain("处理进度");
    expect(sessionPanelSource).not.toContain("session-activity");
    expect(sessionPanelSource).not.toContain("formatActivityTime");
    expect(panelSource).not.toContain("formatActivityTime");
    expect(styles).toContain(".agent-status-line");
    expect(styles).toContain("agent-status-shine");
    expect(styles).not.toContain(".agent-status-line {\n  border");
  });

  test("keeps image generation progress as the current lightweight status only", () => {
    const source = readProjectFile("src/components/SessionPanel.tsx");

    expect(source).toContain("activityLogs");
    expect(source).toContain("currentActivityLog");
    expect(source).not.toContain("activityLogs.map");
    expect(source).not.toContain("模型思考中...");
  });
});

describe("session panel resizing UI", () => {
  test("adds a resize separator between the workspace and session panel", () => {
    const appSource = readProjectFile("src/App.tsx");
    const styles = readProjectFile("src/styles.css");

    expect(appSource).toContain("session-resize-handle");
    expect(appSource).toContain("aria-label=\"调整会话栏宽度\"");
    expect(appSource).toContain("--session-panel-width");
    expect(styles).toContain(".session-resize-handle");
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr) 1px var(--session-panel-width");
    expect(styles).toContain("grid-row: 1 / 3");
  });
});
