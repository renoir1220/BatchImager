import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { normalizePathForComparison } from "./pathUtils";

interface PiSkill {
  baseDir: string;
  description: string;
  disableModelInvocation: boolean;
  filePath: string;
  name: string;
}

interface PiResourceDiagnostic {
  collision?: {
    loserPath: string;
    loserSource?: string;
    name: string;
    resourceType: "extension" | "skill" | "prompt" | "theme";
    winnerPath: string;
    winnerSource?: string;
  };
  message: string;
  path?: string;
  type: "warning" | "error" | "collision";
}

interface PiLoadSkillsResult {
  diagnostics: PiResourceDiagnostic[];
  skills: PiSkill[];
}

export type EsseSkillSource = "built-in" | "global" | "project" | "user-path";

export interface EsseSkillRecord {
  baseDir: string;
  description: string;
  disableModelInvocation: boolean;
  filePath: string;
  name: string;
  source: EsseSkillSource;
  sourceLabel: string;
}

export type EsseSkillDiagnostic = PiResourceDiagnostic;

export interface EsseSkillLoadResult {
  diagnostics: EsseSkillDiagnostic[];
  skills: EsseSkillRecord[];
}

export interface EsseSkillLoader {
  formatForPrompt: () => string;
  get: (name: string) => EsseSkillRecord | undefined;
  list: () => EsseSkillRecord[];
  matchSkillByCwd: (cwd: string) => EsseSkillRecord | undefined;
  reload: () => Promise<EsseSkillLoadResult>;
}

interface CreateEsseSkillLoaderOptions {
  agentDir: string;
  builtInSkillsDir: string;
  getDisabledSkills?: () => string[];
  getProjectDirectory?: () => string | undefined;
  getUserPaths?: () => string[];
  skillsSdk?: EssePiSkillsSdk;
}

interface LoadedEsseSkillRecord extends EsseSkillRecord {
  raw: PiSkill;
}

export interface EssePiSkillsSdk {
  formatSkillsForPrompt: (skills: PiSkill[]) => string;
  loadSkillsFromDir: (options: { dir: string; source: string }) => PiLoadSkillsResult;
}

export function createEsseSkillLoader(options: CreateEsseSkillLoaderOptions): EsseSkillLoader {
  let loadedSkills: LoadedEsseSkillRecord[] = [];
  let diagnostics: EsseSkillDiagnostic[] = [];
  let promptText = "";

  return {
    formatForPrompt: () => promptText,
    get: (name) => toPublicSkill(loadedSkills.find((skill) => skill.name === name)),
    list: () => loadedSkills.map(toPublicSkill),
    matchSkillByCwd: (cwd) => matchSkillByCwd(loadedSkills, cwd),
    reload: async () => {
      const result = await loadEsseSkills(options, options.skillsSdk);
      loadedSkills = result.loadedSkills;
      diagnostics = result.diagnostics;
      promptText = formatLoadedSkillsForPrompt(loadedSkills, result.formatSkillsForPrompt);

      return {
        diagnostics,
        skills: loadedSkills.map(toPublicSkill)
      };
    }
  };
}

async function loadEsseSkills(options: CreateEsseSkillLoaderOptions, injectedSdk?: EssePiSkillsSdk): Promise<{
  diagnostics: EsseSkillDiagnostic[];
  formatSkillsForPrompt: EssePiSkillsSdk["formatSkillsForPrompt"];
  loadedSkills: LoadedEsseSkillRecord[];
}> {
  const sdk = injectedSdk ?? await loadPiSkillsSdk();
  const loaded: LoadedEsseSkillRecord[] = [];
  const diagnostics: EsseSkillDiagnostic[] = [];

  const sourceDirs = await collectSkillSourceDirs(options);
  for (const sourceDir of sourceDirs) {
    if (!existsSync(sourceDir.dir)) {
      continue;
    }

    const result = sdk.loadSkillsFromDir({ dir: sourceDir.dir, source: sourceDir.sourceLabel });
    diagnostics.push(...result.diagnostics);
    loaded.push(
      ...result.skills.map((skill) => ({
        ...toEsseSkillRecord(skill, sourceDir.source, sourceDir.sourceLabel),
        raw: skill
      }))
    );
  }

  const disabledNames = new Set((options.getDisabledSkills?.() ?? []).map((name) => name.trim()).filter(Boolean));
  const byName = new Map<string, LoadedEsseSkillRecord>();

  for (const skill of loaded) {
    if (disabledNames.has(skill.name)) {
      continue;
    }

    const existing = byName.get(skill.name);
    if (existing) {
      diagnostics.push({
        type: "collision",
        message: `Skill "${skill.name}" from ${skill.sourceLabel} was ignored because ${existing.sourceLabel} has priority.`,
        collision: {
          loserPath: skill.filePath,
          loserSource: skill.sourceLabel,
          name: skill.name,
          resourceType: "skill",
          winnerPath: existing.filePath,
          winnerSource: existing.sourceLabel
        }
      });
      continue;
    }

    byName.set(skill.name, skill);
  }

  return {
    diagnostics,
    formatSkillsForPrompt: sdk.formatSkillsForPrompt,
    loadedSkills: [...byName.values()]
  };
}

