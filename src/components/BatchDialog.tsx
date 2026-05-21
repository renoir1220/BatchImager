import { ChangeEvent, ClipboardEvent, useEffect, useRef, useState } from "react";
import {
  GenerationSizeControl,
  isGenerationSizeSelectionValid,
  resolveGenerationSizeSelection
} from "./GenerationSizeControl";

interface BatchReferenceImage {
  fileName: string;
  filePath: string;
  previewUrl: string;
}

interface BatchDialogProps {
  imageCount: number;
  onClose: () => void;
  onGenerate: (prompt: string, referenceImagePaths: string[], outputSize?: string) => void;
}

export function BatchDialog({ imageCount, onClose, onGenerate }: BatchDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<BatchReferenceImage[]>([]);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState("");
  const [customSize, setCustomSize] = useState("");
  const [isSavingReference, setIsSavingReference] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const canGenerate =
    prompt.trim().length > 0 && imageCount > 0 && !isSavingReference && isGenerationSizeSelectionValid(selectedSize, customSize);

  useEffect(() => () => {
    for (const previewUrl of previewUrlsRef.current) {
      URL.revokeObjectURL(previewUrl);
    }
  }, []);

  function handleGenerate(): void {
    if (!canGenerate) {
      return;
    }

    onGenerate(
      prompt.trim(),
      referenceImages.map((referenceImage) => referenceImage.filePath),
      resolveGenerationSizeSelection(selectedSize, customSize)
    );
  }

  async function addReferenceFiles(files: File[]): Promise<void> {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    if (imageFiles.length === 0) {
      setReferenceError("请粘贴或选择图片文件。");
      return;
    }

    setReferenceError(null);
    setIsSavingReference(true);

    try {
      for (const file of imageFiles) {
        const saved = await window.batchImager?.saveReferenceImage({
          data: await file.arrayBuffer(),
          fileName: file.name,
          mimeType: file.type
        });

        if (!saved) {
          throw new Error("当前运行环境不支持参考图。");
        }

        const previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.add(previewUrl);
        setReferenceImages((currentImages) => [
          ...currentImages,
          {
            fileName: saved.fileName,
            filePath: saved.filePath,
            previewUrl
          }
        ]);
      }
    } catch (error) {
      setReferenceError(error instanceof Error ? error.message : "参考图保存失败。");
    } finally {
      setIsSavingReference(false);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLElement>): void {
    const files = Array.from(event.clipboardData.files);

    if (files.some((file) => file.type.startsWith("image/"))) {
      event.preventDefault();
      void addReferenceFiles(files);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void addReferenceFiles(files);
  }

  function removeReferenceImage(filePath: string): void {
    setReferenceImages((currentImages) => {
      const removed = currentImages.find((referenceImage) => referenceImage.filePath === filePath);

      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrlsRef.current.delete(removed.previewUrl);
      }

      return currentImages.filter((referenceImage) => referenceImage.filePath !== filePath);
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="batch-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onPaste={handlePaste}
      >
        <div className="dialog-header">
          <h2 id="batch-dialog-title">批量处理</h2>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <label className="prompt-field">
          <span>本轮提示词</span>
          <textarea
            value={prompt}
            placeholder="将花束生成明亮室内商品图，保留花材颜色和形态。"
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <div className="reference-field">
          <div className="reference-field-header">
            <span>参考图</span>
            <button className="toolbar-button" type="button" onClick={() => fileInputRef.current?.click()}>
              添加图片
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleFileChange} />
          {referenceImages.length > 0 ? (
            <div className="reference-strip">
              {referenceImages.map((referenceImage) => (
                <button
                  className="reference-thumb"
                  key={referenceImage.filePath}
                  type="button"
                  aria-label={`移除参考图 ${referenceImage.fileName}`}
                  onClick={() => removeReferenceImage(referenceImage.filePath)}
                >
                  <img src={referenceImage.previewUrl} alt={referenceImage.fileName} draggable={false} />
                  <span>×</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="reference-drop">粘贴房间、场景或风格参考图</div>
          )}
          {isSavingReference ? <div className="dialog-meta">正在保存参考图...</div> : null}
          {referenceError ? <div className="dialog-error">{referenceError}</div> : null}
        </div>
        <GenerationSizeControl
          customValue={customSize}
          disabled={isSavingReference}
          idPrefix="batch"
          label="分辨率"
          selectedValue={selectedSize}
          onCustomValueChange={setCustomSize}
          onSelectedValueChange={setSelectedSize}
        />
        <div className="dialog-meta">作用范围：全部图片 {imageCount} 张</div>
        <div className="dialog-actions">
          <button className="toolbar-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="toolbar-button primary" type="button" disabled={!canGenerate} onClick={handleGenerate}>
            开始生成
          </button>
        </div>
      </section>
    </div>
  );
}
