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

  test("generation size control uses clickable 4K ratio tiles instead of a select or custom input", () => {
    const control = readProjectFile("src/components/GenerationSizeControl.tsx");

    expect(readProjectFile("src/components/SessionPanel.tsx")).toContain('label="生成比例："');
    expect(readProjectFile("src/components/BatchDialog.tsx")).toContain('label="生成比例："');
    expect(control).toContain("generation-size-label");
    expect(control).toContain("ratio-icon");
    expect(control).toContain("ratio-icon-landscape");
    expect(control).toContain("ratio-icon-portrait");
    expect(control).toContain("aria-pressed");
    expect(control).not.toContain("▭");
    expect(control).not.toContain("▯");
    expect(control).not.toContain("<select");
    expect(control).not.toContain("自定义");
    expect(control).not.toContain("原图尺寸");
    expect(control).not.toContain("2048x2048");
  });

  test("selected ratio icon turns blue without drawing a selected border", () => {
    const styles = readProjectFile("src/styles.css");
    const selectedRule = styles.match(/\.generation-size-tile\.selected\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    const hoverRule = styles.match(/\.generation-size-tile:hover:not\(:disabled\)\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    const selectedIconRule = styles.match(/\.generation-size-tile\.selected \.ratio-icon::before\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

    expect(selectedRule).toContain("border-color: transparent");
    expect(selectedRule).toContain("background: transparent");
    expect(selectedRule).toContain("color: var(--blue)");
    expect(selectedRule).not.toContain("color-mix");
    expect(hoverRule).toContain("background: transparent");
    expect(selectedIconRule).toContain("border-color: var(--blue)");
    expect(selectedIconRule).toContain("background: color-mix");
  });

  test("ratio icons are drawn as fine CSS shapes instead of text glyphs", () => {
    const styles = readProjectFile("src/styles.css");
    const iconRule = styles.match(/(?:^|\n)\.ratio-icon::before\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

    expect(iconRule).toContain("border: 1.5px solid currentColor");
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
