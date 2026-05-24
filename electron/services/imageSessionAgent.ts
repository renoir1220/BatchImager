import { normalizeGenerationSizeValue } from "../generationSizes";
import type { TuziLlmApiConfig } from "./localConfig";
import type { AppLogger } from "./appLogger";
import { createBatchImagerCommandPolicy } from "./agentCommandPolicy";
import { createRunProjectCommandTool } from "./batchImagerAgentTools";
import type { AgentRuntime, CreateAgentRuntimeOptions } from "./agentRuntime";
import { createAgentRuntime, warmupAgentRuntime } from "./agentRuntime";
import { type AgentRuntimeRegistry, getSharedAgentRuntimeRegistry } from "./agentRuntimeRegistry";
import type { ProductImageResult } from "./tuziImageApi";
import {
  MISSING_REFERENCE_IMAGE_REPLY,
  shouldReportMissingReferenceImage
} from "./referenceAttachmentGuard";
import { isPathInsideOrSame, normalizePathForComparison, resolvePathForComparison } from "./pathUtils";
import { runSharedGenerateImageCore } from "./sharedGenerateImageCore";

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
  mode: "edit" | "generate";
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
  registry?: AgentRuntimeRegistry;
  signal?: AbortSignal;
}

// 工具调用是异步发生的，工具实例由首轮 factory 创建并被 SDK 内部持有。
// 后续轮如果直接 closure capture 当轮 input/deps，工具看到的会是首轮的旧值。
// 用模块级 TurnState Map + key 绑定让工具在 execute 时实时读最新一轮的状态。
interface TurnState {
  generateImage: (request: ImageToolRequest) => Promise<ProductImageResult>;
  imagePath: string;
  referenceImages: ReferenceImageCandidate[];
  selectedOutputSize: string | undefined;
  sessionId: string;
  signal?: AbortSignal;
}

const turnStateByKey = new Map<string, TurnState>();

