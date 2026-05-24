import { FormEvent, KeyboardEvent, MouseEvent, useMemo, useRef, useState } from "react";
import type { AppLogEntry } from "../../electron/ipcTypes";
import type { ImageSession } from "../types/image";
import {
  GenerationSizeControl,
  isGenerationSizeSelectionValid,
  resolveGenerationSizeSelection
} from "./GenerationSizeControl";
import { AgentStatusLine } from "./AgentStatusLine";
import { ComposerReferenceStrip } from "./ComposerReferenceStrip";
import type { PreviewImage } from "./ImagePreviewDialog";
import { MarkdownMessage } from "./MarkdownMessage";
import { MessageActions } from "./MessageActions";
import { shouldSubmitComposerOnEnter } from "./composerKeyEvents";
import { useAutoScrollToThreadEnd } from "./useAutoScrollToThreadEnd";
import { usePastedReferenceImages } from "./usePastedReferenceImages";

interface SessionPanelProps {
  activityLogs: AppLogEntry[];
  selectedSession: ImageSession | null;
  onCopyImage: (imagePath: string) => void;
  onOpenImagePreview: (title: string, images: PreviewImage[], initialPath: string) => void;
  onSendMessage: (sessionId: string, content: string, outputSize?: string, referenceImagePaths?: string[]) => void;
  onStopWork: (sessionId: string) => void;
}

