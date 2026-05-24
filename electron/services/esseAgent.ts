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
  getMissingReferenceImageReply,
  shouldReportMissingReferenceImage as shouldReportMissingReferenceImageFromMessages
} from "./referenceAttachmentGuard";
import { normalizePathForComparison } from "./pathUtils";
import type { EsseMemoryStore } from "./esseMemoryStore";
import { createEsseWorkspaceTools, type EsseTurnBudget, type EsseWorkspaceToolRuntime } from "./esseWorkspaceTools";

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
  createRuntime?: (options: CreateAgentRuntimeOptions) => Promise<AgentRuntime>;
  logger?: AppLogger;
  registry?: AgentRuntimeRegistry;
  signal?: AbortSignal;
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
  const workspaceTools = deps.workspaceToolRuntime ? createEsseWorkspaceTools(createEsseWorkspaceRuntimeProxy(registryKey)) : [];

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

  const memorySection = await renderEsseMemorySection(deps.workspaceToolRuntime?.memoryStore, deps.logger);

  return await registry.use(
    {
      key: registryKey,
      factory: async () =>
        await (deps.createRuntime ?? createAgentRuntime)({
          customToolDefinitions: workspaceTools,
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
        ? buildFullEssePrompt(input, selectedOutputSize, { memorySection, workspaceToolsEnabled: workspaceTools.length > 0 })
        : buildEsseTurnPrompt(input, selectedOutputSize, { memorySection, workspaceToolsEnabled: workspaceTools.length > 0 });

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
        throw new Error("Esse 未返回有效回复");
      }

      deps.logger?.info("Esse agent request completed", {
        context,
        data: {
          customToolCount: workspaceTools.length,
          reusedRuntime: !isFreshRuntime
        },
        publicMessage: workspaceTools.length ? "Esse 已完成工作区操作。" : "Esse 已回复。"
      });

      return { reply: content };
    }
  );
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
    applyMutation: (mutator) => current().applyMutation(mutator),
    createBlankSession: (request) =>
      current().createBlankSession?.(request) ?? Promise.resolve({ ok: false, reason: "add_blank_session unavailable" }),
    deleteUnreferencedFiles: (candidateIds) => current().deleteUnreferencedFiles?.(candidateIds) ?? Promise.resolve([]),
    executeImagePreflightTool: (request) =>
      current().executeImagePreflightTool?.(request) ?? Promise.resolve({ ok: false, reason: "image execution unavailable" }),
    executePackagePreflightTool: (request) =>
      current().executePackagePreflightTool?.(request) ?? Promise.resolve({ ok: false, reason: "package execution unavailable" }),
    getState: () => current().getState(),
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

function buildFullEssePrompt(
  input: EsseAgentTurnInput,
  selectedOutputSize: string | undefined,
  options: { memorySection?: string; workspaceToolsEnabled?: boolean } = {}
): string {
  if (options.workspaceToolsEnabled) {
    return buildFullEsseWorkspacePrompt(input, selectedOutputSize, options.memorySection);
  }

  const personaInstructions = ESSE_PERSONA_INSTRUCTIONS[input.persona ?? DEFAULT_ESSE_PERSONA];
  const history = input.messages.map((message) => `${message.role === "user" ? "用户" : "Esse"}：${message.content}`).join("\n");

  const sections: string[] = [
    "你是 BatchImager 的 Esse 智能体。",
    "当前运行时没有工作区工具；只能自然回复，不能声称已经生成、打包、删除或修改了图片。",
    "不要返回 JSON，不要返回 Markdown 代码块。",
    "==== 人格 ====",
    ...personaInstructions,
    "==== 本轮上下文 ====",
    selectedOutputSize
      ? `- 用户本轮选择的输出分辨率：${selectedOutputSize}`
      : "- 用户本轮没有选择输出分辨率，除非用户文字明确要求，不要自己添加 size。",
    `- 项目图片数量：${input.sessions.length}`,
    `- 本轮参考图数量：${input.referenceImagePaths?.length ?? 0}`,
    "==== 对话历史 ====",
    history,
    "==== 输出要求 ====",
    "直接用中文回复用户。"
  ];

  return sections.join("\n");
}

function buildEsseTurnPrompt(
  input: EsseAgentTurnInput,
  selectedOutputSize: string | undefined,
  options: { memorySection?: string; workspaceToolsEnabled?: boolean } = {}
): string {
  if (options.workspaceToolsEnabled) {
    return buildEsseWorkspaceTurnPrompt(input, selectedOutputSize, options.memorySection);
  }

  const personaInstructions = ESSE_PERSONA_INSTRUCTIONS[input.persona ?? DEFAULT_ESSE_PERSONA];
  const latestUserMessage = getLatestUserMessage(input);

  const sections: string[] = [
    "==== 环境更新 ====",
    "注意：以下环境从本轮起覆盖此前上下文；如人格变化，请按新人格回复。",
    "当前运行时没有工作区工具；只能自然回复，不能声称已经执行了图片操作。不要返回 JSON。",
    "==== 人格 ====",
    ...personaInstructions,
    "==== 本轮上下文 ====",
    selectedOutputSize
      ? `- 用户本轮选择的输出分辨率：${selectedOutputSize}`
      : "- 用户本轮没有选择输出分辨率，除非用户文字明确要求，不要自己添加 size。",
    `- 项目图片数量：${input.sessions.length}`,
    `- 本轮参考图数量：${input.referenceImagePaths?.length ?? 0}`,
    "==== 用户本轮要求 ====",
    latestUserMessage,
    "==== 输出要求 ====",
    "直接用中文回复用户。"
  ];

  return sections.join("\n");
}

function buildFullEsseWorkspacePrompt(input: EsseAgentTurnInput, selectedOutputSize: string | undefined, memorySection?: string): string {
  const personaInstructions = ESSE_PERSONA_INSTRUCTIONS[input.persona ?? DEFAULT_ESSE_PERSONA];
  const sessionLines = buildWorkspaceSessionLines(input);
  const referenceImageLines = buildTurnReferenceImageLines(input);
  const selectedDisplayLabel = getSelectedWorkspaceDisplayLabel(input);
  const history = input.messages.map((message) => `${message.role === "user" ? "用户" : "Esse"}：${message.content}`).join("\n");

  return [
    "你是 BatchImager 的 Esse 工作区 agent。你可以通过工具读取和修改左侧图片工作区。",
    ...(memorySection ? [memorySection] : []),
    ...buildWorkspaceToolPromptSections(),
    "==== 人格 ====",
    ...personaInstructions,
    "==== 本轮上下文 ====",
    selectedOutputSize
      ? `- 用户本轮选择的输出分辨率：${selectedOutputSize}`
      : "- 用户本轮没有选择输出分辨率。",
    selectedDisplayLabel ? `- 当前界面焦点图片：${selectedDisplayLabel}` : "- 当前没有界面焦点图片。",
    referenceImageLines.length ? "- 本轮参考图路径（仅用于 add_reference_image 工具参数，不要回复给用户）：" : "- 本轮没有新上传/粘贴参考图。",
    ...referenceImageLines.map((line) => `  ${line}`),
    sessionLines.length ? "- 项目图片：" : "- 当前项目没有图片。",
    ...sessionLines.map((line) => `  ${line}`),
    "==== 对话历史 ====",
    history,
    "==== 最终回复要求 ====",
    "工具执行完成后，直接用一句中文总结你做了什么。不要返回 JSON，不要假装工具没有执行。"
  ].join("\n");
}

function buildEsseWorkspaceTurnPrompt(input: EsseAgentTurnInput, selectedOutputSize: string | undefined, memorySection?: string): string {
  const sessionLines = buildWorkspaceSessionLines(input);
  const referenceImageLines = buildTurnReferenceImageLines(input);
  const selectedDisplayLabel = getSelectedWorkspaceDisplayLabel(input);

  return [
    "==== 工作区环境更新 ====",
    ...(memorySection ? [memorySection] : []),
    ...buildWorkspaceToolPromptSections(),
    selectedOutputSize
      ? `- 用户本轮选择的输出分辨率：${selectedOutputSize}`
      : "- 用户本轮没有选择输出分辨率。",
    selectedDisplayLabel ? `- 当前界面焦点图片：${selectedDisplayLabel}` : "- 当前没有界面焦点图片。",
    referenceImageLines.length ? "- 本轮参考图路径（仅用于 add_reference_image 工具参数，不要回复给用户）：" : "- 本轮没有新上传/粘贴参考图。",
    ...referenceImageLines.map((line) => `  ${line}`),
    sessionLines.length ? "- 项目图片（覆盖此前）：" : "- 当前项目没有图片（覆盖此前）。",
    ...sessionLines.map((line) => `  ${line}`),
    "==== 用户本轮要求 ====",
    getLatestUserMessage(input),
    "==== 最终回复要求 ====",
    "工具执行完成后，直接用一句中文总结你做了什么。不要返回 JSON。"
  ].join("\n");
}

function buildWorkspaceSessionLines(input: EsseAgentTurnInput): string[] {
  return input.sessions.map((session, index) => {
    const currentSource = getWorkspaceSessionCurrentSource(session);
    return `- img-${index + 1} / ${session.id}：${session.fileName}，当前图：${currentSource}，记录数：${session.generatedFilePaths?.length ?? 0}`;
  });
}

function buildTurnReferenceImageLines(input: EsseAgentTurnInput): string[] {
  return (input.referenceImagePaths ?? []).map((filePath, index) => `${index + 1}. ${filePath}`);
}

function getWorkspaceSessionCurrentSource(session: ProjectManagerPlanSession): "生成图" | "原图" {
  if (session.currentImagePath && session.generatedFilePaths?.includes(session.currentImagePath)) {
    return "生成图";
  }

  return "原图";
}

function getSelectedWorkspaceDisplayLabel(input: EsseAgentTurnInput): string | undefined {
  if (!input.selectedSessionId) {
    return undefined;
  }

  const index = input.sessions.findIndex((session) => session.id === input.selectedSessionId);
  return index >= 0 ? `img-${index + 1}` : "当前选中图";
}

function buildWorkspaceToolPromptSections(): string[] {
  return [
    "==== 工作区工具模式 ====",
    "当前你可以通过工具读取和修改左侧工作区。所有工作区副作用必须通过工具执行，不要用 JSON 字段表达工作区操作。",
    "如果用户请求可以由当前工具完成的动作，必须先调用对应工具；不要只回复“我会处理/可以处理”。",
    "可用读工具：get_project_overview / list_sessions / get_session_records / read_image_metadata / list_reference_images / list_remembered_preferences / scan_unreferenced_files。",
    "可用写工具：restore_session_record / restore_original / rename_session / reorder_sessions / set_session_prompt / add_blank_session / add_reference_image / remove_reference_image / remember_user_preference / forget_user_preference / undo_last_actions / delete_session_record / delete_session / merge_sessions / delete_unreferenced_files。",
    "生成与文件工具：generate_image / run_batch_generation / package_generated_images。它们每次都会先弹 preflight 卡片让用户确认；生成类确认后会提交后台生成任务，打包类确认后才写桌面 zip。",
    "preflight 卡片只能由这些工具触发；不要先用文字说“请确认后我就执行”。用户已经要求执行时，直接调用工具，让工具产生确认卡片。",
    "工作流要求：",
    "1) 涉及现有工作区图片的写入、删除、生成编辑、批量处理、打包限定范围前，必须先调用 list_sessions 刷新当前工作区；即使本提示里列出了项目图片，也不要直接跳过读工具。",
    "2) 回退或删除记录前必须调用 get_session_records 校验 recordIndex。",
    "3) 工具参数里的 sessionId 必须使用 list_sessions 返回的 id，不要传 img-1 这种 displayLabel。",
    "4) 一旦删除、合并、重排等操作让工作区数量或顺序发生变化，如果后续还要解析“现在第 N 张/剩下第 N 张/img-N”，必须重新调用 list_sessions。",
    "5) 用户询问图片尺寸、格式、字节大小、当前图信息时，用 read_image_metadata；先 list_sessions，把 UI label 映射为 sessionId；不要输出 filePath。",
    "6) 用户明确要求先占一个空位、添加空白图片位、预留空白图位时，用 add_blank_session；不要为了生成新图而先调用它。",
    "7) 物理删除未引用生成文件必须先 scan_unreferenced_files，再把返回的 candidateId 传给 delete_unreferenced_files；不要传 filePath。",
    "8) 管理项目参考图时必须用 list_reference_images / add_reference_image / remove_reference_image。add_reference_image 只能使用本轮参考图路径列表里的 filePath；用户只是粘贴了图但没有要求登记为项目参考图时，不要自动添加。生成时如需引用项目参考图，先 list_reference_images，再把返回的 id 放进 referenceImageIds。",
    "9) 用户明确说“记住/保存/以后都按这个”这类跨项目长期偏好时，用 remember_user_preference；用户问记住了什么或要求忘记时，用 list_remembered_preferences / forget_user_preference。不要把“这个项目是某客户的”这类项目专属信息写入全局记忆。",
    "10) 用户要求撤销、回退刚才操作、恢复上一步时，用 undo_last_actions；默认 count=1，用户说撤销最近 N 步时传 count=N。生成、打包、物理删除不可逆，工具会只撤销可逆工作区操作。",
    "11) 生成/编辑图片必须用 generate_image 或 run_batch_generation；删除背景、去水印、换白底、改风格都属于图片编辑，不要只口头答应。编辑现有工作区图片时先 list_sessions；用户要全新生成 N 张图（如“生成 4 张鲜花图”）时直接用 run_batch_generation，N 条 target.type='new' command，除非引用了现有图片才先 list_sessions。单张用 generate_image；多张、全部、这批、批量处理同一类任务用 run_batch_generation，一张图一条 command。每条命令必须显式 mode='edit' 或 mode='generate'。只有用户明确要求尺寸、比例、横版、竖版、方图、2K/4K 时才传 size。",
    "12) 打包/导出/放桌面必须用 package_generated_images；需要限定范围时先 list_sessions，只传稳定 sessionId；不要输出或猜测文件路径，也不要用文字替代 preflight。",
    "13) 用户取消 preflight 后，不要原样重试，先问用户要调整什么。",
    "14) 生成工具是 fire-and-forget：工具返回后只能说“已提交 N 个任务/生成会在后台完成”，不要说“已经生成完成”，也不要承诺完成后主动通知。其他工具完成后直接用一句中文总结；不要返回 JSON。"
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

function shouldReportMissingReferenceImage(input: EsseAgentTurnInput): boolean {
  return shouldReportMissingReferenceImageFromMessages({
    messages: input.messages,
    referenceImageCount: input.referenceImagePaths?.length ?? 0
  });
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
