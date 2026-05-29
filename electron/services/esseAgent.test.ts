import { describe, expect, test } from "vitest";
import type { AppLogger, BackendLogOptions } from "./appLogger";
import type { AgentRuntime, CreateAgentRuntimeOptions } from "./agentRuntime";
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
    expect(capturedPrompt).toContain("渲染器支持原生 emoji");
    expect(capturedPrompt).toContain(":sparkles:");
    expect(capturedPrompt).toContain("不要在工具参数、文件名、图片生成 prompt 里使用 emoji");
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
    expect(capturedPrompt).toContain("禁止用 bash/sqlite 查询 project.sqlite");
    expect(capturedPrompt).not.toContain("read_project_file");
    expect(capturedPrompt).not.toContain("write_project_file");
    expect(capturedPrompt).not.toContain("append_project_file");
    expect(capturedPrompt).toContain("generate_image 和 run_batch_generation 是本项目生图 API 的唯一入口");
    expect(capturedPrompt).toContain("调用 generate_image、run_batch_generation 或 package_generated_images 会立刻在界面插入确认卡，并挂起当前 turn 等待用户选择执行、修改或取消。");
    expect(capturedPrompt).toContain("决定调用这些工具后，不要先输出追问、旧方案已取消、请确认后我再执行等自然语言");
    expect(capturedPrompt).toContain("把 commands 拆成每批最多 10 条");
    expect(capturedPrompt).toContain("若还有下一批未提交，继续调用 run_batch_generation 产出下一张确认卡");
    expect(capturedPrompt).not.toMatch(/\bplan\b|imageRequests/);
  });

  test("instructs Esse to put scene base images first for turn-reference scene replacement", async () => {
    let capturedPrompt = "";

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "分别用【图片1】【图片2】生成场景图，场景图是【图片5】，大小参考【图片4】" }],
        referenceImagePaths: [
          "C:/project/uploads/plant-a.jpg",
          "C:/project/uploads/plant-b.jpg",
          "C:/project/uploads/leaf.jpg",
          "C:/project/uploads/scale.jpg",
          "C:/project/uploads/scene.jpg"
        ],
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
        registry: new AgentRuntimeRegistry(),
        workspaceToolRuntime: createTestWorkspaceRuntime({
          project: createTestProjectMetadata(),
          sessions: []
        })
      }
    );

    expect(capturedPrompt).toContain("referenceImageNames 是同顺序的局部命名");
    expect(capturedPrompt).toContain("不能靠执行层猜");
    expect(capturedPrompt).toContain("referenceImageIds=[turn-ref-5, turn-ref-1, turn-ref-4]");
    expect(capturedPrompt).toContain("referenceImageNames=[场景图, 目标植物, 大小参考]");
    expect(capturedPrompt).toContain("scene_from_img2 用 [turn-ref-5, turn-ref-2, turn-ref-4]");
    expect(capturedPrompt).toContain("prompt 里不要写【图片5】等用户界面编号");
  });

  test("renders reusable conversation reference candidates without auto-attaching them", async () => {
    let capturedPrompt = "";

    await runEsseAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "先用这张参考图出一版",
            referenceFilePaths: ["C:/project/uploads/style.jpg"]
          },
          { role: "assistant", content: "已提交一版。" },
          { role: "user", content: "沿用刚才的参考图，再生成一张" }
        ],
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
        registry: new AgentRuntimeRegistry(),
        workspaceToolRuntime: createTestWorkspaceRuntime({
          project: createTestProjectMetadata(),
          sessions: []
        })
      }
    );

    expect(capturedPrompt).toContain("==== 对话参考图候选 ====");
    expect(capturedPrompt).toContain("conversation-ref-1：fileName=style.jpg；filePath=C:/project/uploads/style.jpg");
    expect(capturedPrompt).toContain("只有用户本轮明确要沿用、继续或使用这些图时");
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

  test("surfaces the SDK assistant error when Esse finishes without assistant text", async () => {
    await expect(
      runEsseAgentTurn(
        {
          messages: [{ role: "user", content: "你好" }],
          sessions: []
        },
        createEsseTestConfig(),
        "C:/project",
        {
          createRuntime: async () =>
            createFakeEsseRuntime({
              getLastAssistantError: () => "Provider returned no choices",
              getLastAssistantText: () => ""
            })
        }
      )
    ).rejects.toThrow("Esse 模型调用失败：Provider returned no choices");
  });

  test("passes reference wording to Esse instead of locally blocking missing attachments", async () => {
    let capturedPrompt = "";

    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "按附件里的参考图继续生成三张内部设计图" }],
        sessions: []
      },
      createEsseTestConfig(),
      "C:/project",
      {
        createRuntime: async () =>
          createFakeEsseRuntime({
            getLastAssistantText: () => "我会先检查当前工作区和本轮可用图片，再决定是否需要让你补充参考图。",
            onPrompt: (prompt) => {
              capturedPrompt = prompt;
            }
          })
      }
    );

    expect(result).toEqual({
      reply: "我会先检查当前工作区和本轮可用图片，再决定是否需要让你补充参考图。"
    });
    expect(capturedPrompt).toContain("按附件里的参考图继续生成三张内部设计图");
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

  test("streams assistant message updates from Pi message updates", async () => {
    const streamedMessages: string[] = [];
    let currentAssistantText = "";
    let runtimeListener: ((event: unknown) => void) | undefined;

    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "帮我看看这批图适合怎么做" }],
        sessions: []
      },
      createEsseTestConfig(),
      "C:/project",
      {
        createRuntime: async () =>
          createFakeEsseRuntime({
            getLastAssistantText: () => currentAssistantText,
            onPrompt: () => {
              currentAssistantText = "先做两个方向";
              runtimeListener?.({ type: "message_update" });
              currentAssistantText = "先做两个方向，再出确认卡。";
              runtimeListener?.({ type: "message_update" });
            },
            subscribe: (listener) => {
              runtimeListener = listener;
              return () => undefined;
            }
          }),
        onAssistantMessageUpdate: (content) => streamedMessages.push(content)
      }
    );

    expect(result).toEqual({ reply: "先做两个方向，再出确认卡。" });
    expect(streamedMessages).toEqual(["先做两个方向", "先做两个方向，再出确认卡。"]);
  });

  test("does not stream the cached previous assistant reply as the new turn starts", async () => {
    const streamedMessages: string[] = [];
    let currentAssistantText = "上一条回复";
    let runtimeListener: ((event: unknown) => void) | undefined;

    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "继续处理" }],
        sessions: []
      },
      createEsseTestConfig(),
      "C:/project",
      {
        createRuntime: async () =>
          createFakeEsseRuntime({
            getLastAssistantText: () => currentAssistantText,
            onPrompt: () => {
              runtimeListener?.({ type: "message_update" });
              currentAssistantText = "新的回复";
              runtimeListener?.({ type: "message_update" });
            },
            subscribe: (listener) => {
              runtimeListener = listener;
              return () => undefined;
            }
          }),
        onAssistantMessageUpdate: (content) => streamedMessages.push(content)
      }
    );

    expect(result).toEqual({ reply: "新的回复" });
    expect(streamedMessages).toEqual(["新的回复"]);
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

  test("includes the previous preflight plan context when the user only asks for adjustments", async () => {
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
      },
      workspaceToolRuntime: createTestWorkspaceRuntime({
        project: createTestProjectMetadata(),
        sessions: []
      })
    };

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "给图1做商品图" }],
        sessions: [{ fileName: "flower.jpg", id: "sess_1" }]
      },
      createEsseTestConfig(),
      "C:\\project",
      deps
    );
    await runEsseAgentTurn(
      {
        messages: [
          { role: "user", content: "给图1做商品图" },
          {
            role: "assistant",
            content:
              "【上一版待确认计划】状态：待用户确认；工具：generate_image；任务数：1；requestId：request-1\n任务1：displayLabel=img-1；target=existing sessionId=sess_1；mode=edit；size=未指定；referenceImageIds=无；prompt=统一做白底商品图"
          },
          { role: "user", content: "不要白底，背景改成浅灰" }
        ],
        sessions: [{ fileName: "flower.jpg", id: "sess_1" }]
      },
      createEsseTestConfig(),
      "C:\\project",
      deps
    );

    expect(factoryCalls).toBe(1);
    expect(prompts[1]).toContain("==== 最近计划上下文 ====");
    expect(prompts[1]).toContain("统一做白底商品图");
    expect(prompts[1]).toContain("不要白底，背景改成浅灰");
    expect(prompts[1]).toContain("重新调用 generate_image 或 run_batch_generation 输出新的确认卡");
  });

  test("includes submitted batch image references when the user revises a previous plan", async () => {
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
      },
      workspaceToolRuntime: createTestWorkspaceRuntime({
        project: createTestProjectMetadata(),
        sessions: []
      })
    };

    await runEsseAgentTurn(
      {
        messages: [
          {
            role: "assistant",
            content:
              "【已提交生成计划】batchTaskId：batch_1；任务数：4\n任务1：scene-1.png；mode=generate；referenceImageIds=turn-ref-5,turn-ref-1,turn-ref-4；referenceImageNames=场景图,目标植物,大小参考；prompt=以场景图为待保留场景，将目标植物自然替换进去\n任务2：scene-2.png；mode=generate；referenceImageIds=turn-ref-5,turn-ref-2,turn-ref-4；referenceImageNames=场景图,目标植物,大小参考；prompt=以场景图为待保留场景，将目标植物自然替换进去"
          },
          { role: "user", content: "重新生成两个商品图，要保留原始的花盆" }
        ],
        sessions: []
      },
      createEsseTestConfig(),
      "C:/project",
      deps
    );

    expect(factoryCalls).toBe(1);
    expect(prompts[0]).toContain("==== 最近计划上下文 ====");
    expect(prompts[0]).toContain("referenceImageIds=turn-ref-5,turn-ref-1,turn-ref-4");
    expect(prompts[0]).toContain("referenceImageNames=场景图,目标植物,大小参考");
    expect(prompts[0]).toContain("重新生成两个商品图，要保留原始的花盆");
  });

  test("reused workspace tools read the current turn runtime state", async () => {
    const registry = new AgentRuntimeRegistry();
    const listedFileNames: string[] = [];
    let factoryCalls = 0;

    const createRuntime = async (options: CreateAgentRuntimeOptions) => {
      factoryCalls += 1;
      const customTools = await collectRuntimeTools(options) as Array<{
        execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ details?: Record<string, unknown> }>;
        name: string;
      }>;
      return createFakeEsseRuntime({
        getLastAssistantText: () => `已读取 ${listedFileNames.length} 次。`,
        onPrompt: async () => {
          const listSessions = customTools.find((tool) => tool.name === "list_sessions");
          const result = await listSessions?.execute(`list-${listedFileNames.length + 1}`, {});
          const sessions = result?.details?.sessions as Array<{ fileName: string }> | undefined;
          if (sessions?.[0]) {
            listedFileNames.push(sessions[0].fileName);
          }
        }
      });
    };

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "列一下工作区" }],
        sessions: [{ fileName: "first.jpg", id: "sess_1" }]
      },
      createEsseTestConfig(),
      "C:/project",
      {
        createRuntime,
        registry,
        workspaceToolRuntime: createTestWorkspaceRuntime({
          project: createTestProjectMetadata(),
          sessions: [
            {
              chatMessages: [],
              chatStatus: "idle",
              fileName: "first.jpg",
              filePath: "C:/project/original/first.jpg",
              id: "sess_1",
              status: "idle"
            }
          ]
        })
      }
    );
    await runEsseAgentTurn(
      {
        messages: [
          { role: "user", content: "列一下工作区" },
          { role: "assistant", content: "已读取 1 次。" },
          { role: "user", content: "再列一下工作区" }
        ],
        sessions: [{ fileName: "second.jpg", id: "sess_2" }]
      },
      createEsseTestConfig(),
      "C:/project",
      {
        createRuntime,
        registry,
        workspaceToolRuntime: createTestWorkspaceRuntime({
          project: createTestProjectMetadata(),
          sessions: [
            {
              chatMessages: [],
              chatStatus: "idle",
              fileName: "second.jpg",
              filePath: "C:/project/original/second.jpg",
              id: "sess_2",
              status: "idle"
            }
          ]
        })
      }
    );

    expect(factoryCalls).toBe(1);
    expect(listedFileNames).toEqual(["first.jpg", "second.jpg"]);
  });

  test("routes a fresh reference-wording turn through a rebuilt Esse runtime", async () => {
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

    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "按附件里的参考图继续生成三张图" }],
        sessions: []
      },
      createEsseTestConfig(),
      "C:\\project",
      deps
    );

    expect(result.reply).toBe("收到。");
    expect(factoryCalls).toBe(2);
    expect(registry.has("esse:c:/project")).toBe(true);
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
          const customTools = await collectRuntimeTools(options) as Array<{
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
    expect(capturedPrompt).toContain("默认不要假设自己知道左侧工作区内容");
    expect(capturedPrompt).toContain("用户说“左侧”“添加到左侧”“放到左侧”时，通常就是让你把图片加入或整理到这个工作区");
    expect(capturedPrompt).toContain("多张图片必须在一次 add_workspace_image 调用里传 images=[{filePath,fileName}, ...]");
    expect(capturedPrompt).toContain("==== 当前工作区快照 ====");
    expect(capturedPrompt).toContain("img-1：sessionId=sess_1；referenceImageId=workspace-ref-sess_1；fileName=flower.jpg；generatedRecordCount=2；selected=true");
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

  test("registers controlled bash and renders available skills in the prompt", async () => {
    const workspaceRuntime = createTestWorkspaceRuntime({
      project: createTestProjectMetadata(),
      sessions: []
    });
    let capturedPrompt = "";
    let directCustomToolNames: string[] = [];
    let extensionToolNames: string[] = [];
    let registeredToolNames: string[] = [];

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "导出 Excel 给我" }],
        sessions: []
      },
      createEsseTestConfig(),
      "C:/project",
      {
        bashTool: { name: "bash" },
        createRuntime: async (options) => {
          directCustomToolNames = (options.customToolDefinitions ?? []).map((tool) => (tool as { name?: string }).name ?? "");
          extensionToolNames = options.extensionToolNames ?? [];
          const customTools = await collectRuntimeTools(options) as Array<{ name: string }>;
          registeredToolNames = customTools.map((tool) => tool.name);
          return createFakeEsseRuntime({
            onPrompt: (prompt) => {
              capturedPrompt = prompt;
            }
          });
        },
        skillLoader: createFakeSkillLoader("<skills><skill name=\"xlsx-export\">导出 Excel</skill></skills>"),
        workspaceToolRuntime: workspaceRuntime
      }
    );

    expect(registeredToolNames).toEqual(expect.arrayContaining(["bash", "list_sessions"]));
    expect(directCustomToolNames).toEqual(["bash"]);
    expect(extensionToolNames).toEqual(expect.arrayContaining(["list_sessions", "generate_image", "rename_session"]));
    expect(capturedPrompt).toContain("Available skills");
    expect(capturedPrompt).toContain("xlsx-export");
    expect(capturedPrompt).toContain("先用 read 读取对应 SKILL.md，再用 bash 执行");
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
    getLastAssistantError?: () => string | undefined;
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
    getLastAssistantError: options.getLastAssistantError ?? (() => undefined),
    getLastAssistantText: options.getLastAssistantText ?? (() => "收到。"),
    prompt: async (prompt) => {
      await options.onPrompt?.(prompt);
    },
    subscribe: options.subscribe ?? (() => () => undefined)
  };
}

async function collectRuntimeTools(options: CreateAgentRuntimeOptions): Promise<unknown[]> {
  const extensionTools: unknown[] = [];
  for (const factory of options.extensionFactories ?? []) {
    if (typeof factory !== "function") {
      continue;
    }
    await factory({
      registerTool: (tool: unknown) => {
        extensionTools.push(tool);
      }
    });
  }

  return [...extensionTools, ...(options.customToolDefinitions ?? [])];
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

function createFakeSkillLoader(skillsPrompt: string) {
  return {
    formatForPrompt: () => skillsPrompt,
    get: () => undefined,
    list: () => [],
    matchSkillByCwd: () => undefined,
    reload: async () => ({ diagnostics: [], skills: [] })
  };
}
