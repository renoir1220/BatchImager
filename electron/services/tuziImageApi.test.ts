import { describe, expect, test } from "vitest";
import type { AppLogger, BackendLogOptions } from "./appLogger";
import {
  buildImageEditEndpoint,
  buildImageGenerationEndpoint,
  generateImageFromPrompt,
  generateProductImage,
  parseTuziImageEditResponse
} from "./tuziImageApi";

describe("tuziImageApi", () => {
  test("builds the image edit endpoint from a base url", () => {
    expect(buildImageEditEndpoint("https://api.ourzhishi.top/")).toBe("https://api.ourzhishi.top/v1/images/edits");
  });

  test("builds the text-to-image generation endpoint from a base url", () => {
    expect(buildImageGenerationEndpoint("https://api.tu-zi.com/")).toBe("https://api.tu-zi.com/v1/images/generations");
  });

  test("parses generated image urls from the Tuzi response", () => {
    expect(parseTuziImageEditResponse({ data: [{ url: "https://cdn.example.com/result.png" }] })).toEqual({
      base64Json: undefined,
      url: "https://cdn.example.com/result.png"
    });
  });

  test("rejects responses without a generated image", () => {
    expect(() => parseTuziImageEditResponse({ data: [] })).toThrow("No generated image");
  });

  test("posts multipart image edit request and stores the generated image locally", async () => {
    const writtenFiles: Array<{ path: string; data: Uint8Array }> = [];
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

    const result = await generateProductImage(
      {
        imagePath: "C:\\images\\flower.png",
        prompt: "生成明亮室内商品图",
        sessionId: "img-1"
      },
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.ourzhishi.top",
        model: "gpt-image-2",
        outputDirectory: "C:\\generated",
        size: "auto"
      },
      {
        fetch: async (url, init) => {
          fetchCalls.push({ url: String(url), init });

          if (String(url).endsWith("/v1/images/edits")) {
            const body = init?.body as FormData;

            expect(init?.method).toBe("POST");
            expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer local-test-key");
            expect(body.get("model")).toBe("gpt-image-2");
            expect(body.get("prompt")).toBe("生成明亮室内商品图");
            expect(body.get("size")).toBe("1024x1536");
            expect(body.get("n")).toBe("1");
            expect(body.get("response_format")).toBe("url");
            expect(body.get("image")).toBeInstanceOf(Blob);

            return new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/result.png" }] }), {
              headers: { "content-type": "application/json" },
              status: 200
            });
          }

          return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        },
        makeNow: () => new Date("2026-05-21T13:00:00.000Z"),
        mkdir: async () => undefined,
        prepareImage: async () => ({
          byteLength: 3072,
          converted: true,
          height: 1536,
          imagePath: "C:\\prepared\\flower.png",
          originalHeight: 3000,
          originalWidth: 2000,
          resized: true,
          width: 1024
        }),
        readFile: async () => Buffer.from([9, 8, 7]),
        writeFile: async (filePath, data) => {
          writtenFiles.push({ path: filePath, data: new Uint8Array(data) });
        }
      }
    );

    expect(fetchCalls).toHaveLength(2);
    expect(writtenFiles).toHaveLength(1);
    expect(writtenFiles[0]?.path).toContain("img-1-2026-05-21T13-00-00-000Z.png");
    expect(Array.from(writtenFiles[0]?.data ?? [])).toEqual([1, 2, 3]);
    expect(result.inputImage).toMatchObject({
      byteLength: 3072,
      height: 1536,
      width: 1024
    });
    expect(result.outputPath).toBe(writtenFiles[0]?.path);
    expect(result.requestSize).toBe("1024x1536");
    expect(result.remoteUrl).toBe("https://cdn.example.com/result.png");
  });

  test("posts product image plus pasted reference images as edit inputs", async () => {
    const preparedPaths: string[] = [];
    const readPaths: string[] = [];

    await generateProductImage(
      {
        imagePath: "C:\\images\\flower.png",
        prompt: "把鲜花放进参考房间里拍成商品图",
        referenceImagePaths: ["C:\\references\\warm-room.png"],
        sessionId: "img-1"
      },
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.ourzhishi.top",
        model: "gpt-image-2",
        outputDirectory: "C:\\generated",
        size: "auto"
      },
      {
        fetch: async (url, init) => {
          if (String(url).endsWith("/v1/images/edits")) {
            const body = init?.body as FormData;

            expect(body.getAll("image")).toHaveLength(2);

            return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from([1, 2, 3]).toString("base64") }] }), {
              headers: { "content-type": "application/json" },
              status: 200
            });
          }

          return new Response(null, { status: 404 });
        },
        makeNow: () => new Date("2026-05-21T13:00:00.000Z"),
        mkdir: async () => undefined,
        prepareImage: async (imagePath) => {
          preparedPaths.push(imagePath);

          return {
            byteLength: 2048,
            converted: true,
            height: imagePath.includes("warm-room") ? 900 : 1536,
            imagePath: imagePath.includes("warm-room") ? "C:\\prepared\\warm-room.png" : "C:\\prepared\\flower.png",
            originalHeight: imagePath.includes("warm-room") ? 900 : 3000,
            originalWidth: imagePath.includes("warm-room") ? 1200 : 2000,
            resized: false,
            width: imagePath.includes("warm-room") ? 1200 : 1024
          };
        },
        readFile: async (filePath) => {
          readPaths.push(filePath);
          return Buffer.from([9, 8, 7]);
        },
        writeFile: async () => undefined
      }
    );

    expect(preparedPaths).toEqual(["C:\\images\\flower.png", "C:\\references\\warm-room.png"]);
    expect(readPaths).toEqual(["C:\\prepared\\flower.png", "C:\\prepared\\warm-room.png"]);
  });

  test("retries transient image edit API failures up to three times before succeeding", async () => {
    const editStatuses = [503, 503, 503, 200];
    const editAttemptNumbers: number[] = [];
    const sleepDelays: number[] = [];
    const publicMessages: string[] = [];

    const result = await generateProductImage(
      {
        imagePath: "C:\\images\\flower.png",
        prompt: "生成明亮室内商品图",
        sessionId: "img-1"
      },
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.ourzhishi.top",
        model: "gpt-image-2",
        outputDirectory: "C:\\generated",
        size: "auto"
      },
      {
        fetch: async (url) => {
          if (String(url).endsWith("/v1/images/edits")) {
            const attemptNumber = editAttemptNumbers.length + 1;
            editAttemptNumbers.push(attemptNumber);

            const status = editStatuses[attemptNumber - 1] ?? 503;
            if (status !== 200) {
              return new Response(`temporary ${status}`, { status });
            }

            return new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/result.png" }] }), {
              headers: { "content-type": "application/json" },
              status: 200
            });
          }

          return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        },
        makeNow: () => new Date("2026-05-21T13:00:00.000Z"),
        mkdir: async () => undefined,
        prepareImage: async () => ({
          byteLength: 3072,
          converted: true,
          height: 1536,
          imagePath: "C:\\prepared\\flower.png",
          originalHeight: 3000,
          originalWidth: 2000,
          resized: true,
          width: 1024
        }),
        readFile: async () => Buffer.from([9, 8, 7]),
        sleep: async (ms) => {
          sleepDelays.push(ms);
        },
        writeFile: async () => undefined
      },
      createPublicMessageLogger(publicMessages)
    );

    expect(editAttemptNumbers).toEqual([1, 2, 3, 4]);
    expect(sleepDelays).toEqual([500, 1000, 2000]);
    expect(publicMessages).toContain("接口暂时不可用，正在重试 1/3...");
    expect(publicMessages).toContain("接口暂时不可用，正在重试 2/3...");
    expect(publicMessages).toContain("接口暂时不可用，正在重试 3/3...");
    expect(result.outputPath).toContain("img-1-2026-05-21T13-00-00-000Z.png");
  });

  test("posts prompt-only image generation request and stores the generated image locally", async () => {
    const writtenFiles: Array<{ path: string; data: Uint8Array }> = [];
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

    const result = await generateImageFromPrompt(
      {
        prompt: "生成一张春日咖啡馆插画",
        sessionId: "esse-image-1",
        size: "2048x2048"
      },
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.tu-zi.com",
        model: "gpt-image-2",
        outputDirectory: "C:\\generated",
        size: "auto"
      },
      {
        fetch: async (url, init) => {
          fetchCalls.push({ url: String(url), init });

          if (String(url).endsWith("/v1/images/generations")) {
            expect(init?.method).toBe("POST");
            expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer local-test-key");
            expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
            expect(JSON.parse(String(init?.body))).toEqual({
              model: "gpt-image-2",
              prompt: "生成一张春日咖啡馆插画",
              quality: "auto",
              response_format: "url",
              size: "2048x2048"
            });

            return new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/generated.png" }] }), {
              headers: { "content-type": "application/json" },
              status: 200
            });
          }

          return new Response(new Uint8Array([4, 5, 6]), { status: 200 });
        },
        makeNow: () => new Date("2026-05-21T13:00:00.000Z"),
        mkdir: async () => undefined,
        prepareImage: async () => {
          throw new Error("prompt-only generation must not prepare an edit input");
        },
        readFile: async () => {
          throw new Error("prompt-only generation must not read a source image");
        },
        writeFile: async (filePath, data) => {
          writtenFiles.push({ path: filePath, data: new Uint8Array(data) });
        }
      }
    );

    expect(fetchCalls.map((call) => call.url)).toEqual([
      "https://api.tu-zi.com/v1/images/generations",
      "https://cdn.example.com/generated.png"
    ]);
    expect(writtenFiles[0]?.path).toContain("esse-image-1-2026-05-21T13-00-00-000Z.png");
    expect(Array.from(writtenFiles[0]?.data ?? [])).toEqual([4, 5, 6]);
    expect(result.inputImage).toBeUndefined();
    expect(result.requestSize).toBe("2048x2048");
  });

  test("omits auto quality for AA gpt-image-2 fixed-quality aliases", async () => {
    await generateImageFromPrompt(
      {
        prompt: "生成一张春日咖啡馆插画",
        sessionId: "esse-image-1",
        size: "1024x1024"
      },
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.aiflow321.cn",
        model: "AA-gpt-image-2-medium",
        outputDirectory: "C:\\generated",
        size: "auto"
      },
      {
        fetch: async (url, init) => {
          if (String(url).endsWith("/v1/images/generations")) {
            expect(JSON.parse(String(init?.body))).toEqual({
              model: "AA-gpt-image-2-medium",
              prompt: "生成一张春日咖啡馆插画",
              response_format: "url",
              size: "1024x1024"
            });

            return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from([4, 5, 6]).toString("base64") }] }), {
              headers: { "content-type": "application/json" },
              status: 200
            });
          }

          return new Response(null, { status: 404 });
        },
        makeNow: () => new Date("2026-05-21T13:00:00.000Z"),
        mkdir: async () => undefined,
        prepareImage: async () => {
          throw new Error("prompt-only generation must not prepare an edit input");
        },
        readFile: async () => {
          throw new Error("prompt-only generation must not read a source image");
        },
        writeFile: async () => undefined
      }
    );
  });

  test("notifies recovery tracking when a remote generated image url is available before download", async () => {
    const remoteEvents: Array<{ remoteUrl?: string; requestSize: string; sessionId: string }> = [];

    await generateProductImage(
      {
        imagePath: "C:\\images\\placeholder.png",
        onRemoteImage: (event) => {
          remoteEvents.push(event);
        },
        prompt: "生成一张春日咖啡馆插画",
        sessionId: "esse-image-1"
      },
      {
        apiKey: "local-test-key",
        baseUrl: "https://api.tu-zi.com",
        model: "gpt-image-2",
        outputDirectory: "C:\\generated",
        size: "auto"
      },
      {
        fetch: async (url) =>
          String(url).endsWith("/v1/images/edits")
            ? new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/generated.png" }] }), {
                headers: { "content-type": "application/json" },
                status: 200
              })
            : new Response(new Uint8Array([4, 5, 6]), { status: 200 }),
        makeNow: () => new Date("2026-05-21T13:00:00.000Z"),
        mkdir: async () => undefined,
        prepareImage: async () => ({
          byteLength: 1024,
          converted: false,
          height: 1024,
          imagePath: "C:\\prepared\\placeholder.png",
          originalHeight: 1024,
          originalWidth: 1536,
          resized: false,
          width: 1536
        }),
        readFile: async () => Buffer.from([9, 8, 7]),
        writeFile: async () => undefined
      }
    );

    expect(remoteEvents).toEqual([
      {
        remoteUrl: "https://cdn.example.com/generated.png",
        requestSize: "1536x1024",
        sessionId: "esse-image-1"
      }
    ]);
  });

  test("wraps network failures with the underlying fetch cause", async () => {
    const cause = new Error("Client network socket disconnected before secure TLS connection was established");
    const fetchError = new Error("fetch failed", { cause });

    await expect(
      generateProductImage(
        {
          imagePath: "C:\\images\\flower.png",
          prompt: "生成明亮室内商品图",
          sessionId: "img-1"
        },
        {
          apiKey: "local-test-key",
          baseUrl: "https://api.ourzhishi.top",
          model: "gpt-image-2",
          outputDirectory: "C:\\generated",
          size: "auto"
        },
        {
          fetch: async () => {
            throw fetchError;
          },
          makeNow: () => new Date("2026-05-21T13:00:00.000Z"),
          mkdir: async () => undefined,
          prepareImage: async () => ({
            byteLength: 3072,
            converted: true,
            height: 1536,
            imagePath: "C:\\prepared\\flower.png",
            originalHeight: 3000,
            originalWidth: 2000,
            resized: true,
            width: 1024
          }),
          readFile: async () => Buffer.from([9, 8, 7]),
          sleep: async () => undefined,
          writeFile: async () => undefined
        }
      )
    ).rejects.toThrow("Image generation request failed: fetch failed（Client network socket disconnected before secure TLS connection was established）");
  });
});

function createPublicMessageLogger(publicMessages: string[]): AppLogger {
  const capture = (_message: string, options?: BackendLogOptions) => {
    if (options?.publicMessage) {
      publicMessages.push(options.publicMessage);
    }
  };

  return {
    debug: capture,
    error: capture,
    getEntries: () => publicMessages.map((message) => ({ level: "info", message, timestamp: "" })),
    info: capture,
    subscribe: () => () => undefined,
    warn: capture
  };
}
