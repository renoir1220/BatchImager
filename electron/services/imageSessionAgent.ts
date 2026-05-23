import { normalizeGenerationSizeValue } from "../generationSizes";
import type { TuziLlmApiConfig } from "./localConfig";
import type { AppLogger } from "./appLogger";
import { createBatchImagerCommandPolicy } from "./agentCommandPolicy";
import { createRunProjectCommandTool } from "./batchImagerAgentTools";
import type { AgentRuntime, CreateAgentRuntimeOptions } from "./agentRuntime";
import { createAgentRuntime, warmupAgentRuntime } from "./agentRuntime";
import type { ProductImageResult } from "./tuziImageApi";
import {
  MISSING_REFERENCE_IMAGE_REPLY,
  shouldReportMissingReferenceImage
} from "./referenceAttachmentGuard";

export type VisibleChatRole = "user" | "assistant";

export interface VisibleChatMessage {
  role: VisibleChatRole;
  content: string;
}

export interface ImageToolChatContext {
  currentImageLabel?: string;
  fileName?: string;
  originalImageLabel?: string;
  previousGenerationPrompt?: string;
  referenceImageCount?: number;
}

export interface ReferenceImageCandidate {
  filePath: string;
  id: string;
  label: string;
  pinned?: boolean;
}

export interface ImageToolChatInput {
  context?: ImageToolChatContext;
  generationMode?: "edit" | "generate";
  imagePath: string;
  messages: VisibleChatMessage[];
  outputSize?: string;
  referenceImages?: ReferenceImageCandidate[];
  referenceImagePaths?: string[];
  sessionId: string;
}

export interface ImageToolRequest {
  imagePath: string;
  prompt: string;
  referenceImagePaths?: string[];
  sessionId: string;
  size?: string;
}

export interface ImageToolChatResult {
  content: string;
  generatedImage?: ProductImageResult;
}

interface ImageSessionAgentDeps {
  createRuntime?: (options: CreateAgentRuntimeOptions) => Promise<AgentRuntime>;
  generateImage: (request: ImageToolRequest) => Promise<ProductImageResult>;
  logger?: AppLogger;
}

export async function runImageSessionAgent(
  input: ImageToolChatInput,
  config: TuziLlmApiConfig,
  projectDirectory: string,
  deps: ImageSessionAgentDeps
): Promise<ImageToolChatResult> {
  const context = `chat:${input.sessionId}`;
  const selectedOutputSize = normalizeGenerationSizeValue(input.outputSize);
  const expectsImageGeneration = shouldUseImageTool(input.messages, selectedOutputSize);
  const referenceImages = getReferenceImageCandidates(input);
  let generatedImage: ProductImageResult | undefined;

  if (
    expectsImageGeneration &&
    shouldReportMissingReferenceImage({
      messages: input.messages,
      referenceImageCount: referenceImages.length
    })
  ) {
    deps.logger?.warn("Image session agent request referenced a missing attachment", {
      context,
      publicMessage: "没有收到参考图附件，请先粘贴或添加参考图。"
    });
    throw new Error(MISSING_REFERENCE_IMAGE_REPLY);
  }

  deps.logger?.info("Image session agent request started", {
    context,
    data: {
      expectsImageGeneration,
      messageCount: input.messages.length,
      model: config.model,
      projectDirectory,
      referenceImageCount: referenceImages.length
    },
    publicMessage: "图片会话智能体已启动，正在理解任务..."
  });

  const generateImageTool = createGenerateImageTool({
    generateImage: async (request) => {
      generatedImage = await deps.generateImage(request);
      return generatedImage;
    },
    input,
    referenceImages,
    selectedOutputSize,
    typebox: await loadTypebox()
  });
  const commandTool = createRunProjectCommandTool({
    commandPolicy: createBatchImagerCommandPolicy({ projectDirectory }),
    projectDirectory
  });
  const runtime = await (deps.createRuntime ?? createAgentRuntime)({
    customToolDefinitions: [generateImageTool, commandTool],
    llmConfig: config,
    model: config.model,
    projectDirectory,
    sessionId: input.sessionId
  });

  deps.logger?.info("Image session agent runtime ready", {
    context,
    data: {
      builtInTools: runtime.descriptor.builtInTools,
      customTools: runtime.descriptor.customTools
    },
    publicMessage: "图片会话工具已就绪。"
  });

  try {
    runtime.subscribe((event) => logAgentEvent(event, context, deps.logger));
    await runtime.prompt(buildAgentPrompt(input, referenceImages, selectedOutputSize));

    const content = runtime.getLastAssistantText()?.trim();
    if (!content) {
      throw new Error("Pi 会话未返回文本回复");
    }

    if (expectsImageGeneration && !generatedImage) {
      deps.logger?.error("Image session agent answered without image tool for a generation request", {
        context,
        data: { content },
        publicMessage: "图片会话智能体未返回图片生成工具调用。"
      });
      throw new Error("Pi 未返回图片生成工具调用");
    }

    deps.logger?.info("Image session agent completed", {
      context,
      data: { generated: Boolean(generatedImage) },
      publicMessage: generatedImage ? "图片会话已完成，图片已更新。" : "图片会话已完成。"
    });

    return {
      content,
      generatedImage
    };
  } finally {
    runtime.dispose();
  }
}

