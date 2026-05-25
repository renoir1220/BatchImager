import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

function readProjectFile(filePath: string): string {
  return readFileSync(resolve(process.cwd(), filePath), "utf8");
}

describe("generation size UI wiring", () => {
  test("batch dialog and session panel share the same generation size control", () => {
    expect(readProjectFile("src/components/BatchDialog.tsx")).toContain("GenerationSizeControl");
    expect(readProjectFile("src/components/SessionPanel.tsx")).toContain("GenerationSizeControl");
  });

  test("generation size control opens from the icon button with mainstream resolution and ratio choices", () => {
    const control = readProjectFile("src/components/GenerationSizeControl.tsx");

    expect(readProjectFile("src/components/SessionPanel.tsx")).toContain('label="生成尺寸："');
    expect(readProjectFile("src/components/BatchDialog.tsx")).toContain('label="生成尺寸："');
    expect(control).toContain("GenerationSizeIcon");
    expect(control).toContain("generation-size-heading-icon");
    expect(control).toContain("aria-expanded={isOpen}");
    expect(control).toContain("generation-size-popover");
    expect(control).toContain("RESOLUTION_OPTIONS");
    expect(control).toContain("1K");
    expect(control).toContain("2K");
    expect(control).toContain("4K");
    expect(control).toContain("ratioLabel");
    expect(control).toContain("writeStoredSize");
    expect(control).not.toContain("generation-size-label");
    expect(control).toContain("ratio-icon");
    expect(control).toContain("ratio-icon-square");
    expect(control).toContain("ratio-icon-landscape");
    expect(control).toContain("ratio-icon-portrait");
    expect(control).not.toContain("▭");
    expect(control).not.toContain("▯");
    expect(control).not.toContain("<select");
    expect(control).not.toContain("自定义");
    expect(control).not.toContain("原图尺寸");
  });

  test("selected ratio icon uses a refined tinted active state", () => {
    const styles = readProjectFile("src/styles.css");
    const selectedRule = styles.match(/\.generation-ratio-option\.selected\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    const hoverRule = styles.match(/\.generation-size-current:hover:not\(:disabled\)\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    const selectedIconRule = styles.match(/\.generation-ratio-option\.selected \.ratio-icon::before,\n\.generation-size-current \.ratio-icon::before\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

    expect(selectedRule).toContain("background: color-mix");
    expect(selectedRule).toContain("color: var(--blue)");
    expect(hoverRule).toContain("background: color-mix");
    expect(selectedIconRule).toContain("border-color: currentColor");
    expect(selectedIconRule).toContain("background: color-mix");
  });

  test("ratio icons are drawn as fine CSS shapes instead of text glyphs", () => {
    const styles = readProjectFile("src/styles.css");
    const iconRule = styles.match(/(?:^|\n)\.ratio-icon::before\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

    expect(iconRule).toContain("border: 1.35px solid currentColor");
    expect(styles).toContain(".ratio-icon-square::before");
    expect(styles).toContain(".ratio-icon-landscape::before");
    expect(styles).toContain(".ratio-icon-portrait::before");
  });

  test("right sidebar composer groups ratio controls with the message input", () => {
    const sessionPanel = readProjectFile("src/components/SessionPanel.tsx");
    const projectPanel = readProjectFile("src/components/ProjectPlanPanel.tsx");
    const styles = readProjectFile("src/styles.css");

    expect(sessionPanel).toContain("session-control-dock");
    expect(projectPanel).toContain("session-control-dock");
    expect(styles).toContain(".session-control-dock");
    expect(styles).toContain("border-top:");
  });

  test("composer send button styling does not paint ratio buttons", () => {
    const styles = readProjectFile("src/styles.css");

    expect(styles).toContain(".session-composer > button:not(:disabled)");
    expect(styles).not.toContain(".session-composer button:not(:disabled)");
  });

  test("batch and chat requests carry an optional selected output size", () => {
    expect(readProjectFile("src/App.tsx")).toContain("outputSize");
    expect(readProjectFile("electron/ipcTypes.ts")).toContain("outputSize?: string");
  });
});
