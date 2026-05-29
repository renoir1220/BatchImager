import { describe, expect, test } from "vitest";
import {
  buildAgentSessionDescriptor,
  createAgentRuntime,
  loadCodingAgentSdk,
  resetAgentRuntimeWarmupForTests,
  type CodingAgentSdk,
  warmupAgentRuntime
} from "./agentRuntime";

describe("agentRuntime", () => {
  test("warms and reuses the default Pi SDK import", async () => {
    resetAgentRuntimeWarmupForTests();
    let loadCount = 0;
    const sdk: CodingAgentSdk = {
      createAgentSession: async () => ({ session: { prompt: async () => undefined, subscribe: () => () => undefined } })
    };
    const loader = async () => {
      loadCount += 1;
      return sdk;
    };

    await warmupAgentRuntime(loader);
    await expect(loadCodingAgentSdk()).resolves.toBe(sdk);
    await expect(loadCodingAgentSdk()).resolves.toBe(sdk);

    expect(loadCount).toBe(1);
    resetAgentRuntimeWarmupForTests();
  });

  test("builds a session descriptor that mirrors the registered custom tools", () => {
    const descriptor = buildAgentSessionDescriptor({
      customToolNames: ["run_project_command", "generate_image"],
      extensionToolNames: ["list_sessions"],
      model: "gpt-5.5",
      projectDirectory: "C:\\BatchImagerProjects\\project-1",
      sessionId: "img-1"
    });

    expect(descriptor).toEqual({
      builtInTools: ["read", "grep", "find", "ls"],
      customTools: ["list_sessions", "run_project_command", "generate_image"],
      model: "gpt-5.5",
      projectDirectory: "C:\\BatchImagerProjects\\project-1",
      sessionId: "img-1"
    });
  });

  test("falls back to an empty custom tool list when no tools are registered", () => {
    const descriptor = buildAgentSessionDescriptor({
      model: "gpt-5.5",
      projectDirectory: "C:\\BatchImagerProjects\\project-1",
      sessionId: "esse-agent"
    });

    expect(descriptor.customTools).toEqual([]);
  });

  test("loads the Pi SDK through an injectable dynamic loader", async () => {
    const sdk: CodingAgentSdk = {
      createAgentSession: async () => ({ session: { prompt: async () => undefined, subscribe: () => () => undefined } })
    };

    await expect(loadCodingAgentSdk(async () => sdk)).resolves.toBe(sdk);
  });

  test("reports a clear error when the Pi SDK cannot be loaded", async () => {
    await expect(
      loadCodingAgentSdk(async () => {
        throw new Error("module not found");
      })
    ).rejects.toThrow("智能体 SDK 加载失败");
  });

  test("creates a runtime with project cwd, broad built-ins, and provided custom tools", async () => {
    const createCalls: Record<string, unknown>[] = [];
    const unsubscribe = () => undefined;
    const prompts: string[] = [];
    const runtime = await import("./agentRuntime").then(({ createAgentRuntime }) =>
      createAgentRuntime({
        customToolDefinitions: [{ name: "run_project_command" }],
        llmConfig: {
          apiKey: "test-key",
          baseUrl: "https://api.tu-zi.com/coding",
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
          "grep",
          "find",
          "ls",
          "run_project_command"
        ]
      })
    ]);
    await runtime.prompt("hello");
    expect(prompts).toEqual(["hello"]);
    const externalUnsubscribe = runtime.subscribe(() => undefined);
    expect(typeof externalUnsubscribe).toBe("function");
    externalUnsubscribe();
    expect(runtime.getLastAssistantText()).toBe("done");
  });

  test("loads controlled extension factories through Pi's resource loader", async () => {
    const createCalls: Record<string, unknown>[] = [];
    const loaderOptions: Record<string, unknown>[] = [];
    let reloadCount = 0;
    class FakeDefaultResourceLoader {
      constructor(options: Record<string, unknown>) {
        loaderOptions.push(options);
      }

      async reload() {
        reloadCount += 1;
      }
    }

    await createAgentRuntime({
      customToolDefinitions: [{ name: "bash" }],
      extensionFactories: [() => undefined],
      extensionToolNames: ["list_sessions", "get_session_records"],
      llmConfig: {
        apiKey: "test-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      model: "gpt-5.5",
      projectDirectory: "C:\\BatchImagerProjects\\project-1",
      sdk: {
        AuthStorage: {
          create: () => ({})
        },
        DefaultResourceLoader: FakeDefaultResourceLoader,
        getAgentDir: () => "/tmp/pi-agent",
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
              getLastAssistantText: () => "done",
              prompt: async () => undefined,
              subscribe: () => () => undefined
            }
          };
        }
      },
      sessionId: "esse-agent"
    });

    expect(loaderOptions).toEqual([
      {
        agentDir: "/tmp/pi-agent",
        cwd: "C:\\BatchImagerProjects\\project-1",
        extensionFactories: [expect.any(Function)]
      }
    ]);
    expect(reloadCount).toBe(1);
    expect(createCalls[0]).toMatchObject({
      customTools: [{ name: "bash" }],
      resourceLoader: expect.any(FakeDefaultResourceLoader),
      tools: [
        "read",
        "grep",
        "find",
        "ls",
        "list_sessions",
        "get_session_records",
        "bash"
      ]
    });
  });

  test("reads the last assistant text from SDK session messages when no helper exists", async () => {
    const runtime = await import("./agentRuntime").then(({ createAgentRuntime }) =>
      createAgentRuntime({
        llmConfig: {
          apiKey: "test-key",
          baseUrl: "https://api.tu-zi.com/coding",
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

  test("reads the last assistant SDK error when the final assistant message has no text", async () => {
    const runtime = await createAgentRuntime({
      llmConfig: {
        apiKey: "test-key",
        baseUrl: "https://api.tu-zi.com/coding",
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
            messages: [
              { content: [{ text: "你好", type: "text" }], role: "user" },
              { content: [], errorMessage: "Provider returned no choices", role: "assistant", stopReason: "error" }
            ],
            prompt: async () => undefined,
            subscribe: () => () => undefined
          }
        })
      },
      sessionId: "esse-agent"
    });

    expect(runtime.getLastAssistantError?.()).toBe("Provider returned no choices");
  });
});
