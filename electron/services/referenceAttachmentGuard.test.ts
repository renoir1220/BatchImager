import { describe, expect, test } from "vitest";
import {
  MISSING_REFERENCE_IMAGE_REPLY,
  shouldReportMissingReferenceImage
} from "./referenceAttachmentGuard";

describe("referenceAttachmentGuard", () => {
  test("reports missing reference images when the latest user message points to an attachment", () => {
    expect(
      shouldReportMissingReferenceImage({
        messages: [{ role: "user", content: "按附件里的参考图继续生成三张内部设计图" }],
        referenceImageCount: 0
      })
    ).toBe(true);
  });

  test("does not report missing references when a reference image is available", () => {
    expect(
      shouldReportMissingReferenceImage({
        messages: [{ role: "user", content: "按附件里的参考图继续生成三张内部设计图" }],
        referenceImageCount: 1
      })
    ).toBe(false);
  });

  test("does not treat the current selected image as a missing attachment", () => {
    expect(
      shouldReportMissingReferenceImage({
        messages: [{ role: "user", content: "把当前图片改成白底商品图" }],
        referenceImageCount: 0
      })
    ).toBe(false);
  });

  test("uses one shared Chinese reply for chat and agent orchestration", () => {
    expect(MISSING_REFERENCE_IMAGE_REPLY).toBe("我没有收到可用的参考图附件，请先粘贴或添加参考图后再发送。");
  });
});
