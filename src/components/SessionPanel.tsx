import { FormEvent, useState } from "react";
import type { AppLogEntry } from "../../electron/ipcTypes";
import type { ImageSession } from "../types/image";
import {
  GenerationSizeControl,
  isGenerationSizeSelectionValid,
  resolveGenerationSizeSelection
} from "./GenerationSizeControl";

interface SessionPanelProps {
  activityLogs: AppLogEntry[];
  selectedSession: ImageSession | null;
  onSendMessage: (sessionId: string, content: string, outputSize?: string) => void;
}

export function SessionPanel({ activityLogs, selectedSession, onSendMessage }: SessionPanelProps) {
  const [message, setMessage] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [customSize, setCustomSize] = useState("");
  const displayPath = selectedSession?.generatedFilePath ?? selectedSession?.filePath ?? null;
  const imageUrl = displayPath ? window.batchImager?.getImageUrl(displayPath) ?? displayPath : null;
  const canSend = Boolean(
    selectedSession && message.trim() && selectedSession.chatStatus !== "sending" && isGenerationSizeSelectionValid(selectedSize, customSize)
  );
  const shouldShowActivity = Boolean(
    selectedSession && (activityLogs.length > 0 || selectedSession.chatStatus === "sending" || selectedSession.status === "generating")
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!selectedSession || !canSend) {
      return;
    }

    onSendMessage(selectedSession.id, message.trim(), resolveGenerationSizeSelection(selectedSize, customSize));
    setMessage("");
  }

  return (
    <aside className="session-panel" aria-label="会话">
      <div className="session-header">
        <h1>会话</h1>
        {selectedSession ? <span>{selectedSession.fileName}</span> : <span>未选择图片</span>}
      </div>

      {selectedSession && imageUrl ? (
        <>
          <img className="session-preview" src={imageUrl} alt={selectedSession.fileName} draggable={false} />
          <div className="session-thread">
            {selectedSession.chatMessages.length === 0 ? (
              <div className="thread-line muted">图片已导入。直接描述你想要的修改，模型会在需要时调用图片生成工具。</div>
            ) : (
              selectedSession.chatMessages.map((chatMessage) => (
                <div className={`thread-line ${chatMessage.role}`} key={chatMessage.id}>
                  {chatMessage.content}
                  {chatMessage.sourceFilePath ? (
                    <div className="thread-image-group">
                      <span>输入图</span>
                      <img
                        className="thread-image"
                        src={window.batchImager?.getImageUrl(chatMessage.sourceFilePath) ?? chatMessage.sourceFilePath}
                        alt="输入图"
                        draggable={false}
                      />
                    </div>
                  ) : null}
                  {chatMessage.generatedFilePath ? (
                    <div className="thread-image-group">
                      <span>生成图</span>
                      <img
                        className="thread-image"
                        src={window.batchImager?.getImageUrl(chatMessage.generatedFilePath) ?? chatMessage.generatedFilePath}
                        alt="生成结果"
                        draggable={false}
                      />
                      <span className="thread-result">已更新图片</span>
                    </div>
                  ) : null}
                  {chatMessage.referenceFilePaths?.length ? (
                    <div className="thread-image-group">
                      <span>参考图</span>
                      <div className="thread-reference-grid">
                        {chatMessage.referenceFilePaths.map((referenceFilePath) => (
                          <img
                            key={referenceFilePath}
                            src={window.batchImager?.getImageUrl(referenceFilePath) ?? referenceFilePath}
                            alt="参考图"
                            draggable={false}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))
            )}
            {shouldShowActivity ? (
              <div className="session-activity" aria-label="处理进度">
                <div className="session-activity-title">处理进度</div>
                {activityLogs.length > 0 ? (
                  activityLogs.map((activityLog) => (
                    <div className={`session-activity-line ${activityLog.level}`} key={`${activityLog.timestamp}-${activityLog.message}`}>
                      <time>{formatActivityTime(activityLog.timestamp)}</time>
                      <span>{activityLog.message}</span>
                    </div>
                  ))
                ) : (
                  <div className="session-activity-line">
                    <time>现在</time>
                    <span>请求已提交，等待后端返回进度...</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
          <GenerationSizeControl
            customValue={customSize}
            disabled={selectedSession.chatStatus === "sending"}
            idPrefix="session"
            label="分辨率"
            selectedValue={selectedSize}
            onCustomValueChange={setCustomSize}
            onSelectedValueChange={setSelectedSize}
          />
          <form className="session-composer" onSubmit={handleSubmit}>
            <input
              value={message}
              placeholder="和模型说明你想怎样处理这张图..."
              disabled={selectedSession.chatStatus === "sending"}
              onChange={(event) => setMessage(event.target.value)}
            />
            <button type="submit" disabled={!canSend} aria-label="发送">
              ↑
            </button>
          </form>
        </>
      ) : (
        <div className="session-empty">选择一张图片查看会话。</div>
      )}
    </aside>
  );
}

function formatActivityTime(timestamp: string): string {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
