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

interface CreateEsseImagePreflightExecutorOptions {
  batchTaskRegistry?: Pick<EsseBatchTaskRegistry, "cancelAll" | "notifyItemComplete" | "register">;
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

export function createEsseImagePreflightExecutor(options: CreateEsseImagePreflightExecutorOptions) {
  const createAbortController = options.createAbortController ?? (() => new AbortController());
  const createSeed = options.createSeed ?? createBlankGenerationSeed;
  const makeBatchTaskId = options.makeBatchTaskId ?? createBatchTaskId;
  const makeSessionId = options.makeSessionId ?? createSessionId;

  return async (
    request: EsseImagePreflightExecutionRequest,
    context: EsseImagePreflightExecutionContext
  ): Promise<WorkspaceMutationResult> => {
    const affectedSessionIds: string[] = [];
    const batchTaskId = request.tool === "run_batch_generation" ? makeBatchTaskId() : undefined;
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

    const batchControllers =
      batchTaskId && options.batchTaskRegistry
        ? preparedCommands.map(({ prepared }) => ({
            controller: createAbortController(),
            sessionId: prepared.sessionId
          }))
        : [];
    if (batchTaskId && options.batchTaskRegistry) {
      const registerResult = options.batchTaskRegistry.register({
        batchTaskId,
        items: batchControllers,
        projectDirectory: options.projectDirectory
      });
      if (!registerResult.ok) {
        return { ok: false, reason: registerResult.reason, suggestedNext: "retry the batch generation request." };
      }
    }

    try {
      for (const { command, prepared } of preparedCommands) {
        const batchController = batchControllers.find((item) => item.sessionId === prepared.sessionId)?.controller;
        const cleanupLinkedAbort = linkAbortSignal(options.signal, batchController);
        try {
          const result = await runSharedGenerateImageCore({
            generateImage: options.generateImage,
            imagePath: prepared.imagePath,
            mode: command.mode ?? "generate",
            prompt: command.prompt ?? "",
            referenceImagePaths: prepared.referenceImagePaths,
            sessionId: prepared.sessionId,
            ...(batchController ? { signal: batchController.signal } : {}),
            toolRequestedSize: command.size
          });

          const mutation = await context.applyMutation((state) => appendGeneratedResult(state, {
            outputPath: result.outputPath,
            prompt: command.prompt ?? "",
            sessionId: prepared.sessionId
          }));
          if (!mutation.result.ok) {
            return mutation.result;
          }
          if (prepared.blankSeedPath && prepared.blankSeedPath !== result.outputPath) {
            await unlinkBlankSeedSafely(prepared.blankSeedPath);
          }
          affectedSessionIds.push(prepared.sessionId);
        } finally {
          cleanupLinkedAbort();
          if (batchTaskId) {
            options.batchTaskRegistry?.notifyItemComplete(batchTaskId, prepared.sessionId);
          }
        }
      }
    } finally {
      if (batchTaskId) {
        options.batchTaskRegistry?.cancelAll(batchTaskId);
      }
    }

    return {
      affectedSessionIds,
      ok: true,
      summary: request.tool === "run_batch_generation" ? `已完成 ${affectedSessionIds.length} 个生成任务。` : "图片生成完成。"
    };
  };
}

interface PreparedCommand {
  command: EssePreflightCommand;
  prepared: { blankSeedPath?: string; imagePath: string; ok: true; referenceImagePaths: string[]; sessionId: string };
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

async function unlinkBlankSeedSafely(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // Best-effort cleanup: the generated image has already been committed.
  }
}
