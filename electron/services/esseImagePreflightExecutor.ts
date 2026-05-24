import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import type { EssePreflightCommand, PersistedImageSession, ProjectSnapshot } from "../ipcTypes";
import { createBlankGenerationSeed } from "./blankGenerationSeed";
import type { ImageGenerationExecutor } from "./imageGenerationService";
import { getProjectGeneratedDirectory } from "./projectStore";
import type { EsseImagePreflightExecutionRequest, EsseWorkspaceToolRuntime, WorkspaceMutationResult } from "./esseWorkspaceTools";
import { runSharedGenerateImageCore } from "./sharedGenerateImageCore";
import type { EsseBatchTaskRegistry } from "./esseBatchTaskRegistry";

export interface CreateEsseImagePreflightExecutorOptions {
  batchTaskRegistry?: Pick<EsseBatchTaskRegistry, "notifyItemComplete" | "recordRetry" | "register" | "registerItem">;
  createAbortController?: () => AbortController;
  createSeed?: (options: { outputDirectory: string; sessionId: string; size?: string }) => Promise<string>;
  generateImage: ImageGenerationExecutor;
  makeBatchTaskId?: () => string;
  makeSessionId?: () => string;
  projectDirectory: string;
  signal?: AbortSignal;
}

interface EsseImagePreflightExecutionContext {
  applyMutation: EsseWorkspaceToolRuntime["applyMutation"];
  getState: () => ProjectSnapshot;
}

export type EsseBatchTaskRetryResult =
  | { accepted: true; retryCount: number; sessionId: string }
  | { accepted: false; reason: string };

export function createEsseImagePreflightExecutor(options: CreateEsseImagePreflightExecutorOptions) {
  const createAbortController = options.createAbortController ?? (() => new AbortController());
  const createSeed = options.createSeed ?? createBlankGenerationSeed;
  const makeBatchTaskId = options.makeBatchTaskId ?? createBatchTaskId;
  const makeSessionId = options.makeSessionId ?? createSessionId;

  return async (
    request: EsseImagePreflightExecutionRequest,
    context: EsseImagePreflightExecutionContext
  ): Promise<WorkspaceMutationResult> => {
    const batchTaskId = makeBatchTaskId();
    const preparedCommands: PreparedCommand[] = [];

    for (const command of request.commands) {
      const prepared = await prepareCommand(command, context, {
        createSeed,
        makeSessionId,
        projectDirectory: options.projectDirectory
      });
      if (!prepared.ok) {
        return prepared;
      }
      preparedCommands.push({ command, prepared });
    }

    const batchControllers = preparedCommands.map(({ prepared }) => ({
      controller: createAbortController(),
      sessionId: prepared.sessionId
    }));
    if (options.batchTaskRegistry) {
      const registerResult = options.batchTaskRegistry.register({
        batchTaskId,
        items: batchControllers,
        projectDirectory: options.projectDirectory
      });
      if (!registerResult.ok) {
        return { ok: false, reason: registerResult.reason, suggestedNext: "retry the batch generation request." };
      }
    }

    const affectedSessionIds = preparedCommands.map(({ prepared }) => prepared.sessionId);
    const queuedMutation = await context.applyMutation((state) =>
      appendBatchTaskCardMessage(markSessionsQueued(state, affectedSessionIds).state, {
        batchTaskId,
        preparedCommands
      })
    );
    if (!queuedMutation.result.ok) {
      return queuedMutation.result;
    }

    for (const { command, prepared } of preparedCommands) {
      const batchController = batchControllers.find((item) => item.sessionId === prepared.sessionId)?.controller;
      void runPreparedGeneration({
        batchController,
        batchTaskId,
        command,
        context,
        options,
        prepared
      });
    }

    return {
      affectedSessionIds,
      ok: true,
      summary: `已提交 ${affectedSessionIds.length} 个生成任务。完成后会自动出现在工作区。`
    };
  };
}

