// @vitest-environment jsdom

import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { BatchPlan, ProjectManagerState, WorkerReport } from "../types/projectManager";
import type { ImageSession } from "../types/image";
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
  onSendMessage = vi.fn(),
  imageSessions: ImageSession[] = []
): ReturnType<typeof vi.fn> {
  renderWithBatchImager(
    <ProjectPlanPanel
      activityLogs={[]}
      imageSessions={imageSessions}
      isCreatingPlan={false}
      projectManagerState={projectManagerState}
      onCopyImage={vi.fn()}
      onCancelBatchTaskAll={vi.fn()}
      onCancelBatchTaskItem={vi.fn()}
      onRetryBatchTaskFailed={vi.fn()}
      onRetryBatchTaskItem={vi.fn()}
      onExecutePlan={vi.fn()}
      onOpenImagePreview={vi.fn()}
      onResolvePermission={vi.fn()}
      onResolvePreflight={vi.fn()}
      onSendMessage={onSendMessage}
      onStopWork={vi.fn()}
    />
  );

  return onSendMessage;
}

describe("ProjectPlanPanel persona behavior", () => {
  test("does not send the message when Enter confirms IME composition", () => {
    const onSendMessage = renderProjectPlanPanel();
    const composer = screen.getByRole("textbox");

    fireEvent.change(composer, { target: { value: "english" } });
    fireEvent.keyDown(composer, { code: "Enter", isComposing: true, key: "Enter" });

    expect(onSendMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(composer, { code: "Enter", key: "Enter" });

    expect(onSendMessage).toHaveBeenCalledWith("english", undefined, [], "excellent-employee");
  });

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

  test("shows the edited source image thumbnail beside an edit task prompt preview", () => {
    const plan = makePlan({
      commands: [
        {
          ...makeCommand("plan-1", "cmd-1", "img-4"),
          generationMode: "edit",
          sourceSessionId: "img-4"
        },
        {
          ...makeCommand("plan-1", "cmd-2", "new-1"),
          generationMode: "generate"
        }
      ],
      targetSessionIds: ["img-4", "new-1"]
    });

    renderProjectPlanPanelWithState(makeProjectManagerState(plan), vi.fn(), [
      makeImageSession("img-4", "C:/shots/flower.jpg", "C:/generated/flower-current.png")
    ]);

    const sourcePreview = screen.getByRole("img", { name: "正在编辑 img-4" });

    expect(sourcePreview).toHaveAttribute("src", "batchimager-test://C%3A%2Fgenerated%2Fflower-current.png");
    expect(screen.getByRole("button", { name: "预览正在编辑的img-4" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "正在编辑 new-1" })).not.toBeInTheDocument();
  });

  test("scrolls the conversation to the latest agent task card", () => {
    const scrollTo = vi.fn();
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = scrollTo;

    try {
      const { rerender } = renderWithBatchImager(
        <ProjectPlanPanel
          activityLogs={[]}
          imageSessions={[]}
          isCreatingPlan={false}
          projectManagerState={EMPTY_PROJECT_MANAGER_STATE}
          onCopyImage={vi.fn()}
          onCancelBatchTaskAll={vi.fn()}
          onCancelBatchTaskItem={vi.fn()}
          onRetryBatchTaskFailed={vi.fn()}
          onRetryBatchTaskItem={vi.fn()}
          onExecutePlan={vi.fn()}
          onOpenImagePreview={vi.fn()}
          onResolvePermission={vi.fn()}
          onResolvePreflight={vi.fn()}
          onSendMessage={vi.fn()}
          onStopWork={vi.fn()}
        />
      );

      scrollTo.mockClear();

      rerender(
        <ProjectPlanPanel
          activityLogs={[]}
          imageSessions={[]}
          isCreatingPlan={false}
          projectManagerState={makeProjectManagerState(makePlan())}
          onCopyImage={vi.fn()}
          onCancelBatchTaskAll={vi.fn()}
          onCancelBatchTaskItem={vi.fn()}
          onRetryBatchTaskFailed={vi.fn()}
          onRetryBatchTaskItem={vi.fn()}
          onExecutePlan={vi.fn()}
          onOpenImagePreview={vi.fn()}
          onResolvePermission={vi.fn()}
          onResolvePreflight={vi.fn()}
          onSendMessage={vi.fn()}
          onStopWork={vi.fn()}
        />
      );

      expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: expect.any(Number) });
      expect(
        scrollTo.mock.contexts.some(
          (context) => context instanceof HTMLElement && context.classList.contains("project-manager-thread")
        )
      ).toBe(true);
    } finally {
      HTMLElement.prototype.scrollTo = originalScrollTo;
    }
  });
});

