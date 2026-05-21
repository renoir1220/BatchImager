import type { ProductImageResult } from "./tuziImageApi";
import type { TuziLlmApiConfig } from "./localConfig";
import type { AppLogger } from "./appLogger";
import { GENERATION_SIZE_OPTIONS, normalizeGenerationSizeValue } from "../generationSizes";

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

interface OpenAiChatDeps {
  fetch: typeof fetch;
  generateImage: (request: ImageToolRequest) => Promise<ProductImageResult>;
  logger?: AppLogger;
}

interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

type ChatApiMessage =
  | { role: "system"; content: string }
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant"; content: string | null; tool_calls: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ChatToolChoice = "auto" | { type: "function"; function: { name: "generate_image" } };

export function buildChatCompletionsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
}

export async function runImageToolChat(
  input: ImageToolChatInput,
  config: TuziLlmApiConfig,
  deps: OpenAiChatDeps
): Promise<ImageToolChatResult> {
  const context = `chat:${input.sessionId}`;
  const selectedOutputSize = normalizeGenerationSizeValue(input.outputSize);
  const expectsImageGeneration = shouldUseImageTool(input.messages, selectedOutputSize);
  deps.logger?.info("Chat request started", {
    context,
    data: { expectsImageGeneration, messageCount: input.messages.length },
    publicMessage: expectsImageGeneration ? "会话已发送，正在组织图片生成工具参数..." : "会话已发送，模型正在分析..."
  });
  const referenceImages = getReferenceImageCandidates(input);
  const messages: ChatApiMessage[] = [
    {
      role: "system",
      content:
        "你是 BatchImager 的右侧图片会话助手。需要生成或修改图片时，调用 generate_image 工具；不要假装已经生成图片。除非用户明确要求方图、横图、竖图、2K、4K 或具体尺寸，否则不要传 size。当用户说“上一张、第二张、刚才那个、pin 的那张、那个风格”等指代表达时，根据可引用参考图索引判断具体图片，并只在 referenceImageIds 中填写本次生成真正需要的参考图 id；不要编造 id，不确定时先追问。"
    },
    ...buildContextMessages(input.context, referenceImages, selectedOutputSize),
    ...input.messages.map((message): ChatApiMessage => ({ role: message.role, content: message.content }))
  ];

  const firstMessage = await requestAssistantMessage(
    messages,
    config,
    deps.fetch,
    true,
    referenceImages,
    getInitialToolChoice(expectsImageGeneration)
  );
  deps.logger?.info("Chat first response received", {
    context,
    data: { hasToolCalls: Boolean(firstMessage.tool_calls?.length) },
    publicMessage: firstMessage.tool_calls?.length ? "模型决定调用图片生成工具..." : "模型已回复。"
  });

  if (!firstMessage.tool_calls?.length) {
    if (expectsImageGeneration) {
      deps.logger?.warn("Model answered without image tool for a generation request; falling back to local tool execution", {
        context,
        publicMessage: "模型未返回工具调用，已改为本地执行图片生成..."
      });
      const fallbackReferenceImagePaths = referenceImages.map((referenceImage) => referenceImage.filePath);
      const generatedImage = await deps.generateImage({
        imagePath: input.imagePath,
        prompt: getLatestUserMessage(input.messages),
        ...(fallbackReferenceImagePaths.length ? { referenceImagePaths: fallbackReferenceImagePaths } : {}),
        ...(selectedOutputSize ? { size: selectedOutputSize } : {}),
        sessionId: input.sessionId
      });

      return {
        content: "已根据你的要求生成新图片。",
        generatedImage
      };
    }

    return { content: getAssistantContent(firstMessage) };
  }

  const toolMessages: ChatApiMessage[] = [
    ...messages,
    {
      role: "assistant",
      content: firstMessage.content ?? null,
      tool_calls: firstMessage.tool_calls
    }
  ];
  let generatedImage: ProductImageResult | undefined;

  for (const toolCall of firstMessage.tool_calls) {
    deps.logger?.info("Executing image tool call", {
      context,
      data: {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name
      },
      publicMessage: "正在执行图片生成工具..."
    });
    generatedImage = await executeImageToolCall(toolCall, input, deps);
    toolMessages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        outputPath: generatedImage.outputPath,
        remoteUrl: generatedImage.remoteUrl
      })
    });
  }

  const finalMessage = await requestAssistantMessage(toolMessages, config, deps.fetch, false, referenceImages);
  deps.logger?.info("Chat final response received", {
    context,
    publicMessage: "会话回复完成。"
  });

  return {
    content: getAssistantContent(finalMessage),
    generatedImage
  };
}

function buildContextMessages(
  context: ImageToolChatContext | undefined,
  referenceImages: ReferenceImageCandidate[],
  selectedOutputSize: string | undefined
): ChatApiMessage[] {
  if (!context && referenceImages.length === 0 && !selectedOutputSize) {
    return [];
  }

  const fileName = context?.fileName?.trim();
  const originalImageLabel = context?.originalImageLabel?.trim();
  const currentImageLabel = context?.currentImageLabel?.trim();
  const previousGenerationPrompt = context?.previousGenerationPrompt?.trim();
  const referenceImageCount = Number.isInteger(context?.referenceImageCount) ? context?.referenceImageCount ?? 0 : 0;
  const lines = [
    "当前图片上下文：",
    ...(fileName ? [`- 初始图片文件名：${fileName}`] : []),
    ...(originalImageLabel ? [`- 初始图片：${originalImageLabel}`] : []),
    ...(currentImageLabel ? [`- 当前编辑输入：${currentImageLabel}`] : []),
    "- 当前图片已经由 BatchImager 选中，并会自动作为 generate_image 工具的输入；用户不需要重新上传或描述这张图片。",
    ...(previousGenerationPrompt ? [`- 最近一次批量处理任务：${previousGenerationPrompt}`] : []),
    ...(referenceImageCount > 0 ? [`- 最近一次批量处理包含 ${referenceImageCount} 张参考图。`] : []),
    ...(selectedOutputSize
      ? [`- 本次用户已选择输出分辨率：${selectedOutputSize}。调用 generate_image 时必须使用这个 size。`]
      : []),
    ...(referenceImages.length
      ? [
          "可引用参考图索引：",
          ...referenceImages.map((referenceImage) =>
            `- ${referenceImage.id}：${referenceImage.label}${referenceImage.pinned ? "（已固定）" : ""}`
          )
        ]
      : [])
  ];

  return [{ role: "system", content: lines.join("\n") }];
}

