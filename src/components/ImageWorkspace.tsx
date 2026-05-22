import type { ImageSession } from "../types/image";
import { ImageCell } from "./ImageCell";

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
  onRetrySession,
  onSelectSession,
  onToggleImageSource
}: ImageWorkspaceProps) {
  return (
    <div
      className={`image-workspace ${isDragging ? "dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        onDraggingChange(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => onDraggingChange(false)}
      onDrop={(event) => {
        event.preventDefault();
        onDraggingChange(false);
        onDropFiles(Array.from(event.dataTransfer.files));
      }}
      style={{ "--workspace-columns": columns } as React.CSSProperties}
    >
      {sessions.map((session) => (
        <ImageCell
          key={session.id}
          isSelected={session.id === selectedSessionId}
          session={session}
          onDelete={() => onDeleteSession(session.id)}
          onOpenPreview={() => onOpenPreview(session.id)}
          onRetry={() => onRetrySession(session.id)}
          onSelect={() => onSelectSession(session.id)}
          onToggleImageSource={() => onToggleImageSource(session.id)}
        />
      ))}
    </div>
  );
}
