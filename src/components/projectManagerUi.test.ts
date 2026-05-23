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

    expect(app).toContain("项目方案");
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

  test("batch dialog submits a plan request instead of direct generation copy", () => {
    expect(readProjectFile("src/components/BatchDialog.tsx")).toContain("生成方案");
    expect(readProjectFile("src/App.tsx")).toContain("createProjectManagerPlan");
  });

  test("Esse IPC is exposed only through preload", () => {
    expect(readProjectFile("electron/preload.ts")).toContain("createProjectManagerPlan");
    expect(readProjectFile("electron/preload.ts")).toContain("sendEsseMessage");
    expect(readProjectFile("electron/main.ts")).toContain("project-manager:create-plan");
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
    expect(panel).toContain("方案有${plan.commands.length}个任务待审批");
    expect(panel).not.toContain("plan-eyebrow");
    expect(panel).not.toContain("plan-summary-line");
    expect(panel).not.toContain("<p>{plan.globalInstruction}</p>");
    expect(planTitleRule).toContain("font-size: 13px");
    expect(planTitleRule).toContain("font-weight: 560");
    expect(planTitleRule).toContain("color: #4f524b");
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

  test("Esse image requests are converted into existing draft plan cards instead of immediate dispatch", () => {
    const app = readProjectFile("src/App.tsx");

    expect(app).toContain("createEsseImageRequestPlan");
    expect(app).toContain("setProjectManagerDraftPlan(updatedState, imageRequestPlan");
    expect(app).toContain("executeNewImagePlanCommand");
  });

  test("approved Esse new-image plans reserve all placeholders before generation dispatch", () => {
    const app = readProjectFile("src/App.tsx");

    expect(app).toContain("executeNewImagePlanCommands");
    expect(app).toContain("selectPlanCommandsForExecution");
    expect(app).toContain('commandsToRun.filter((command) => command.target === "new")');
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

  test("Esse composer exposes a compact persona switch after generation ratio", () => {
    const panel = readProjectFile("src/components/ProjectPlanPanel.tsx");
    const app = readProjectFile("src/App.tsx");
    const styles = readProjectFile("src/styles.css");

    expect(panel).toContain("ESSE_PERSONA_OPTIONS");
    expect(panel).toContain("老黄牛");
    expect(panel).toContain("优秀员工");
    expect(panel).toContain("问题少女");
    expect(panel).toContain("无情的机器人");
    expect(panel).toContain('useState<EssePersona>("excellent-employee")');
    expect(panel).toContain("resolveGenerationSizeSelection(selectedSize, customSize),");
    expect(panel).toContain("selectedPersona");
    expect(app).toContain("persona");
    expect(styles).toContain(".esse-persona-switch");
  });

  test("sidebar tab status dot stays next to the tab label", () => {
    const styles = readProjectFile("src/styles.css");
    const tabDotRule = styles.match(/\.tab-dot\s*\{[^}]+\}/)?.[0] ?? "";

    expect(tabDotRule).not.toContain("position: absolute");
    expect(tabDotRule).not.toContain("right:");
    expect(tabDotRule).toContain("flex:");
    expect(tabDotRule).toContain("margin-left:");
  });
});