export async function warmupImageSessionAgentDependencies(): Promise<void> {
  await Promise.all([warmupAgentRuntime(), loadTypebox()]);
}

function createGenerateImageTool(options: {
  generateImage: (request: ImageToolRequest) => Promise<ProductImageResult>;
  input: ImageToolChatInput;
  referenceImages: ReferenceImageCandidate[];
  selectedOutputSize: string | undefined;
  typebox: TypeboxApi;
}): Record<string, unknown> {
  const Type = options.typebox.Type;

  return {
    name: "generate_image",
    label: "生成图片",
    description: "Generate or edit the selected BatchImager product image using the existing image generation pipeline.",
    promptSnippet: "Generate or edit the selected product image",
    promptGuidelines: [
      "When the user asks to create, regenerate, edit, restyle, remove background, or make a product image, call generate_image.",
      "Only pass size when the user selected or explicitly requested a size, orientation, 2K, 4K, or aspect ratio.",
      "Use referenceImageIds only for the reference images the user clearly points to or truly needs."
    ],
    parameters: Type.Object(
      {
        prompt: Type.String({ description: "Detailed prompt for the image generation model." }),
        referenceImageIds: Type.Optional(
          Type.Array(Type.String({ description: "Reference image id from the provided reference index." }))
        ),
        size: Type.Optional(Type.String({ description: "Optional output size in WIDTHxHEIGHT." }))
      },
      { additionalProperties: false }
    ),
    async execute(_toolCallId: string, params: { prompt: string; referenceImageIds?: string[]; size?: string }) {
      const prompt = params.prompt.trim();
      if (!prompt) {
        return {
          content: [{ type: "text", text: "generate_image requires a non-empty prompt." }],
          isError: true
        };
      }

      const referenceImagePaths = selectReferenceImagePaths(params.referenceImageIds, options.referenceImages);
      const toolOutputSize = typeof params.size === "string" ? normalizeGenerationSizeValue(params.size) : undefined;
      const generated = await options.generateImage({
        imagePath: options.input.imagePath,
        prompt,
        ...(referenceImagePaths.length ? { referenceImagePaths } : {}),
        sessionId: options.input.sessionId,
        ...(options.selectedOutputSize ?? toolOutputSize ? { size: options.selectedOutputSize ?? toolOutputSize } : {})
      });

      return {
        content: [
          {
            type: "text",
            text: "图片生成完成，已更新当前图片。"
          }
        ]
      };
    }
  };
}

interface TypeboxApi {
  Type: {
    Array: (items: unknown, options?: Record<string, unknown>) => unknown;
    Object: (properties: Record<string, unknown>, options?: Record<string, unknown>) => unknown;
    Optional: (schema: unknown) => unknown;
    String: (options?: Record<string, unknown>) => unknown;
  };
}

async function loadTypebox(): Promise<TypeboxApi> {
  return (await import("typebox")) as TypeboxApi;
}

