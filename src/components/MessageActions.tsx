import { useEffect, useRef, useState } from "react";

interface MessageActionsProps {
  content: string;
  referenceFilePaths?: string[];
}

export function MessageActions({ content, referenceFilePaths = [] }: MessageActionsProps) {
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
      if (referenceFilePaths.length > 0 && typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([formatMessageClipboardHtml(content, referenceFilePaths)], { type: "text/html" }),
            "text/plain": new Blob([content], { type: "text/plain" })
          })
        ]);
      } else {
        await navigator.clipboard.writeText(content);
      }
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

function formatMessageClipboardHtml(content: string, referenceFilePaths: string[]): string {
  const parts = splitContentByImageTokens(content);
  let html = "";

  for (const part of parts) {
    if (part.type === "text") {
      html += escapeHtml(part.text).replace(/\n/g, "<br>");
      continue;
    }

    const filePath = referenceFilePaths[part.index - 1];
    if (!filePath) {
      html += escapeHtml(part.raw);
      continue;
    }

    const fileName = getFileNameFromPath(filePath);
    html += `<span class="inline-reference-chip" contenteditable="false" data-batchimager-reference-path="${escapeHtmlAttribute(filePath)}" data-batchimager-reference-name="${escapeHtmlAttribute(fileName)}">${escapeHtml(part.raw)}</span>`;
  }

  return html;
}

type MessageClipboardPart =
  | { text: string; type: "text" }
  | { index: number; raw: string; type: "reference" };

function splitContentByImageTokens(content: string): MessageClipboardPart[] {
  const parts: MessageClipboardPart[] = [];
  const pattern = /【图片(\d+)】/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > cursor) {
      parts.push({ text: content.slice(cursor, match.index), type: "text" });
    }
    parts.push({ index: Number(match[1]), raw: match[0], type: "reference" });
    cursor = match.index + match[0].length;
  }

  if (cursor < content.length) {
    parts.push({ text: content.slice(cursor), type: "text" });
  }

  return parts;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function getFileNameFromPath(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return filePath.slice(lastSlash + 1) || "reference.png";
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
