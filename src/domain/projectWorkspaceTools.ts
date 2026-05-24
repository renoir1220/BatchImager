import type { ProjectMutationResult, ProjectState, ReducerResult } from "./projectMutations";
import {
  applyDeleteRecord,
  applyDeleteSession,
  applyMergeSessions,
  applyRenameSession,
  applyReorderSessions,
  applyRestoreOriginal,
  applyRestoreRecord,
  applySetSessionPrompt
} from "./projectMutations";

export interface WorkspaceToolContent {
  text: string;
  type: "text";
}

export interface WorkspaceToolResult {
  content: WorkspaceToolContent[];
  details?: Record<string, unknown>;
  isError?: boolean;
}

export interface ProjectWorkspaceTool {
  description: string;
  execute: (params: Record<string, unknown>) => WorkspaceToolResult;
  label: string;
  name: string;
}

export interface ProjectWorkspaceToolRuntime {
  applyMutation: (mutator: (state: ProjectState) => ProjectMutationResult) => ProjectMutationResult;
  getState: () => ProjectState;
}

export function createProjectWorkspaceTools(runtime: ProjectWorkspaceToolRuntime): ProjectWorkspaceTool[] {
  return [
    createListSessionsTool(runtime),
    createGetSessionRecordsTool(runtime),
    createRestoreSessionRecordTool(runtime),
    createRestoreOriginalTool(runtime),
    createRenameSessionTool(runtime),
    createDeleteSessionRecordTool(runtime),
    createDeleteSessionTool(runtime),
    createMergeSessionsTool(runtime),
    createReorderSessionsTool(runtime),
    createSetSessionPromptTool(runtime)
  ];
}

function createListSessionsTool(runtime: ProjectWorkspaceToolRuntime): ProjectWorkspaceTool {
  return {
    name: "list_sessions",
    label: "列出工作区",
    description:
      "List all image sessions in the current BatchImager project. Returns stable id, displayLabel, fileName, record count, current image status, and generation status.",
    execute: () => {
      const state = runtime.getState();
      return toolOk("已列出工作区图片。", {
        sessions: state.sessions.map((session, index) => ({
          currentImageSource: session.generatedFilePath ? "generated" : "original",
          displayLabel: `img-${index + 1}`,
          fileName: session.fileName,
          generatedRecordCount: session.generatedFilePaths?.length ?? 0,
          id: session.id,
          isSelected: session.id === state.selectedSessionId,
          status: session.status
        }))
      });
    }
  };
}

function createGetSessionRecordsTool(runtime: ProjectWorkspaceToolRuntime): ProjectWorkspaceTool {
  return {
    name: "get_session_records",
    label: "查看图片记录",
    description:
      "Get all generated records for one image session. Use before restore_session_record or delete_session_record when recordIndex is unclear.",
    execute: (params) => {
      const sessionId = readString(params.sessionId);
      if (!sessionId) {
        return toolError("Reason: sessionId is required.\nSuggested next: call list_sessions and pass a stable id.");
      }

      const session = runtime.getState().sessions.find((current) => current.id === sessionId);
      if (!session) {
        return toolError(`Reason: session not found.\nDetail: no session with id ${sessionId}.\nSuggested next: call list_sessions to list current ids.`);
      }

      return toolOk("已列出图片记录。", {
        records: (session.generatedFilePaths ?? []).map((filePath, index) => ({
          fileName: basenameFromPath(filePath),
          isCurrent: filePath === session.generatedFilePath,
          recordIndex: index + 1
        })),
        sessionId
      });
    }
  };
}

function basenameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function createRestoreSessionRecordTool(runtime: ProjectWorkspaceToolRuntime): ProjectWorkspaceTool {
  return mutationTool({
    description: "Restore an image session's current image to a previous generated record. recordIndex is 1-based.",
    label: "回退记录",
    name: "restore_session_record",
    mutate: (state, params) => applyRestoreRecord(state, { sessionId: readString(params.sessionId), recordIndex: readInteger(params.recordIndex) }),
    runtime
  });
}

function createRestoreOriginalTool(runtime: ProjectWorkspaceToolRuntime): ProjectWorkspaceTool {
  return mutationTool({
    description: "Restore an image session to the original imported image. Does not delete generated records.",
    label: "恢复原图",
    name: "restore_original",
    mutate: (state, params) => applyRestoreOriginal(state, { sessionId: readString(params.sessionId) }),
    runtime
  });
}

