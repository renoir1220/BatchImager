import { normalizeGenerationSizeValue } from "../generationSizes";
import type {
  EsseAgentHistoryMessage,
  EssePersona,
  ProjectManagerPlanSession
} from "../ipcTypes";
import type { TuziLlmApiConfig } from "./localConfig";
import type { AppLogger } from "./appLogger";
import type { CreateAgentRuntimeOptions, AgentRuntime } from "./agentRuntime";
import { createAgentRuntime } from "./agentRuntime";
import { AgentRuntimeRegistry, getSharedAgentRuntimeRegistry } from "./agentRuntimeRegistry";
import {
  BATCH_IMAGER_WORKBENCH_EXTENSION_TOOL_NAMES,
  createBatchImagerWorkbenchExtension,
  toBatchImagerWorkbenchCapabilityRuntime
} from "./batchImagerWorkbenchExtension";
import { normalizePathForComparison } from "./pathUtils";
import type { EsseMemoryStore } from "./esseMemoryStore";
import { createEsseWorkspaceTools, type EsseTurnBudget, type EsseWorkspaceToolRuntime } from "./esseWorkspaceTools";
import type { EsseSkillLoader } from "./esseSkillLoader";

interface EsseAgentTurnInput {
  messages: EsseAgentHistoryMessage[];
  outputSize?: string;
  persona?: EssePersona;
  referenceImagePaths?: string[];
  selectedSessionId?: string | null;
  sessions: ProjectManagerPlanSession[];
}

interface EsseAgentTurnResult {
  reply: string;
}

interface EsseAgentDeps {
  bashTool?: unknown;
  createRuntime?: (options: CreateAgentRuntimeOptions) => Promise<AgentRuntime>;
  logger?: AppLogger;
  onAssistantMessageUpdate?: (content: string) => void;
  registry?: AgentRuntimeRegistry;
  signal?: AbortSignal;
  skillLoader?: EsseSkillLoader;
  workspaceToolRuntime?: EsseWorkspaceToolRuntime;
}

const DEFAULT_ESSE_PERSONA: EssePersona = "excellent-employee";
const ESSE_TURN_TOOL_CALL_LIMIT = 30;
const ESSE_TURN_WRITE_CALL_LIMIT = 10;
const ESSE_TURN_TIMEOUT_MS = 5 * 60 * 1000;

interface EsseWorkspaceTurnContext {
  budget: EsseTurnBudget;
  runtime: EsseWorkspaceToolRuntime;
}

