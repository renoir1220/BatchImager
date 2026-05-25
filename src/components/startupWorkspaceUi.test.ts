// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ProjectListEntry } from "../../electron/ipcTypes";
import { renderWithBatchImager } from "../test/renderWithBatchImager";
import { EmptyWorkspace } from "./EmptyWorkspace";

function readProjectFile(filePath: string): string {
  return readFileSync(resolve(process.cwd(), filePath), "utf8");
}

describe("startup workspace UI", () => {
  test("empty workspace exposes recent projects and blank project action", () => {
    const source = readProjectFile("src/components/EmptyWorkspace.tsx");

    expect(source).toContain("recentProjects");
    expect(source).toContain("onOpenProject");
    expect(source).toContain("onCreateBlankProject");
    expect(source).toContain("onDeleteProject");
    expect(source).toContain("最近项目");
    expect(source).toContain("拖入或导入图片，或");
    expect(source).toContain("新建空项目");
    expect(source).not.toContain("或直接拖入多张图片");
    expect(source).not.toContain("startup-actions");
    expect(source).toContain("Array.from({ length: 4 }");
    expect(source).toContain("recent-project-name");
    expect(source).not.toContain("<strong>{project.summary?.name");
  });

  test("app loads recent projects on startup and auto-creates before importing without an open project", () => {
    const source = readProjectFile("src/App.tsx");
    const mainSource = readProjectFile("electron/main.ts");

    expect(source).toContain("loadRecentProjects");
    expect(source).toContain("ensureProjectForImport");
    expect(source).toContain("selectRecentProjects");
    expect(source).toContain("isStartupWorkspace");
    expect(source).toContain("!isStartupWorkspace ? <aside");
    expect(readProjectFile("src/styles.css")).toContain(".app-shell.startup");
    expect(mainSource).toContain("loadWindowState()");
    expect(mainSource).toContain("saveWindowState(mainWindow)");
    expect(mainSource).toContain("screen.getPrimaryDisplay().workArea");
  });

  test("app closes the project list whenever a project snapshot becomes active", () => {
    const source = readProjectFile("src/App.tsx");
    const applySnapshotBody = source.match(/function applyProjectSnapshot\([^)]*snapshot: ProjectSnapshot[\s\S]*?\): void \{(?<body>[\s\S]*?)\n  \}/)
      ?.groups?.body;

    expect(applySnapshotBody).toContain("setIsProjectListOpen(false)");
  });

  test("startup workspace uses a soft command surface instead of a landing page card", () => {
    const styles = readProjectFile("src/styles.css");
    const emptyWorkspace = styles.match(/\.empty-workspace\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    const recentProjectList = styles.match(/\.recent-project-list\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    const recentProjectThumbs = styles.match(/\.recent-project-thumbs\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    const recentProjectRow = styles.match(/\.recent-project-row\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    const recentProjectName = styles.match(/\.recent-project-name\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

    expect(emptyWorkspace).toContain("background: var(--chat-surface)");
    expect(emptyWorkspace).toContain("grid-template-rows: minmax(70px, 0.24fr) auto 24px minmax(0, 1fr)");
    expect(emptyWorkspace).toContain("min-height: 0");
    expect(recentProjectList).toContain("--recent-project-row-height: 166px");
    expect(recentProjectList).toContain("--recent-project-thumb-size: 108px");
    expect(recentProjectList).toContain("grid-template-columns: repeat(auto-fill, minmax(148px, 1fr))");
    expect(recentProjectList).toContain("grid-auto-rows: var(--recent-project-row-height)");
    expect(recentProjectList).toContain("max-height: 100%");
    expect(recentProjectList).toContain("overflow-y: auto");
    expect(recentProjectList).not.toContain("border:");
    expect(recentProjectRow).toContain("border-radius: 8px");
    expect(recentProjectThumbs).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(recentProjectThumbs).toContain("width: var(--recent-project-thumb-size)");
    expect(recentProjectThumbs).toContain("height: var(--recent-project-thumb-size)");
    expect(recentProjectName).toContain("font-size: 14px");
  });

  test("empty workspace creates blank projects and confirms recent project deletion", () => {
    const onCreateBlankProject = vi.fn();
    const onDeleteProject = vi.fn();
    const onOpenProject = vi.fn();
    const project: ProjectListEntry = {
      directory: "/tmp/Project A",
      isExternal: false,
      isUnavailable: false,
      summary: {
        createdAt: "2026-05-24T08:00:00.000Z",
        directory: "/tmp/Project A",
        id: "project-a",
        imageCount: 4,
        name: "Project A",
        previewSourcePaths: [],
        updatedAt: "2026-05-24T08:00:00.000Z"
      },
      thumbnailPaths: ["/tmp/a.png", "/tmp/b.png", "/tmp/c.png", "/tmp/d.png"]
    };

    const { container } = renderWithBatchImager(
      createElement(EmptyWorkspace, {
        hasProject: false,
        isDragging: false,
        recentProjects: [project],
        onCreateBlankProject,
        onDeleteProject,
        onDraggingChange: vi.fn(),
        onDropFiles: vi.fn(),
        onOpenProject
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "新建空项目" }));

    expect(onCreateBlankProject).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll(".recent-project-thumb")).toHaveLength(4);
    expect(container.querySelector("strong")?.textContent).not.toBe("Project A");

    const deleteButton = screen.getByRole("button", { name: "删除项目" });
    fireEvent.click(deleteButton);

    expect(onDeleteProject).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "确认删除项目" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认删除项目" }));

    expect(onDeleteProject).toHaveBeenCalledWith("/tmp/Project A");
    expect(onOpenProject).not.toHaveBeenCalled();
  });
});