function createRenameSessionTool(runtime: ProjectWorkspaceToolRuntime): ProjectWorkspaceTool {
  return mutationTool({
    description: "Rename one image session's display fileName. Does not rename files on disk.",
    label: "重命名图片",
    name: "rename_session",
    mutate: (state, params) => applyRenameSession(state, { fileName: readString(params.fileName), sessionId: readString(params.sessionId) }),
    runtime
  });
}

function createDeleteSessionRecordTool(runtime: ProjectWorkspaceToolRuntime): ProjectWorkspaceTool {
  return mutationTool({
    description: "Delete one generated record from an image session by 1-based recordIndex. This is logical deletion and does not remove files from disk.",
    label: "删除记录",
    name: "delete_session_record",
    mutate: (state, params) => applyDeleteRecord(state, { sessionId: readString(params.sessionId), recordIndex: readInteger(params.recordIndex) }),
    runtime
  });
}

function createDeleteSessionTool(runtime: ProjectWorkspaceToolRuntime): ProjectWorkspaceTool {
  return mutationTool({
    description: "Delete one image session from the workspace. This removes workspace references only and does not delete source files from disk.",
    label: "删除图片",
    name: "delete_session",
    mutate: (state, params) => applyDeleteSession(state, { sessionId: readString(params.sessionId) }),
    runtime
  });
}

function createMergeSessionsTool(runtime: ProjectWorkspaceToolRuntime): ProjectWorkspaceTool {
  return mutationTool({
    description: "Merge generated records and chat context from source sessions into a target session, then remove source sessions.",
    label: "合并图片",
    name: "merge_sessions",
    mutate: (state, params) =>
      applyMergeSessions(state, {
        sourceSessionIds: readStringArray(params.sourceSessionIds),
        targetSessionId: readString(params.targetSessionId)
      }),
    runtime
  });
}

function createReorderSessionsTool(runtime: ProjectWorkspaceToolRuntime): ProjectWorkspaceTool {
  return mutationTool({
    description: "Reorder image sessions. sessionIds must be a full permutation of the current stable ids.",
    label: "调整顺序",
    name: "reorder_sessions",
    mutate: (state, params) => applyReorderSessions(state, { sessionIds: readStringArray(params.sessionIds) }),
    runtime
  });
}

function createSetSessionPromptTool(runtime: ProjectWorkspaceToolRuntime): ProjectWorkspaceTool {
  return mutationTool({
    description: "Set the default prompt for one image session. Does not generate an image.",
    label: "设置提示词",
    name: "set_session_prompt",
    mutate: (state, params) => applySetSessionPrompt(state, { sessionId: readString(params.sessionId), prompt: readString(params.prompt) }),
    runtime
  });
}

function mutationTool(options: {
  description: string;
  label: string;
  mutate: (state: ProjectState, params: Record<string, unknown>) => ProjectMutationResult;
  name: string;
  runtime: ProjectWorkspaceToolRuntime;
}): ProjectWorkspaceTool {
  return {
    name: options.name,
    label: options.label,
    description: options.description,
    execute: (params) => {
      const mutation = options.runtime.applyMutation((state) => options.mutate(state, params));
      if (!mutation.result.ok) {
        return reducerError(mutation.result);
      }

      return toolOk(mutation.result.summary, {
        affectedSessionIds: mutation.result.affectedSessionIds
      });
    }
  };
}

function reducerError(result: Extract<ReducerResult, { ok: false }>): WorkspaceToolResult {
  return toolError(
    [
      `Reason: ${result.reason}.`,
      result.detail ? `Detail: ${result.detail}` : undefined,
      result.suggestedNext ? `Suggested next: ${result.suggestedNext}` : undefined
    ]
      .filter(Boolean)
      .join("\n")
  );
}

function toolOk(text: string, details?: Record<string, unknown>): WorkspaceToolResult {
  return {
    content: [{ type: "text", text }],
    ...(details ? { details } : {})
  };
}

function toolError(text: string): WorkspaceToolResult {
  return {
    content: [{ type: "text", text }],
    isError: true
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function readInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : Number.NaN;
}