const workspaceTurnContextByRegistryKey = new Map<string, EsseWorkspaceTurnContext>();

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
    "回复要短，确认要少；用户要求生成、删除、修改时直接调相应工具，不要在 reply 里假装已经完成。",
    "即使风格朴素，也要保持专业底线：不破坏主体、不乱改尺寸、不违背 BatchImager 的图片生成和 JSON 规则。"
  ],
  "question-girl": [
    "当前人格：问题少女。",
    "你不是为了抬杠而提问，而是像一个敏锐、挑剔但有审美判断力的设计搭档：专门抓需求里的模糊点、矛盾点和风险点。",
    "当用户只说“弄好看”“高级点”“电商感”“优化一下”这类含糊目标时，优先用 1-3 个短促反问逼清楚方向；问题必须落到可执行选择，例如平台、受众、主体保留、背景风格、材质质感、画幅比例。",
    "当用户需求已经足够明确时，不要为了人格而硬追问；直接调相应工具，只在 reply 里顺手点出一个可能影响效果的关键选择。",
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
  const workspaceRuntimeProxy = deps.workspaceToolRuntime ? createEsseWorkspaceRuntimeProxy(registryKey) : undefined;
  const workspaceTools = workspaceRuntimeProxy ? createEsseWorkspaceTools(workspaceRuntimeProxy) : [];
  const extensionToolNames = workspaceRuntimeProxy
    ? uniqueToolNames([...BATCH_IMAGER_WORKBENCH_EXTENSION_TOOL_NAMES, ...workspaceTools.map((tool) => tool.name)])
    : [];
  const workbenchExtensionFactories = workspaceRuntimeProxy
    ? [
        createBatchImagerWorkbenchExtension(
          () => toBatchImagerWorkbenchCapabilityRuntime(workspaceRuntimeProxy),
          { additionalTools: workspaceTools }
        )
      ]
    : [];
  const customToolDefinitions = deps.bashTool ? [deps.bashTool] : [];
  const workspaceToolsEnabled = Boolean(workspaceRuntimeProxy);
  const visibleWorkspaceToolCount = extensionToolNames.length;

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

  const memorySection = await renderEsseMemorySection(deps.workspaceToolRuntime?.memoryStore, deps.logger);
  const skillsSection = deps.skillLoader?.formatForPrompt() ?? "";

  return await registry.use(
    {
      key: registryKey,
      factory: async () =>
        await (deps.createRuntime ?? createAgentRuntime)({
          customToolDefinitions,
          extensionFactories: workbenchExtensionFactories,
          extensionToolNames,
          llmConfig: config,
          model: config.model,
          projectDirectory,
          sessionId: context
        })
    },
    async ({ runtime, isFreshRuntime }) => {
      const agentLogState: AgentLogState = { hasPublishedMessageUpdate: false };
      const streamState: EsseStreamState = { lastContent: runtime.getLastAssistantText()?.trim() ?? "" };
      const unsubscribe = runtime.subscribe((event) => {
        logAgentEvent(event, deps.logger, agentLogState);
        publishAssistantMessageUpdate(event, runtime, deps.onAssistantMessageUpdate, streamState);
      });
      const promptText = isFreshRuntime
        ? buildFullEssePrompt(input, selectedOutputSize, {
            memorySection,
            skillsSection,
            workspaceToolsEnabled
          })
        : buildEsseTurnPrompt(input, selectedOutputSize, {
            memorySection,
            skillsSection,
            workspaceToolsEnabled
          });

      try {
        if (deps.workspaceToolRuntime) {
          workspaceTurnContextByRegistryKey.set(registryKey, {
            budget: createEsseTurnBudget(),
            runtime: deps.workspaceToolRuntime
          });
        } else {
          workspaceTurnContextByRegistryKey.delete(registryKey);
        }
        await promptWithAbort(runtime, promptText, deps.signal);
      } finally {
        unsubscribe();
        workspaceTurnContextByRegistryKey.delete(registryKey);
      }

      const content = runtime.getLastAssistantText()?.trim();
      if (!content) {
        const assistantError = runtime.getLastAssistantError?.()?.trim();
        if (assistantError) {
          const safeAssistantError = sanitizeAssistantError(assistantError);
          deps.logger?.warn("Esse agent returned assistant error without text", {
            context,
            data: {
              assistantError: safeAssistantError,
              customToolCount: visibleWorkspaceToolCount,
              reusedRuntime: !isFreshRuntime
            },
            publicMessage: "Esse 调用模型失败。"
          });
          throw new Error(`Esse 模型调用失败：${safeAssistantError}`);
        }

        throw new Error("Esse 未返回有效回复");
      }
      if (content !== streamState.lastContent) {
        deps.onAssistantMessageUpdate?.(content);
        streamState.lastContent = content;
      }

      deps.logger?.info("Esse agent request completed", {
        context,
        data: {
          customToolCount: visibleWorkspaceToolCount,
          reusedRuntime: !isFreshRuntime
        },
        publicMessage: workspaceToolsEnabled ? "Esse 已完成工作区操作。" : "Esse 已回复。"
      });

      return { reply: content };
    }
  );
}

interface EsseStreamState {
  lastContent: string;
}

function createEsseTurnBudget(now = Date.now()): EsseTurnBudget {
  return {
    deadline: now + ESSE_TURN_TIMEOUT_MS,
    toolCalls: { limit: ESSE_TURN_TOOL_CALL_LIMIT, used: 0 },
    writeCalls: { limit: ESSE_TURN_WRITE_CALL_LIMIT, used: 0 }
  };
}

