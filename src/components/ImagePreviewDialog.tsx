import { PointerEvent, useEffect, useState, WheelEvent } from "react";
import {
  INITIAL_PREVIEW_TRANSFORM,
  panPreviewTransform,
  zoomPreviewTransform
} from "../domain/imagePreviewTransform";

export interface PreviewImage {
  key?: string;
  label: string;
  path: string;
}

interface ImagePreviewDialogProps {
  currentImagePath?: string;
  images: PreviewImage[];
  initialPath?: string;
  title: string;
  onClose: () => void;
  onCopyImage?: (imagePath: string) => void;
  onUseImage?: (imagePath: string) => void;
}

export function ImagePreviewDialog({
  currentImagePath,
  images,
  initialPath,
  title,
  onClose,
  onCopyImage,
  onUseImage
}: ImagePreviewDialogProps) {
  const [selectedPath, setSelectedPath] = useState(initialPath ?? images[0]?.path ?? "");
  const [transform, setTransform] = useState(INITIAL_PREVIEW_TRANSFORM);
  const [dragPointerId, setDragPointerId] = useState<number | null>(null);
  const selectedImage = images.find((image) => image.path === selectedPath) ?? images[0];
  const selectedUrl = selectedImage ? window.batchImager?.getImageUrl(selectedImage.path) ?? selectedImage.path : "";
  const canUseImage = Boolean(onUseImage);
  const isUsingSelected = selectedImage ? selectedImage.path === currentImagePath : false;

  useEffect(() => {
    if (!images.some((image) => image.path === selectedPath)) {
      setSelectedPath(initialPath ?? images[0]?.path ?? "");
    }
  }, [images, initialPath, selectedPath]);

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

  function handleCopySelectedImage(): void {
    if (selectedImage) {
      onCopyImage?.(selectedImage.path);
    }
  }

  if (!selectedImage) {
    return null;
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
            <h2>{title}</h2>
            <span>{selectedImage.label}</span>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div
          className={`preview-stage ${dragPointerId === null ? "" : "dragging"}`}
          onContextMenu={(event) => {
            event.preventDefault();
            handleCopySelectedImage();
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onWheel={handleWheel}
        >
          <img
            src={selectedUrl}
            alt={`${title} ${selectedImage.label}`}
            draggable={false}
            style={{
              transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`
            }}
          />
        </div>

        <div className="preview-footer">
          <div className="preview-strip" aria-label="图片列表">
            {images.map((image) => {
              const imageUrl = window.batchImager?.getImageUrl(image.path) ?? image.path;
              const isSelected = image.path === selectedImage.path;

              return (
                <button
                  className={`preview-thumb ${isSelected ? "selected" : ""}`}
                  key={image.key ?? image.path}
                  type="button"
                  onClick={() => {
                    setSelectedPath(image.path);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onCopyImage?.(image.path);
                  }}
                  title={image.label}
                >
                  <img src={imageUrl} alt={image.label} draggable={false} />
                  <span>{image.label}</span>
                </button>
              );
            })}
          </div>

          {canUseImage ? (
            <button
              className="toolbar-button primary preview-use-button"
              type="button"
              disabled={isUsingSelected}
              onClick={() => {
                onUseImage?.(selectedImage.path);
                onClose();
              }}
            >
              {isUsingSelected ? "正在使用" : "使用此图"}
            </button>
          ) : (
            <button className="toolbar-button preview-use-button" type="button" onClick={handleCopySelectedImage}>
              复制图片
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