async function collectSkillSourceDirs(options: CreateEsseSkillLoaderOptions): Promise<Array<{
  dir: string;
  source: EsseSkillSource;
  sourceLabel: string;
}>> {
  const dirs: Array<{ dir: string; source: EsseSkillSource; sourceLabel: string }> = [
    { dir: options.builtInSkillsDir, source: "built-in", sourceLabel: "内置" }
  ];

  for (const dir of await listGlobalSkillDirs(options.agentDir)) {
    dirs.push({ dir, source: "global", sourceLabel: "全局" });
  }

  const projectDirectory = options.getProjectDirectory?.();
  if (projectDirectory) {
    dirs.push({ dir: path.join(projectDirectory, ".esse", "skills"), source: "project", sourceLabel: "项目" });
  }

  for (const userPath of options.getUserPaths?.() ?? []) {
    if (userPath.trim()) {
      dirs.push({ dir: userPath, source: "user-path", sourceLabel: "搜索目录" });
    }
  }

  return dirs;
}

async function listGlobalSkillDirs(agentDir: string): Promise<string[]> {
  if (!existsSync(agentDir)) {
    return [];
  }

  const entries = await readdir(agentDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== "_built-in")
    .map((entry) => path.join(agentDir, entry.name));
}

function toEsseSkillRecord(skill: PiSkill, source: EsseSkillSource, sourceLabel: string): EsseSkillRecord {
  return {
    baseDir: skill.baseDir,
    description: skill.description,
    disableModelInvocation: skill.disableModelInvocation,
    filePath: skill.filePath,
    name: skill.name,
    source,
    sourceLabel
  };
}

function toPublicSkill(skill: LoadedEsseSkillRecord | undefined): EsseSkillRecord | undefined;
function toPublicSkill(skill: LoadedEsseSkillRecord): EsseSkillRecord;
function toPublicSkill(skill: LoadedEsseSkillRecord | undefined): EsseSkillRecord | undefined {
  if (!skill) {
    return undefined;
  }

  const { raw: _raw, ...publicSkill } = skill;
  return publicSkill;
}

function matchSkillByCwd(skills: LoadedEsseSkillRecord[], cwd: string): EsseSkillRecord | undefined {
  const normalizedCwd = normalizePathForComparison(path.resolve(cwd));
  const matches = skills
    .filter((skill) => {
      const normalizedBaseDir = normalizePathForComparison(path.resolve(skill.baseDir));
      return normalizedCwd === normalizedBaseDir || normalizedCwd.startsWith(`${normalizedBaseDir}/`);
    })
    .sort((a, b) => b.baseDir.length - a.baseDir.length);

  return toPublicSkill(matches[0]);
}

function formatLoadedSkillsForPrompt(
  skills: LoadedEsseSkillRecord[],
  formatSkillsForPrompt: EssePiSkillsSdk["formatSkillsForPrompt"]
): string {
  if (skills.length === 0) {
    return "";
  }

  return formatSkillsForPrompt(skills.map((skill) => skill.raw)) || fallbackFormatSkillsForPrompt(skills);
}

function fallbackFormatSkillsForPrompt(skills: LoadedEsseSkillRecord[]): string {
  const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
  if (visibleSkills.length === 0) {
    return "";
  }

  return [
    "<skills>",
    ...visibleSkills.map((skill) =>
      [
        `  <skill name="${escapeXml(skill.name)}">`,
        `    <description>${escapeXml(skill.description)}</description>`,
        `    <file>${escapeXml(skill.filePath)}</file>`,
        "  </skill>"
      ].join("\n")
    ),
    "</skills>"
  ].join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let piSkillsSdkPromise: Promise<EssePiSkillsSdk> | undefined;

async function loadPiSkillsSdk(): Promise<EssePiSkillsSdk> {
  if (!piSkillsSdkPromise) {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    piSkillsSdkPromise = dynamicImport("@earendil-works/pi-coding-agent").then((sdk) => {
      if (!isPiSkillsSdk(sdk)) {
        throw new Error("pi skills SDK unavailable");
      }

      return sdk;
    });
  }

  return piSkillsSdkPromise;
}

function isPiSkillsSdk(value: unknown): value is EssePiSkillsSdk {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as EssePiSkillsSdk).formatSkillsForPrompt === "function" &&
    typeof (value as EssePiSkillsSdk).loadSkillsFromDir === "function"
  );
}
