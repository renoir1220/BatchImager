import type { BatchPlanReferenceImage, EsseMemoryEntry, PersistedImageSession, ProjectSnapshot } from "../ipcTypes";
import type { EsseMemoryStore } from "./esseMemoryStore";
import type { ProjectImageMetadataResult } from "./projectImageMetadata";
import type { UnreferencedFileCandidate } from "./projectUnreferencedFiles";

export type BatchImagerWorkbenchCapabilityResult<TDetails extends Record<string, unknown>> =
  | { details: TDetails; ok: true; text: string }
  | { detail?: string; ok: false; reason: string; suggestedNext?: string };

export interface BatchImagerWorkbenchCapabilityRuntime {
  getTurnReferenceImagePaths?: () => string[];
  memoryStore?: EsseMemoryStore;
  readImageMetadata?: (request: BatchImagerImageMetadataRequest) => Promise<ProjectImageMetadataResult>;
  scanUnreferencedFiles?: () => Promise<UnreferencedFileCandidate[]>;
  state: ProjectSnapshot;
}

export interface BatchImagerImageMetadataRequest {
  recordIndex?: number;
  sessionId: string;
}

interface WorkspaceSessionSummary {
  currentImageSource: "generated" | "original";
  displayLabel: string;
  fileName: string;
  generatedRecordCount: number;
  id: string;
  isSelected: boolean;
  referenceImageId: string;
}

interface SessionRecordSummary {
  fileName: string;
  isCurrent: boolean;
  isPrimary?: boolean;
  recordIndex: number;
}

export function getProjectOverviewCapability(
  runtime: BatchImagerWorkbenchCapabilityRuntime
): BatchImagerWorkbenchCapabilityResult<{
  imageCount: number;
  projectDirectory: string;
  projectId: string;
  projectName: string;
  selectedSessionId: string | null;
}> {
  const { state } = runtime;
  return {
    ok: true,
    text: "已读取项目概览。",
    details: {
      imageCount: state.sessions.length,
      projectDirectory: state.project.directory,
      projectId: state.project.id,
      projectName: state.project.name,
      selectedSessionId: state.selectedSessionId ?? null
    }
  };
}

export function listSessionsCapability(
  runtime: BatchImagerWorkbenchCapabilityRuntime
): BatchImagerWorkbenchCapabilityResult<{ sessions: WorkspaceSessionSummary[] }> {
  const { state } = runtime;
  const sessions = state.sessions.map((session, index) => ({
    currentImageSource: getCurrentImageSource(session),
    displayLabel: `img-${index + 1}`,
    fileName: session.fileName,
    generatedRecordCount: session.generatedFilePaths?.length ?? 0,
    id: session.id,
    isSelected: session.id === state.selectedSessionId,
    referenceImageId: getWorkspaceReferenceImageId(session.id)
  }));

  return {
    ok: true,
    text: formatListSessionsText(sessions),
    details: { sessions }
  };
}

export function getSessionRecordsCapability(
  runtime: BatchImagerWorkbenchCapabilityRuntime,
  request: { sessionId: string }
): BatchImagerWorkbenchCapabilityResult<{ records: SessionRecordSummary[]; sessionId: string }> {
  const session = runtime.state.sessions.find((current) => current.id === request.sessionId);
  if (!session) {
    return {
      ok: false,
      reason: "session not found",
      detail: `no session with id ${request.sessionId}`,
      suggestedNext: "call list_sessions to list current ids."
    };
  }

  const records = (session.generatedFilePaths ?? []).map((filePath, index) => ({
    fileName: basenameFromPath(filePath),
    isCurrent: filePath === session.generatedFilePath && !session.showOriginalInList,
    ...(session.originatedFromGeneration && index === 0 ? { isPrimary: true } : {}),
    recordIndex: index + 1
  }));

  return {
    ok: true,
    text: formatSessionRecordsText(request.sessionId, records),
    details: {
      records,
      sessionId: request.sessionId
    }
  };
}

export async function readImageMetadataCapability(
  runtime: BatchImagerWorkbenchCapabilityRuntime,
  request: BatchImagerImageMetadataRequest
): Promise<BatchImagerWorkbenchCapabilityResult<{ metadata: ProjectImageMetadataResult }>> {
  if (!runtime.readImageMetadata) {
    return {
      ok: false,
      reason: "read_image_metadata unavailable",
      suggestedNext: "run this tool only in a project workspace runtime."
    };
  }

  try {
    const metadata = await runtime.readImageMetadata(request);
    return {
      ok: true,
      text: formatImageMetadata(metadata),
      details: { metadata }
    };
  } catch (error) {
    return {
      ok: false,
      reason: "image metadata unavailable",
      detail: error instanceof Error ? error.message : String(error),
      suggestedNext: "call list_sessions and get_session_records to verify ids."
    };
  }
}

