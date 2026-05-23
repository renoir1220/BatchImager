import { normalizeGenerationSizeValue } from "../generationSizes";
import type {
  BatchPlan,
  EsseAgentHistoryMessage,
  EsseFileTask,
  EsseImageRequest,
  EssePersona,
  ProjectManagerPlanSession
} from "../ipcTypes";
import type { TuziLlmApiConfig } from "./localConfig";
import type { AppLogger } from "./appLogger";
import type { CreateAgentRuntimeOptions, AgentRuntime } from "./agentRuntime";
import { createAgentRuntime } from "./agentRuntime";
import {
  getMissingReferenceImageReply,
  shouldReportMissingReferenceImage as shouldReportMissingReferenceImageFromMessages
} from "./referenceAttachmentGuard";

interface EsseAgentTurnInput {
  acceptPlanOnlyResponse?: boolean;
  messages: EsseAgentHistoryMessage[];
  outputSize?: string;
  persona?: EssePersona;
  referenceImagePaths?: string[];
  selectedSessionId?: string | null;
  sessions: ProjectManagerPlanSession[];
}

interface EssePlanTurnInput {
  outputSize?: string;
  prompt: string;
  referenceImagePaths?: string[];
  sessions: ProjectManagerPlanSession[];
}

interface EsseAgentTurnResult {
  fileTasks?: EsseFileTask[];
  imageRequests?: EsseImageRequest[];
  plan?: BatchPlan;
  reply: string;
}

interface EsseAgentDeps {
  createRuntime?: (options: CreateAgentRuntimeOptions) => Promise<AgentRuntime>;
  logger?: AppLogger;
}

interface RawEsseResponse {
  fileTasks?: RawEsseFileTask[];
  imageRequests?: RawEsseImageRequest[];
  plan?: RawBatchPlan;
  reply?: unknown;
}

interface RawEsseFileTask {
  destination?: unknown;
  fileName?: unknown;
  source?: unknown;
  type?: unknown;
}

interface RawBatchPlan {
  commands?: RawWorkerCommand[];
  globalInstruction?: unknown;
  title?: unknown;
}

interface RawWorkerCommand {
  constraints?: unknown;
  instruction?: unknown;
  referenceImageIds?: unknown;
  targetSessionId?: unknown;
}

interface RawEsseImageRequest {
  mode?: unknown;
  prompt?: unknown;
  size?: unknown;
  sourceSessionId?: unknown;
  target?: unknown;
}

const DEFAULT_ESSE_PERSONA: EssePersona = "excellent-employee";

const ESSE_PERSONA_INSTRUCTIONS: Record<EssePersona, string[]> = {
  "excellent-employee": [
    "当前人格：优秀员工。",
    "思考任务的目的、对象，以及为对象提供何种价值；在不违背用户意图和产品规则的前提下，尝试提供超出预期的成果。"
  ],
  "old-ox": [
    "当前人格：老黄牛。",
    "说啥干啥，听话但没创意，适合执行快速明确的任务；优先快速执行用户明确要求，不主动扩展范围。"
  ],
  "question-girl": [
    "当前人格：问题少女。",
    "当任务不够明确，甚至基本明确时，都要挑战用户的问题，以反问形式追问，刨根问底并引导用户进一步明确需求。"
  ],
  robot: [
    "当前人格：无情的机器人。",
    "没有额外人格；按 LLM 默认方式处理任务，同时严格遵守 BatchImager 的 JSON、方案和图片生成规则。"
  ]
};

export async function runEsseAgentTurn(
  input: EsseAgentTurnInput,
  config: TuziLlmApiConfig,
  projectDirectory: string,
  deps: EsseAgentDeps = {}
): Promise<EsseAgentTurnResult> {
  const selectedOutputSize = normalizeGenerationSizeValue(input.outputSize);
  const context = "esse-agent";

  deps.logger?.info("Esse agent request started", {
    context,
    data: {
      imageCount: input.sessions.length,
      messageCount: input.messages.length,
      outputSize: selectedOutputSize,
      referenceImageCount: input.referenceImagePaths?.length ?? 0
    },
    publicMessage: "Esse 正在思考..."
  });

  if (shouldReportMissingReferenceImage(input)) {
    const reply = getMissingReferenceImageReply();
    deps.logger?.warn("Esse request referenced a missing attachment", {
      context,
      publicMessage: "没有收到参考图附件，请先粘贴或添加参考图。"
    });
    return { reply };
  }

  const runtime = await (deps.createRuntime ?? createAgentRuntime)({
    customToolDefinitions: [],
    llmConfig: config,
    model: config.model,
    projectDirectory,
    sessionId: context
  });

  try {
    const agentLogState: AgentLogState = { hasPublishedMessageUpdate: false };
    runtime.subscribe((event) => logAgentEvent(event, deps.logger, agentLogState));
    await runtime.prompt(buildEssePrompt(input, selectedOutputSize));

    const content = runtime.getLastAssistantText()?.trim();
    if (!content) {
      throw new Error("Esse 未返回有效回复");
    }

    const parsed = parseEsseResponse(content);
    const result = normalizeEsseResponse(parsed, input, selectedOutputSize, {
      acceptPlanOnlyResponse: input.acceptPlanOnlyResponse === true
    });

    deps.logger?.info("Esse agent request completed", {
      context,
      data: {
        fileTaskCount: result.fileTasks?.length ?? 0,
        hasPlan: Boolean(result.plan),
        imageRequestCount: result.imageRequests?.length ?? 0
      },
      publicMessage: result.plan ? "Esse 已生成方案，等待确认。" : "Esse 已回复。"
    });

    return result;
  } finally {
    runtime.dispose();
  }
}

