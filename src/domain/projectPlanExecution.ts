import type { BatchPlan, WorkerCommand } from "../types/projectManager";

export type ProjectPlanExecutionMode = "all" | "failed";

export function canRunPlanCommands(plan: BatchPlan, mode: ProjectPlanExecutionMode): boolean {
  return selectPlanCommandsForExecution(plan, mode).length > 0;
}

export function selectPlanCommandsForExecution(
  plan: BatchPlan,
  mode: ProjectPlanExecutionMode
): WorkerCommand[] {
  if (plan.status === "running" || plan.commands.length === 0) {
    return [];
  }

  if (mode === "failed") {
    if (plan.status !== "failed") {
      return [];
    }

    const failedCommandIds = new Set(
      (plan.reports ?? []).filter((report) => report.status === "failed").map((report) => report.commandId)
    );

    return plan.commands.filter((command) => failedCommandIds.has(command.id));
  }

  return plan.status === "draft" || plan.status === "paused" ? plan.commands : [];
}
