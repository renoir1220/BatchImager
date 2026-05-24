import { stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { PersistedImageSession, ProjectSnapshot } from "../ipcTypes";

export interface ProjectImageMetadataRequest {
  recordIndex?: number;
  sessionId: string;
}

export interface ProjectImageMetadataResult {
  byteSize: number;
  fileName: string;
  format?: string;
  height: number;
  recordIndex?: number;
  sessionId: string;
  sourceType: "current" | "generated-record" | "original";
  width: number;
}

export async function readProjectImageMetadata(
  snapshot: ProjectSnapshot,
  request: ProjectImageMetadataRequest
): Promise<ProjectImageMetadataResult> {
  const session = snapshot.sessions.find((current) => current.id === request.sessionId);
  if (!session) {
    throw new Error(`no session with id ${request.sessionId}`);
  }

  const resolved = resolveSessionImagePath(session, request.recordIndex);
  const metadata = await sharp(resolved.filePath).metadata();
  const stats = await stat(resolved.filePath);
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width <= 0 || height <= 0) {
    throw new Error("unable to read image dimensions");
  }

  return {
    byteSize: stats.size,
    fileName: path.basename(resolved.filePath),
    ...(metadata.format ? { format: metadata.format } : {}),
    height,
    ...(resolved.recordIndex ? { recordIndex: resolved.recordIndex } : {}),
    sessionId: session.id,
    sourceType: resolved.sourceType,
    width
  };
}

function resolveSessionImagePath(
  session: PersistedImageSession,
  recordIndex: number | undefined
): { filePath: string; recordIndex?: number; sourceType: ProjectImageMetadataResult["sourceType"] } {
  if (recordIndex !== undefined) {
    const records = session.generatedFilePaths ?? [];
    if (!Number.isInteger(recordIndex) || recordIndex < 1 || recordIndex > records.length) {
      throw new Error(`${session.id} has ${records.length} records, requested ${recordIndex}`);
    }

    return {
      filePath: records[recordIndex - 1],
      recordIndex,
      sourceType: "generated-record"
    };
  }

  if (!session.showOriginalInList && session.generatedFilePath) {
    return {
      filePath: session.generatedFilePath,
      sourceType: "current"
    };
  }

  return {
    filePath: session.filePath,
    sourceType: "original"
  };
}
