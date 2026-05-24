import type { EssePreflightCommand, EssePreflightPayload, PersistedImageSession, ProjectSnapshot } from "../ipcTypes";
import type { AgentToolResult, BatchImagerAgentTool, BatchImagerAgentToolRisk } from "./batchImagerAgentTools";
import type { ProjectImageMetadataResult } from "./projectImageMetadata";
import type { DeleteUnreferencedFileResult, UnreferencedFileCandidate } from "./projectUnreferencedFiles";

export type EsseWorkspaceState = ProjectSnapshot;

export interface EsseWorkspaceToolRuntime {
  applyMutation: (mutator: (state: EsseWorkspaceState) => { result: WorkspaceMutationResult; state: EsseWorkspaceState }) => Promise<{
    result: WorkspaceMutationResult;
    state: EsseWorkspaceState;
  }>;
  deleteUnreferencedFiles?: (candidateIds: string[]) => Promise<DeleteUnreferencedFileResult[]>;
  createBlankSession?: (request: EsseBlankSessionRequest) => Promise<WorkspaceMutationResult>;
  executeImagePreflightTool?: (request: EsseImagePreflightExecutionRequest) => Promise<WorkspaceMutationResult>;
  executePackagePreflightTool?: (request: EssePackagePreflightExecutionRequest) => Promise<WorkspaceMutationResult>;
  getState: () => EsseWorkspaceState;
  getTurnBudget?: () => EsseTurnBudget | undefined;
  recordToolCall?: (event: EsseWorkspaceToolCallEvent) => void | Promise<void>;
  readImageMetadata?: (request: EsseImageMetadataRequest) => Promise<ProjectImageMetadataResult>;
  requestPermission?: (request: EsseWorkspacePermissionRequest) => Promise<EsseWorkspacePermissionDecision>;
  requestPreflight?: (payload: EssePreflightPayload) => Promise<EssePreflightDecision>;
  scanUnreferencedFiles?: () => Promise<UnreferencedFileCandidate[]>;
}

export interface EsseTurnBudget {
  deadline: number;
  toolCalls: { limit: number; used: number };
  writeCalls: { limit: number; used: number };
}

export type WorkspaceMutationResult =
  | { ok: true; affectedSessionIds: string[]; summary: string }
  | { ok: false; detail?: string; reason: string; suggestedNext?: string };

export type EssePreflightDecision =
  | { decision: "execute" }
  | { decision: "cancel"; detail?: string };

export interface EsseWorkspacePermissionRequest {
  label: string;
  params: Record<string, unknown>;
  requiresPreflight: boolean;
  risk: BatchImagerAgentToolRisk;
  toolName: string;
}

export type EsseWorkspacePermissionDecision =
  | { decision: "allow" }
  | { decision: "deny"; reason: string; suggestedNext?: string };

export interface EsseImagePreflightExecutionRequest {
  commands: EssePreflightCommand[];
  tool: "generate_image" | "run_batch_generation";
}

export interface EssePackagePreflightExecutionRequest {
  fileName?: string;
  sessionIds?: string[];
  tool: "package_generated_images";
}

export interface EsseBlankSessionRequest {
  fileName?: string;
}

export interface EsseImageMetadataRequest {
  recordIndex?: number;
  sessionId: string;
}

export interface EsseWorkspaceToolCallEvent {
  params: Record<string, unknown>;
  result: AgentToolResult;
  toolName: string;
}

export function createEsseWorkspaceTools(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool[] {
  const tools = [
    createGetProjectOverviewTool(runtime),
    createListSessionsTool(runtime),
    createGetSessionRecordsTool(runtime),
    createReadImageMetadataTool(runtime),
    createRestoreSessionRecordTool(runtime),
    createRestoreOriginalTool(runtime),
    createRenameSessionTool(runtime),
    createReorderSessionsTool(runtime),
    createSetSessionPromptTool(runtime),
    createAddBlankSessionTool(runtime),
    createScanUnreferencedFilesTool(runtime),
    createDeleteUnreferencedFilesTool(runtime),
    createGenerateImageTool(runtime),
    createRunBatchGenerationTool(runtime),
    createPackageGeneratedImagesTool(runtime),
    createDeleteSessionRecordTool(runtime),
    createDeleteSessionTool(runtime),
    createMergeSessionsTool(runtime)
  ];

  const budgetedTools = runtime.getTurnBudget ? tools.map((tool) => withTurnBudget(runtime, tool)) : tools;

  return runtime.recordToolCall ? budgetedTools.map((tool) => instrumentWorkspaceTool(runtime, tool)) : budgetedTools;
}

function createAddBlankSessionTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "add_blank_session",
    label: "添加空白图位",
    risk: "safe-write",
    requiresPreflight: false,
    description:
      "Add one blank placeholder image session to the workspace without calling the image API. Use only when the user explicitly asks to add, reserve, or create an empty slot first. Do not use this before generate_image or run_batch_generation; new generation creates its own session after preflight.",
    parameters: objectParameters({ fileName: "Optional display fileName for the blank placeholder session." }, []),
    async execute(_toolCallId, params) {
      if (!runtime.createBlankSession) {
        return toolError("add_blank_session unavailable", undefined, "run this tool only in a project workspace runtime.");
      }

      const fileName = readString(params.fileName);
      const permission = await requestWorkspaceToolPermission(runtime, { label: "添加空白图位", name: "add_blank_session", requiresPreflight: false, risk: "safe-write" }, params);
      if (permission) {
        return permission;
      }

      const result = await runtime.createBlankSession({
        ...(fileName ? { fileName } : {})
      });
      if (!result.ok) {
        return toolError(result.reason, result.detail, result.suggestedNext);
      }

      return toolOk(result.summary, { affectedSessionIds: result.affectedSessionIds });
    }
  };
}

function createReadImageMetadataTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "read_image_metadata",
    label: "读取图片信息",
    risk: "read",
    requiresPreflight: false,
    description:
      "Read width, height, format, and byte size for a workspace image without exposing file paths. Use sessionId from list_sessions. Omit recordIndex to inspect the session's current displayed image; pass 1-based recordIndex only after get_session_records when the user asks about a specific generated record.",
    parameters: objectParameters(
      {
        recordIndex: "Optional 1-based generated record index. Omit for the current displayed image.",
        sessionId: "Stable session id from list_sessions."
      },
      ["sessionId"]
    ),
    async execute(_toolCallId, params) {
      if (!runtime.readImageMetadata) {
        return toolError("read_image_metadata unavailable", undefined, "run this tool only in a project workspace runtime.");
      }

      const sessionId = readString(params.sessionId);
      const recordIndex = readInteger(params.recordIndex);
      const request = {
        ...(Number.isInteger(recordIndex) ? { recordIndex } : {}),
        sessionId
      };

      try {
        const metadata = await runtime.readImageMetadata(request);
        return toolOk(formatImageMetadata(metadata), { metadata });
      } catch (error) {
        return toolError("image metadata unavailable", error instanceof Error ? error.message : String(error), "call list_sessions and get_session_records to verify ids.");
      }
    }
  };
}

function instrumentWorkspaceTool(runtime: EsseWorkspaceToolRuntime, tool: BatchImagerAgentTool): BatchImagerAgentTool {
  return {
    ...tool,
    async execute(toolCallId, params) {
      const result = await tool.execute(toolCallId, params);
      await runtime.recordToolCall?.({
        params,
        result,
        toolName: tool.name
      });
      return result;
    }
  };
}

function withTurnBudget(runtime: EsseWorkspaceToolRuntime, tool: BatchImagerAgentTool): BatchImagerAgentTool {
  return {
    ...tool,
    async execute(toolCallId, params) {
      const budget = runtime.getTurnBudget?.();
      if (!budget) {
        return toolError("turn budget unavailable", undefined, "Return a final reply explaining that the current Esse turn expired.");
      }

      if (budget.toolCalls.used >= budget.toolCalls.limit) {
        return toolError(
          "Tool call limit reached for this turn",
          undefined,
          "Summarize what you have done and return a final reply."
        );
      }

      if (Date.now() > budget.deadline) {
        return toolError("Turn execution timed out", undefined, "Return a final reply explaining the timeout.");
      }

      const isWriteTool = tool.risk === "safe-write" || tool.risk === "destructive" || tool.risk === "external-write";
      const countsTowardWriteLimit = isWriteTool && !tool.requiresPreflight;
      if (countsTowardWriteLimit && budget.writeCalls.used >= budget.writeCalls.limit) {
        return toolError("Write tool call limit reached", undefined, "Summarize and return a final reply.");
      }

      budget.toolCalls.used += 1;
      if (countsTowardWriteLimit) {
        budget.writeCalls.used += 1;
      }

      return await tool.execute(toolCallId, params);
    }
  };
}

function createPackageGeneratedImagesTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "package_generated_images",
    label: "打包生成图",
    risk: "external-write",
    requiresPreflight: true,
    description:
      "Package generated images into a zip file on the desktop. Use this when the user asks to package, export, zip, or put generated images on the desktop; do not just say you will package them. Calling this tool is what creates the preflight confirmation card; never ask for confirmation in plain text instead. Use sessionIds only from list_sessions; omit sessionIds to package all generated images.",
    parameters: objectParameters({ fileName: "Optional zip file name.", sessionIds: "Optional stable session ids to include." }, []),
    async execute(_toolCallId, params) {
      const fileName = readString(params.fileName);
      const sessionIds = readStringArray(params.sessionIds);
      const state = runtime.getState();
      const selectedSessions = sessionIds.length
        ? sessionIds.map((sessionId) => state.sessions.find((session) => session.id === sessionId))
        : state.sessions;
      const missingSessionId = sessionIds.find((sessionId, index) => !selectedSessions[index]);
      if (missingSessionId) {
        return toolError("session not found", `no session with id ${missingSessionId}`, "call list_sessions to list current ids.");
      }

      const sessionsWithImages = (selectedSessions as PersistedImageSession[]).filter((session) => session.generatedFilePaths?.length);
      if (sessionsWithImages.length === 0) {
        return toolError("no generated images to package", undefined, "generate images first or choose sessions with generated records.");
      }

      if (!runtime.requestPreflight) {
        return toolError("preflight unavailable", undefined, "package_generated_images must be executed through an Esse preflight runtime.");
      }

      const permission = await requestWorkspaceToolPermission(runtime, { label: "打包生成图", name: "package_generated_images", requiresPreflight: true, risk: "external-write" }, params);
      if (permission) {
        return permission;
      }

      const decision = await runtime.requestPreflight({
        commands: sessionsWithImages.map((session) => ({
          displayLabel: `img-${state.sessions.findIndex((current) => current.id === session.id) + 1}`,
          prompt: `${session.generatedFilePaths?.length ?? 0} 张生成图`,
          target: { sessionId: session.id, type: "existing" }
        })),
        estimatedApiCalls: 0,
        tool: "package_generated_images"
      });
      if (decision.decision === "cancel") {
        return toolError(
          "User canceled preflight",
          decision.detail,
          "Ask the user what to adjust before retrying; do NOT retry with the same parameters."
        );
      }

      if (!runtime.executePackagePreflightTool) {
        return toolError("package execution unavailable", undefined, "preflight was confirmed, but no package executor is configured.");
      }

      const result = await runtime.executePackagePreflightTool({
        ...(fileName ? { fileName } : {}),
        ...(sessionIds.length ? { sessionIds } : {}),
        tool: "package_generated_images"
      });
      if (!result.ok) {
        return toolError(result.reason, result.detail, result.suggestedNext);
      }

      return toolOk(result.summary, { affectedSessionIds: result.affectedSessionIds });
    }
  };
}

function createGenerateImageTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "generate_image",
    label: "生成图片预览",
    risk: "safe-write",
    requiresPreflight: true,
    description:
      "Generate or edit a single image through the image API. Use this for requests such as background removal, watermark removal, white-background product images, restyling, or creating a new image. Call list_sessions first when targeting an existing workspace image. This always requires a preflight confirmation before execution. Use mode='edit' only with target.type='existing'. Only pass size when the user clearly requested a concrete size, 2K/4K, square, orientation, or aspect ratio.",
    parameters: imageGenerationParameters(),
    async execute(_toolCallId, params) {
      const commandResult = normalizeImagePreflightCommand(runtime.getState(), params);
      if (!commandResult.ok) {
        return toolError(commandResult.reason, commandResult.detail, commandResult.suggestedNext);
      }

      const permission = await requestWorkspaceToolPermission(runtime, { label: "生成图片预览", name: "generate_image", requiresPreflight: true, risk: "safe-write" }, params);
      if (permission) {
        return permission;
      }

      return executePreflightImageTool(runtime, {
        commands: [commandResult.command],
        tool: "generate_image"
      });
    }
  };
}

function createRunBatchGenerationTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "run_batch_generation",
    label: "批量生成预览",
    risk: "safe-write",
    requiresPreflight: true,
    description:
      "Run multiple image generation/edit commands. Use for multi-image, batch, all, or 'this set' requests after calling list_sessions to resolve current stable session ids. This always requires one preflight card before execution. Every command must explicitly set mode='edit' or mode='generate'; there is no default mode.",
    parameters: batchGenerationParameters(),
    async execute(_toolCallId, params) {
      const rawCommands = Array.isArray(params.commands) ? params.commands : [];
      if (rawCommands.length === 0) {
        return toolError("commands are required", undefined, "provide at least one generation command.");
      }

      const commands: EssePreflightCommand[] = [];
      for (const rawCommand of rawCommands) {
        if (!rawCommand || typeof rawCommand !== "object") {
          return toolError("command must be an object", undefined, "provide target, mode, and prompt for every command.");
        }
        const commandResult = normalizeImagePreflightCommand(runtime.getState(), rawCommand as Record<string, unknown>);
        if (!commandResult.ok) {
          return toolError(commandResult.reason, commandResult.detail, commandResult.suggestedNext);
        }
        commands.push(commandResult.command);
      }

      const permission = await requestWorkspaceToolPermission(runtime, { label: "批量生成预览", name: "run_batch_generation", requiresPreflight: true, risk: "safe-write" }, params);
      if (permission) {
        return permission;
      }

      return executePreflightImageTool(runtime, {
        commands,
        tool: "run_batch_generation"
      });
    }
  };
}

function createScanUnreferencedFilesTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "scan_unreferenced_files",
    label: "扫描未引用文件",
    risk: "read",
    requiresPreflight: false,
    description:
      "Scan the project generated-image directory for files not referenced by any session, chat message, or project report. Read-only. Returns candidateId values; never returns file paths.",
    parameters: emptyParameters(),
    async execute() {
      if (!runtime.scanUnreferencedFiles) {
        return toolError("scan_unreferenced_files unavailable", undefined, "run this tool only in a project workspace runtime.");
      }

      const candidates = await runtime.scanUnreferencedFiles();
      return toolOk(formatUnreferencedScanSummary(candidates), {
        candidates
      });
    }
  };
}

function formatUnreferencedScanSummary(candidates: UnreferencedFileCandidate[]): string {
  if (candidates.length === 0) {
    return "已扫描未引用生成文件，没有发现可清理候选。";
  }

  return [
    `已扫描未引用生成文件，发现 ${candidates.length} 个候选：`,
    ...candidates.map((candidate) => `- candidateId=${candidate.candidateId}; fileName=${candidate.fileName}; byteSize=${candidate.byteSize}`)
  ].join("\n");
}

