import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ApiSettingsSnapshot, ImageApiProfileId, ImageApiProfileSnapshot, SaveApiSettingsRequest } from "../ipcTypes";
import type { TuziImageApiConfig } from "./tuziImageApi";

const DEFAULT_BASE_URL = "https://api.ourzhishi.top";
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_LLM_BASE_URL = "https://api.tu-zi.com/coding";
const DEFAULT_LLM_MODEL = "gpt-5.5";
const DEFAULT_SIZE = "auto";
const API_SETTINGS_FILE_NAME = "api-settings.json";
const IMAGE_API_PROFILE_IDS: ImageApiProfileId[] = ["primary", "secondary"];
let userConfigDirectory: string | undefined;

export interface TuziLlmApiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function configureLocalConfig(options: { userConfigDirectory: string }): void {
  userConfigDirectory = options.userConfigDirectory;
}

export function loadLocalEnv(appRoot: string = process.cwd()): Record<string, string> {
  const envFilePath = path.join(appRoot, ".env.local");

  try {
    return parseEnvFile(readFileSync(envFilePath, "utf8"));
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {};
    }

    throw error;
  }
}

export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    values[key] = rawValue.replace(/^["']|["']$/g, "");
  }

  return values;
}

export function loadPersistedApiSettings(): Record<string, string> {
  if (!userConfigDirectory) {
    return {};
  }

  const settingsPath = getApiSettingsFilePath();
  if (!existsSync(settingsPath)) {
    return {};
  }

  const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    return {};
  }

  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      values[key] = value;
    }
  }

  return values;
}

export function resolveApiSettingsSnapshot(values: Record<string, string | undefined>, configPath?: string): ApiSettingsSnapshot {
  const activeProfile = resolveActiveImageApiProfile(values);
  const imageApiProfiles = resolveImageApiProfiles(values, activeProfile.id).map(
    ({ apiKey: _apiKey, llmApiKey: _llmApiKey, ...profile }) => profile
  );

  return {
    activeImageApiProfileId: activeProfile.id,
    ...(configPath ? { configPath } : {}),
    imageApiKeyConfigured: activeProfile.apiKeyConfigured,
    imageApiProfiles,
    imageBaseUrl: activeProfile.baseUrl,
    imageModel: activeProfile.model,
    llmApiKeyConfigured: activeProfile.llmApiKeyConfigured,
    llmBaseUrl: activeProfile.llmBaseUrl,
    llmModel: activeProfile.llmModel
  };
}

export function getApiSettingsSnapshot(): ApiSettingsSnapshot {
  return resolveApiSettingsSnapshot(loadConfigValues(), userConfigDirectory ? getApiSettingsFilePath() : undefined);
}

