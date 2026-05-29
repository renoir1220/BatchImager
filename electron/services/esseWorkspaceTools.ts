import type {
  BatchPlanReferenceImage,
  EssePermissionPayload,
  EssePreflightCommand,
  EssePreflightPayload,
  PersistedImageSession,
  ProjectSnapshot
} from "../ipcTypes";
import type { AgentToolResult, BatchImagerAgentTool, BatchImagerAgentToolRisk } from "./batchImagerAgentTools";
import {
  appendWorkbenchUndoEntry,
  createWorkbenchUndoEntry,
  deleteWorkbenchSession,
  deleteWorkbenchSessionRecord,
  duplicateWorkbenchSession,
  mergeWorkbenchSessions,
  renameWorkbenchSession,
  reorderWorkbenchSessions,
  restoreOriginalWorkbenchImage,
  restoreWorkbenchSessionRecord,
  setWorkbenchSessionPrompt,
  splitWorkbenchSession,
  undoLastWorkbenchActions
} from "./batchImagerWorkbenchActions";
import {
  getProjectOverviewCapability,
  getSessionRecordsCapability,
  listReferenceImagesCapability,
  listRememberedPreferencesCapability,
  listSessionsCapability,
  readImageMetadataCapability,
  scanUnreferencedFilesCapability,
  type BatchImagerImageMetadataRequest,
  type BatchImagerWorkbenchCapabilityResult,
  type BatchImagerWorkbenchCapabilityRuntime
} from "./batchImagerWorkbenchCapabilityApi";
import type { EsseMemoryCategory, EsseMemoryStore } from "./esseMemoryStore";
import type { DeleteUnreferencedFileResult, UnreferencedFileCandidate } from "./projectUnreferencedFiles";

export type EsseWorkspaceState = ProjectSnapshot;

export interface EsseWorkspaceToolRuntime {
  applyMutation: (
    mutator: (state: EsseWorkspaceState) => { result: WorkspaceMutationResult; state: EsseWorkspaceState },
    options?: { countRevision?: boolean }
  ) => Promise<{
    result: WorkspaceMutationResult;
    state: EsseWorkspaceState;
  }>;
  addReferenceImage?: (request: EsseAddReferenceImageRequest) => Promise<WorkspaceMutationResult>;
  addWorkspaceImage?: (request: EsseAddWorkspaceImageRequest) => Promise<WorkspaceMutationResult>;
  deleteUnreferencedFiles?: (candidateIds: string[]) => Promise<DeleteUnreferencedFileResult[]>;
  createBlankSession?: (request: EsseBlankSessionRequest) => Promise<WorkspaceMutationResult>;
  executeImagePreflightTool?: (request: EsseImagePreflightExecutionRequest) => Promise<WorkspaceMutationResult>;
  executePackagePreflightTool?: (request: EssePackagePreflightExecutionRequest) => Promise<WorkspaceMutationResult>;
  getState: () => EsseWorkspaceState;
  getSinkRevision?: () => number;
  getTurnReferenceImagePaths?: () => string[];
  getTurnBudget?: () => EsseTurnBudget | undefined;
  memoryStore?: EsseMemoryStore;
  recordToolCall?: (event: EsseWorkspaceToolCallEvent) => void | Promise<void>;
  readImageMetadata?: BatchImagerWorkbenchCapabilityRuntime["readImageMetadata"];
  removeReferenceImage?: (request: EsseRemoveReferenceImageRequest) => Promise<WorkspaceMutationResult>;
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
  | { decision: "modify"; modifiedCommands: EssePreflightCommand[] }
  | { decision: "cancel"; detail?: string };

export type EsseWorkspacePermissionRequest = EssePermissionPayload;

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

export interface EsseAddReferenceImageRequest {
  fileName?: string;
  filePath: string;
}

export interface EsseAddWorkspaceImageRequest {
  images: Array<{
    fileName?: string;
    filePath: string;
  }>;
}

export interface EsseRemoveReferenceImageRequest {
  referenceImageId: string;
}

export type EsseImageMetadataRequest = BatchImagerImageMetadataRequest;

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
    createAddWorkspaceImageTool(runtime),
    createListReferenceImagesTool(runtime),
    createAddReferenceImageTool(runtime),
    createRemoveReferenceImageTool(runtime),
    createListRememberedPreferencesTool(runtime),
    createRememberUserPreferenceTool(runtime),
    createForgetUserPreferenceTool(runtime),
    createUndoLastActionsTool(runtime),
    createScanUnreferencedFilesTool(runtime),
    createDeleteUnreferencedFilesTool(runtime),
    createGenerateImageTool(runtime),
    createRunBatchGenerationTool(runtime),
    createPackageGeneratedImagesTool(runtime),
    createDeleteSessionRecordTool(runtime),
    createDeleteSessionTool(runtime),
    createMergeSessionsTool(runtime),
    createSplitSessionTool(runtime),
    createDuplicateSessionTool(runtime)
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

function createAddWorkspaceImageTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "add_workspace_image",
    label: "添加图片到工作区",
    risk: "safe-write",
    requiresPreflight: false,
    description:
      "Add one or more existing local image files as new image sessions in the left workspace. Use one call with images=[...] when the user asks to add/import/place multiple images on the left/workspace, especially image files just produced by a prior bash or skill step such as exported PPT pages. Single-image legacy filePath/fileName parameters are still accepted. Do not invent paths or use URLs. Do not use this before generate_image or run_batch_generation; generation tools create their own output sessions after preflight.",
    parameters: addWorkspaceImageParameters(),
    async execute(_toolCallId, params) {
      if (!runtime.addWorkspaceImage) {
        return toolError("add_workspace_image unavailable", undefined, "run this tool only in a project workspace runtime.");
      }

      const imageInputResult = readWorkspaceImageInputs(params);
      if (!imageInputResult.ok) {
        return toolError(imageInputResult.reason, imageInputResult.detail, imageInputResult.suggestedNext);
      }

      for (const image of imageInputResult.images) {
        if (!isSupportedReferenceImagePath(image.filePath)) {
          return toolError("unsupported image type", image.filePath, "Use jpg, jpeg, png, webp, gif, bmp, tif, tiff, heic, or heif images.");
        }
      }

      const permission = await requestWorkspaceToolPermission(runtime, {
        label: "添加图片到工作区",
        name: "add_workspace_image",
        requiresPreflight: false,
        risk: "safe-write"
      }, params);
      if (permission) {
        return permission;
      }

      const result = await runtime.addWorkspaceImage({ images: imageInputResult.images });
      if (!result.ok) {
        return toolError(result.reason, result.detail, result.suggestedNext);
      }

      return toolOk(result.summary, { affectedSessionIds: result.affectedSessionIds });
    }
  };
}

