import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import sharp from "sharp";

const iconNames = [
  "batchimager-esse-os26.png",
  "batchimager-esse-os26-light.png",
  "batchimager-esse-os26-dark.png"
];

describe("app icon assets", () => {
  test("runtime PNG icons use the same white rounded app tile", async () => {
    const canonicalIcon = readFileSync(path.resolve(process.cwd(), "src/assets/app-icons/batchimager-esse-os26-light.png"));

    for (const iconName of iconNames) {
      const iconPath = path.resolve(process.cwd(), "src/assets/app-icons", iconName);
      const iconBuffer = readFileSync(iconPath);
      const metadata = await sharp(iconPath).metadata();
      const cornerSample = await sharp(iconPath)
        .extract({ height: 1, left: 0, top: 0, width: 1 })
        .raw()
        .toBuffer();
      const tileSample = await sharp(iconPath)
        .extract({ height: 1, left: 512, top: 140, width: 1 })
        .raw()
        .toBuffer();

      expect(iconBuffer.equals(canonicalIcon)).toBe(true);
      expect(metadata.hasAlpha).toBe(true);
      expect(cornerSample[3]).toBe(0);
      expect(Array.from(tileSample)).toEqual([255, 255, 255, 255]);
    }
  });

  test("main process keeps the app icon fixed across system themes", () => {
    const mainSource = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");

    expect(mainSource).toContain("const APP_ICON_PATH");
    expect(mainSource).not.toContain("nativeTheme");
    expect(mainSource).not.toContain("APP_ICON_DARK_PATH");
  });

  test("Windows runtime icon uses a tighter canvas without changing the mac icon path", async () => {
    const mainSource = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");
    const packageJson = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as {
      build?: { mac?: { icon?: string }; win?: { icon?: string } };
    };
    const defaultIconPath = path.resolve(process.cwd(), "src/assets/app-icons/batchimager-esse-os26-light.png");
    const windowsIconPath = path.resolve(process.cwd(), "src/assets/app-icons/batchimager-windows.ico");

    expect(mainSource).toContain("const APP_ICON_WINDOWS_PATH");
    expect(mainSource).toContain('app.setAppUserModelId("com.batchimager.desktop")');
    expect(mainSource).toContain('process.platform === "win32" ? APP_ICON_WINDOWS_PATH : APP_ICON_PATH');
    expect(mainSource).toContain('"batchimager-esse-os26-light.png"');
    expect(mainSource).toContain('"batchimager-windows.ico"');
    expect(mainSource).not.toContain('"batchimager.icns"');
    expect(packageJson.build?.mac?.icon).toBe("src/assets/app-icons/batchimager.icns");
    expect(packageJson.build?.win?.icon).toBe("src/assets/app-icons/batchimager-windows.ico");

    const defaultAlphaSize = await getAlphaBoundingSize(defaultIconPath);
    const windowsAlphaSize = getIcoAlphaBoundingSize(windowsIconPath, 256);

    expect(windowsAlphaSize.width * 4).toBeGreaterThan(defaultAlphaSize.width);
    expect(windowsAlphaSize.height * 4).toBeGreaterThan(defaultAlphaSize.height);
    expect(windowsAlphaSize.width).toBeGreaterThanOrEqual(254);
    expect(windowsAlphaSize.height).toBeGreaterThanOrEqual(254);
  });
});

async function getAlphaBoundingSize(iconPath: string): Promise<{ height: number; width: number }> {
  const image = sharp(iconPath).ensureAlpha();
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const pixels = await image.raw().toBuffer();
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha === 0) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return { height: maxY - minY + 1, width: maxX - minX + 1 };
}

function getIcoAlphaBoundingSize(iconPath: string, targetSize: number): { height: number; width: number } {
  const icon = readFileSync(iconPath);
  const imageCount = icon.readUInt16LE(4);
  for (let index = 0; index < imageCount; index += 1) {
    const entryOffset = 6 + index * 16;
    const width = icon[entryOffset] || 256;
    const height = icon[entryOffset + 1] || 256;
    if (width !== targetSize || height !== targetSize) {
      continue;
    }

    const byteLength = icon.readUInt32LE(entryOffset + 8);
    const imageOffset = icon.readUInt32LE(entryOffset + 12);
    return getDibAlphaBoundingSize(icon.subarray(imageOffset, imageOffset + byteLength), width, height);
  }

  throw new Error(`Missing ${targetSize}x${targetSize} icon entry`);
}

function getDibAlphaBoundingSize(dib: Buffer, width: number, height: number): { height: number; width: number } {
  const headerSize = dib.readUInt32LE(0);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let row = 0; row < height; row += 1) {
    const y = height - 1 - row;
    for (let x = 0; x < width; x += 1) {
      const alpha = dib[headerSize + (row * width + x) * 4 + 3];
      if (alpha === 0) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return { height: maxY - minY + 1, width: maxX - minX + 1 };
}
