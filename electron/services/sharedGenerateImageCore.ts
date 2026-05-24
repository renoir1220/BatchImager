import { normalizeGenerationSizeValue } from "../generationSizes";
import type { ProductImageResult } from "./tuziImageApi";

export interface SharedGenerateImageRequest {
  imagePath: string;
  mode: "edit" | "generate";
  prompt: string;
  referenceImagePaths?: string[];
  sessionId: string;
  signal?: AbortSignal;
  size?: string;
}

interface RunSharedGenerateImageCoreOptions {
  generateImage: (request: SharedGenerateImageRequest) => Promise<ProductImageResult>;
  imagePath: string;
  mode: "edit" | "generate";
  prompt: string;
  referenceImagePaths?: string[];
  selectedOutputSize?: string;
  sessionId: string;
  signal?: AbortSignal;
  toolRequestedSize?: string;
}

export async function runSharedGenerateImageCore(options: RunSharedGenerateImageCoreOptions): Promise<ProductImageResult> {
  const selectedOutputSize = normalizeGenerationSizeValue(options.selectedOutputSize);
  const toolRequestedSize = normalizeGenerationSizeValue(options.toolRequestedSize);
  const size = selectedOutputSize ?? toolRequestedSize;
  const referenceImagePaths = options.referenceImagePaths?.filter(Boolean) ?? [];

  return await options.generateImage({
    imagePath: options.imagePath,
    mode: options.mode,
    prompt: options.prompt,
    ...(referenceImagePaths.length ? { referenceImagePaths } : {}),
    sessionId: options.sessionId,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(size ? { size } : {})
  });
}
