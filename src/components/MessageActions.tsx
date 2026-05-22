import { useState } from "react";

interface MessageActionsProps {
  content: string;
  tone?: "assistant" | "user" | "context" | "error";
}

type Feedback = "up" | "down" | null;

export function MessageActions({ content, tone = "assistant" }: MessageActionsProps) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const canReact = tone === "assistant" || tone === "context";

  function handleCopy(): void {
    void navigator.clipboard?.writeText(content);
  }

  return (
    <div className="message-actions" aria-label="消息操作">
      <button type="button" onClick={handleCopy}>
        复制
      </button>
      {canReact ? (
        <>
          <button
            className={feedback === "up" ? "selected" : ""}
            type="button"
            aria-label="点赞"
            aria-pressed={feedback === "up"}
            onClick={() => setFeedback(feedback === "up" ? null : "up")}
          >
            ↑
          </button>
          <button
            className={feedback === "down" ? "selected" : ""}
            type="button"
            aria-label="点踩"
            aria-pressed={feedback === "down"}
            onClick={() => setFeedback(feedback === "down" ? null : "down")}
          >
            ↓
          </button>
        </>
      ) : null}
    </div>
  );
}