describe("ProjectPlanPanel Esse preflight cards", () => {
  test("shows a generation preflight card and emits execute/cancel decisions", async () => {
    const user = userEvent.setup();
    const onResolvePreflight = vi.fn();

    renderWithBatchImager(
      <ProjectPlanPanel
        activityLogs={[]}
        imageSessions={[]}
        isCreatingPlan={false}
        projectManagerState={{
          conversation: {
            id: "conversation-1",
            messages: [
              {
                content: "",
                id: "preflight-1",
                preflightDecision: "pending",
                preflightRequest: {
                  payload: {
                    commands: [
                      {
                        displayLabel: "img-1",
                        mode: "edit",
                        prompt: "保留主体，换成白底主图",
                        target: { sessionId: "sess_1", type: "existing" }
                      }
                    ],
                    estimatedApiCalls: 1,
                    tool: "generate_image"
                  },
                  requestId: "request-1"
                },
                role: "context"
              }
            ]
          },
          plans: []
        }}
        onCopyImage={vi.fn()}
        onCancelBatchTaskAll={vi.fn()}
        onCancelBatchTaskItem={vi.fn()}
        onRetryBatchTaskFailed={vi.fn()}
        onRetryBatchTaskItem={vi.fn()}
        onExecutePlan={vi.fn()}
        onOpenImagePreview={vi.fn()}
        onResolvePermission={vi.fn()}
        onResolvePreflight={onResolvePreflight}
        onSendMessage={vi.fn()}
        onStopWork={vi.fn()}
      />
    );

    expect(screen.getByRole("region", { name: "Esse 生成确认" })).toBeInTheDocument();
    expect(screen.getByText("生成图片")).toBeInTheDocument();
    expect(screen.getByText("1 次 API 调用")).toBeInTheDocument();
    expect(screen.getByText("保留主体，换成白底主图")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "执行" }));
    await user.click(screen.getByRole("button", { name: "修改" }));
    await user.clear(screen.getByRole("textbox", { name: "任务 1 提示词" }));
    await user.type(screen.getByRole("textbox", { name: "任务 1 提示词" }), "用户修改后的浅灰场景图");
    await user.selectOptions(screen.getByLabelText("模式"), "generate");
    await user.click(screen.getByRole("button", { name: "按修改执行" }));
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(onResolvePreflight).toHaveBeenNthCalledWith(1, "request-1", "execute");
    expect(onResolvePreflight).toHaveBeenNthCalledWith(2, "request-1", "modify", [
      {
        displayLabel: "img-1",
        mode: "generate",
        prompt: "用户修改后的浅灰场景图",
        target: { sessionId: "sess_1", type: "existing" }
      }
    ]);
    expect(onResolvePreflight).toHaveBeenNthCalledWith(3, "request-1", "cancel");
  });

  test("labels package preflight cards as file export instead of image generation", () => {
    renderWithBatchImager(
      <ProjectPlanPanel
        activityLogs={[]}
        imageSessions={[]}
        isCreatingPlan={false}
        projectManagerState={{
          conversation: {
            id: "conversation-1",
            messages: [
              {
                content: "",
                id: "preflight-package",
                preflightDecision: "pending",
                preflightRequest: {
                  payload: {
                    commands: [
                      {
                        displayLabel: "img-1",
                        prompt: "1 张生成图",
                        target: { sessionId: "sess_1", type: "existing" }
                      }
                    ],
                    estimatedApiCalls: 0,
                    tool: "package_generated_images"
                  },
                  requestId: "request-package"
                },
                role: "context"
              }
            ]
          },
          plans: []
        }}
        onCopyImage={vi.fn()}
        onCancelBatchTaskAll={vi.fn()}
        onCancelBatchTaskItem={vi.fn()}
        onRetryBatchTaskFailed={vi.fn()}
        onRetryBatchTaskItem={vi.fn()}
        onExecutePlan={vi.fn()}
        onOpenImagePreview={vi.fn()}
        onResolvePermission={vi.fn()}
        onResolvePreflight={vi.fn()}
        onSendMessage={vi.fn()}
        onStopWork={vi.fn()}
      />
    );

    expect(screen.getByText("打包导出")).toBeInTheDocument();
    expect(screen.queryByText("生成图片")).not.toBeInTheDocument();
    expect(screen.getByText("0 次 API 调用")).toBeInTheDocument();
  });
});

