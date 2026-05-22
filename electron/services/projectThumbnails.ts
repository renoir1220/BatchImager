import { createHash } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

interface EnsureProjectThumbnailsOptions {
  maxLongEdge?: number;
}

const DEFAULT_THUMBNAIL_LONG_EDGE = 260;

export function getProjectThumbnailPath(projectDirectory: string, sourcePath: string): string {
  const hash = createHash("sha1").update(path.resolve(sourcePath).toLowerCase()).digest("hex").slice(0, 16);
  return path.join(getProjectThumbnailDirectory(projectDirectory), `thumb-${hash}.jpg`);
}

export async function readExistingProjectThumbnailPaths(projectDirectory: string, sourcePaths: string[]): Promise<string[]> {
  const thumbnailPaths: string[] = [];

  for (const sourcePath of sourcePaths) {
    const thumbnailPath = getProjectThumbnailPath(projectDirectory, sourcePath);
    if (await fileExists(thumbnailPath)) {
      thumbnailPaths.push(thumbnailPath);
    }
  }

  return thumbnailPaths;
}

export async function ensureProjectThumbnails(
  projectDirectory: string,
  sourcePaths: string[],
  options: EnsureProjectThumbnailsOptions = {}
): Promise<string[]> {
  const thumbnailPaths: string[] = [];
  const maxLongEdge = options.maxLongEdge ?? DEFAULT_THUMBNAIL_LONG_EDGE;

  await mkdir(getProjectThumbnailDirectory(projectDirectory), { recursive: true });

  for (const sourcePath of sourcePaths) {
    const thumbnailPath = getProjectThumbnailPath(projectDirectory, sourcePath);

    if (!(await fileExists(thumbnailPath))) {
      try {
        await sharp(sourcePath)
          .rotate()
          .resize({
            fit: "inside",
            height: maxLongEdge,
            width: maxLongEdge,
            withoutEnlargement: true
          })
          .jpeg({ quality: 82 })
          .toFile(thumbnailPath);
      } catch {
        continue;
      }
    }

    thumbnailPaths.push(thumbnailPath);
  }

  return thumbnailPaths;
}

function getProjectThumbnailDirectory(projectDirectory: string): string {
  return path.join(projectDirectory, "images", "thumbnails");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
