import type { BatchPlan, EsseImageRequest, WorkerCommand } from "../types/projectManager";

export function createEsseImageRequestPlan(
  imageRequests: EsseImageRequest[],
  referenceImagePaths: string[] = [],
  planId = createId("plan")
): BatchPlan {
  const referenceImages = referenceImagePaths.map((filePath, index) => ({
    filePath,
    id: `esse-ref-${index + 1}`,
    label: `参考图 ${index + 1}`
  }));
  const referenceImageIds = referenceImages.map((referenceImage) => referenceImage.id);
  const commands = imageRequests.map((imageRequest, index): WorkerCommand => {
    const targetSessionId =
      imageRequest.target === "existing" && imageRequest.sourceSessionId ? imageRequest.sourceSessionId : `new-${index + 1}`;

    return {
      constraints: [],
      generationMode: imageRequest.mode,
      id: createId(`cmd-${index + 1}`),
      instruction: imageRequest.prompt,
      ...(imageRequest.size ? { outputSize: imageRequest.size } : {}),
      planId,
      ...(referenceImageIds.length ? { referenceImageIds } : {}),
      source: "project-manager",
      ...(imageRequest.sourceSessionId ? { sourceSessionId: imageRequest.sourceSessionId } : {}),
      target: imageRequest.target,
      targetSessionId
    };
  });

  return {
    commands,
    globalInstruction: `Esse 计划生成 ${commands.length} 张图片，确认后才会执行。`,
    id: planId,
    ...(referenceImages.length ? { referenceImages } : {}),
    status: "draft",
    targetSessionIds: commands.map((command) => command.targetSessionId),
    title: "Esse生成任务预览"
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