function createEsseWorkspaceRuntimeProxy(registryKey: string): EsseWorkspaceToolRuntime {
  const current = () => getEsseWorkspaceTurnContext(registryKey).runtime;

  return {
    addReferenceImage: (request) =>
      current().addReferenceImage?.(request) ?? Promise.resolve({ ok: false, reason: "add_reference_image unavailable" }),
    addWorkspaceImage: (request) =>
      current().addWorkspaceImage?.(request) ?? Promise.resolve({ ok: false, reason: "add_workspace_image unavailable" }),
    applyMutation: (mutator, options) => current().applyMutation(mutator, options),
    createBlankSession: (request) =>
      current().createBlankSession?.(request) ?? Promise.resolve({ ok: false, reason: "add_blank_session unavailable" }),
    deleteUnreferencedFiles: (candidateIds) => current().deleteUnreferencedFiles?.(candidateIds) ?? Promise.resolve([]),
    executeImagePreflightTool: (request) =>
      current().executeImagePreflightTool?.(request) ?? Promise.resolve({ ok: false, reason: "image execution unavailable" }),
    executePackagePreflightTool: (request) =>
      current().executePackagePreflightTool?.(request) ?? Promise.resolve({ ok: false, reason: "package execution unavailable" }),
    getState: () => current().getState(),
    getSinkRevision: () => current().getSinkRevision?.() ?? 0,
    getTurnReferenceImagePaths: () => current().getTurnReferenceImagePaths?.() ?? [],
    getTurnBudget: () => workspaceTurnContextByRegistryKey.get(registryKey)?.budget,
    memoryStore: createEsseMemoryStoreProxy(current),
    recordToolCall: (event) => current().recordToolCall?.(event),
    readImageMetadata: (request) =>
      current().readImageMetadata?.(request) ?? Promise.reject(new Error("read_image_metadata unavailable")),
    removeReferenceImage: (request) =>
      current().removeReferenceImage?.(request) ?? Promise.resolve({ ok: false, reason: "remove_reference_image unavailable" }),
    requestPermission: (request) =>
      current().requestPermission?.(request) ?? Promise.resolve({ decision: "allow" }),
    requestPreflight: (payload) =>
      current().requestPreflight?.(payload) ?? Promise.resolve({ decision: "cancel", detail: "preflight unavailable" }),
    scanUnreferencedFiles: () => current().scanUnreferencedFiles?.() ?? Promise.resolve([])
  };
}

function createEsseMemoryStoreProxy(current: () => EsseWorkspaceToolRuntime): EsseMemoryStore {
  const store = () => {
    const memoryStore = current().memoryStore;
    if (!memoryStore) {
      throw new Error("memory unavailable");
    }
    return memoryStore;
  };

  return {
    add: (entry) => store().add(entry),
    getFilePath: () => store().getFilePath(),
    list: () => store().list(),
    remove: (id) => store().remove(id),
    renderForPrompt: () => store().renderForPrompt()
  };
}

async function renderEsseMemorySection(memoryStore: EsseMemoryStore | undefined, logger?: AppLogger): Promise<string> {
  if (!memoryStore) {
    return "";
  }

  try {
    return await memoryStore.renderForPrompt();
  } catch (error) {
    logger?.warn("Esse memory render failed", {
      context: "esse-agent",
      error,
      publicMessage: "Esse 记忆读取失败，本轮暂不使用记忆。"
    });
    return "";
  }
}

function getEsseWorkspaceTurnContext(registryKey: string): EsseWorkspaceTurnContext {
  const context = workspaceTurnContextByRegistryKey.get(registryKey);
  if (!context) {
    throw new Error("Esse workspace turn context unavailable");
  }

  return context;
}

