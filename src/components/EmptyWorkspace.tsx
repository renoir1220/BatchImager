import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import type { ProjectListEntry } from "../../electron/ipcTypes";

interface EmptyWorkspaceProps {
  hasProject: boolean;
  isDragging: boolean;
  isRecentProjectsLoading?: boolean;
  recentProjects: ProjectListEntry[];
  onCreateBlankProject?: () => void;
  onDeleteProject?: (directory: string) => void;
  onDraggingChange: (isDragging: boolean) => void;
  onDropFiles: (files: File[]) => void;
  onOpenProject: (directory: string) => void;
}

export function EmptyWorkspace({
  hasProject,
  isDragging,
  isRecentProjectsLoading = false,
  recentProjects,
  onCreateBlankProject,
  onDeleteProject,
  onDraggingChange,
  onDropFiles,
  onOpenProject
}: EmptyWorkspaceProps) {
  const [deleteConfirmingDirectory, setDeleteConfirmingDirectory] = useState<string | null>(null);

  useEffect(() => {
    setDeleteConfirmingDirectory(null);
  }, [recentProjects]);

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
      <div className="empty-primary">
        <div className="empty-copy">
          {hasProject ? (
            <>
              <strong>拖入图片开始</strong>
              <span>也可以点击左上角“导入图片”多选本地图片。</span>
            </>
          ) : (
            <>
              <span className="empty-startup-command">
                <span>拖入或导入图片，或</span>
                <button className="empty-inline-action" type="button" onClick={onCreateBlankProject}>
                  新建空项目
                </button>
              </span>
            </>
          )}
        </div>
      </div>
      {!hasProject ? (
        <section className="recent-projects" aria-label="最近项目">
          <header>
            <strong>最近项目</strong>
            <span>{isRecentProjectsLoading ? "正在读取..." : `${recentProjects.length} 个`}</span>
          </header>
          {recentProjects.length > 0 ? (
            <div className="recent-project-list">
              {recentProjects.map((project) => (
                <RecentProjectCard
                  key={project.directory}
                  project={project}
                  isDeleteConfirming={deleteConfirmingDirectory === project.directory}
                  onDeleteProject={onDeleteProject}
                  onOpenProject={onOpenProject}
                  onSetDeleteConfirming={setDeleteConfirmingDirectory}
                />
              ))}
            </div>
          ) : (
            <div className="recent-project-empty">还没有最近项目。</div>
          )}
        </section>
      ) : null}
    </div>
  );
}

interface RecentProjectCardProps {
  isDeleteConfirming: boolean;
  project: ProjectListEntry;
  onDeleteProject?: (directory: string) => void;
  onOpenProject: (directory: string) => void;
  onSetDeleteConfirming: (directory: string | null) => void;
}

function RecentProjectCard({
  isDeleteConfirming,
  project,
  onDeleteProject,
  onOpenProject,
  onSetDeleteConfirming
}: RecentProjectCardProps) {
  function handleDeleteClick(event: MouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();

    if (!isDeleteConfirming) {
      onSetDeleteConfirming(project.directory);
      return;
    }

    onDeleteProject?.(project.directory);
  }

  return (
    <article className="recent-project-row">
      <button className="recent-project-open" type="button" onClick={() => onOpenProject(project.directory)}>
        <ProjectThumbs project={project} />
        <span className="recent-project-info">
          <span className="recent-project-name">{project.summary?.name ?? getDirectoryName(project.directory)}</span>
          <span>{formatRecentProjectMeta(project)}</span>
        </span>
      </button>
      <button
        className={`recent-project-delete-button image-delete-button ${isDeleteConfirming ? "confirming" : ""}`}
        type="button"
        aria-label={isDeleteConfirming ? "确认删除项目" : "删除项目"}
        title={isDeleteConfirming ? "再次点击确认删除" : "删除项目"}
        onClick={handleDeleteClick}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <span aria-hidden="true">{isDeleteConfirming ? "✓" : <TrashIcon />}</span>
      </button>
    </article>
  );
}

function ProjectThumbs({ project }: { project: ProjectListEntry }) {
  const thumbs = Array.from({ length: 4 }, (_, index) => project.thumbnailPaths[index] ?? null);

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
