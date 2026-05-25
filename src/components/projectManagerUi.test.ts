import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

function readProjectFile(filePath: string): string {
  return readFileSync(resolve(process.cwd(), filePath), "utf8");
}

describe("project plan UI wiring", () => {
  test("right sidebar exposes Esse agent and current image tabs", () => {
    const app = readProjectFile("src/App.tsx");
    const panel = readProjectFile("src/components/ProjectPlanPanel.tsx");
    const styles = readProjectFile("src/styles.css");

    expect(app).toContain("Esse");
    expect(app).toContain("当前图片");
    expect(app).toContain("ProjectPlanPanel");
    expect(app).toContain("SessionPanel");
    expect(app).toContain("esseTabMascot");
    expect(app).toContain("sidebar-tab-mascot");
    expect(panel).not.toContain("当前项目：");
    expect(panel).not.toContain("<h1>Esse智能体</h1>");
    expect(panel).not.toContain("imageCount");
    expect(styles).toContain("grid-template-rows: minmax(0, 1fr) auto;");
  });

  test("the main app no longer exposes the unavailable batch dialog entrypoint", () => {
    const app = readProjectFile("src/App.tsx");
    const toolbar = readProjectFile("src/components/AppToolbar.tsx");

    expect(app).not.toContain("BatchDialog");
    expect(app).not.toContain("createProjectManagerPlan");
    expect(toolbar).not.toContain("批量处理");
  });

  test("Esse IPC is exposed only through preload", () => {
    expect(readProjectFile("electron/preload.ts")).toContain("sendEsseMessage");
    expect(readProjectFile("electron/preload.ts")).not.toContain("createProjectManagerPlan");
    expect(readProjectFile("electron/main.ts")).not.toContain("project-manager:create-plan");
    expect(readProjectFile("electron/main.ts")).toContain("esse:send-message");
    expect(readProjectFile("electron/ipcTypes.ts")).toContain("persona?: EssePersona");
  });

  test("collapsed batch plans can be expanded from the chat stream", () => {
    const panel = readProjectFile("src/components/ProjectPlanPanel.tsx");

    expect(panel).toContain('aria-label={collapsed ? "展开方案" : "收起方案"}');
    expect(panel).toContain("plan-toggle-icon");
    expect(panel).not.toContain("{collapsed ? \"展开方案\" : \"收起\"}");
    expect(panel).toContain("expandedPlanIds");
  });

  test("batch plan card shows only a concise approval title above command previews", () => {
    const panel = readProjectFile("src/components/ProjectPlanPanel.tsx");
    const styles = readProjectFile("src/styles.css");

    const planTitleRule = styles.match(/\.plan-title\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

    expect(panel).toContain("formatPlanApprovalTitle(plan)");
    expect(panel).toContain('className="plan-title"');
    expect(panel).toContain("Esse有${plan.commands.length}个任务等你确认");
    expect(panel).toContain("Esse工作进度：${reportedCount}/${plan.commands.length}");
    expect(panel).toContain("Esse完成了${plan.commands.length}个任务");
    expect(panel).toContain("plan-title-spinner");
    expect(panel).not.toContain("plan-eyebrow");
    expect(panel).not.toContain("plan-summary-line");
    expect(panel).not.toContain("<p>{plan.globalInstruction}</p>");
    expect(planTitleRule).toContain("font-size: 13px");
    expect(planTitleRule).toContain("font-weight: 560");
    expect(planTitleRule).toContain("color: #4f524b");
    expect(styles).toContain(".plan-title-row");
    expect(styles).toContain("flex: 1 1 auto");
    expect(styles).not.toContain(".batch-plan-card header div");
    expect(styles).not.toContain(".plan-eyebrow");
    expect(styles).not.toContain(".plan-summary-line");
  });

  test("batch plan cards preview command prompts and reference images before execution", () => {
    const panel = readProjectFile("src/components/ProjectPlanPanel.tsx");
    const styles = readProjectFile("src/styles.css");

    expect(panel).toContain("Prompt 预览");
    expect(panel).toContain("command-reference-strip");
    expect(panel).toContain("确认执行");
    expect(panel).toContain("重试失败项");
    expect(styles).toContain(".command-reference-strip");
  });

  test("Esse send-message replies no longer convert legacy imageRequests into draft plan cards", () => {
    const app = readProjectFile("src/App.tsx");
    const main = readProjectFile("electron/main.ts");

    expect(main).toContain("createProjectSnapshotWorkspaceRuntime");
    expect(main).not.toContain("shouldUseWorkspaceToolsForEsseRequest");
    expect(main).not.toContain("result.fileTasks");
    expect(app).not.toContain("createEsseImageRequestPlan");
    expect(app).not.toContain("setProjectManagerDraftPlan(updatedState, imageRequestPlan");
    expect(app).toContain("executeNewImagePlanCommand");
  });

  test("approved Esse new-image plans reserve all placeholders before generation dispatch", () => {
    const app = readProjectFile("src/App.tsx");

    expect(app).toContain("executeNewImagePlanCommands");
    expect(app).toContain("selectPlanCommandsForExecution");
    expect(app).toContain("commandsToRun.map((command) => normalizeProjectPlanCommandForNewResult(command))");
    expect(app).toContain("sourceSessionId: command.sourceSessionId ?? command.targetSessionId");
    expect(app).toContain("preparedTasks.push");
    expect(app).toContain("await Promise.all");
  });

  test("session snapshot persistence updates the ref before saving project-manager reports", () => {
    const app = readProjectFile("src/App.tsx");
    const updateAndPersistBody = app.match(
      /function updateAndPersistSessions\([\s\S]*?\): ImageSession\[\] \{(?<body>[\s\S]*?)\n  \}/
    )?.groups?.body ?? "";

    expect(updateAndPersistBody).toContain("sessionsRef.current = nextSessions");
    expect(updateAndPersistBody.indexOf("sessionsRef.current = nextSessions")).toBeLessThan(
      updateAndPersistBody.indexOf("persistProjectSnapshot")
    );
  });

  test("Esse final replies update the latest project-manager snapshot after workspace tool broadcasts", () => {
    const app = readProjectFile("src/App.tsx");
    const sendEsseBody = app.match(
      /async function handleSendEsseMessage\([\s\S]*?\): Promise<void> \{(?<body>[\s\S]*?)\n  \}/
    )?.groups?.body ?? "";

    expect(sendEsseBody).toContain("upsertProjectManagerAssistantMessage(\n        projectManagerStateRef.current");
    expect(sendEsseBody).not.toContain("upsertProjectManagerAssistantMessage(\n        nextState");
    expect(sendEsseBody).toContain("appendProjectManagerError(\n        projectManagerStateRef.current");
  });

  test("Esse composer exposes a compact persona switch after generation ratio", () => {
    const panel = readProjectFile("src/components/ProjectPlanPanel.tsx");
    const app = readProjectFile("src/App.tsx");
    const styles = readProjectFile("src/styles.css");

    expect(panel).toContain("ESSE_PERSONA_OPTIONS");
    expect(panel).toContain("牛马设计师");
    expect(panel).toContain("勤恳耐造");
    expect(panel).toContain("真正的设计师");
    expect(panel).toContain("审美稳准");
    expect(panel).toContain("问题少女");
    expect(panel).toContain("爱问细节");
    expect(panel).toContain("无情的机器人");
    expect(panel).toContain("规则优先");
    expect(panel).toContain('useState<EssePersona>("excellent-employee")');
    expect(panel).toContain("resolveGenerationSizeSelection(selectedSize, customSize),");
    expect(panel).toContain("selectedPersona");
    expect(panel).toContain("EssePersonaIcon");
    expect(panel).toContain("OsSelect");
    expect(panel).toContain("EssePersonaSelect");
    expect(panel).toContain('ariaLabel="选择 Esse 人格"');
    expect(panel).toContain('listLabel="Esse 人格"');
    expect(app).toContain("persona");
    expect(styles).not.toContain(".esse-persona-switch");
    expect(styles).not.toContain(".esse-persona-button");
    expect(styles).not.toContain(".esse-persona-menu");
    expect(styles).toContain(".os-select-trigger");
    expect(styles).toContain(".os-select-content");
    expect(styles).toContain(".os-select-leading-icon");
    expect(styles).toContain("--radix-popper-available-width");
    expect(styles).toContain("--radix-popper-available-height");
    expect(styles).toContain("text-overflow: ellipsis");
  });

  test("sidebar tab status dot stays next to the tab label", () => {
    const styles = readProjectFile("src/styles.css");
    const tabDotRule = styles.match(/\.tab-dot\s*\{[^}]+\}/)?.[0] ?? "";

    expect(tabDotRule).not.toContain("position: absolute");
    expect(tabDotRule).not.toContain("right:");
    expect(tabDotRule).toContain("flex:");
    expect(tabDotRule).toContain("margin-left:");
  });

  test("workspace images can be reordered and dropped into the Esse composer as references", () => {
    const app = readProjectFile("src/App.tsx");
    const workspace = readProjectFile("src/components/ImageWorkspace.tsx");
    const cell = readProjectFile("src/components/ImageCell.tsx");
    const panel = readProjectFile("src/components/ProjectPlanPanel.tsx");
    const references = readProjectFile("src/components/usePastedReferenceImages.ts");
    const drag = readProjectFile("src/components/workspaceImageDrag.ts");

    expect(cell).toContain("writeWorkspaceImageDragPayload");
    expect(drag).toContain("BATCHIMAGER_IMAGE_DRAG_TYPE");
    expect(drag).toContain("dataTransfer.setData");
    expect(workspace).toContain("onReorderSessions");
    expect(workspace).toContain("onImageDragPayload");
    expect(app).toContain("moveImageSession");
    expect(app).toContain("handleReorderSessions");
    expect(panel).toContain("handleReferenceDrop");
    expect(panel).toContain("insertInlineReference");
    expect(panel).toContain("InlineReferenceComposer");
    expect(references).toContain("addReferenceImagePath");
  });
});
