import type { ReactNode } from "react";
import { OsMenu, OsMenuItem } from "./os";

interface AppToolbarProps {
  columns: number;
  imageCount: number;
  logCount?: number;
  onColumnsChange: (columns: number) => void;
  onNewProject: () => void;
  onImport: () => void;
  onOpenProject: () => void;
  onOpenLogs?: () => void;
  projectLabel?: string;
}

export function AppToolbar({
  columns,
  imageCount,
  logCount = 0,
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

      <MenuBar>
        <MenuBarGroup className="toolbar-project-actions">
          <MenuBarItem onClick={onNewProject}>
            新项目
          </MenuBarItem>
          <ProjectMenuButton projectLabel={projectLabel} onOpenProject={onOpenProject} />
        </MenuBarGroup>

        <MenuBarDivider />

        <MenuBarGroup className="toolbar-main-actions">
          <MenuBarItem onClick={onImport}>
            导入图片
          </MenuBarItem>
        </MenuBarGroup>

        <MenuBarDivider />

        <MenuBarGroup className="toolbar-view-actions">
          <ToolbarSegmentedControl label="列数" value={columns} values={[2, 3, 4, 5, 6]} onChange={onColumnsChange} />
        </MenuBarGroup>
      </MenuBar>

      <div className="toolbar-spacer" />

      <MenuBar ariaLabel="状态操作">
        <MenuBarGroup className="toolbar-status-actions">
          {onOpenLogs ? (
            <MenuBarItem onClick={onOpenLogs}>
              日志{logCount > 0 ? ` ${logCount}` : ""}
            </MenuBarItem>
          ) : null}

          <span className="toolbar-count">{imageCount > 0 ? `${imageCount} 张图片` : "等待导入"}</span>
        </MenuBarGroup>
      </MenuBar>
    </header>
  );
}

interface MenuBarProps {
  ariaLabel?: string;
  children: ReactNode;
}

function MenuBar({ ariaLabel = "应用菜单栏", children }: MenuBarProps) {
  return (
    <nav className="toolbar-menu-bar" aria-label={ariaLabel}>
      {children}
    </nav>
  );
}

interface MenuBarGroupProps {
  children: ReactNode;
  className?: string;
}

function MenuBarGroup({ children, className = "" }: MenuBarGroupProps) {
  return <div className={`toolbar-group ${className}`.trim()}>{children}</div>;
}

function MenuBarDivider() {
  return <div className="toolbar-divider" aria-hidden="true" />;
}

interface ProjectMenuButtonProps {
  onOpenProject: () => void;
  projectLabel?: string;
}

function ProjectMenuButton({ onOpenProject, projectLabel }: ProjectMenuButtonProps) {
  return (
    <OsMenu
      triggerClassName="toolbar-button toolbar-project-label project-menu-button"
      trigger={
        <span>{projectLabel ?? "未打开项目"}</span>
      }
    >
      <OsMenuItem onSelect={onOpenProject}>打开项目</OsMenuItem>
    </OsMenu>
  );
}

interface MenuBarItemProps {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  variant?: "default" | "primary";
}

function MenuBarItem({ children, disabled = false, onClick, variant = "default" }: MenuBarItemProps) {
  return (
    <button className={`toolbar-button ${variant === "primary" ? "primary" : ""}`.trim()} type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

interface ToolbarSegmentedControlProps {
  label: string;
  onChange: (value: number) => void;
  value: number;
  values: number[];
}

function ToolbarSegmentedControl({ label, onChange, value, values }: ToolbarSegmentedControlProps) {
  return (
    <div className="toolbar-segmented-control" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="toolbar-segmented-options">
        {values.map((item) => (
          <button
            type="button"
            className={item === value ? "selected" : ""}
            key={item}
            aria-pressed={item === value}
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
