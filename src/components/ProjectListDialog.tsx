import { useEffect, useState } from "react";
import type { ProjectListEntry } from "../../electron/ipcTypes";

interface ProjectListDialogProps {
  isLoading: boolean;
  projects: ProjectListEntry[];
  onAddDirectory: () => Promise<void>;
  onClose: () => void;
  onOpenProject: (directory: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onRenameProject: (directory: string, name: string) => Promise<void>;
}

export function ProjectListDialog({
  isLoading,
  projects,
  onAddDirectory,
  onClose,
  onOpenProject,
  onRefresh,
  onRenameProject
}: ProjectListDialogProps) {
  return (
    <div className="modal-backdrop project-list-backdrop">
      <section className="project-list-dialog" role="dialog" aria-modal="true" aria-label="项目列表">
        <header className="project-list-header">
          <div>
            <h2>打开项目</h2>
            <span>{isLoading ? "正在读取项目..." : `${projects.length} 个项目`}</span>
          </div>
          <div className="project-list-header-actions">
            <button className="toolbar-button" type="button" onClick={onRefresh}>
              刷新
            </button>
            <button className="toolbar-button" type="button" onClick={onAddDirectory}>
              添加项目文件夹
            </button>
            <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
              ×
            </button>
          </div>
        </header>

        <div className="project-list-body">
          {!isLoading && projects.length === 0 ? <div className="project-list-empty">还没有项目。</div> : null}
          {projects.map((project) => (
            <ProjectListRow
              key={project.directory}
              project={project}
              onOpenProject={onOpenProject}
              onRenameProject={onRenameProject}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

interface ProjectListRowProps {
  project: ProjectListEntry;
  onOpenProject: (directory: string) => Promise<void>;
  onRenameProject: (directory: string, name: string) => Promise<void>;
}

function ProjectListRow({ project, onOpenProject, onRenameProject }: ProjectListRowProps) {
  const currentName = project.summary?.name ?? getDirectoryName(project.directory);
  const updatedAt = project.summary ? formatProjectUpdatedAt(project.summary.updatedAt) : "位置不可用";
  const imageCount = project.summary ? `${project.summary.imageCount} 张图片` : "无法读取";

  return (
    <article className={`project-list-row ${project.isUnavailable ? "unavailable" : ""}`}>
      <ProjectPreviewGrid project={project} />
      <div className="project-list-info">
        <InlineProjectName
          directory={project.directory}
          disabled={project.isUnavailable}
          name={currentName}
          onRenameProject={onRenameProject}
        />
        <div className="project-list-meta">
          <span>{imageCount}</span>
          <span>{updatedAt}</span>
          {project.isExternal ? <span>外部项目</span> : null}
        </div>
        <div className="project-list-path" title={project.directory}>
          {project.directory}
        </div>
      </div>
      <button
        className="toolbar-button primary"
        type="button"
        disabled={project.isUnavailable}
        onClick={() => onOpenProject(project.directory)}
      >
        打开
      </button>
    </article>
  );
}

function ProjectPreviewGrid({ project }: { project: ProjectListEntry }) {
  const cells = Array.from({ length: 6 }, (_, index) => project.thumbnailPaths[index] ?? null);

  return (
    <div className="project-preview-grid" aria-label="项目图像预览">
      {cells.map((thumbnailPath, index) => (
        <div className="project-preview-thumb" key={`${project.directory}-${index}`}>
          {thumbnailPath ? <img src={window.batchImager?.getImageUrl(thumbnailPath) ?? thumbnailPath} alt="" draggable={false} /> : null}
        </div>
      ))}
    </div>
  );
}

interface InlineProjectNameProps {
  directory: string;
  disabled: boolean;
  name: string;
  onRenameProject: (directory: string, name: string) => Promise<void>;
}

function InlineProjectName({ directory, disabled, name, onRenameProject }: InlineProjectNameProps) {
  const [isEditing, setIsEditing] = useProjectNameEditing();
  const [draftName, setDraftName] = useProjectNameDraft(name);

  if (!isEditing) {
    return (
      <div className="project-name-line">
        <strong>{name}</strong>
        <button className="project-link-button" type="button" disabled={disabled} onClick={() => setIsEditing(true)}>
          重命名
        </button>
      </div>
    );
  }

  return (
    <form
      className="project-name-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onRenameProject(directory, draftName).then(() => setIsEditing(false));
      }}
    >
      <input value={draftName} onChange={(event) => setDraftName(event.target.value)} aria-label="项目名称" autoFocus />
      <button className="toolbar-button primary" type="submit">
        保存
      </button>
      <button
        className="toolbar-button"
        type="button"
        onClick={() => {
          setDraftName(name);
          setIsEditing(false);
        }}
      >
        取消
      </button>
    </form>
  );
}

function useProjectNameEditing(): [boolean, (value: boolean) => void] {
  return useState(false);
}

function useProjectNameDraft(name: string): [string, (value: string) => void] {
  const [draftName, setDraftName] = useState(name);

  useEffect(() => {
    setDraftName(name);
  }, [name]);

  return [draftName, setDraftName];
}

function formatProjectUpdatedAt(updatedAt: string): string {
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
