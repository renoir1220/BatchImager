import { describe, expect, test } from "vitest";
import { GENERATION_SIZE_OPTIONS, normalizeGenerationSizeValue } from "./generationSizes";

describe("generationSizes", () => {
  test("keeps predefined generation sizes in one maintainable list", () => {
    expect(GENERATION_SIZE_OPTIONS).toEqual([
      { label: "2K 方图 2048x2048", value: "2048x2048" },
      { label: "2K 横图 2048x1152", value: "2048x1152" },
      { label: "4K 横图 3840x2160", value: "3840x2160" },
      { label: "4K 竖图 2160x3840", value: "2160x3840" }
    ]);
  });

  test("normalizes custom generation sizes without introducing a default explicit size", () => {
    expect(normalizeGenerationSizeValue(undefined)).toBeUndefined();
    expect(normalizeGenerationSizeValue("")).toBeUndefined();
    expect(normalizeGenerationSizeValue(" 3000 * 2000 ")).toBe("3000x2000");
    expect(normalizeGenerationSizeValue("2048x1152")).toBe("2048x1152");
    expect(normalizeGenerationSizeValue("0x1152")).toBeUndefined();
    expect(normalizeGenerationSizeValue("wide")).toBeUndefined();
  });
});
