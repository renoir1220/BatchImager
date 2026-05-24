import { describe, expect, test } from "vitest";
import type { AppLogger, BackendLogOptions } from "./appLogger";
import type { AgentRuntime } from "./agentRuntime";
import { AgentRuntimeRegistry } from "./agentRuntimeRegistry";
import { runEsseAgentTurn } from "./esseAgent";
import type { EsseWorkspaceState, EsseWorkspaceToolRuntime } from "./esseWorkspaceTools";
import type { ProjectSnapshot } from "../ipcTypes";

describe("esseAgent", () => {
  test("defaults Esse to the true designer persona in a plain-text prompt", async () => {
    let capturedPrompt = "";

    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "帮我处理这批图" }],
        sessions: []
      },
      createEsseTestConfig(),
      "C:/project",
      {
        createRuntime: async () =>
          createFakeEsseRuntime({
            getLastAssistantText: () => "我会先判断目标和用户价值，再给出执行方案。",
            onPrompt: (prompt) => {
              capturedPrompt = prompt;
            }
          })
      }
    );

    expect(result).toEqual({ reply: "我会先判断目标和用户价值，再给出执行方案。" });
    expect(capturedPrompt).toContain("当前人格：真正的设计师");
    expect(capturedPrompt).toContain("像资深商业视觉设计师一样工作");
    expect(capturedPrompt).toContain("有审美取向的默认方案");
    expect(capturedPrompt).toContain("当前运行时没有工作区工具");
    expect(capturedPrompt).toContain("不要返回 JSON");
    expect(capturedPrompt).not.toContain("输出契约");
    expect(capturedPrompt).not.toContain("只返回一个 JSON 对象");
  });

  test.each([
    ["question-girl", ["当前人格：问题少女", "敏锐、挑剔但有审美判断力的设计搭档", "不要为了人格而硬追问"]],
    ["old-ox", ["当前人格：牛马设计师", "高执行、少废话、快速交付", "用合理默认值继续推进"]],
    ["robot", ["当前人格：无情的机器人", "低温、结构化、可预测", "不使用玩笑、情绪化表达或拟人化口吻"]]
  ] as const)("passes the selected %s persona into the runtime prompt", async (persona, expectedSnippets) => {
    let capturedPrompt = "";

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "把这批图弄好" }],
        persona,
        sessions: []
      },
      createEsseTestConfig(),
      "C:/project",
      {
        createRuntime: async () =>
          createFakeEsseRuntime({
            onPrompt: (prompt) => {
              capturedPrompt = prompt;
            }
          })
      }
    );

    for (const snippet of expectedSnippets) {
      expect(capturedPrompt).toContain(snippet);
    }
  });

  test.each(["old-ox", "question-girl"] as const)("keeps %s workspace persona instructions aligned with tool execution", async (persona) => {
    const workspaceRuntime = createTestWorkspaceRuntime({
      project: createTestProjectMetadata(),
      sessions: []
    });
    let capturedPrompt = "";

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "生成一张白底主图" }],
        persona,
        sessions: []
      },
      createEsseTestConfig(),
      "C:/project",
      {
        createRuntime: async () =>
          createFakeEsseRuntime({
            onPrompt: (prompt) => {
              capturedPrompt = prompt;
            }
          }),
        workspaceToolRuntime: workspaceRuntime
      }
    );

    expect(capturedPrompt).toContain("工作区工具模式");
    expect(capturedPrompt).not.toMatch(/\bplan\b|imageRequests/);
  });

  test("returns the assistant text directly instead of parsing legacy JSON fields", async () => {
    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "这批图适合做什么方向？" }],
        sessions: []
      },
      createEsseTestConfig(),
      "C:/project",
      {
        createRuntime: async () =>
          createFakeEsseRuntime({
            getLastAssistantText: () => '{"reply":"旧 JSON 不应该再被解析成对象。","imageRequests":[{"prompt":"x"}]}'
          })
      }
    );

    expect(result).toEqual({ reply: '{"reply":"旧 JSON 不应该再被解析成对象。","imageRequests":[{"prompt":"x"}]}' });
  });

  test("does not call the runtime when the user references a missing attachment", async () => {
    let runtimeCreated = false;

    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "按附件里的参考图继续生成三张内部设计图" }],
        sessions: []
      },
      createEsseTestConfig(),
      "C:/project",
      {
        createRuntime: async () => {
          runtimeCreated = true;
          throw new Error("runtime should not be created");
        }
      }
    );

    expect(runtimeCreated).toBe(false);
    expect(result).toEqual({
      reply: "我没有收到可用的参考图附件，请先粘贴或添加参考图后再发送。"
    });
  });

  test("publishes Pi message updates as visible Esse progress once per turn", async () => {
    const publicMessages: string[] = [];

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "帮我看看这批图适合怎么做" }],
        sessions: []
      },
      createEsseTestConfig(),
      "C:/project",
      {
        createRuntime: async () =>
          createFakeEsseRuntime({
            subscribe: (listener) => {
              listener({ type: "message_update" });
              listener({ type: "message_update" });
              listener({ type: "message_update" });
              return () => undefined;
            }
          }),
        logger: createCapturingLogger(publicMessages)
      }
    );

    expect(publicMessages).toContain("Esse 正在组织回复...");
    expect(publicMessages.filter((message) => message === "Esse 正在组织回复...")).toHaveLength(1);
  });

  test("reuses the cached Esse runtime on follow-up turns and sends an incremental prompt", async () => {
    const registry = new AgentRuntimeRegistry();
    const prompts: string[] = [];
    let factoryCalls = 0;

    const deps = {
      registry,
      createRuntime: async () => {
        factoryCalls += 1;
        return createFakeEsseRuntime({
          getLastAssistantText: () => `回复 ${prompts.length}`,
          onPrompt: (prompt) => prompts.push(prompt)
        });
      }
    };

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "把这批图统一成白底商品图" }],
        sessions: [{ fileName: "flower.jpg", id: "img-1" }]
      },
      createEsseTestConfig(),
      "C:\\project",
      deps
    );
    await runEsseAgentTurn(
      {
        messages: [
          { role: "user", content: "把这批图统一成白底商品图" },
          { role: "assistant", content: "回复 1" },
          { role: "user", content: "第二轮再做成暖光家居场景" }
        ],
        sessions: [{ currentImagePath: "C:\\project\\images\\generated\\flower.png", fileName: "flower.jpg", id: "img-1" }]
      },
      createEsseTestConfig(),
      "C:\\project",
      deps
    );

    expect(factoryCalls).toBe(1);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("==== 对话历史 ====");
    expect(prompts[0]).toContain("把这批图统一成白底商品图");
    expect(prompts[1]).toContain("==== 环境更新 ====");
    expect(prompts[1]).toContain("第二轮再做成暖光家居场景");
    expect(prompts[1]).not.toContain("==== 对话历史 ====");
    expect(prompts[1]).not.toContain("输出契约");
  });

  test("clears a prior Esse runtime when a fresh missing-reference turn is handled locally", async () => {
    const registry = new AgentRuntimeRegistry();
    let factoryCalls = 0;

    const deps = {
      registry,
      createRuntime: async () => {
        factoryCalls += 1;
        return createFakeEsseRuntime();
      }
    };

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "先聊一下这批图" }],
        sessions: []
      },
      createEsseTestConfig(),
      "C:\\project",
      deps
    );
    expect(registry.has("esse:c:/project")).toBe(true);

    const missingResult = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "按附件里的参考图继续生成三张图" }],
        sessions: []
      },
      createEsseTestConfig(),
      "C:\\project",
      deps
    );

    expect(missingResult.reply).toContain("没有收到可用的参考图附件");
    expect(registry.has("esse:c:/project")).toBe(false);
  });

  test("rebuilds the Esse runtime when the user starts a fresh project conversation", async () => {
    const registry = new AgentRuntimeRegistry();
    let factoryCalls = 0;

    const deps = {
      registry,
      createRuntime: async () => {
        factoryCalls += 1;
        return createFakeEsseRuntime();
      }
    };

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "第一轮需求" }],
        sessions: []
      },
      createEsseTestConfig(),
      "C:\\project",
      deps
    );
    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "清空后重新开始" }],
        sessions: []
      },
      createEsseTestConfig(),
      "C:\\project",
      deps
    );

    expect(factoryCalls).toBe(2);
  });

  test("can drive workspace tools in a plain-text Esse turn", async () => {
    const workspaceRuntime = createTestWorkspaceRuntime({
      project: createTestProjectMetadata(),
      selectedSessionId: "sess_1",
      sessions: [
        {
          chatMessages: [],
          chatStatus: "idle",
          filePath: "C:/project/original/flower.jpg",
          fileName: "flower.jpg",
          generatedFilePath: "C:/project/generated/a-2.png",
          generatedFilePaths: ["C:/project/generated/a-1.png", "C:/project/generated/a-2.png"],
          id: "sess_1",
          status: "idle"
        }
      ]
    });
    const toolTrace: string[] = [];
    let capturedPrompt = "";
    let registeredToolNames: string[] = [];

    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "把 img-1 回退到记录1，然后删除记录2" }],
        selectedSessionId: "sess_1",
        sessions: workspaceRuntime.getState().sessions.map((session) => ({
          currentImagePath: session.generatedFilePath ?? session.filePath,
          fileName: session.fileName,
          generatedFilePaths: session.generatedFilePaths,
          id: session.id
        }))
      },
      createEsseTestConfig(),
      "C:/project",
      {
        createRuntime: async (options) => {
          const customTools = options.customToolDefinitions as Array<{
            execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
            name: string;
          }>;
          registeredToolNames = customTools.map((tool) => tool.name);
          return createFakeEsseRuntime({
            getLastAssistantText: () => "已把 img-1 回退到记录 1，并删除记录 2。",
            onPrompt: async (prompt) => {
              capturedPrompt = prompt;
              const byName = new Map(customTools.map((tool) => [tool.name, tool]));
              for (const [name, params] of [
                ["list_sessions", {}],
                ["get_session_records", { sessionId: "sess_1" }],
                ["restore_session_record", { recordIndex: 1, sessionId: "sess_1" }],
                ["delete_session_record", { recordIndex: 2, sessionId: "sess_1" }]
              ] as const) {
                toolTrace.push(name);
                await byName.get(name)?.execute(`call-${toolTrace.length}`, params);
              }
            }
          });
        },
        workspaceToolRuntime: workspaceRuntime
      }
    );

    expect(result).toEqual({ reply: "已把 img-1 回退到记录 1，并删除记录 2。" });
    expect(registeredToolNames).toEqual(
      expect.arrayContaining(["list_sessions", "get_session_records", "restore_session_record", "delete_session_record"])
    );
    expect(capturedPrompt).toContain("工作区工具模式");
    expect(capturedPrompt).toContain("当前界面焦点图片：img-1");
    expect(capturedPrompt).toContain("回退或删除记录前必须调用 get_session_records");
    expect(capturedPrompt).not.toContain("只返回一个 JSON 对象");
    expect(toolTrace).toEqual(["list_sessions", "get_session_records", "restore_session_record", "delete_session_record"]);
    expect(workspaceRuntime.getState().sessions[0]).toEqual({
      chatMessages: [],
      chatStatus: "idle",
      filePath: "C:/project/original/flower.jpg",
      fileName: "flower.jpg",
      generatedFilePath: "C:/project/generated/a-1.png",
      generatedFilePaths: ["C:/project/generated/a-1.png"],
      id: "sess_1",
      showOriginalInList: false,
      status: "idle"
    });
  });
});

