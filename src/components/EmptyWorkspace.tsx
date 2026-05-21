interface EmptyWorkspaceProps {
  hasProject: boolean;
  isDragging: boolean;
  onDraggingChange: (isDragging: boolean) => void;
  onDropFiles: (files: File[]) => void;
}

export function EmptyWorkspace({ hasProject, isDragging, onDraggingChange, onDropFiles }: EmptyWorkspaceProps) {
  return (
    <div
      className={`empty-workspace ${isDragging ? "dragging" : ""}`}
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
    >
      <div className="empty-copy">
        {hasProject ? (
          <>
            <strong>拖入图片开始</strong>
            <span>也可以点击左上角“导入”多选本地图片。</span>
          </>
        ) : (
          <>
            <strong>先新建或打开项目</strong>
            <span>每个项目会单独保存图片、生成结果和会话记录。</span>
          </>
        )}
      </div>
    </div>
  );
}
