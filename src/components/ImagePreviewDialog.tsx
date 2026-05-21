import { PointerEvent, useEffect, useMemo, useState, WheelEvent } from "react";
import { getSessionGenerationSourcePath } from "../domain/imageSessions";
import {
  INITIAL_PREVIEW_TRANSFORM,
  panPreviewTransform,
  zoomPreviewTransform
} from "../domain/imagePreviewTransform";
import type { ImageSession } from "../types/image";

interface ImagePreviewDialogProps {
  session: ImageSession;
  onClose: () => void;
  onUseImage: (imagePath: string) => void;
}

interface PreviewImage {
  kind: "original" | "generated";
  label: string;
  path: string;
}

export function ImagePreviewDialog({ session, onClose, onUseImage }: ImagePreviewDialogProps) {
  const previewImages = useMemo(() => buildPreviewImages(session), [session]);
  const currentImagePath = getSessionGenerationSourcePath(session);
  const [selectedPath, setSelectedPath] = useState(currentImagePath);
  const [transform, setTransform] = useState(INITIAL_PREVIEW_TRANSFORM);
  const [dragPointerId, setDragPointerId] = useState<number | null>(null);
  const selectedImage = previewImages.find((image) => image.path === selectedPath) ?? previewImages[0];
  const selectedUrl = window.batchImager?.getImageUrl(selectedImage.path) ?? selectedImage.path;
  const isUsingSelected = selectedImage.path === currentImagePath;

  useEffect(() => {
    if (!previewImages.some((image) => image.path === selectedPath)) {
      setSelectedPath(currentImagePath);
    }
  }, [currentImagePath, previewImages, selectedPath]);

  useEffect(() => {
    setTransform(INITIAL_PREVIEW_TRANSFORM);
    setDragPointerId(null);
  }, [selectedPath]);

  function handleWheel(event: WheelEvent<HTMLDivElement>): void {
    event.preventDefault();
    setTransform((currentTransform) => zoomPreviewTransform(currentTransform, event.deltaY));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragPointerId(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (dragPointerId !== event.pointerId) {
      return;
    }

    setTransform((currentTransform) => panPreviewTransform(currentTransform, event.movementX, event.movementY));
  }

  function stopDragging(event: PointerEvent<HTMLDivElement>): void {
    if (dragPointerId === event.pointerId) {
      setDragPointerId(null);
    }
  }

  return (
    <div className="modal-backdrop preview-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="preview-dialog"
        aria-label="图片预览"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="preview-header">
          <div>
            <h2>{session.fileName}</h2>
            <span>{selectedImage.label}</span>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div
          className={`preview-stage ${dragPointerId === null ? "" : "dragging"}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onWheel={handleWheel}
        >
          <img
            src={selectedUrl}
            alt={`${session.fileName} ${selectedImage.label}`}
            draggable={false}
            style={{
              transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`
            }}
          />
        </div>

        <div className="preview-footer">
          <div className="preview-strip" aria-label="历史图片">
            {previewImages.map((image) => {
              const imageUrl = window.batchImager?.getImageUrl(image.path) ?? image.path;
              const isSelected = image.path === selectedImage.path;

              return (
                <button
                  className={`preview-thumb ${isSelected ? "selected" : ""}`}
                  key={`${image.kind}-${image.path}`}
                  type="button"
                  onClick={() => {
                    setSelectedPath(image.path);
                  }}
                  title={image.label}
                >
                  <img src={imageUrl} alt={image.label} draggable={false} />
                  <span>{image.label}</span>
                </button>
              );
            })}
          </div>

          <button
            className="toolbar-button primary preview-use-button"
            type="button"
            disabled={isUsingSelected}
            onClick={() => {
              onUseImage(selectedImage.path);
              onClose();
            }}
          >
            {isUsingSelected ? "正在使用" : "使用此图"}
          </button>
        </div>
      </section>
    </div>
  );
}

function buildPreviewImages(session: ImageSession): PreviewImage[] {
  const generatedPaths = session.generatedFilePaths ?? (session.generatedFilePath ? [session.generatedFilePath] : []);

  return [
    {
      kind: "original",
      label: "原图",
      path: session.filePath
    },
    ...generatedPaths.map((path, index) => ({
      kind: "generated" as const,
      label: `记录 ${index + 1}`,
      path
    }))
  ];
}