export async function retryEsseBatchTaskItem(
  request: { batchTaskId: string; sessionId: string },
  options: CreateEsseImagePreflightExecutorOptions,
  context: EsseImagePreflightExecutionContext
): Promise<EsseBatchTaskRetryResult> {
  const cardItem = findBatchTaskCardItem(context.getState(), request);
  if (!cardItem) {
    return { accepted: false, reason: "batch task item not found" };
  }

  const session = context.getState().sessions.find((current) => current.id === request.sessionId);
  if (!session) {
    return { accepted: false, reason: "session not found" };
  }
  if (session.status !== "failed") {
    return { accepted: false, reason: "session is not in failed state" };
  }

  const retryResult = options.batchTaskRegistry?.recordRetry(request.batchTaskId, request.sessionId);
  if (retryResult && !retryResult.ok) {
    return { accepted: false, reason: retryResult.reason };
  }

  const command: EssePreflightCommand = {
    ...cardItem.command,
    mode: cardItem.mode,
    target: { sessionId: request.sessionId, type: "existing" }
  };
  const prepared = await prepareCommand(command, context, {
    createSeed: options.createSeed ?? createBlankGenerationSeed,
    makeSessionId: options.makeSessionId ?? createSessionId,
    projectDirectory: options.projectDirectory
  });
  if (!prepared.ok) {
    return { accepted: false, reason: prepared.reason };
  }

  const controller = (options.createAbortController ?? (() => new AbortController()))();
  const registerResult = options.batchTaskRegistry?.registerItem(request.batchTaskId, {
    controller,
    retryCount: retryResult?.retryCount,
    sessionId: request.sessionId
  }, options.projectDirectory);
  if (registerResult && !registerResult.ok) {
    return { accepted: false, reason: registerResult.reason };
  }

  const mutation = await context.applyMutation((state) => markSessionsQueued(state, [request.sessionId]));
  if (!mutation.result.ok) {
    return { accepted: false, reason: mutation.result.reason };
  }

  void runPreparedGeneration({
    batchController: controller,
    batchTaskId: request.batchTaskId,
    command,
    context,
    options,
    prepared
  });

  return {
    accepted: true,
    retryCount: retryResult?.retryCount ?? 1,
    sessionId: request.sessionId
  };
}

interface PreparedCommand {
  command: EssePreflightCommand;
  prepared: { blankSeedPath?: string; imagePath: string; ok: true; referenceImagePaths: string[]; sessionId: string };
}

async function runPreparedGeneration(params: {
  batchController: AbortController | undefined;
  batchTaskId: string;
  command: EssePreflightCommand;
  context: EsseImagePreflightExecutionContext;
  options: CreateEsseImagePreflightExecutorOptions;
  prepared: PreparedCommand["prepared"];
}): Promise<void> {
  const cleanupLinkedAbort = linkAbortSignal(params.options.signal, params.batchController);
  try {
    await params.context.applyMutation((state) => markSessionGenerating(state, params.prepared.sessionId));
    const result = await runSharedGenerateImageCore({
      generateImage: params.options.generateImage,
      imagePath: params.prepared.imagePath,
      mode: params.command.mode ?? "generate",
      prompt: params.command.prompt ?? "",
      referenceImagePaths: params.prepared.referenceImagePaths,
      sessionId: params.prepared.sessionId,
      ...(params.batchController ? { signal: params.batchController.signal } : {}),
      toolRequestedSize: params.command.size
    });

    const mutation = await params.context.applyMutation((state) => appendGeneratedResult(state, {
      outputPath: result.outputPath,
      prompt: params.command.prompt ?? "",
      sessionId: params.prepared.sessionId
    }));
    if (mutation.result.ok && params.prepared.blankSeedPath && params.prepared.blankSeedPath !== result.outputPath) {
      await unlinkBlankSeedSafely(params.prepared.blankSeedPath);
    }
  } catch (error) {
    await params.context.applyMutation((state) => markSessionFailed(state, {
      errorMessage: params.batchController?.signal.aborted ? "已取消" : toErrorMessage(error),
      sessionId: params.prepared.sessionId
    }));
  } finally {
    cleanupLinkedAbort();
    params.options.batchTaskRegistry?.notifyItemComplete(params.batchTaskId, params.prepared.sessionId);
  }
}

async function prepareCommand(
  command: EssePreflightCommand,
  context: EsseImagePreflightExecutionContext,
  options: {
    createSeed: (input: { outputDirectory: string; sessionId: string; size?: string }) => Promise<string>;
    makeSessionId: () => string;
    projectDirectory: string;
  }
): Promise<
  | { blankSeedPath?: string; imagePath: string; ok: true; referenceImagePaths: string[]; sessionId: string }
  | Extract<WorkspaceMutationResult, { ok: false }>
