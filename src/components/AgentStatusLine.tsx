interface AgentStatusLineProps {
  isWorking: boolean;
  message?: string;
  idleText?: string;
  tokenCount?: number | null;
  workingText?: string;
}

export function AgentStatusLine({
  isWorking,
  message,
  idleText = "等待指令",
  tokenCount,
  workingText = "正在思考..."
}: AgentStatusLineProps) {
  const statusText = message ?? (isWorking ? workingText : idleText);
  const tokenLabel = isWorking && typeof tokenCount === "number" ? formatTokenCount(tokenCount) : undefined;

  return (
    <div className={`agent-status-line ${isWorking ? "thinking" : "idle"}`} aria-label="工作状态" aria-live="polite">
      <span className="agent-status-text">{statusText}</span>
      {tokenLabel ? <span className="agent-status-token">约 {tokenLabel} tokens</span> : null}
    </div>
  );
}

function formatTokenCount(tokenCount: number): string {
  if (tokenCount >= 1000) {
    return `${(tokenCount / 1000).toFixed(tokenCount >= 10_000 ? 0 : 1)}k`;
  }

  return String(tokenCount);
}
