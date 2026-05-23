import { describe, expect, test } from "vitest";
import type { AppLogger, BackendLogOptions } from "./appLogger";
import type { AgentRuntime } from "./agentRuntime";
import { AgentRuntimeRegistry } from "./agentRuntimeRegistry";
import { runEsseAgentTurn, runEssePlanTurn } from "./esseAgent";

describe("esseAgent", () => {
  test("defaults Esse to the true designer persona in the runtime prompt", async () => {
    let capturedPrompt = "";

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "帮我处理这批图" }],
        sessions: []
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:/project",
      {
        createRuntime: async (options) => ({
          descriptor: {
            builtInTools: [],
            customTools: [],
            model: options.model,
            projectDirectory: options.projectDirectory,
            sessionId: options.sessionId
          },
          dispose: () => undefined,
          getLastAssistantText: () => JSON.stringify({ reply: "我会先判断目标和用户价值，再给出执行方案。" }),
          prompt: async (prompt) => {
            capturedPrompt = prompt;
          },
          subscribe: () => () => undefined
        })
      }
    );

    expect(capturedPrompt).toContain("当前人格：真正的设计师");
    expect(capturedPrompt).toContain("像资深商业视觉设计师一样工作");
    expect(capturedPrompt).toContain("有审美取向的默认方案");
    expect(capturedPrompt).toContain("当前选中图片只是界面焦点，不等于输入图");
    expect(capturedPrompt).toContain("用户说“这张图”“这个参考图”“根据这张图”默认指本轮参考图");
  });

  test("passes the selected question girl persona into the runtime prompt", async () => {
    let capturedPrompt = "";

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "把这批图弄好" }],
        persona: "question-girl",
        sessions: []
      } as Parameters<typeof runEsseAgentTurn>[0],
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:/project",
      {
        createRuntime: async (options) => ({
          descriptor: {
            builtInTools: [],
            customTools: [],
            model: options.model,
            projectDirectory: options.projectDirectory,
            sessionId: options.sessionId
          },
          dispose: () => undefined,
          getLastAssistantText: () => JSON.stringify({ reply: "你希望先统一主图标准，还是先探索场景方向？" }),
          prompt: async (prompt) => {
            capturedPrompt = prompt;
          },
          subscribe: () => () => undefined
        })
      }
    );

    expect(capturedPrompt).toContain("当前人格：问题少女");
    expect(capturedPrompt).toContain("敏锐、挑剔但有审美判断力的设计搭档");
    expect(capturedPrompt).toContain("不要为了人格而硬追问");
    expect(capturedPrompt).toContain("每次反问后都要给用户一个可直接确认的默认建议");
  });

  test.each([
    ["old-ox", ["当前人格：牛马设计师", "高执行、少废话、快速交付", "用合理默认值继续推进"]],
    ["robot", ["当前人格：无情的机器人", "低温、结构化、可预测", "不使用玩笑、情绪化表达或拟人化口吻"]]
  ] as const)("passes the selected %s persona into the runtime prompt", async (persona, expectedSnippets) => {
    let capturedPrompt = "";

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "把这批图弄好" }],
        persona,
        sessions: []
      } as Parameters<typeof runEsseAgentTurn>[0],
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:/project",
      {
        createRuntime: async (options) => ({
          descriptor: {
            builtInTools: [],
            customTools: [],
            model: options.model,
            projectDirectory: options.projectDirectory,
            sessionId: options.sessionId
          },
          dispose: () => undefined,
          getLastAssistantText: () => JSON.stringify({ reply: "已按当前人格处理。" }),
          prompt: async (prompt) => {
            capturedPrompt = prompt;
          },
          subscribe: () => () => undefined
        })
      }
    );

    for (const snippet of expectedSnippets) {
      expect(capturedPrompt).toContain(snippet);
    }
  });

  test("returns a conversational reply without requiring a plan", async () => {
    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "这批图适合做什么方向？" }],
        sessions: []
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:/project",
      {
        createRuntime: async (options) => ({
          descriptor: {
            builtInTools: [],
            customTools: [],
            model: options.model,
            projectDirectory: options.projectDirectory,
            sessionId: options.sessionId
          },
          dispose: () => undefined,
          getLastAssistantText: () => JSON.stringify({ reply: "可以先统一成白底主图，再做几张场景图。" }),
          prompt: async () => undefined,
          subscribe: () => () => undefined
        })
      }
    );

    expect(result).toEqual({
      reply: "可以先统一成白底主图，再做几张场景图。"
    });
  });

  test("does not call the runtime when the user references a missing attachment", async () => {
    let runtimeCreated = false;

    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "按附件里的参考图继续生成三张内部设计图" }],
        sessions: []
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
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

  test("publishes Pi message updates as visible Esse progress", async () => {
    const publicMessages: string[] = [];

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "帮我看看这批图适合怎么做" }],
        sessions: []
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:/project",
      {
        createRuntime: async (options) => ({
          descriptor: {
            builtInTools: [],
            customTools: [],
            model: options.model,
            projectDirectory: options.projectDirectory,
            sessionId: options.sessionId
          },
          dispose: () => undefined,
          getLastAssistantText: () => JSON.stringify({ reply: "我建议先统一成白底主图。" }),
          prompt: async () => undefined,
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

  test("can return a draft batch plan for user confirmation", async () => {
    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "给这两张图做一套批处理方案" }],
        outputSize: "2048x1152",
        sessions: [
          { fileName: "a.jpg", id: "img-1" },
          { fileName: "b.jpg", id: "img-2" }
        ]
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:/project",
      {
        createRuntime: async (options) => ({
          descriptor: {
            builtInTools: [],
            customTools: [],
            model: options.model,
            projectDirectory: options.projectDirectory,
            sessionId: options.sessionId
          },
          dispose: () => undefined,
          getLastAssistantText: () =>
            JSON.stringify({
              plan: {
                commands: [
                  { constraints: ["保留主体"], instruction: "生成白底主图", targetSessionId: "img-1" },
                  { constraints: ["保留主体"], instruction: "生成白底主图", targetSessionId: "img-2" }
                ],
                globalInstruction: "统一白底商品图",
                title: "白底主图"
              },
              reply: "我先给你拆成两张白底主图任务，确认后执行。"
            }),
          prompt: async () => undefined,
          subscribe: () => () => undefined
        })
      }
    );

    expect(result.reply).toBe("我先给你拆成两张白底主图任务，确认后执行。");
    expect(result.plan).toMatchObject({
      outputSize: "2048x1152",
      status: "draft",
      targetSessionIds: ["img-1", "img-2"],
      title: "白底主图"
    });
    expect(result.plan?.commands[0]).toMatchObject({
      outputSize: "2048x1152",
      source: "project-manager",
      targetSessionId: "img-1"
    });
  });

  test("can create a direct batch plan from the batch dialog prompt", async () => {
    const runtimePrompts: string[] = [];

    const plan = await runEssePlanTurn(
      {
        outputSize: "3840x2160",
        prompt: "把这批花做成统一暖色家居商品图",
        referenceImagePaths: ["C:/project/references/room.png"],
        sessions: [
          { fileName: "flower-a.jpg", id: "img-1" },
          { fileName: "flower-b.jpg", id: "img-2" }
        ]
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:/project",
      {
        createRuntime: async (options) => ({
          descriptor: {
            builtInTools: [],
            customTools: [],
            model: options.model,
            projectDirectory: options.projectDirectory,
            sessionId: options.sessionId
          },
          dispose: () => undefined,
          getLastAssistantText: () =>
            JSON.stringify({
              plan: {
                commands: [
                  {
                    constraints: ["保留花材颜色"],
                    instruction: "生成客厅茶几场景鲜花商品图",
                    targetSessionId: "img-1"
                  },
                  {
                    constraints: ["保留花材颜色"],
                    instruction: "生成卧室床头柜场景鲜花商品图",
                    targetSessionId: "img-2"
                  }
                ],
                globalInstruction: "统一暖色家居环境，保留花材颜色和形态",
                title: "暖色家居鲜花商品图"
              },
              reply: "我先生成一套批量方案，确认后执行。"
            }),
          prompt: async (prompt) => {
            runtimePrompts.push(prompt);
          },
          subscribe: () => () => undefined
        })
      }
    );

    expect(runtimePrompts[0]).toContain("Esse智能体");
    expect(runtimePrompts[0]).toContain("把这批花做成统一暖色家居商品图");
    expect(runtimePrompts[0]).toContain("img-1：flower-a.jpg");
    expect(plan).toMatchObject({
      globalInstruction: "统一暖色家居环境，保留花材颜色和形态",
      outputSize: "3840x2160",
      status: "draft",
      targetSessionIds: ["img-1", "img-2"],
      title: "暖色家居鲜花商品图"
    });
    expect(plan.commands).toEqual([
      {
        constraints: ["保留花材颜色"],
        id: expect.stringMatching(/^cmd-/),
        instruction: "生成客厅茶几场景鲜花商品图",
        outputSize: "3840x2160",
        planId: plan.id,
        referenceImageIds: ["ref-1"],
        source: "project-manager",
        targetSessionId: "img-1"
      },
      {
        constraints: ["保留花材颜色"],
        id: expect.stringMatching(/^cmd-/),
        instruction: "生成卧室床头柜场景鲜花商品图",
        outputSize: "3840x2160",
        planId: plan.id,
        referenceImageIds: ["ref-1"],
        source: "project-manager",
        targetSessionId: "img-2"
      }
    ]);
  });

  test("rejects direct plan creation when the prompt references a missing attachment", async () => {
    let runtimeCreated = false;

    await expect(
      runEssePlanTurn(
        {
          prompt: "按附件里的参考图给这批图做方案",
          sessions: [{ fileName: "flower-a.jpg", id: "img-1" }]
        },
        {
          apiKey: "coding-key",
          baseUrl: "https://api.tu-zi.com/coding",
          model: "gpt-5.5"
        },
        "C:/project",
        {
          createRuntime: async () => {
            runtimeCreated = true;
            throw new Error("runtime should not be created");
          }
        }
      )
    ).rejects.toThrow("我没有收到可用的参考图附件");

    expect(runtimeCreated).toBe(false);
  });

  test("throws a clear error when direct plan creation returns no usable plan", async () => {
    await expect(
      runEssePlanTurn(
        {
          prompt: "做白底图",
          referenceImagePaths: [],
          sessions: [{ fileName: "flower-a.jpg", id: "img-1" }]
        },
        {
          apiKey: "coding-key",
          baseUrl: "https://api.tu-zi.com/coding",
          model: "gpt-5.5"
        },
        "C:/project",
        {
          createRuntime: async (options) => ({
            descriptor: {
              builtInTools: [],
              customTools: [],
              model: options.model,
              projectDirectory: options.projectDirectory,
              sessionId: options.sessionId
            },
            dispose: () => undefined,
            getLastAssistantText: () => JSON.stringify({ reply: "我觉得可以做白底图。" }),
            prompt: async () => undefined,
            subscribe: () => () => undefined
          })
        }
      )
    ).rejects.toThrow("Esse 未返回有效的批量方案 JSON");
  });

  test("accepts legacy plan-only json for direct batch plan creation", async () => {
    const plan = await runEssePlanTurn(
      {
        prompt: "做白底图",
        referenceImagePaths: [],
        sessions: [{ fileName: "flower-a.jpg", id: "img-1" }]
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:/project",
      {
        createRuntime: async (options) => ({
          descriptor: {
            builtInTools: [],
            customTools: [],
            model: options.model,
            projectDirectory: options.projectDirectory,
            sessionId: options.sessionId
          },
          dispose: () => undefined,
          getLastAssistantText: () =>
            JSON.stringify({
              commands: [{ constraints: [], instruction: "生成白底图", targetSessionId: "img-1" }],
              globalInstruction: "统一白底",
              outputSize: "2048x2048",
              title: "白底图"
            }),
          prompt: async () => undefined,
          subscribe: () => () => undefined
        })
      }
    );

    expect(plan.outputSize).toBeUndefined();
    expect(plan.commands[0].outputSize).toBeUndefined();
    expect(plan.commands[0]).toMatchObject({
      constraints: [],
      instruction: "生成白底图",
      source: "project-manager",
      targetSessionId: "img-1"
    });
  });

  test("can request new image generation without existing sessions", async () => {
    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "生成 3 张玫瑰商品图" }],
        sessions: []
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:/project",
      {
        createRuntime: async (options) => ({
          descriptor: {
            builtInTools: [],
            customTools: [],
            model: options.model,
            projectDirectory: options.projectDirectory,
            sessionId: options.sessionId
          },
          dispose: () => undefined,
          getLastAssistantText: () =>
            JSON.stringify({
              imageRequests: [
                { prompt: "红玫瑰白底商品图", size: "2048x2048" },
                { prompt: "红玫瑰家居场景商品图" }
              ],
              reply: "我来生成两张新图。"
            }),
          prompt: async () => undefined,
          subscribe: () => () => undefined
        })
      }
    );

    expect(result.imageRequests).toEqual([
      { id: expect.stringMatching(/^esse-image-/), mode: "generate", prompt: "红玫瑰白底商品图", size: "2048x2048", target: "new" },
      { id: expect.stringMatching(/^esse-image-/), mode: "generate", prompt: "红玫瑰家居场景商品图", target: "new" }
    ]);
  });

  test("marks image requests with source sessions as edit tasks", async () => {
    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "基于第一张图派生两张咖啡馆场景图" }],
        sessions: [{ currentImagePath: "C:/project/images/original/train.jpg", fileName: "train.jpg", id: "img-1" }]
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:/project",
      {
        createRuntime: async (options) => ({
          descriptor: {
            builtInTools: [],
            customTools: [],
            model: options.model,
            projectDirectory: options.projectDirectory,
            sessionId: options.sessionId
          },
          dispose: () => undefined,
          getLastAssistantText: () =>
            JSON.stringify({
              imageRequests: [{ prompt: "保留火车箱结构，派生成春日咖啡馆", sourceSessionId: "img-1", target: "new" }],
              reply: "我会基于第一张图派生。"
            }),
          prompt: async () => undefined,
          subscribe: () => () => undefined
        })
      }
    );

    expect(result.imageRequests).toEqual([
      {
        id: expect.stringMatching(/^esse-image-/),
        mode: "edit",
        prompt: "保留火车箱结构，派生成春日咖啡馆",
        sourceSessionId: "img-1",
        target: "new"
      }
    ]);
  });

  test("does not treat the selected session as an input image when the user only pasted references", async () => {
    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "根据这张图，生成这个咖啡馆的内部构造，生成4张不同角度的" }],
        referenceImagePaths: ["C:/project/refs/cafe.jpg"],
        selectedSessionId: "img-3",
        sessions: [{ currentImagePath: "C:/project/images/current/machine.jpg", fileName: "machine.jpg", id: "img-3" }]
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:/project",
      {
        createRuntime: async (options) => ({
          descriptor: {
            builtInTools: [],
            customTools: [],
            model: options.model,
            projectDirectory: options.projectDirectory,
            sessionId: options.sessionId
          },
          dispose: () => undefined,
          getLastAssistantText: () =>
            JSON.stringify({
              imageRequests: [{ prompt: "生成咖啡馆内部构造正面视角", sourceSessionId: "img-3", target: "new" }],
              reply: "我来派发 4 个基于当前图片的不同角度结构派生任务。"
            }),
          prompt: async () => undefined,
          subscribe: () => () => undefined
        })
      }
    );

    expect(result.imageRequests).toEqual([
      {
        id: expect.stringMatching(/^esse-image-/),
        mode: "generate",
        prompt: "生成咖啡馆内部构造正面视角",
        target: "new"
      }
    ]);
  });

  test("allows the selected session as an input image when the user explicitly asks for the selected image", async () => {
    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "基于当前选中图，并参考这张图，生成4张不同角度的内部构造" }],
        referenceImagePaths: ["C:/project/refs/cafe.jpg"],
        selectedSessionId: "img-3",
        sessions: [{ currentImagePath: "C:/project/images/current/machine.jpg", fileName: "machine.jpg", id: "img-3" }]
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:/project",
      {
        createRuntime: async (options) => ({
          descriptor: {
            builtInTools: [],
            customTools: [],
            model: options.model,
            projectDirectory: options.projectDirectory,
            sessionId: options.sessionId
          },
          dispose: () => undefined,
          getLastAssistantText: () =>
            JSON.stringify({
              imageRequests: [{ prompt: "基于当前选中图生成内部构造正面视角", sourceSessionId: "img-3", target: "new" }],
              reply: "我会基于当前选中图派生。"
            }),
          prompt: async () => undefined,
          subscribe: () => () => undefined
        })
      }
    );

    expect(result.imageRequests).toEqual([
      {
        id: expect.stringMatching(/^esse-image-/),
        mode: "edit",
        prompt: "基于当前选中图生成内部构造正面视角",
        sourceSessionId: "img-3",
        target: "new"
      }
    ]);
  });

  test("can target an existing image session for direct edits", async () => {
    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "把第一张图直接改成白底商品图" }],
        sessions: [{ currentImagePath: "C:/project/images/original/flower.jpg", fileName: "flower.jpg", id: "img-1" }]
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:/project",
      {
        createRuntime: async (options) => ({
          descriptor: {
            builtInTools: [],
            customTools: [],
            model: options.model,
            projectDirectory: options.projectDirectory,
            sessionId: options.sessionId
          },
          dispose: () => undefined,
          getLastAssistantText: () =>
            JSON.stringify({
              imageRequests: [{ prompt: "保留主体，改成白底商品图", sourceSessionId: "img-1", target: "existing" }],
              reply: "我会派给第一张图的会话执行。"
            }),
          prompt: async () => undefined,
          subscribe: () => () => undefined
        })
      }
    );

    expect(result.imageRequests).toEqual([
      {
        id: expect.stringMatching(/^esse-image-/),
        mode: "edit",
        prompt: "保留主体，改成白底商品图",
        sourceSessionId: "img-1",
        target: "existing"
      }
    ]);
  });

  test("classifies packaging generated images to desktop as a file task, not a batch plan", async () => {
    const result = await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "帮我把新生成的图片打包放在桌面" }],
        sessions: [{ fileName: "generated.png", generatedFilePaths: ["C:/project/images/generated/out.png"], id: "img-1" }]
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:/project",
      {
        createRuntime: async (options) => ({
          descriptor: {
            builtInTools: [],
            customTools: [],
            model: options.model,
            projectDirectory: options.projectDirectory,
            sessionId: options.sessionId
          },
          dispose: () => undefined,
          getLastAssistantText: () =>
            JSON.stringify({
              fileTasks: [{ destination: "desktop", fileName: "BatchImager-新生成图片.zip", source: "generated-images", type: "package" }],
              reply: "这不是批处理方案，我会把已生成图片打包到桌面。"
            }),
          prompt: async () => undefined,
          subscribe: () => () => undefined
        })
      }
    );

    expect(result.plan).toBeUndefined();
    expect(result.imageRequests).toBeUndefined();
    expect(result.fileTasks).toEqual([
      {
        destination: "desktop",
        fileName: "BatchImager-新生成图片.zip",
        id: expect.stringMatching(/^esse-file-/),
        source: "generated-images",
        type: "package"
      }
    ]);
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
          getLastAssistantText: () => JSON.stringify({ reply: `回复 ${prompts.length}` }),
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
    expect(prompts[0]).toContain("==== 输出契约");
    expect(prompts[0]).toContain("把这批图统一成白底商品图");
    expect(prompts[1]).toContain("==== 环境更新 ====");
    expect(prompts[1]).not.toContain("==== 输出契约");
    expect(prompts[1]).toContain("第二轮再做成暖光家居场景");
    expect(prompts[1]).toContain("img-1：flower.jpg，当前图：C:\\project\\images\\generated\\flower.png");
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

  test("includes changed persona and current project images in the incremental prompt", async () => {
    const registry = new AgentRuntimeRegistry();
    const prompts: string[] = [];

    const deps = {
      registry,
      createRuntime: async () =>
        createFakeEsseRuntime({
          onPrompt: (prompt) => prompts.push(prompt)
        })
    };

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "先按设计师风格看一下" }],
        persona: "excellent-employee",
        sessions: [{ fileName: "a.jpg", id: "img-1" }]
      },
      createEsseTestConfig(),
      "C:\\project",
      deps
    );
    await runEsseAgentTurn(
      {
        messages: [
          { role: "user", content: "先按设计师风格看一下" },
          { role: "assistant", content: "收到" },
          { role: "user", content: "现在切牛马，新增这张也一起处理" }
        ],
        persona: "old-ox",
        sessions: [
          { fileName: "a.jpg", id: "img-1" },
          { currentImagePath: "C:\\project\\images\\current\\b.png", fileName: "b.jpg", id: "img-2" }
        ]
      },
      createEsseTestConfig(),
      "C:\\project",
      deps
    );

    expect(prompts[1]).toContain("当前人格：牛马设计师");
    expect(prompts[1]).toContain("项目图片（覆盖此前）");
    expect(prompts[1]).toContain("img-2：b.jpg，当前图：C:\\project\\images\\current\\b.png");
    expect(prompts[1]).not.toContain("==== 输出 JSON 示例 ====");
  });

  test("clears a prior Esse runtime when a fresh missing-reference turn is handled locally", async () => {
    const registry = new AgentRuntimeRegistry();
    const prompts: string[] = [];
    let factoryCalls = 0;

    const deps = {
      registry,
      createRuntime: async () => {
        factoryCalls += 1;
        return createFakeEsseRuntime({
          onPrompt: (prompt) => prompts.push(prompt)
        });
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
    expect(registry.has("esse:c:\\project")).toBe(true);

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
    expect(registry.has("esse:c:\\project")).toBe(false);

    await runEsseAgentTurn(
      {
        messages: [
          { role: "user", content: "按附件里的参考图继续生成三张图" },
          { role: "assistant", content: missingResult.reply },
          { role: "user", content: "现在用这张参考图继续" }
        ],
        referenceImagePaths: ["C:\\project\\refs\\room.png"],
        sessions: []
      },
      createEsseTestConfig(),
      "C:\\project",
      deps
    );

    expect(factoryCalls).toBe(2);
    expect(prompts[1]).toContain("==== 输出契约");
  });

  test("publishes visible message updates on every reused Esse turn", async () => {
    const registry = new AgentRuntimeRegistry();
    const publicMessages: string[] = [];
    let factoryCalls = 0;

    const deps = {
      registry,
      createRuntime: async () => {
        factoryCalls += 1;
        let listener: ((event: unknown) => void) | undefined;
        return createFakeEsseRuntime({
          onPrompt: () => {
            listener?.({ type: "message_update" });
          },
          subscribe: (next) => {
            listener = next;
            return () => undefined;
          }
        });
      },
      logger: createCapturingLogger(publicMessages)
    };

    await runEsseAgentTurn(
      {
        messages: [{ role: "user", content: "第一轮" }],
        sessions: []
      },
      createEsseTestConfig(),
      "C:\\project",
      deps
    );
    await runEsseAgentTurn(
      {
        messages: [
          { role: "user", content: "第一轮" },
          { role: "assistant", content: "收到" },
          { role: "user", content: "第二轮" }
        ],
        sessions: []
      },
      createEsseTestConfig(),
      "C:\\project",
      deps
    );

    expect(factoryCalls).toBe(1);
    expect(publicMessages.filter((message) => message === "Esse 正在组织回复...")).toHaveLength(2);
  });
});

function createEsseTestConfig() {
  return {
    apiKey: "coding-key",
    baseUrl: "https://api.tu-zi.com/coding",
    model: "gpt-5.5"
  };
}

function createFakeEsseRuntime(options: {
  getLastAssistantText?: () => string;
  onPrompt?: (prompt: string) => void;
  subscribe?: (listener: (event: unknown) => void) => () => void;
} = {}): AgentRuntime {
  return {
    descriptor: {
      builtInTools: [],
      customTools: [],
      model: "gpt-5.5",
      projectDirectory: "C:\\project",
      sessionId: "esse-agent"
    },
    dispose: () => undefined,
    getLastAssistantText: options.getLastAssistantText ?? (() => JSON.stringify({ reply: "收到。" })),
    prompt: async (prompt) => {
      options.onPrompt?.(prompt);
    },
    subscribe: options.subscribe ?? (() => () => undefined)
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
