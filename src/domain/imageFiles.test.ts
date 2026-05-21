import { describe, expect, it } from "vitest";
import { dedupeImageFiles, isSupportedImagePath } from "./imageFiles";

describe("image file filtering", () => {
  it("accepts common raster image extensions regardless of case", () => {
    expect(isSupportedImagePath("C:/shots/rose.JPG")).toBe(true);
    expect(isSupportedImagePath("C:/shots/table.png")).toBe(true);
    expect(isSupportedImagePath("C:/shots/catalog.WEBP")).toBe(true);
    expect(isSupportedImagePath("C:/shots/raw.heic")).toBe(true);
  });

  it("rejects unsupported files and paths without extensions", () => {
    expect(isSupportedImagePath("C:/shots/readme.txt")).toBe(false);
    expect(isSupportedImagePath("C:/shots/archive.zip")).toBe(false);
    expect(isSupportedImagePath("C:/shots/folder")).toBe(false);
  });

  it("keeps first occurrence while removing duplicate paths case-insensitively", () => {
    const files = [
      "C:/shots/IMG_0001.JPG",
      "C:/shots/IMG_0002.JPG",
      "c:/shots/img_0001.jpg",
      "C:/shots/notes.txt",
      "C:/shots/IMG_0003.png"
    ];

    expect(dedupeImageFiles(files)).toEqual([
      "C:/shots/IMG_0001.JPG",
      "C:/shots/IMG_0002.JPG",
      "C:/shots/IMG_0003.png"
    ]);
  });
});
