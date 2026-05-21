export interface ImagePreviewTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export const MIN_PREVIEW_SCALE = 0.25;
export const MAX_PREVIEW_SCALE = 6;
export const INITIAL_PREVIEW_TRANSFORM: ImagePreviewTransform = {
  offsetX: 0,
  offsetY: 0,
  scale: 1
};

const WHEEL_ZOOM_FACTOR = 1.14;

export function zoomPreviewTransform(transform: ImagePreviewTransform, deltaY: number): ImagePreviewTransform {
  const factor = deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
  const scale = clamp(transform.scale * factor, MIN_PREVIEW_SCALE, MAX_PREVIEW_SCALE);

  return {
    ...transform,
    scale
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
