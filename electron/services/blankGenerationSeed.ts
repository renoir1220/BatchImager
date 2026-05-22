import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { normalizeGenerationSizeValue } from "../generationSizes";

interface CreateBlankGenerationSeedOptions {
  outputDirectory: string;
  sessionId: string;
  size?: string;
}

const DEFAULT_SEED_SIZE = { height: 1024, width: 1536 };

export async function createBlankGenerationSeed(options: CreateBlankGenerationSeedOptions): Promise<string> {
  const size = parseSize(options.size) ?? DEFAULT_SEED_SIZE;
  const seedDirectory = path.join(options.outputDirectory, "seeds");
  const seedPath = path.join(seedDirectory, `${toSafeName(options.sessionId)}-${size.width}x${size.height}.png`);

  await mkdir(seedDirectory, { recursive: true });
  await sharp({
    create: {
      background: { alpha: 0, b: 255, g: 255, r: 255 },
      channels: 4,
      height: size.height,
      width: size.width
    }
  })
    .png()
    .toFile(seedPath);

  return seedPath;
}

function parseSize(value: string | undefined): { height: number; width: number } | undefined {
  const normalized = normalizeGenerationSizeValue(value);

  if (!normalized) {
    return undefined;
  }

  const [width, height] = normalized.split("x").map(Number);

  return width > 0 && height > 0 ? { height, width } : undefined;
}

function toSafeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "esse-image";
}
