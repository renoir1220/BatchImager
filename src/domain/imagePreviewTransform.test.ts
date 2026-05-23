import { describe, expect, it } from "vitest";
import {
  fitPreviewTransform,
  INITIAL_PREVIEW_TRANSFORM,
  panPreviewTransform,
  zoomPreviewTransform
} from "./imagePreviewTransform";

describe("image preview transform", () => {
  it("starts fitted and centered", () => {
    expect(INITIAL_PREVIEW_TRANSFORM).toEqual({ offsetX: 0, offsetY: 0, scale: 1 });
  });

  it("fits large images inside the preview stage without upscaling", () => {
    expect(
      fitPreviewTransform({
        imageHeight: 3000,
        imageWidth: 4000,
        stageHeight: 700,
        stageWidth: 1000
      })
    ).toEqual({ offsetX: 0, offsetY: 0, scale: 0.212 });
  });

  it("keeps small images at natural size by default", () => {
    expect(
      fitPreviewTransform({
        imageHeight: 200,
        imageWidth: 300,
        stageHeight: 700,
        stageWidth: 1000
      })
    ).toEqual({ offsetX: 0, offsetY: 0, scale: 1 });
  });

  it("zooms in around the pointer anchor and clamps the maximum scale", () => {
    const zoomed = zoomPreviewTransform(
      { offsetX: 0, offsetY: 0, scale: 5.9 },
      {
        anchorX: 120,
        anchorY: -80,
        deltaY: -120
      }
    );

    expect(zoomed.scale).toBe(6);
    expect(zoomed.offsetX).toBeCloseTo(-2.03, 2);
    expect(zoomed.offsetY).toBeCloseTo(1.36, 2);
  });

  it("zooms out with wheel down and clamps the minimum scale", () => {
    const zoomed = zoomPreviewTransform(
      { offsetX: 0, offsetY: 0, scale: 0.052 },
      {
        anchorX: 0,
        anchorY: 0,
        deltaY: 120
      }
    );

    expect(zoomed.scale).toBe(0.05);
  });

  it("pans by pointer movement", () => {
    expect(panPreviewTransform({ offsetX: 4, offsetY: -2, scale: 1.5 }, 10, -8)).toEqual({
      offsetX: 14,
      offsetY: -10,
      scale: 1.5
    });
  });
});