export async function saveApiSettings(request: SaveApiSettingsRequest): Promise<ApiSettingsSnapshot> {
  if (!userConfigDirectory) {
    throw new Error("User config directory is not configured");
  }

  const current = loadPersistedApiSettings();
  const activeProfileId = request.activeImageApiProfileId ?? "primary";
  const next: Record<string, string> = {
    ...current,
    TUZI_IMAGE_ACTIVE_PROFILE: activeProfileId,
    TUZI_LLM_BASE_URL: request.llmBaseUrl.trim(),
    TUZI_LLM_MODEL: request.llmModel.trim()
  };

  const profiles = request.imageApiProfiles?.length
    ? request.imageApiProfiles
    : [
        {
          apiKey: request.imageApiKey,
          baseUrl: request.imageBaseUrl,
          id: "primary" as const,
          llmApiKey: request.llmApiKey,
          llmBaseUrl: request.llmBaseUrl,
          llmModel: request.llmModel,
          model: request.imageModel,
          name: "主通道"
        }
      ];
  for (const profile of profiles) {
    const keyPrefix = getImageProfileKeyPrefix(profile.id);
    next[`${keyPrefix}_NAME`] = profile.name.trim() || getDefaultImageProfileName(profile.id);
    next[`${keyPrefix}_BASE_URL`] = profile.baseUrl.trim();
    next[`${keyPrefix}_MODEL`] = profile.model.trim();
    next[`${keyPrefix}_LLM_BASE_URL`] = profile.llmBaseUrl.trim();
    next[`${keyPrefix}_LLM_MODEL`] = profile.llmModel.trim();
    if (profile.apiKey?.trim()) {
      next[`${keyPrefix}_API_KEY`] = profile.apiKey.trim();
    }
    if (profile.llmApiKey?.trim()) {
      next[`${keyPrefix}_LLM_API_KEY`] = profile.llmApiKey.trim();
    }
  }

  const activeRequestProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  if (activeRequestProfile) {
    next.TUZI_BASE_URL = activeRequestProfile.baseUrl.trim();
    next.TUZI_IMAGE_MODEL = activeRequestProfile.model.trim();
    next.TUZI_LLM_BASE_URL = activeRequestProfile.llmBaseUrl.trim();
    next.TUZI_LLM_MODEL = activeRequestProfile.llmModel.trim();
    if (activeRequestProfile.apiKey?.trim()) {
      next.TUZI_API_KEY = activeRequestProfile.apiKey.trim();
    } else {
      const activeStoredKey = current[`${getImageProfileKeyPrefix(activeRequestProfile.id)}_API_KEY`]?.trim();
      if (activeStoredKey) {
        next.TUZI_API_KEY = activeStoredKey;
      }
    }
    if (activeRequestProfile.llmApiKey?.trim()) {
      next.TUZI_LLM_API_KEY = activeRequestProfile.llmApiKey.trim();
    } else {
      const activeStoredKey = current[`${getImageProfileKeyPrefix(activeRequestProfile.id)}_LLM_API_KEY`]?.trim();
      if (activeStoredKey) {
        next.TUZI_LLM_API_KEY = activeStoredKey;
      }
    }
  } else {
    next.TUZI_BASE_URL = request.imageBaseUrl.trim();
    next.TUZI_IMAGE_MODEL = request.imageModel.trim();
    if (request.imageApiKey?.trim()) {
      next.TUZI_API_KEY = request.imageApiKey.trim();
    }
  }

  if (request.llmApiKey?.trim()) {
    next.TUZI_LLM_API_KEY = request.llmApiKey.trim();
  }

  await mkdir(userConfigDirectory, { recursive: true });
  await writeFile(getApiSettingsFilePath(), `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  return getApiSettingsSnapshot();
}

export function resolveTuziConfig(values: Record<string, string | undefined>, outputDirectory: string): TuziImageApiConfig {
  const activeProfile = resolveActiveImageApiProfile(values);
  const apiKey = activeProfile.apiKey?.trim();

  if (!apiKey) {
    throw new Error("TUZI_API_KEY is required in local configuration");
  }

  return {
    apiKey,
    baseUrl: activeProfile.baseUrl,
    model: activeProfile.model,
    outputDirectory,
    size: values.TUZI_IMAGE_SIZE?.trim() || DEFAULT_SIZE
  };
}

export function resolveTuziLlmConfig(values: Record<string, string | undefined>): TuziLlmApiConfig {
  const activeProfile = resolveActiveImageApiProfile(values);
  const apiKey = activeProfile.llmApiKey?.trim();

  if (!apiKey) {
    throw new Error("TUZI_LLM_API_KEY or TUZI_API_KEY is required in local configuration");
  }

  return {
    apiKey,
    baseUrl: activeProfile.llmBaseUrl,
    model: activeProfile.llmModel
  };
}

export function loadTuziConfig(outputDirectory: string): TuziImageApiConfig {
  return resolveTuziConfig(loadConfigValues(), outputDirectory);
}

export function loadTuziLlmConfig(): TuziLlmApiConfig {
  return resolveTuziLlmConfig(loadConfigValues());
}

function loadConfigValues(): Record<string, string | undefined> {
  return {
    ...loadLocalEnv(),
    ...loadPersistedApiSettings(),
    ...process.env
  };
}

function getApiSettingsFilePath(): string {
  if (!userConfigDirectory) {
    throw new Error("User config directory is not configured");
  }

  return path.join(userConfigDirectory, API_SETTINGS_FILE_NAME);
}

interface ResolvedImageApiProfile extends ImageApiProfileSnapshot {
  apiKey?: string;
  llmApiKey?: string;
}

function resolveActiveImageApiProfile(values: Record<string, string | undefined>): ResolvedImageApiProfile {
  const activeId = parseImageProfileId(values.TUZI_IMAGE_ACTIVE_PROFILE) ?? "primary";
  return resolveImageApiProfiles(values, activeId).find((profile) => profile.id === activeId) ?? resolveImageApiProfile(values, "primary", true);
}

function resolveImageApiProfiles(values: Record<string, string | undefined>, activeId: ImageApiProfileId): ResolvedImageApiProfile[] {
  return IMAGE_API_PROFILE_IDS.map((id) => resolveImageApiProfile(values, id, id === activeId));
}

function resolveImageApiProfile(
  values: Record<string, string | undefined>,
  id: ImageApiProfileId,
  active: boolean
): ResolvedImageApiProfile {
  const keyPrefix = getImageProfileKeyPrefix(id);
  const legacyFallback = id === "primary";
  const apiKey = values[`${keyPrefix}_API_KEY`]?.trim() || (legacyFallback ? values.TUZI_API_KEY?.trim() : "");
  const baseUrl = values[`${keyPrefix}_BASE_URL`]?.trim() || (legacyFallback ? values.TUZI_BASE_URL?.trim() : "") || DEFAULT_BASE_URL;
  const model = values[`${keyPrefix}_MODEL`]?.trim() || (legacyFallback ? values.TUZI_IMAGE_MODEL?.trim() : "") || DEFAULT_MODEL;
  const llmApiKey =
    values[`${keyPrefix}_LLM_API_KEY`]?.trim() ||
    (legacyFallback ? values.TUZI_LLM_API_KEY?.trim() : "") ||
    apiKey ||
    (legacyFallback ? values.TUZI_API_KEY?.trim() : "");
  const llmBaseUrl =
    values[`${keyPrefix}_LLM_BASE_URL`]?.trim() ||
    (legacyFallback ? values.TUZI_LLM_BASE_URL?.trim() || values.TUZI_BASE_URL?.trim() : "") ||
    DEFAULT_LLM_BASE_URL;
  const llmModel = values[`${keyPrefix}_LLM_MODEL`]?.trim() || (legacyFallback ? values.TUZI_LLM_MODEL?.trim() : "") || DEFAULT_LLM_MODEL;
  const name = values[`${keyPrefix}_NAME`]?.trim() || getDefaultImageProfileName(id);

  return {
    active,
    apiKey,
    apiKeyConfigured: Boolean(apiKey),
    baseUrl,
    id,
    llmApiKey,
    llmApiKeyConfigured: Boolean(llmApiKey),
    llmBaseUrl,
    llmModel,
    model,
    name
  };
}

function parseImageProfileId(value: string | undefined): ImageApiProfileId | null {
  return value === "primary" || value === "secondary" ? value : null;
}

function getImageProfileKeyPrefix(id: ImageApiProfileId): string {
  return `TUZI_IMAGE_PROFILE_${id.toUpperCase()}`;
}

function getDefaultImageProfileName(id: ImageApiProfileId): string {
  return id === "primary" ? "图像通道 1" : "图像通道 2";
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