export function listReferenceImagesCapability(
  runtime: BatchImagerWorkbenchCapabilityRuntime
): BatchImagerWorkbenchCapabilityResult<{
  referenceImages: Array<{ fileName: string; id: string; label: string }>;
}> {
  const safeReferenceImages = [
    ...(runtime.state.referenceImages ?? []),
    ...getConversationReferenceImages(runtime.state),
    ...getTurnReferenceImages(runtime)
  ].map((referenceImage) => formatReferenceImage(referenceImage));

  if (!safeReferenceImages.length) {
    return {
      ok: true,
      text: "项目当前没有参考图，本轮也没有附件参考图。",
      details: { referenceImages: [] }
    };
  }

  return {
    ok: true,
    text: safeReferenceImages
      .map((referenceImage, index) => `${index + 1}. id=${referenceImage.id} label=${referenceImage.label} fileName=${referenceImage.fileName}`)
      .join("\n"),
    details: { referenceImages: safeReferenceImages }
  };
}

export async function listRememberedPreferencesCapability(
  runtime: BatchImagerWorkbenchCapabilityRuntime
): Promise<BatchImagerWorkbenchCapabilityResult<{ memories: EsseMemoryEntry[] }>> {
  if (!runtime.memoryStore) {
    return {
      ok: false,
      reason: "memory unavailable",
      suggestedNext: "run this tool only when the agent memory store is configured."
    };
  }

  const entries = await runtime.memoryStore.list();
  if (!entries.length) {
    return { ok: true, text: "当前没有已记忆条目。", details: { memories: [] } };
  }

  return {
    ok: true,
    text: entries.map((entry, index) => `${index + 1}. [${entry.id}] ${entry.category}：${entry.content}`).join("\n"),
    details: { memories: entries }
  };
}

export async function scanUnreferencedFilesCapability(
  runtime: BatchImagerWorkbenchCapabilityRuntime
): Promise<BatchImagerWorkbenchCapabilityResult<{ candidates: UnreferencedFileCandidate[] }>> {
  if (!runtime.scanUnreferencedFiles) {
    return {
      ok: false,
      reason: "scan_unreferenced_files unavailable",
      suggestedNext: "run this tool only in a project workspace runtime."
    };
  }

  const candidates = (await runtime.scanUnreferencedFiles()).map(({ byteSize, candidateId, fileName }) => ({
    byteSize,
    candidateId,
    fileName
  }));
  return {
    ok: true,
    text: formatUnreferencedScanSummary(candidates),
    details: { candidates }
  };
}

function formatListSessionsText(sessions: WorkspaceSessionSummary[]): string {
  if (sessions.length === 0) {
    return "工作区当前没有图片。";
  }

  return [
    "已列出工作区图片。使用 id 作为 sessionId；如果要把某张工作区图片作为生成参考图，使用 referenceImageId。",
    ...sessions.map((session) =>
      [
        `- ${session.displayLabel}`,
        `id=${session.id}`,
        `referenceImageId=${session.referenceImageId}`,
        `fileName=${session.fileName}`,
        `currentImageSource=${session.currentImageSource}`,
        `generatedRecordCount=${session.generatedRecordCount}`,
        session.isSelected ? "selected=true" : undefined
      ]
        .filter(Boolean)
        .join("; ")
    )
  ].join("\n");
}

function formatSessionRecordsText(sessionId: string, records: SessionRecordSummary[]): string {
  if (records.length === 0) {
    return `已列出图片记录：sessionId=${sessionId}，当前没有生成记录。`;
  }

  return [
    `已列出图片记录：sessionId=${sessionId}`,
    ...records.map((record) =>
      [
        `- recordIndex=${record.recordIndex}`,
        `fileName=${record.fileName}`,
        `isCurrent=${record.isCurrent}`,
        record.isPrimary ? "isPrimary=true" : undefined
      ]
        .filter(Boolean)
        .join("; ")
    )
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

function formatUnreferencedScanSummary(candidates: UnreferencedFileCandidate[]): string {
  if (candidates.length === 0) {
    return "已扫描未引用生成文件，没有发现可清理候选。";
  }

  return [
    `已扫描未引用生成文件，发现 ${candidates.length} 个候选：`,
    ...candidates.map((candidate) => `- candidateId=${candidate.candidateId}; fileName=${candidate.fileName}; byteSize=${candidate.byteSize}`)
  ].join("\n");
}

function getCurrentImageSource(session: PersistedImageSession): "generated" | "original" {
  if (session.originatedFromGeneration) {
    return "generated";
  }

  return session.generatedFilePath ? "generated" : "original";
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

function getTurnReferenceImages(runtime: BatchImagerWorkbenchCapabilityRuntime): BatchPlanReferenceImage[] {
  return (runtime.getTurnReferenceImagePaths?.() ?? []).map((filePath, index) => ({
    filePath,
    id: `turn-ref-${index + 1}`,
    label: `本轮参考图 ${index + 1}`
  }));
}

function getConversationReferenceImages(state: ProjectSnapshot): BatchPlanReferenceImage[] {
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
