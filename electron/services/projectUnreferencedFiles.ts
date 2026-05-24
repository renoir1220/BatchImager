import { createHash } from "node:crypto";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { ProjectSnapshot } from "../ipcTypes";
import { getProjectGeneratedDirectory } from "./projectStore";
import { isPathInsideOrSame, normalizePathForComparison } from "./pathUtils";

export interface UnreferencedFileCandidate {
  byteSize: number;
  candidateId: string;
  fileName: string;
}

interface InternalUnreferencedFileCandidate extends UnreferencedFileCandidate {
  filePath: string;
}

export interface DeleteUnreferencedFileResult {
  byteSize?: number;
  candidateId: string;
  fileName?: string;
  reason?: string;
  status: "deleted" | "skipped";
}

export async function scanProjectUnreferencedFiles(snapshot: ProjectSnapshot): Promise<UnreferencedFileCandidate[]> {
  const candidates = await scanProjectUnreferencedFileCandidates(snapshot);
  return candidates.map(({ byteSize, candidateId, fileName }) => ({ byteSize, candidateId, fileName }));
}

export async function deleteProjectUnreferencedFiles(
  snapshot: ProjectSnapshot,
  candidateIds: string[]
): Promise<DeleteUnreferencedFileResult[]> {
  const generatedDirectory = getProjectGeneratedDirectory(snapshot.project.directory);
  const currentCandidates = await scanProjectUnreferencedFileCandidates(snapshot);
  const byId = new Map(currentCandidates.map((candidate) => [candidate.candidateId, candidate]));
  const results: DeleteUnreferencedFileResult[] = [];

  for (const candidateId of uniqueNonEmpty(candidateIds)) {
    const candidate = byId.get(candidateId);
    if (!candidate) {
      results.push({
        candidateId,
        reason: "candidate is no longer unreferenced or does not exist",
        status: "skipped"
      });
      continue;
    }

    if (!isPathInsideOrSame(candidate.filePath, generatedDirectory)) {
      results.push({
        candidateId,
        fileName: candidate.fileName,
        reason: "candidate is outside the project generated directory",
        status: "skipped"
      });
      continue;
    }

    try {
      await unlink(candidate.filePath);
      results.push({
        byteSize: candidate.byteSize,
        candidateId,
        fileName: candidate.fileName,
        status: "deleted"
      });
    } catch (error) {
      results.push({
        candidateId,
        fileName: candidate.fileName,
        reason: error instanceof Error ? error.message : String(error),
        status: "skipped"
      });
    }
  }

  return results;
}

async function scanProjectUnreferencedFileCandidates(snapshot: ProjectSnapshot): Promise<InternalUnreferencedFileCandidate[]> {
  const generatedDirectory = getProjectGeneratedDirectory(snapshot.project.directory);
  const referencedPaths = collectReferencedPaths(snapshot);
  const filePaths = await listFilesRecursively(generatedDirectory);
  const candidates: InternalUnreferencedFileCandidate[] = [];

  for (const filePath of filePaths) {
    if (!isPathInsideOrSame(filePath, generatedDirectory) || referencedPaths.has(normalizePathForComparison(filePath))) {
      continue;
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      continue;
    }

    candidates.push({
      byteSize: fileStat.size,
      candidateId: createCandidateId(filePath),
      fileName: path.basename(filePath),
      filePath
    });
  }

  return candidates.sort((a, b) => a.fileName.localeCompare(b.fileName) || a.candidateId.localeCompare(b.candidateId));
}

async function listFilesRecursively(directory: string): Promise<string[]> {
  let entries: Array<{ isDirectory: () => boolean; isFile: () => boolean; name: string }>;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function collectReferencedPaths(snapshot: ProjectSnapshot): Set<string> {
  const referenced = new Set<string>();
  const addPath = (filePath: string | undefined) => {
    if (filePath?.trim()) {
      referenced.add(normalizePathForComparison(filePath));
    }
  };

  for (const session of snapshot.sessions) {
    addPath(session.filePath);
    addPath(session.generatedFilePath);
    for (const filePath of session.generatedFilePaths ?? []) {
      addPath(filePath);
    }
    for (const message of session.chatMessages) {
      addPath(message.generatedFilePath);
      addPath(message.sourceFilePath);
      for (const filePath of message.referenceFilePaths ?? []) {
        addPath(filePath);
      }
    }
  }

  for (const message of snapshot.projectManagerState?.conversation.messages ?? []) {
    for (const filePath of message.referenceFilePaths ?? []) {
      addPath(filePath);
    }
  }

  for (const plan of snapshot.projectManagerState?.plans ?? []) {
    for (const referenceImage of plan.referenceImages ?? []) {
      addPath(referenceImage.filePath);
    }
    for (const report of plan.reports ?? []) {
      addPath(report.generatedImagePath);
    }
  }

  return referenced;
}

function createCandidateId(filePath: string): string {
  return `orphan_${createHash("sha256").update(normalizePathForComparison(filePath)).digest("hex").slice(0, 16)}`;
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
