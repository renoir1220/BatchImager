import { FormEvent, KeyboardEvent, MouseEvent, useState } from "react";
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
import { usePastedReferenceImages } from "./usePastedReferenceImages";

interface SessionPanelProps {
  activityLogs: AppLogEntry[];
  selectedSession: ImageSession | null;
  onCopyImage: (imagePath: string) => void;
  onOpenImagePreview: (title: string, images: PreviewImage[], initialPath: string) => void;
  onSendMessage: (sessionId: string, content: string, outputSize?: string, referenceImagePaths?: string[]) => void;
}

export function SessionPanel({ activityLogs, selectedSession, onCopyImage, onOpenImagePreview, onSendMessage }: SessionPanelProps) {
  const [message, setMessage] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [customSize, setCustomSize] = useState("");
  const pastedReferences = usePastedReferenceImages();
  const displayPath = selectedSession?.filePath ?? null;
  const imageUrl = displayPath ? window.batchImager?.getImageUrl(displayPath) ?? displayPath : null;
  const canSend = Boolean(
    selectedSession &&
      message.trim() &&
      selectedSession.chatStatus !== "sending" &&
      !pastedReferences.isSavingReference &&
      isGenerationSizeSelectionValid(selectedSize, customSize)
  );
  const isAgentWorking = Boolean(
    selectedSession && (selectedSession.chatStatus === "sending" || selectedSession.status === "generating")
  );
  const currentActivityLog = activityLogs.at(-1);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!selectedSession || !canSend) {
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
    if (event.key === "Enter" && !event.shiftKey) {
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
      {selectedSession && imageUrl ? (
        <>
          <div className="session-preview-frame">
            <img
              className="session-preview"
              src={imageUrl}
              alt={selectedSession.fileName}
              draggable={false}
              onContextMenu={(event) => handleImageContextMenu(event, selectedSession.filePath)}
              onDoubleClick={() => openSingleImagePreview(selectedSession.fileName, "原图", selectedSession.filePath)}
            />
          </div>
          <div className="session-thread">
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
                  <MessageActions content={chatMessage.content} tone={chatMessage.role} />
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
                disabled={selectedSession.chatStatus === "sending"}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              <div className="composer-toolbar">
                <GenerationSizeControl
                  customValue={customSize}
                  disabled={selectedSession.chatStatus === "sending"}
                  idPrefix="session"
                  label="生成比例："
                  selectedValue={selectedSize}
                  onCustomValueChange={setCustomSize}
                  onSelectedValueChange={setSelectedSize}
                />
              </div>
              <button type="submit" disabled={!canSend} aria-label="发送">
                ↑
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