function formatImageMetadata(metadata: ProjectImageMetadataResult): string {
  return [
    `已读取图片信息：sessionId=${metadata.sessionId}`,
    `sourceType=${metadata.sourceType}`,
    metadata.recordIndex ? `recordIndex=${metadata.recordIndex}` : undefined,
    `fileName=${metadata.fileName}`,
    `width=${metadata.width}`,
    `height=${metadata.height}`,
    metadata.format ? `format=${metadata.format}` : undefined,
    `byteSize=${metadata.byteSize}`
  ]
    .filter(Boolean)
    .join("; ");
}

function createDeleteUnreferencedFilesTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "delete_unreferenced_files",
    label: "删除未引用文件",
    risk: "destructive",
    requiresPreflight: false,
    description:
      "Physically delete generated files identified by candidateId from scan_unreferenced_files. Re-scans before deleting and skips candidates that are now referenced, missing, or outside the generated directory. Never accepts file paths.",
    parameters: objectParameters({ candidateIds: "candidateId values from scan_unreferenced_files. Do not pass file paths." }, ["candidateIds"]),
    async execute(_toolCallId, params) {
      if (!runtime.deleteUnreferencedFiles) {
        return toolError("delete_unreferenced_files unavailable", undefined, "call scan_unreferenced_files in a project workspace runtime first.");
      }

      const candidateIds = readStringArray(params.candidateIds);
      if (candidateIds.length === 0) {
        return toolError("candidateIds are required", undefined, "call scan_unreferenced_files and pass one or more candidateId values.");
      }

      const permission = await requestWorkspaceToolPermission(runtime, { label: "删除未引用文件", name: "delete_unreferenced_files", requiresPreflight: false, risk: "destructive" }, params);
      if (permission) {
        return permission;
      }

      const results = await runtime.deleteUnreferencedFiles(candidateIds);
      const deletedCount = results.filter((result) => result.status === "deleted").length;
      return toolOk(`已删除 ${deletedCount} 个未引用生成文件。`, {
        results
      });
    }
  };
}

function createGetProjectOverviewTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "get_project_overview",
    label: "项目概览",
    risk: "read",
    requiresPreflight: false,
    description:
      "Get project metadata for the current BatchImager project. Use when the user asks about the project name, image count, selected session, or workspace summary.",
    parameters: emptyParameters(),
    async execute() {
      const state = runtime.getState();
      return toolOk("已读取项目概览。", {
        imageCount: state.sessions.length,
        projectDirectory: state.project.directory,
        projectId: state.project.id,
        projectName: state.project.name,
        selectedSessionId: state.selectedSessionId ?? null
      });
    }
  };
}

function createListSessionsTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "list_sessions",
    label: "列出工作区",
    risk: "read",
    requiresPreflight: false,
    description:
      "List all image sessions in the current BatchImager project. Use before workspace writes. Returns stable id and displayLabel; always pass stable id to later tools.",
    parameters: emptyParameters(),
    async execute() {
      const state = runtime.getState();
      return toolOk("已列出工作区图片。", {
        sessions: state.sessions.map((session, index) => ({
          currentImageSource: getCurrentImageSource(session),
          displayLabel: `img-${index + 1}`,
          fileName: session.fileName,
          generatedRecordCount: session.generatedFilePaths?.length ?? 0,
          id: session.id,
          isSelected: session.id === state.selectedSessionId
        }))
      });
    }
  };
}

function createGetSessionRecordsTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "get_session_records",
    label: "查看图片记录",
    risk: "read",
    requiresPreflight: false,
    description:
      "Get generated records for one session. Use before restore_session_record or delete_session_record. recordIndex is 1-based.",
    parameters: objectParameters({ sessionId: "Stable session id from list_sessions." }, ["sessionId"]),
    async execute(_toolCallId, params) {
      const sessionId = readString(params.sessionId);
      const session = runtime.getState().sessions.find((current) => current.id === sessionId);
      if (!session) {
        return toolError("session not found", `no session with id ${sessionId}`, "call list_sessions to list current ids.");
      }

      return toolOk("已列出图片记录。", {
        records: (session.generatedFilePaths ?? []).map((filePath, index) => ({
          fileName: basenameFromPath(filePath),
          isCurrent: filePath === session.generatedFilePath && !session.showOriginalInList,
          ...(session.originatedFromGeneration && index === 0 ? { isPrimary: true } : {}),
          recordIndex: index + 1
        })),
        sessionId
      });
    }
  };
}

function createRestoreSessionRecordTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return mutationTool({
    description: "Restore a session to a previous generated record. Call list_sessions and get_session_records first. recordIndex is 1-based.",
    label: "回退记录",
    name: "restore_session_record",
    parameters: objectParameters({ recordIndex: "1-based generated record index.", sessionId: "Stable session id." }, ["sessionId", "recordIndex"]),
    mutate: (state, params) => restoreSessionRecord(state, { sessionId: readString(params.sessionId), recordIndex: readInteger(params.recordIndex) }),
    runtime
  });
}

function createRestoreOriginalTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return mutationTool({
    description: "Restore a session to its original imported image. Call list_sessions first. Does not delete generated records.",
    label: "恢复原图",
    name: "restore_original",
    parameters: objectParameters({ sessionId: "Stable session id from list_sessions." }, ["sessionId"]),
    mutate: (state, params) => restoreOriginal(state, { sessionId: readString(params.sessionId) }),
    runtime
  });
}

function createRenameSessionTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return mutationTool({
    description: "Rename one image session's display fileName. Call list_sessions first. Does not rename files on disk.",
    label: "重命名图片",
    name: "rename_session",
    parameters: objectParameters({ fileName: "New non-empty display fileName.", sessionId: "Stable session id from list_sessions." }, ["sessionId", "fileName"]),
    mutate: (state, params) => renameSession(state, { fileName: readString(params.fileName), sessionId: readString(params.sessionId) }),
    runtime
  });
}

function createReorderSessionsTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return mutationTool({
    description: "Reorder all image sessions. sessionIds must be a complete permutation of stable ids from list_sessions.",
    label: "调整顺序",
    name: "reorder_sessions",
    parameters: objectParameters({ sessionIds: "Complete ordered list of stable session ids from list_sessions." }, ["sessionIds"]),
    mutate: (state, params) => reorderSessions(state, { sessionIds: readStringArray(params.sessionIds) }),
    runtime
  });
}

function createSetSessionPromptTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return mutationTool({
    description: "Set one image session's default prompt for future generation. Does not call the image API.",
    label: "设置提示词",
    name: "set_session_prompt",
    parameters: objectParameters({ prompt: "Non-empty default prompt.", sessionId: "Stable session id from list_sessions." }, ["sessionId", "prompt"]),
    mutate: (state, params) => setSessionPrompt(state, { prompt: readString(params.prompt), sessionId: readString(params.sessionId) }),
    runtime
  });
}

function createDeleteSessionRecordTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return mutationTool({
    description: "Logically delete one generated record from a session. Call list_sessions and get_session_records first. Does not delete files from disk.",
    label: "删除记录",
    name: "delete_session_record",
    parameters: objectParameters({ recordIndex: "1-based generated record index.", sessionId: "Stable session id." }, ["sessionId", "recordIndex"]),
    risk: "destructive",
    mutate: (state, params) => deleteSessionRecord(state, { sessionId: readString(params.sessionId), recordIndex: readInteger(params.recordIndex) }),
    runtime
  });
}

function createDeleteSessionTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return mutationTool({
    description: "Delete one image session from the workspace. Call list_sessions first. This only removes workspace references.",
    label: "删除图片",
    name: "delete_session",
    parameters: objectParameters({ sessionId: "Stable session id from list_sessions." }, ["sessionId"]),
    risk: "destructive",
    mutate: (state, params) => deleteSession(state, { sessionId: readString(params.sessionId) }),
    runtime
  });
}

function createMergeSessionsTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return mutationTool({
    description: "Merge generated records from source sessions into a target session, then remove source sessions. Call list_sessions first.",
    label: "合并图片",
    name: "merge_sessions",
    parameters: objectParameters(
      { sourceSessionIds: "Stable source session ids.", targetSessionId: "Stable target session id." },
      ["targetSessionId", "sourceSessionIds"]
    ),
    mutate: (state, params) =>
      mergeSessions(state, {
        sourceSessionIds: readStringArray(params.sourceSessionIds),
        targetSessionId: readString(params.targetSessionId)
      }),
    risk: "destructive",
    runtime
  });
}

async function requestWorkspaceToolPermission(
  runtime: EsseWorkspaceToolRuntime,
  tool: { label: string; name: string; requiresPreflight: boolean; risk: BatchImagerAgentToolRisk },
  params: Record<string, unknown>
): Promise<AgentToolResult | undefined> {
  if (tool.risk === "read" || !runtime.requestPermission) {
    return undefined;
  }

  const decision = await runtime.requestPermission({
    label: tool.label,
    params,
    requiresPreflight: tool.requiresPreflight,
    risk: tool.risk,
    toolName: tool.name
  });
  if (decision.decision === "allow") {
    return undefined;
  }

  return toolError("permission denied", decision.reason, decision.suggestedNext);
}

function mutationTool(options: {
  description: string;
  label: string;
  mutate: (state: EsseWorkspaceState, params: Record<string, unknown>) => { result: WorkspaceMutationResult; state: EsseWorkspaceState };
  name: string;
  parameters: Record<string, unknown>;
  risk?: BatchImagerAgentToolRisk;
  runtime: EsseWorkspaceToolRuntime;
}): BatchImagerAgentTool {
  const risk = options.risk ?? "safe-write";
  return {
    name: options.name,
    label: options.label,
    risk,
    requiresPreflight: false,
    description: options.description,
    parameters: options.parameters,
    async execute(_toolCallId, params) {
      const permission = await requestWorkspaceToolPermission(options.runtime, {
        label: options.label,
        name: options.name,
        requiresPreflight: false,
        risk
      }, params);
      if (permission) {
        return permission;
      }

      const mutation = await options.runtime.applyMutation((state) => options.mutate(state, params));
      if (!mutation.result.ok) {
        return toolError(mutation.result.reason, mutation.result.detail, mutation.result.suggestedNext);
      }

      return toolOk(mutation.result.summary, {
        affectedSessionIds: mutation.result.affectedSessionIds
      });
    }
  };
}