export function SessionPanel({
  activityLogs,
  selectedSession,
  onCopyImage,
  onOpenImagePreview,
  onSendMessage,
  onStopWork
}: SessionPanelProps) {
  const [message, setMessage] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [customSize, setCustomSize] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const pastedReferences = usePastedReferenceImages();
  const canSend = Boolean(
    selectedSession &&
      message.trim() &&
      !pastedReferences.isSavingReference &&
      isGenerationSizeSelectionValid(selectedSize, customSize)
  );
  const isAgentWorking = Boolean(
    selectedSession && (selectedSession.chatStatus === "sending" || selectedSession.status === "generating")
  );
  const currentActivityLog = activityLogs.at(-1);
  const threadContentSignature = useMemo(
    () => getSessionThreadContentSignature(selectedSession, currentActivityLog?.message),
    [currentActivityLog?.message, selectedSession]
  );
  useAutoScrollToThreadEnd(threadRef, threadContentSignature);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!selectedSession) {
      return;
    }

    if (isAgentWorking) {
      onStopWork(selectedSession.id);
      return;
    }

    if (!canSend) {
      return;
    }

    onSendMessage(
      selectedSession.id,
      message.trim(),
      resolveGenerationSizeSelection(selectedSize, customSize),
      pastedReferences.referenceImages.map((referenceImage) => referenceImage.filePath)
    );
    setMessage("");
    pastedReferences.clearReferenceImages();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (shouldSubmitComposerOnEnter(event)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function handleImageContextMenu(event: MouseEvent, imagePath: string): void {
    event.preventDefault();
    onCopyImage(imagePath);
  }

  function openSingleImagePreview(title: string, label: string, imagePath: string): void {
    onOpenImagePreview(title, [{ key: imagePath, label, path: imagePath }], imagePath);
  }

  function openReferencePreview(referenceFilePaths: string[], selectedPath: string): void {
    onOpenImagePreview(
      "参考图",
      referenceFilePaths.map((path, index) => ({
        key: path,
        label: `参考图 ${index + 1}`,
        path
      })),
      selectedPath
    );
  }

  return (
    <div className="session-tab-panel" aria-label="当前图片会话">
      {selectedSession ? (
        <>
          <div className="session-thread" ref={threadRef}>
            {selectedSession.chatMessages.length === 0 ? (
              <div className="thread-line muted">图片已导入。直接描述你想要的修改，模型会在需要时调用图片生成工具。</div>
            ) : (
              selectedSession.chatMessages.map((chatMessage) => (
                <div className={`message-row ${chatMessage.role}`} key={chatMessage.id}>
                  <div className={`thread-line ${chatMessage.role}`}>
                    <MarkdownMessage content={chatMessage.content} />
                    {chatMessage.sourceFilePath ? (
                      <div className="thread-image-card">
                        <div className="thread-image-title">
                          <span>输入图</span>
                          <span>{getFileName(chatMessage.sourceFilePath)}</span>
                        </div>
                        <img
                          className="thread-image"
                          src={window.batchImager?.getImageUrl(chatMessage.sourceFilePath) ?? chatMessage.sourceFilePath}
                          alt="输入图"
                          draggable={false}
                          onContextMenu={(event) => handleImageContextMenu(event, chatMessage.sourceFilePath!)}
                          onDoubleClick={() => openSingleImagePreview("输入图", getFileName(chatMessage.sourceFilePath!), chatMessage.sourceFilePath!)}
                        />
                      </div>
                    ) : null}
                    {chatMessage.generatedFilePath ? (
                      <div className="thread-image-card">
                        <div className="thread-image-title">
                          <span>生成图</span>
                          <span>{getFileName(chatMessage.generatedFilePath)}</span>
                        </div>
                        <img
                          className="thread-image"
                          src={window.batchImager?.getImageUrl(chatMessage.generatedFilePath) ?? chatMessage.generatedFilePath}
                          alt="生成结果"
                          draggable={false}
                          onContextMenu={(event) => handleImageContextMenu(event, chatMessage.generatedFilePath!)}
                          onDoubleClick={() => openSingleImagePreview("生成图", getFileName(chatMessage.generatedFilePath!), chatMessage.generatedFilePath!)}
                        />
                        <span className="thread-result">已更新图片</span>
                      </div>
                    ) : isDeletedGeneratedImageMessage(chatMessage) ? (
                      <div className="thread-image-card deleted-generated-record" aria-label="生成记录已删除">
                        <div className="thread-image-title">
                          <span>生成图</span>
                          <span>记录已删除</span>
                        </div>
                        <div className="deleted-generated-placeholder">这条生成记录已从工作区删除</div>
                      </div>
                    ) : null}
                    {chatMessage.referenceFilePaths?.length ? (
                      <div className="thread-image-card">
                        <div className="thread-image-title">
                          <span>参考图</span>
                          <span>{chatMessage.referenceFilePaths.length} 张</span>
                        </div>
                        <div className="thread-reference-grid">
                          {chatMessage.referenceFilePaths.map((referenceFilePath) => (
                            <img
                              key={referenceFilePath}
                              src={window.batchImager?.getImageUrl(referenceFilePath) ?? referenceFilePath}
                              alt="参考图"
                              draggable={false}
                              onContextMenu={(event) => handleImageContextMenu(event, referenceFilePath)}
                              onDoubleClick={() => openReferencePreview(chatMessage.referenceFilePaths ?? [], referenceFilePath)}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <MessageActions content={chatMessage.content} />
                </div>
              ))
            )}
          </div>
          <div className="session-control-dock">
            <AgentStatusLine
              isWorking={isAgentWorking}
              message={currentActivityLog?.message}
              workingText="请求已提交，等待后端返回进度..."
            />
            <form className="session-composer" onSubmit={handleSubmit} onPaste={pastedReferences.handlePaste}>
              <ComposerReferenceStrip
                error={pastedReferences.referenceError}
                images={pastedReferences.referenceImages}
                isSaving={pastedReferences.isSavingReference}
                onRemove={pastedReferences.removeReferenceImage}
              />
              <textarea
                value={message}
                placeholder="和模型说明你想怎样处理这张图... 可直接粘贴参考图"
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              <div className="composer-toolbar">
                <GenerationSizeControl
                  customValue={customSize}
                  idPrefix="session"
                  label="生成比例："
                  selectedValue={selectedSize}
                  onCustomValueChange={setCustomSize}
                  onSelectedValueChange={setSelectedSize}
                />
              </div>
              <button type="submit" disabled={isAgentWorking ? false : !canSend} aria-label={isAgentWorking ? "停止" : "发送"}>
                {isAgentWorking ? <span className="composer-stop-icon" aria-hidden="true" /> : "↑"}
              </button>
            </form>
          </div>
        </>
      ) : (
        <div className="session-empty">选择一张图片查看会话。</div>
      )}
    </div>
  );
}

function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return filePath.slice(lastSlash + 1);
}

function isDeletedGeneratedImageMessage(message: ImageSession["chatMessages"][number]): boolean {
  return message.contextType === "generated-image" && !message.generatedFilePath;
}

function getSessionThreadContentSignature(session: ImageSession | null, activityMessage?: string): string {
  if (!session) {
    return "empty";
  }

  return [
    session.id,
    session.status,
    session.chatStatus,
    activityMessage ?? "",
    ...session.chatMessages.map((message) =>
      [
        message.id,
        message.role,
        message.content,
        message.contextType ?? "",
        message.sourceFilePath ?? "",
        message.generatedFilePath ?? "",
        message.referenceFilePaths?.join("|") ?? ""
      ].join(":")
    )
  ].join("\n");
}