function buildAgentPrompt(
  input: ImageToolChatInput,
  referenceImages: ReferenceImageCandidate[],
  selectedOutputSize: string | undefined
): string {
  const latestUserMessage = getLatestUserMessage(input);
  const history = input.messages
    .slice(0, -1)
    .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`)
    .join("\n");
  const contextLines = [
    "你是 BatchImager 的右侧图片会话智能体。",
    "需要生成或修改图片时，必须调用 generate_image；不要假装已经生成图片。",
    "当前图片会自动作为 generate_image 的 imagePath 输入，用户不需要重新上传。",
    "回复要自然：先简短说明你准备做什么；工具完成后，总结结果。",
    "图片生成完成后，不要在回复中展示本地路径、远端 URL 或下载链接。",
    "不要展示隐藏推理链，只展示用户能理解的计划、进度和结果。",
    `当前图片路径：${input.imagePath}`,
    ...(input.context?.fileName ? [`初始图片文件名：${input.context.fileName}`] : []),
    ...(input.context?.currentImageLabel ? [`当前编辑输入：${input.context.currentImageLabel}`] : []),
    ...(input.context?.previousGenerationPrompt ? [`最近一次批量处理任务：${input.context.previousGenerationPrompt}`] : []),
    ...(selectedOutputSize ? [`本次用户已选择输出分辨率：${selectedOutputSize}；调用 generate_image 时必须使用这个 size。`] : []),
    ...(referenceImages.length
      ? [
          "可引用参考图索引：",
          ...referenceImages.map((referenceImage) =>
            `- ${referenceImage.id}：${referenceImage.label}${referenceImage.pinned ? "（已固定）" : ""}`
          )
        ]
      : []),
    ...(history ? ["可见会话历史：", history] : []),
    "用户本轮要求：",
    latestUserMessage
  ];

  return contextLines.join("\n");
}

function getReferenceImageCandidates(input: ImageToolChatInput): ReferenceImageCandidate[] {
  const candidates: ReferenceImageCandidate[] = input.referenceImages?.length
    ? input.referenceImages
    : (input.referenceImagePaths ?? []).map((filePath, index) => ({
        filePath,
        id: `ref-${index + 1}`,
        label: `参考图 ${index + 1}：${getFileName(filePath)}`
      }));
  const seenIds = new Set<string>();

  return candidates
    .map((candidate) => ({
      filePath: candidate.filePath.trim(),
      id: candidate.id.trim(),
      label: candidate.label.trim(),
      ...(candidate.pinned ? { pinned: true } : {})
    }))
    .filter((candidate) => {
      if (!candidate.filePath || !candidate.id || !candidate.label || seenIds.has(candidate.id)) {
        return false;
      }

      seenIds.add(candidate.id);
      return true;
    });
}

function selectReferenceImagePaths(value: unknown, referenceImages: ReferenceImageCandidate[]): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return referenceImages.map((referenceImage) => referenceImage.filePath);
  }

  const byId = new Map(referenceImages.map((referenceImage) => [referenceImage.id, referenceImage.filePath]));
  const selected = new Set<string>();

  for (const id of value) {
    if (typeof id !== "string") {
      continue;
    }

    const filePath = byId.get(id);

    if (filePath) {
      selected.add(filePath);
    }
  }

  return [...selected];
}

function getLatestUserMessage(input: ImageToolChatInput): string {
  return (
    [...input.messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content.trim() ?? ""
  );
}

function shouldUseImageTool(messages: VisibleChatMessage[], selectedOutputSize: string | undefined): boolean {
  return Boolean(selectedOutputSize) || shouldFallbackToImageGeneration(messages);
}

function shouldFallbackToImageGeneration(messages: VisibleChatMessage[]): boolean {
  const latestUserMessage = getLatestUserMessage({ imagePath: "", messages, sessionId: "" }).toLowerCase();

  if (!latestUserMessage) {
    return false;
  }

  return [
    "生成",
    "重新生成",
    "再生成",
    "做成",
    "改成",
    "换成",
    "处理",
    "修图",
    "商品图",
    "白底",
    "去背景",
    "generate",
    "regenerate",
    "make ",
    "turn ",
    "create "
  ].some((keyword) => latestUserMessage.includes(keyword));
}

function logAgentEvent(event: unknown, context: string, logger: AppLogger | undefined): void {
  if (!logger || typeof event !== "object" || event === null || !("type" in event) || typeof event.type !== "string") {
    return;
  }

  if (event.type === "tool_execution_start") {
    logger.info("Pi tool execution started", {
      context,
      data: sanitizePiEvent(event),
      publicMessage: "Pi 正在执行工具..."
    });
  } else if (event.type === "tool_execution_end") {
    logger.info("Pi tool execution ended", {
      context,
      data: sanitizePiEvent(event),
      publicMessage: "Pi 工具执行完成。"
    });
  } else if (event.type === "message_update") {
    logger.debug("Pi message update", {
      context,
      data: sanitizePiEvent(event)
    });
  }
}

function sanitizePiEvent(event: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(event)
      .filter(([key]) => !/key|token|authorization|secret/i.test(key))
      .map(([key, value]) => [key, typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : typeof value])
  );
}

function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return filePath.slice(lastSlash + 1);
}
