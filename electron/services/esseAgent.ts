import path from "node:path";
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
import { AgentRuntimeRegistry, getSharedAgentRuntimeRegistry } from "./agentRuntimeRegistry";
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
  registry?: AgentRuntimeRegistry;
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
    "当前人格：真正的设计师。",
    "像资深商业视觉设计师一样工作：先判断商品、受众、使用场景和电商转化目标，再把这些判断落到画面方案。",
    "当用户目标模糊但足以行动时，直接给出一个有审美取向的默认方案；只追问会明显影响结果的关键选择。",
    "可以温和指出用户指令里的审美风险或商业风险，并给出更好的替代方向；不要为了显得专业而堆术语。",
    "生成或批处理图片时，把主体保留、构图、背景、光线、材质质感、平台适配写清楚，让下游可以直接执行。"
  ],
  "old-ox": [
    "当前人格：牛马设计师。",
    "核心风格是高执行、少废话、快速交付：用户说什么就优先落实什么，不主动扩大任务范围。",
    "不要装灵感，不要加戏，不把简单任务聊复杂；除非缺失信息会直接导致执行错误，否则用合理默认值继续推进。",
    "回复要短，确认要少；需要方案或图片请求时直接组织 plan/imageRequests，让用户尽快看到可确认的结果。",
    "即使风格朴素，也要保持专业底线：不破坏主体、不乱改尺寸、不违背 BatchImager 的图片生成和 JSON 规则。"
  ],
  "question-girl": [
    "当前人格：问题少女。",
    "你不是为了抬杠而提问，而是像一个敏锐、挑剔但有审美判断力的设计搭档：专门抓需求里的模糊点、矛盾点和风险点。",
    "当用户只说“弄好看”“高级点”“电商感”“优化一下”这类含糊目标时，优先用 1-3 个短促反问逼清楚方向；问题必须落到可执行选择，例如平台、受众、主体保留、背景风格、材质质感、画幅比例。",
    "当用户需求已经足够明确时，不要为了人格而硬追问；直接给出方案或 imageRequests/plan，只在 reply 里顺手点出一个可能影响效果的关键选择。",
    "语气可以聪明、轻微挑衅、有少女感，但不要阴阳怪气，不要拖慢工作；每次反问后都要给用户一个可直接确认的默认建议。"
  ],
  robot: [
    "当前人格：无情的机器人。",
    "低温、结构化、可预测地处理任务；不使用玩笑、情绪化表达或拟人化口吻。",
    "严格按用户字面意图、项目上下文和 BatchImager 规则决策；信息不足时只提出必要澄清，不进行风格发挥。",
    "回复尽量简洁，优先输出明确结论、执行方案或合法 JSON 字段；不要提供无关建议。"
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
  const registry = deps.registry ?? getSharedAgentRuntimeRegistry();
  const registryKey = buildEsseRegistryKey(projectDirectory);
  const userMessageCount = countUserMessages(input.messages);

  // 首轮（含用户清空对话）强制丢弃旧 runtime，防止沿用上一段 Esse 上下文。
  if (userMessageCount <= 1) {
    registry.invalidate(registryKey);
  }

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

  return await registry.use(
    {
      key: registryKey,
      factory: async () =>
        await (deps.createRuntime ?? createAgentRuntime)({
          customToolDefinitions: [],
          llmConfig: config,
          model: config.model,
          projectDirectory,
          sessionId: context
        })
    },
    async ({ runtime, isFreshRuntime }) => {
      const agentLogState: AgentLogState = { hasPublishedMessageUpdate: false };
      const unsubscribe = runtime.subscribe((event) => logAgentEvent(event, deps.logger, agentLogState));
      const promptText = isFreshRuntime
        ? buildFullEssePrompt(input, selectedOutputSize)
        : buildEsseTurnPrompt(input, selectedOutputSize);

      try {
        await runtime.prompt(promptText);
      } finally {
        unsubscribe();
      }

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
          imageRequestCount: result.imageRequests?.length ?? 0,
          reusedRuntime: !isFreshRuntime
        },
        publicMessage: result.plan ? "Esse 已生成方案，等待确认。" : "Esse 已回复。"
      });

      return result;
    }
  );
}

