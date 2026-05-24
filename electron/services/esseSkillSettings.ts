import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface EsseSkillSettings {
  disabledSkills: string[];
  skillPaths: string[];
}

const DEFAULT_ESSE_SKILL_SETTINGS: EsseSkillSettings = {
  disabledSkills: [],
  skillPaths: []
};

export async function loadEsseSkillSettings(settingsPath: string): Promise<EsseSkillSettings> {
  if (!existsSync(settingsPath)) {
    return { ...DEFAULT_ESSE_SKILL_SETTINGS };
  }

  try {
    const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as unknown;
    return normalizeEsseSkillSettings(parsed);
  } catch {
    return { ...DEFAULT_ESSE_SKILL_SETTINGS };
  }
}

export async function saveEsseSkillSettings(settingsPath: string, settings: EsseSkillSettings): Promise<EsseSkillSettings> {
  const normalized = normalizeEsseSkillSettings(settings);
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function setEsseSkillEnabled(settings: EsseSkillSettings, name: string, enabled: boolean): EsseSkillSettings {
  const disabled = new Set(settings.disabledSkills);
  if (enabled) {
    disabled.delete(name);
  } else {
    disabled.add(name);
  }

  return normalizeEsseSkillSettings({
    ...settings,
    disabledSkills: [...disabled]
  });
}

export function addEsseSkillPath(settings: EsseSkillSettings, skillPath: string): EsseSkillSettings {
  return normalizeEsseSkillSettings({
    ...settings,
    skillPaths: [...settings.skillPaths, skillPath]
  });
}

function normalizeEsseSkillSettings(value: unknown): EsseSkillSettings {
  const input = typeof value === "object" && value !== null ? value as Partial<EsseSkillSettings> : {};
  return {
    disabledSkills: uniqueStrings(input.disabledSkills),
    skillPaths: uniqueStrings(input.skillPaths)
  };
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))];
}
