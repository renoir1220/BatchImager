import { describe, expect, test } from "vitest";
import { createEsseImageRequestPlan } from "./esseImageRequestPlan";
import type { EsseImageRequest } from "../types/projectManager";

describe("esseImageRequestPlan", () => {
  test("turns Esse image requests into a draft batch plan for confirmation", () => {
    const imageRequests: EsseImageRequest[] = [
      {
        id: "esse-image-1",
        mode: "generate",
        prompt: "根据参考图生成内部设计正面视角",
        size: "1536x1024",
        target: "new"
      },
      {
        id: "esse-image-2",
        mode: "generate",
        prompt: "根据参考图生成内部设计侧面视角",
        target: "new"
      }
    ];

    const plan = createEsseImageRequestPlan(imageRequests, ["C:/project/refs/cafe.jpg"], "plan-1");

    expect(plan).toMatchObject({
      globalInstruction: "Esse 计划生成 2 张图片，确认后才会执行。",
      id: "plan-1",
      referenceImages: [{ filePath: "C:/project/refs/cafe.jpg", id: "esse-ref-1", label: "参考图 1" }],
      status: "draft",
      targetSessionIds: ["new-1", "new-2"],
      title: "Esse生成任务预览"
    });
    expect(plan.commands).toEqual([
      expect.objectContaining({
        generationMode: "generate",
        instruction: "根据参考图生成内部设计正面视角",
        outputSize: "1536x1024",
        referenceImageIds: ["esse-ref-1"],
        target: "new",
        targetSessionId: "new-1"
      }),
      expect.objectContaining({
        generationMode: "generate",
        instruction: "根据参考图生成内部设计侧面视角",
        referenceImageIds: ["esse-ref-1"],
        target: "new",
        targetSessionId: "new-2"
      })
    ]);
  });
});