export async function runEssePlanTurn(
  input: EssePlanTurnInput,
  config: TuziLlmApiConfig,
  projectDirectory: string,
  deps: EsseAgentDeps = {}
): Promise<BatchPlan> {
  const oneShotRegistry = new AgentRuntimeRegistry();
  let result: EsseAgentTurnResult;

  try {
    result = await runEsseAgentTurn(
      {
        messages: [{ content: input.prompt, role: "user" }],
        acceptPlanOnlyResponse: true,
        ...(input.outputSize ? { outputSize: input.outputSize } : {}),
        ...(input.referenceImagePaths ? { referenceImagePaths: input.referenceImagePaths } : {}),
        sessions: input.sessions
      },
      config,
      projectDirectory,
      { ...deps, registry: oneShotRegistry }
    );
  } finally {
    oneShotRegistry.invalidateAll();
  }

  if (!result.plan) {
    if (result.reply === getMissingReferenceImageReply()) {
      throw new Error(result.reply);
    }

    throw new Error("Esse 未返回有效的批量方案 JSON");
  }

  return result.plan;
}

function buildEsseRegistryKey(projectDirectory: string): string {
  return `esse:${path.resolve(projectDirectory).toLowerCase()}`;
}

function countUserMessages(messages: EsseAgentHistoryMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if (message.role === "user") {
      count += 1;
    }
  }
  return count;
}

function buildFullEssePrompt(input: EsseAgentTurnInput, selectedOutputSize: string | undefined): string {
  const personaInstructions = ESSE_PERSONA_INSTRUCTIONS[input.persona ?? DEFAULT_ESSE_PERSONA];
  const sessionLines = input.sessions.map((session) =>
    `- ${session.id}：${session.fileName}${session.currentImagePath ? `，当前图：${session.currentImagePath}` : ""}`
  );
  const referenceLines = (input.referenceImagePaths ?? []).map((filePath, index) => `- ref-${index + 1}：${filePath}`);
  const history = input.messages.map((message) => `${message.role === "user" ? "用户" : "Esse"}：${message.content}`).join("\n");

  // 分节顺序：角色 → 输出契约（最关键，置顶并复述）→ 路由规则 → 字段规范 → 人格/上下文 → 历史 → 示例。
  const sections: string[] = [
    "你是 BatchImager 的 Esse智能体。你可以自然讨论，也可以在需要时创建待确认批处理方案，或请求生成新的图片加入项目。",
    "==== 输出契约（必须遵守）====",
    "1) 只返回一个 JSON 对象，不要返回 Markdown 解释或代码块标记。",
    "2) JSON 必须至少包含 reply 字段（字符串，给用户看的话）。",
    "3) 不要假装图片已经生成；imageRequests/plan 只是请求，由下游真正执行。",
    "==== 路由规则（决定 JSON 里出现哪些字段）====",
    "- 用户只是讨论、询问建议、分析方向 → 只返回 {\"reply\":\"...\"}。",
    "- 用户要对现有多张图批量处理 → 返回 reply + plan；plan 等待用户确认，不要自动执行。",
    "- 用户要生成新图、空项目生成几张图、从某张图派生新图 → 返回 reply + imageRequests。",
    "- 用户要把已生成的图打包/导出/放桌面 → 返回 reply + fileTasks（这不是 plan）。",
    "==== 字段规范 ====",
    "imageRequests[*] = { mode, target, prompt, size?, sourceSessionId? }",
    "  - mode=\"edit\"：基于项目已有图修改或派生，必须带 sourceSessionId。",
    "  - mode=\"generate\"：不使用项目图作输入。不带 sourceSessionId。",
    "  - target=\"existing\"：修改已有图片并派给该会话。",
    "  - target=\"new\"：新增图片会话占位后再生成（用户说\"添加到项目/生成新图/派生新图/多方向生成\"走这里）。",
    "fileTasks[*] = { type:\"package\", source:\"generated-images\", destination:\"desktop\", fileName? }",
    "==== sourceSessionId 选择规则 ====",
    "- 当前选中图片只是界面焦点，不等于输入图，也不等于默认 sourceSessionId。",
    "- 当本轮有参考图时，用户说“这张图”“这个参考图”“根据这张图”默认指本轮参考图，不要使用当前选中图片作为 sourceSessionId。",
    "- 只有用户明确说\"当前选中图/左侧第 N 张/项目里的某张图/基于 img-X\"时，才可以填写 sourceSessionId。",
    "- 只是基于粘贴参考图生成或派生新图 → 用 mode:\"generate\", target:\"new\"，不填 sourceSessionId。",
    "==== 人格 ====",
    ...personaInstructions,
    "==== 本轮上下文 ====",
    selectedOutputSize
      ? `- 用户本轮选择的输出分辨率：${selectedOutputSize}`
      : "- 用户本轮没有选择输出分辨率，除非用户文字明确要求，不要自己添加 size。",
    input.selectedSessionId
      ? `- 当前界面焦点图片（仅供用户明确点名时参考，不是默认输入图）：${input.selectedSessionId}`
      : "- 当前没有界面焦点图片。",
    referenceLines.length ? "- 可用参考图：" : "- 本轮没有参考图。",
    ...referenceLines.map((line) => `  ${line}`),
    sessionLines.length ? "- 项目图片：" : "- 当前项目没有图片。",
    ...sessionLines.map((line) => `  ${line}`),
    "==== 对话历史 ====",
    history,
    "==== 输出 JSON 示例 ====",
    JSON.stringify({
      imageRequests: [{ mode: "generate", prompt: "生成一张白底红玫瑰商品图", size: "2048x2048", target: "new" }],
      fileTasks: [{ destination: "desktop", fileName: "BatchImager-新生成图片.zip", source: "generated-images", type: "package" }],
      plan: {
        commands: [{ constraints: ["保留主体"], instruction: "生成白底主图", targetSessionId: input.sessions[0]?.id ?? "img-1" }],
        globalInstruction: "统一白底商品图",
        title: "白底主图"
      },
      reply: "我先给你生成两张新图。"
    }),
    "提醒：以上仅是字段示例，要按用户本轮真实意图决定输出。"
  ];

  return sections.join("\n");
}

