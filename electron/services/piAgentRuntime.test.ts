import { describe, expect, test } from "vitest";
import {
  buildPiAgentSessionDescriptor,
  loadPiCodingAgentSdk,
  resetPiAgentRuntimeWarmupForTests,
  type PiCodingAgentSdk,
  warmupPiAgentRuntime
} from "./piAgentRuntime";

describe("piAgentRuntime", () => {
  test("warms and reuses the default Pi SDK import", async () => {
    resetPiAgentRuntimeWarmupForTests();
    let loadCount = 0;
    const sdk: PiCodingAgentSdk = {
      createAgentSession: async () => ({ session: { prompt: async () => undefined, subscribe: () => () => undefined } })
    };
    const loader = async () => {
      loadCount += 1;
      return sdk;
    };

    await warmupPiAgentRuntime(loader);
    await expect(loadPiCodingAgentSdk()).resolves.toBe(sdk);
    await expect(loadPiCodingAgentSdk()).resolves.toBe(sdk);

    expect(loadCount).toBe(1);
    resetPiAgentRuntimeWarmupForTests();
  });

  test("builds a lightweight OpenClaw-style session descriptor for BatchImager", () => {
    const descriptor = buildPiAgentSessionDescriptor({
      model: "gpt-5.5",
      projectDirectory: "C:\\BatchImagerProjects\\project-1",
      sessionId: "img-1"
    });

    expect(descriptor).toEqual({
      builtInTools: ["read", "write", "edit", "grep", "find", "ls"],
      customTools: ["run_project_command", "generate_image", "inspect_image", "batch_generate"],
      model: "gpt-5.5",
      projectDirectory: "C:\\BatchImagerProjects\\project-1",
      sessionId: "img-1"
    });
  });

  test("loads the Pi SDK through an injectable dynamic loader", async () => {
    const sdk: PiCodingAgentSdk = {
      createAgentSession: async () => ({ session: { prompt: async () => undefined, subscribe: () => () => undefined } })
    };

    await expect(loadPiCodingAgentSdk(async () => sdk)).resolves.toBe(sdk);
  });

  test("reports a clear error when the Pi SDK cannot be loaded", async () => {
    await expect(
      loadPiCodingAgentSdk(async () => {
        throw new Error("module not found");
      })
    ).rejects.toThrow("Pi SDK 加载失败");
  });

  test("creates a runtime with project cwd, broad built-ins, and provided custom tools", async () => {
    const createCalls: Record<string, unknown>[] = [];
    const unsubscribe = () => undefined;
    const prompts: string[] = [];
    const runtime = await import("./piAgentRuntime").then(({ createPiAgentRuntime }) =>
      createPiAgentRuntime({
        customToolDefinitions: [{ name: "run_project_command" }],
        llmConfig: {
          apiKey: "test-key",
          baseUrl: "https://api.tu-zi.com/coding",
          chatAgent: "pi",
          model: "gpt-5.5"
        },
        model: "gpt-5.5",
        projectDirectory: "C:\\BatchImagerProjects\\project-1",
        sdk: {
          AuthStorage: {
            create: () => ({})
          },
          ModelRegistry: {
            create: () => {
              const models = new Map<string, unknown>();
              return {
                find: (_provider, modelId) => models.get(modelId),
                registerProvider: (_providerName, config) => {
                  const providerModels = config.models as Array<{ id: string }>;
                  for (const model of providerModels) {
                    models.set(model.id, model);
                  }
                }
              };
            }
          },
          createAgentSession: async (options) => {
            createCalls.push(options ?? {});
            return {
              session: {
                dispose: () => undefined,
                getLastAssistantText: () => "done",
                prompt: async (text) => {
                  prompts.push(text);
                },
                subscribe: () => unsubscribe
              }
            };
          }
        },
        sessionId: "img-1"
      })
    );

    expect(createCalls).toEqual([
      expect.objectContaining({
        cwd: "C:\\BatchImagerProjects\\project-1",
        customTools: [{ name: "run_project_command" }],
        model: expect.objectContaining({
          baseUrl: "https://api.tu-zi.com/coding/v1",
          id: "gpt-5.5"
        }),
        noTools: "builtin",
        thinkingLevel: "medium",
        tools: [
          "read",
          "write",
          "edit",
          "grep",
          "find",
          "ls",
          "run_project_command",
          "generate_image",
          "inspect_image",
          "batch_generate"
        ]
      })
    ]);
    await runtime.prompt("hello");
    expect(prompts).toEqual(["hello"]);
    expect(runtime.subscribe(() => undefined)).toBe(unsubscribe);
    expect(runtime.getLastAssistantText()).toBe("done");
  });

  test("reads the last assistant text from SDK session messages when no helper exists", async () => {
    const runtime = await import("./piAgentRuntime").then(({ createPiAgentRuntime }) =>
      createPiAgentRuntime({
        llmConfig: {
          apiKey: "test-key",
          baseUrl: "https://api.tu-zi.com/coding",
          chatAgent: "pi",
          model: "gpt-5.5"
        },
        model: "gpt-5.5",
        projectDirectory: "C:\\BatchImagerProjects\\project-1",
        sdk: {
          AuthStorage: {
            create: () => ({})
          },
          ModelRegistry: {
            create: () => {
              const models = new Map<string, unknown>();
              return {
                find: (_provider, modelId) => models.get(modelId),
                registerProvider: (_providerName, config) => {
                  const providerModels = config.models as Array<{ id: string }>;
                  for (const model of providerModels) {
                    models.set(model.id, model);
                  }
                }
              };
            }
          },
          createAgentSession: async () => ({
            session: {
              dispose: () => undefined,
              messages: [
                { content: [{ text: "用户要求", type: "text" }], role: "user" },
                { content: [{ text: "{\"reply\":\"我会重新生成。\"}", type: "text" }], role: "assistant" }
              ],
              prompt: async () => undefined,
              subscribe: () => () => undefined
            }
          })
        },
        sessionId: "esse-agent"
      })
    );

    expect(runtime.getLastAssistantText()).toBe("{\"reply\":\"我会重新生成。\"}");
  });
});
