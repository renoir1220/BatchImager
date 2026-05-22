import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, test } from "vitest";
import {
  ensureProjectThumbnails,
  getProjectThumbnailPath,
  readExistingProjectThumbnailPaths
} from "./projectThumbnails";

const tempRoots: string[] = [];

describe("projectThumbnails", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { force: true, recursive: true })));
    tempRoots.length = 0;
  });

  test("reads only existing cached thumbnails without generating missing files", async () => {
    const root = await makeTempRoot();
    const projectDirectory = path.join(root, "project-1");
    const sourceA = path.join(root, "source-a.png");
    const sourceB = path.join(root, "source-b.png");
    const cachedA = getProjectThumbnailPath(projectDirectory, sourceA);
    await mkdir(path.dirname(cachedA), { recursive: true });
    await writeFile(cachedA, "cached");

    const paths = await readExistingProjectThumbnailPaths(projectDirectory, [sourceA, sourceB]);

    expect(paths).toEqual([cachedA]);
  });

  test("creates compact jpeg thumbnails without stretching the source image", async () => {
    const root = await makeTempRoot();
    const projectDirectory = path.join(root, "project-1");
    const source = path.join(root, "wide-source.png");
    await sharp({
      create: {
        background: "#ffffff",
        channels: 3,
        height: 600,
        width: 1200
      }
    })
      .png()
      .toFile(source);

    const paths = await ensureProjectThumbnails(projectDirectory, [source], { maxLongEdge: 260 });

    expect(paths).toEqual([getProjectThumbnailPath(projectDirectory, source)]);
    const metadata = await sharp(paths[0]).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(260);
    expect(metadata.height).toBe(130);
  });

  test("skips missing source images instead of failing the whole preview batch", async () => {
    const root = await makeTempRoot();
    const projectDirectory = path.join(root, "project-1");
    const source = path.join(root, "source.png");
    const missing = path.join(root, "missing.png");
    await sharp({
      create: {
        background: "#ffffff",
        channels: 3,
        height: 32,
        width: 32
      }
    })
      .png()
      .toFile(source);

    const paths = await ensureProjectThumbnails(projectDirectory, [missing, source], { maxLongEdge: 260 });

    expect(paths).toEqual([getProjectThumbnailPath(projectDirectory, source)]);
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "batchimager-thumbs-"));
  tempRoots.push(root);
  return root;
}
