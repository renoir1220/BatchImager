import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { installSkillFromGit } from "./esseSkillInstaller";

let tempDirectory: string;

beforeEach(async () => {
  tempDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-skill-installer-"));
});

afterEach(async () => {
  await import("node:fs/promises").then(({ rm }) => rm(tempDirectory, { force: true, recursive: true }));
});

describe("installSkillFromGit", () => {
  test("clones a local skill repository into the target directory", async () => {
    const repo = await createGitRepo("xlsx-export", {
      "SKILL.md": "---\nname: xlsx-export\ndescription: 导出 Excel\n---\n# xlsx-export\n"
    });
    const targetDir = path.join(tempDirectory, "target");
    await mkdir(targetDir);

    const result = await installSkillFromGit({ gitUrl: repo, targetDir });

    expect(result).toEqual({ ok: true, skillDirectoryName: "xlsx-export" });
    await expect(readFile(path.join(targetDir, "xlsx-export", "SKILL.md"), "utf8")).resolves.toContain("导出 Excel");
  });

  test("rejects repositories without SKILL.md and cleans the target", async () => {
    const repo = await createGitRepo("not-a-skill", {
      "README.md": "# no skill\n"
    });
    const targetDir = path.join(tempDirectory, "target");
    await mkdir(targetDir);

    const result = await installSkillFromGit({ gitUrl: repo, targetDir });

    expect(result).toEqual({ ok: false, reason: "这个仓库里没有找到 SKILL.md。" });
    await expect(readFile(path.join(targetDir, "not-a-skill", "README.md"), "utf8")).rejects.toThrow();
  });

  test("rejects duplicate skill directories before cloning", async () => {
    const repo = await createGitRepo("existing-skill", {
      "SKILL.md": "---\nname: existing-skill\ndescription: 已存在\n---\n"
    });
    const targetDir = path.join(tempDirectory, "target");
    await mkdir(path.join(targetDir, "existing-skill"), { recursive: true });

    await expect(installSkillFromGit({ gitUrl: repo, targetDir })).resolves.toEqual({
      ok: false,
      reason: "已存在同名 skill：existing-skill"
    });
  });
});

async function createGitRepo(name: string, files: Record<string, string>): Promise<string> {
  const repo = path.join(tempDirectory, name);
  await mkdir(repo, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(repo, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  await runGit(["init"], repo);
  await runGit(["add", "."], repo);
  await runGit(["-c", "user.name=BatchImager", "-c", "user.email=test@example.invalid", "commit", "-m", "init"], repo);
  return repo;
}

function runGit(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = require("node:child_process").spawn("git", args, { cwd, stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git exited with ${code}`));
      }
    });
  });
}
