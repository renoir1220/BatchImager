export interface GenerationSizeOption {
  label: string;
  value: string;
}

export const GENERATION_SIZE_OPTIONS: GenerationSizeOption[] = [
  { label: "2K 方图 2048x2048", value: "2048x2048" },
  { label: "2K 横图 2048x1152", value: "2048x1152" },
  { label: "4K 横图 3840x2160", value: "3840x2160" },
  { label: "4K 竖图 2160x3840", value: "2160x3840" }
];

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
