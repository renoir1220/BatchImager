interface AgentStatusLineProps {
  isWorking: boolean;
  message?: string;
  idleText?: string;
  workingText?: string;
}

export function AgentStatusLine({
  isWorking,
  message,
  idleText = "等待指令",
  workingText = "正在思考..."
}: AgentStatusLineProps) {
  const statusText = message ?? (isWorking ? workingText : idleText);

  return (
    <div className={`agent-status-line ${isWorking ? "thinking" : "idle"}`} aria-label="工作状态" aria-live="polite">
      <span className="agent-status-text">{statusText}</span>
    </div>
  );
}
