import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { syncBuiltInSkills } from "./esseBuiltInSkills";

let tempDirectory: string | undefined;

afterEach(async () => {
  if (tempDirectory) {
    await rm(tempDirectory, { force: true, recursive: true });
    tempDirectory = undefined;
  }
});

describe("syncBuiltInSkills", () => {
  test("copies missing built-in skills", async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-builtins-"));
    const source = path.join(tempDirectory, "source");
    const target = path.join(tempDirectory, "target");
    await writeSkill(source, "xlsx-export", "1.0.0", "source");

    await syncBuiltInSkills({ builtInSource: source, userTarget: target });

    await expect(readFile(path.join(target, "xlsx-export", "SKILL.md"), "utf8")).resolves.toContain("source");
  });

  test("leaves matching versions untouched", async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-builtins-"));
    const source = path.join(tempDirectory, "source");
    const target = path.join(tempDirectory, "target");
    await writeSkill(source, "xlsx-export", "1.0.0", "source");
    await writeSkill(target, "xlsx-export", "1.0.0", "user edited");

    await syncBuiltInSkills({ builtInSource: source, userTarget: target });

    await expect(readFile(path.join(target, "xlsx-export", "SKILL.md"), "utf8")).resolves.toContain("user edited");
  });

  test("replaces changed versions and removes node_modules", async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-builtins-"));
    const source = path.join(tempDirectory, "source");
    const target = path.join(tempDirectory, "target");
    await writeSkill(source, "xlsx-export", "2.0.0", "source");
    await writeSkill(target, "xlsx-export", "1.0.0", "old");
    await mkdir(path.join(target, "xlsx-export", "node_modules"), { recursive: true });
    await writeFile(path.join(target, "xlsx-export", "node_modules", "cached.txt"), "cached", "utf8");

    await syncBuiltInSkills({ builtInSource: source, userTarget: target });

    await expect(readFile(path.join(target, "xlsx-export", "SKILL.md"), "utf8")).resolves.toContain("source");
    await expect(readFile(path.join(target, "xlsx-export", "node_modules", "cached.txt"), "utf8")).rejects.toThrow();
  });

  test("ignores a missing source directory", async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-builtins-"));

    await expect(syncBuiltInSkills({
      builtInSource: path.join(tempDirectory, "missing"),
      userTarget: path.join(tempDirectory, "target")
    })).resolves.toBeUndefined();
  });
});

async function writeSkill(root: string, name: string, version: string, body: string): Promise<void> {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ name, version }, null, 2), "utf8");
  await writeFile(path.join(directory, "SKILL.md"), body, "utf8");
}