interface WorkspaceImageInput {
  fileName?: string;
  filePath: string;
}

function readWorkspaceImageInputs(
  params: Record<string, unknown>
): { images: WorkspaceImageInput[]; ok: true } | Extract<WorkspaceMutationResult, { ok: false }> {
  const images: WorkspaceImageInput[] = [];
  if (params.images !== undefined) {
    if (!Array.isArray(params.images)) {
      return {
        ok: false,
        reason: "images must be an array",
        suggestedNext: "pass images as an array of { filePath, fileName } objects."
      };
    }

    for (const [index, image] of params.images.entries()) {
      if (!image || typeof image !== "object") {
        return {
          ok: false,
          reason: "image must be an object",
          detail: `images[${index}] is not an object`,
          suggestedNext: "pass each image as { filePath, fileName }."
        };
      }

      const filePath = readString((image as Record<string, unknown>).filePath);
      if (!filePath) {
        return {
          ok: false,
          reason: "image filePath is required",
          detail: `images[${index}].filePath is missing`,
          suggestedNext: "pass an exact local image path from an available tool result or attachment."
        };
      }

      const fileName = readString((image as Record<string, unknown>).fileName);
      images.push({ ...(fileName ? { fileName } : {}), filePath });
    }
  }

  const filePath = readString(params.filePath);
  if (filePath) {
    const fileName = readString(params.fileName);
    images.push({ ...(fileName ? { fileName } : {}), filePath });
  }

  if (images.length === 0) {
    return {
      ok: false,
      reason: "images or filePath is required",
      suggestedNext: "For multiple images, pass images=[{ filePath, fileName }, ...]. For one image, pass filePath."
    };
  }

  return { images, ok: true };
}

function createListReferenceImagesTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "list_reference_images",
    label: "列出参考图",
    risk: "read",
    requiresPreflight: false,
    description:
      "List reference images registered on the current project, reusable conversation attachment candidates, plus any images attached in this turn. Turn attachments are temporary and can be passed directly as referenceImageIds such as turn-ref-1; conversation candidates use conversation-ref-N. Do not add them to the project unless the user explicitly asks to save/register them.",
    parameters: emptyParameters(),
    async execute() {
      return capabilityResultToToolResult(listReferenceImagesCapability(toWorkbenchCapabilityRuntime(runtime)));
    }
  };
}

function createAddReferenceImageTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "add_reference_image",
    label: "添加参考图",
    risk: "external-write",
    requiresPreflight: false,
    description:
      "Add a reference image to the current project from an available local image path, such as a current-turn attachment, prior bash/skill/tool output, or explicit local source. Use only when the user asks to register/save it as a reusable project reference. Do not invent file paths or download from URLs. fileName is optional display text.",
    parameters: objectParameters(
      {
        fileName: "Optional display file name for this reference image.",
        filePath: "An available local image path from an attachment, bash/skill/tool result, or explicit local source."
      },
      ["filePath"]
    ),
    async execute(_toolCallId, params) {
      if (!runtime.addReferenceImage) {
        return toolError("add_reference_image unavailable", undefined, "run this tool only in a project workspace runtime.");
      }

      const filePath = readString(params.filePath);
      const fileName = readString(params.fileName);
      if (!filePath) {
        return toolError("filePath is required", undefined, "pass one exact local image path from an attachment or available tool result.");
      }

      if (!isSupportedReferenceImagePath(filePath)) {
        return toolError("unsupported reference image type", undefined, "Use a jpg, jpeg, png, webp, gif, bmp, tif, tiff, heic, or heif image.");
      }

      const permission = await requestWorkspaceToolPermission(runtime, {
        label: "添加参考图",
        name: "add_reference_image",
        requiresPreflight: false,
        risk: "external-write"
      }, params);
      if (permission) {
        return permission;
      }

      const result = await runtime.addReferenceImage({
        ...(fileName ? { fileName } : {}),
        filePath
      });
      if (!result.ok) {
        return toolError(result.reason, result.detail, result.suggestedNext);
      }

      return toolOk(result.summary, { affectedSessionIds: result.affectedSessionIds });
    }
  };
}

function createRemoveReferenceImageTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "remove_reference_image",
    label: "删除参考图",
    risk: "destructive",
    requiresPreflight: false,
    description:
      "Remove one reference image from the current project by id. Does not delete the original source file shared by the user. Parameters: referenceImageId must be a stable id from list_reference_images.",
    parameters: objectParameters(
      {
        referenceImageId: "Stable reference image id from list_reference_images."
      },
      ["referenceImageId"]
    ),
    async execute(_toolCallId, params) {
      if (!runtime.removeReferenceImage) {
        return toolError("remove_reference_image unavailable", undefined, "run this tool only in a project workspace runtime.");
      }

      const referenceImageId = readString(params.referenceImageId);
      if (!referenceImageId) {
        return toolError("referenceImageId is required", undefined, "call list_reference_images and pass one returned id.");
      }

      const permission = await requestWorkspaceToolPermission(runtime, {
        label: "删除参考图",
        name: "remove_reference_image",
        requiresPreflight: false,
        risk: "destructive"
      }, params);
      if (permission) {
        return permission;
      }

      const result = await runtime.removeReferenceImage({ referenceImageId });
      if (!result.ok) {
        return toolError(result.reason, result.detail, result.suggestedNext);
      }

      return toolOk(result.summary, { affectedSessionIds: result.affectedSessionIds });
    }
  };
}

function createListRememberedPreferencesTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "list_remembered_preferences",
    label: "列出已记忆条目",
    risk: "read",
    requiresPreflight: false,
    description:
      "List all currently remembered user preferences with their ids and categories. Use when the user asks what Esse remembers, or before forget_user_preference.",
    parameters: emptyParameters(),
    async execute() {
      return capabilityResultToToolResult(await listRememberedPreferencesCapability(toWorkbenchCapabilityRuntime(runtime)));
    }
  };
}

function createRememberUserPreferenceTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "remember_user_preference",
    label: "记住用户偏好",
    risk: "safe-write",
    requiresPreflight: false,
    description:
      "Save a user preference, default, or constraint to be remembered across future Esse sessions in any project. Use only when the user explicitly asks to remember, save, or note something for future use. Do not use this for project-specific context. Parameters: content is concise Chinese text under 200 characters; category is one of 用户偏好, 默认约束, 工作流惯例 and defaults to 用户偏好.",
    parameters: objectParameters(
      {
        category: "Optional category: 用户偏好, 默认约束, or 工作流惯例. Defaults to 用户偏好.",
        content: "Concise Chinese preference text under 200 characters."
      },
      ["content"]
    ),
    async execute(_toolCallId, params) {
      if (!runtime.memoryStore) {
        return toolError("memory unavailable", undefined, "run this tool only when the agent memory store is configured.");
      }

      const content = readString(params.content);
      if (!content) {
        return toolError("content is required", undefined, "provide concise Chinese preference text.");
      }
      if (content.length > 200) {
        return toolError("content is too long", undefined, "compress the memory to 200 Chinese characters or less.");
      }

      const category = readMemoryCategory(params.category);
      const permission = await requestWorkspaceToolPermission(runtime, {
        label: "记住用户偏好",
        name: "remember_user_preference",
        requiresPreflight: false,
        risk: "safe-write"
      }, params);
      if (permission) {
        return permission;
      }

      try {
        const result = await runtime.memoryStore.add({
          ...(category ? { category } : {}),
          content
        });
        if ("ok" in result && result.ok === false) {
          return toolError(
            "similar memory already exists",
            `Existing memory: [${result.conflictsWith.id}] ${result.conflictsWith.content}. Similarity: ${result.similarity}.`,
            result.suggestedNext
          );
        }

        if (!("id" in result)) {
          return toolError("memory write failed", "unexpected memory store response");
        }

        return toolOk(`已记录新记忆 ${result.id}：${result.content}`, { memory: result });
      } catch (error) {
        return toolError("memory write failed", error instanceof Error ? error.message : String(error));
      }
    }
  };
}

function createForgetUserPreferenceTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "forget_user_preference",
    label: "删除记忆条目",
    risk: "destructive",
    requiresPreflight: false,
    description:
      "Delete one remembered preference by id. Use when the user asks to forget, remove, or no longer apply a specific remembered item. Parameters: memoryId is an id from list_remembered_preferences.",
    parameters: objectParameters({ memoryId: "Id from list_remembered_preferences." }, ["memoryId"]),
    async execute(_toolCallId, params) {
      if (!runtime.memoryStore) {
        return toolError("memory unavailable", undefined, "run this tool only when the agent memory store is configured.");
      }

      const memoryId = readString(params.memoryId);
      if (!memoryId) {
        return toolError("memoryId is required", undefined, "call list_remembered_preferences and pass one returned id.");
      }

      const permission = await requestWorkspaceToolPermission(runtime, {
        label: "删除记忆条目",
        name: "forget_user_preference",
        requiresPreflight: false,
        risk: "destructive"
      }, params);
      if (permission) {
        return permission;
      }

      const result = await runtime.memoryStore.remove(memoryId);
      if (!result.removed) {
        return toolError("memory not found", undefined, "call list_remembered_preferences and pass one returned id.");
      }

      return toolOk(`已删除记忆 ${result.removed.id}：${result.removed.content}`, { memory: result.removed });
    }
  };
}

function createUndoLastActionsTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return {
    name: "undo_last_actions",
    label: "撤销最近操作",
    risk: "destructive",
    requiresPreflight: false,
    description:
      "Undo the most recent N reversible workspace actions in this project. Use when the user asks to undo, revert, take back, or restore the previous state. Not all actions are reversible: image generation, packaging, and physical file deletion cannot be undone. Parameters: count is optional 1..10, default 1.",
    parameters: objectParameters({ count: "Optional 1..10, default 1." }, []),
    async execute(_toolCallId, params) {
      const permission = await requestWorkspaceToolPermission(runtime, {
        label: "撤销最近操作",
        name: "undo_last_actions",
        requiresPreflight: false,
        risk: "destructive"
      }, params);
      if (permission) {
        return permission;
      }

      const count = Math.min(10, Math.max(1, readInteger(params.count) || 1));
      const mutation = await runtime.applyMutation(
        (state) => undoLastWorkbenchActions(state, count, runtime.getSinkRevision?.()),
        { countRevision: false }
      );
      if (!mutation.result.ok) {
        return toolError(mutation.result.reason, mutation.result.detail, mutation.result.suggestedNext);
      }

      return toolOk(mutation.result.summary, {
        affectedSessionIds: mutation.result.affectedSessionIds
      });
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
      const sessionId = readString(params.sessionId);
      const recordIndex = readInteger(params.recordIndex);
      const request = {
        ...(Number.isInteger(recordIndex) ? { recordIndex } : {}),
        sessionId
      };

      return capabilityResultToToolResult(await readImageMetadataCapability(toWorkbenchCapabilityRuntime(runtime), request));
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
    risk: "safe-write",
    requiresPreflight: true,
    description:
      "Package generated images into a zip file on the desktop. Use this when the user asks to package, export, zip, or put generated images on the desktop; do not just say you will package them. Calling this tool is what creates the preflight confirmation card; the UI will show a confirmation card and this turn will wait for the user to execute, modify, or cancel it. Never ask for confirmation in plain text instead. Use sessionIds only from list_sessions; omit sessionIds to package all generated images.",
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

      const permission = await requestWorkspaceToolPermission(runtime, { label: "打包生成图", name: "package_generated_images", requiresPreflight: true, risk: "safe-write" }, params);
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

      if (decision.decision === "modify") {
        return toolError("package preflight cannot be modified", undefined, "Cancel and ask the user what package settings to use.");
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
      "Generate or edit a single image through the BatchImager project image API. Use this for requests such as background removal, watermark removal, white-background product images, restyling, or creating a new image. This always requires a preflight confirmation before execution: the UI will show a confirmation card and this turn will wait for the user to execute, modify, or cancel it. Do not ask clarifying or confirmation questions in plain text if you have enough information to call this tool. Image results are always added as new workspace images: use target.type='new'. For a new result based on an existing workspace image, use mode='edit' with target.type='new' and target.sourceSessionId; the tool will create/copy the new session after the user approves. Do not call duplicate_session just to prepare generation. If the user wants another workspace image or a turn attachment used as a visual reference, pass its id in referenceImageIds. referenceImageIds is the exact API upload order. When multiple images have different roles, also pass referenceImageNames with the same length/order and write the prompt using those local names, not user-facing 【图片N】 labels. Only pass size when the user clearly requested a concrete size, 2K/4K, square, orientation, or aspect ratio; omit size to keep the source image or first reference image ratio.",
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
      "Run multiple image generation/edit commands through the BatchImager project image API. Use for multi-image, batch, all, or 'this set' requests. This always requires one preflight card before execution: the UI will show a confirmation card and this turn will wait for the user to execute, modify, or cancel it. Do not ask clarifying or confirmation questions in plain text if you have enough information to call this tool. For a large request, submit at most 10 commands in one preflight card, wait for the user decision, then submit the next card only if the user executed or modified the previous one. Every command must explicitly set mode='edit' or mode='generate'; there is no default mode. Image results are always added as new workspace images: use target.type='new'. For new results based on existing workspace images, use mode='edit' with target.type='new' and target.sourceSessionId for each source image; the tool will create/copy the target sessions after approval. Do not call duplicate_session just to prepare generation. If the user wants a workspace image or turn attachment used as a visual reference, pass its id in each command's referenceImageIds. referenceImageIds is the exact API upload order. When multiple images have different roles, also pass referenceImageNames with the same length/order and write each prompt using those local names, not user-facing 【图片N】 labels. Omit size unless the user explicitly requests a size or ratio; without size each command keeps its source/first-reference ratio.",
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
      return capabilityResultToToolResult(await scanUnreferencedFilesCapability(toWorkbenchCapabilityRuntime(runtime)));
    }
  };
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
      return capabilityResultToToolResult(getProjectOverviewCapability(toWorkbenchCapabilityRuntime(runtime)));
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
      "List all image sessions in the current BatchImager project. Use before workspace writes. Returns stable id, displayLabel, and referenceImageId. Always pass stable session id to target tools. When a workspace image must be sent to the image API as a visual reference, pass its referenceImageId in referenceImageIds; mentioning an image in prompt text is not enough.",
    parameters: emptyParameters(),
    async execute() {
      return capabilityResultToToolResult(listSessionsCapability(toWorkbenchCapabilityRuntime(runtime)));
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
      return capabilityResultToToolResult(getSessionRecordsCapability(toWorkbenchCapabilityRuntime(runtime), { sessionId }));
    }
  };
}

function createRestoreSessionRecordTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return reversibleMutationTool({
    description: "Restore a session to a previous generated record. Call list_sessions and get_session_records first. recordIndex is 1-based.",
    label: "回退记录",
    name: "restore_session_record",
    parameters: objectParameters({ recordIndex: "1-based generated record index.", sessionId: "Stable session id." }, ["sessionId", "recordIndex"]),
    mutate: (state, params) => restoreWorkbenchSessionRecord(state, { sessionId: readString(params.sessionId), recordIndex: readInteger(params.recordIndex) }),
    runtime
  });
}

function createRestoreOriginalTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return reversibleMutationTool({
    description: "Restore a session to its original imported image. Call list_sessions first. Does not delete generated records.",
    label: "恢复原图",
    name: "restore_original",
    parameters: objectParameters({ sessionId: "Stable session id from list_sessions." }, ["sessionId"]),
    mutate: (state, params) => restoreOriginalWorkbenchImage(state, { sessionId: readString(params.sessionId) }),
    runtime
  });
}

function createRenameSessionTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return reversibleMutationTool({
    description: "Rename one image session's display fileName. Call list_sessions first. Does not rename files on disk.",
    label: "重命名图片",
    name: "rename_session",
    parameters: objectParameters({ fileName: "New non-empty display fileName.", sessionId: "Stable session id from list_sessions." }, ["sessionId", "fileName"]),
    mutate: (state, params) => renameWorkbenchSession(state, { fileName: readString(params.fileName), sessionId: readString(params.sessionId) }),
    runtime
  });
}

function createReorderSessionsTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return reversibleMutationTool({
    description: "Reorder all image sessions. sessionIds must be a complete permutation of stable ids from list_sessions.",
    label: "调整顺序",
    name: "reorder_sessions",
    parameters: objectParameters({ sessionIds: "Complete ordered list of stable session ids from list_sessions." }, ["sessionIds"]),
    mutate: (state, params) => reorderWorkbenchSessions(state, { sessionIds: readStringArray(params.sessionIds) }),
    runtime
  });
}

function createSetSessionPromptTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return reversibleMutationTool({
    description: "Set one image session's default prompt for future generation. Does not call the image API.",
    label: "设置提示词",
    name: "set_session_prompt",
    parameters: objectParameters({ prompt: "Non-empty default prompt.", sessionId: "Stable session id from list_sessions." }, ["sessionId", "prompt"]),
    mutate: (state, params) => setWorkbenchSessionPrompt(state, { prompt: readString(params.prompt), sessionId: readString(params.sessionId) }),
    runtime
  });
}

function createDeleteSessionRecordTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return reversibleMutationTool({
    description: "Logically delete one generated record from a session. Call list_sessions and get_session_records first. Does not delete files from disk.",
    label: "删除记录",
    name: "delete_session_record",
    parameters: objectParameters({ recordIndex: "1-based generated record index.", sessionId: "Stable session id." }, ["sessionId", "recordIndex"]),
    risk: "destructive",
    mutate: (state, params) => deleteWorkbenchSessionRecord(state, { sessionId: readString(params.sessionId), recordIndex: readInteger(params.recordIndex) }),
    runtime
  });
}

function createDeleteSessionTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return reversibleMutationTool({
    description: "Delete one image session from the workspace. Call list_sessions first. This only removes workspace references.",
    label: "删除图片",
    name: "delete_session",
    parameters: objectParameters({ sessionId: "Stable session id from list_sessions." }, ["sessionId"]),
    risk: "destructive",
    mutate: (state, params) => deleteWorkbenchSession(state, { sessionId: readString(params.sessionId) }),
    runtime
  });
}

function createMergeSessionsTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return reversibleMutationTool({
    description: "Merge generated records from source sessions into a target session, then remove source sessions. Call list_sessions first.",
    label: "合并图片",
    name: "merge_sessions",
    parameters: objectParameters(
      { sourceSessionIds: "Stable source session ids.", targetSessionId: "Stable target session id." },
      ["targetSessionId", "sourceSessionIds"]
    ),
    mutate: (state, params) =>
      mergeWorkbenchSessions(state, {
        sourceSessionIds: readStringArray(params.sourceSessionIds),
        targetSessionId: readString(params.targetSessionId)
      }),
    risk: "destructive",
    runtime
  });
}

function createSplitSessionTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return reversibleMutationTool({
    description:
      "Split selected generated records from one session into a new independent session. Call list_sessions and get_session_records first. recordIndexes are 1-based and must leave the source session with at least one record.",
    label: "拆分图片",
    name: "split_session",
    parameters: splitSessionParameters(),
    risk: "destructive",
    mutate: (state, params) =>
      splitWorkbenchSession(state, {
        fileName: readString(params.fileName),
        recordIndexes: readIntegerArray(params.recordIndexes),
        sessionId: readString(params.sessionId)
      }),
    runtime
  });
}

