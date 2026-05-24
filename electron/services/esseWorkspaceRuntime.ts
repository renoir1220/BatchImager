import { randomBytes } from "node:crypto";
import path from "node:path";
import type { EssePreflightPayload, ProjectSnapshot } from "../ipcTypes";
import type {
  EsseBlankSessionRequest,
  EsseWorkspaceToolCallEvent,
  EsseImagePreflightExecutionRequest,
  EssePackagePreflightExecutionRequest,
  EssePreflightDecision,
  EsseWorkspacePermissionDecision,
  EsseWorkspacePermissionRequest,
  EsseWorkspaceToolRuntime,
  WorkspaceMutationResult
} from "./esseWorkspaceTools";
import { createBlankGenerationSeed } from "./blankGenerationSeed";
import type { ProjectMutationSink } from "./projectMutationSink";
import { readProjectImageMetadata } from "./projectImageMetadata";
import { getProjectGeneratedDirectory } from "./projectStore";
import { deleteProjectUnreferencedFiles, scanProjectUnreferencedFiles } from "./projectUnreferencedFiles";

interface ProjectSnapshotWorkspaceRuntimeOptions {
  executeImagePreflightTool?: (
    request: EsseImagePreflightExecutionRequest,
    context: {
      applyMutation: EsseWorkspaceToolRuntime["applyMutation"];
      getState: () => ProjectSnapshot;
    }
  ) => Promise<WorkspaceMutationResult>;
  executePackagePreflightTool?: (
    request: EssePackagePreflightExecutionRequest,
    context: {
      getState: () => ProjectSnapshot;
    }
  ) => Promise<WorkspaceMutationResult>;
  initialSnapshot: ProjectSnapshot;
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
    async applyMutation(mutator) {
      try {
        let committedResult: WorkspaceMutationResult | undefined;
        const committedState = await options.sink.apply((state) => {
          const mutation = mutator(state);
          if (!mutation.result.ok) {
            throw new WorkspaceMutationRejected(mutation.result);
          }
          committedResult = mutation.result;
          return mutation.state;
        });

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
              getState: () => currentSnapshot
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
    ...(options.recordToolCalls
      ? {
          recordToolCall: async (event) => {
            currentSnapshot = await options.sink.apply((state) => appendToolCallMessage(state, event));
          }
        }
      : {}),
    readImageMetadata: (request) => readProjectImageMetadata(currentSnapshot, request),
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

function addBlankSession(
  state: ProjectSnapshot,
  params: { fileName: string; filePath: string; sessionId: string }
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
      summary: `已添加空白图片位：${params.fileName}`
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

function createUniqueSessionId(snapshot: ProjectSnapshot): string {
  const existingIds = new Set(snapshot.sessions.map((session) => session.id));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `sess_${randomBytes(10).toString("hex")}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }

  return `sess_${Date.now()}_${randomBytes(4).toString("hex")}`;
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
            contextType: "esse-tool-call",
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

  return [`Esse 工具调用：${event.toolName}（${status}）`, summary ? `结果：${summary}` : undefined].filter(Boolean).join("\n");
}

function truncateToolText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function createToolCallMessageId(): string {
  return `esse-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
