import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarationsFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));

  return match?.groups?.body ?? "";
}

describe("image display styles", () => {
  it("sizes workspace rows to image content instead of filling the viewport", () => {
    const workspaceDeclarations = declarationsFor(".image-workspace");
    const cellDeclarations = declarationsFor(".image-cell");

    expect(workspaceDeclarations).toContain("grid-auto-rows: max-content");
    expect(workspaceDeclarations).toContain("align-content: start");
    expect(workspaceDeclarations).toContain("align-items: start");
    expect(workspaceDeclarations).not.toContain("grid-auto-rows: minmax(180px, 1fr)");
    expect(cellDeclarations).toContain("align-self: start");
  });

  it("uses a white image workspace surface while keeping thin cell dividers", () => {
    const workspaceDeclarations = declarationsFor(".image-workspace");
    const cellDeclarations = declarationsFor(".image-cell");

    expect(workspaceDeclarations).toContain("background: #fff");
    expect(cellDeclarations).toContain("background: #fff");
    expect(cellDeclarations).toContain("box-shadow: 1px 0 0 var(--divider), 0 1px 0 var(--divider)");
  });

  it("keeps workspace images at their original ratio inside each cell", () => {
    const declarations = declarationsFor(".image-cell img");

    expect(declarations).toContain("object-fit: contain");
    expect(declarations).toContain("height: auto");
    expect(declarations).not.toContain("height: 100%");
    expect(declarations).not.toContain("object-fit: cover");
  });

  it("does not reserve a pinned original preview above the image chat", () => {
    expect(declarationsFor(".session-preview-frame")).toBe("");
    expect(declarationsFor(".session-preview")).toBe("");
  });

  it("keeps chat image attachments transparent instead of painting a preview background", () => {
    const declarations = declarationsFor(".thread-image");

    expect(declarations).toContain("background: transparent");
    expect(declarations).not.toContain("background: #e8e8e3");
  });

  it("uses a compact fixed project preview grid", () => {
    const declarations = declarationsFor(".project-preview-grid");
    const thumbDeclarations = declarationsFor(".project-preview-thumb");

    expect(declarations).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(declarations).toContain("grid-template-rows: repeat(2, minmax(0, 1fr))");
    expect(thumbDeclarations).toContain("aspect-ratio: 1 / 1");
  });
});
