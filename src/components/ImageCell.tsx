import type { ImageSession, ImageSessionStatus } from "../types/image";
import { getSessionDisplayPath } from "../domain/imageSessions";

interface ImageCellProps {
  isSelected: boolean;
  session: ImageSession;
  onSelect: () => void;
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

export function ImageCell({ isSelected, session, onOpenPreview, onSelect, onToggleImageSource }: ImageCellProps) {
  const displayPath = getSessionDisplayPath(session);
  const imageUrl = window.batchImager?.getImageUrl(displayPath) ?? displayPath;
  const sourceLabel = session.showOriginalInList && session.generatedFilePath ? "原" : "现";

  return (
    <button
      className={`image-cell ${isSelected ? "selected" : ""}`}
      type="button"
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        onToggleImageSource();
      }}
      onDoubleClick={onOpenPreview}
      title={session.generatedFilePath ? "右键切换原图/当前图，双击查看大图" : "双击查看大图"}
    >
      <img src={imageUrl} alt={session.fileName} draggable={false} />
      <span className="filename-overlay">{session.fileName}</span>
      {session.generatedFilePath ? <span className="source-pill" aria-label={sourceLabel === "原" ? "当前显示原图" : "当前显示使用图"}>{sourceLabel}</span> : null}
      <span className={`status-icon ${session.status}`} aria-label={session.status}>
        {session.status === "generating" ? <span className="spinner-ring" aria-hidden="true" /> : STATUS_ICON[session.status]}
      </span>
    </button>
  );
}
