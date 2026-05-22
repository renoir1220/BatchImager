import { readFileSync } from "node:fs";
import path from "node:path";
import type { TuziImageApiConfig } from "./tuziImageApi";

const DEFAULT_BASE_URL = "https://api.ourzhishi.top";
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_LLM_BASE_URL = "https://api.tu-zi.com/coding";
const DEFAULT_LLM_MODEL = "gpt-5.5";
const DEFAULT_SIZE = "auto";

export interface TuziLlmApiConfig {
  apiKey: string;
  baseUrl: string;
  chatAgent: "openai-tools" | "pi";
  model: string;
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
    chatAgent: values.BATCHIMAGER_CHAT_AGENT?.trim().toLowerCase() === "pi" ? "pi" : "openai-tools",
    model: values.TUZI_LLM_MODEL?.trim() || DEFAULT_LLM_MODEL
  };
}

export function loadTuziConfig(outputDirectory: string): TuziImageApiConfig {
  return resolveTuziConfig(
    {
      ...loadLocalEnv(),
      ...process.env
    },
    outputDirectory
  );
}

export function loadTuziLlmConfig(): TuziLlmApiConfig {
  return resolveTuziLlmConfig({
    ...loadLocalEnv(),
    ...process.env
  });
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
