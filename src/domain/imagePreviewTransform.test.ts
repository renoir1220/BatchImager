import { describe, expect, it } from "vitest";
import { INITIAL_PREVIEW_TRANSFORM, panPreviewTransform, zoomPreviewTransform } from "./imagePreviewTransform";

describe("image preview transform", () => {
  it("starts fitted and centered", () => {
    expect(INITIAL_PREVIEW_TRANSFORM).toEqual({ offsetX: 0, offsetY: 0, scale: 1 });
  });

  it("zooms in with wheel up and clamps the maximum scale", () => {
    const zoomed = zoomPreviewTransform({ offsetX: 0, offsetY: 0, scale: 5.9 }, -120);

    expect(zoomed.scale).toBe(6);
    expect(zoomed.offsetX).toBe(0);
    expect(zoomed.offsetY).toBe(0);
  });

  it("zooms out with wheel down and clamps the minimum scale", () => {
    const zoomed = zoomPreviewTransform({ offsetX: 0, offsetY: 0, scale: 0.26 }, 120);

    expect(zoomed.scale).toBe(0.25);
  });

  it("pans by pointer movement", () => {
    expect(panPreviewTransform({ offsetX: 4, offsetY: -2, scale: 1.5 }, 10, -8)).toEqual({
      offsetX: 14,
      offsetY: -10,
      scale: 1.5
    });
  });
});
