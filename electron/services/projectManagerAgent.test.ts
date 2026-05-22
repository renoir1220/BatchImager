import { describe, expect, test } from "vitest";
import type { AppLogger, BackendLogOptions } from "./appLogger";
import { runProjectManagerPlanAgent } from "./projectManagerAgent";

describe("projectManagerAgent", () => {
  test("asks Pi for a structured batch plan and normalizes the returned json", async () => {
    const runtimePrompts: string[] = [];

    const plan = await runProjectManagerPlanAgent(
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
        chatAgent: "pi",
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
            [
              "```json",
              JSON.stringify({
                title: "暖色家居鲜花商品图",
                globalInstruction: "统一暖色家居环境，保留花材颜色和形态",
                outputSize: "3840x2160",
                commands: [
                  {
                    targetSessionId: "img-1",
                    instruction: "生成客厅茶几场景鲜花商品图",
                    constraints: ["保留花材颜色"]
                  },
                  {
                    targetSessionId: "img-2",
                    instruction: "生成卧室床头柜场景鲜花商品图",
                    constraints: ["保留花材颜色"]
                  }
                ]
              }),
              "```"
            ].join("\n"),
          prompt: async (prompt) => {
            runtimePrompts.push(prompt);
          },
          subscribe: () => () => undefined
        })
      }
    );

    expect(runtimePrompts[0]).toContain("Esse智能体");
    expect(runtimePrompts[0]).toContain("img-1：flower-a.jpg");
    expect(plan).toMatchObject({
      globalInstruction: "统一暖色家居环境，保留花材颜色和形态",
      outputSize: "3840x2160",
      status: "draft",
      targetSessionIds: ["img-1", "img-2"],
      title: "暖色家居鲜花商品图"
    });
    expect(plan.id).toMatch(/^plan-/);
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

  test("throws a clear error when Pi returns invalid plan json", async () => {
    await expect(
      runProjectManagerPlanAgent(
        {
          prompt: "做白底图",
          referenceImagePaths: [],
          sessions: [{ fileName: "flower-a.jpg", id: "img-1" }]
        },
        {
          apiKey: "coding-key",
          baseUrl: "https://api.tu-zi.com/coding",
          chatAgent: "pi",
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
            getLastAssistantText: () => "我觉得可以做白底图",
            prompt: async () => undefined,
            subscribe: () => () => undefined
          })
        }
      )
    ).rejects.toThrow("Esse 未返回有效的批量方案 JSON");
  });

  test("publishes Pi message updates as visible plan progress", async () => {
    const publicMessages: string[] = [];

    await runProjectManagerPlanAgent(
      {
        prompt: "做白底图",
        referenceImagePaths: [],
        sessions: [{ fileName: "flower-a.jpg", id: "img-1" }]
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        chatAgent: "pi",
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
              title: "白底图"
            }),
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

    expect(publicMessages).toContain("Esse 正在组织方案...");
    expect(publicMessages.filter((message) => message === "Esse 正在组织方案...")).toHaveLength(1);
  });

  test("omits output size when the user did not select one", async () => {
    const plan = await runProjectManagerPlanAgent(
      {
        prompt: "做白底图",
        referenceImagePaths: [],
        sessions: [{ fileName: "flower-a.jpg", id: "img-1" }]
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        chatAgent: "pi",
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
  });
});

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
