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
});
