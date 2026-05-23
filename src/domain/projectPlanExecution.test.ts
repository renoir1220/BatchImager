import { describe, expect, it } from "vitest";
import type { BatchPlan, WorkerReport } from "../types/projectManager";
import { createEmptyProjectManagerState, markBatchPlanRunning, setProjectManagerDraftPlan } from "./projectManagerState";
import { canRunPlanCommands, selectPlanCommandsForExecution } from "./projectPlanExecution";

describe("project plan execution", () => {
  it("selects every command for a fresh draft plan", () => {
    const plan = makePlan("draft");

    expect(canRunPlanCommands(plan, "all")).toBe(true);
    expect(selectPlanCommandsForExecution(plan, "all").map((command) => command.id)).toEqual(["cmd-1", "cmd-2"]);
  });

  it("selects only failed commands for retry and keeps completed reports while retrying", () => {
    const failedPlan = {
      ...makePlan("failed"),
      reports: [
        makeReport("cmd-1", "img-1", "completed"),
        makeReport("cmd-2", "img-2", "failed", "生成失败")
      ]
    };
    const state = setProjectManagerDraftPlan(createEmptyProjectManagerState(), failedPlan, "pm-plan");
    const commandsToRetry = selectPlanCommandsForExecution(failedPlan, "failed");

    expect(canRunPlanCommands(failedPlan, "failed")).toBe(true);
    expect(commandsToRetry.map((command) => command.id)).toEqual(["cmd-2"]);

    const running = markBatchPlanRunning(
      state,
      failedPlan.id,
      commandsToRetry.map((command) => command.id)
    );

    expect(running.plans[0]).toMatchObject({
      status: "running",
      reports: [makeReport("cmd-1", "img-1", "completed")]
    });
  });
});

function makePlan(status: BatchPlan["status"]): BatchPlan {
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
    status,
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
