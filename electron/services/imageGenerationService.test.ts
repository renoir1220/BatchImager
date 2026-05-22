import { describe, expect, test } from "vitest";
import { createImageGenerationExecutor } from "./imageGenerationService";

describe("imageGenerationService", () => {
  test("routes edit requests through the shared edit implementation", async () => {
    const calls: unknown[] = [];
    const executor = createImageGenerationExecutor(
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.tu-zi.com",
        model: "gpt-image-2",
        outputDirectory: "C:\\generated",
        size: "auto"
      },
      {
        editImage: async (request) => {
          calls.push(request);
          return {
            inputImage: {
              byteLength: 100,
              converted: true,
              height: 768,
              imagePath: "C:\\prepared\\source.png",
              originalHeight: 768,
              originalWidth: 1024,
              resized: false,
              width: 1024
            },
            outputPath: "C:\\generated\\edit.png",
            requestSize: "1024x768"
          };
        },
        generateImage: async () => {
          throw new Error("edit mode must not call generations");
        }
      }
    );

    const result = await executor({
      imagePath: "C:\\source\\flower.jpg",
      mode: "edit",
      prompt: "改成白底商品图",
      sessionId: "img-1"
    });

    expect(calls).toEqual([
      {
        imagePath: "C:\\source\\flower.jpg",
        prompt: "改成白底商品图",
        sessionId: "img-1"
      }
    ]);
    expect(result.outputPath).toBe("C:\\generated\\edit.png");
  });

  test("routes prompt-only requests through generations without a source image", async () => {
    const calls: unknown[] = [];
    const executor = createImageGenerationExecutor(
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.tu-zi.com",
        model: "gpt-image-2",
        outputDirectory: "C:\\generated",
        size: "auto"
      },
      {
        editImage: async () => {
          throw new Error("generate mode must not call edits");
        },
        generateImage: async (request) => {
          calls.push(request);
          return {
            outputPath: "C:\\generated\\new.png",
            requestSize: "2048x2048"
          };
        }
      }
    );

    const result = await executor({
      mode: "generate",
      prompt: "生成一张新的花束商品图",
      sessionId: "esse-image-1",
      size: "2048x2048"
    });

    expect(calls).toEqual([
      {
        prompt: "生成一张新的花束商品图",
        sessionId: "esse-image-1",
        size: "2048x2048"
      }
    ]);
    expect(result.outputPath).toBe("C:\\generated\\new.png");
  });

  test("routes generate requests with reference images through edits so the API can see the references", async () => {
    const editCalls: unknown[] = [];
    const generationCalls: unknown[] = [];
    const executor = createImageGenerationExecutor(
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.tu-zi.com",
        model: "gpt-image-2",
        outputDirectory: "C:\\generated",
        size: "auto"
      },
      {
        editImage: async (request) => {
          editCalls.push(request);
          return {
            outputPath: "C:\\generated\\from-reference.png",
            requestSize: "1536x1024"
          };
        },
        generateImage: async (request) => {
          generationCalls.push(request);
          return {
            outputPath: "C:\\generated\\new.png",
            requestSize: "2048x2048"
          };
        }
      }
    );

    const result = await executor({
      mode: "generate",
      prompt: "根据参考图生成咖啡馆内部结构图",
      referenceImagePaths: ["C:\\refs\\sakura-cafe.jpg", "C:\\refs\\style.jpg"],
      sessionId: "esse-image-1",
      size: "1536x1024"
    });

    expect(generationCalls).toEqual([]);
    expect(editCalls).toEqual([
      {
        imagePath: "C:\\refs\\sakura-cafe.jpg",
        prompt: "根据参考图生成咖啡馆内部结构图",
        referenceImagePaths: ["C:\\refs\\style.jpg"],
        sessionId: "esse-image-1",
        size: "1536x1024"
      }
    ]);
    expect(result.outputPath).toBe("C:\\generated\\from-reference.png");
  });
});
