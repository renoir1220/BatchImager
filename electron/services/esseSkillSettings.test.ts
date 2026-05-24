import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { addEsseSkillPath, loadEsseSkillSettings, saveEsseSkillSettings, setEsseSkillEnabled } from "./esseSkillSettings";

let tempDirectory: string | undefined;

afterEach(async () => {
  if (tempDirectory) {
    await rm(tempDirectory, { force: true, recursive: true });
    tempDirectory = undefined;
  }
});

describe("esseSkillSettings", () => {
  test("loads missing settings as empty defaults", async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-skill-settings-"));

    await expect(loadEsseSkillSettings(path.join(tempDirectory, "settings.json"))).resolves.toEqual({
      disabledSkills: [],
      skillPaths: []
    });
  });

  test("persists normalized skill settings", async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-skill-settings-"));
    const settingsPath = path.join(tempDirectory, "settings.json");

    await saveEsseSkillSettings(settingsPath, {
      disabledSkills: ["xlsx-export", "xlsx-export", ""],
      skillPaths: ["/skills", "/skills"]
    });

    await expect(loadEsseSkillSettings(settingsPath)).resolves.toEqual({
      disabledSkills: ["xlsx-export"],
      skillPaths: ["/skills"]
    });
  });

  test("updates enabled and path state", () => {
    const disabled = setEsseSkillEnabled({ disabledSkills: [], skillPaths: [] }, "xlsx-export", false);
    expect(disabled.disabledSkills).toEqual(["xlsx-export"]);
    expect(setEsseSkillEnabled(disabled, "xlsx-export", true).disabledSkills).toEqual([]);
    expect(addEsseSkillPath(disabled, "/extra").skillPaths).toEqual(["/extra"]);
  });
});
