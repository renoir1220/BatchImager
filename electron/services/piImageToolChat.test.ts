import { describe, expect, test } from "vitest";
import type { ProductImageResult } from "./tuziImageApi";
import { runPiImageToolChat } from "./piImageToolChat";

describe("piImageToolChat", () => {
  test("drives a chat turn through Pi and executes the registered image tool", async () => {
    const generated: ProductImageResult[] = [];
    const runtimePrompts: string[] = [];
    const customTools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }> = [];

    const result = await runPiImageToolChat(
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
        chatAgent: "pi",
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
              await generateTool?.execute("call-1", {
                prompt: "白底商品图，保留花朵形态",
                referenceImageIds: ["ref-1"],
                size: "3840x2160"
              });
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

    expect(runtimePrompts[0]).toContain("BatchImager 的右侧图片会话助手");
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

  test("returns a clear error if Pi finishes without assistant text", async () => {
    await expect(
      runPiImageToolChat(
        {
          imagePath: "C:\\project\\images\\original\\img-1-flower.jpg",
          messages: [{ role: "user", content: "分析这张图" }],
          sessionId: "img-1"
        },
        {
          apiKey: "coding-key",
          baseUrl: "https://api.tu-zi.com/coding",
          chatAgent: "pi",
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
});
