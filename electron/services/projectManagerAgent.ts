import { normalizeGenerationSizeValue } from "../generationSizes";
import type { BatchPlan, ProjectManagerPlanSession } from "../ipcTypes";
import type { TuziLlmApiConfig } from "./localConfig";
import type { AppLogger } from "./appLogger";
import type { CreatePiAgentRuntimeOptions, PiAgentRuntime } from "./piAgentRuntime";
import { createPiAgentRuntime } from "./piAgentRuntime";

interface ProjectManagerPlanInput {
  outputSize?: string;
  prompt: string;
  referenceImagePaths?: string[];
  sessions: ProjectManagerPlanSession[];
}

interface ProjectManagerAgentDeps {
  createRuntime?: (options: CreatePiAgentRuntimeOptions) => Promise<PiAgentRuntime>;
  logger?: AppLogger;
}

interface RawBatchPlan {
  commands?: RawWorkerCommand[];
  globalInstruction?: unknown;
  outputSize?: unknown;
  targetSessionIds?: unknown;
  title?: unknown;
}

interface RawWorkerCommand {
  constraints?: unknown;
  instruction?: unknown;
  referenceImageIds?: unknown;
  targetSessionId?: unknown;
}

export async function runProjectManagerPlanAgent(
  input: ProjectManagerPlanInput,
  config: TuziLlmApiConfig,
  projectDirectory: string,
  deps: ProjectManagerAgentDeps = {}
): Promise<BatchPlan> {
  const selectedOutputSize = normalizeGenerationSizeValue(input.outputSize);
  const context = "project-manager";

  deps.logger?.info("Project manager plan request started", {
    context,
    data: {
      imageCount: input.sessions.length,
      model: config.model,
      outputSize: selectedOutputSize,
      referenceImageCount: input.referenceImagePaths?.length ?? 0
    },
    publicMessage: "正在生成批量方案..."
  });

  const runtime = await (deps.createRuntime ?? createPiAgentRuntime)({
    customToolDefinitions: [],
    llmConfig: config,
    model: config.model,
    projectDirectory,
    sessionId: context
  });

  try {
    const piLogState: PiLogState = { hasPublishedMessageUpdate: false };
    runtime.subscribe((event) => logPiEvent(event, deps.logger, piLogState));
    await runtime.prompt(buildProjectManagerPrompt(input, selectedOutputSize));

    const content = runtime.getLastAssistantText()?.trim();

    if (!content) {
      throw new Error("Esse 未返回有效的批量方案 JSON");
    }

    const plan = normalizeBatchPlan(parsePlanJson(content), input, selectedOutputSize);

    deps.logger?.info("Project manager plan created", {
      context,
      data: { commandCount: plan.commands.length, planId: plan.id },
      publicMessage: "方案已生成，等待确认。"
    });

    return plan;
  } finally {
    runtime.dispose();
  }
}

function buildProjectManagerPrompt(input: ProjectManagerPlanInput, selectedOutputSize: string | undefined): string {
  const referenceLines = (input.referenceImagePaths ?? []).map((filePath, index) => `- ref-${index + 1}：${filePath}`);
  const sessionLines = input.sessions.map((session) => `- ${session.id}：${session.fileName}`);
  const schemaExample = {
    commands: [
      {
        constraints: ["保留商品主体、颜色和形态"],
        instruction: "给这张图生成具体可执行的商品图任务",
        referenceImageIds: referenceLines.length ? ["ref-1"] : [],
        targetSessionId: input.sessions[0]?.id ?? "img-1"
      }
    ],
    globalInstruction: "整批图片的统一目标和风格约束",
    title: "简短方案标题"
  };

  return [
    "你是 BatchImager 的 Esse智能体，负责理解整批图片目标并拆成每张图的执行方案。",
    "只返回一个 JSON 对象，不要 Markdown 解释；如果必须包裹代码块，也只能包裹 JSON。",
    "不要直接生成图片。首版流程只需要输出方案，用户确认后系统会把任务下发给图片会话。",
    "JSON 字段必须包含 title、globalInstruction、commands。",
    "commands 每项必须包含 targetSessionId、instruction、constraints；targetSessionId 必须来自图片列表。",
    "每张目标图片都应该有一个 command，除非用户明确要求只处理部分图片。",
    selectedOutputSize ? `用户选择的输出分辨率：${selectedOutputSize}` : "用户没有选择输出分辨率，不要自行添加 size 字段。",
    referenceLines.length ? "可用参考图：" : "本轮没有参考图。",
    ...referenceLines,
    "项目图片：",
    ...sessionLines,
    "用户批量要求：",
    input.prompt,
    "返回 JSON 示例：",
    JSON.stringify(schemaExample)
  ].join("\n");
}

function parsePlanJson(content: string): RawBatchPlan {
  const jsonText = extractJsonText(content);

  try {
    const parsed = JSON.parse(jsonText) as RawBatchPlan;

    if (!parsed || typeof parsed !== "object") {
      throw new Error("not object");
    }

    return parsed;
  } catch {
    throw new Error("Esse 未返回有效的批量方案 JSON");
  }
}

function extractJsonText(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return content.slice(start, end + 1);
  }

  return content;
}

function normalizeBatchPlan(
  rawPlan: RawBatchPlan,
  input: ProjectManagerPlanInput,
  selectedOutputSize: string | undefined
): BatchPlan {
  const knownSessionIds = new Set(input.sessions.map((session) => session.id));
  const planId = createId("plan");
  const rawCommands = Array.isArray(rawPlan.commands) ? rawPlan.commands : [];
  const referenceImageIds = (input.referenceImagePaths ?? []).map((_, index) => `ref-${index + 1}`);
  const commands = rawCommands
    .map((command, index) => normalizeWorkerCommand(command, index, planId, knownSessionIds, selectedOutputSize, referenceImageIds))
    .filter((command): command is NonNullable<typeof command> => Boolean(command));

  if (!isNonEmptyString(rawPlan.title) || !isNonEmptyString(rawPlan.globalInstruction) || commands.length === 0) {
    throw new Error("Esse 未返回有效的批量方案 JSON");
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

  const constraints = Array.isArray(command.constraints)
    ? command.constraints.filter(isNonEmptyString).map((constraint) => constraint.trim())
    : [];

  return {
    constraints,
    id: createId(`cmd-${index + 1}`),
    instruction: command.instruction.trim(),
    ...(selectedOutputSize ? { outputSize: selectedOutputSize } : {}),
    planId,
    ...(referenceImageIds.length ? { referenceImageIds } : {}),
    source: "project-manager",
    targetSessionId: command.targetSessionId.trim()
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface PiLogState {
  hasPublishedMessageUpdate: boolean;
}

function logPiEvent(event: unknown, logger: AppLogger | undefined, state: PiLogState): void {
  if (!logger || typeof event !== "object" || event === null || !("type" in event) || typeof event.type !== "string") {
    return;
  }

  if (event.type === "message_update") {
    if (state.hasPublishedMessageUpdate) {
      return;
    }

    state.hasPublishedMessageUpdate = true;
    logger.info("Project manager message update", {
      context: "project-manager",
      publicMessage: "Esse 正在组织方案..."
    });
  }
}