> {
  if (!command.mode || !command.prompt) {
    return { ok: false, reason: "invalid generation command", suggestedNext: "provide mode and prompt for every command." };
  }

  const mode = command.mode;
  const referenceImagePaths = selectReferenceImagePaths(command.referenceImageIds, context.getState());
  if (command.target?.type === "existing") {
    const session = context.getState().sessions.find((current) => current.id === command.target?.sessionId);
    if (!session) {
      return {
        ok: false,
        reason: "session not found",
        detail: `no session with id ${command.target.sessionId}`,
        suggestedNext: "call list_sessions to list current ids."
      };
    }
    return {
      imagePath: mode === "edit" ? getCurrentImagePath(session) : session.filePath,
      ok: true,
      referenceImagePaths,
      sessionId: session.id
    };
  }

  const sessionId = createUniqueSessionId(context.getState(), options.makeSessionId);
  const seedPath = await options.createSeed({
    outputDirectory: getProjectGeneratedDirectory(options.projectDirectory),
    sessionId,
    ...(command.size ? { size: command.size } : {})
  });
  const mutation = await context.applyMutation((state) => addNewSession(state, {
    fileName: command.target?.fileName || path.basename(seedPath),
    filePath: seedPath,
    generationMode: mode,
    sessionId
  }));
  if (!mutation.result.ok) {
    return mutation.result;
  }

  return {
    blankSeedPath: seedPath,
    imagePath: seedPath,
    ok: true,
    referenceImagePaths,
    sessionId
  };
}

function addNewSession(
  state: ProjectSnapshot,
  params: { fileName: string; filePath: string; generationMode: "edit" | "generate"; sessionId: string }
): { result: WorkspaceMutationResult; state: ProjectSnapshot } {
  if (state.sessions.some((session) => session.id === params.sessionId)) {
    return {
      result: {
        ok: false,
        reason: "sessionId must be unique",
        suggestedNext: "retry with a new generated session id."
      },
      state
    };
  }

  const session: PersistedImageSession = {
    chatMessages: [],
    chatStatus: "idle",
    fileName: params.fileName,
    filePath: params.filePath,
    generationMode: params.generationMode,
    id: params.sessionId,
    originatedFromGeneration: true,
    status: "queued"
  };

  return {
    result: { affectedSessionIds: [params.sessionId], ok: true, summary: "已创建新图占位。" },
    state: {
      ...state,
      project: { ...state.project, imageCount: state.sessions.length + 1 },
      selectedSessionId: params.sessionId,
      sessions: [...state.sessions, session]
    }
  };
}

function appendGeneratedResult(
  state: ProjectSnapshot,
  params: { outputPath: string; prompt: string; sessionId: string }
): { result: WorkspaceMutationResult; state: ProjectSnapshot } {
  const session = state.sessions.find((current) => current.id === params.sessionId);
  if (!session) {
    return {
      result: {
        ok: false,
        reason: "session not found",
        detail: `no session with id ${params.sessionId}`,
        suggestedNext: "call list_sessions to list current ids."
      },
      state
    };
  }

  return {
    result: { affectedSessionIds: [params.sessionId], ok: true, summary: "已写入生成结果。" },
    state: {
      ...state,
      sessions: state.sessions.map((current) =>
        current.id === params.sessionId
          ? {
              ...current,
              chatMessages: [
                ...current.chatMessages,
                {
                  content: params.prompt ? `Esse 生成完成：${params.prompt}` : "Esse 生成完成。",
                  contextType: "generated-image",
                  generatedFilePath: params.outputPath,
                  id: createMessageId("esse-generated"),
                  role: "context"
                }
              ],
              filePath:
                current.originatedFromGeneration && !(current.generatedFilePaths?.length)
                  ? params.outputPath
                  : current.filePath,
              generatedFilePath: params.outputPath,
              generatedFilePaths: appendUnique(current.generatedFilePaths, params.outputPath),
              showOriginalInList: false,
              status: "completed"
            }
          : current
      )
    }
  };
}

function markSessionsQueued(
  state: ProjectSnapshot,
  sessionIds: string[]
): { result: WorkspaceMutationResult; state: ProjectSnapshot } {
  return {
    result: { affectedSessionIds: sessionIds, ok: true, summary: "已提交生成任务。" },
    state: {
      ...state,
      sessions: state.sessions.map((session) =>
        sessionIds.includes(session.id)
          ? {
              ...session,
              errorMessage: undefined,
              status: "queued"
            }
          : session
      )
    }
  };
}

