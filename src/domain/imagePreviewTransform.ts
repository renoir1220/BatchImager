export interface ImagePreviewTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface ImagePreviewFitInput {
  imageHeight: number;
  imageWidth: number;
  stageHeight: number;
  stageWidth: number;
}

export interface ImagePreviewZoomInput {
  anchorX: number;
  anchorY: number;
  deltaY: number;
}

export const MIN_PREVIEW_SCALE = 0.05;
export const MAX_PREVIEW_SCALE = 6;
export const INITIAL_PREVIEW_TRANSFORM: ImagePreviewTransform = {
  offsetX: 0,
  offsetY: 0,
  scale: 1
};

const PREVIEW_FIT_PADDING = 64;
const WHEEL_ZOOM_INTENSITY = 0.0018;

export function fitPreviewTransform({
  imageHeight,
  imageWidth,
  stageHeight,
  stageWidth
}: ImagePreviewFitInput): ImagePreviewTransform {
  if (imageHeight <= 0 || imageWidth <= 0 || stageHeight <= 0 || stageWidth <= 0) {
    return INITIAL_PREVIEW_TRANSFORM;
  }

  const availableWidth = Math.max(stageWidth - PREVIEW_FIT_PADDING, 1);
  const availableHeight = Math.max(stageHeight - PREVIEW_FIT_PADDING, 1);
  const scale = clamp(Math.min(availableWidth / imageWidth, availableHeight / imageHeight, 1), MIN_PREVIEW_SCALE, 1);

  return {
    offsetX: 0,
    offsetY: 0,
    scale: roundScale(scale)
  };
}

export function zoomPreviewTransform(
  transform: ImagePreviewTransform,
  { anchorX, anchorY, deltaY }: ImagePreviewZoomInput
): ImagePreviewTransform {
  const factor = Math.exp(-deltaY * WHEEL_ZOOM_INTENSITY);
  const scale = clamp(transform.scale * factor, MIN_PREVIEW_SCALE, MAX_PREVIEW_SCALE);
  const scaleRatio = scale / transform.scale;

  return {
    offsetX: anchorX - (anchorX - transform.offsetX) * scaleRatio,
    offsetY: anchorY - (anchorY - transform.offsetY) * scaleRatio,
    scale: roundScale(scale)
  };
}

export function panPreviewTransform(
  transform: ImagePreviewTransform,
  movementX: number,
  movementY: number
): ImagePreviewTransform {
  return {
    ...transform,
    offsetX: transform.offsetX + movementX,
    offsetY: transform.offsetY + movementY
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundScale(scale: number): number {
  return Math.round(scale * 1000) / 1000;
}
