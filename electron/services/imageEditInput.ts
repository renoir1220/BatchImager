import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export interface PreparedEditImage {
  imagePath: string;
  width: number;
  height: number;
  byteLength: number;
  originalWidth: number;
  originalHeight: number;
  resized: boolean;
  converted: boolean;
}

export interface PrepareImageForEditApiOptions {
  outputDirectory: string;
  sessionId: string;
  maxBytes?: number;
  maxLongEdge?: number;
  minLongEdge?: number;
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_LONG_EDGE = 3840;
const DEFAULT_MIN_LONG_EDGE = 640;
const LONG_EDGE_STEPS = [3840, 3200, 2880, 2560, 2304, 2048, 1792, 1536, 1280, 1024, 896, 768, 640];

export async function prepareImageForEditApi(
  imagePath: string,
  options: PrepareImageForEditApiOptions
): Promise<PreparedEditImage> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLongEdge = options.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE;
  const minLongEdge = options.minLongEdge ?? DEFAULT_MIN_LONG_EDGE;
  const metadata = await sharp(imagePath).metadata();
  const originalWidth = metadata.width ?? 0;
  const originalHeight = metadata.height ?? 0;

  if (originalWidth <= 0 || originalHeight <= 0) {
    throw new Error("Unable to read image dimensions");
  }

  const originalStats = await stat(imagePath);
  const originalLongEdge = Math.max(originalWidth, originalHeight);
  const isPng = metadata.format === "png";

  if (isPng && originalStats.size <= maxBytes && originalLongEdge <= maxLongEdge) {
    return {
      byteLength: originalStats.size,
      converted: false,
      height: originalHeight,
      imagePath,
      originalHeight,
      originalWidth,
      resized: false,
      width: originalWidth
    };
  }

  await mkdir(options.outputDirectory, { recursive: true });

  const candidates = buildLongEdgeCandidates(originalLongEdge, maxLongEdge, minLongEdge);
  let lastPrepared: PreparedEditImage | undefined;

  for (const longEdge of candidates) {
    const rendered = await renderPngCandidate(imagePath, longEdge);
    const outputPath = path.join(
      options.outputDirectory,
      `${toSafeName(options.sessionId)}-${rendered.info.width}x${rendered.info.height}.png`
    );
    await writeFile(outputPath, rendered.data);

    const prepared: PreparedEditImage = {
      byteLength: rendered.data.byteLength,
      converted: !isPng,
      height: rendered.info.height,
      imagePath: outputPath,
      originalHeight,
      originalWidth,
      resized: rendered.info.width !== originalWidth || rendered.info.height !== originalHeight,
      width: rendered.info.width
    };
    lastPrepared = prepared;

    if (prepared.byteLength <= maxBytes) {
      return prepared;
    }
  }

  throw new Error(
    `Prepared image is still larger than ${maxBytes} bytes at ${lastPrepared?.width ?? 0}x${lastPrepared?.height ?? 0}`
  );
}

export function deriveGenerationSize(
  requestedSize: string | undefined,
  image: { width: number; height: number }
): string {
  const normalized = requestedSize?.trim().replace("*", "x");

  if (normalized && normalized.toLowerCase() !== "auto") {
    return normalized;
  }

  return `${image.width}x${image.height}`;
}

function buildLongEdgeCandidates(originalLongEdge: number, maxLongEdge: number, minLongEdge: number): number[] {
  const firstLongEdge = Math.min(originalLongEdge, maxLongEdge);
  const candidates = [firstLongEdge, ...LONG_EDGE_STEPS.filter((edge) => edge < firstLongEdge && edge >= minLongEdge)];
  const unique = [...new Set(candidates.map((edge) => Math.max(edge, minLongEdge)))];

  return unique.sort((a, b) => b - a);
}

async function renderPngCandidate(
  imagePath: string,
  longEdge: number
): Promise<{ data: Buffer; info: sharp.OutputInfo }> {
  return sharp(imagePath)
    .rotate()
    .resize({
      fit: "inside",
      height: longEdge,
      withoutEnlargement: true,
      width: longEdge
    })
    .png({
      adaptiveFiltering: true,
      compressionLevel: 9
    })
    .toBuffer({ resolveWithObject: true });
}

function toSafeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
}
