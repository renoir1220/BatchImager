interface AppToolbarProps {
  columns: number;
  imageCount: number;
  logCount?: number;
  hasProject: boolean;
  onBatchProcess: () => void;
  onClear: () => void;
  onColumnsChange: (columns: number) => void;
  onNewProject: () => void;
  onImport: () => void;
  onOpenProject: () => void;
  onOpenLogs?: () => void;
  projectLabel?: string;
}

export function AppToolbar({
  columns,
  hasProject,
  imageCount,
  logCount = 0,
  onBatchProcess,
  onClear,
  onColumnsChange,
  onNewProject,
  onImport,
  onOpenProject,
  projectLabel,
  onOpenLogs
}: AppToolbarProps) {
  return (
    <header className="app-toolbar">
      <div className="window-drag-region" />

      <div className="toolbar-group toolbar-project-actions">
        <button className="toolbar-button" type="button" onClick={onNewProject}>
          新建项目
        </button>

        <button className="toolbar-button" type="button" onClick={onOpenProject}>
          打开项目
        </button>
      </div>

      <div className="toolbar-divider" aria-hidden="true" />

      <div className="toolbar-group toolbar-main-actions">
        <button className="toolbar-button" type="button" disabled={!hasProject} onClick={onImport}>
          导入
        </button>

        <button className="toolbar-button primary" type="button" disabled={!hasProject || imageCount === 0} onClick={onBatchProcess}>
          批量处理
        </button>

        <button className="toolbar-button" type="button" disabled={!hasProject || imageCount === 0} onClick={onClear}>
          清空
        </button>
      </div>

      <div className="toolbar-divider" aria-hidden="true" />

      <div className="toolbar-group toolbar-view-actions">
        <label className="column-control">
          <span>列数</span>
          <select value={columns} onChange={(event) => onColumnsChange(Number(event.target.value))}>
            {[2, 3, 4, 5, 6].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-group toolbar-status-actions">
        {onOpenLogs ? (
          <button className="toolbar-button" type="button" onClick={onOpenLogs}>
            日志{logCount > 0 ? ` ${logCount}` : ""}
          </button>
        ) : null}

        <span className="toolbar-count">{imageCount > 0 ? `${imageCount} 张图片` : "等待导入"}</span>
        <span className="toolbar-project-label">{projectLabel ?? "未打开项目"}</span>
      </div>
    </header>
  );
}
