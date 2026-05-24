import { useEffect, useRef, useState } from "react";

interface MessageActionsProps {
  content: string;
}

export function MessageActions({ content }: MessageActionsProps) {
  const [isCopied, setIsCopied] = useState(false);
  const copiedResetTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedResetTimer.current !== null) {
        window.clearTimeout(copiedResetTimer.current);
      }
    };
  }, []);

  async function handleCopy(): Promise<void> {
    if (!navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
    } catch {
      return;
    }

    setIsCopied(true);

    if (copiedResetTimer.current !== null) {
      window.clearTimeout(copiedResetTimer.current);
    }

    copiedResetTimer.current = window.setTimeout(() => {
      setIsCopied(false);
      copiedResetTimer.current = null;
    }, 1400);
  }

  return (
    <div className="message-actions" aria-label="消息操作">
      <button
        className={`message-action-button ${isCopied ? "copied" : ""}`}
        type="button"
        aria-label={isCopied ? "复制完成" : "复制消息"}
        title={isCopied ? "复制完成" : "复制消息"}
        onClick={() => {
          void handleCopy();
        }}
      >
        {isCopied ? <DoneIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg className="message-action-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="6" y="5" width="7" height="8" rx="1.5" />
      <path d="M3 10.5V4a1 1 0 0 1 1-1h5.5" />
    </svg>
  );
}

function DoneIcon() {
  return (
    <svg className="message-action-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.3 6.4 11 12.7 4.7" />
    </svg>
  );
}
