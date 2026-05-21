import { describe, expect, test } from "vitest";
import { parseEnvFile, resolveTuziConfig, resolveTuziLlmConfig } from "./localConfig";

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

  test("resolves Tuzi LLM config with the shared base url and api key", () => {
    expect(
      resolveTuziLlmConfig({
        TUZI_API_KEY: "abc123",
        TUZI_BASE_URL: "https://api.ourzhishi.top/",
        TUZI_LLM_MODEL: "gpt-4o-mini"
      })
    ).toEqual({
      apiKey: "abc123",
      baseUrl: "https://api.ourzhishi.top/",
      model: "gpt-4o-mini"
    });
  });
});
