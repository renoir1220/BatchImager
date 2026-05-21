import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deriveGenerationSize, prepareImageForEditApi, type PreparedEditImage } from "./imageEditInput";
import type { AppLogger } from "./appLogger";

export interface ProductImageInput {
  imagePath: string;
  prompt: string;
  referenceImagePaths?: string[];
  sessionId: string;
  size?: string;
}

export interface TuziImageApiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  outputDirectory: string;
  size: string;
}

export interface ProductImageResult {
  inputImage: PreparedEditImage;
  outputPath: string;
  referenceImages?: PreparedEditImage[];
  requestSize: string;
  remoteUrl?: string;
}

interface GeneratedImagePayload {
  base64Json?: string;
  url?: string;
}

interface TuziImageApiDeps {
  fetch: typeof fetch;
  makeNow: () => Date;
  mkdir: typeof mkdir;
  prepareImage: typeof prepareImageForEditApi;
  readFile: typeof readFile;
  writeFile: typeof writeFile;
}

const defaultDeps: TuziImageApiDeps = {
  fetch,
  makeNow: () => new Date(),
  mkdir,
  prepareImage: prepareImageForEditApi,
  readFile,
  writeFile
};

export function buildImageEditEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1/images/edits`;
}

export function parseTuziImageEditResponse(payload: unknown): GeneratedImagePayload {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("Invalid image generation response");
  }

  const firstImage = payload.data.find(isRecord);
  const url = typeof firstImage?.url === "string" ? firstImage.url : undefined;
  const base64Json = typeof firstImage?.b64_json === "string" ? firstImage.b64_json : undefined;

  if (!url && !base64Json) {
    throw new Error("No generated image returned by image API");
  }

  return { base64Json, url };
}

export async function generateProductImage(
  input: ProductImageInput,
  config: TuziImageApiConfig,
  deps: TuziImageApiDeps = defaultDeps,
  logger?: AppLogger
): Promise<ProductImageResult> {
  const prompt = input.prompt.trim();
  const context = `image:${input.sessionId}`;

  if (!prompt) {
    throw new Error("Prompt is required");
  }

  logger?.info("Image generation started", {
    context,
    data: {
      imagePath: input.imagePath,
      requestedSize: input.size ?? config.size
    },
    publicMessage: "开始准备图片..."
  });

  logger?.debug("Preparing image edit input", {
    context,
    data: { imagePath: input.imagePath, referenceImageCount: input.referenceImagePaths?.length ?? 0 }
  });
  const preparedImage = await deps.prepareImage(input.imagePath, {
    outputDirectory: path.join(config.outputDirectory, "prepared"),
    sessionId: input.sessionId
  });
  const preparedReferenceImages: PreparedEditImage[] = [];

  for (const [index, referenceImagePath] of (input.referenceImagePaths ?? []).entries()) {
    preparedReferenceImages.push(
      await deps.prepareImage(referenceImagePath, {
        outputDirectory: path.join(config.outputDirectory, "prepared"),
        sessionId: `${input.sessionId}-ref-${index + 1}`
      })
    );
  }

  const requestSize = deriveGenerationSize(input.size ?? config.size, preparedImage);
  logger?.info("Image edit input prepared", {
    context,
    data: {
      byteLength: preparedImage.byteLength,
      converted: preparedImage.converted,
      height: preparedImage.height,
      originalHeight: preparedImage.originalHeight,
      originalWidth: preparedImage.originalWidth,
      referenceImageCount: preparedReferenceImages.length,
      requestSize,
      resized: preparedImage.resized,
      width: preparedImage.width
    },
    publicMessage: `图片已准备：${preparedImage.width}x${preparedImage.height}，开始请求生成...`
  });

  const requestBody = new FormData();
  const preparedInputs = [preparedImage, ...preparedReferenceImages];

  requestBody.set("model", config.model);
  requestBody.set("prompt", prompt);
  for (const preparedInput of preparedInputs) {
    const sourceImage = await deps.readFile(preparedInput.imagePath);
    const sourceBlob = new Blob([sourceImage], { type: "image/png" });
    requestBody.append("image", sourceBlob, path.basename(preparedInput.imagePath));
  }
  requestBody.set("size", requestSize);
  requestBody.set("n", "1");
  requestBody.set("response_format", "url");

  logger?.info("Sending image edit request", {
    context,
    data: {
      endpoint: buildImageEditEndpoint(config.baseUrl),
      model: config.model,
      referenceImageCount: preparedReferenceImages.length,
      requestSize
    },
    publicMessage: "已发送生成请求，等待模型返回..."
  });
  const response = await deps.fetch(buildImageEditEndpoint(config.baseUrl), {
    body: requestBody,
    headers: {
      Authorization: `Bearer ${config.apiKey}`
    },
    method: "POST"
  });

  if (!response.ok) {
    const responseText = await response.text();
    logger?.error("Image edit request failed", {
      context,
      data: { responseText, status: response.status },
      publicMessage: `生成失败：接口返回 ${response.status}`
    });
    throw new Error(`Image generation failed: ${response.status} ${responseText}`);
  }

  logger?.info("Image edit response received", {
    context,
    data: { status: response.status },
    publicMessage: "模型已返回，正在下载结果图片..."
  });
  const generated = parseTuziImageEditResponse(await response.json());
  const imageBytes = generated.base64Json
    ? Buffer.from(generated.base64Json, "base64")
    : await downloadGeneratedImage(generated.url, deps.fetch, logger, context);

  await deps.mkdir(config.outputDirectory, { recursive: true });

  const outputPath = path.join(config.outputDirectory, `${toSafeName(input.sessionId)}-${toTimestamp(deps.makeNow())}.png`);
  await deps.writeFile(outputPath, imageBytes);
  logger?.info("Generated image stored", {
    context,
    data: {
      byteLength: imageBytes.byteLength,
      outputPath,
      remoteUrl: generated.url
    },
    publicMessage: "生成完成，已更新图片。"
  });

  return {
    inputImage: preparedImage,
    outputPath,
    referenceImages: preparedReferenceImages,
    requestSize,
    remoteUrl: generated.url
  };
}

async function downloadGeneratedImage(
  url: string | undefined,
  fetchImpl: typeof fetch,
  logger: AppLogger | undefined,
  context: string
): Promise<Buffer> {
  if (!url) {
    throw new Error("Generated image url is missing");
  }

  logger?.debug("Downloading generated image", { context, data: { url } });
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`Generated image download failed: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toSafeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
}

function toTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
