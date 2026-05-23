import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const toolbarSource = readFileSync(resolve(process.cwd(), "src/components/AppToolbar.tsx"), "utf8");
const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarationsFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));

  return match?.groups?.body ?? "";
}

describe("AppToolbar layout", () => {
  it("groups primary actions, view controls, and status controls separately", () => {
    expect(toolbarSource).toContain("MenuBar");
    expect(toolbarSource).toContain("MenuBarGroup");
    expect(toolbarSource).toContain("MenuBarItem");
    expect(toolbarSource).toContain("ProjectMenuButton");
    expect(toolbarSource).toContain("ToolbarSegmentedControl");
    expect(toolbarSource).toContain("toolbar-main-actions");
    expect(toolbarSource).toContain("toolbar-view-actions");
    expect(toolbarSource).toContain("toolbar-status-actions");
    expect(toolbarSource).toContain("toolbar-count");
  });

  it("does not expose unavailable batch or overflow actions", () => {
    expect(toolbarSource).not.toContain("批量处理");
    expect(toolbarSource).not.toContain("更多");
    expect(toolbarSource).not.toContain("onBatchProcess");
    expect(toolbarSource).not.toContain("onClear");
    expect(toolbarSource).not.toContain("MoreMenuButton");
  });

  it("keeps a visible new project button in the top toolbar after a project is open", () => {
    const projectActions = toolbarSource.match(/<MenuBarGroup className="toolbar-project-actions">(?<body>[\s\S]*?)<\/MenuBarGroup>/)
      ?.groups?.body ?? "";

    expect(projectActions).toContain("<MenuBarItem onClick={onNewProject}>");
    expect(projectActions).toContain("新项目");
    expect(projectActions.indexOf("新项目")).toBeLessThan(projectActions.indexOf("ProjectMenuButton"));
  });

  it("uses lightweight OS26 material only on functional chrome", () => {
    expect(styles).toContain("--os26-glass");
    expect(declarationsFor(".app-toolbar")).toContain("backdrop-filter");
    expect(declarationsFor(".image-workspace")).not.toContain("backdrop-filter");
  });

  it("keeps toolbar buttons quiet with one clear blue primary action", () => {
    expect(declarationsFor(".toolbar-button")).toContain("border-radius: 11px");
    expect(declarationsFor(".toolbar-button.primary")).toContain("background: var(--blue)");
    expect(declarationsFor(".toolbar-button.primary")).not.toContain("linear-gradient");
  });

  it("does not visually offset toolbar controls with a drag spacer", () => {
    const declarations = declarationsFor(".window-drag-region");

    expect(declarations).toContain("width: 0");
    expect(declarations).not.toContain("width: 66px");
  });
});
