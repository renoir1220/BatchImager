import type { BatchPlan, ProjectManagerMessage, ProjectManagerState, WorkerReport } from "../types/projectManager";

const PROJECT_MANAGER_CONVERSATION_ID = "project-manager";

export function createEmptyProjectManagerState(): ProjectManagerState {
  return {
    conversation: {
      id: PROJECT_MANAGER_CONVERSATION_ID,
      messages: []
    },
    plans: []
  };
}

export function createProjectManagerUserMessage(
  state: ProjectManagerState,
  content: string,
  messageId = createMessageId("pm-user"),
  referenceFilePaths: string[] = []
): ProjectManagerState {
  return appendProjectManagerMessage(state, {
    content,
    id: messageId,
    ...(referenceFilePaths.length ? { referenceFilePaths } : {}),
    role: "user"
  });
}

export function appendProjectManagerAssistantMessage(
  state: ProjectManagerState,
  content: string,
  messageId = createMessageId("pm-assistant")
): ProjectManagerState {
  return appendProjectManagerMessage(state, {
    content,
    id: messageId,
    role: "assistant"
  });
}

export function setProjectManagerDraftPlan(
  state: ProjectManagerState,
  plan: BatchPlan,
  messageId = createMessageId("pm-plan")
): ProjectManagerState {
  const nextPlans = [plan, ...state.plans.filter((currentPlan) => currentPlan.id !== plan.id)];

  return appendProjectManagerMessage(
    {
      conversation: {
        ...state.conversation,
        currentPlanId: plan.id
      },
      plans: nextPlans
    },
    {
      content: `已生成批量方案：${plan.title}`,
      id: messageId,
      planId: plan.id,
      role: "assistant"
    }
  );
}

export function markBatchPlanRunning(
  state: ProjectManagerState,
  planId: string,
  commandIdsToRun?: string[]
): ProjectManagerState {
  const commandIdSet = commandIdsToRun ? new Set(commandIdsToRun) : null;

  return {
    ...state,
    plans: state.plans.map((plan) =>
      plan.id === planId
        ? {
            ...plan,
            reports: commandIdSet
              ? (plan.reports ?? []).filter((report) => !commandIdSet.has(report.commandId))
              : [],
            status: "running"
          }
        : plan
    )
  };
}

export function applyWorkerReport(
  state: ProjectManagerState,
  planId: string,
  report: WorkerReport
): ProjectManagerState {
  let finalStatus: BatchPlan["status"] | undefined;

  const plans = state.plans.map((plan) => {
    if (plan.id !== planId) {
      return plan;
    }

    const reports = [
      ...(plan.reports ?? []).filter((currentReport) => currentReport.commandId !== report.commandId),
      report
    ];
    const allReported = plan.commands.every((command) => reports.some((currentReport) => currentReport.commandId === command.id));

    if (allReported) {
      finalStatus = reports.some((currentReport) => currentReport.status === "failed") ? "failed" : "completed";
    }

    return {
      ...plan,
      reports,
      status: finalStatus ?? plan.status
    };
  });

  return {
    ...state,
    plans
  };
}

function appendProjectManagerMessage(state: ProjectManagerState, message: ProjectManagerMessage): ProjectManagerState {
  return {
    ...state,
    conversation: {
      ...state.conversation,
      messages: [...state.conversation.messages, message]
    }
  };
}

function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
