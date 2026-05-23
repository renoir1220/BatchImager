import { useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import { getSessionDisplayPath } from "../domain/imageSessions";
import type { ImageSession } from "../types/image";
import { ImageCell } from "./ImageCell";
import {
  getFileName,
  hasWorkspaceImageDrag,
  readWorkspaceImageDragPayload,
  type WorkspaceImageDragPayload
} from "./workspaceImageDrag";

interface ImageWorkspaceProps {
  columns: number;
  isDragging: boolean;
  sessions: ImageSession[];
  selectedSessionId: string | null;
  onDraggingChange: (isDragging: boolean) => void;
  onDropFiles: (files: File[]) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenPreview: (sessionId: string) => void;
  onRetrySession: (sessionId: string) => void;
  onReorderSessions: (sourceSessionId: string, targetSessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onToggleImageSource: (sessionId: string) => void;
}

export function ImageWorkspace({
  columns,
  isDragging,
  sessions,
  selectedSessionId,
  onDraggingChange,
  onDeleteSession,
  onDropFiles,
  onOpenPreview,
  onReorderSessions,
  onRetrySession,
  onSelectSession,
  onToggleImageSource
}: ImageWorkspaceProps) {
  const [dragTargetSessionId, setDragTargetSessionId] = useState<string | null>(null);

  function onImageDragPayload(session: ImageSession): WorkspaceImageDragPayload {
    const imagePath = getSessionDisplayPath(session);

    return {
      fileName: getFileName(imagePath) || session.fileName,
      imagePath,
      sessionId: session.id
    };
  }

  function handleWorkspaceDragEnter(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();

    if (!hasWorkspaceImageDrag(event.dataTransfer)) {
      onDraggingChange(true);
    }
  }

  function handleWorkspaceDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();

    if (hasWorkspaceImageDrag(event.dataTransfer)) {
      event.dataTransfer.dropEffect = "move";
    }
  }

  function handleWorkspaceDragLeave(): void {
    onDraggingChange(false);
    setDragTargetSessionId(null);
  }

  function handleWorkspaceDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    onDraggingChange(false);
    setDragTargetSessionId(null);

    if (hasWorkspaceImageDrag(event.dataTransfer)) {
      return;
    }

    onDropFiles(Array.from(event.dataTransfer.files));
  }

  function handleCellDragOver(event: DragEvent<HTMLDivElement>, targetSessionId: string): void {
    if (!hasWorkspaceImageDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTargetSessionId(targetSessionId);
  }

  function handleCellDrop(event: DragEvent<HTMLDivElement>, targetSessionId: string): void {
    const payload = readWorkspaceImageDragPayload(event.dataTransfer);

    if (!payload) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDragTargetSessionId(null);
    onReorderSessions(payload.sessionId, targetSessionId);
  }

  return (
    <div
      className={`image-workspace ${isDragging ? "dragging" : ""}`}
      onDragEnter={handleWorkspaceDragEnter}
      onDragOver={handleWorkspaceDragOver}
      onDragLeave={handleWorkspaceDragLeave}
      onDrop={handleWorkspaceDrop}
      style={{ "--workspace-columns": columns } as CSSProperties}
    >
      {sessions.map((session) => (
        <ImageCell
          key={session.id}
          dragPayload={onImageDragPayload(session)}
          isDragTarget={session.id === dragTargetSessionId}
          isSelected={session.id === selectedSessionId}
          session={session}
          onDelete={() => onDeleteSession(session.id)}
          onDragLeave={() => setDragTargetSessionId(null)}
          onDragOver={(event) => handleCellDragOver(event, session.id)}
          onDrop={(event) => handleCellDrop(event, session.id)}
          onOpenPreview={() => onOpenPreview(session.id)}
          onRetry={() => onRetrySession(session.id)}
          onSelect={() => onSelectSession(session.id)}
          onToggleImageSource={() => onToggleImageSource(session.id)}
        />
      ))}
    </div>
  );
}
