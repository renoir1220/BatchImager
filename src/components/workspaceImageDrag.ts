export const BATCHIMAGER_IMAGE_DRAG_TYPE = "application/x-batchimager-image";

export interface WorkspaceImageDragPayload {
  fileName: string;
  imagePath: string;
  sessionId: string;
}

export function writeWorkspaceImageDragPayload(dataTransfer: DataTransfer, payload: WorkspaceImageDragPayload): void {
  dataTransfer.effectAllowed = "copyMove";
  dataTransfer.setData(BATCHIMAGER_IMAGE_DRAG_TYPE, JSON.stringify(payload));
  dataTransfer.setData("text/plain", payload.imagePath);
}

export function readWorkspaceImageDragPayload(dataTransfer: DataTransfer): WorkspaceImageDragPayload | null {
  if (!hasWorkspaceImageDrag(dataTransfer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(dataTransfer.getData(BATCHIMAGER_IMAGE_DRAG_TYPE)) as Partial<WorkspaceImageDragPayload>;

    if (typeof parsed.sessionId !== "string" || typeof parsed.imagePath !== "string") {
      return null;
    }

    return {
      fileName: typeof parsed.fileName === "string" && parsed.fileName.trim() ? parsed.fileName : getFileName(parsed.imagePath),
      imagePath: parsed.imagePath,
      sessionId: parsed.sessionId
    };
  } catch {
    return null;
  }
}

export function hasWorkspaceImageDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(BATCHIMAGER_IMAGE_DRAG_TYPE);
}

export function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return filePath.slice(lastSlash + 1);
}
