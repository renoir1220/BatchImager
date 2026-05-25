import { useEffect } from "react";
import type { AppLogEntry } from "../../electron/ipcTypes";

interface LogPanelProps {
  logs: AppLogEntry[];
  onClose: () => void;
}

const LEVEL_LABEL: Record<AppLogEntry["level"], string> = {
  debug: "调试",
  error: "错误",
  info: "信息",
  warn: "警告"
};

export function LogPanel({ logs, onClose }: LogPanelProps) {
  const displayLogs = [...logs].reverse();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="log-page" role="dialog" aria-modal="true" aria-labelledby="log-page-title">
      <header className="log-header">
        <div>
          <h2 id="log-page-title">运行日志</h2>
          <span>{logs.length > 0 ? `${logs.length} 条记录，实时刷新` : "等待新的运行记录"}</span>
        </div>
        <button className="toolbar-button" type="button" onClick={onClose}>
          关闭
        </button>
      </header>

      <section className="log-list" aria-label="日志列表">
        {logs.length === 0 ? (
          <div className="log-empty">暂无日志。开始导入或生成后，这里会显示进度。</div>
        ) : (
          displayLogs.map((entry, index) => (
            <article className={`log-row ${entry.level}`} key={`${entry.timestamp}-${index}`}>
              <time>{formatTime(entry.timestamp)}</time>
              <span className="log-level">{LEVEL_LABEL[entry.level]}</span>
              <span className="log-message">{entry.message}</span>
              {entry.context ? <span className="log-context">{entry.context}</span> : null}
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(timestamp));
}