describe("ProjectPlanPanel Esse batch task cards", () => {
  test("shows task status and emits item/all cancel actions", async () => {
    const user = userEvent.setup();
    const onCancelBatchTaskAll = vi.fn();
    const onCancelBatchTaskItem = vi.fn();
    const onRetryBatchTaskFailed = vi.fn();
    const onRetryBatchTaskItem = vi.fn();

    renderWithBatchImager(
      <ProjectPlanPanel
        activityLogs={[]}
        imageSessions={[
          {
            chatMessages: [],
            chatStatus: "idle",
            fileName: "a.jpg",
            filePath: "/project/a.jpg",
            id: "sess_1",
            status: "generating"
          },
          {
            chatMessages: [],
            chatStatus: "idle",
            errorMessage: "已取消",
            fileName: "b.jpg",
            filePath: "/project/b.jpg",
            id: "sess_2",
            status: "failed"
          }
        ]}
        isCreatingPlan={false}
        projectManagerState={{
          conversation: {
            id: "conversation-1",
            messages: [
              {
                batchTask: {
                  batchTaskId: "batch_1",
                  items: [
                    {
                      command: { mode: "edit", prompt: "第一张换白底", target: { sessionId: "sess_1", type: "existing" } },
                      displayLabel: "a.jpg",
                      mode: "edit",
                      promptSummary: "第一张换白底",
                      sessionId: "sess_1"
                    },
                    {
                      command: { mode: "edit", prompt: "第二张换白底", target: { sessionId: "sess_2", type: "existing" } },
                      displayLabel: "b.jpg",
                      mode: "edit",
                      promptSummary: "第二张换白底",
                      sessionId: "sess_2"
                    }
                  ]
                },
                content: "",
                contextType: "esse-batch-task",
                id: "batch-message-1",
                role: "context"
              }
            ]
          },
          plans: []
        }}
        onCopyImage={vi.fn()}
        onCancelBatchTaskAll={onCancelBatchTaskAll}
        onCancelBatchTaskItem={onCancelBatchTaskItem}
        onRetryBatchTaskFailed={onRetryBatchTaskFailed}
        onRetryBatchTaskItem={onRetryBatchTaskItem}
        onExecutePlan={vi.fn()}
        onOpenImagePreview={vi.fn()}
        onResolvePermission={vi.fn()}
        onResolvePreflight={vi.fn()}
        onSendMessage={vi.fn()}
        onStopWork={vi.fn()}
      />
    );

    expect(screen.getByRole("region", { name: "Esse 生成任务" })).toBeInTheDocument();
    expect(screen.getByText("已提交 2 个生成任务")).toBeInTheDocument();
    expect(screen.getByText("1 个进行中")).toBeInTheDocument();
    expect(screen.getByText("生成中")).toBeInTheDocument();
    expect(screen.getByText("已取消")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "重试" }));
    await user.click(screen.getByRole("button", { name: "全部取消" }));
    await user.click(screen.getByRole("button", { name: "重试失败项" }));

    expect(onCancelBatchTaskItem).toHaveBeenCalledWith("batch_1", "sess_1");
    expect(onCancelBatchTaskAll).toHaveBeenCalledWith("batch_1");
    expect(onRetryBatchTaskItem).toHaveBeenCalledWith("batch_1", "sess_2");
    expect(onRetryBatchTaskFailed).toHaveBeenCalledWith("batch_1");
  });
});

describe("ProjectPlanPanel Esse permission cards", () => {
  test("shows a permission card and emits allow or deny decisions", async () => {
    const user = userEvent.setup();
    const onResolvePermission = vi.fn();

    renderWithBatchImager(
      <ProjectPlanPanel
        activityLogs={[]}
        imageSessions={[]}
        isCreatingPlan={false}
        projectManagerState={{
          conversation: {
            id: "conversation-1",
            messages: [
              {
                content: "",
                id: "permission-1",
                permissionDecision: "pending",
                permissionRequest: {
                  payload: {
                    affectedDisplayLabel: "img-2",
                    affectedFileName: "hero.jpg",
                    label: "删除图片",
                    params: { sessionId: "sess_2" },
                    requiresPreflight: false,
                    risk: "destructive",
                    targetKey: "delete_session:sess_2",
                    toolName: "delete_session"
                  },
                  requestId: "permission-request-1"
                },
                role: "context"
              }
            ]
          },
          plans: []
        }}
        onCopyImage={vi.fn()}
        onCancelBatchTaskAll={vi.fn()}
        onCancelBatchTaskItem={vi.fn()}
        onRetryBatchTaskFailed={vi.fn()}
        onRetryBatchTaskItem={vi.fn()}
        onExecutePlan={vi.fn()}
        onOpenImagePreview={vi.fn()}
        onResolvePermission={onResolvePermission}
        onResolvePreflight={vi.fn()}
        onSendMessage={vi.fn()}
        onStopWork={vi.fn()}
      />
    );

    expect(screen.getByRole("region", { name: "Esse 操作确认" })).toBeInTheDocument();
    expect(screen.getByText("高风险操作")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "本次会话允许" }));
    expect(onResolvePermission).toHaveBeenCalledWith("permission-request-1", "allow-session");
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

function makeImageSession(id: string, filePath: string, generatedFilePath?: string): ImageSession {
  return {
    chatMessages: [],
    chatStatus: "idle",
    fileName: `${id}.jpg`,
    filePath,
    ...(generatedFilePath ? { generatedFilePath } : {}),
    id,
    status: "idle"
  };
}
