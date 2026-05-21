import { describe, expect, test } from "vitest";
import {
  buildImageEditEndpoint,
  generateProductImage,
  parseTuziImageEditResponse
} from "./tuziImageApi";

describe("tuziImageApi", () => {
  test("builds the image edit endpoint from a base url", () => {
    expect(buildImageEditEndpoint("https://api.ourzhishi.top/")).toBe("https://api.ourzhishi.top/v1/images/edits");
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
});
