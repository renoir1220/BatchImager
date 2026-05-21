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

  it("keeps workspace images at their original ratio inside each cell", () => {
    const declarations = declarationsFor(".image-cell img");

    expect(declarations).toContain("object-fit: contain");
    expect(declarations).toContain("height: auto");
    expect(declarations).not.toContain("height: 100%");
    expect(declarations).not.toContain("object-fit: cover");
  });

  it("keeps the session preview at the image's original ratio", () => {
    const declarations = declarationsFor(".session-preview");

    expect(declarations).toContain("object-fit: contain");
    expect(declarations).not.toContain("aspect-ratio:");
    expect(declarations).not.toContain("object-fit: cover");
  });
});