function appendBatchTaskCardMessage(
  state: ProjectSnapshot,
  params: { batchTaskId: string; preparedCommands: PreparedCommand[] }
): { result: WorkspaceMutationResult; state: ProjectSnapshot } {
  if (!state.projectManagerState) {
    return {
      result: {
        affectedSessionIds: params.preparedCommands.map(({ prepared }) => prepared.sessionId),
        ok: true,
        summary: "已提交生成任务。"
      },
      state
    };
  }

  const sessionsById = new Map(state.sessions.map((session) => [session.id, session]));
  const items = params.preparedCommands.map(({ command, prepared }) => {
    const session = sessionsById.get(prepared.sessionId);
    return {
      command,
      displayLabel: command.displayLabel || command.target?.fileName || session?.fileName || prepared.sessionId,
      mode: command.mode ?? "generate",
      promptSummary: summarizePrompt(command.prompt ?? ""),
      sessionId: prepared.sessionId
    };
  });

  return {
    result: {
      affectedSessionIds: params.preparedCommands.map(({ prepared }) => prepared.sessionId),
      ok: true,
      summary: "已提交生成任务。"
    },
    state: {
      ...state,
      projectManagerState: {
        ...state.projectManagerState,
        conversation: {
          ...state.projectManagerState.conversation,
          messages: [
            ...state.projectManagerState.conversation.messages,
            {
              batchTask: {
                batchTaskId: params.batchTaskId,
                items
              },
              content: "",
              contextType: "esse-batch-task",
              id: createMessageId("esse-batch-task"),
              role: "context"
            }
          ]
        }
      }
    }
  };
}

function markSessionGenerating(
  state: ProjectSnapshot,
  sessionId: string
): { result: WorkspaceMutationResult; state: ProjectSnapshot } {
  return {
    result: { affectedSessionIds: [sessionId], ok: true, summary: "图片生成中。" },
    state: {
      ...state,
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              errorMessage: undefined,
              status: "generating"
            }
          : session
      )
    }
  };
}

function markSessionFailed(
  state: ProjectSnapshot,
  params: { errorMessage: string; sessionId: string }
): { result: WorkspaceMutationResult; state: ProjectSnapshot } {
  return {
    result: { affectedSessionIds: [params.sessionId], ok: true, summary: "图片生成失败。" },
    state: {
      ...state,
      sessions: state.sessions.map((session) =>
        session.id === params.sessionId
          ? {
              ...session,
              errorMessage: params.errorMessage,
              status: "failed"
            }
          : session
      )
    }
  };
}

function selectReferenceImagePaths(referenceImageIds: string[] | undefined, state: ProjectSnapshot): string[] {
  if (!referenceImageIds?.length) {
    return [];
  }

  const byId = new Map<string, string>();
  for (const plan of state.projectManagerState?.plans ?? []) {
    for (const referenceImage of plan.referenceImages ?? []) {
      byId.set(referenceImage.id, referenceImage.filePath);
    }
  }

  return [...new Set(referenceImageIds.map((id) => byId.get(id)).filter((filePath): filePath is string => Boolean(filePath)))];
}

function findBatchTaskCardItem(
  state: ProjectSnapshot,
  request: { batchTaskId: string; sessionId: string }
) {
  for (const message of state.projectManagerState?.conversation.messages ?? []) {
    if (message.batchTask?.batchTaskId !== request.batchTaskId) {
      continue;
    }

    const item = message.batchTask.items.find((current) => current.sessionId === request.sessionId);
    if (item) {
      return item;
    }
  }

  return undefined;
}

function getCurrentImagePath(session: PersistedImageSession): string {
  return session.showOriginalInList ? session.filePath : session.generatedFilePath ?? session.filePath;
}

function appendUnique(paths: string[] | undefined, filePath: string): string[] {
  return [...(paths ?? []).filter((current) => current !== filePath), filePath];
}

function createUniqueSessionId(state: ProjectSnapshot, makeSessionId: () => string): string {
  const used = new Set(state.sessions.map((session) => session.id));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const sessionId = makeSessionId();
    if (!used.has(sessionId)) {
      return sessionId;
    }
  }

  let fallbackIndex = state.sessions.length + 1;
  let fallbackId = `sess_fallback_${fallbackIndex}`;
  while (used.has(fallbackId)) {
    fallbackIndex += 1;
    fallbackId = `sess_fallback_${fallbackIndex}`;
  }
  return fallbackId;
}

function createSessionId(): string {
  return `sess_${randomBytes(10).toString("hex")}`;
}

function createBatchTaskId(): string {
  return `esse_batch_${randomBytes(10).toString("hex")}`;
}

function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function linkAbortSignal(parentSignal: AbortSignal | undefined, childController: AbortController | undefined): () => void {
  if (!parentSignal || !childController) {
    return () => undefined;
  }

  if (parentSignal.aborted) {
    childController.abort();
    return () => undefined;
  }

  const abortChild = () => {
    childController.abort();
  };
  parentSignal.addEventListener("abort", abortChild, { once: true });
  return () => {
    parentSignal.removeEventListener("abort", abortChild);
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizePrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
}

async function unlinkBlankSeedSafely(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // Best-effort cleanup: the generated image has already been committed.
  }
}
