import { useEffect, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { ImageSession, ImageSessionStatus } from "../types/image";
import { getSessionDisplayPath } from "../domain/imageSessions";

interface ImageCellProps {
  isSelected: boolean;
  session: ImageSession;
  onDelete: () => void;
  onSelect: () => void;
  onRetry: () => void;
  onToggleImageSource: () => void;
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

export function ImageCell({ isSelected, session, onDelete, onOpenPreview, onRetry, onSelect, onToggleImageSource }: ImageCellProps) {
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const displayPath = getSessionDisplayPath(session);
  const imageUrl = window.batchImager?.getImageUrl(displayPath) ?? displayPath;
  const sourceLabel = session.showOriginalInList && session.generatedFilePath ? "原" : "现";

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
    onSelect();
  }

  return (
    <div
      className={`image-cell ${isSelected ? "selected" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        onToggleImageSource();
      }}
      onDoubleClick={onOpenPreview}
      onKeyDown={handleCellKeyDown}
      title={session.generatedFilePath ? "右键切换原图/当前图，双击查看大图" : "双击查看大图"}
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
      {session.generatedFilePath ? <span className="source-pill" aria-label={sourceLabel === "原" ? "当前显示原图" : "当前显示使用图"}>{sourceLabel}</span> : null}
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
