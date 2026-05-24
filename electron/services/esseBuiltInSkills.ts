import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { AppLogger } from "./appLogger";

export interface SyncBuiltInSkillsOptions {
  builtInSource: string;
  logger?: AppLogger;
  userTarget: string;
}

export async function syncBuiltInSkills(options: SyncBuiltInSkillsOptions): Promise<void> {
  if (!existsSync(options.builtInSource)) {
    options.logger?.warn("Built-in skills source directory missing", {
      context: "esse-skills",
      data: { builtInSource: options.builtInSource }
    });
    return;
  }

  await mkdir(options.userTarget, { recursive: true });

  const entries = await readdir(options.builtInSource, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sourceSkillDirectory = path.join(options.builtInSource, entry.name);
    const targetSkillDirectory = path.join(options.userTarget, entry.name);
    const sourceVersion = await readPackageVersion(sourceSkillDirectory);
    const targetVersion = await readPackageVersion(targetSkillDirectory);

    if (existsSync(targetSkillDirectory) && sourceVersion && sourceVersion === targetVersion) {
      continue;
    }

    await rm(targetSkillDirectory, { force: true, recursive: true });
    await cp(sourceSkillDirectory, targetSkillDirectory, { recursive: true });
    options.logger?.info("Built-in skill synced", {
      context: "esse-skills",
      data: { skillName: entry.name, version: sourceVersion ?? null }
    });
  }
}

async function readPackageVersion(skillDirectory: string): Promise<string | undefined> {
  const packagePath = path.join(skillDirectory, "package.json");
  if (!existsSync(packagePath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(await readFile(packagePath, "utf8")) as unknown;
    if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string") {
      return parsed.version;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
