import { ClipboardEvent, useEffect, useRef, useState } from "react";
import { getFileName } from "./workspaceImageDrag";

export interface PastedReferenceImage {
  fileName: string;
  filePath: string;
  previewUrl: string;
}

export function usePastedReferenceImages() {
  const [referenceImages, setReferenceImages] = useState<PastedReferenceImage[]>([]);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [isSavingReference, setIsSavingReference] = useState(false);
  const previewUrlsRef = useRef(new Set<string>());

  useEffect(() => () => {
    for (const previewUrl of previewUrlsRef.current) {
      URL.revokeObjectURL(previewUrl);
    }
  }, []);

  async function addReferenceFiles(files: File[]): Promise<void> {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    if (imageFiles.length === 0) {
      setReferenceError("请粘贴图片文件。");
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

  function addReferenceImagePath(filePath: string, fileName = getFileName(filePath)): void {
    setReferenceError(null);
    setReferenceImages((currentImages) => {
      if (currentImages.some((referenceImage) => referenceImage.filePath === filePath)) {
        return currentImages;
      }

      return [
        ...currentImages,
        {
          fileName,
          filePath,
          previewUrl: window.batchImager?.getImageUrl(filePath) ?? filePath
        }
      ];
    });
  }

  function handlePaste(event: ClipboardEvent<HTMLElement>): void {
    const files = getClipboardImageFiles(event);

    if (files.some((file) => file.type.startsWith("image/"))) {
      event.preventDefault();
      void addReferenceFiles(files);
    }
  }

  function removeReferenceImage(filePath: string): void {
    setReferenceImages((currentImages) => {
      const removed = currentImages.find((referenceImage) => referenceImage.filePath === filePath);

      if (removed) {
        if (previewUrlsRef.current.delete(removed.previewUrl)) {
          URL.revokeObjectURL(removed.previewUrl);
        }
      }

      return currentImages.filter((referenceImage) => referenceImage.filePath !== filePath);
    });
  }

  function clearReferenceImages(): void {
    for (const previewUrl of previewUrlsRef.current) {
      URL.revokeObjectURL(previewUrl);
    }
    previewUrlsRef.current.clear();
    setReferenceImages([]);
    setReferenceError(null);
  }

  return {
    addReferenceImagePath,
    addReferenceFiles,
    clearReferenceImages,
    handlePaste,
    isSavingReference,
    referenceError,
    referenceImages,
    removeReferenceImage
  };
}

function getClipboardImageFiles(event: ClipboardEvent<HTMLElement>): File[] {
  const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));

  if (files.length > 0) {
    return files;
  }

  return Array.from(event.clipboardData.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item, index) => item.getAsFile() ?? new File([], `clipboard-${index + 1}.png`, { type: item.type }))
    .filter((file) => file.size > 0);
}
