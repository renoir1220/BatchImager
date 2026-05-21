import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const toolbarSource = readFileSync(resolve(process.cwd(), "src/components/AppToolbar.tsx"), "utf8");
const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarationsFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));

  return match?.groups?.body ?? "";
}

describe("AppToolbar layout", () => {
  it("groups primary actions, view controls, and status controls separately", () => {
    expect(toolbarSource).toContain("toolbar-main-actions");
    expect(toolbarSource).toContain("toolbar-view-actions");
    expect(toolbarSource).toContain("toolbar-status-actions");
    expect(toolbarSource).toContain("toolbar-count");
  });

  it("does not visually offset toolbar controls with a drag spacer", () => {
    const declarations = declarationsFor(".window-drag-region");

    expect(declarations).toContain("width: 0");
    expect(declarations).not.toContain("width: 66px");
  });
});
