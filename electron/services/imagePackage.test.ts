import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { packageGeneratedImages } from "./imagePackage";

const tempRoots: string[] = [];

describe("imagePackage", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { force: true, recursive: true })));
    tempRoots.length = 0;
  });

  test("writes generated images into a desktop zip archive", async () => {
    const root = await makeTempRoot();
    const desktop = path.join(root, "Desktop");
    const imageA = path.join(root, "a.png");
    const imageB = path.join(root, "b.png");
    await writeFile(imageA, Buffer.from([1, 2, 3]));
    await writeFile(imageB, Buffer.from([4, 5, 6]));

    const result = await packageGeneratedImages({
      desktopDirectory: desktop,
      fileName: "batch.zip",
      imagePaths: [imageA, imageB]
    });

    await expect(stat(result.outputPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
    expect(result.outputPath).toBe(path.join(desktop, "batch.zip"));
    const zipBytes = await readFile(result.outputPath);
    expect(zipBytes.includes(Buffer.from("a.png"))).toBe(true);
    expect(zipBytes.includes(Buffer.from("b.png"))).toBe(true);
  });

  test("rejects packaging when there are no generated images", async () => {
    const root = await makeTempRoot();

    await expect(
      packageGeneratedImages({
        desktopDirectory: path.join(root, "Desktop"),
        imagePaths: []
      })
    ).rejects.toThrow("没有可打包的生成图片");
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "batchimager-package-"));
  tempRoots.push(root);
  return root;
}
