import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { AppLogger } from "./appLogger";

export interface InstallSkillFromGitOptions {
  gitUrl: string;
  logger?: AppLogger;
  targetDir: string;
}

export type InstallSkillFromGitResult =
  | { ok: true; skillDirectoryName: string }
  | { ok: false; reason: string };

export async function installSkillFromGit(options: InstallSkillFromGitOptions): Promise<InstallSkillFromGitResult> {
  const gitUrl = options.gitUrl.trim();
  const directoryName = inferSkillDirectoryName(gitUrl);
  if (!directoryName) {
    return { ok: false, reason: "无法从 Git URL 推断 skill 目录名。" };
  }

  const targetDirectory = path.join(options.targetDir, directoryName);
  if (existsSync(targetDirectory)) {
    return { ok: false, reason: `已存在同名 skill：${directoryName}` };
  }

  const cloneResult = await runGitClone(gitUrl, targetDirectory);
  if (!cloneResult.ok) {
    await rm(targetDirectory, { force: true, recursive: true });
    options.logger?.warn("Esse skill git install failed", {
      context: "esse-skills",
      data: { directoryName, gitUrl },
      error: new Error(cloneResult.reason),
      publicMessage: "Skill 安装失败，请检查 Git URL。"
    });
    return cloneResult;
  }

  if (!await containsSkillManifest(targetDirectory)) {
    await rm(targetDirectory, { force: true, recursive: true });
    return { ok: false, reason: "这个仓库里没有找到 SKILL.md。" };
  }

  options.logger?.info("Esse skill installed from git", {
    context: "esse-skills",
    data: { directoryName, gitUrl },
    publicMessage: "Skill 已安装。"
  });
  return { ok: true, skillDirectoryName: directoryName };
}

function inferSkillDirectoryName(gitUrl: string): string | undefined {
  const withoutQuery = gitUrl.split(/[?#]/)[0] ?? "";
  const lastSegment = withoutQuery.replace(/[\\/]+$/, "").split(/[\\/]/).pop()?.replace(/\.git$/i, "");
  const cleaned = lastSegment?.trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || undefined;
}

async function containsSkillManifest(directory: string): Promise<boolean> {
  if (existsSync(path.join(directory, "SKILL.md"))) {
    return true;
  }

  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    if (existsSync(path.join(directory, entry.name, "SKILL.md"))) {
      return true;
    }
  }

  return false;
}

function runGitClone(gitUrl: string, targetDirectory: string): Promise<InstallSkillFromGitResult> {
  return new Promise((resolve) => {
    const child = spawn("git", ["clone", "--depth", "1", gitUrl, targetDirectory], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ ok: false, reason: `无法运行 git：${error.message}` });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, skillDirectoryName: path.basename(targetDirectory) });
        return;
      }

      resolve({ ok: false, reason: stderr.trim() || `git clone 失败，退出码 ${code ?? "unknown"}` });
    });
  });
}
