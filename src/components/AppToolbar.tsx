import type { CSSProperties, ReactNode } from "react";
import { OsMenu, OsMenuItem } from "./os";

interface AppToolbarProps {
  columns: number;
  logCount?: number;
  onColumnsChange: (columns: number) => void;
  onNewProject: () => void;
  onImport: () => void;
  onOpenInFolder?: () => void;
  onOpenProject: () => void;
  onOpenLogs?: () => void;
  onOpenSettings?: () => void;
  projectLabel?: string;
}

export function AppToolbar({
  columns,
  logCount = 0,
  onColumnsChange,
  onNewProject,
  onImport,
  onOpenInFolder,
  onOpenProject,
  projectLabel,
  onOpenLogs,
  onOpenSettings
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
          {onOpenInFolder ? (
            <MenuBarItem onClick={onOpenInFolder}>
              在文件夹中打开
            </MenuBarItem>
          ) : null}
        </MenuBarGroup>

        <MenuBarDivider />

        <MenuBarGroup className="toolbar-view-actions">
          <ToolbarSliderControl label="列数" value={columns} min={2} max={6} onChange={onColumnsChange} />
        </MenuBarGroup>
      </MenuBar>

      <div className="toolbar-spacer" />

      <MenuBar ariaLabel="状态操作">
        <MenuBarGroup className="toolbar-status-actions">
          {onOpenSettings ? (
            <SettingsButton onClick={onOpenSettings} />
          ) : null}
          {onOpenLogs ? (
            <LogButton count={logCount} onClick={onOpenLogs} />
          ) : null}
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
  const label = projectLabel ?? "未打开项目";

  return (
    <OsMenu
      trigger={
        <button className="toolbar-button toolbar-project-trigger project-menu-button" type="button" title={label}>
          <span className="toolbar-project-name">{label}</span>
          <span className="toolbar-project-chevron" aria-hidden="true" />
        </button>
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

interface SettingsButtonProps {
  onClick: () => void;
}

function SettingsButton({ onClick }: SettingsButtonProps) {
  return (
    <button className="toolbar-button toolbar-icon-button" type="button" aria-label="打开设置" title="打开设置" onClick={onClick}>
      <SettingsIcon />
    </button>
  );
}

function SettingsIcon() {
  return (
    <svg className="toolbar-settings-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 5.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Z" />
      <path d="M8 1.8v1.4M8 12.8v1.4M13.4 8h-1.4M4 8H2.6M11.8 4.2l-1 1M5.2 10.8l-1 1M11.8 11.8l-1-1M5.2 5.2l-1-1" />
    </svg>
  );
}

interface LogButtonProps {
  count: number;
  onClick: () => void;
}

function LogButton({ count, onClick }: LogButtonProps) {
  return (
    <button className="toolbar-button toolbar-log-button" type="button" aria-label={`打开日志，${count} 条`} title="打开日志" onClick={onClick}>
      <LogIcon />
      <span className="toolbar-log-count">{count}</span>
    </button>
  );
}

function LogIcon() {
  return (
    <svg className="toolbar-log-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 3.5h7" />
      <path d="M4.5 6.5h7" />
      <path d="M4.5 9.5h4" />
      <rect x="2.75" y="1.75" width="10.5" height="12.5" rx="2" />
    </svg>
  );
}

interface ToolbarSliderControlProps {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}

function ToolbarSliderControl({ label, max, min, onChange, value }: ToolbarSliderControlProps) {
  const clampedValue = Math.min(max, Math.max(min, value));
  const fillPercentage = ((clampedValue - min) / (max - min)) * 100;

  return (
    <label className="toolbar-slider-control">
      <span className="toolbar-slider-label">{label}</span>
      <input
        className="toolbar-slider"
        type="range"
        min={min}
        max={max}
        step={1}
        value={clampedValue}
        aria-label={label}
        aria-valuetext={`${clampedValue} 列`}
        style={{ "--toolbar-slider-fill": `${fillPercentage}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <output className="toolbar-slider-value">{clampedValue}</output>
    </label>
  );
}