async function requestAssistantMessage(
  messages: ChatApiMessage[],
  config: TuziLlmApiConfig,
  fetchImpl: typeof fetch,
  includeTools: boolean,
  referenceImages: ReferenceImageCandidate[],
  toolChoice: ChatToolChoice = "auto"
): Promise<{ content?: string | null; tool_calls?: ToolCall[] }> {
  const response = await fetchImpl(buildChatCompletionsEndpoint(config.baseUrl), {
    body: JSON.stringify({
      model: config.model,
      messages,
      ...(includeTools
        ? {
            tool_choice: toolChoice,
            tools: [buildGenerateImageTool(referenceImages)]
          }
        : {})
    }),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`Chat completion failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();

  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new Error("Invalid chat completion response");
  }

  const firstChoice = payload.choices.find(isRecord);
  const message = isRecord(firstChoice?.message) ? firstChoice.message : undefined;

  if (!message) {
    throw new Error("Invalid chat completion response");
  }

  const content = typeof message.content === "string" || message.content === null ? message.content : undefined;
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.filter(isToolCall) : undefined;

  return { content, tool_calls: toolCalls };
}

async function executeImageToolCall(
  toolCall: ToolCall,
  input: ImageToolChatInput,
  deps: OpenAiChatDeps
): Promise<ProductImageResult> {
  if (toolCall.function.name !== "generate_image") {
    throw new Error(`Unsupported tool call: ${toolCall.function.name}`);
  }

  const args = parseToolArguments(toolCall.function.arguments);
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  const referenceImagePaths = selectReferenceImagePaths(args.referenceImageIds, getReferenceImageCandidates(input));
  const selectedOutputSize = normalizeGenerationSizeValue(input.outputSize);
  const toolOutputSize = typeof args.size === "string" ? normalizeGenerationSizeValue(args.size) : undefined;

  if (!prompt) {
    throw new Error("generate_image tool requires a prompt");
  }

  return deps.generateImage({
    imagePath: input.imagePath,
    prompt,
    ...(referenceImagePaths.length ? { referenceImagePaths } : {}),
    sessionId: input.sessionId,
    ...(selectedOutputSize ?? toolOutputSize ? { size: selectedOutputSize ?? toolOutputSize } : {})
  });
}

function buildGenerateImageTool(referenceImages: ReferenceImageCandidate[]): {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
} {
  return {
    type: "function",
    function: {
      name: "generate_image",
      description: "Generate or edit the selected local product image using a detailed image prompt.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Detailed prompt for the image generation model."
          },
          ...(referenceImages.length
            ? {
                referenceImageIds: {
                  type: "array",
                  description:
                    "Reference image ids from the provided index. Include only images the user's current request points to or truly needs.",
                  items: {
                    type: "string",
                    enum: referenceImages.map((referenceImage) => referenceImage.id)
                  }
                }
              }
            : {}),
          size: {
            type: "string",
            description: `Optional output size. Only set this when the user explicitly asks for a size or aspect ratio. Common values: ${GENERATION_SIZE_OPTIONS.map((option) => option.value).join(", ")}. Custom values must use WIDTHxHEIGHT.`
          }
        },
        required: ["prompt"],
        additionalProperties: false
      }
    }
  };
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
  if (!Array.isArray(value)) {
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

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);

    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // fall through to the shared error below
  }

  throw new Error("Invalid generate_image tool arguments");
}

function getAssistantContent(message: { content?: string | null }): string {
  if (typeof message.content === "string" && message.content.trim()) {
    return message.content;
  }

  throw new Error("Invalid chat completion response");
}

function getInitialToolChoice(expectsImageGeneration: boolean): ChatToolChoice {
  return expectsImageGeneration
    ? {
        type: "function",
        function: { name: "generate_image" }
      }
    : "auto";
}

function shouldUseImageTool(messages: VisibleChatMessage[], selectedOutputSize: string | undefined): boolean {
  return Boolean(selectedOutputSize) || shouldFallbackToImageGeneration(messages);
}

function shouldFallbackToImageGeneration(messages: VisibleChatMessage[]): boolean {
  const latestUserMessage = getLatestUserMessage(messages).toLowerCase();

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

function getLatestUserMessage(messages: VisibleChatMessage[]): string {
  return [...messages]
    .reverse()
    .find((message) => message.role === "user")
    ?.content.trim() ?? "";
}

function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return filePath.slice(lastSlash + 1);
}

function isToolCall(value: unknown): value is ToolCall {
  if (!isRecord(value) || value.type !== "function" || typeof value.id !== "string" || !isRecord(value.function)) {
    return false;
  }

  return typeof value.function.name === "string" && typeof value.function.arguments === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