export async function runImageSessionAgent(
  input: ImageToolChatInput,
  config: TuziLlmApiConfig,
  projectDirectory: string,
  deps: ImageSessionAgentDeps
): Promise<ImageToolChatResult> {
  const context = `chat:${input.sessionId}`;
  const registryKey = buildRegistryKey(projectDirectory, input.sessionId);
  const selectedOutputSize = normalizeGenerationSizeValue(input.outputSize);
  const referenceImages = getReferenceImageCandidates(input);
  let generatedImage: ProductImageResult | undefined;

  if (
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

  assertPathInsideProject(input.imagePath, projectDirectory, "当前图片路径");
  for (const referenceImage of referenceImages) {
    assertPathInsideProject(referenceImage.filePath, projectDirectory, `参考图 ${referenceImage.id}`);
  }

  deps.logger?.info("Image session agent request started", {
    context,
    data: {
      messageCount: input.messages.length,
      model: config.model,
      projectDirectory,
      referenceImageCount: referenceImages.length
    },
    publicMessage: "图片会话智能体已启动，正在理解任务..."
  });

  // 首轮（含用户清空 / 刚切到此会话）强制丢弃旧 runtime，开新对话。
  const userMessageCount = countUserMessages(input.messages);
  const registry = deps.registry ?? getSharedAgentRuntimeRegistry();
  if (userMessageCount <= 1) {
    registry.invalidate(registryKey);
  }

  // 当轮状态写入 turnState，工具在 execute 时通过 key 读到。
  turnStateByKey.set(registryKey, {
    generateImage: async (request) => {
      throwIfAborted(deps.signal);
      generatedImage = await deps.generateImage(request);
      throwIfAborted(deps.signal);
      return generatedImage;
    },
    imagePath: input.imagePath,
    referenceImages,
    selectedOutputSize,
    sessionId: input.sessionId,
    ...(deps.signal ? { signal: deps.signal } : {})
  });

  return await registry.use(
    {
      key: registryKey,
      factory: async () => {
        const typebox = await loadTypebox();
        const generateImageTool = createGenerateImageTool({ registryKey, typebox });
        const commandTool = createRunProjectCommandTool({
          commandPolicy: createBatchImagerCommandPolicy({ projectDirectory }),
          projectDirectory
        });
        return await (deps.createRuntime ?? createAgentRuntime)({
          customToolDefinitions: [generateImageTool, commandTool],
          llmConfig: config,
          model: config.model,
          projectDirectory,
          sessionId: input.sessionId
        });
      },
      onCreate: (runtime) => {
        runtime.subscribe((event) => logPiEvent(event, context, deps.logger));
        deps.logger?.info("Image session agent runtime ready", {
          context,
          data: {
            builtInTools: runtime.descriptor.builtInTools,
            customTools: runtime.descriptor.customTools
          },
          publicMessage: "图片会话工具已就绪。"
        });
      }
    },
    async ({ runtime, isFreshRuntime }) => {
      const promptText = isFreshRuntime
        ? buildFullPrompt(input, referenceImages, selectedOutputSize)
        : buildTurnPrompt(input, referenceImages, selectedOutputSize);

      await promptWithAbort(runtime, promptText, deps.signal);

      const content = runtime.getLastAssistantText()?.trim();
      if (!content) {
        throw new Error("Pi 会话未返回文本回复");
      }

      deps.logger?.info("Image session agent completed", {
        context,
        data: { generated: Boolean(generatedImage), reused: !isFreshRuntime },
        publicMessage: generatedImage ? "图片会话已完成，图片已更新。" : "图片会话已完成。"
      });

      return {
        content,
        ...(generatedImage ? { generatedImage } : {})
      };
    }
  );
}

export async function warmupImageSessionAgentDependencies(): Promise<void> {
  await Promise.all([warmupAgentRuntime(), loadTypebox()]);
}

function buildRegistryKey(projectDirectory: string, sessionId: string): string {
  return `image-session:${normalizePathForComparison(projectDirectory)}:${sessionId}`;
}

function countUserMessages(messages: VisibleChatMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if (message.role === "user") {
      count += 1;
    }
  }
  return count;
}

async function promptWithAbort(runtime: AgentRuntime, promptText: string, signal: AbortSignal | undefined): Promise<void> {
  if (!signal) {
    await runtime.prompt(promptText);
    return;
  }

  throwIfAborted(signal);
  const handleAbort = () => {
    void runtime.abort();
  };
  signal.addEventListener("abort", handleAbort, { once: true });

  try {
    await runtime.prompt(promptText);
    throwIfAborted(signal);
  } finally {
    signal.removeEventListener("abort", handleAbort);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("操作已停止");
  }
}

