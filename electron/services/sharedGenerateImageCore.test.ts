import { describe, expect, test, vi } from "vitest";
import { runSharedGenerateImageCore, type SharedGenerateImageRequest } from "./sharedGenerateImageCore";

describe("runSharedGenerateImageCore", () => {
  test("uses selected output size before tool requested size", async () => {
    const calls: SharedGenerateImageRequest[] = [];

    await runSharedGenerateImageCore({
      generateImage: async (request) => {
        calls.push(request);
        return createResult();
      },
      imagePath: "/project/source.png",
      mode: "edit",
      prompt: "白底商品图",
      selectedOutputSize: "2048x1152",
      sessionId: "sess_1",
      toolRequestedSize: "1024x1024"
    });

    expect(calls[0]).toMatchObject({
      imagePath: "/project/source.png",
      mode: "edit",
      prompt: "白底商品图",
      sessionId: "sess_1",
      size: "2048x1152"
    });
  });

  test("normalizes tool requested size and forwards references and signal", async () => {
    const signal = new AbortController().signal;
    const generateImage = vi.fn(async () => createResult());

    await runSharedGenerateImageCore({
      generateImage,
      imagePath: "/project/source.png",
      mode: "generate",
      prompt: "生成一张场景图",
      referenceImagePaths: ["/project/ref-a.png", ""],
      sessionId: "sess_2",
      signal,
      toolRequestedSize: "3840 X 2160"
    });

    expect(generateImage).toHaveBeenCalledWith({
      imagePath: "/project/source.png",
      mode: "generate",
      prompt: "生成一张场景图",
      referenceImagePaths: ["/project/ref-a.png"],
      sessionId: "sess_2",
      signal,
      size: "3840x2160"
    });
  });

  test("omits optional fields when no size or references are provided", async () => {
    const generateImage = vi.fn(async () => createResult());

    await runSharedGenerateImageCore({
      generateImage,
      imagePath: "/project/source.png",
      mode: "edit",
      prompt: "去掉背景",
      referenceImagePaths: [],
      sessionId: "sess_3"
    });

    expect(generateImage).toHaveBeenCalledWith({
      imagePath: "/project/source.png",
      mode: "edit",
      prompt: "去掉背景",
      sessionId: "sess_3"
    });
  });
});

function createResult() {
  return {
    outputPath: "/project/out.png",
    requestSize: "2048x1152"
  };
}
