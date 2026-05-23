import { PointerEvent, SyntheticEvent, useEffect, useLayoutEffect, useRef, useState, WheelEvent } from "react";
import {
  fitPreviewTransform,
  INITIAL_PREVIEW_TRANSFORM,
  panPreviewTransform,
  zoomPreviewTransform
} from "../domain/imagePreviewTransform";
import { OsDialog, OsDialogClose, OsDialogTitle } from "./os";

export interface PreviewImage {
  key?: string;
  label: string;
  path: string;
}

interface ImagePreviewDimensions {
  height: number;
  width: number;
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
  const [imageDimensions, setImageDimensions] = useState<ImagePreviewDimensions | null>(null);
  const [stageSize, setStageSize] = useState<ImagePreviewDimensions | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const selectedImage = images.find((image) => image.path === selectedPath) ?? images[0];
  const selectedUrl = selectedImage ? window.batchImager?.getImageUrl(selectedImage.path) ?? selectedImage.path : "";
  const canUseImage = Boolean(onUseImage);
  const isUsingSelected = selectedImage ? selectedImage.path === currentImagePath : false;
  const zoomPercent = `${Math.round(transform.scale * 100)}%`;

  useEffect(() => {
    if (!images.some((image) => image.path === selectedPath)) {
      setSelectedPath(initialPath ?? images[0]?.path ?? "");
    }
  }, [images, initialPath, selectedPath]);

  useEffect(() => {
    setTransform(INITIAL_PREVIEW_TRANSFORM);
    setDragPointerId(null);
    setImageDimensions(null);
  }, [selectedPath]);

  useLayoutEffect(() => {
    const stage = stageRef.current;

    if (!stage) {
      return undefined;
    }

    const previewStage = stage;

    function updateStageSize(): void {
      const rect = previewStage.getBoundingClientRect();

      if (rect.width > 0 && rect.height > 0) {
        setStageSize({ height: rect.height, width: rect.width });
      }
    }

    updateStageSize();
    const animationFrameId = window.requestAnimationFrame(updateStageSize);

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateStageSize);
      return () => {
        window.cancelAnimationFrame(animationFrameId);
        window.removeEventListener("resize", updateStageSize);
      };
    }

    const observer = new ResizeObserver(updateStageSize);
    observer.observe(previewStage);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      observer.disconnect();
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!imageDimensions || !stageSize) {
      return;
    }

    setTransform(
      fitPreviewTransform({
        imageHeight: imageDimensions.height,
        imageWidth: imageDimensions.width,
        stageHeight: stageSize.height,
        stageWidth: stageSize.width
      })
    );
  }, [imageDimensions, selectedPath, stageSize]);

  function handleWheel(event: WheelEvent<HTMLDivElement>): void {
    const stageRect = event.currentTarget.getBoundingClientRect();

    setTransform((currentTransform) =>
      zoomPreviewTransform(currentTransform, {
        anchorX: event.clientX - stageRect.left - stageRect.width / 2,
        anchorY: event.clientY - stageRect.top - stageRect.height / 2,
        deltaY: event.deltaY
      })
    );
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

  function handleImageLoad(event: SyntheticEvent<HTMLImageElement>): void {
    const { naturalHeight, naturalWidth } = event.currentTarget;

    if (naturalHeight > 0 && naturalWidth > 0) {
      const nextDimensions = { height: naturalHeight, width: naturalWidth };
      const stageRect = stageRef.current?.getBoundingClientRect();
      setImageDimensions(nextDimensions);

      if (stageRect && stageRect.width > 0 && stageRect.height > 0) {
        const nextStageSize = { height: stageRect.height, width: stageRect.width };
        setStageSize(nextStageSize);
        setTransform(
          fitPreviewTransform({
            imageHeight: nextDimensions.height,
            imageWidth: nextDimensions.width,
            stageHeight: nextStageSize.height,
            stageWidth: nextStageSize.width
          })
        );
      }
    }
  }

  function fitSelectedImage(): void {
    if (!imageDimensions || !stageSize) {
      setTransform(INITIAL_PREVIEW_TRANSFORM);
      return;
    }

    setTransform(
      fitPreviewTransform({
        imageHeight: imageDimensions.height,
        imageWidth: imageDimensions.width,
        stageHeight: stageSize.height,
        stageWidth: stageSize.width
      })
    );
  }

  function zoomFromCenter(deltaY: number): void {
    setTransform((currentTransform) =>
      zoomPreviewTransform(currentTransform, {
        anchorX: 0,
        anchorY: 0,
        deltaY
      })
    );
  }

  if (!selectedImage) {
    return null;
  }

  return (
    <OsDialog
      overlayClassName={`modal-backdrop preview-backdrop ${isFullscreen ? "preview-backdrop-fullscreen" : ""}`}
      contentClassName={`preview-dialog ${isFullscreen ? "fullscreen" : ""}`}
      aria-label="图片预览"
      onClose={onClose}
    >
      <header className="preview-header">
        <div>
          <OsDialogTitle asChild>
            <h2>{title}</h2>
          </OsDialogTitle>
          <span>{selectedImage.label}</span>
        </div>
        <div className="preview-header-actions">
          <button className="preview-control-button" type="button" aria-label="缩小" title="缩小" onClick={() => zoomFromCenter(180)}>
            <MinusIcon />
          </button>
          <span className="preview-zoom-readout" aria-label={`当前缩放 ${zoomPercent}`}>
            {zoomPercent}
          </span>
          <button className="preview-control-button" type="button" aria-label="放大" title="放大" onClick={() => zoomFromCenter(-180)}>
            <PlusIcon />
          </button>
          <button className="preview-control-button" type="button" aria-label="适应窗口" title="适应窗口" onClick={fitSelectedImage}>
            <FitIcon />
          </button>
          <button
            className="preview-control-button"
            type="button"
            aria-label={isFullscreen ? "退出全屏" : "全屏查看"}
            aria-pressed={isFullscreen}
            title={isFullscreen ? "退出全屏" : "全屏查看"}
            onClick={() => setIsFullscreen((currentValue) => !currentValue)}
          >
            <FullscreenIcon isFullscreen={isFullscreen} />
          </button>
          <OsDialogClose asChild>
            <button className="icon-button" type="button" aria-label="关闭">
              ×
            </button>
          </OsDialogClose>
        </div>
      </header>

      <div
        ref={stageRef}
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
          height={imageDimensions?.height}
          width={imageDimensions?.width}
          onLoad={handleImageLoad}
          style={{
            transform: `translate(-50%, -50%) translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.scale})`
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
    </OsDialog>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
      <path d="M8 3.5v9" />
      <path d="M3.5 8h9" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
      <path d="M3.5 8h9" />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
      <path d="M3.5 6V3.5H6" />
      <path d="M10 3.5h2.5V6" />
      <path d="M12.5 10v2.5H10" />
      <path d="M6 12.5H3.5V10" />
    </svg>
  );
}

function FullscreenIcon({ isFullscreen }: { isFullscreen: boolean }) {
  if (isFullscreen) {
    return (
      <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
        <path d="M6.4 3.6v2.8H3.6" />
        <path d="M9.6 3.6v2.8h2.8" />
        <path d="M9.6 12.4V9.6h2.8" />
        <path d="M6.4 12.4V9.6H3.6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
      <path d="M6.2 3.5H3.5v2.7" />
      <path d="M9.8 3.5h2.7v2.7" />
      <path d="M12.5 9.8v2.7H9.8" />
      <path d="M3.5 9.8v2.7h2.7" />
    </svg>
  );
}
