import { useEffect, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";
import type { ImageSession, ImageSessionStatus } from "../types/image";
import { getSessionDisplayPath } from "../domain/imageSessions";
import {
  type WorkspaceImageDragPayload,
  writeWorkspaceImageDragPayload
} from "./workspaceImageDrag";

interface ImageCellProps {
  dragPayload: WorkspaceImageDragPayload;
  isDragTarget: boolean;
  isSelected: boolean;
  session: ImageSession;
  onDelete: () => void;
  onDragLeave: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onOpenContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  onCtrlContextMenu: () => void;
  onSelect: (event: MouseEvent<HTMLDivElement>) => void;
  onSelectByKeyboard: () => void;
  onRetry: () => void;
  onOpenPreview: () => void;
}

const STATUS_ICON: Record<ImageSessionStatus, string> = {
  idle: "○",
  queued: "◷",
  generating: "",
  completed: "✓",
  "needs-review": "!",
  failed: "×"
};

export function ImageCell({
  dragPayload,
  isDragTarget,
  isSelected,
  session,
  onDelete,
  onDragLeave,
  onDragOver,
  onDrop,
  onCtrlContextMenu,
  onMouseDown,
  onOpenContextMenu,
  onOpenPreview,
  onRetry,
  onSelect,
  onSelectByKeyboard
}: ImageCellProps) {
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const displayPath = getSessionDisplayPath(session);
  const imageUrl = window.batchImager?.getImageUrl(displayPath) ?? displayPath;

  useEffect(() => {
    setIsDeleteConfirming(false);
  }, [session.id]);

  function handleDeleteClick(event: MouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();

    if (!isDeleteConfirming) {
      setIsDeleteConfirming(true);
      return;
    }

    onDelete();
  }

  function handleRetryClick(event: MouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    onRetry();
  }

  function handleCellKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onSelectByKeyboard();
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>): void {
    writeWorkspaceImageDragPayload(event.dataTransfer, dragPayload);
  }

  return (
    <div
      className={`image-cell ${isSelected ? "selected" : ""} ${isDragTarget ? "drag-target" : ""}`}
      draggable
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onMouseDown={onMouseDown}
      onContextMenu={(event) => {
        event.preventDefault();
        if (event.ctrlKey) {
          event.stopPropagation();
          onCtrlContextMenu();
          return;
        }
        onOpenContextMenu(event);
      }}
      onDoubleClick={onOpenPreview}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDragStart={handleDragStart}
      onDrop={onDrop}
      onKeyDown={handleCellKeyDown}
      title="双击查看大图，右键打开菜单"
    >
      <img src={imageUrl} alt={session.fileName} draggable={false} />
      <button
        className={`image-delete-button ${isDeleteConfirming ? "confirming" : ""}`}
        type="button"
        aria-label={isDeleteConfirming ? "确认删除图片" : "删除图片"}
        title={isDeleteConfirming ? "再次点击确认删除" : "删除图片"}
        onClick={handleDeleteClick}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <span aria-hidden="true">{isDeleteConfirming ? "✓" : <TrashIcon />}</span>
      </button>
      <span className="filename-overlay">{session.fileName}</span>
      {session.status === "failed" ? (
        <button
          className="status-icon failed status-retry-button"
          type="button"
          aria-label="重试生成"
          title="重试生成"
          onClick={handleRetryClick}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <RetryIcon />
        </button>
      ) : (
        <span className={`status-icon ${session.status}`} aria-label={session.status}>
          {session.status === "generating" ? <span className="spinner-ring" aria-hidden="true" /> : STATUS_ICON[session.status]}
        </span>
      )}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="trash-icon" viewBox="0 0 16 16" focusable="false" aria-hidden="true">
      <path d="M5.5 3.5h5" />
      <path d="M6.5 3.5V2.7h3v.8" />
      <path d="M4 5h8" />
      <path d="M5 5.5l.5 7h5l.5-7" />
      <path d="M7 7.2v3.7" />
      <path d="M9 7.2v3.7" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg className="retry-icon" viewBox="0 0 16 16" focusable="false" aria-hidden="true">
      <path d="M12.4 6.1A4.6 4.6 0 1 0 13 8.4" />
      <path d="M12.6 2.8v3.4H9.2" />
    </svg>
  );
}
