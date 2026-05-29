import type { AgentToolResult } from "./batchImagerAgentTools";
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
import {
  listBatchImagerWorkbenchCapabilities,
  type BatchImagerWorkbenchCapabilityId
} from "./batchImagerWorkbenchCapabilities";

export const BATCH_IMAGER_WORKBENCH_EXTENSION_ID = "batchimager-workbench";
export const BATCH_IMAGER_WORKBENCH_EXTENSION_TOOL_NAMES: BatchImagerWorkbenchCapabilityId[] =
  listBatchImagerWorkbenchCapabilities().map((capability) => capability.id);

export type ControlledExtensionToolDefinition = {
  description: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown
  ) => Promise<AgentToolResult>;
  label: string;
  name: string;
  parameters: unknown;
};

export type BatchImagerControlledExtensionFactory = (pi: {
  registerTool: (tool: ControlledExtensionToolDefinition) => void;
}) => void | Promise<void>;

export function createBatchImagerWorkbenchExtension(
  getRuntime: () => BatchImagerWorkbenchCapabilityRuntime,
  options: { additionalTools?: ControlledExtensionToolDefinition[] } = {}
): BatchImagerControlledExtensionFactory {
  return (pi) => {
    for (const tool of mergeExtensionTools(createBatchImagerWorkbenchExtensionTools(getRuntime), options.additionalTools ?? [])) {
      pi.registerTool(tool);
    }
  };
}

export function createBatchImagerWorkbenchExtensionTools(
  getRuntime: () => BatchImagerWorkbenchCapabilityRuntime
): ControlledExtensionToolDefinition[] {
  return [
    {
      name: "get_project_overview",
      label: "项目概览",
      description:
        "Get project metadata for the current BatchImager project. Use when the user asks about the project name, image count, selected session, or workspace summary.",
      parameters: emptyParameters(),
      async execute() {
        return capabilityResultToToolResult(getProjectOverviewCapability(getRuntime()));
      }
    },
    {
      name: "list_sessions",
      label: "列出工作区",
      description:
        "List all image sessions in the current BatchImager project. Use before workspace writes. Returns stable id, displayLabel, and referenceImageId. Always pass stable session id to target tools. When a workspace image must be sent to the image API as a visual reference, pass its referenceImageId in referenceImageIds; mentioning an image in prompt text is not enough.",
      parameters: emptyParameters(),
      async execute() {
        return capabilityResultToToolResult(listSessionsCapability(getRuntime()));
      }
    },
    {
      name: "get_session_records",
      label: "查看图片记录",
      description:
        "Get generated records for one session. Use before restore_session_record or delete_session_record. recordIndex is 1-based.",
      parameters: objectParameters({
        sessionId: stringParameter("Stable session id from list_sessions.")
      }, ["sessionId"]),
      async execute(_toolCallId, params) {
        const sessionId = readString(params.sessionId);
        return capabilityResultToToolResult(getSessionRecordsCapability(getRuntime(), { sessionId }));
      }
    },
    {
      name: "read_image_metadata",
      label: "读取图片信息",
      description:
        "Read width, height, format, and byte size for a workspace image without exposing file paths. Use sessionId from list_sessions. Omit recordIndex to inspect the session's current displayed image; pass 1-based recordIndex only after get_session_records when the user asks about a specific generated record.",
      parameters: objectParameters({
        recordIndex: {
          anyOf: [
            numberParameter("Optional 1-based generated record index. Omit for the current displayed image."),
            stringParameter("Optional 1-based generated record index. Omit for the current displayed image.")
          ]
        },
        sessionId: stringParameter("Stable session id from list_sessions.")
      }, ["sessionId"]),
      async execute(_toolCallId, params) {
        const request: BatchImagerImageMetadataRequest = {
          ...(Number.isInteger(readInteger(params.recordIndex)) ? { recordIndex: readInteger(params.recordIndex) } : {}),
          sessionId: readString(params.sessionId)
        };
        return capabilityResultToToolResult(await readImageMetadataCapability(getRuntime(), request));
      }
    },
    {
      name: "list_reference_images",
      label: "列出参考图",
      description:
        "List reference images registered on the current project, reusable conversation attachment candidates, plus any images attached in this turn. Turn attachments are temporary and can be passed directly as referenceImageIds such as turn-ref-1; conversation candidates use conversation-ref-N. Do not add them to the project unless the user explicitly asks to save/register them.",
      parameters: emptyParameters(),
      async execute() {
        return capabilityResultToToolResult(listReferenceImagesCapability(getRuntime()));
      }
    },
    {
      name: "list_remembered_preferences",
      label: "列出已记忆条目",
      description:
        "List all currently remembered user preferences with their ids and categories. Use when the user asks what Esse remembers, or before forget_user_preference.",
      parameters: emptyParameters(),
      async execute() {
        return capabilityResultToToolResult(await listRememberedPreferencesCapability(getRuntime()));
      }
    },
    {
      name: "scan_unreferenced_files",
      label: "扫描未引用文件",
      description:
        "Scan the project generated-image directory for files not referenced by any session, chat message, or project report. Read-only. Returns candidateId values; never returns file paths.",
      parameters: emptyParameters(),
      async execute() {
        return capabilityResultToToolResult(await scanUnreferencedFilesCapability(getRuntime()));
      }
    }
  ];
}

export function toBatchImagerWorkbenchCapabilityRuntime(runtime: {
  getState: () => BatchImagerWorkbenchCapabilityRuntime["state"];
  getTurnReferenceImagePaths?: BatchImagerWorkbenchCapabilityRuntime["getTurnReferenceImagePaths"];
  memoryStore?: BatchImagerWorkbenchCapabilityRuntime["memoryStore"];
  readImageMetadata?: BatchImagerWorkbenchCapabilityRuntime["readImageMetadata"];
  scanUnreferencedFiles?: BatchImagerWorkbenchCapabilityRuntime["scanUnreferencedFiles"];
}): BatchImagerWorkbenchCapabilityRuntime {
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
        text: [
          `Reason: ${reason}.`,
          detail ? `Detail: ${detail}` : undefined,
          suggestedNext ? `Suggested next: ${suggestedNext}` : undefined
        ]
          .filter(Boolean)
          .join("\n")
      }
    ],
    isError: true
  };
}

function emptyParameters() {
  return {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  };
}

function objectParameters(properties: Record<string, unknown>, required: string[]) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function stringParameter(description: string) {
  return {
    type: "string",
    description
  };
}

function numberParameter(description: string) {
  return {
    type: "number",
    description
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readInteger(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return Number.NaN;
}

function mergeExtensionTools(
  baseTools: ControlledExtensionToolDefinition[],
  additionalTools: ControlledExtensionToolDefinition[]
): ControlledExtensionToolDefinition[] {
  const byName = new Map<string, ControlledExtensionToolDefinition>();
  for (const tool of baseTools) {
    byName.set(tool.name, tool);
  }
  for (const tool of additionalTools) {
    byName.set(tool.name, tool);
  }
  return [...byName.values()];
}