function restoreSessionRecord(state: EsseWorkspaceState, params: { recordIndex: number; sessionId: string }) {
  const resolved = resolveRecord(state, params.sessionId, params.recordIndex);
  if (!("filePath" in resolved)) {
    return { state, result: resolved.result };
  }

  return ok(
    updateSession(state, params.sessionId, (session) => ({
      ...session,
      generatedFilePath: resolved.filePath,
      showOriginalInList: false
    })),
    [params.sessionId],
    `已切换到记录 ${params.recordIndex}。`
  );
}

function deleteSessionRecord(state: EsseWorkspaceState, params: { recordIndex: number; sessionId: string }) {
  const resolved = resolveRecord(state, params.sessionId, params.recordIndex);
  if (!("filePath" in resolved)) {
    return { state, result: resolved.result };
  }

  const remaining = resolved.session.generatedFilePaths?.filter((_filePath, index) => index !== params.recordIndex - 1) ?? [];
  if (resolved.session.originatedFromGeneration && remaining.length === 0) {
    return deleteSession(state, { sessionId: params.sessionId });
  }

  const fallback = chooseFallback(resolved.session, params.recordIndex, remaining);
  return ok(
    updateSession(state, params.sessionId, (session) => ({
      ...session,
      chatMessages: session.chatMessages.map((message) =>
        message.generatedFilePath === resolved.filePath ? { ...message, generatedFilePath: undefined } : message
      ),
      generatedFilePath: fallback,
      generatedFilePaths: remaining.length ? remaining : undefined,
      showOriginalInList: !fallback
    })),
    [params.sessionId],
    `已删除记录 ${params.recordIndex}。`
  );
}

function restoreOriginal(state: EsseWorkspaceState, params: { sessionId: string }) {
  const session = findSession(state, params.sessionId);
  if (!session) {
    return fail(state, "session not found", `no session with id ${params.sessionId}`, "call list_sessions to list current ids.");
  }

  if (session.originatedFromGeneration) {
    const primaryGeneratedPath = session.generatedFilePaths?.[0] ?? session.generatedFilePath ?? session.filePath;
    return ok(
      updateSession(state, params.sessionId, (current) => ({
        ...current,
        generatedFilePath: primaryGeneratedPath,
        showOriginalInList: false
      })),
      [params.sessionId],
      "已切回第一张生成图。"
    );
  }

  return ok(
    updateSession(state, params.sessionId, (current) => ({
      ...current,
      generatedFilePath: undefined,
      showOriginalInList: false
    })),
    [params.sessionId],
    "已恢复为原图。"
  );
}

function renameSession(state: EsseWorkspaceState, params: { fileName: string; sessionId: string }) {
  if (!params.fileName) {
    return fail(state, "fileName is required", undefined, "provide a non-empty fileName.");
  }

  const session = findSession(state, params.sessionId);
  if (!session) {
    return fail(state, "session not found", `no session with id ${params.sessionId}`, "call list_sessions to list current ids.");
  }

  return ok(
    updateSession(state, params.sessionId, (current) => ({
      ...current,
      fileName: params.fileName
    })),
    [params.sessionId],
    `已重命名为 ${params.fileName}。`
  );
}

function reorderSessions(state: EsseWorkspaceState, params: { sessionIds: string[] }) {
  const currentIds = state.sessions.map((session) => session.id);
  const requestedIds = params.sessionIds;
  if (requestedIds.length !== currentIds.length || new Set(requestedIds).size !== requestedIds.length) {
    return fail(state, "sessionIds must be a full permutation", undefined, "pass every current session id exactly once.");
  }

  const byId = new Map(state.sessions.map((session) => [session.id, session]));
  const nextSessions = requestedIds.map((id) => byId.get(id));
  if (nextSessions.some((session) => !session)) {
    return fail(state, "sessionIds must be a full permutation", undefined, "call list_sessions and retry with current ids.");
  }

  return ok(
    {
      ...state,
      sessions: nextSessions as PersistedImageSession[]
    },
    requestedIds,
    "已调整图片顺序。"
  );
}

function setSessionPrompt(state: EsseWorkspaceState, params: { prompt: string; sessionId: string }) {
  if (!params.prompt) {
    return fail(state, "prompt is required", undefined, "provide a non-empty prompt.");
  }

  const session = findSession(state, params.sessionId);
  if (!session) {
    return fail(state, "session not found", `no session with id ${params.sessionId}`, "call list_sessions to list current ids.");
  }

  return ok(
    updateSession(state, params.sessionId, (current) => ({
      ...current,
      lastPrompt: params.prompt
    })),
    [params.sessionId],
    "已更新这张图的默认提示词。"
  );
}

async function executePreflightImageTool(
  runtime: EsseWorkspaceToolRuntime,
  request: EsseImagePreflightExecutionRequest
): Promise<AgentToolResult> {
  if (!runtime.requestPreflight) {
    return toolError("preflight unavailable", undefined, "image API tools must be executed through an Esse preflight runtime.");
  }

  const payload: EssePreflightPayload = {
    commands: request.commands,
    estimatedApiCalls: request.commands.length,
    tool: request.tool
  };
  const decision = await runtime.requestPreflight(payload);
  if (decision.decision === "cancel") {
    return toolError(
      "User canceled preflight",
      decision.detail,
      "Ask the user what to adjust before retrying; do NOT retry with the same parameters."
    );
  }

  if (!runtime.executeImagePreflightTool) {
    return toolError("image execution unavailable", undefined, "preflight was confirmed, but no image executor is configured.");
  }

  const result = await runtime.executeImagePreflightTool(request);
  if (!result.ok) {
    return toolError(result.reason, result.detail, result.suggestedNext);
  }

  return toolOk(result.summary, {
    affectedSessionIds: result.affectedSessionIds
  });
}