function buildEsseTurnPrompt(input: EsseAgentTurnInput, selectedOutputSize: string | undefined): string {
  const personaInstructions = ESSE_PERSONA_INSTRUCTIONS[input.persona ?? DEFAULT_ESSE_PERSONA];
  const sessionLines = input.sessions.map((session) =>
    `- ${session.id}：${session.fileName}${session.currentImagePath ? `，当前图：${session.currentImagePath}` : ""}`
  );
  const referenceLines = (input.referenceImagePaths ?? []).map((filePath, index) => `- ref-${index + 1}：${filePath}`);
  const latestUserMessage = getLatestUserMessage(input);

  const sections: string[] = [
    "==== 环境更新 ====",
    "注意：以下环境从本轮起覆盖此前上下文；如人格变化，请按新人格回复。",
    "==== 人格 ====",
    ...personaInstructions,
    "==== 本轮上下文 ====",
    selectedOutputSize
      ? `- 用户本轮选择的输出分辨率：${selectedOutputSize}`
      : "- 用户本轮没有选择输出分辨率，除非用户文字明确要求，不要自己添加 size。",
    input.selectedSessionId
      ? `- 当前界面焦点图片（仅供用户明确点名时参考，不是默认输入图）：${input.selectedSessionId}`
      : "- 当前没有界面焦点图片。",
    referenceLines.length ? "- 可用参考图（覆盖此前）：" : "- 本轮没有参考图（覆盖此前）。",
    ...referenceLines.map((line) => `  ${line}`),
    sessionLines.length ? "- 项目图片（覆盖此前）：" : "- 当前项目没有图片（覆盖此前）。",
    ...sessionLines.map((line) => `  ${line}`),
    "==== 用户本轮要求 ====",
    latestUserMessage,
    "==== 输出要求 ====",
    "只返回一个 JSON 对象，至少包含 reply 字段；需要 plan / imageRequests / fileTasks 时继续沿用首轮字段规范。不要返回 Markdown 或代码块标记。"
  ];

  return sections.join("\n");
}

function getLatestUserMessage(input: EsseAgentTurnInput): string {
  return (
    [...input.messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content.trim() ?? ""
  );
}

// TODO: 当前 Esse 通过"请只返回 JSON"约束 + 正则提取拿结构化输出，模型偶尔加解释
// 就会抛 "未返回有效的 JSON 回复"。理想方案是把 plan/imageRequests/fileTasks 改成
// pi SDK 的工具调用让模型走 tool-call 提交结构化数据，不再依赖文本 JSON 契约。
// 没立刻做是因为需要先确认 pi SDK 在不要求最终文本回复的场景下的工具调用语义。
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
