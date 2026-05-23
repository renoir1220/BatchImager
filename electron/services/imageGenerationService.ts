import type { AppLogger } from "./appLogger";
import {
  generateImageFromPrompt,
  generateProductImage,
  type ProductImageInput,
  type ProductImageResult,
  type PromptImageInput,
  type TuziImageApiConfig
} from "./tuziImageApi";

export type UnifiedImageGenerationRequest =
  | ({ mode: "edit" } & ProductImageInput)
  | ({ mode: "generate" } & ProductImageInput);

interface ImageGenerationExecutorDeps {
  editImage?: (request: ProductImageInput) => Promise<ProductImageResult>;
  generateImage?: (request: PromptImageInput) => Promise<ProductImageResult>;
  logger?: AppLogger;
}

export type ImageGenerationExecutor = (request: UnifiedImageGenerationRequest) => Promise<ProductImageResult>;

export function createImageGenerationExecutor(
  config: TuziImageApiConfig,
  deps: ImageGenerationExecutorDeps = {}
): ImageGenerationExecutor {
  const editImage = deps.editImage ?? ((request) => generateProductImage(request, config, undefined, deps.logger));
  const generateImage = deps.generateImage ?? ((request) => generateImageFromPrompt(request, config, undefined, deps.logger));

  return (request) => {
    if (request.mode === "generate") {
      const { imagePath: _imagePath, mode: _mode, referenceImagePaths, ...promptRequest } = request;

      if (!referenceImagePaths?.length) {
        return generateImage(promptRequest);
      }

      const [imagePath, ...additionalReferenceImagePaths] = referenceImagePaths;

      return editImage({
        imagePath,
        ...(promptRequest.onRemoteImage ? { onRemoteImage: promptRequest.onRemoteImage } : {}),
        prompt: promptRequest.prompt,
        ...(additionalReferenceImagePaths.length ? { referenceImagePaths: additionalReferenceImagePaths } : {}),
        sessionId: promptRequest.sessionId,
        ...(promptRequest.size ? { size: promptRequest.size } : {})
      });
    }

    const { mode: _mode, ...editRequest } = request;
    return editImage(editRequest);
  };
}
