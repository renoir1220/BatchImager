import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deriveGenerationSize, prepareImageForEditApi, type PreparedEditImage } from "./imageEditInput";
import type { AppLogger } from "./appLogger";

export interface ProductImageInput {
  imagePath: string;
  onRemoteImage?: (event: RemoteImageEvent) => Promise<void> | void;
  prompt: string;
  referenceImagePaths?: string[];
  sessionId: string;
  signal?: AbortSignal;
  size?: string;
}

export interface PromptImageInput {
  onRemoteImage?: (event: RemoteImageEvent) => Promise<void> | void;
  prompt: string;
  sessionId: string;
  signal?: AbortSignal;
  size?: string;
}

export interface RemoteImageEvent {
  remoteUrl?: string;
  requestSize: string;
  sessionId: string;
}

export interface TuziImageApiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  outputDirectory: string;
  size: string;
}

export interface ProductImageResult {
  inputImage?: PreparedEditImage;
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
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  writeFile: typeof writeFile;
}

const defaultDeps: TuziImageApiDeps = {
  fetch,
  makeNow: () => new Date(),
  mkdir,
  prepareImage: prepareImageForEditApi,
  readFile,
  sleep: sleepMs,
  writeFile
};

const IMAGE_API_MAX_RETRIES = 3;
const IMAGE_API_RETRY_DELAYS_MS = [500, 1000, 2000] as const;

export function buildImageEditEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1/images/edits`;
}

export function buildImageGenerationEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1/images/generations`;
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

