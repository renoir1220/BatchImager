import { describe, expect, test } from "vitest";
import type { AgentRuntime } from "./agentRuntime";
import { AgentRuntimeRegistry } from "./agentRuntimeRegistry";
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
                mode: "edit",
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
            mode: "edit",
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
      generatedMode: "edit",
      generatedImage: {
        outputPath: "C:\\project\\images\\generated\\img-1.png",
        remoteUrl: "https://cdn.example.com/img-1.png"
      }
    });
  });

  test("does not send prompt reference images when Pi omits referenceImageIds", async () => {
    const generatedRequests: unknown[] = [];
    const customTools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }> = [];

    await runImageSessionAgent(
      {
        imagePath: "C:\\project\\images\\generated\\placeholder.png",
        generationMode: "generate",
        messages: [{ role: "user", content: "根据这张参考图生成咖啡馆内部结构图" }],
        referenceImages: [{ id: "prompt-ref-1", filePath: "C:\\project\\references\\sakura-cafe.jpg", label: "智能体提示图 1" }],
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
                mode: "generate",
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
        mode: "generate",
        prompt: "生成咖啡馆内部结构图",
        sessionId: "img-7"
      }
    ]);
  });

  test("does not send prompt reference images when Pi sends an empty referenceImageIds array", async () => {
    const generatedRequests: unknown[] = [];
    const customTools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }> = [];

    await runImageSessionAgent(
      {
        imagePath: "C:\\project\\images\\generated\\placeholder.png",
        generationMode: "generate",
        messages: [{ role: "user", content: "根据这张参考图生成咖啡馆内部结构图" }],
        referenceImages: [{ id: "prompt-ref-1", filePath: "C:\\project\\references\\sakura-cafe.jpg", label: "智能体提示图 1" }],
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
                mode: "generate",
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
        mode: "generate",
        prompt: "生成咖啡馆内部结构图",
        sessionId: "img-7"
      }
    ]);
  });

  test("coerces ambiguous current-image generation tool calls back to edit without size", async () => {
    const generatedRequests: unknown[] = [];
    const customTools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }> = [];

    await runImageSessionAgent(
      {
        generationMode: "edit",
        imagePath: "C:\\project\\images\\generated\\plant-latest.png",
        messages: [{ role: "user", content: "改为漫画风格" }],
        sessionId: "img-plant"
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
            getLastAssistantText: () => "已改成漫画风格。",
            prompt: async () => {
              const generateTool = customTools.find((tool) => tool.name === "generate_image");
              await generateTool?.execute("call-1", {
                mode: "generate",
                prompt: "把当前植物商品图改为漫画风格"
              });
            },
            subscribe: () => () => undefined
          };
        },
        generateImage: async (request) => {
          generatedRequests.push(request);
          return { outputPath: "C:\\project\\images\\generated\\plant-comic.png" };
        }
      }
    );

    expect(generatedRequests).toEqual([
      {
        imagePath: "C:\\project\\images\\generated\\plant-latest.png",
        mode: "edit",
        prompt: "把当前植物商品图改为漫画风格",
        sessionId: "img-plant"
      }
    ]);
  });

  test("keeps generate mode when the user explicitly asks for a new image", async () => {
    const generatedRequests: unknown[] = [];
    const customTools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }> = [];

    await runImageSessionAgent(
      {
        generationMode: "edit",
        imagePath: "C:\\project\\images\\generated\\plant-latest.png",
        messages: [{ role: "user", content: "新生成一张漫画风格商品图" }],
        sessionId: "img-plant"
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
            getLastAssistantText: () => "已新生成一张漫画风格图。",
            prompt: async () => {
              const generateTool = customTools.find((tool) => tool.name === "generate_image");
              await generateTool?.execute("call-1", {
                mode: "generate",
                prompt: "新生成一张漫画风格商品图"
              });
            },
            subscribe: () => () => undefined
          };
        },
        generateImage: async (request) => {
          generatedRequests.push(request);
          return { outputPath: "C:\\project\\images\\generated\\plant-new.png" };
        }
      }
    );

    expect(generatedRequests).toEqual([
      {
        imagePath: "C:\\project\\images\\generated\\plant-latest.png",
        mode: "generate",
        prompt: "新生成一张漫画风格商品图",
        sessionId: "img-plant"
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

  test("lets Pi decide what to do when the user mentions an attachment but none is available", async () => {
    let runtimeCreated = false;
    const generatedRequests: unknown[] = [];
    let capturedPrompt = "";

    const result = await runImageSessionAgent(
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
        createRuntime: async (options) => {
          runtimeCreated = true;
          return {
            descriptor: {
              builtInTools: [],
              customTools: [],
              model: options.model,
              projectDirectory: options.projectDirectory,
              sessionId: options.sessionId
            },
            dispose: () => undefined,
            getLastAssistantText: () => "我没有看到参考图，会先向用户确认。",
            prompt: async (prompt) => {
              capturedPrompt = prompt;
            },
            subscribe: () => () => undefined
          };
        },
        generateImage: async (request) => {
          generatedRequests.push(request);
          return { outputPath: "unused.png" };
        }
      }
    );

    expect(runtimeCreated).toBe(true);
    expect(capturedPrompt).toContain("本轮没有可引用的参考图");
    expect(result).toEqual({ content: "我没有看到参考图，会先向用户确认。" });
    expect(generatedRequests).toEqual([]);
  });

  test("returns the model reply without an image when the model defers the tool call", async () => {
    const generatedRequests: unknown[] = [];

    const result = await runImageSessionAgent(
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
          getLastAssistantText: () => "我需要先确认一下：你想保留花朵还是只保留容器？",
          prompt: async () => undefined,
          subscribe: () => () => undefined
        }),
        generateImage: async (request) => {
          generatedRequests.push(request);
          return { outputPath: "unused.png" };
        }
      }
    );

    expect(result).toEqual({ content: "我需要先确认一下：你想保留花朵还是只保留容器？" });
    expect(generatedRequests).toEqual([]);
  });

  test("reuses the cached runtime on the next turn and sends an incremental prompt", async () => {
    const registry = new AgentRuntimeRegistry();
    const config = { apiKey: "coding-key", baseUrl: "https://api.tu-zi.com/coding", model: "gpt-5.5" };
    const projectDirectory = "C:\\project";
    let factoryCalls = 0;
    const prompts: string[] = [];
    const buildRuntime = (): AgentRuntime => ({
      descriptor: { builtInTools: [], customTools: [], model: "gpt-5.5", projectDirectory, sessionId: "img-9" },
      dispose: () => undefined,
      getLastAssistantText: () => "回复 #" + prompts.length,
      prompt: async (text) => {
        prompts.push(text);
      },
      subscribe: () => () => undefined
    });
    const deps = {
      registry,
      createRuntime: async () => {
        factoryCalls += 1;
        return buildRuntime();
      },
      generateImage: async () => ({ outputPath: "unused.png" })
    };

    await runImageSessionAgent(
      {
        imagePath: "C:\\project\\images\\original\\img-9.jpg",
        messages: [{ role: "user", content: "把背景换成纯白" }],
        sessionId: "img-9"
      },
      config,
      projectDirectory,
      deps
    );
    await runImageSessionAgent(
      {
        imagePath: "C:\\project\\images\\generated\\img-9.png",
        messages: [
          { role: "user", content: "把背景换成纯白" },
          { role: "assistant", content: "回复 #1" },
          { role: "user", content: "再换成米色" }
        ],
        sessionId: "img-9"
      },
      config,
      projectDirectory,
      deps
    );

    expect(factoryCalls).toBe(1);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("硬性规则");
    expect(prompts[0]).toContain("把背景换成纯白");
    expect(prompts[1]).toContain("[环境更新]");
    expect(prompts[1]).not.toContain("硬性规则");
    expect(prompts[1]).toContain("- 当前图片路径：C:\\project\\images\\generated\\img-9.png");
    expect(prompts[1]).toContain("再换成米色");
  });

  test("rebuilds the runtime when the user starts a fresh conversation on the same session", async () => {
    const registry = new AgentRuntimeRegistry();
    const config = { apiKey: "coding-key", baseUrl: "https://api.tu-zi.com/coding", model: "gpt-5.5" };
    const projectDirectory = "C:\\project";
    let factoryCalls = 0;
    const buildRuntime = (): AgentRuntime => ({
      descriptor: { builtInTools: [], customTools: [], model: "gpt-5.5", projectDirectory, sessionId: "img-9" },
      dispose: () => undefined,
      getLastAssistantText: () => "ok",
      prompt: async () => undefined,
      subscribe: () => () => undefined
    });
    const deps = {
      registry,
      createRuntime: async () => {
        factoryCalls += 1;
        return buildRuntime();
      },
      generateImage: async () => ({ outputPath: "unused.png" })
    };

    await runImageSessionAgent(
      {
        imagePath: "C:\\project\\images\\original\\img-9.jpg",
        messages: [{ role: "user", content: "第一轮" }],
        sessionId: "img-9"
      },
      config,
      projectDirectory,
      deps
    );
    // 用户清空对话，又从一条 user 开始
    await runImageSessionAgent(
      {
        imagePath: "C:\\project\\images\\original\\img-9.jpg",
        messages: [{ role: "user", content: "重新开始的第一轮" }],
        sessionId: "img-9"
      },
      config,
      projectDirectory,
      deps
    );

    expect(factoryCalls).toBe(2);
  });

  test("keeps runtimes isolated across different session ids", async () => {
    const registry = new AgentRuntimeRegistry();
    const config = { apiKey: "coding-key", baseUrl: "https://api.tu-zi.com/coding", model: "gpt-5.5" };
    const projectDirectory = "C:\\project";
    let factoryCalls = 0;
    const buildRuntime = (sessionId: string): AgentRuntime => ({
      descriptor: { builtInTools: [], customTools: [], model: "gpt-5.5", projectDirectory, sessionId },
      dispose: () => undefined,
      getLastAssistantText: () => "ok",
      prompt: async () => undefined,
      subscribe: () => () => undefined
    });
    const deps = (sessionId: string) => ({
      registry,
      createRuntime: async () => {
        factoryCalls += 1;
        return buildRuntime(sessionId);
      },
      generateImage: async () => ({ outputPath: "unused.png" })
    });

    await runImageSessionAgent(
      {
        imagePath: "C:\\project\\images\\original\\img-a.jpg",
        messages: [{ role: "user", content: "a" }],
        sessionId: "img-a"
      },
      config,
      projectDirectory,
      deps("img-a")
    );
    await runImageSessionAgent(
      {
        imagePath: "C:\\project\\images\\original\\img-b.jpg",
        messages: [{ role: "user", content: "b" }],
        sessionId: "img-b"
      },
      config,
      projectDirectory,
      deps("img-b")
    );

    expect(factoryCalls).toBe(2);
    expect(registry.has("image-session:c:/project:img-a")).toBe(true);
    expect(registry.has("image-session:c:/project:img-b")).toBe(true);
  });

  test("rejects image paths that point outside the project directory", async () => {
    await expect(
      runImageSessionAgent(
        {
          imagePath: "C:\\elsewhere\\malicious.png",
          messages: [{ role: "user", content: "看看这张图" }],
          sessionId: "img-1"
        },
        {
          apiKey: "coding-key",
          baseUrl: "https://api.tu-zi.com/coding",
          model: "gpt-5.5"
        },
        "C:\\project",
        {
          createRuntime: async () => {
            throw new Error("runtime should not be created");
          },
          generateImage: async () => ({ outputPath: "unused.png" })
        }
      )
    ).rejects.toThrow("项目目录之外");
  });
});
