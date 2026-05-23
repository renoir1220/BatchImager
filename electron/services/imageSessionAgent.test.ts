import { describe, expect, test } from "vitest";
import type { ProductImageResult } from "./tuziImageApi";
import { runImageSessionAgent } from "./imageSessionAgent";

describe("imageSessionAgent", () => {
  test("drives a chat turn through Pi and executes the registered image tool", async () => {
    const generated: ProductImageResult[] = [];
    const runtimePrompts: string[] = [];
    const customTools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }> = [];

    const result = await runImageSessionAgent(
      {
        imagePath: "C:\\project\\images\\original\\img-1-flower.jpg",
        messages: [{ role: "user", content: "生成白底商品图" }],
        outputSize: "2048x2048",
        referenceImages: [{ id: "ref-1", filePath: "C:\\project\\references\\style.jpg", label: "样例 1" }],
        sessionId: "img-1"
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:\\project",
      {
        createRuntime: async (options) => {
          customTools.push(...(options.customToolDefinitions as typeof customTools));
          return {
            descriptor: {
              builtInTools: [],
              customTools: [],
              model: options.model,
              projectDirectory: options.projectDirectory,
              sessionId: options.sessionId
            },
            dispose: () => undefined,
            getLastAssistantText: () => "我已经通过 Pi 生成好了。",
            prompt: async (prompt) => {
              runtimePrompts.push(prompt);
              const generateTool = customTools.find((tool) => tool.name === "generate_image");
              const toolResult = await generateTool?.execute("call-1", {
                prompt: "白底商品图，保留花朵形态",
                referenceImageIds: ["ref-1"],
                size: "3840x2160"
              });
              expect(JSON.stringify(toolResult)).not.toContain("C:\\project\\images\\generated\\img-1.png");
              expect(JSON.stringify(toolResult)).not.toContain("https://cdn.example.com/img-1.png");
              expect(JSON.stringify(toolResult)).toContain("图片生成完成，已更新当前图片。");
            },
            subscribe: () => () => undefined
          };
        },
        generateImage: async (request) => {
          const image = {
            outputPath: "C:\\project\\images\\generated\\img-1.png",
            remoteUrl: "https://cdn.example.com/img-1.png"
          };
          generated.push(image);
          expect(request).toEqual({
            imagePath: "C:\\project\\images\\original\\img-1-flower.jpg",
            prompt: "白底商品图，保留花朵形态",
            referenceImagePaths: ["C:\\project\\references\\style.jpg"],
            sessionId: "img-1",
            size: "2048x2048"
          });
          return image;
        }
      }
    );

    expect(runtimePrompts[0]).toContain("BatchImager 的右侧图片会话智能体");
    expect(runtimePrompts[0]).toContain("ref-1：样例 1");
    expect(customTools.map((tool) => tool.name)).toContain("generate_image");
    expect(generated).toHaveLength(1);
    expect(result).toEqual({
      content: "我已经通过 Pi 生成好了。",
      generatedImage: {
        outputPath: "C:\\project\\images\\generated\\img-1.png",
        remoteUrl: "https://cdn.example.com/img-1.png"
      }
    });
  });

  test("uses all provided prompt reference images when Pi omits referenceImageIds", async () => {
    const generatedRequests: unknown[] = [];
    const customTools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }> = [];

    await runImageSessionAgent(
      {
        imagePath: "C:\\project\\images\\generated\\placeholder.png",
        messages: [{ role: "user", content: "根据这张参考图生成咖啡馆内部结构图" }],
        referenceImages: [{ id: "prompt-ref-1", filePath: "C:\\project\\references\\sakura-cafe.jpg", label: "Esse 提示图 1" }],
        sessionId: "img-7"
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:\\project",
      {
        createRuntime: async (options) => {
          customTools.push(...(options.customToolDefinitions as typeof customTools));
          return {
            descriptor: {
              builtInTools: [],
              customTools: [],
              model: options.model,
              projectDirectory: options.projectDirectory,
              sessionId: options.sessionId
            },
            dispose: () => undefined,
            getLastAssistantText: () => "已生成。",
            prompt: async () => {
              const generateTool = customTools.find((tool) => tool.name === "generate_image");
              await generateTool?.execute("call-1", {
                prompt: "生成咖啡馆内部结构图"
              });
            },
            subscribe: () => () => undefined
          };
        },
        generateImage: async (request) => {
          generatedRequests.push(request);
          return { outputPath: "C:\\project\\images\\generated\\img-7.png" };
        }
      }
    );

    expect(generatedRequests).toEqual([
      {
        imagePath: "C:\\project\\images\\generated\\placeholder.png",
        prompt: "生成咖啡馆内部结构图",
        referenceImagePaths: ["C:\\project\\references\\sakura-cafe.jpg"],
        sessionId: "img-7"
      }
    ]);
  });

  test("keeps prompt reference images when Pi sends an empty referenceImageIds array", async () => {
    const generatedRequests: unknown[] = [];
    const customTools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }> = [];

    await runImageSessionAgent(
      {
        imagePath: "C:\\project\\images\\generated\\placeholder.png",
        messages: [{ role: "user", content: "根据这张参考图生成咖啡馆内部结构图" }],
        referenceImages: [{ id: "prompt-ref-1", filePath: "C:\\project\\references\\sakura-cafe.jpg", label: "Esse 提示图 1" }],
        sessionId: "img-7"
      },
      {
        apiKey: "coding-key",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5"
      },
      "C:\\project",
      {
        createRuntime: async (options) => {
          customTools.push(...(options.customToolDefinitions as typeof customTools));
          return {
            descriptor: {
              builtInTools: [],
              customTools: [],
              model: options.model,
              projectDirectory: options.projectDirectory,
              sessionId: options.sessionId
            },
            dispose: () => undefined,
            getLastAssistantText: () => "已生成。",
            prompt: async () => {
              const generateTool = customTools.find((tool) => tool.name === "generate_image");
              await generateTool?.execute("call-1", {
                prompt: "生成咖啡馆内部结构图",
                referenceImageIds: []
              });
            },
            subscribe: () => () => undefined
          };
        },
        generateImage: async (request) => {
          generatedRequests.push(request);
          return { outputPath: "C:\\project\\images\\generated\\img-7.png" };
        }
      }
    );

    expect(generatedRequests).toEqual([
      {
        imagePath: "C:\\project\\images\\generated\\placeholder.png",
        prompt: "生成咖啡馆内部结构图",
        referenceImagePaths: ["C:\\project\\references\\sakura-cafe.jpg"],
        sessionId: "img-7"
      }
    ]);
  });

  test("returns a clear error if Pi finishes without assistant text", async () => {
    await expect(
      runImageSessionAgent(
        {
          imagePath: "C:\\project\\images\\original\\img-1-flower.jpg",
          messages: [{ role: "user", content: "分析这张图" }],
          sessionId: "img-1"
        },
        {
          apiKey: "coding-key",
          baseUrl: "https://api.tu-zi.com/coding",
          model: "gpt-5.5"
        },
        "C:\\project",
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
            getLastAssistantText: () => undefined,
            prompt: async () => undefined,
            subscribe: () => () => undefined
          }),
          generateImage: async () => ({ outputPath: "unused.png" })
        }
      )
    ).rejects.toThrow("Pi 会话未返回文本回复");
  });

  test("rejects attachment-based generation when no reference image is available before starting Pi", async () => {
    let runtimeCreated = false;
    const generatedRequests: unknown[] = [];

    await expect(
      runImageSessionAgent(
        {
          imagePath: "C:\\project\\images\\generated\\placeholder.png",
          messages: [{ role: "user", content: "按附件里的参考图继续生成三张内部设计图" }],
          sessionId: "img-7"
        },
        {
          apiKey: "coding-key",
          baseUrl: "https://api.tu-zi.com/coding",
          model: "gpt-5.5"
        },
        "C:\\project",
        {
          createRuntime: async () => {
            runtimeCreated = true;
            throw new Error("runtime should not be created");
          },
          generateImage: async (request) => {
            generatedRequests.push(request);
            return { outputPath: "unused.png" };
          }
        }
      )
    ).rejects.toThrow("我没有收到可用的参考图附件");

    expect(runtimeCreated).toBe(false);
    expect(generatedRequests).toEqual([]);
  });

  test("throws when a generation request finishes without calling the image tool", async () => {
    const generatedRequests: unknown[] = [];

    await expect(
      runImageSessionAgent(
        {
          imagePath: "C:\\project\\images\\original\\img-1-flower.jpg",
          messages: [{ role: "user", content: "生成这个花朵在家居环境下的商品图" }],
          sessionId: "img-1"
        },
        {
          apiKey: "coding-key",
          baseUrl: "https://api.tu-zi.com/coding",
          model: "gpt-5.5"
        },
        "C:\\project",
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
            getLastAssistantText: () => "我会为你生成一张图。",
            prompt: async () => undefined,
            subscribe: () => () => undefined
          }),
          generateImage: async (request) => {
            generatedRequests.push(request);
            return { outputPath: "unused.png" };
          }
        }
      )
    ).rejects.toThrow("Pi 未返回图片生成工具调用");

    expect(generatedRequests).toEqual([]);
  });
});
