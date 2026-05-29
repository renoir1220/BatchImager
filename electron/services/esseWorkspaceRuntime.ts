import { randomBytes } from "node:crypto";
import { copyFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { EssePreflightPayload, ProjectSnapshot } from "../ipcTypes";
import type {
  EsseAddReferenceImageRequest,
  EsseAddWorkspaceImageRequest,
  EsseBlankSessionRequest,
  EsseWorkspaceToolCallEvent,
  EsseImagePreflightExecutionRequest,
  EssePackagePreflightExecutionRequest,
  EssePreflightDecision,
  EsseRemoveReferenceImageRequest,
  EsseWorkspacePermissionDecision,
  EsseWorkspacePermissionRequest,
  EsseWorkspaceToolRuntime,
  WorkspaceMutationResult
} from "./esseWorkspaceTools";
import { createBlankGenerationSeed } from "./blankGenerationSeed";
import type { EsseMemoryStore } from "./esseMemoryStore";
import type { ProjectMutationSink } from "./projectMutationSink";
import { readProjectImageMetadata } from "./projectImageMetadata";
import { getProjectGeneratedDirectory, getProjectReferencesDirectory } from "./projectStore";
import { deleteProjectUnreferencedFiles, scanProjectUnreferencedFiles } from "./projectUnreferencedFiles";

interface ProjectSnapshotWorkspaceRuntimeOptions {
  executeImagePreflightTool?: (
    request: EsseImagePreflightExecutionRequest,
    context: {
      applyMutation: EsseWorkspaceToolRuntime["applyMutation"];
      getState: () => ProjectSnapshot;
      getTurnReferenceImagePaths?: () => string[];
    }
  ) => Promise<WorkspaceMutationResult>;
  executePackagePreflightTool?: (
    request: EssePackagePreflightExecutionRequest,
    context: {
      getState: () => ProjectSnapshot;
    }
  ) => Promise<WorkspaceMutationResult>;
  initialSnapshot: ProjectSnapshot;
  getTurnReferenceImagePaths?: () => string[];
  memoryStore?: EsseMemoryStore;
  recordToolCalls?: boolean;
  requestPermission?: (request: EsseWorkspacePermissionRequest) => Promise<EsseWorkspacePermissionDecision>;
  requestPreflight?: (payload: EssePreflightPayload) => Promise<EssePreflightDecision>;
  sink: ProjectMutationSink<ProjectSnapshot>;
}

class WorkspaceMutationRejected extends Error {
  constructor(
    readonly result: {
      detail?: string;
      ok: false;
      reason: string;
      suggestedNext?: string;
    }
  ) {
    super(result.reason);
  }
}

export function createProjectSnapshotWorkspaceRuntime(options: ProjectSnapshotWorkspaceRuntimeOptions): EsseWorkspaceToolRuntime {
  let currentSnapshot = options.initialSnapshot;

  const runtime: EsseWorkspaceToolRuntime = {
    addReferenceImage: async (request) => addReferenceImage(runtime, request, () => currentSnapshot),
    addWorkspaceImage: async (request) => addWorkspaceImage(runtime, request, () => currentSnapshot),
    async applyMutation(mutator, applyOptions) {
      try {
        let committedResult: WorkspaceMutationResult | undefined;
        const committedState = await options.sink.apply((state) => {
          const mutation = mutator(state);
          if (!mutation.result.ok) {
            throw new WorkspaceMutationRejected(mutation.result);
          }
          committedResult = mutation.result;
          return mutation.state;
        }, applyOptions);

        currentSnapshot = committedState;
        return { result: committedResult!, state: currentSnapshot };
      } catch (error) {
        if (error instanceof WorkspaceMutationRejected) {
          return { result: error.result, state: currentSnapshot };
        }
        throw error;
      }
    },
    createBlankSession: async (request) => createBlankSession(runtime, request, () => currentSnapshot),
    deleteUnreferencedFiles: (candidateIds) => deleteProjectUnreferencedFiles(currentSnapshot, candidateIds),
    ...(options.executeImagePreflightTool
      ? {
          executeImagePreflightTool: (request) =>
            options.executeImagePreflightTool?.(request, {
              applyMutation: (mutator) => runtime.applyMutation(mutator),
              getState: () => currentSnapshot,
              ...(options.getTurnReferenceImagePaths ? { getTurnReferenceImagePaths: options.getTurnReferenceImagePaths } : {})
            }) ?? Promise.resolve({ ok: false, reason: "image execution unavailable" })
        }
      : {}),
    ...(options.executePackagePreflightTool
      ? {
          executePackagePreflightTool: (request) =>
            options.executePackagePreflightTool?.(request, {
              getState: () => currentSnapshot
            }) ?? Promise.resolve({ ok: false, reason: "package execution unavailable" })
        }
      : {}),
    getState: () => currentSnapshot,
    getSinkRevision: () => options.sink.getRevision(),
    ...(options.getTurnReferenceImagePaths ? { getTurnReferenceImagePaths: options.getTurnReferenceImagePaths } : {}),
    ...(options.memoryStore ? { memoryStore: options.memoryStore } : {}),
    ...(options.recordToolCalls
      ? {
          recordToolCall: async (event) => {
            currentSnapshot = await options.sink.apply((state) => appendToolCallMessage(state, event), { countRevision: false });
          }
        }
      : {}),
    readImageMetadata: (request) => readProjectImageMetadata(currentSnapshot, request),
    removeReferenceImage: async (request) => removeReferenceImage(runtime, request, () => currentSnapshot),
    requestPermission: options.requestPermission ?? allowWorkspaceToolPermission,
    ...(options.requestPreflight ? { requestPreflight: options.requestPreflight } : {}),
    scanUnreferencedFiles: () => scanProjectUnreferencedFiles(currentSnapshot)
  };

  return runtime;
}

async function allowWorkspaceToolPermission(): Promise<EsseWorkspacePermissionDecision> {
  return { decision: "allow" };
}

async function createBlankSession(
  runtime: EsseWorkspaceToolRuntime,
  request: EsseBlankSessionRequest,
  getSnapshot: () => ProjectSnapshot
): Promise<WorkspaceMutationResult> {
  const snapshot = getSnapshot();
  const sessionId = createUniqueSessionId(snapshot);
  const seedPath = await createBlankGenerationSeed({
    outputDirectory: getProjectGeneratedDirectory(snapshot.project.directory),
    sessionId
  });
  const mutation = await runtime.applyMutation((state) => addBlankSession(state, {
    fileName: request.fileName || path.basename(seedPath),
    filePath: seedPath,
    sessionId
  }));

  return mutation.result;
}

async function addWorkspaceImage(
  runtime: EsseWorkspaceToolRuntime,
  request: EsseAddWorkspaceImageRequest,
  getSnapshot: () => ProjectSnapshot
): Promise<WorkspaceMutationResult> {
  if (request.images.length === 0) {
    return { ok: false, reason: "images are required", suggestedNext: "Pass one or more image file paths." };
  }

  for (const image of request.images) {
    if (!isSupportedReferenceImagePath(image.filePath)) {
      return { ok: false, detail: image.filePath, reason: "unsupported image type", suggestedNext: "Use supported image files." };
    }
  }

  const snapshot = getSnapshot();
  const destinationDirectory = path.join(snapshot.project.directory, "images", "original");
  const reservedSessionIds = new Set<string>();
  const plannedImages: Array<{ fileName: string; filePath: string; sessionId: string }> = [];
  const copiedPaths: string[] = [];

  await mkdir(destinationDirectory, { recursive: true });
  try {
    for (const image of request.images) {
      const sourcePath = path.resolve(image.filePath);
      const sessionId = createUniqueSessionId(snapshot, reservedSessionIds);
      reservedSessionIds.add(sessionId);
      const displayFileName = image.fileName?.trim() || path.basename(sourcePath) || "image.png";
      const destinationPath = path.join(destinationDirectory, `${sessionId}-${toSafeWorkspaceImageFileName(displayFileName, path.extname(sourcePath))}`);

      await copyFile(sourcePath, destinationPath);
      copiedPaths.push(destinationPath);
      plannedImages.push({
        fileName: displayFileName,
        filePath: destinationPath,
        sessionId
      });
    }
  } catch (error) {
    await Promise.all(copiedPaths.map(unlinkIfExists));
    throw error;
  }

  const mutation = await runtime.applyMutation((state) => addImageSessions(state, plannedImages));

  if (!mutation.result.ok) {
    await Promise.all(copiedPaths.map(unlinkIfExists));
  }

  return mutation.result;
}

async function addReferenceImage(
  runtime: EsseWorkspaceToolRuntime,
  request: EsseAddReferenceImageRequest,
  getSnapshot: () => ProjectSnapshot
): Promise<WorkspaceMutationResult> {
  if (!isSupportedReferenceImagePath(request.filePath)) {
    return { ok: false, reason: "unsupported reference image type", suggestedNext: "Use a supported image file." };
  }

  const snapshot = getSnapshot();
  const sourcePath = path.resolve(request.filePath);
  const referenceDirectory = getProjectReferencesDirectory(snapshot.project.directory);
  const referenceId = createUniqueReferenceImageId(snapshot);
  const displayFileName = request.fileName?.trim() || path.basename(request.filePath) || "reference.png";
  const destinationPath = path.join(referenceDirectory, `${referenceId}-${toSafeReferenceFileName(displayFileName)}`);

  await mkdir(referenceDirectory, { recursive: true });
  await copyFile(sourcePath, destinationPath);

  const mutation = await runtime.applyMutation((state) => {
    if (state.referenceImages?.some((referenceImage) => referenceImage.id === referenceId)) {
      return {
        result: {
          ok: false,
          reason: "referenceImageId must be unique",
          suggestedNext: "retry with a new generated reference id."
        },
        state
      };
    }

    const nextReference = {
      filePath: destinationPath,
      id: referenceId,
      label: displayFileName
    };

    return {
      result: {
        affectedSessionIds: [],
        ok: true,
        summary: `已添加参考图：${displayFileName}`
      },
      state: {
        ...state,
        referenceImages: [...(state.referenceImages ?? []), nextReference]
      }
    };
  });

  if (!mutation.result.ok) {
    await unlinkIfExists(destinationPath);
  }

  return mutation.result;
}

async function removeReferenceImage(
  runtime: EsseWorkspaceToolRuntime,
  request: EsseRemoveReferenceImageRequest,
  getSnapshot: () => ProjectSnapshot
): Promise<WorkspaceMutationResult> {
  const referenceImage = getSnapshot().referenceImages?.find((current) => current.id === request.referenceImageId);
  if (!referenceImage) {
    return {
      ok: false,
      reason: "reference image not found",
      suggestedNext: "call list_reference_images and pass one returned referenceImageId."
    };
  }

  await unlinkIfExists(referenceImage.filePath);

  const mutation = await runtime.applyMutation((state) => {
    if (!state.referenceImages?.some((current) => current.id === request.referenceImageId)) {
      return {
        result: {
          ok: false,
          reason: "reference image not found",
          suggestedNext: "call list_reference_images and pass one returned referenceImageId."
        },
        state
      };
    }

    return {
      result: {
        affectedSessionIds: [],
        ok: true,
        summary: `已删除参考图：${referenceImage.label}`
      },
      state: {
        ...state,
        referenceImages: state.referenceImages.filter((current) => current.id !== request.referenceImageId)
      }
    };
  });

  return mutation.result;
}

function addBlankSession(
  state: ProjectSnapshot,
  params: { fileName: string; filePath: string; sessionId: string }
): { result: WorkspaceMutationResult; state: ProjectSnapshot } {
  return addImageSession(state, params, `已添加空白图片位：${params.fileName}`);
}

function addImageSession(
  state: ProjectSnapshot,
  params: { fileName: string; filePath: string; sessionId: string },
  summary = `已添加图片到工作区：${params.fileName}`
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

  return {
    result: {
      affectedSessionIds: [params.sessionId],
      ok: true,
      summary
    },
    state: {
      ...state,
      project: { ...state.project, imageCount: state.sessions.length + 1 },
      selectedSessionId: params.sessionId,
      sessions: [
        ...state.sessions,
        {
          chatMessages: [],
          chatStatus: "idle",
          fileName: params.fileName,
          filePath: params.filePath,
          id: params.sessionId,
          status: "idle"
        }
      ]
    }
  };
}

function addImageSessions(
  state: ProjectSnapshot,
  images: Array<{ fileName: string; filePath: string; sessionId: string }>
): { result: WorkspaceMutationResult; state: ProjectSnapshot } {
  const existingIds = new Set(state.sessions.map((session) => session.id));
  const newIds = new Set<string>();
  for (const image of images) {
    if (existingIds.has(image.sessionId) || newIds.has(image.sessionId)) {
      return {
        result: {
          ok: false,
          reason: "sessionId must be unique",
          suggestedNext: "retry with new generated session ids."
        },
        state
      };
    }
    newIds.add(image.sessionId);
  }

  const affectedSessionIds = images.map((image) => image.sessionId);
  return {
    result: {
      affectedSessionIds,
      ok: true,
      summary: formatWorkspaceImageAddSummary(images.map((image) => image.fileName))
    },
    state: {
      ...state,
      project: { ...state.project, imageCount: state.sessions.length + images.length },
      selectedSessionId: affectedSessionIds.at(-1) ?? state.selectedSessionId,
      sessions: [
        ...state.sessions,
        ...images.map((image) => ({
          chatMessages: [],
          chatStatus: "idle" as const,
          fileName: image.fileName,
          filePath: image.filePath,
          id: image.sessionId,
          status: "idle" as const
        }))
      ]
    }
  };
}

function formatWorkspaceImageAddSummary(fileNames: string[]): string {
  if (fileNames.length === 1) {
    return `已添加图片到工作区：${fileNames[0]}`;
  }

  const preview = fileNames.slice(0, 5).join("、");
  const suffix = fileNames.length > 5 ? " 等" : "";
  return `已添加 ${fileNames.length} 张图片到工作区：${preview}${suffix}`;
}

function createUniqueSessionId(snapshot: ProjectSnapshot, reservedIds: Set<string> = new Set()): string {
  const existingIds = new Set([...snapshot.sessions.map((session) => session.id), ...reservedIds]);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `sess_${randomBytes(10).toString("hex")}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }

  return `sess_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function createUniqueReferenceImageId(snapshot: ProjectSnapshot): string {
  const existingIds = new Set((snapshot.referenceImages ?? []).map((referenceImage) => referenceImage.id));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `ref_${randomBytes(8).toString("hex")}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }

  return `ref_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function isSupportedReferenceImagePath(filePath: string): boolean {
  return /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i.test(filePath);
}

function toSafeWorkspaceImageFileName(fileName: string, fallbackExtension: string): string {
  const extension = path.extname(fileName) || fallbackExtension || ".png";
  const baseName = path.basename(fileName, path.extname(fileName));
  const safeBaseName =
    baseName
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "image";
  return `${safeBaseName}${extension.toLowerCase()}`;
}

function toSafeReferenceFileName(fileName: string): string {
  const extension = path.extname(fileName) || ".png";
  const baseName = path.basename(fileName, path.extname(fileName));
  const safeBaseName =
    baseName
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "reference";
  return `${safeBaseName}${extension.toLowerCase()}`;
}

async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function appendToolCallMessage(state: ProjectSnapshot, event: EsseWorkspaceToolCallEvent): ProjectSnapshot {
  const projectManagerState = state.projectManagerState ?? {
    conversation: { id: "project-manager", messages: [] },
    plans: []
  };

  return {
    ...state,
    projectManagerState: {
      ...projectManagerState,
      conversation: {
        ...projectManagerState.conversation,
        messages: [
          ...projectManagerState.conversation.messages,
          {
            content: formatToolCallMessage(event),
            contextType: "agent-tool-call",
            id: createToolCallMessageId(),
            role: "context"
          }
        ]
      }
    }
  };
}

function formatToolCallMessage(event: EsseWorkspaceToolCallEvent): string {
  const status = event.result.isError ? "失败" : "完成";
  const summary = truncateToolText(event.result.content[0]?.text ?? "");

  return [`智能体工具调用：${event.toolName}（${status}）`, summary ? `结果：${summary}` : undefined].filter(Boolean).join("\n");
}

function truncateToolText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function createToolCallMessageId(): string {
  return `esse-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
