import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEsseSkillLoader, type EssePiSkillsSdk } from "./esseSkillLoader";

let tempDirectory: string | undefined;

afterEach(async () => {
  if (tempDirectory) {
    await rm(tempDirectory, { force: true, recursive: true });
    tempDirectory = undefined;
  }
});

describe("createEsseSkillLoader", () => {
  test("loads built-in, global, project, and user path skills", async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-skills-"));
    const builtInDir = path.join(tempDirectory, "esse-skills", "_built-in");
    const agentDir = path.join(tempDirectory, "esse-skills");
    const projectDir = path.join(tempDirectory, "project");
    const userPath = path.join(tempDirectory, "extra-skills");

    await writeSkill(path.join(builtInDir, "xlsx-export"), "xlsx-export", "导出 Excel");
    await writeSkill(path.join(agentDir, "global-skill"), "global-skill", "全局 skill");
    await writeSkill(path.join(projectDir, ".esse", "skills", "project-skill"), "project-skill", "项目 skill");
    await writeSkill(path.join(userPath, "user-skill"), "user-skill", "搜索目录 skill");

    const loader = createEsseSkillLoader({
      agentDir,
      builtInSkillsDir: builtInDir,
      getProjectDirectory: () => projectDir,
      getUserPaths: () => [userPath],
      skillsSdk: createFakeSkillsSdk()
    });

    const result = await loader.reload();

    expect(result.skills.map((skill) => skill.name)).toEqual(["xlsx-export", "global-skill", "project-skill", "user-skill"]);
    expect(loader.formatForPrompt()).toContain("xlsx-export");
    expect(loader.matchSkillByCwd(path.join(userPath, "user-skill", "scripts"))).toMatchObject({ name: "user-skill" });
    expect(loader.matchSkillByCwd(path.join(tempDirectory, "elsewhere"))).toBeUndefined();
  });

  test("filters disabled skills from list and prompt", async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-skills-"));
    const builtInDir = path.join(tempDirectory, "esse-skills", "_built-in");
    const agentDir = path.join(tempDirectory, "esse-skills");
    await writeSkill(path.join(builtInDir, "xlsx-export"), "xlsx-export", "导出 Excel");

    const loader = createEsseSkillLoader({
      agentDir,
      builtInSkillsDir: builtInDir,
      getDisabledSkills: () => ["xlsx-export"],
      skillsSdk: createFakeSkillsSdk()
    });

    await loader.reload();

    expect(loader.list()).toEqual([]);
    expect(loader.formatForPrompt()).not.toContain("xlsx-export");
  });

  test("reports collisions without replacing higher priority skills", async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-skills-"));
    const builtInDir = path.join(tempDirectory, "esse-skills", "_built-in");
    const agentDir = path.join(tempDirectory, "esse-skills");
    await writeSkill(path.join(builtInDir, "same-name"), "same-name", "内置");
    await writeSkill(path.join(agentDir, "same-name-global"), "same-name", "全局");

    const loader = createEsseSkillLoader({ agentDir, builtInSkillsDir: builtInDir, skillsSdk: createFakeSkillsSdk() });
    const result = await loader.reload();

    expect(loader.get("same-name")).toMatchObject({ description: "内置", source: "built-in" });
    expect(result.diagnostics.some((diagnostic) => diagnostic.type === "collision")).toBe(true);
  });
});

async function writeSkill(directory: string, name: string, description: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    "utf8"
  );
}

function createFakeSkillsSdk(): EssePiSkillsSdk {
  return {
    formatSkillsForPrompt: (skills) => skills.map((skill) => `${skill.name}: ${skill.description}`).join("\n"),
    loadSkillsFromDir: ({ dir }) => {
      const fs = require("node:fs") as typeof import("node:fs");
      const found = findSkillFiles(fs, dir);
      return {
        diagnostics: [],
        skills: found.map((filePath) => {
          const content = fs.readFileSync(filePath, "utf8");
          const name = content.match(/name:\s*(.+)/)?.[1]?.trim() ?? path.basename(path.dirname(filePath));
          const description = content.match(/description:\s*(.+)/)?.[1]?.trim() ?? "";
          return {
            baseDir: path.dirname(filePath),
            description,
            disableModelInvocation: false,
            filePath,
            name
          };
        })
      };
    }
  };
}

function findSkillFiles(fs: typeof import("node:fs"), dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const skillFile = path.join(dir, "SKILL.md");
  if (fs.existsSync(skillFile)) {
    return [skillFile];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? findSkillFiles(fs, path.join(dir, entry.name)) : []
  );
}
