import { describe, expect, test } from "vitest";
import { GENERATION_SIZE_OPTIONS, normalizeGenerationSizeValue } from "./generationSizes";

describe("generationSizes", () => {
  test("keeps predefined generation sizes in one maintainable list", () => {
    expect(GENERATION_SIZE_OPTIONS).toEqual([
      { label: "1K 1:1 1024x1024", ratioLabel: "1:1", resolution: "1k", shortLabel: "1K 1:1", value: "1024x1024" },
      { label: "1K 3:2 1536x1024", ratioLabel: "3:2", resolution: "1k", shortLabel: "1K 3:2", value: "1536x1024" },
      { label: "1K 2:3 1024x1536", ratioLabel: "2:3", resolution: "1k", shortLabel: "1K 2:3", value: "1024x1536" },
      { label: "1K 16:9 1536x864", ratioLabel: "16:9", resolution: "1k", shortLabel: "1K 16:9", value: "1536x864" },
      { label: "1K 9:16 864x1536", ratioLabel: "9:16", resolution: "1k", shortLabel: "1K 9:16", value: "864x1536" },
      { label: "2K 1:1 2048x2048", ratioLabel: "1:1", resolution: "2k", shortLabel: "2K 1:1", value: "2048x2048" },
      { label: "2K 3:2 2304x1536", ratioLabel: "3:2", resolution: "2k", shortLabel: "2K 3:2", value: "2304x1536" },
      { label: "2K 2:3 1536x2304", ratioLabel: "2:3", resolution: "2k", shortLabel: "2K 2:3", value: "1536x2304" },
      { label: "2K 16:9 2048x1152", ratioLabel: "16:9", resolution: "2k", shortLabel: "2K 16:9", value: "2048x1152" },
      { label: "2K 9:16 1152x2048", ratioLabel: "9:16", resolution: "2k", shortLabel: "2K 9:16", value: "1152x2048" },
      { label: "4K 1:1 3840x3840", ratioLabel: "1:1", resolution: "4k", shortLabel: "4K 1:1", value: "3840x3840" },
      { label: "4K 3:2 3840x2560", ratioLabel: "3:2", resolution: "4k", shortLabel: "4K 3:2", value: "3840x2560" },
      { label: "4K 2:3 2560x3840", ratioLabel: "2:3", resolution: "4k", shortLabel: "4K 2:3", value: "2560x3840" },
      { label: "4K 16:9 3840x2160", ratioLabel: "16:9", resolution: "4k", shortLabel: "4K 16:9", value: "3840x2160" },
      { label: "4K 9:16 2160x3840", ratioLabel: "9:16", resolution: "4k", shortLabel: "4K 9:16", value: "2160x3840" }
    ]);
  });

  test("offers every supported ratio at every resolution", () => {
    for (const resolution of ["1k", "2k", "4k"]) {
      expect(GENERATION_SIZE_OPTIONS.filter((option) => option.resolution === resolution).map((option) => option.ratioLabel)).toEqual([
        "1:1",
        "3:2",
        "2:3",
        "16:9",
        "9:16"
      ]);
    }
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
