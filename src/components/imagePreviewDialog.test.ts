import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

function readProjectFile(filePath: string): string {
  return readFileSync(resolve(process.cwd(), filePath), "utf8");
}

describe("image preview dialog", () => {
  test("uses a generic image list so chat images and workspace images share zoom preview", () => {
    const dialog = readProjectFile("src/components/ImagePreviewDialog.tsx");

    expect(dialog).toContain("images: PreviewImage[]");
    expect(dialog).toContain("initialPath");
    expect(dialog).toContain("zoomPreviewTransform");
    expect(dialog).toContain("panPreviewTransform");
  });

  test("keeps the preview image hidden until its fitted transform is ready", () => {
    const dialog = readProjectFile("src/components/ImagePreviewDialog.tsx");
    const styles = readProjectFile("src/styles.css");

    expect(dialog).toContain("isImageReady");
    expect(dialog).toContain('className={isImageReady ? "ready" : "loading"}');
    expect(styles).toContain(".preview-stage img.loading");
    expect(styles).toContain("opacity: 0");
  });

  test("copies the selected preview image from the right click menu path", () => {
    const dialog = readProjectFile("src/components/ImagePreviewDialog.tsx");
    const preload = readProjectFile("electron/preload.ts");
    const main = readProjectFile("electron/main.ts");

    expect(dialog).toContain("onContextMenu");
    expect(dialog).toContain("onCopyImage");
    expect(preload).toContain("copyImageToClipboard");
    expect(main).toContain('ipcMain.handle("images:copy-to-clipboard"');
    expect(main).toContain("clipboard.writeImage");
  });
});
