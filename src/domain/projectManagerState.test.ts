import { describe, expect, it } from "vitest";
import {
  applyWorkerReport,
  createEmptyProjectManagerState,
  appendProjectManagerAssistantMessage,
  createProjectManagerUserMessage,
  markBatchPlanRunning,
  setProjectManagerDraftPlan
} from "./projectManagerState";
import type { BatchPlan, WorkerReport } from "../types/projectManager";

describe("project manager state", () => {
  it("creates an empty project manager conversation", () => {
    expect(createEmptyProjectManagerState()).toEqual({
      conversation: {
        id: "project-manager",
        messages: []
      },
      plans: []
    });
  });

  it("records the user request and stores the current draft plan", () => {
    const plan = makePlan();
    const withMessage = createProjectManagerUserMessage(createEmptyProjectManagerState(), "做一批白底主图", "pm-1");
    const withPlan = setProjectManagerDraftPlan(withMessage, plan, "pm-2");

    expect(withPlan.conversation.messages).toEqual([
      { id: "pm-1", role: "user", content: "做一批白底主图" },
      { id: "pm-2", role: "assistant", content: "已生成批量方案：白底主图", planId: "plan-1" }
    ]);
    expect(withPlan.conversation.currentPlanId).toBe("plan-1");
    expect(withPlan.plans).toEqual([plan]);
  });

  it("keeps pasted reference images on the user message", () => {
    const state = createProjectManagerUserMessage(
      createEmptyProjectManagerState(),
      "根据这张图生成四张",
      "pm-1",
      ["C:/references/paste.png"]
    );

    expect(state.conversation.messages[0]).toEqual({
      content: "根据这张图生成四张",
      id: "pm-1",
      referenceFilePaths: ["C:/references/paste.png"],
      role: "user"
    });
  });

  it("records a plain Esse assistant reply without creating a plan", () => {
    const state = appendProjectManagerAssistantMessage(
      createProjectManagerUserMessage(createEmptyProjectManagerState(), "先聊聊方向", "pm-1"),
      "可以，先统一风格，再挑几张做场景。",
      "pm-2"
    );

    expect(state.conversation.messages).toEqual([
      { id: "pm-1", role: "user", content: "先聊聊方向" },
      { id: "pm-2", role: "assistant", content: "可以，先统一风格，再挑几张做场景。" }
    ]);
    expect(state.plans).toEqual([]);
  });

  it("marks a plan running and completes it when every worker report succeeds without appending another plan card message", () => {
    const running = markBatchPlanRunning(setProjectManagerDraftPlan(createEmptyProjectManagerState(), makePlan()), "plan-1");
    const first = applyWorkerReport(running, "plan-1", makeReport("cmd-1", "img-1", "completed"));
    const second = applyWorkerReport(first, "plan-1", makeReport("cmd-2", "img-2", "completed"));

    expect(second.plans[0].status).toBe("completed");
    expect(second.plans[0].reports).toEqual([
      makeReport("cmd-1", "img-1", "completed"),
      makeReport("cmd-2", "img-2", "completed")
    ]);
    expect(second.conversation.messages).toHaveLength(1);
    expect(second.conversation.messages[0]).toMatchObject({ planId: "plan-1" });
  });

  it("marks a plan failed when any worker report fails without appending another plan card message", () => {
    const running = markBatchPlanRunning(setProjectManagerDraftPlan(createEmptyProjectManagerState(), makePlan()), "plan-1");
    const first = applyWorkerReport(running, "plan-1", makeReport("cmd-1", "img-1", "completed"));
    const second = applyWorkerReport(first, "plan-1", makeReport("cmd-2", "img-2", "failed", "生成失败"));

    expect(second.plans[0].status).toBe("failed");
    expect(second.conversation.messages).toHaveLength(1);
    expect(second.conversation.messages[0]).toMatchObject({ planId: "plan-1" });
  });
});

function makePlan(): BatchPlan {
  return {
    commands: [
      {
        constraints: ["保留主体"],
        id: "cmd-1",
        instruction: "生成白底主图",
        planId: "plan-1",
        source: "project-manager",
        targetSessionId: "img-1"
      },
      {
        constraints: ["保留主体"],
        id: "cmd-2",
        instruction: "生成白底主图",
        planId: "plan-1",
        source: "project-manager",
        targetSessionId: "img-2"
      }
    ],
    globalInstruction: "统一白底商品图",
    id: "plan-1",
    status: "draft",
    targetSessionIds: ["img-1", "img-2"],
    title: "白底主图"
  };
}

function makeReport(
  commandId: string,
  targetSessionId: string,
  status: WorkerReport["status"],
  errorMessage?: string
): WorkerReport {
  return {
    commandId,
    generatedImagePath: status === "completed" ? `C:/generated/${targetSessionId}.png` : undefined,
    errorMessage,
    status,
    summary: status === "completed" ? "已完成" : "失败",
    targetSessionId
  };
}