function createGenerateImageTool(options: {
  registryKey: string;
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
      "Always choose mode explicitly: use edit when the current image should be preserved or transformed; use generate only when creating a new image from scratch.",
      "Only pass size when the user selected or explicitly requested a size, orientation, 2K, 4K, or aspect ratio.",
      "Pass referenceImageIds only for the reference images the user clearly points to or truly needs; omit or pass [] when no reference image should be sent."
    ],
    parameters: Type.Object(
      {
        mode: Type.String({
          description: "Use 'edit' to modify or preserve the current image. Use 'generate' to create a new image from scratch."
        }),
        prompt: Type.String({ description: "Detailed prompt for the image generation model." }),
        referenceImageIds: Type.Optional(
          Type.Array(Type.String({ description: "Reference image id from the provided reference index." }))
        ),
        size: Type.Optional(Type.String({ description: "Optional output size in WIDTHxHEIGHT." }))
      },
      { additionalProperties: false }
    ),
    async execute(
      _toolCallId: string,
      params: { mode: string; prompt: string; referenceImageIds?: string[]; size?: string },
      signal?: AbortSignal
    ) {
      const state = turnStateByKey.get(options.registryKey);
      if (!state) {
        return {
          content: [{ type: "text", text: "图片会话当前轮的上下文不可用，请重试。" }],
          isError: true
        };
      }

      const prompt = params.prompt.trim();
      if (!prompt) {
        return {
          content: [{ type: "text", text: "generate_image requires a non-empty prompt." }],
          isError: true
        };
      }

      throwIfAborted(signal);
      throwIfAborted(state.signal);
      const mode = normalizeImageToolMode(params.mode);
      if (!mode) {
        return {
          content: [{ type: "text", text: "generate_image mode must be either 'edit' or 'generate'." }],
          isError: true
        };
      }

      await runSharedGenerateImageCore({
        generateImage: state.generateImage,
        imagePath: state.imagePath,
        mode,
        prompt,
        referenceImagePaths: selectReferenceImagePaths(params.referenceImageIds, state.referenceImages),
        sessionId: state.sessionId,
        ...(state.signal ? { signal: state.signal } : {}),
        selectedOutputSize: state.selectedOutputSize,
        toolRequestedSize: params.size
      });
      throwIfAborted(signal);
      throwIfAborted(state.signal);

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

// 首轮 prompt：角色定位 + 硬性规则 + 全部上下文 + 全部历史 + 本轮 user。
// 这是 SDK 看到的第一个 user message，会和后续轮一起留在 KV cache 里，
// 所以把"规则"塞进这里足以让模型在后续轮也记得。
function buildFullPrompt(
  input: ImageToolChatInput,
  referenceImages: ReferenceImageCandidate[],
  selectedOutputSize: string | undefined
): string {
  const latestUserMessage = getLatestUserMessage(input);
  const history = input.messages
    .slice(0, -1)
    .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`)
    .join("\n");

  const sections: string[] = [
    "你是 BatchImager 的右侧图片会话智能体，负责按用户要求生成或修改单张商品图。",
    "硬性规则：",
    "1) 需要生成或修改图片时必须调用 generate_image，不要假装已经生成。",
    "2) 不要在回复中展示本地路径、远端 URL 或下载链接。",
    "3) 不要展示隐藏推理链，只展示用户能理解的计划、进度和结果。",
    "4) 调用 generate_image 时必须显式选择 mode：保留/改造当前图用 edit；从零创建新图才用 generate。",
    "5) 当前图片会自动作为 edit 模式的 imagePath 输入，用户不需要重新上传。",
    "6) 回复要自然：先简短说明你准备做什么；工具完成后总结结果；若只是讨论或澄清，不要强行生成。",
    "7) 后续每轮我会在 [环境更新] 段告诉你最新的图片路径 / 选中分辨率 / 参考图索引；以最新一轮为准。",
    "上下文：",
    `- 当前图片路径：${input.imagePath}`
  ];

  if (input.context?.fileName) {
    sections.push(`- 初始图片文件名：${input.context.fileName}`);
  }
  if (input.context?.currentImageLabel) {
    sections.push(`- 当前编辑输入：${input.context.currentImageLabel}`);
  }
  if (input.generationMode === "generate") {
    sections.push("- 本轮可能是新图占位任务：如果用户是在创建全新图片，调用 generate_image 时使用 mode:\"generate\"。");
  } else if (input.generationMode === "edit") {
    sections.push("- 本轮明确是编辑任务：调用 generate_image 时优先使用 mode:\"edit\"。");
  }
  if (input.context?.previousGenerationPrompt) {
    sections.push(`- 最近一次批量处理任务：${input.context.previousGenerationPrompt}`);
  }
  if (selectedOutputSize) {
    sections.push(`- 本次用户已选择输出分辨率：${selectedOutputSize}；调用 generate_image 时必须使用这个 size。`);
  }

  if (referenceImages.length) {
    sections.push("可引用参考图索引：");
    for (const referenceImage of referenceImages) {
      sections.push(`- ${referenceImage.id}：${referenceImage.label}${referenceImage.pinned ? "（已固定）" : ""}`);
    }
  }

  if (history) {
    sections.push("可见会话历史：", history);
  }

  sections.push("用户本轮要求：", latestUserMessage);

  return sections.join("\n");
}

// 增量 prompt：只发本轮环境 + 当前用户输入；不重发角色、规则、历史。
// SDK 内部 messages 已含上一轮的 system 段（首轮的完整 prompt）与 assistant 回复。
function buildTurnPrompt(
  input: ImageToolChatInput,
  referenceImages: ReferenceImageCandidate[],
  selectedOutputSize: string | undefined
): string {
  const latestUserMessage = getLatestUserMessage(input);
  const sections: string[] = [
    "[环境更新]",
    `- 当前图片路径：${input.imagePath}`
  ];

  if (input.context?.currentImageLabel) {
    sections.push(`- 当前编辑输入：${input.context.currentImageLabel}`);
  }
  if (input.generationMode === "generate") {
    sections.push("- 本轮可能是新图占位任务：如果用户是在创建全新图片，调用 generate_image 时使用 mode:\"generate\"。");
  } else if (input.generationMode === "edit") {
    sections.push("- 本轮明确是编辑任务：调用 generate_image 时优先使用 mode:\"edit\"。");
  }
  if (selectedOutputSize) {
    sections.push(`- 本次用户已选择输出分辨率：${selectedOutputSize}；调用 generate_image 时必须使用这个 size。`);
  } else {
    sections.push("- 用户当前没有选定输出分辨率。");
  }

  if (referenceImages.length) {
    sections.push("- 可引用参考图索引（覆盖此前）：");
    for (const referenceImage of referenceImages) {
      sections.push(`  - ${referenceImage.id}：${referenceImage.label}${referenceImage.pinned ? "（已固定）" : ""}`);
    }
  } else {
    sections.push("- 本轮没有可引用的参考图。");
  }

  sections.push("[用户本轮要求]", latestUserMessage);

  return sections.join("\n");
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
    return [];
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

function normalizeImageToolMode(value: unknown): "edit" | "generate" | undefined {
  return value === "edit" || value === "generate" ? value : undefined;
}

function getLatestUserMessage(input: ImageToolChatInput): string {
  return (
    [...input.messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content.trim() ?? ""
  );
}

function assertPathInsideProject(targetPath: string, projectDirectory: string, label: string): void {
  if (!targetPath) {
    throw new Error(`${label}为空。`);
  }

  if (!isPathInsideOrSame(resolvePathForComparison(targetPath), resolvePathForComparison(projectDirectory))) {
    throw new Error(`${label}指向项目目录之外：${targetPath}`);
  }
}

function logPiEvent(event: unknown, context: string, logger: AppLogger | undefined): void {
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

const SENSITIVE_KEY_PATTERN = /key|token|authorization|secret|password/i;
// 通用 token/sk-/bearer 等敏感串；超过 32 字符的高熵串也按敏感处理。
// TODO: 这套黑名单一定会漏（ghp_xxx / xoxb- / AKIA… 等格式）。更稳的方向是把事件日志
// 切到白名单：只保留 event.type、tool name、exitCode、durationMs 等显式安全字段。
// 没立刻做是因为：完整事件字段对调试 pi 行为很关键，先观察实际泄漏案例再收紧。
const SENSITIVE_VALUE_PATTERN = /(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._-]+|[A-Fa-f0-9]{32,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i;

function sanitizePiEvent(event: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(event)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = "[redacted]";
      continue;
    }

    if (typeof value === "string") {
      result[key] = SENSITIVE_VALUE_PATTERN.test(value) ? "[redacted]" : truncateForLog(value);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      result[key] = value;
    } else {
      result[key] = typeof value;
    }
  }

  return result;
}

function truncateForLog(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}…` : value;
}

function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return filePath.slice(lastSlash + 1);
}
