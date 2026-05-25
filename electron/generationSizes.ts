export interface GenerationSizeOption {
  label: string;
  ratioLabel: string;
  resolution: "1k" | "2k" | "4k";
  shortLabel: string;
  value: string;
}

export const GENERATION_SIZE_OPTIONS: GenerationSizeOption[] = [
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
];

export type GenerationResolution = GenerationSizeOption["resolution"];
export type GenerationRatioLabel = GenerationSizeOption["ratioLabel"];

export const GENERATION_RATIO_LABELS: GenerationRatioLabel[] = ["1:1", "3:2", "2:3", "16:9", "9:16"];

export function findGenerationSizeOption(resolution: GenerationResolution, ratioLabel: GenerationRatioLabel): GenerationSizeOption | undefined {
  return GENERATION_SIZE_OPTIONS.find((option) => option.resolution === resolution && option.ratioLabel === ratioLabel);
}

export function normalizeGenerationSizeValue(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s*[*xX]\s*/, "x");

  if (!normalized) {
    return undefined;
  }

  const match = normalized.match(/^(\d{1,5})x(\d{1,5})$/);

  if (!match) {
    return undefined;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return undefined;
  }

  return `${width}x${height}`;
}