function normalizeImagePreflightCommand(
  state: EsseWorkspaceState,
  params: Record<string, unknown>
): { command: EssePreflightCommand; ok: true } | Extract<WorkspaceMutationResult, { ok: false }> {
  const mode = params.mode === "edit" || params.mode === "generate" ? params.mode : undefined;
  if (!mode) {
    return {
      ok: false,
      reason: "mode must be edit or generate",
      suggestedNext: "set mode explicitly; there is no default generation mode."
    };
  }

  const prompt = readString(params.prompt);
  if (!prompt) {
    return { ok: false, reason: "prompt is required", suggestedNext: "provide a non-empty image prompt." };
  }

  const target = readTarget(params.target);
  if (!target) {
    return {
      ok: false,
      reason: "target is required",
      suggestedNext: "use target.type='existing' with a stable sessionId, or target.type='new'."
    };
  }
  if (mode === "edit" && target.type !== "existing") {
    return {
      ok: false,
      reason: "edit mode requires an existing target",
      suggestedNext: "use target.type='existing' for edits, or mode='generate' for new images."
    };
  }

  const referenceImageIds = readStringArray(params.referenceImageIds);
  const size = readString(params.size);

  if (target.type === "new") {
    return {
      command: {
        mode,
        prompt,
        ...(referenceImageIds.length ? { referenceImageIds } : {}),
        ...(size ? { size } : {}),
        target: { type: "new", ...(target.fileName ? { fileName: target.fileName } : {}) }
      },
      ok: true
    };
  }

  const sessionIndex = state.sessions.findIndex((session) => session.id === target.sessionId);
  if (sessionIndex < 0) {
    return {
      ok: false,
      reason: "session not found",
      detail: `no session with id ${target.sessionId}`,
      suggestedNext: "call list_sessions to list current ids."
    };
  }

  return {
    command: {
      displayLabel: `img-${sessionIndex + 1}`,
      mode,
      prompt,
      ...(referenceImageIds.length ? { referenceImageIds } : {}),
      ...(size ? { size } : {}),
      target: { sessionId: target.sessionId, type: "existing" }
    },
    ok: true
  };
}

function readTarget(value: unknown): { fileName?: string; type: "new" } | { sessionId: string; type: "existing" } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const target = value as Record<string, unknown>;
  if (target.type === "new") {
    const fileName = readString(target.fileName);
    return { type: "new", ...(fileName ? { fileName } : {}) };
  }
  if (target.type === "existing") {
    const sessionId = readString(target.sessionId);
    return sessionId ? { sessionId, type: "existing" } : undefined;
  }

  return undefined;
}

function deleteSession(state: EsseWorkspaceState, params: { sessionId: string }) {
  const removedIndex = state.sessions.findIndex((session) => session.id === params.sessionId);
  if (removedIndex < 0) {
    return fail(state, "session not found", `no session with id ${params.sessionId}`, "call list_sessions to list current ids.");
  }

  const sessions = state.sessions.filter((session) => session.id !== params.sessionId);
  return ok(
    {
      ...state,
      project: { ...state.project, imageCount: sessions.length },
      selectedSessionId:
        state.selectedSessionId === params.sessionId
          ? sessions[Math.min(removedIndex, sessions.length - 1)]?.id ?? null
          : state.selectedSessionId,
      sessions
    },
    [params.sessionId],
    "已删除图片。"
  );
}

function mergeSessions(state: EsseWorkspaceState, params: { sourceSessionIds: string[]; targetSessionId: string }) {
  const target = state.sessions.find((session) => session.id === params.targetSessionId);
  if (!target) {
    return fail(state, "target session not found", `no session with id ${params.targetSessionId}`, "call list_sessions to list current ids.");
  }

  const sourceIds = [...new Set(params.sourceSessionIds.filter((id) => id !== params.targetSessionId))];
  const sources = sourceIds.map((id) => state.sessions.find((session) => session.id === id));
  const missingId = sourceIds.find((id, index) => !sources[index]);
  if (sourceIds.length === 0) {
    return fail(state, "sourceSessionIds are required", undefined, "provide at least one source session id different from targetSessionId.");
  }
  if (missingId) {
    return fail(state, "source session not found", `no session with id ${missingId}`, "call list_sessions to list current ids.");
  }

  const sourceSessions = sources as PersistedImageSession[];
  const mergedRecords = uniquePaths([
    ...(target.generatedFilePaths ?? []),
    ...sourceSessions.flatMap((session) => session.generatedFilePaths ?? []),
    ...sourceSessions.flatMap((session) => (session.generatedFilePath ? [session.generatedFilePath] : []))
  ]);
  return ok(
    {
      ...state,
      project: { ...state.project, imageCount: state.sessions.length - sourceIds.length },
      selectedSessionId: sourceIds.includes(state.selectedSessionId ?? "") ? params.targetSessionId : state.selectedSessionId,
      sessions: state.sessions
        .filter((session) => !sourceIds.includes(session.id))
        .map((session) =>
          session.id === params.targetSessionId
            ? {
                ...session,
                chatMessages: [...session.chatMessages, ...sourceSessions.flatMap((sourceSession) => sourceSession.chatMessages)],
                generatedFilePath: session.generatedFilePath ?? mergedRecords.at(-1),
                generatedFilePaths: mergedRecords.length ? mergedRecords : session.generatedFilePaths
              }
            : session
        )
    },
    [params.targetSessionId, ...sourceIds],
    `已合并 ${sourceIds.length} 张图片。`
  );
}

