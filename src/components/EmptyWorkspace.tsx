import type { ProjectListEntry } from "../../electron/ipcTypes";

interface EmptyWorkspaceProps {
  hasProject: boolean;
  isDragging: boolean;
  isRecentProjectsLoading?: boolean;
  recentProjects: ProjectListEntry[];
  onImport: () => void;
  onDraggingChange: (isDragging: boolean) => void;
  onDropFiles: (files: File[]) => void;
  onOpenProject: (directory: string) => void;
}

export function EmptyWorkspace({
  hasProject,
  isDragging,
  isRecentProjectsLoading = false,
  recentProjects,
  onDraggingChange,
  onDropFiles,
  onImport,
  onOpenProject
}: EmptyWorkspaceProps) {
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
      {!hasProject ? (
        <div className="startup-projects" aria-label="启动项目">
          <div className="startup-actions">
            <button className="toolbar-button primary" type="button" onClick={onImport}>
              导入图片
            </button>
            <span>导入前会自动新建项目。</span>
          </div>

          <section className="recent-projects" aria-label="最近项目">
            <header>
              <strong>最近项目</strong>
              <span>{isRecentProjectsLoading ? "正在读取..." : `${recentProjects.length} 个`}</span>
            </header>
            {recentProjects.length > 0 ? (
              <div className="recent-project-list">
                {recentProjects.map((project) => (
                  <button
                    className="recent-project-row"
                    type="button"
                    key={project.directory}
                    onClick={() => onOpenProject(project.directory)}
                  >
                    <ProjectThumbs project={project} />
                    <span className="recent-project-info">
                      <strong>{project.summary?.name ?? getDirectoryName(project.directory)}</strong>
                      <span>{formatRecentProjectMeta(project)}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="recent-project-empty">还没有最近项目。</div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ProjectThumbs({ project }: { project: ProjectListEntry }) {
  const thumbs = Array.from({ length: 3 }, (_, index) => project.thumbnailPaths[index] ?? null);

  return (
    <span className="recent-project-thumbs" aria-hidden="true">
      {thumbs.map((thumbnailPath, index) => (
        <span className="recent-project-thumb" key={`${project.directory}-${index}`}>
          {thumbnailPath ? <img src={window.batchImager?.getImageUrl(thumbnailPath) ?? thumbnailPath} alt="" draggable={false} /> : null}
        </span>
      ))}
    </span>
  );
}

function formatRecentProjectMeta(project: ProjectListEntry): string {
  if (!project.summary) {
    return getDirectoryName(project.directory);
  }

  return `${project.summary.imageCount} 张图片 · ${formatUpdatedAt(project.summary.updatedAt)}`;
}

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return "更新时间未知";
  }

  return date.toLocaleString("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  });
}

function getDirectoryName(directory: string): string {
  const lastSlash = Math.max(directory.lastIndexOf("/"), directory.lastIndexOf("\\"));
  return directory.slice(lastSlash + 1) || "项目";
}