function buildEsseRegistryKey(projectDirectory: string): string {
  return `esse:${normalizePathForComparison(projectDirectory)}`;
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

function uniqueToolNames(names: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function buildFullEssePrompt(
  input: EsseAgentTurnInput,
  selectedOutputSize: string | undefined,
  options: { memorySection?: string; skillsSection?: string; workspaceToolsEnabled?: boolean } = {}
): string {
  if (options.workspaceToolsEnabled) {
    return buildFullEsseWorkspacePrompt(input, selectedOutputSize, options.memorySection, options.skillsSection);
  }

  const personaInstructions = ESSE_PERSONA_INSTRUCTIONS[input.persona ?? DEFAULT_ESSE_PERSONA];
  const history = input.messages.map((message) => `${message.role === "user" ? "用户" : "Esse"}：${message.content}`).join("\n");
  const recentPlanContextLines = buildRecentPlanContextLines(input);

  const sections: string[] = [
    "你是 BatchImager 的 Esse 智能体。",
    "当前运行时没有工作区工具；只能自然回复，不能声称已经生成、打包、删除或修改了图片。",
    "不要返回 JSON，不要返回 Markdown 代码块。",
    ...buildSkillsPromptSection(options.skillsSection),
    "==== 人格 ====",
    ...personaInstructions,
    "==== 本轮上下文 ====",
    selectedOutputSize
      ? `- 用户本轮选择的输出分辨率：${selectedOutputSize}`
      : "- 用户本轮没有选择输出分辨率，除非用户文字明确要求，不要自己添加 size；图像工具会按源图/每条 command 第一张输入图的原始比例推导。",
    `- 项目图片数量：${input.sessions.length}`,
    `- 本轮参考图数量：${input.referenceImagePaths?.length ?? 0}`,
    ...recentPlanContextLines,
    "==== 对话历史 ====",
    history,
    ...buildEmojiPromptInstruction(),
    "==== 输出要求 ====",
    "直接用中文回复用户。"
  ];

  return sections.join("\n");
}

function buildEsseTurnPrompt(
  input: EsseAgentTurnInput,
  selectedOutputSize: string | undefined,
  options: { memorySection?: string; skillsSection?: string; workspaceToolsEnabled?: boolean } = {}
): string {
  if (options.workspaceToolsEnabled) {
    return buildEsseWorkspaceTurnPrompt(input, selectedOutputSize, options.memorySection, options.skillsSection);
  }

  const personaInstructions = ESSE_PERSONA_INSTRUCTIONS[input.persona ?? DEFAULT_ESSE_PERSONA];
  const latestUserMessage = getLatestUserMessage(input);
  const recentPlanContextLines = buildRecentPlanContextLines(input);

  const sections: string[] = [
    "==== 环境更新 ====",
    "注意：以下环境从本轮起覆盖此前上下文；如人格变化，请按新人格回复。",
    "当前运行时没有工作区工具；只能自然回复，不能声称已经执行了图片操作。不要返回 JSON。",
    ...buildSkillsPromptSection(options.skillsSection),
    "==== 人格 ====",
    ...personaInstructions,
    "==== 本轮上下文 ====",
    selectedOutputSize
      ? `- 用户本轮选择的输出分辨率：${selectedOutputSize}`
      : "- 用户本轮没有选择输出分辨率，除非用户文字明确要求，不要自己添加 size；图像工具会按源图/每条 command 第一张输入图的原始比例推导。",
    `- 项目图片数量：${input.sessions.length}`,
    `- 本轮参考图数量：${input.referenceImagePaths?.length ?? 0}`,
    ...recentPlanContextLines,
    "==== 用户本轮要求 ====",
    latestUserMessage,
    ...buildEmojiPromptInstruction(),
    "==== 输出要求 ====",
    "直接用中文回复用户。"
  ];

  return sections.join("\n");
}

function buildFullEsseWorkspacePrompt(
  input: EsseAgentTurnInput,
  selectedOutputSize: string | undefined,
  memorySection?: string,
  skillsSection?: string
): string {
  const personaInstructions = ESSE_PERSONA_INSTRUCTIONS[input.persona ?? DEFAULT_ESSE_PERSONA];
  const referenceImageLines = buildTurnReferenceImageLines(input);
  const workspaceSnapshotLines = buildWorkspaceSnapshotLines(input);
  const conversationReferenceImageLines = buildConversationReferenceImageLines(input);
  const recentPlanContextLines = buildRecentPlanContextLines(input);
  const history = input.messages.map((message) => `${message.role === "user" ? "用户" : "Esse"}：${message.content}`).join("\n");

  return [
    "你是 BatchImager 的 Esse 工作区 agent。默认不要假设自己知道左侧工作区内容；需要当前工作区图片、顺序或 id 时，通过工具读取。",
    ...(memorySection ? [memorySection] : []),
    ...buildSkillsPromptSection(skillsSection),
    ...buildWorkspaceToolPromptSections(),
    "==== 人格 ====",
    ...personaInstructions,
    "==== 本轮上下文 ====",
    selectedOutputSize
      ? `- 用户本轮选择的输出分辨率：${selectedOutputSize}`
      : "- 用户本轮没有选择输出分辨率；不要传 size，默认保持源图/第一张输入图比例。",
    referenceImageLines.length ? "- 本轮用户加入对话的图片（可直接作为生成工具 referenceImageIds 使用；不要回复路径给用户）：" : "- 本轮没有新上传/粘贴/点击图片。",
    ...referenceImageLines.map((line) => `  ${line}`),
    ...workspaceSnapshotLines,
    ...conversationReferenceImageLines,
    ...recentPlanContextLines,
    "==== 对话历史 ====",
    history,
    ...buildEmojiPromptInstruction(),
    "==== 最终回复要求 ====",
    "工具执行完成后，直接用一句中文总结你做了什么。不要返回 JSON，不要假装工具没有执行。"
  ].join("\n");
}

function buildEsseWorkspaceTurnPrompt(
  input: EsseAgentTurnInput,
  selectedOutputSize: string | undefined,
  memorySection?: string,
  skillsSection?: string
): string {
  const referenceImageLines = buildTurnReferenceImageLines(input);
  const workspaceSnapshotLines = buildWorkspaceSnapshotLines(input);
  const conversationReferenceImageLines = buildConversationReferenceImageLines(input);
  const recentPlanContextLines = buildRecentPlanContextLines(input);

  return [
    "==== 工作区环境更新 ====",
    ...(memorySection ? [memorySection] : []),
    ...buildSkillsPromptSection(skillsSection),
    ...buildWorkspaceToolPromptSections(),
    selectedOutputSize
      ? `- 用户本轮选择的输出分辨率：${selectedOutputSize}`
      : "- 用户本轮没有选择输出分辨率；不要传 size，默认保持源图/第一张输入图比例。",
    referenceImageLines.length ? "- 本轮用户加入对话的图片（可直接作为生成工具 referenceImageIds 使用；不要回复路径给用户）：" : "- 本轮没有新上传/粘贴/点击图片。",
    ...referenceImageLines.map((line) => `  ${line}`),
    ...workspaceSnapshotLines,
    ...conversationReferenceImageLines,
    ...recentPlanContextLines,
    "==== 用户本轮要求 ====",
    getLatestUserMessage(input),
    ...buildEmojiPromptInstruction(),
    "==== 最终回复要求 ====",
    "工具执行完成后，直接用一句中文总结你做了什么。不要返回 JSON。"
  ].join("\n");
}

function buildEmojiPromptInstruction(): string[] {
  return [
    "==== Emoji 渲染 ====",
    "渲染器支持原生 emoji，也会把这些短码渲染成 emoji：:sparkles: :white_check_mark: :warning: :bulb: :art: :camera: :package: :rocket: :memo: :eyes: :fire:。回复里可以少量使用；不要在工具参数、文件名、图片生成 prompt 里使用 emoji 或 emoji 短码。"
  ];
}

function buildSkillsPromptSection(skillsSection: string | undefined): string[] {
  if (!skillsSection?.trim()) {
    return [];
  }

  return [
    "==== Available skills (descriptions only; read SKILL.md before use) ====",
    skillsSection.trim(),
    "==== Skills usage rules ====",
    "当用户要求导出 Excel、PDF、交付包或其他 skill description 明确匹配的制品任务时，先用 read 读取对应 SKILL.md，再用 bash 执行其中的命令。",
    "SKILL.md 示例里的 BATCHIMAGER_PROJECT_DIR 表示当前项目目录；BATCHIMAGER_SKILL_DIR 必须替换为该 SKILL.md 所在目录的绝对路径。",
    "不要口头声称已经导出文件；需要产出文件时必须调用 bash 或对应工作区工具。"
  ];
}

function buildTurnReferenceImageLines(input: EsseAgentTurnInput): string[] {
  return (input.referenceImagePaths ?? []).map((filePath, index) => `- turn-ref-${index + 1}：对应用户消息里的【图片${index + 1}】/第 ${index + 1} 张本轮图片，filePath=${filePath}`);
}

function buildWorkspaceSnapshotLines(input: EsseAgentTurnInput): string[] {
  if (input.sessions.length === 0) {
    return ["==== 当前工作区快照 ====", "- 当前左侧工作区没有图片。"];
  }

  return [
    "==== 当前工作区快照 ====",
    `- selectedSessionId=${input.selectedSessionId ?? "none"}`,
    ...input.sessions.map((session, index) => {
      const generatedRecordCount = session.generatedFilePaths?.length ?? 0;
      const selectedText = session.id === input.selectedSessionId ? "；selected=true" : "";
      return `- img-${index + 1}：sessionId=${session.id}；referenceImageId=${getWorkspaceReferenceImageIdForPrompt(session.id)}；fileName=${session.fileName}；generatedRecordCount=${generatedRecordCount}${selectedText}`;
    })
  ];
}

function buildConversationReferenceImageLines(input: EsseAgentTurnInput): string[] {
  const candidates = getConversationReferenceImageCandidates(input);
  if (candidates.length === 0) {
    return [];
  }

  return [
    "==== 对话参考图候选 ====",
    "这些是对话历史里出现过的参考图路径；只有用户本轮明确要沿用、继续或使用这些图时，才把 conversation-ref-N 放进 generate_image/run_batch_generation 的 referenceImageIds。不要因为候选存在就自动使用；不要把路径回复给用户。",
    ...candidates.map((candidate, index) => {
      const currentTurnText = candidate.isCurrentTurn ? "；alsoAvailableAsTurnRef=true" : "";
      return `- conversation-ref-${index + 1}：fileName=${basenameFromPath(candidate.filePath)}；filePath=${candidate.filePath}${currentTurnText}`;
    })
  ];
}

function getConversationReferenceImageCandidates(input: EsseAgentTurnInput): Array<{ filePath: string; isCurrentTurn: boolean }> {
  const currentTurnPaths = new Set((input.referenceImagePaths ?? []).map((filePath) => normalizePathForComparison(filePath)));
  const seen = new Set<string>();
  const candidates: Array<{ filePath: string; isCurrentTurn: boolean }> = [];

  for (const message of input.messages) {
    for (const filePath of message.referenceFilePaths ?? []) {
      const trimmedPath = filePath.trim();
      if (!trimmedPath) {
        continue;
      }
      const normalizedPath = normalizePathForComparison(trimmedPath);
      if (seen.has(normalizedPath)) {
        continue;
      }
      seen.add(normalizedPath);
      candidates.push({ filePath: trimmedPath, isCurrentTurn: currentTurnPaths.has(normalizedPath) });
    }
  }

  return candidates;
}

function getWorkspaceReferenceImageIdForPrompt(sessionId: string): string {
  return `workspace-ref-${sessionId}`;
}

function basenameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function buildWorkspaceToolPromptSections(): string[] {
  return [
    "==== 工作区工具模式 ====",
    "当前你可以通过工具读取左侧工作区并提交生成/整理任务。交互界面的左侧是展示图片列表/画板的工作区；用户说“左侧”“添加到左侧”“放到左侧”时，通常就是让你把图片加入或整理到这个工作区。所有工作区副作用必须通过工具执行，不要用 JSON 字段表达工作区操作。",
    "默认不要读取左侧工作区：当用户已经通过点击/粘贴把图片加入本轮对话时，优先使用 turn-ref-N；只有用户用 img-N/第 N 张/当前工作区/已有生成记录等方式指向左侧内容，或需要打包、删除、重排、回退、查询尺寸时，才调用 list_sessions 等读工具。",
    "如果用户请求可以由当前工具完成的动作，必须先调用对应工具；不要只回复“我会处理/可以处理”。",
    "可用读工具：get_project_overview / list_sessions / get_session_records / read_image_metadata / list_reference_images / list_remembered_preferences / scan_unreferenced_files。",
    "可用写工具：restore_session_record / restore_original / rename_session / reorder_sessions / set_session_prompt / add_blank_session / add_workspace_image / add_reference_image / remove_reference_image / remember_user_preference / forget_user_preference / undo_last_actions / split_session / duplicate_session / delete_session_record / delete_session / merge_sessions / delete_unreferenced_files。",
    "生成与文件工具：generate_image / run_batch_generation / package_generated_images。generate_image 和 run_batch_generation 是本项目生图 API 的唯一入口；用户希望生成、编辑、改图、去背景、换风格或批量生图时，必须用这些工具，不要用 bash、skill、外部网页或其他 API 代替生图。它们每次都会先弹 preflight 卡片让用户确认；生成类确认后会提交后台生成任务，打包类确认后才写桌面 zip。",
    "调用 generate_image、run_batch_generation 或 package_generated_images 会立刻在界面插入确认卡，并挂起当前 turn 等待用户选择执行、修改或取消。",
    "决定调用这些工具后，不要先输出追问、旧方案已取消、请确认后我再执行等自然语言；直接调用工具，让确认卡承担交互。如果确实缺少会导致执行错误的关键信息，就先自然追问且不要调用生成/打包工具。",
    "生成结果永远新增到左侧工作区，不写回原图。generate_image/run_batch_generation 的 target.type 必须用 'new'；基于已有工作区图生成时用 target.sourceSessionId，基于本轮点击/粘贴图片生成时用 referenceImageIds。",
    "preflight 卡片只能由这些工具触发；不要先用文字说“请确认后我就执行”。用户已经要求执行时，直接调用工具，让工具产生确认卡片。",
    "工作流要求：",
    "1) 涉及现有工作区图片的删除、回退、重排、生成、批量处理、打包限定范围前，必须先调用 list_sessions 刷新当前工作区；但用户已经点击/粘贴加入本轮对话的图片直接使用 turn-ref-N，不需要为了这些本轮图片读取左侧工作区。",
    "2) 回退或删除记录前必须调用 get_session_records 校验 recordIndex。",
    "3) 工具参数里的 sessionId 必须使用 list_sessions 返回的 id，不要传 img-1 这种 displayLabel。",
    "4) 一旦删除、合并、重排等操作让工作区数量或顺序发生变化，如果后续还要解析“现在第 N 张/剩下第 N 张/img-N”，必须重新调用 list_sessions。",
    "5) 用户询问图片尺寸、格式、字节大小、当前图信息时，用 read_image_metadata；先 list_sessions，把 UI label 映射为 sessionId；不要输出 filePath。",
    "5.1) 读取或确认 BatchImager 项目状态时只能用工作区工具，禁止用 bash/sqlite 查询 project.sqlite；数据库 schema 是内部实现，不要猜表名或字段名。",
    "5.2) 普通文本文件、脚本草稿、skill 中间文件不属于 BatchImager 工作区产品语义：读取可用 Pi read/grep/find/ls；确需创建文件时只能走受控 bash/skill，并遵守权限确认。不要读取或写入 .env*、project.sqlite、原始图片目录或参考图目录。",
    "6) 用户明确要求先占一个空位、添加空白图片位、预留空白图位时，用 add_blank_session；用户要求把某个或多个已有本地图片文件、bash/skill 刚导出的图片、PPT 导出的页面图添加到左侧/工作区时，用 add_workspace_image。多张图片必须在一次 add_workspace_image 调用里传 images=[{filePath,fileName}, ...]，不要一张图调用一次；不要为了生成新图而先调用它们。",
    "7) 物理删除未引用生成文件必须先 scan_unreferenced_files，再把返回的 candidateId 传给 delete_unreferenced_files；不要传 filePath。",
    "8) 本轮用户粘贴/上传/点击加入对话的图片已经授权你在本轮读取并传给图像 API；直接把 turn-ref-1、turn-ref-2 等放进 generate_image/run_batch_generation 的 referenceImageIds，不要先 list_reference_images，也不要 add_reference_image。用户把某张工作区图片当作场景/风格/引用参考且没有点击加入本轮对话时，必须使用 list_sessions 返回的 referenceImageId 放进 referenceImageIds；只在 prompt 里写“参考图N/使用图N”不会把图片传给图像 API。只有用户明确要求“保存为项目参考图/以后复用/登记参考图”时，才用 add_reference_image；管理已有项目参考图时才用 list_reference_images / remove_reference_image。",
    "9) 用户明确说“记住/保存/以后都按这个”这类跨项目长期偏好时，用 remember_user_preference；用户问记住了什么或要求忘记时，用 list_remembered_preferences / forget_user_preference。不要把“这个项目是某客户的”这类项目专属信息写入全局记忆。",
    "10) undo_last_actions 会把工作区整体回退到那个时刻的状态。如果工具结果带 ⚠️ 警告，必须在 reply 里告诉用户这次撤销可能影响了中间的其他工作区操作。",
    "11) 用户要求把某些生成记录单独拆出来时，先 list_sessions 和 get_session_records，再用 split_session；用户明确要求“复制一份/做一个副本用于对比”但没有要求立即生成时，才用 duplicate_session。duplicate_session 的结果会返回新副本 sessionId；后续工具参数必须使用返回 id 或重新 list_sessions 后的真实 id，严禁自己编造 sess_*。",
    "12) 生成/编辑图片必须用本项目生图 API 工具 generate_image 或 run_batch_generation；删除背景、去水印、换白底、改风格都属于图片编辑，不要只口头答应。生成结果必须新增：用户要全新生成 N 张图且不依赖现有图片内容时（如“生成 4 张鲜花图”），用 run_batch_generation，N 条 target.type='new' command；注意新图由 target.type='new' 决定，不是由 mode='generate' 决定。",
    "13) 用户说“生成新图/两张新图”，但又要求基于现有工作区图、图1+附件、图1+另一张工作区参考图、把图1/图2的主体放进参考场景、保留图1植物等，目标是保留原图并新增结果：先 list_sessions，必要时把本轮附件 turn-ref-* 或工作区 referenceImageId 放进 referenceImageIds，然后直接调用 generate_image/run_batch_generation，使用 mode='edit'、target.type='new'、target.sourceSessionId=源图 sessionId；审批通过后工具会内部创建/复制新 session。不要为了生成新图提前调用 duplicate_session，不要直接编辑原始图1/图2，也不要用 target.type='new' 且缺少 sourceSessionId 来丢掉源图输入。",
    "13.1) 用户使用【图片1】【图片2】这类本轮图片时，不要假设它们仍在左侧或需要 sessionId。比如“根据【图片1】，生成【图片2】、【图片3】的商品图”，应提交两条 run_batch_generation command：第一条 referenceImageIds 按 [turn-ref-2, turn-ref-1]，referenceImageNames 按 [目标商品, 细节/风格参考]；第二条 referenceImageIds 按 [turn-ref-3, turn-ref-1]，referenceImageNames 按 [目标商品, 细节/风格参考]；mode='generate'，target.type='new'。prompt 只能用 referenceImageNames 里的局部名字描述图片角色，不要让 API prompt 依赖【图片N】这类用户界面编号。",
    "13.2) referenceImageIds 的顺序就是图像 API 的上传顺序；referenceImageNames 是同顺序的局部命名。遇到“场景图/场景底图/保持场景原样/保留原场景/只替换主体/把 A 放进 B 场景”时，命令必须显式写清图片角色，不能靠执行层猜。比如“分别用【图片1】【图片2】生成场景图，场景图是【图片5】，大小参考【图片4】”：scene_from_img1 用 referenceImageIds=[turn-ref-5, turn-ref-1, turn-ref-4]，referenceImageNames=[场景图, 目标植物, 大小参考]，prompt 写“以场景图为待保留场景，将目标植物自然替换进去，并按大小参考控制尺度”；scene_from_img2 用 [turn-ref-5, turn-ref-2, turn-ref-4] 和同样 names。prompt 里不要写【图片5】等用户界面编号。",
    "14) 单张用 generate_image；多张、全部、这批、批量处理同一类任务用 run_batch_generation，一张图一条 command。批量任务必须先通过 run_batch_generation 生成确认卡。若一次任务量过大，把 commands 拆成每批最多 10 条：先提交第一批确认卡，等待用户执行、修改或取消后，再继续提交下一批确认卡；用户取消后停止继续出卡并询问要调整什么。每条命令必须显式 mode='edit' 或 mode='generate'。只有用户明确要求尺寸、比例、横版、竖版、方图、2K/4K 时才传 size；未指定时绝对不要传 size，以保持源图或第一张 referenceImageIds 输入图的比例。",
    "15) 打包/导出/放桌面必须用 package_generated_images；需要限定范围时先 list_sessions，只传稳定 sessionId；不要输出或猜测文件路径，也不要用文字替代 preflight。",
    "16) 用户取消 preflight 后，不要原样重试，先问用户要调整什么。",
    "17) 生成工具是 fire-and-forget：每批确认执行后，只能理解为“已提交 N 个任务/生成会在后台完成”，不要说“已经生成完成”，也不要承诺完成后主动通知；若还有下一批未提交，继续调用 run_batch_generation 产出下一张确认卡。其他工具完成后直接用一句中文总结；不要返回 JSON。",
    "18) 如果用户在一个待确认计划/preflight 后只提出调整要求（如“不满意、不要白底、背景换灰色、少两张、把提示词改成…”），必须把最近的【上一版待确认计划】当作上一版计划，合并用户本轮修改后重新调用 generate_image 或 run_batch_generation 输出新的确认卡；不要要求用户重复原始需求，不要只解释旧计划。"
  ];
}

function buildRecentPlanContextLines(input: EsseAgentTurnInput): string[] {
  const recentPlanMessages = input.messages
    .filter((message) => message.role === "assistant" && /【(?:Esse)?(?:上一版待确认计划|已提交生成计划)】/.test(message.content))
    .slice(-3);

  if (recentPlanMessages.length === 0) {
    return [];
  }

  return [
    "==== 最近计划上下文 ====",
    "下面是用户上一轮看到的计划/确认卡摘要；当用户本轮只说调整要求时，以这些内容为基础重出计划。",
    ...recentPlanMessages.map((message) => message.content)
  ];
}

function getLatestUserMessage(input: EsseAgentTurnInput): string {
  return (
    [...input.messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content.trim() ?? ""
  );
}

function publishAssistantMessageUpdate(
  event: unknown,
  runtime: AgentRuntime,
  onAssistantMessageUpdate: ((content: string) => void) | undefined,
  state: EsseStreamState
): void {
  if (!onAssistantMessageUpdate || !isPiEventType(event, "message_update")) {
    return;
  }

  const content = runtime.getLastAssistantText()?.trim();
  if (!content || content === state.lastContent) {
    return;
  }

  state.lastContent = content;
  onAssistantMessageUpdate(content);
}

function sanitizeAssistantError(error: string): string {
  const redacted = error.replace(/(sk|sess|key)-[A-Za-z0-9_-]{16,}/gi, "$1-[已隐藏]");
  return redacted.length > 1000 ? `${redacted.slice(0, 1000)}...` : redacted;
}

function isPiEventType(event: unknown, type: string): boolean {
  return Boolean(event && typeof event === "object" && "type" in event && event.type === type);
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

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error("操作已停止");
  }
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