export async function runEssePlanTurn(
  input: EssePlanTurnInput,
  config: TuziLlmApiConfig,
  projectDirectory: string,
  deps: EsseAgentDeps = {}
): Promise<BatchPlan> {
  const result = await runEsseAgentTurn(
    {
      messages: [{ content: input.prompt, role: "user" }],
      acceptPlanOnlyResponse: true,
      ...(input.outputSize ? { outputSize: input.outputSize } : {}),
      ...(input.referenceImagePaths ? { referenceImagePaths: input.referenceImagePaths } : {}),
      sessions: input.sessions
    },
    config,
    projectDirectory,
    deps
  );

  if (!result.plan) {
    if (result.reply === getMissingReferenceImageReply()) {
      throw new Error(result.reply);
    }

    throw new Error("Esse 未返回有效的批量方案 JSON");
  }

  return result.plan;
}

function buildEssePrompt(input: EsseAgentTurnInput, selectedOutputSize: string | undefined): string {
  const personaInstructions = ESSE_PERSONA_INSTRUCTIONS[input.persona ?? DEFAULT_ESSE_PERSONA];
  const sessionLines = input.sessions.map((session) =>
    `- ${session.id}：${session.fileName}${session.currentImagePath ? `，当前图：${session.currentImagePath}` : ""}`
  );
  const referenceLines = (input.referenceImagePaths ?? []).map((filePath, index) => `- ref-${index + 1}：${filePath}`);
  const history = input.messages.map((message) => `${message.role === "user" ? "用户" : "Esse"}：${message.content}`).join("\n");

  return [
    "你是 BatchImager 的 Esse智能体。你可以自然讨论，也可以在需要时创建待确认批处理方案，或请求生成新的图片加入项目。",
    "只返回 JSON 对象，不要返回 Markdown 解释。JSON 必须至少包含 reply 字段。",
    "如果用户只是讨论、询问建议、分析方向，只返回 {\"reply\":\"...\"}。",
    "如果用户要对现有多张图批量处理，返回 reply 和 plan；plan 等待用户确认，不要自动执行。",
    "如果用户要求生成新图、空项目生成几张图、从某张图派生新图，返回 reply 和 imageRequests。",
    "如果用户要求把新生成的图片打包、导出、放到桌面、整理成本地文件，返回 reply 和 fileTasks；这不是批处理方案。",
    "imageRequests 每项包含 mode、target、prompt，可选 size、sourceSessionId。mode 为 edit 表示基于项目已有图片修改或派生，必须带 sourceSessionId；mode 为 generate 表示不使用项目图片作为输入图，不带 sourceSessionId。",
    "target 为 existing 表示修改已有图片并派给该图片会话；target 为 new 表示新增一张图片会话占位后再生成。用户说添加到项目、生成新图、派生新图、多方向生成时用 target:new。",
    "fileTasks 每项包含 type:\"package\"、source:\"generated-images\"、destination:\"desktop\"，可选 fileName。",
    "不要假装图片已经生成。imageRequests 只会派发到图片会话，由图片会话工具真实生成。",
    "当前选中图片只是界面焦点，不等于输入图，也不等于用户选择了 sourceSessionId。",
    "当本轮有参考图时，用户说“这张图”“这个参考图”“根据这张图”默认指本轮参考图，不要使用当前选中图片作为 sourceSessionId。",
    "只有用户明确说“当前选中图”“左侧第 N 张”“项目里的某张图”“基于 img-X”这类项目图片指向时，才可以填写 sourceSessionId。",
    "如果只是基于粘贴参考图生成或派生新图，使用 mode:\"generate\"、target:\"new\"，不要填写 sourceSessionId。",
    ...personaInstructions,
    selectedOutputSize ? `用户本轮选择的输出分辨率：${selectedOutputSize}` : "用户本轮没有选择输出分辨率，除非用户文字明确要求，不要自己添加 size。",
    input.selectedSessionId ? `当前界面焦点图片（仅供用户明确点名时参考，不是默认输入图）：${input.selectedSessionId}` : "当前没有界面焦点图片。",
    referenceLines.length ? "可用参考图：" : "本轮没有参考图。",
    ...referenceLines,
    sessionLines.length ? "项目图片：" : "当前项目没有图片。",
    ...sessionLines,
    "对话历史：",
    history,
    "输出 JSON 示例：",
    JSON.stringify({
      imageRequests: [{ mode: "generate", prompt: "生成一张白底红玫瑰商品图", size: "2048x2048", target: "new" }],
      fileTasks: [{ destination: "desktop", fileName: "BatchImager-新生成图片.zip", source: "generated-images", type: "package" }],
      plan: {
        commands: [{ constraints: ["保留主体"], instruction: "生成白底主图", targetSessionId: input.sessions[0]?.id ?? "img-1" }],
        globalInstruction: "统一白底商品图",
        title: "白底主图"
      },
      reply: "我先给你生成两张新图。"
    })
  ].join("\n");
}

