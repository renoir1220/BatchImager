import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ApiSettingsSnapshot, SaveApiSettingsRequest } from "../ipcTypes";
import type { TuziImageApiConfig } from "./tuziImageApi";

const DEFAULT_BASE_URL = "https://api.ourzhishi.top";
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_LLM_BASE_URL = "https://api.tu-zi.com/coding";
const DEFAULT_LLM_MODEL = "gpt-5.5";
const DEFAULT_SIZE = "auto";
const API_SETTINGS_FILE_NAME = "api-settings.json";
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
  return {
    ...(configPath ? { configPath } : {}),
    imageApiKeyConfigured: Boolean(values.TUZI_API_KEY?.trim()),
    imageBaseUrl: values.TUZI_BASE_URL?.trim() || DEFAULT_BASE_URL,
    imageModel: values.TUZI_IMAGE_MODEL?.trim() || DEFAULT_MODEL,
    llmApiKeyConfigured: Boolean(values.TUZI_LLM_API_KEY?.trim() || values.TUZI_API_KEY?.trim()),
    llmBaseUrl: values.TUZI_LLM_BASE_URL?.trim() || values.TUZI_BASE_URL?.trim() || DEFAULT_LLM_BASE_URL,
    llmModel: values.TUZI_LLM_MODEL?.trim() || DEFAULT_LLM_MODEL
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
  const next: Record<string, string> = {
    ...current,
    TUZI_BASE_URL: request.imageBaseUrl.trim(),
    TUZI_IMAGE_MODEL: request.imageModel.trim(),
    TUZI_LLM_BASE_URL: request.llmBaseUrl.trim(),
    TUZI_LLM_MODEL: request.llmModel.trim()
  };

  if (request.imageApiKey?.trim()) {
    next.TUZI_API_KEY = request.imageApiKey.trim();
  }

  if (request.llmApiKey?.trim()) {
    next.TUZI_LLM_API_KEY = request.llmApiKey.trim();
  }

  await mkdir(userConfigDirectory, { recursive: true });
  await writeFile(getApiSettingsFilePath(), `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  return getApiSettingsSnapshot();
}

export function resolveTuziConfig(values: Record<string, string | undefined>, outputDirectory: string): TuziImageApiConfig {
  const apiKey = values.TUZI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("TUZI_API_KEY is required in local configuration");
  }

  return {
    apiKey,
    baseUrl: values.TUZI_BASE_URL?.trim() || DEFAULT_BASE_URL,
    model: values.TUZI_IMAGE_MODEL?.trim() || DEFAULT_MODEL,
    outputDirectory,
    size: values.TUZI_IMAGE_SIZE?.trim() || DEFAULT_SIZE
  };
}

export function resolveTuziLlmConfig(values: Record<string, string | undefined>): TuziLlmApiConfig {
  const apiKey = values.TUZI_LLM_API_KEY?.trim() || values.TUZI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("TUZI_LLM_API_KEY or TUZI_API_KEY is required in local configuration");
  }

  return {
    apiKey,
    baseUrl: values.TUZI_LLM_BASE_URL?.trim() || values.TUZI_BASE_URL?.trim() || DEFAULT_LLM_BASE_URL,
    model: values.TUZI_LLM_MODEL?.trim() || DEFAULT_LLM_MODEL
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

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
