import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  configureLocalConfig,
  getApiSettingsSnapshot,
  parseEnvFile,
  resolveApiSettingsSnapshot,
  resolveTuziConfig,
  resolveTuziLlmConfig,
  saveApiSettings
} from "./localConfig";

let tempDirectory: string | undefined;

afterEach(async () => {
  if (tempDirectory) {
    await rm(tempDirectory, { force: true, recursive: true });
    tempDirectory = undefined;
  }
});

describe("localConfig", () => {
  test("parses simple local env files", () => {
    expect(
      parseEnvFile(`
TUZI_BASE_URL=https://api.ourzhishi.top
TUZI_API_KEY=abc123
TUZI_IMAGE_MODEL=gpt-image-2
`)
    ).toEqual({
      TUZI_API_KEY: "abc123",
      TUZI_BASE_URL: "https://api.ourzhishi.top",
      TUZI_IMAGE_MODEL: "gpt-image-2"
    });
  });

  test("resolves Tuzi image config with defaults", () => {
    expect(
      resolveTuziConfig(
        {
          TUZI_API_KEY: "abc123",
          TUZI_BASE_URL: "https://api.ourzhishi.top"
        },
        "C:\\BatchImager\\generated"
      )
    ).toEqual({
      apiKey: "abc123",
      baseUrl: "https://api.ourzhishi.top",
      model: "gpt-image-2",
      outputDirectory: "C:\\BatchImager\\generated",
      size: "auto"
    });
  });

  test("requires a local api key", () => {
    expect(() => resolveTuziConfig({}, "C:\\BatchImager\\generated")).toThrow("TUZI_API_KEY");
  });

  test("resolves Tuzi LLM config with dedicated coding endpoint credentials", () => {
    expect(
      resolveTuziLlmConfig({
        TUZI_API_KEY: "abc123",
        TUZI_LLM_API_KEY: "coding-key",
        TUZI_BASE_URL: "https://api.ourzhishi.top/",
        TUZI_LLM_BASE_URL: "https://api.tu-zi.com/coding",
        TUZI_LLM_MODEL: "gpt-5.5"
      })
    ).toEqual({
      apiKey: "coding-key",
      baseUrl: "https://api.tu-zi.com/coding",
      model: "gpt-5.5"
    });
  });

  test("summarizes API settings without exposing keys", () => {
    expect(
      resolveApiSettingsSnapshot({
        TUZI_API_KEY: "image-key",
        TUZI_BASE_URL: "https://image.example",
        TUZI_IMAGE_MODEL: "image-model",
        TUZI_LLM_API_KEY: "llm-key",
        TUZI_LLM_BASE_URL: "https://llm.example",
        TUZI_LLM_MODEL: "llm-model"
      }, "/tmp/api-settings.json")
    ).toEqual({
      configPath: "/tmp/api-settings.json",
      imageApiKeyConfigured: true,
      imageBaseUrl: "https://image.example",
      imageModel: "image-model",
      llmApiKeyConfigured: true,
      llmBaseUrl: "https://llm.example",
      llmModel: "llm-model"
    });
  });

  test("persists API settings in the configured user data directory", async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-config-"));
    configureLocalConfig({ userConfigDirectory: tempDirectory });

    await saveApiSettings({
      imageApiKey: "image-key",
      imageBaseUrl: "https://image.example",
      imageModel: "gpt-image-2",
      llmApiKey: "llm-key",
      llmBaseUrl: "https://llm.example",
      llmModel: "gpt-5.5"
    });

    expect(getApiSettingsSnapshot()).toMatchObject({
      imageApiKeyConfigured: true,
      imageBaseUrl: "https://image.example",
      imageModel: "gpt-image-2",
      llmApiKeyConfigured: true,
      llmBaseUrl: "https://llm.example",
      llmModel: "gpt-5.5"
    });
  });
});