function parseEsseResponse(content: string): RawEsseResponse {
  const jsonText = extractJsonText(content);

  try {
    const parsed = JSON.parse(jsonText) as RawEsseResponse;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("not object");
    }

    return parsed;
  } catch {
    throw new Error("Esse 未返回有效的 JSON 回复");
  }
}

function normalizeEsseResponse(
  response: RawEsseResponse,
  input: EsseAgentTurnInput,
  selectedOutputSize: string | undefined,
  options: { acceptPlanOnlyResponse?: boolean } = {}
): EsseAgentTurnResult {
  const rawPlan = response.plan ?? (options.acceptPlanOnlyResponse && isRawBatchPlan(response) ? (response as RawBatchPlan) : undefined);
  const reply = isNonEmptyString(response.reply)
    ? response.reply.trim()
    : options.acceptPlanOnlyResponse && rawPlan
      ? "方案已生成，等待确认。"
      : undefined;

  if (!reply) {
    throw new Error("Esse 未返回有效回复");
  }

  const plan = rawPlan ? normalizeBatchPlan(rawPlan, input, selectedOutputSize) : undefined;
  const fileTasks = normalizeFileTasks(response.fileTasks);
  const imageRequests = normalizeImageRequests(response.imageRequests, input, selectedOutputSize);

  return {
    ...(fileTasks.length ? { fileTasks } : {}),
    ...(imageRequests.length ? { imageRequests } : {}),
    ...(plan ? { plan } : {}),
    reply
  };
}

function isRawBatchPlan(response: RawEsseResponse): boolean {
  const candidate = response as RawBatchPlan;
  return Array.isArray(candidate.commands) || isNonEmptyString(candidate.globalInstruction) || isNonEmptyString(candidate.title);
}

function normalizeFileTasks(tasks: RawEsseFileTask[] | undefined): EsseFileTask[] {
  if (!Array.isArray(tasks)) {
    return [];
  }

  return tasks
    .slice(0, 4)
    .filter(
      (task) =>
        task &&
        typeof task === "object" &&
        task.type === "package" &&
        task.source === "generated-images" &&
        task.destination === "desktop"
    )
    .map((task) => ({
      destination: "desktop",
      ...(typeof task.fileName === "string" && task.fileName.trim() ? { fileName: task.fileName.trim() } : {}),
      id: createId("esse-file"),
      source: "generated-images",
      type: "package"
    }));
}

function normalizeBatchPlan(
  rawPlan: RawBatchPlan,
  input: EsseAgentTurnInput,
  selectedOutputSize: string | undefined
): BatchPlan | undefined {
  const knownSessionIds = new Set(input.sessions.map((session) => session.id));
  const planId = createId("plan");
  const referenceImageIds = (input.referenceImagePaths ?? []).map((_, index) => `ref-${index + 1}`);
  const commands = (Array.isArray(rawPlan.commands) ? rawPlan.commands : [])
    .map((command, index) => normalizeWorkerCommand(command, index, planId, knownSessionIds, selectedOutputSize, referenceImageIds))
    .filter((command): command is NonNullable<typeof command> => Boolean(command));

  if (!isNonEmptyString(rawPlan.title) || !isNonEmptyString(rawPlan.globalInstruction) || commands.length === 0) {
    return undefined;
  }

  return {
    commands,
    globalInstruction: rawPlan.globalInstruction.trim(),
    id: planId,
    ...(selectedOutputSize ? { outputSize: selectedOutputSize } : {}),
    ...(referenceImageIds.length
      ? {
          referenceImages: referenceImageIds.map((id, index) => ({
            filePath: input.referenceImagePaths?.[index] ?? "",
            id,
            label: `参考图 ${index + 1}`
          }))
        }
      : {}),
    status: "draft",
    targetSessionIds: commands.map((command) => command.targetSessionId),
    title: rawPlan.title.trim()
  };
}

