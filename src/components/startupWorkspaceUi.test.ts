import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

function readProjectFile(filePath: string): string {
  return readFileSync(resolve(process.cwd(), filePath), "utf8");
}

describe("startup workspace UI", () => {
  test("empty workspace exposes recent projects and import actions", () => {
    const source = readProjectFile("src/components/EmptyWorkspace.tsx");

    expect(source).toContain("recentProjects");
    expect(source).toContain("onOpenProject");
    expect(source).toContain("onImport");
    expect(source).toContain("最近项目");
  });

  test("app loads recent projects on startup and auto-creates before importing without an open project", () => {
    const source = readProjectFile("src/App.tsx");

    expect(source).toContain("loadRecentProjects");
    expect(source).toContain("ensureProjectForImport");
    expect(source).toContain("selectRecentProjects");
  });

  test("app closes the project list whenever a project snapshot becomes active", () => {
    const source = readProjectFile("src/App.tsx");
    const applySnapshotBody = source.match(/function applyProjectSnapshot\(snapshot: ProjectSnapshot\): void \{(?<body>[\s\S]*?)\n  \}/)
      ?.groups?.body;

    expect(applySnapshotBody).toContain("setIsProjectListOpen(false)");
  });

  test("startup workspace uses a soft command surface instead of a landing page card", () => {
    const styles = readProjectFile("src/styles.css");
    const emptyWorkspace = styles.match(/\.empty-workspace\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    const startupActions = styles.match(/\.startup-actions\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

    expect(emptyWorkspace).toContain("background: var(--chat-surface)");
    expect(startupActions).toContain("border-radius: 22px");
  });
});
