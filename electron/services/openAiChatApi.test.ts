import { describe, expect, test } from "vitest";
import { buildChatCompletionsEndpoint, runImageToolChat } from "./openAiChatApi";

describe("openAiChatApi", () => {
  test("builds the chat completions endpoint from a base url", () => {
    expect(buildChatCompletionsEndpoint("https://api.ourzhishi.top/")).toBe(
      "https://api.ourzhishi.top/v1/chat/completions"
    );
  });

  test("runs a generate_image tool call and asks the model for a final reply", async () => {
    const fetchCalls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
    const generated: Array<{ prompt: string; imagePath: string; sessionId: string; size?: string }> = [];

    const result = await runImageToolChat(
      {
        imagePath: "C:\\images\\flower.png",
        messages: [{ role: "user", content: "把这张图改成电商白底图" }],
        sessionId: "img-1"
      },
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.ourzhishi.top",
        model: "gpt-4o-mini"
      },
      {
        fetch: async (url, init) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          fetchCalls.push({ url: String(url), body, headers: init?.headers as Record<string, string> });

          if (fetchCalls.length === 1) {
            expect(body.model).toBe("gpt-4o-mini");
            expect(Array.isArray(body.tools)).toBe(true);
            expect(body.tool_choice).toEqual({
              type: "function",
              function: { name: "generate_image" }
            });
            expect((body.messages as Array<{ role: string; content: string }>).at(-1)).toEqual({
              role: "user",
              content: "把这张图改成电商白底图"
            });

            return new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "call-1",
                          type: "function",
                          function: {
                            name: "generate_image",
                            arguments: JSON.stringify({ prompt: "电商白底商品图，保留花束主体", size: "3840x2160" })
                          }
                        }
                      ]
                    }
                  }
                ]
              }),
              { status: 200 }
            );
          }

          const toolMessage = (body.messages as Array<{ role: string; tool_call_id?: string; content?: string }>).at(-1);
          expect(toolMessage).toMatchObject({
            role: "tool",
            tool_call_id: "call-1"
          });
          expect(toolMessage?.content).not.toContain("C:\\generated\\img-1.png");
          expect(toolMessage?.content).not.toContain("https://cdn.example.com/img-1.png");
          expect(toolMessage?.content).toContain("图片生成完成，已更新当前图片。");

          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "已生成一张电商白底图。"
                  }
                }
              ]
            }),
            { status: 200 }
          );
        },
        generateImage: async (request) => {
          generated.push(request);

          return {
            outputPath: "C:\\generated\\img-1.png",
            remoteUrl: "https://cdn.example.com/img-1.png"
          };
        }
      }
    );

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0]?.url).toBe("https://api.ourzhishi.top/v1/chat/completions");
    expect(fetchCalls[0]?.headers.Authorization).toBe("Bearer local-test-key");
    expect(generated).toEqual([
      {
        imagePath: "C:\\images\\flower.png",
        prompt: "电商白底商品图，保留花束主体",
        sessionId: "img-1",
        size: "3840x2160"
      }
    ]);
    expect(result).toEqual({
      content: "已生成一张电商白底图。",
      generatedImage: {
        outputPath: "C:\\generated\\img-1.png",
        remoteUrl: "https://cdn.example.com/img-1.png"
      }
    });
  });

  test("lets the model choose which reference images should be sent to the image tool", async () => {
    const generated: Array<{ prompt: string; imagePath: string; referenceImagePaths?: string[]; sessionId: string }> = [];
    const firstRequestBodies: Array<Record<string, unknown>> = [];

    await runImageToolChat(
      {
        imagePath: "C:\\images\\flower.png",
        messages: [{ role: "user", content: "放进第二张那个房间参考图里重新生成" }],
        referenceImages: [
          { id: "ref-1", filePath: "C:\\references\\white-bg.png", label: "样例 1：白底商品图" },
          { id: "ref-2", filePath: "C:\\references\\warm-room.png", label: "样例 2：温馨房间背景" }
        ],
        sessionId: "img-1"
      },
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.ourzhishi.top",
        model: "gpt-4o-mini"
      },
      {
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

          if (Array.isArray(body.messages) && body.messages.some((message) => isToolMessage(message))) {
            return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "已重新生成。" } }] }), {
              status: 200
            });
          }

          firstRequestBodies.push(body);
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "call-1",
                        type: "function",
                        function: {
                          name: "generate_image",
                          arguments: JSON.stringify({
                            prompt: "鲜花商品图，参考温馨房间环境",
                            referenceImageIds: ["ref-2"]
                          })
                        }
                      }
                    ]
                  }
                }
              ]
            }),
            { status: 200 }
          );
        },
        generateImage: async (request) => {
          generated.push(request);
          return { outputPath: "C:\\generated\\img-1.png" };
        }
      }
    );

    const firstRequest = firstRequestBodies[0];
    const firstMessages = firstRequest.messages as Array<{ role: string; content: string }>;
    expect(firstMessages.some((message) => message.content.includes("ref-2：样例 2：温馨房间背景"))).toBe(true);
    expect(JSON.stringify(firstRequest.tools)).toContain("referenceImageIds");
    expect(generated).toEqual([
      {
        imagePath: "C:\\images\\flower.png",
        prompt: "鲜花商品图，参考温馨房间环境",
        referenceImagePaths: ["C:\\references\\warm-room.png"],
        sessionId: "img-1"
      }
    ]);
  });

  test("keeps prompt reference images when the model sends an empty referenceImageIds array", async () => {
    const generated: Array<{ prompt: string; imagePath: string; referenceImagePaths?: string[]; sessionId: string }> = [];

    await runImageToolChat(
      {
        imagePath: "C:\\images\\placeholder.png",
        messages: [{ role: "user", content: "根据这张参考图生成咖啡馆内部结构图" }],
        referenceImages: [{ id: "prompt-ref-1", filePath: "C:\\references\\sakura-cafe.jpg", label: "Esse 提示图 1" }],
        sessionId: "img-7"
      },
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.ourzhishi.top",
        model: "gpt-4o-mini"
      },
      {
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

          if (Array.isArray(body.messages) && body.messages.some((message) => isToolMessage(message))) {
            return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "已生成。" } }] }), {
              status: 200
            });
          }

          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "call-1",
                        type: "function",
                        function: {
                          name: "generate_image",
                          arguments: JSON.stringify({
                            prompt: "生成咖啡馆内部结构图",
                            referenceImageIds: []
                          })
                        }
                      }
                    ]
                  }
                }
              ]
            }),
            { status: 200 }
          );
        },
        generateImage: async (request) => {
          generated.push(request);
          return { outputPath: "C:\\generated\\img-7.png" };
        }
      }
    );

    expect(generated).toEqual([
      {
        imagePath: "C:\\images\\placeholder.png",
        prompt: "生成咖啡馆内部结构图",
        referenceImagePaths: ["C:\\references\\sakura-cafe.jpg"],
        sessionId: "img-7"
      }
    ]);
  });

  test("rejects attachment-based generation when no reference image is available", async () => {
    const generated: Array<{ prompt: string; imagePath: string; sessionId: string }> = [];
    const fetchCalls: Array<Record<string, unknown>> = [];

    await expect(
      runImageToolChat(
        {
          imagePath: "C:\\images\\placeholder.png",
          messages: [{ role: "user", content: "按附件里的参考图继续生成三张内部设计图" }],
          sessionId: "img-7"
        },
        {
          apiKey: "local-test-key",
          baseUrl: "https://api.ourzhishi.top",
          model: "gpt-4o-mini"
        },
        {
          fetch: async (_url, init) => {
            fetchCalls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
            return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "已生成。" } }] }), {
              status: 200
            });
          },
          generateImage: async (request) => {
            generated.push(request);
            return { outputPath: "C:\\generated\\img-7.png" };
          }
        }
      )
    ).rejects.toThrow("我没有收到可用的参考图附件");

    expect(fetchCalls).toEqual([]);
    expect(generated).toEqual([]);
  });

  test("keeps automatic tool choice for non-generation chat", async () => {
    const firstRequestBodies: Array<Record<string, unknown>> = [];

    await runImageToolChat(
      {
        imagePath: "C:\\images\\flower.png",
        messages: [{ role: "user", content: "这张图适合怎么优化？" }],
        sessionId: "img-1"
      },
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.ourzhishi.top",
        model: "gpt-4o-mini"
      },
      {
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          firstRequestBodies.push(body);

          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "可以先统一背景、增强主体清晰度，再考虑商品场景。"
                  }
                }
              ]
            }),
            { status: 200 }
          );
        },
        generateImage: async () => ({ outputPath: "unused.png" })
      }
    );

    expect(firstRequestBodies[0].tool_choice).toBe("auto");
  });

  test("uses the selected session output size when executing the image tool", async () => {
    const generated: Array<{ prompt: string; imagePath: string; sessionId: string; size?: string }> = [];
    const firstRequestBodies: Array<Record<string, unknown>> = [];

    await runImageToolChat(
      {
        imagePath: "C:\\images\\flower.png",
        messages: [{ role: "user", content: "按这个方向生成" }],
        outputSize: "2048x1152",
        sessionId: "img-1"
      },
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.ourzhishi.top",
        model: "gpt-4o-mini"
      },
      {
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

          if (Array.isArray(body.messages) && body.messages.some((message) => isToolMessage(message))) {
            return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "已按 2K 横图生成。" } }] }), {
              status: 200
            });
          }

          firstRequestBodies.push(body);
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "call-1",
                        type: "function",
                        function: {
                          name: "generate_image",
                          arguments: JSON.stringify({ prompt: "鲜花 2K 横图商品图" })
                        }
                      }
                    ]
                  }
                }
              ]
            }),
            { status: 200 }
          );
        },
        generateImage: async (request) => {
          generated.push(request);
          return { outputPath: "C:\\generated\\img-1.png" };
        }
      }
    );

    const messages = firstRequestBodies[0].messages as Array<{ role: string; content: string }>;
    expect(messages.some((message) => message.content.includes("本次用户已选择输出分辨率：2048x1152"))).toBe(true);
    expect(generated).toEqual([
      {
        imagePath: "C:\\images\\flower.png",
        prompt: "鲜花 2K 横图商品图",
        sessionId: "img-1",
        size: "2048x1152"
      }
    ]);
  });

  test("adds selected image and batch prompt context before visible chat history", async () => {
    const fetchCalls: Array<{ body: Record<string, unknown> }> = [];

    await runImageToolChat(
      {
        context: {
          currentImageLabel: "当前生成图",
          fileName: "DSC00270.JPG",
          originalImageLabel: "初始导入图",
          previousGenerationPrompt: "生成电商白底主图，保留商品结构",
          referenceImageCount: 1
        },
        imagePath: "C:\\images\\DSC00270.JPG",
        messages: [{ role: "user", content: "这张图当前是什么状态？" }],
        sessionId: "img-1"
      },
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.ourzhishi.top",
        model: "gpt-4o-mini"
      },
      {
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          fetchCalls.push({ body });

          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "我会基于当前图片和之前的批量任务重新生成。"
                  }
                }
              ]
            }),
            { status: 200 }
          );
        },
        generateImage: async () => ({ outputPath: "unused.png" })
      }
    );

    const messages = fetchCalls[0]?.body.messages as Array<{ role: string; content: string }>;
    expect(messages.slice(0, 3)).toEqual([
      expect.objectContaining({ role: "system" }),
      {
        role: "system",
        content:
          "当前图片上下文：\n- 初始图片文件名：DSC00270.JPG\n- 初始图片：初始导入图\n- 当前编辑输入：当前生成图\n- 当前图片已经由 BatchImager 选中，并会自动作为 generate_image 工具的输入；用户不需要重新上传或描述这张图片。\n- 最近一次批量处理任务：生成电商白底主图，保留商品结构\n- 最近一次批量处理包含 1 张参考图。"
      },
      { role: "user", content: "这张图当前是什么状态？" }
    ]);
  });

  test("throws when a generation request does not return a tool call", async () => {
    const generated: Array<{ prompt: string; imagePath: string; sessionId: string; size?: string }> = [];

    await expect(
      runImageToolChat(
        {
          imagePath: "C:\\images\\flower.png",
          messages: [{ role: "user", content: "生成这个花朵在家居环境下的商品图" }],
          sessionId: "img-1"
        },
        {
          apiKey: "local-test-key",
          baseUrl: "https://api.ourzhishi.top",
          model: "gpt-4o-mini"
        },
        {
          fetch: async () =>
            new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: "正在处理图片，稍后给你下载链接。"
                    }
                  }
                ]
              }),
              { status: 200 }
            ),
          generateImage: async (request) => {
            generated.push(request);

            return {
              outputPath: "C:\\generated\\img-1.png",
              remoteUrl: "https://cdn.example.com/img-1.png"
            };
          }
        }
      )
    ).rejects.toThrow("模型未返回图片生成工具调用");

    expect(generated).toEqual([]);
  });

  test("does not call the image tool when a non-generation chat returns text", async () => {
    const generated: Array<{ prompt: string; imagePath: string; sessionId: string; size?: string }> = [];

    const result = await runImageToolChat(
      {
        imagePath: "C:\\images\\flower.png",
        messages: [{ role: "user", content: "这张图适合怎么优化？" }],
        sessionId: "img-1"
      },
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.ourzhishi.top",
        model: "gpt-4o-mini"
      },
      {
        fetch: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "可以先统一背景、增强主体清晰度，再考虑商品场景。"
                  }
                }
              ]
            }),
            { status: 200 }
          ),
        generateImage: async (request) => {
          generated.push(request);
          return { outputPath: "unused.png" };
        }
      }
    );

    expect(generated).toEqual([]);
    expect(result).toEqual({ content: "可以先统一背景、增强主体清晰度，再考虑商品场景。" });
  });

  test("rejects malformed chat responses", async () => {
    await expect(
      runImageToolChat(
        {
          imagePath: "C:\\images\\flower.png",
          messages: [{ role: "user", content: "hello" }],
          sessionId: "img-1"
        },
        {
          apiKey: "key",
          baseUrl: "https://api.ourzhishi.top",
          model: "gpt-4o-mini"
        },
        {
          fetch: async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
          generateImage: async () => ({ outputPath: "unused.png" })
        }
      )
    ).rejects.toThrow("Invalid chat completion response");
  });
});

function isToolMessage(value: unknown): boolean {
  return typeof value === "object" && value !== null && "role" in value && value.role === "tool";
}
