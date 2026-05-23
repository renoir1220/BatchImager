// @vitest-environment jsdom

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { BatchPlan, ProjectManagerState, WorkerReport } from "../types/projectManager";
import { renderWithBatchImager } from "../test/renderWithBatchImager";
import { ProjectPlanPanel } from "./ProjectPlanPanel";

const EMPTY_PROJECT_MANAGER_STATE: ProjectManagerState = {
  conversation: {
    id: "conversation-1",
    messages: []
  },
  plans: []
};

function renderProjectPlanPanel(onSendMessage = vi.fn()): ReturnType<typeof vi.fn> {
  renderProjectPlanPanelWithState(EMPTY_PROJECT_MANAGER_STATE, onSendMessage);

  return onSendMessage;
}

function renderProjectPlanPanelWithState(
  projectManagerState: ProjectManagerState,
  onSendMessage = vi.fn()
): ReturnType<typeof vi.fn> {
  renderWithBatchImager(
    <ProjectPlanPanel
      activityLogs={[]}
      isCreatingPlan={false}
      projectManagerState={projectManagerState}
      onCopyImage={vi.fn()}
      onExecutePlan={vi.fn()}
      onOpenImagePreview={vi.fn()}
      onSendMessage={onSendMessage}
    />
  );

  return onSendMessage;
}

describe("ProjectPlanPanel persona behavior", () => {
  test("opens an accessible persona list with short descriptions", async () => {
    const user = userEvent.setup();
    renderProjectPlanPanel();

    await user.click(screen.getByRole("combobox", { name: "选择 Esse 人格" }));

    const listbox = await screen.findByRole("listbox", { name: "Esse 人格" });

    expect(within(listbox).getByRole("option", { name: /牛马设计师\s*勤恳耐造/ })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /真正的设计师\s*审美稳准/ })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /问题少女\s*爱问细节/ })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /无情的机器人\s*规则优先/ })).toBeInTheDocument();
  });

  test("sends the selected Esse persona with the message", async () => {
    const user = userEvent.setup();
    const onSendMessage = renderProjectPlanPanel();

    await user.click(screen.getByRole("combobox", { name: "选择 Esse 人格" }));
    await user.click(await screen.findByRole("option", { name: /无情的机器人\s*规则优先/ }));
    await user.type(screen.getByRole("textbox"), "生成一张白底图");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(onSendMessage).toHaveBeenCalledWith("生成一张白底图", undefined, [], "robot");
  });
});

describe("ProjectPlanPanel plan cards", () => {
  test("collapses and expands the current batch confirmation card", async () => {
    const user = userEvent.setup();
    renderProjectPlanPanelWithState(makeProjectManagerState(makePlan()));

    expect(screen.getAllByText("Prompt 预览")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "收起方案" }));

    expect(screen.queryAllByText("Prompt 预览")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "展开方案" }));

    expect(screen.getAllByText("Prompt 预览")).toHaveLength(3);
  });

  test("shows concise Esse plan status in the card title without a generated-plan chat sentence", () => {
    renderProjectPlanPanelWithState(makeProjectManagerState(makePlan()));

    expect(screen.getByText("Esse有3个任务等你确认")).toBeInTheDocument();
    expect(screen.queryByText("已生成批量方案：Esse生成任务预览")).not.toBeInTheDocument();
  });

  test("shows running and completed Esse plan progress in the card title", () => {
    const runningPlan = makePlan({
      reports: [makeReport("cmd-1", "img-1"), makeReport("cmd-2", "img-2")],
      status: "running"
    });
    const completedPlan = makePlan({
      id: "plan-2",
      reports: [makeReport("cmd-1", "img-1"), makeReport("cmd-2", "img-2"), makeReport("cmd-3", "img-3")],
      status: "completed"
    });

    renderProjectPlanPanelWithState({
      conversation: {
        id: "conversation-1",
        messages: [
          { content: "", id: "pm-plan-running", planId: "plan-1", role: "assistant" },
          { content: "", id: "pm-plan-completed", planId: "plan-2", role: "assistant" }
        ]
      },
      plans: [runningPlan, completedPlan]
    });

    expect(screen.getByText("Esse工作进度：2/3")).toBeInTheDocument();
    expect(screen.getByLabelText("任务执行中")).toBeInTheDocument();
    expect(screen.getByText("Esse完成了3个任务")).toBeInTheDocument();
  });
});

function makeProjectManagerState(plan: BatchPlan): ProjectManagerState {
  return {
    conversation: {
      currentPlanId: plan.id,
      id: "conversation-1",
      messages: [{ content: "已生成批量方案：Esse生成任务预览", id: "pm-plan-1", planId: plan.id, role: "assistant" }]
    },
    plans: [plan]
  };
}

function makePlan(overrides: Partial<BatchPlan> = {}): BatchPlan {
  const id = overrides.id ?? "plan-1";

  return {
    commands: [
      makeCommand(id, "cmd-1", "img-1"),
      makeCommand(id, "cmd-2", "img-2"),
      makeCommand(id, "cmd-3", "img-3")
    ],
    globalInstruction: "统一生成人物图",
    id,
    status: "draft",
    targetSessionIds: ["img-1", "img-2", "img-3"],
    title: "Esse生成任务预览",
    ...overrides
  };
}

function makeCommand(planId: string, id: string, targetSessionId: string): BatchPlan["commands"][number] {
  return {
    constraints: ["保持人物自然"],
    id,
    instruction: "生成自然棚拍人物图",
    planId,
    source: "project-manager",
    targetSessionId
  };
}

function makeReport(commandId: string, targetSessionId: string): WorkerReport {
  return {
    commandId,
    generatedImagePath: `C:/generated/${targetSessionId}.png`,
    status: "completed",
    summary: "已完成",
    targetSessionId
  };
}