function createDuplicateSessionTool(runtime: EsseWorkspaceToolRuntime): BatchImagerAgentTool {
  return reversibleMutationTool({
    description:
      "Duplicate one image session including its current image and generated record references. The image files are not copied. Use when the user wants a parallel copy to compare or experiment without affecting the original.",
    label: "复制图片",
    name: "duplicate_session",
    parameters: objectParameters({ fileName: "Optional display fileName for the duplicate.", sessionId: "Stable source session id." }, ["sessionId"]),
    mutate: (state, params) =>
      duplicateWorkbenchSession(state, {
        fileName: readString(params.fileName),
        sessionId: readString(params.sessionId)
      }),
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
    ...derivePermissionContext(tool.name, params),
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

function derivePermissionContext(toolName: string, params: Record<string, unknown>): Pick<EsseWorkspacePermissionRequest, "affectedDisplayLabel" | "affectedFileName" | "targetKey"> {
  const target = params.target && typeof params.target === "object" ? params.target as Record<string, unknown> : undefined;
  const sessionId = readString(params.sessionId) || readString(target?.sessionId);
  const displayLabel = readString(params.displayLabel);
  const fileName = readString(params.fileName) || readString(target?.fileName);
  const relativePath = readString(params.relativePath);
  const referenceImageId = readString(params.referenceImageId);
  const memoryId = readString(params.memoryId);
  const targetKey = sessionId || referenceImageId || memoryId || fileName || relativePath || "global";

  return {
    ...(displayLabel ? { affectedDisplayLabel: displayLabel } : {}),
    ...(fileName ? { affectedFileName: fileName } : {}),
    targetKey: `${toolName}:${targetKey}`
  };
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

function reversibleMutationTool(options: {
  description: string;
  label: string;
  mutate: (state: EsseWorkspaceState, params: Record<string, unknown>) => { result: WorkspaceMutationResult; state: EsseWorkspaceState };
  name: string;
  parameters: Record<string, unknown>;
  risk?: BatchImagerAgentToolRisk;
  runtime: EsseWorkspaceToolRuntime;
}): BatchImagerAgentTool {
  return mutationTool({
    ...options,
    mutate: (state, params) => {
      const mutation = options.mutate(state, params);
      if (!mutation.result.ok) {
        return mutation;
      }

      return {
        result: mutation.result,
        state: appendWorkbenchUndoEntry(mutation.state, createWorkbenchUndoEntry({
          affectedSessionIds: mutation.result.affectedSessionIds,
          beforeState: state,
          sinkRevisionAfter: nextSinkRevision(options.runtime),
          summary: mutation.result.summary,
          toolName: options.name
        }))
      };
    }
  });
}

function nextSinkRevision(runtime: EsseWorkspaceToolRuntime): number | undefined {
  const currentRevision = runtime.getSinkRevision?.();
  return currentRevision === undefined ? undefined : currentRevision + 1;
}

async function executePreflightImageTool(
  runtime: EsseWorkspaceToolRuntime,
  request: EsseImagePreflightExecutionRequest
): Promise<AgentToolResult> {
  if (!runtime.requestPreflight) {
    return toolError("preflight unavailable", undefined, "image API tools must be executed through an Esse preflight runtime.");
  }

  const referenceImages = collectPreflightReferenceImages(runtime, request.commands);
  const payload: EssePreflightPayload = {
    commands: request.commands,
    estimatedApiCalls: request.commands.length,
    ...(referenceImages ? { referenceImages } : {}),
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

  const commands = decision.decision === "modify" ? validateModifiedPreflightCommands(request.commands, decision.modifiedCommands) : request.commands;
  if (!Array.isArray(commands)) {
    return toolError(commands.reason, commands.detail, commands.suggestedNext);
  }

  if (!runtime.executeImagePreflightTool) {
    return toolError("image execution unavailable", undefined, "preflight was confirmed, but no image executor is configured.");
  }

  const result = await runtime.executeImagePreflightTool({ ...request, commands });
  if (!result.ok) {
    return toolError(result.reason, result.detail, result.suggestedNext);
  }

  return toolOk(result.summary, {
    affectedSessionIds: result.affectedSessionIds
  });
}

function validateModifiedPreflightCommands(
  originalCommands: EssePreflightCommand[],
  modifiedCommands: EssePreflightCommand[]
): EssePreflightCommand[] | Extract<WorkspaceMutationResult, { ok: false }> {
  if (modifiedCommands.length !== originalCommands.length) {
    return {
      ok: false,
      reason: "invalid modified preflight commands",
      detail: "modified command count must match the original preflight command count.",
      suggestedNext: "Cancel and ask the user to retry with the intended changes."
    };
  }

  const normalizedModifiedCommands: EssePreflightCommand[] = [];
  for (const [index, modifiedCommand] of modifiedCommands.entries()) {
    const originalCommand = originalCommands[index];
    if (!isSamePreflightTarget(originalCommand.target, modifiedCommand.target)) {
      return {
        ok: false,
        reason: "invalid modified preflight commands",
        detail: `modified command ${index + 1} changed its target.`,
        suggestedNext: "Only prompt, mode, size, referenceImageIds, and referenceImageNames may be changed in preflight modify."
      };
    }

    if (modifiedCommand.mode !== "edit" && modifiedCommand.mode !== "generate") {
      return {
        ok: false,
        reason: "invalid modified preflight commands",
        detail: `modified command ${index + 1} has invalid mode.`,
        suggestedNext: "Choose edit or generate."
      };
    }

    if (!readString(modifiedCommand.prompt)) {
      return {
        ok: false,
        reason: "invalid modified preflight commands",
        detail: `modified command ${index + 1} has empty prompt.`,
        suggestedNext: "Provide a non-empty prompt."
      };
    }

    const referenceImageIds = modifiedCommand.referenceImageIds ?? [];
    const referenceNamingResult = normalizeReferenceImageNames(referenceImageIds, modifiedCommand.referenceImageNames ?? []);
    if (!referenceNamingResult.ok) {
      return {
        ...referenceNamingResult,
        detail: `modified command ${index + 1}: ${referenceNamingResult.reason}`
      };
    }

    const normalizedModifiedCommand = { ...modifiedCommand };
    if (referenceNamingResult.referenceImageNames.length) {
      normalizedModifiedCommand.referenceImageNames = referenceNamingResult.referenceImageNames;
    } else {
      delete normalizedModifiedCommand.referenceImageNames;
    }
    normalizedModifiedCommands.push(normalizedModifiedCommand);
  }

  return normalizedModifiedCommands.map((command, index) => ({
    ...originalCommands[index],
    ...command,
    target: originalCommands[index].target
  }));
}

function isSamePreflightTarget(left: EssePreflightCommand["target"], right: EssePreflightCommand["target"]): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
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
  const referenceImageIds = readStringArray(params.referenceImageIds);
  const referenceNamingResult = normalizeReferenceImageNames(referenceImageIds, readStringArray(params.referenceImageNames));
  if (!referenceNamingResult.ok) {
    return referenceNamingResult;
  }
  const referenceImageNames = referenceNamingResult.referenceImageNames;
  const size = readString(params.size);
  if (!target) {
    return {
      ok: false,
      reason: "target is required",
      suggestedNext: "use target.type='new'. For new results based on an existing image, include target.sourceSessionId; for clicked images, include referenceImageIds and referenceImageNames that match the prompt roles."
    };
  }
  if (mode === "edit" && target.type === "new" && !target.sourceSessionId && referenceImageIds.length === 0) {
    return {
      ok: false,
      reason: "edit mode with a new target requires sourceSessionId or referenceImageIds",
      suggestedNext: "For a new image based on an existing workspace image, include target.sourceSessionId. For clicked/attached inputs, include referenceImageIds."
    };
  }
  if (target.type === "new" && target.sourceSessionId && mode !== "edit") {
    return {
      ok: false,
      reason: "new target with sourceSessionId requires edit mode",
      suggestedNext: "use mode='edit' with target.type='new' and sourceSessionId so the source image is sent to the edit API."
    };
  }

  if (target.type === "new") {
    const sourceSessionIndex = target.sourceSessionId
      ? state.sessions.findIndex((session) => session.id === target.sourceSessionId)
      : -1;
    if (target.sourceSessionId && sourceSessionIndex < 0) {
      return {
        ok: false,
        reason: "source session not found",
        detail: `no session with id ${target.sourceSessionId}`,
        suggestedNext: "call list_sessions to list current ids."
      };
    }

    return {
      command: {
        ...(sourceSessionIndex >= 0 ? { displayLabel: `img-${sourceSessionIndex + 1}` } : {}),
        mode,
        prompt,
        ...(referenceImageIds.length ? { referenceImageIds } : {}),
        ...(referenceImageNames.length ? { referenceImageNames } : {}),
        ...(size ? { size } : {}),
        target: {
          type: "new",
          ...(target.fileName ? { fileName: target.fileName } : {}),
          ...(target.sourceSessionId ? { sourceSessionId: target.sourceSessionId } : {})
        }
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
      mode: "edit",
      prompt,
      ...(referenceImageIds.length ? { referenceImageIds } : {}),
      ...(referenceImageNames.length ? { referenceImageNames } : {}),
      ...(size ? { size } : {}),
      target: { sourceSessionId: target.sessionId, type: "new" }
    },
    ok: true
  };
}

function normalizeReferenceImageNames(
  referenceImageIds: string[],
  referenceImageNames: string[]
): { ok: true; referenceImageNames: string[] } | Extract<WorkspaceMutationResult, { ok: false }> {
  if (!referenceImageNames.length) {
    return {
      ok: true,
      referenceImageNames: referenceImageIds.length > 1 ? referenceImageIds.map((_, index) => `参考图${index + 1}`) : []
    };
  }

  if (referenceImageNames.length !== referenceImageIds.length) {
    return {
      ok: false,
      reason: "referenceImageNames must match referenceImageIds",
      suggestedNext: "Provide one referenceImageNames entry for each referenceImageIds entry, in the same order, or omit referenceImageNames and let the tool assign neutral names."
    };
  }

  return { ok: true, referenceImageNames };
}

function readTarget(value: unknown): { fileName?: string; sourceSessionId?: string; type: "new" } | { sessionId: string; type: "existing" } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const target = value as Record<string, unknown>;
  if (target.type === "new") {
    const fileName = readString(target.fileName);
    const sourceSessionId = readString(target.sourceSessionId);
    return { type: "new", ...(fileName ? { fileName } : {}), ...(sourceSessionId ? { sourceSessionId } : {}) };
  }
  if (target.type === "existing") {
    const sessionId = readString(target.sessionId);
    return sessionId ? { sessionId, type: "existing" } : undefined;
  }

  return undefined;
}

function getCurrentImageSource(session: PersistedImageSession): "generated" | "original" {
  if (session.originatedFromGeneration) {
    return "generated";
  }

  return session.generatedFilePath ? "generated" : "original";
}

function getCurrentImagePath(session: PersistedImageSession): string {
  return session.generatedFilePath ?? session.filePath;
}

function getWorkspaceReferenceImageId(sessionId: string): string {
  return `workspace-ref-${sessionId}`;
}

function basenameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function formatReferenceImage(referenceImage: BatchPlanReferenceImage): { fileName: string; id: string; label: string } {
  return {
    fileName: basenameFromPath(referenceImage.filePath),
    id: referenceImage.id,
    label: referenceImage.label
  };
}

function collectPreflightReferenceImages(
  runtime: EsseWorkspaceToolRuntime,
  commands: EssePreflightCommand[]
): BatchPlanReferenceImage[] | undefined {
  const requestedIds = new Set(commands.flatMap((command) => command.referenceImageIds ?? []));
  if (requestedIds.size === 0) {
    return undefined;
  }

  const byId = new Map<string, BatchPlanReferenceImage>();
  for (const referenceImage of runtime.getState().referenceImages ?? []) {
    byId.set(referenceImage.id, referenceImage);
  }
  for (const plan of runtime.getState().projectManagerState?.plans ?? []) {
    for (const referenceImage of plan.referenceImages ?? []) {
      byId.set(referenceImage.id, referenceImage);
    }
  }
  for (const message of runtime.getState().projectManagerState?.conversation.messages ?? []) {
    for (const referenceImage of message.batchTask?.referenceImages ?? []) {
      byId.set(referenceImage.id, referenceImage);
    }
  }
  for (const conversationReferenceImage of getConversationReferenceImages(runtime.getState())) {
    byId.set(conversationReferenceImage.id, conversationReferenceImage);
  }
  for (const workspaceReferenceImage of getWorkspaceReferenceImages(runtime.getState())) {
    byId.set(workspaceReferenceImage.id, workspaceReferenceImage);
  }
  for (const turnReferenceImage of getTurnReferenceImages(runtime)) {
    byId.set(turnReferenceImage.id, turnReferenceImage);
  }

  const referenceImages = [...requestedIds]
    .map((id) => byId.get(id))
    .filter((referenceImage): referenceImage is BatchPlanReferenceImage => Boolean(referenceImage));

  return referenceImages.length ? referenceImages : undefined;
}

function getTurnReferenceImages(runtime: EsseWorkspaceToolRuntime): BatchPlanReferenceImage[] {
  return (runtime.getTurnReferenceImagePaths?.() ?? []).map((filePath, index) => ({
    filePath,
    id: `turn-ref-${index + 1}`,
    label: `本轮参考图 ${index + 1}`
  }));
}

function getConversationReferenceImages(state: EsseWorkspaceState): BatchPlanReferenceImage[] {
  const seen = new Set<string>();
  const referenceImages: BatchPlanReferenceImage[] = [];

  for (const message of state.projectManagerState?.conversation.messages ?? []) {
    for (const filePath of message.referenceFilePaths ?? []) {
      const trimmedPath = filePath.trim();
      if (!trimmedPath || seen.has(trimmedPath)) {
        continue;
      }
      seen.add(trimmedPath);
      referenceImages.push({
        filePath: trimmedPath,
        id: `conversation-ref-${referenceImages.length + 1}`,
        label: `对话参考图 ${referenceImages.length + 1}`
      });
    }
  }

  return referenceImages;
}

function getWorkspaceReferenceImages(state: EsseWorkspaceState): BatchPlanReferenceImage[] {
  return state.sessions.map((session, index) => ({
    filePath: getCurrentImagePath(session),
    id: getWorkspaceReferenceImageId(session.id),
    label: `图${index + 1} ${session.fileName}`
  }));
}

function isSupportedReferenceImagePath(filePath: string): boolean {
  return /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i.test(filePath);
}

function toWorkbenchCapabilityRuntime(runtime: EsseWorkspaceToolRuntime): BatchImagerWorkbenchCapabilityRuntime {
  return {
    state: runtime.getState(),
    ...(runtime.getTurnReferenceImagePaths ? { getTurnReferenceImagePaths: runtime.getTurnReferenceImagePaths } : {}),
    ...(runtime.memoryStore ? { memoryStore: runtime.memoryStore } : {}),
    ...(runtime.readImageMetadata ? { readImageMetadata: runtime.readImageMetadata } : {}),
    ...(runtime.scanUnreferencedFiles ? { scanUnreferencedFiles: runtime.scanUnreferencedFiles } : {})
  };
}

function capabilityResultToToolResult<TDetails extends Record<string, unknown>>(
  result: BatchImagerWorkbenchCapabilityResult<TDetails>
): AgentToolResult {
  return result.ok ? toolOk(result.text, result.details) : toolError(result.reason, result.detail, result.suggestedNext);
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

function addWorkspaceImageParameters(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      fileName: { type: "string", description: "Legacy single-image display fileName. Prefer images[].fileName for multiple images." },
      filePath: {
        type: "string",
        description:
          "Legacy single-image local file path from a prior tool result, current turn attachment, or another explicit available local source."
      },
      images: {
        type: "array",
        items: {
          type: "object",
          properties: {
            fileName: { type: "string", description: "Optional display fileName for this workspace image." },
            filePath: { type: "string", description: "Exact local image file path from an available tool result or attachment." }
          },
          required: ["filePath"],
          additionalProperties: false
        },
        description:
          "Preferred way to add multiple images to the left workspace in one tool call, e.g. PPT-exported pages."
      }
    },
    additionalProperties: false
  };
}

function imageGenerationParameters(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["edit", "generate"], description: "Explicit generation mode. Use edit with target.sourceSessionId for existing workspace sources; use generate with referenceImageIds for clicked/attached turn-ref sources." },
      prompt: { type: "string", description: "Image generation prompt." },
      referenceImageIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional visual reference image ids. Use project reference ids from list_reference_images, turn-ref-N for current-turn attachments, or workspace referenceImageId values from list_sessions. This array is the exact API upload order. Prompt text that mentions 图N does not attach that image or change its role."
      },
      referenceImageNames: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional local names for the uploaded images, in the same order and same length as referenceImageIds, such as ['场景图','目标植物','大小参考']. Use these names in the prompt so the API sees an unambiguous image-role mapping without relying on user-facing 【图片N】 labels."
      },
      size: { type: "string", description: "Optional explicit output size. Omit unless the user clearly requested it; omitted size keeps the source or first reference image ratio." },
      target: {
        type: "object",
        properties: {
          fileName: { type: "string", description: "Optional file name for target.type='new'." },
          sessionId: { type: "string", description: "Legacy stable session id for target.type='existing'. The tool converts this to a new target so image results do not overwrite the source." },
          sourceSessionId: { type: "string", description: "Stable source session id for target.type='new' when the new image should be based on an existing workspace image. The tool creates/copies the target session after approval." },
          type: { type: "string", enum: ["existing", "new"], description: "Output target. Use new; existing is accepted only as a legacy alias and is converted to new+sourceSessionId." }
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

function splitSessionParameters(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      fileName: { type: "string", description: "Optional fileName for the new session." },
      recordIndexes: { type: "array", items: { type: "integer" }, description: "1-based record indexes to move into the new session." },
      sessionId: { type: "string", description: "Stable source session id." }
    },
    required: ["sessionId", "recordIndexes"],
    additionalProperties: false
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readMemoryCategory(value: unknown): EsseMemoryCategory | undefined {
  const category = readString(value);
  return category === "用户偏好" || category === "默认约束" || category === "工作流惯例" ? category : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function readIntegerArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(readInteger).filter((item) => Number.isInteger(item));
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
