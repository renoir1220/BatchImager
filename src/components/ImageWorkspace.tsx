import { useEffect, useRef, useState } from "react";
import type { CSSProperties, DragEvent, MouseEvent } from "react";
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
  selectedSessionIds?: Set<string>;
  onDraggingChange: (isDragging: boolean) => void;
  onDropFiles: (files: File[]) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenPreview: (sessionId: string) => void;
  onRetrySession: (sessionId: string) => void;
  onReorderSessions: (sourceSessionId: string, targetSessionId: string) => void;
  onCopySessionImage: (sessionId: string) => void;
  onExportSessionImage: (sessionId: string) => void;
  onSelectSession: (sessionId: string, options?: { multi?: boolean }) => void;
  onSendToAgent?: (payload: WorkspaceImageDragPayload) => void;
}

export function ImageWorkspace({
  columns,
  isDragging,
  sessions,
  selectedSessionId,
  selectedSessionIds,
  onDraggingChange,
  onDeleteSession,
  onDropFiles,
  onOpenPreview,
  onReorderSessions,
  onCopySessionImage,
  onExportSessionImage,
  onRetrySession,
  onSelectSession,
  onSendToAgent
}: ImageWorkspaceProps) {
  const [dragTargetSessionId, setDragTargetSessionId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);
  const suppressNextClickSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function closeContextMenu(): void {
      setContextMenu(null);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    }

    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

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
          isSelected={selectedSessionIds ? selectedSessionIds.has(session.id) : session.id === selectedSessionId}
          session={session}
          onDelete={() => onDeleteSession(session.id)}
          onCtrlContextMenu={() => {
            if (suppressNextClickSessionIdRef.current === session.id) {
              suppressNextClickSessionIdRef.current = null;
            }
          }}
          onDragLeave={() => setDragTargetSessionId(null)}
          onDragOver={(event) => handleCellDragOver(event, session.id)}
          onDrop={(event) => handleCellDrop(event, session.id)}
          onOpenContextMenu={(event) => {
            event.stopPropagation();
            onSelectSession(session.id);
            setContextMenu({ sessionId: session.id, x: event.clientX, y: event.clientY });
          }}
          onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
            if (event.button !== 0 || !event.ctrlKey) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            suppressNextClickSessionIdRef.current = session.id;
            onSelectSession(session.id);
          }}
          onOpenPreview={() => onOpenPreview(session.id)}
          onRetry={() => onRetrySession(session.id)}
          onSelect={(event: MouseEvent<HTMLDivElement>) => {
            if (suppressNextClickSessionIdRef.current === session.id) {
              suppressNextClickSessionIdRef.current = null;
              event.preventDefault();
              event.stopPropagation();
              return;
            }

            if (event.ctrlKey) {
              event.preventDefault();
              event.stopPropagation();
              onSelectSession(session.id);
              return;
            }

            if (event.shiftKey) {
              onSelectSession(session.id, { multi: true });
              return;
            }

            if (onSendToAgent) {
              onSendToAgent(onImageDragPayload(session));
              return;
            }

            onSelectSession(session.id);
          }}
          onSelectByKeyboard={() => {
            onSelectSession(session.id);
          }}
        />
      ))}
      {contextMenu ? (
        <div
          className="workspace-image-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCopySessionImage(contextMenu.sessionId);
              setContextMenu(null);
            }}
          >
            复制到剪贴板
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onExportSessionImage(contextMenu.sessionId);
              setContextMenu(null);
            }}
          >
            导出
          </button>
          <button
            className="danger"
            type="button"
            role="menuitem"
            onClick={() => {
              onDeleteSession(contextMenu.sessionId);
              setContextMenu(null);
            }}
          >
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}
