import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, test } from "vitest";
import { deriveGenerationSize, prepareImageForEditApi } from "./imageEditInput";

let temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { force: true, recursive: true })));
  temporaryDirectories = [];
});

describe("imageEditInput", () => {
  test("converts a large source image to png and keeps aspect ratio within 4K bounds", async () => {
    const directory = await createTemporaryDirectory();
    const sourcePath = path.join(directory, "source.jpg");
    await sharp({
      create: {
        background: "#d95c72",
        channels: 3,
        height: 2500,
        width: 5000
      }
    })
      .jpeg({ quality: 95 })
      .toFile(sourcePath);

    const prepared = await prepareImageForEditApi(sourcePath, {
      outputDirectory: path.join(directory, "prepared"),
      sessionId: "img-1"
    });
    const metadata = await sharp(prepared.imagePath).metadata();

    expect(metadata.format).toBe("png");
    expect(prepared.width).toBe(3840);
    expect(prepared.height).toBe(1920);
    expect(prepared.byteLength).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(prepared.resized).toBe(true);
    expect(prepared.converted).toBe(true);
  });

  test("keeps a small png at its original dimensions when it is already valid", async () => {
    const directory = await createTemporaryDirectory();
    const sourcePath = path.join(directory, "source.png");
    await sharp({
      create: {
        background: "#ffffff",
        channels: 4,
        height: 720,
        width: 960
      }
    })
      .png()
      .toFile(sourcePath);

    const prepared = await prepareImageForEditApi(sourcePath, {
      outputDirectory: path.join(directory, "prepared"),
      sessionId: "img-2"
    });

    expect(prepared.width).toBe(960);
    expect(prepared.height).toBe(720);
    expect(prepared.resized).toBe(false);
    expect(prepared.converted).toBe(false);
  });

  test("uses prepared input dimensions as the default generation size", () => {
    expect(deriveGenerationSize(undefined, { width: 1536, height: 1024 })).toBe("1536x1024");
    expect(deriveGenerationSize("auto", { width: 1024, height: 1536 })).toBe("1024x1536");
    expect(deriveGenerationSize("3840x2160", { width: 1024, height: 768 })).toBe("3840x2160");
    expect(deriveGenerationSize("2048*1152", { width: 1024, height: 768 })).toBe("2048x1152");
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "batchimager-image-input-"));
  temporaryDirectories.push(directory);
  return directory;
}