function normalizeWorkerCommand(
  command: RawWorkerCommand,
  index: number,
  planId: string,
  knownSessionIds: Set<string>,
  selectedOutputSize: string | undefined,
  referenceImageIds: string[]
): BatchPlan["commands"][number] | null {
  if (
    !command ||
    typeof command !== "object" ||
    !isNonEmptyString(command.targetSessionId) ||
    !knownSessionIds.has(command.targetSessionId) ||
    !isNonEmptyString(command.instruction)
  ) {
    return null;
  }

  return {
    constraints: Array.isArray(command.constraints)
      ? command.constraints.filter(isNonEmptyString).map((constraint) => constraint.trim())
      : [],
    id: createId(`cmd-${index + 1}`),
    instruction: command.instruction.trim(),
    ...(selectedOutputSize ? { outputSize: selectedOutputSize } : {}),
    planId,
    ...(referenceImageIds.length ? { referenceImageIds } : {}),
    source: "project-manager",
    targetSessionId: command.targetSessionId.trim()
  };
}

function normalizeImageRequests(
  requests: RawEsseImageRequest[] | undefined,
  input: EsseAgentTurnInput,
  selectedOutputSize: string | undefined
): EsseImageRequest[] {
  if (!Array.isArray(requests)) {
    return [];
  }

  const knownSessionIds = new Set(input.sessions.map((session) => session.id));
  const canUseProjectSourceSession = shouldUseProjectSourceSession(input);

  return requests
    .slice(0, 8)
    .filter(isValidImageRequest)
    .map((request) => {
      const prompt = request.prompt.trim();
      const requestedSize = typeof request.size === "string" ? normalizeGenerationSizeValue(request.size) : undefined;
      const sourceSessionId = canUseProjectSourceSession && isNonEmptyString(request.sourceSessionId) && knownSessionIds.has(request.sourceSessionId)
        ? request.sourceSessionId.trim()
        : undefined;
      const mode = sourceSessionId ? "edit" : "generate";
      const target = request.target === "existing" && sourceSessionId ? "existing" : "new";

      return {
        id: createId("esse-image"),
        mode,
        prompt,
        ...(selectedOutputSize ?? requestedSize ? { size: selectedOutputSize ?? requestedSize } : {}),
        ...(sourceSessionId ? { sourceSessionId } : {}),
        target
      };
    });
}

function shouldUseProjectSourceSession(input: EsseAgentTurnInput): boolean {
  if (!input.referenceImagePaths?.length) {
    return true;
  }

  const latestUserMessage = [...input.messages]
    .reverse()
    .find((message) => message.role === "user" && isNonEmptyString(message.content))
    ?.content.trim();

  if (!latestUserMessage) {
    return false;
  }

  return /(?:当前(?:选中)?(?:图片|图)|选中(?:图片|图)|左侧|项目(?:中|里|内)?(?:的)?(?:图片|图)|第[一二三四五六七八九十\d]+张|img-\d+|基于(?:当前|选中|左侧|项目)|修改(?:当前|选中|第[一二三四五六七八九十\d]+张)|把(?:当前|选中|第[一二三四五六七八九十\d]+张))/i.test(
    latestUserMessage
  );
}

function shouldReportMissingReferenceImage(input: EsseAgentTurnInput): boolean {
  return shouldReportMissingReferenceImageFromMessages({
    messages: input.messages,
    referenceImageCount: input.referenceImagePaths?.length ?? 0
  });
}

function isValidImageRequest(request: RawEsseImageRequest): request is RawEsseImageRequest & { prompt: string } {
  return Boolean(request && typeof request === "object" && isNonEmptyString(request.prompt));
}

function extractJsonText(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  return start >= 0 && end > start ? content.slice(start, end + 1) : content;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface AgentLogState {
  hasPublishedMessageUpdate: boolean;
}

function logAgentEvent(event: unknown, logger: AppLogger | undefined, state: AgentLogState): void {
  if (!logger || typeof event !== "object" || event === null || !("type" in event) || typeof event.type !== "string") {
    return;
  }

  if (event.type === "message_update") {
    if (state.hasPublishedMessageUpdate) {
      return;
    }

    state.hasPublishedMessageUpdate = true;
    logger.info("Esse message update", {
      context: "esse-agent",
      publicMessage: "Esse 正在组织回复..."
    });
  }
}
