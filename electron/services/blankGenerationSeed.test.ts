import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import sharp from "sharp";
import { createBlankGenerationSeed } from "./blankGenerationSeed";

const tempRoots: string[] = [];

describe("blankGenerationSeed", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { force: true, recursive: true })));
    tempRoots.length = 0;
  });

  test("creates a transparent png matching the requested size", async () => {
    const root = await makeTempRoot();

    const seedPath = await createBlankGenerationSeed({
      outputDirectory: root,
      sessionId: "esse-image-1",
      size: "2048x1152"
    });

    await expect(stat(seedPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
    await expect(sharp(seedPath).metadata()).resolves.toMatchObject({
      format: "png",
      height: 1152,
      width: 2048
    });
  });

  test("uses a non-square default seed when no size is selected", async () => {
    const root = await makeTempRoot();

    const seedPath = await createBlankGenerationSeed({
      outputDirectory: root,
      sessionId: "esse-image-1"
    });

    await expect(sharp(seedPath).metadata()).resolves.toMatchObject({
      height: 1024,
      width: 1536
    });
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "batchimager-seed-"));
  tempRoots.push(root);
  return root;
}
