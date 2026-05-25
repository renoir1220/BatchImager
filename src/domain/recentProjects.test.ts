import { describe, expect, test } from "vitest";
import type { ProjectListEntry } from "../../electron/ipcTypes";
import { selectRecentProjects } from "./recentProjects";

describe("selectRecentProjects", () => {
  test("keeps all available project entries by default", () => {
    const projects = Array.from({ length: 7 }, (_, index): ProjectListEntry => ({
      directory: `project-${index + 1}`,
      isExternal: false,
      isUnavailable: index === 1,
      thumbnailPaths: []
    }));

    expect(selectRecentProjects(projects).map((project) => project.directory)).toEqual([
      "project-1",
      "project-3",
      "project-4",
      "project-5",
      "project-6",
      "project-7"
    ]);
  });

  test("can still apply an explicit project limit", () => {
    const projects = Array.from({ length: 7 }, (_, index): ProjectListEntry => ({
      directory: `project-${index + 1}`,
      isExternal: false,
      isUnavailable: index === 1,
      thumbnailPaths: []
    }));

    expect(selectRecentProjects(projects, 5).map((project) => project.directory)).toEqual([
      "project-1",
      "project-3",
      "project-4",
      "project-5",
      "project-6"
    ]);
  });
});