function createEsseTestConfig() {
  return {
    apiKey: "coding-key",
    baseUrl: "https://api.tu-zi.com/coding",
    model: "gpt-5.5"
  };
}

function createTestProjectMetadata(): ProjectSnapshot["project"] {
  return {
    createdAt: "2026-05-24T00:00:00.000Z",
    directory: "C:/project",
    id: "project_1",
    imageCount: 1,
    name: "测试项目",
    updatedAt: "2026-05-24T00:00:00.000Z"
  };
}

function createFakeEsseRuntime(
  options: {
    getLastAssistantText?: () => string;
    onPrompt?: (prompt: string) => void | Promise<void>;
    subscribe?: (listener: (event: unknown) => void) => () => void;
  } = {}
): AgentRuntime {
  return {
    abort: async () => undefined,
    descriptor: {
      builtInTools: [],
      customTools: [],
      model: "gpt-5.5",
      projectDirectory: "C:\\project",
      sessionId: "esse-agent"
    },
    dispose: () => undefined,
    getLastAssistantText: options.getLastAssistantText ?? (() => "收到。"),
    prompt: async (prompt) => {
      await options.onPrompt?.(prompt);
    },
    subscribe: options.subscribe ?? (() => () => undefined)
  };
}

function createTestWorkspaceRuntime(initialState: EsseWorkspaceState): EsseWorkspaceToolRuntime & { getState: () => EsseWorkspaceState } {
  let state = initialState;
  return {
    applyMutation: async (mutator) => {
      const result = mutator(state);
      if (result.result.ok) {
        state = result.state;
      }
      return result;
    },
    getState: () => state
  };
}

function createCapturingLogger(publicMessages: string[]): AppLogger {
  function capture(_message: string, options?: BackendLogOptions): void {
    if (options?.publicMessage) {
      publicMessages.push(options.publicMessage);
    }
  }

  return {
    debug: capture,
    error: capture,
    getEntries: () => [],
    info: capture,
    subscribe: () => () => undefined,
    warn: capture
  };
}