function resolveRecord(
  state: EsseWorkspaceState,
  sessionId: string,
  recordIndex: number
): { filePath: string; result: Extract<WorkspaceMutationResult, { ok: true }>; session: PersistedImageSession } | { result: Extract<WorkspaceMutationResult, { ok: false }> } {
  const session = state.sessions.find((current) => current.id === sessionId);
  if (!session) {
    return { result: { ok: false, reason: "session not found", detail: `no session with id ${sessionId}`, suggestedNext: "call list_sessions to list current ids." } };
  }
  const records = session.generatedFilePaths ?? [];
  if (!Number.isInteger(recordIndex) || recordIndex < 1 || recordIndex > records.length) {
    return {
      result: {
        ok: false,
        reason: "recordIndex out of range",
        detail: `${sessionId} has ${records.length} records, requested ${recordIndex}.`,
        suggestedNext: "call get_session_records to verify."
      }
    };
  }
  return { filePath: records[recordIndex - 1], result: { ok: true, affectedSessionIds: [sessionId], summary: "record resolved" }, session };
}

function findSession(state: EsseWorkspaceState, sessionId: string): PersistedImageSession | undefined {
  return state.sessions.find((session) => session.id === sessionId);
}

function updateSession(state: EsseWorkspaceState, sessionId: string, update: (session: PersistedImageSession) => PersistedImageSession): EsseWorkspaceState {
  return {
    ...state,
    sessions: state.sessions.map((session) => (session.id === sessionId ? update(session) : session))
  };
}

function chooseFallback(session: PersistedImageSession, recordIndex: number, remainingRecords: string[]): string | undefined {
  if (session.generatedFilePath !== session.generatedFilePaths?.[recordIndex - 1]) {
    return session.generatedFilePath && remainingRecords.includes(session.generatedFilePath) ? session.generatedFilePath : remainingRecords.at(-1);
  }

  return remainingRecords[Math.max(0, recordIndex - 2)] ?? remainingRecords[0];
}

function getCurrentImageSource(session: PersistedImageSession): "generated" | "original" {
  if (session.originatedFromGeneration) {
    return "generated";
  }

  return session.generatedFilePath && !session.showOriginalInList ? "generated" : "original";
}

function basenameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function ok(state: EsseWorkspaceState, affectedSessionIds: string[], summary: string) {
  return { state, result: { ok: true as const, affectedSessionIds, summary } };
}

function fail(state: EsseWorkspaceState, reason: string, detail?: string, suggestedNext?: string) {
  return { state, result: { ok: false as const, ...(detail ? { detail } : {}), reason, ...(suggestedNext ? { suggestedNext } : {}) } };
}

function toolOk(text: string, details?: Record<string, unknown>): AgentToolResult {
  return {
    content: [{ type: "text", text }],
    ...(details ? { details } : {})
  };
}

function toolError(reason: string, detail?: string, suggestedNext?: string): AgentToolResult {
  return {
    content: [
      {
        type: "text",
        text: [`Reason: ${reason}.`, detail ? `Detail: ${detail}` : undefined, suggestedNext ? `Suggested next: ${suggestedNext}` : undefined]
          .filter(Boolean)
          .join("\n")
      }
    ],
    isError: true
  };
}

function emptyParameters(): Record<string, unknown> {
  return { type: "object", properties: {}, additionalProperties: false };
}

function objectParameters(properties: Record<string, string>, required: string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: Object.fromEntries(Object.entries(properties).map(([name, description]) => [name, { type: name.endsWith("Ids") ? "array" : "string", description }])),
    required,
    additionalProperties: false
  };
}

function imageGenerationParameters(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["edit", "generate"], description: "Explicit generation mode." },
      prompt: { type: "string", description: "Image generation prompt." },
      referenceImageIds: { type: "array", items: { type: "string" }, description: "Optional reference image ids." },
      size: { type: "string", description: "Optional explicit output size. Omit unless the user clearly requested it." },
      target: {
        type: "object",
        properties: {
          fileName: { type: "string", description: "Optional file name for target.type='new'." },
          sessionId: { type: "string", description: "Stable session id for target.type='existing'." },
          type: { type: "string", enum: ["existing", "new"] }
        },
        required: ["type"],
        additionalProperties: false
      }
    },
    required: ["target", "mode", "prompt"],
    additionalProperties: false
  };
}

function batchGenerationParameters(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      commands: {
        type: "array",
        items: imageGenerationParameters(),
        description: "Generation commands. Each command requires target, mode, and prompt."
      },
      globalInstruction: { type: "string", description: "Optional shared instruction summary." }
    },
    required: ["commands"],
    additionalProperties: false
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function readInteger(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }

  return Number.NaN;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}