export async function generateImageFromPrompt(
  input: PromptImageInput,
  config: TuziImageApiConfig,
  deps: TuziImageApiDeps = defaultDeps,
  logger?: AppLogger
): Promise<ProductImageResult> {
  const prompt = input.prompt.trim();
  const context = `image:${input.sessionId}`;

  if (!prompt) {
    throw new Error("Prompt is required");
  }

  const requestSize = input.size ?? config.size;
  const endpoint = buildImageGenerationEndpoint(config.baseUrl);
  logger?.info("Image generation request started", {
    context,
    data: {
      endpoint,
      model: config.model,
      requestSize
    },
    publicMessage: "正在请求生成新图片..."
  });

  const payload: Record<string, string> = {
    model: config.model,
    prompt,
    response_format: "url",
    size: requestSize
  };
  if (shouldSendAutoQuality(config.model)) {
    payload.quality = "auto";
  }

  const response = await fetchImageApiWithRetries({
    context,
    endpoint,
    fetchImpl: deps.fetch,
    init: {
      body: JSON.stringify(payload),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      ...(input.signal ? { signal: input.signal } : {})
    },
    logLabel: "Image generation request",
    logger,
    model: config.model,
    requestSize,
    signal: input.signal,
    sleep: deps.sleep
  });

  logger?.info("Image generation response received", {
    context,
    data: { status: response.status },
    publicMessage: "模型已返回，正在下载结果图片..."
  });
  const generated = parseTuziImageEditResponse(await response.json());
  await input.onRemoteImage?.({
    remoteUrl: generated.url,
    requestSize,
    sessionId: input.sessionId
  });
  const imageBytes = generated.base64Json
    ? Buffer.from(generated.base64Json, "base64")
    : await downloadGeneratedImage(generated.url, deps.fetch, logger, context, input.signal);

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
    publicMessage: "生成完成，已添加图片。"
  });

  return {
    outputPath,
    requestSize,
    remoteUrl: generated.url
  };
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

  const endpoint = buildImageEditEndpoint(config.baseUrl);

  logger?.info("Sending image edit request", {
    context,
    data: {
      endpoint,
      model: config.model,
      referenceImageCount: preparedReferenceImages.length,
      requestSize
    },
    publicMessage: "已发送生成请求，等待模型返回..."
  });
  const response = await fetchImageApiWithRetries({
    context,
    endpoint,
    fetchImpl: deps.fetch,
    init: {
      body: requestBody,
      headers: {
        Authorization: `Bearer ${config.apiKey}`
      },
      method: "POST",
      ...(input.signal ? { signal: input.signal } : {})
    },
    logLabel: "Image edit request",
    logger,
    model: config.model,
    requestSize,
    signal: input.signal,
    sleep: deps.sleep
  });

  logger?.info("Image edit response received", {
    context,
    data: { status: response.status },
    publicMessage: "模型已返回，正在下载结果图片..."
  });
  const generated = parseTuziImageEditResponse(await response.json());
  await input.onRemoteImage?.({
    remoteUrl: generated.url,
    requestSize,
    sessionId: input.sessionId
  });
  const imageBytes = generated.base64Json
    ? Buffer.from(generated.base64Json, "base64")
    : await downloadGeneratedImage(generated.url, deps.fetch, logger, context, input.signal);

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
  context: string,
  signal?: AbortSignal
): Promise<Buffer> {
  if (!url) {
    throw new Error("Generated image url is missing");
  }

  logger?.debug("Downloading generated image", { context, data: { url } });
  const response = await fetchImpl(url, signal ? { signal } : undefined);

  if (!response.ok) {
    throw new Error(`Generated image download failed: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

interface FetchImageApiWithRetriesOptions {
  context: string;
  endpoint: string;
  fetchImpl: typeof fetch;
  init: RequestInit;
  logLabel: "Image edit request" | "Image generation request";
  logger?: AppLogger;
  model: string;
  requestSize: string;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

async function fetchImageApiWithRetries(options: FetchImageApiWithRetriesOptions): Promise<Response> {
  for (let attemptIndex = 0; attemptIndex <= IMAGE_API_MAX_RETRIES; attemptIndex += 1) {
    const attemptNumber = attemptIndex + 1;

    try {
      const response = await options.fetchImpl(options.endpoint, options.init);

      if (response.ok) {
        if (attemptIndex > 0) {
          options.logger?.info(`${options.logLabel} succeeded after retry`, {
            context: options.context,
            data: {
              attempt: attemptNumber,
              endpoint: options.endpoint,
              model: options.model,
              requestSize: options.requestSize,
              status: response.status
            }
          });
        }

        return response;
      }

      const responseText = await response.text();
      if (attemptIndex < IMAGE_API_MAX_RETRIES && isRetryableImageApiStatus(response.status)) {
        await retryImageApiRequest(options, {
          attemptNumber,
          publicMessage: `接口暂时不可用，正在重试 ${attemptNumber}/${IMAGE_API_MAX_RETRIES}...`,
          responseText,
          status: response.status
        });
        continue;
      }

      options.logger?.error(`${options.logLabel} failed`, {
        context: options.context,
        data: {
          attempt: attemptNumber,
          maxRetries: IMAGE_API_MAX_RETRIES,
          responseText,
          status: response.status
        },
        publicMessage: `生成失败：接口返回 ${response.status}`
      });
      throw new Error(`Image generation failed: ${response.status} ${responseText}`);
    } catch (error) {
      if (isInternalImageApiError(error)) {
        throw error;
      }

      if (attemptIndex < IMAGE_API_MAX_RETRIES && !isAbortError(error, options.signal)) {
        await retryImageApiRequest(options, {
          attemptNumber,
          error,
          publicMessage: `生成请求发送失败，正在重试 ${attemptNumber}/${IMAGE_API_MAX_RETRIES}...`
        });
        continue;
      }

      options.logger?.error(`${options.logLabel} network failed`, {
        context: options.context,
        data: {
          attempt: attemptNumber,
          endpoint: options.endpoint,
          maxRetries: IMAGE_API_MAX_RETRIES,
          model: options.model,
          requestSize: options.requestSize
        },
        error,
        publicMessage: `生成请求发送失败：${toNetworkErrorMessage(error)}`
      });
      throw new Error(`Image generation request failed: ${toNetworkErrorMessage(error)}`, { cause: error });
    }
  }

  throw new Error("Image API retry loop exited unexpectedly");
}

interface RetryImageApiRequestOptions {
  attemptNumber: number;
  error?: unknown;
  publicMessage: string;
  responseText?: string;
  status?: number;
}

async function retryImageApiRequest(
  options: FetchImageApiWithRetriesOptions,
  retryOptions: RetryImageApiRequestOptions
): Promise<void> {
  options.logger?.warn(`${options.logLabel} retry scheduled`, {
    context: options.context,
    data: {
      attempt: retryOptions.attemptNumber,
      endpoint: options.endpoint,
      maxRetries: IMAGE_API_MAX_RETRIES,
      model: options.model,
      nextAttempt: retryOptions.attemptNumber + 1,
      requestSize: options.requestSize,
      responseText: retryOptions.responseText,
      status: retryOptions.status
    },
    error: retryOptions.error,
    publicMessage: retryOptions.publicMessage
  });

  await (options.sleep ?? sleepMs)(IMAGE_API_RETRY_DELAYS_MS[retryOptions.attemptNumber - 1] ?? 2000, options.signal);
}

function isRetryableImageApiStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function shouldSendAutoQuality(model: string): boolean {
  return !/^AA-gpt-image-2-(?:low|medium|high)$/i.test(model.trim());
}

function isInternalImageApiError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Image generation failed:");
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === "AbortError");
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

function toNetworkErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = "cause" in error ? error.cause : undefined;
  if (cause instanceof Error && cause.message) {
    return `${error.message}（${cause.message}）`;
  }

  return error.message;
}

function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(createAbortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";

  return error;
}
