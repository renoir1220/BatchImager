import { useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent, KeyboardEvent, MouseEvent } from "react";
import type { AppLogEntry, EssePreflightRequest, EssePreflightResponse } from "../../electron/ipcTypes";
import type {
  BatchPlan,
  BatchPlanReferenceImage,
  EssePersona,
  ProjectManagerState,
  WorkerCommand,
  WorkerReport
} from "../types/projectManager";
import {
  GenerationSizeControl,
  isGenerationSizeSelectionValid,
  resolveGenerationSizeSelection
} from "./GenerationSizeControl";
import { AgentStatusLine } from "./AgentStatusLine";
import { ComposerReferenceStrip } from "./ComposerReferenceStrip";
import type { PreviewImage } from "./ImagePreviewDialog";
import { MarkdownMessage } from "./MarkdownMessage";
import { MessageActions } from "./MessageActions";
import { shouldSubmitComposerOnEnter } from "./composerKeyEvents";
import { OsSelect, type OsSelectOption } from "./os";
import { useAutoScrollToThreadEnd } from "./useAutoScrollToThreadEnd";
import { usePastedReferenceImages } from "./usePastedReferenceImages";
import { hasWorkspaceImageDrag, readWorkspaceImageDragPayload } from "./workspaceImageDrag";
import {
  canRunPlanCommands,
  type ProjectPlanExecutionMode
} from "../domain/projectPlanExecution";
import { getSessionGenerationSourcePath } from "../domain/imageSessions";
import type { ImageSession } from "../types/image";

interface ProjectPlanPanelProps {
  activityLogs: AppLogEntry[];
  imageSessions?: ImageSession[];
  isCreatingPlan: boolean;
  projectManagerState: ProjectManagerState;
  onExecutePlan: (planId: string, mode: ProjectPlanExecutionMode) => void;
  onCopyImage: (imagePath: string) => void;
  onCancelBatchTaskAll: (batchTaskId: string) => void;
  onCancelBatchTaskItem: (batchTaskId: string, sessionId: string) => void;
  onOpenImagePreview: (title: string, images: PreviewImage[], initialPath: string) => void;
  onRetryBatchTaskFailed: (batchTaskId: string) => void;
  onRetryBatchTaskItem: (batchTaskId: string, sessionId: string) => void;
  onResolvePreflight: (requestId: string, decision: EssePreflightResponse["decision"]) => void;
  onSendMessage: (content: string, outputSize?: string, referenceImagePaths?: string[], persona?: EssePersona) => void;
  onStopWork: () => void;
}

const ESSE_PERSONA_OPTIONS: OsSelectOption<EssePersona>[] = [
  { description: "勤恳耐造", label: "牛马设计师", value: "old-ox" },
  { description: "审美稳准", label: "真正的设计师", value: "excellent-employee" },
  { description: "爱问细节", label: "问题少女", value: "question-girl" },
  { description: "规则优先", label: "无情的机器人", value: "robot" }
];
export function ProjectPlanPanel({
  activityLogs,
  imageSessions = [],
  isCreatingPlan,
  projectManagerState,
  onExecutePlan,
  onCopyImage,
  onCancelBatchTaskAll,
  onCancelBatchTaskItem,
  onOpenImagePreview,
  onRetryBatchTaskFailed,
  onRetryBatchTaskItem,
  onResolvePreflight,
  onSendMessage,
  onStopWork
}: ProjectPlanPanelProps) {
  const [expandedPlanIds, setExpandedPlanIds] = useState<Set<string>>(() => new Set());
  const [collapsedPlanIds, setCollapsedPlanIds] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [customSize, setCustomSize] = useState("");
  const [selectedPersona, setSelectedPersona] = useState<EssePersona>("excellent-employee");
  const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const pastedReferences = usePastedReferenceImages();
  const isAgentWorking = isCreatingPlan || projectManagerState.plans.some((plan) => plan.status === "running");
  const currentActivityLog = activityLogs.at(-1);
  const canSend = Boolean(
    message.trim() && !pastedReferences.isSavingReference && isGenerationSizeSelectionValid(selectedSize, customSize)
  );
  const threadContentSignature = useMemo(
    () => getProjectThreadContentSignature(projectManagerState, currentActivityLog?.message, isCreatingPlan),
    [currentActivityLog?.message, isCreatingPlan, projectManagerState]
  );
  useAutoScrollToThreadEnd(threadRef, threadContentSignature);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (isAgentWorking) {
      onStopWork();
      return;
    }

    if (!canSend) {
      return;
    }

    onSendMessage(
      message.trim(),
      resolveGenerationSizeSelection(selectedSize, customSize),
      pastedReferences.referenceImages.map((referenceImage) => referenceImage.filePath),
      selectedPersona
    );
    setMessage("");
    pastedReferences.clearReferenceImages();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (shouldSubmitComposerOnEnter(event)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function handleReferenceDragEnter(event: DragEvent<HTMLDivElement>): void {
    if (!hasWorkspaceImageDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsReferenceDragActive(true);
  }

  function handleReferenceDragOver(event: DragEvent<HTMLDivElement>): void {
    if (!hasWorkspaceImageDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleReferenceDragLeave(event: DragEvent<HTMLDivElement>): void {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setIsReferenceDragActive(false);
  }

  function handleReferenceDrop(event: DragEvent<HTMLDivElement>): void {
    const payload = readWorkspaceImageDragPayload(event.dataTransfer);

    if (!payload) {
      return;
    }

    event.preventDefault();
    setIsReferenceDragActive(false);
    pastedReferences.addReferenceImagePath(payload.imagePath, payload.fileName);
  }

  function handleImageContextMenu(event: MouseEvent, imagePath: string): void {
    event.preventDefault();
    onCopyImage(imagePath);
  }

  function openReferencePreview(referenceFilePaths: string[], selectedPath: string): void {
    onOpenImagePreview(
      "参考图",
      referenceFilePaths.map((path, index) => ({
        key: path,
        label: `参考图 ${index + 1}`,
        path
      })),
      selectedPath
    );
  }

  return (
    <div
      className={`project-plan-panel ${isReferenceDragActive ? "reference-drag-active" : ""}`}
      aria-label="项目方案"
      onDragEnter={handleReferenceDragEnter}
      onDragLeave={handleReferenceDragLeave}
      onDragOver={handleReferenceDragOver}
      onDrop={handleReferenceDrop}
    >
      <div className="project-manager-thread" ref={threadRef}>
        {projectManagerState.conversation.messages.length === 0 ? (
          <div className="thread-line muted">说明整批图片想怎么做。这里可以先讨论方向，也可以生成新图或创建待确认的批处理方案。</div>
        ) : (
          projectManagerState.conversation.messages.map((message, index) => {
            const plan = message.planId ? getPlan(projectManagerState, message.planId) : null;
            const shouldAutoCollapse = plan ? hasLaterUserMessage(projectManagerState, index) : false;
            const collapsed = Boolean(
              plan && (collapsedPlanIds.has(plan.id) || (shouldAutoCollapse && !expandedPlanIds.has(plan.id)))
            );
            const hasMessageContent = !plan && message.content.trim().length > 0;

            return (
              <div className={`message-row ${message.role}`} key={message.id}>
                <div className={`thread-line ${message.role}`}>
                  {hasMessageContent ? <MarkdownMessage content={message.content} /> : null}
                  {message.referenceFilePaths?.length ? (
                    <div className="thread-image-card">
                      <div className="thread-image-title">
                        <span>参考图</span>
                        <span>{message.referenceFilePaths.length} 张</span>
                      </div>
                      <div className="thread-reference-grid">
                        {message.referenceFilePaths.map((referenceFilePath) => (
                          <img
                            key={referenceFilePath}
                            src={window.batchImager?.getImageUrl(referenceFilePath) ?? referenceFilePath}
                            alt="参考图"
                            draggable={false}
                            onContextMenu={(event) => handleImageContextMenu(event, referenceFilePath)}
                            onDoubleClick={() => openReferencePreview(message.referenceFilePaths ?? [], referenceFilePath)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {plan ? (
                    <PlanCard
                      collapsed={collapsed}
                      imageSessions={imageSessions}
                      plan={plan}
                      onOpenImagePreview={onOpenImagePreview}
                      onExecutePlan={onExecutePlan}
                      onToggleCollapse={() => togglePlanCollapse(plan.id, collapsed)}
                    />
                  ) : null}
                  {message.preflightRequest ? (
                    <EssePreflightCard
                      decision={message.preflightDecision ?? "pending"}
                      request={message.preflightRequest}
                      onResolve={onResolvePreflight}
                    />
                  ) : null}
                  {message.batchTask ? (
                    <EsseBatchTaskCard
                      batchTask={message.batchTask}
                      imageSessions={imageSessions}
                      onCancelAll={onCancelBatchTaskAll}
                      onCancelItem={onCancelBatchTaskItem}
                      onRetryFailed={onRetryBatchTaskFailed}
                      onRetryItem={onRetryBatchTaskItem}
                    />
                  ) : null}
                </div>
                {hasMessageContent ? <MessageActions content={message.content} /> : null}
              </div>
            );
          })
        )}
      </div>

      <div className="session-control-dock">
        <AgentStatusLine isWorking={isAgentWorking} message={currentActivityLog?.message} />
        <form className="session-composer" onSubmit={handleSubmit} onPaste={pastedReferences.handlePaste}>
          <ComposerReferenceStrip
            error={pastedReferences.referenceError}
            images={pastedReferences.referenceImages}
            isSaving={pastedReferences.isSavingReference}
            onRemove={pastedReferences.removeReferenceImage}
          />
          <textarea
            value={message}
            placeholder="和 Esse 讨论、生成新图或安排批处理... 可直接粘贴参考图"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleComposerKeyDown}
          />
          <div className="composer-toolbar">
            <GenerationSizeControl
              customValue={customSize}
              idPrefix="esse"
              label="生成比例："
              selectedValue={selectedSize}
              onCustomValueChange={setCustomSize}
              onSelectedValueChange={setSelectedSize}
            />
            <EssePersonaSelect value={selectedPersona} onChange={setSelectedPersona} />
          </div>
          <button type="submit" disabled={isAgentWorking ? false : !canSend} aria-label={isAgentWorking ? "停止" : "发送"}>
            {isAgentWorking ? <span className="composer-stop-icon" aria-hidden="true" /> : "↑"}
          </button>
        </form>
      </div>
    </div>
  );

  function togglePlanCollapse(planId: string, isCollapsed: boolean): void {
    setExpandedPlanIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (isCollapsed) {
        nextIds.add(planId);
      } else {
        nextIds.delete(planId);
      }

      return nextIds;
    });
    setCollapsedPlanIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (isCollapsed) {
        nextIds.delete(planId);
      } else {
        nextIds.add(planId);
      }

      return nextIds;
    });
  }
}

function EssePersonaSelect({
  disabled,
  onChange,
  value
}: {
  disabled?: boolean;
  onChange: (value: EssePersona) => void;
  value: EssePersona;
}) {
  return (
    <OsSelect
      ariaLabel="选择 Esse 人格"
      disabled={disabled}
      icon={<EssePersonaIcon />}
      listLabel="Esse 人格"
      options={ESSE_PERSONA_OPTIONS}
      value={value}
      onValueChange={onChange}
    />
  );
}

function EssePersonaIcon() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M10 10.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
      <path d="M4.4 16.2c.7-2.5 2.7-4 5.6-4s4.9 1.5 5.6 4" />
    </svg>
  );
}

function EssePreflightCard({
  decision,
  onResolve,
  request
}: {
  decision: NonNullable<ProjectManagerState["conversation"]["messages"][number]["preflightDecision"]>;
  onResolve: (requestId: string, decision: EssePreflightResponse["decision"]) => void;
  request: EssePreflightRequest;
}) {
  const commandLabel = formatPreflightToolLabel(request.payload.tool);
  const isPending = decision === "pending";

  return (
    <section className={`esse-preflight-card ${decision}`} aria-label="Esse 生成确认">
      <header>
        <strong>{commandLabel}</strong>
        <span>{request.payload.estimatedApiCalls} 次 API 调用</span>
      </header>
      <div className="esse-preflight-command-list">
        {request.payload.commands.map((command, index) => (
          <div className="esse-preflight-command" key={`${request.requestId}-${index}`}>
            <span>{command.displayLabel ?? command.target?.fileName ?? `任务 ${index + 1}`}</span>
            <strong>{formatPreflightCommandMode(command.mode)}</strong>
            {command.size ? <em>{command.size}</em> : null}
            <p>{command.prompt ?? "未填写提示词"}</p>
          </div>
        ))}
      </div>
      <footer>
        {isPending ? (
          <>
            <button className="toolbar-button primary" type="button" onClick={() => onResolve(request.requestId, "execute")}>
              执行
            </button>
            <button className="toolbar-button" type="button" onClick={() => onResolve(request.requestId, "cancel")}>
              取消
            </button>
          </>
        ) : (
          <span>{decision === "execute" ? "已确认执行" : "已取消"}</span>
        )}
      </footer>
    </section>
  );
}

function EsseBatchTaskCard({
  batchTask,
  imageSessions,
  onCancelAll,
  onCancelItem,
  onRetryFailed,
  onRetryItem
}: {
  batchTask: NonNullable<ProjectManagerState["conversation"]["messages"][number]["batchTask"]>;
  imageSessions: ImageSession[];
  onCancelAll: (batchTaskId: string) => void;
  onCancelItem: (batchTaskId: string, sessionId: string) => void;
  onRetryFailed: (batchTaskId: string) => void;
  onRetryItem: (batchTaskId: string, sessionId: string) => void;
}) {
  const sessionsById = new Map(imageSessions.map((session) => [session.id, session]));
  const activeItems = batchTask.items.filter((item) => isActiveBatchTaskStatus(sessionsById.get(item.sessionId)?.status));
  const failedItems = batchTask.items.filter((item) => sessionsById.get(item.sessionId)?.status === "failed");

  return (
    <section className="esse-batch-task-card" aria-label="Esse 生成任务">
      <header>
        <strong>已提交 {batchTask.items.length} 个生成任务</strong>
        <span>{activeItems.length > 0 ? `${activeItems.length} 个进行中` : "已结束"}</span>
      </header>
      <div className="esse-batch-task-list">
        {batchTask.items.map((item) => {
          const session = sessionsById.get(item.sessionId);
          const status = session?.status ?? "idle";
          const canCancel = isActiveBatchTaskStatus(status);

          return (
            <div className={`esse-batch-task-item ${status}`} key={`${batchTask.batchTaskId}-${item.sessionId}`}>
              <span className="esse-batch-task-name">{item.displayLabel}</span>
              <strong>{formatPreflightCommandMode(item.mode)}</strong>
              <em>{formatBatchTaskStatus(status, session?.errorMessage)}</em>
              <p>{item.promptSummary || "未填写提示词"}</p>
              {canCancel ? (
                <button
                  className="toolbar-button"
                  type="button"
                  onClick={() => onCancelItem(batchTask.batchTaskId, item.sessionId)}
                >
                  取消
                </button>
              ) : status === "failed" ? (
                <button
                  className="toolbar-button"
                  type="button"
                  onClick={() => onRetryItem(batchTask.batchTaskId, item.sessionId)}
                >
                  重试
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {activeItems.length > 0 ? (
        <footer>
          <button className="toolbar-button" type="button" onClick={() => onCancelAll(batchTask.batchTaskId)}>
            全部取消
          </button>
          {failedItems.length > 0 ? (
            <button className="toolbar-button" type="button" onClick={() => onRetryFailed(batchTask.batchTaskId)}>
              重试失败项
            </button>
          ) : null}
        </footer>
      ) : failedItems.length > 0 ? (
        <footer>
          <button className="toolbar-button" type="button" onClick={() => onRetryFailed(batchTask.batchTaskId)}>
            重试失败项
          </button>
        </footer>
      ) : null}
    </section>
  );
}

function isActiveBatchTaskStatus(status: ImageSession["status"] | undefined): boolean {
  return status === "queued" || status === "generating";
}

function formatBatchTaskStatus(status: ImageSession["status"], errorMessage?: string): string {
  if (status === "queued") {
    return "排队中";
  }
  if (status === "generating") {
    return "生成中";
  }
  if (status === "completed") {
    return "已完成";
  }
  if (status === "failed") {
    return errorMessage === "已取消" ? "已取消" : "失败";
  }
  return "待处理";
}

function formatPreflightToolLabel(tool: EssePreflightRequest["payload"]["tool"]): string {
  if (tool === "run_batch_generation") {
    return "批量生成";
  }
  if (tool === "package_generated_images") {
    return "打包导出";
  }
  return "生成图片";
}

function formatPreflightCommandMode(mode: EssePreflightRequest["payload"]["commands"][number]["mode"]): string {
  if (mode === "generate") {
    return "生成";
  }
  if (mode === "edit") {
    return "编辑";
  }
  return "文件";
}

function PlanCard({
  collapsed,
  imageSessions,
  plan,
  onOpenImagePreview,
  onExecutePlan,
  onToggleCollapse
}: {
  collapsed: boolean;
  imageSessions: ImageSession[];
  plan: BatchPlan;
  onOpenImagePreview: (title: string, images: PreviewImage[], initialPath: string) => void;
  onExecutePlan: (planId: string, mode: ProjectPlanExecutionMode) => void;
  onToggleCollapse: () => void;
}) {
  const canExecute = canRunPlanCommands(plan, "all");
  const canRetryFailed = canRunPlanCommands(plan, "failed");

  return (
    <section className={`batch-plan-card ${plan.status} ${collapsed ? "collapsed" : ""}`} aria-label={`批量方案：${plan.title}`}>
      <header>
        <div className="plan-title-row">
          {plan.status === "running" ? <span className="plan-title-spinner" role="img" aria-label="任务执行中" /> : null}
          <strong className="plan-title">{formatPlanApprovalTitle(plan)}</strong>
        </div>
        <button
          className="plan-toggle-button"
          type="button"
          aria-label={collapsed ? "展开方案" : "收起方案"}
          onClick={onToggleCollapse}
        >
          <span className="plan-toggle-icon" aria-hidden="true" />
        </button>
      </header>
      {collapsed ? null : (
        <>
          <div className="worker-command-list">
            {plan.commands.map((command) => (
              <CommandRow
                command={command}
                key={command.id}
                referenceImages={getCommandReferencePreviews(plan, command)}
                report={findReport(plan, command.id)}
                sourceImagePreview={getCommandSourceImagePreview(command, imageSessions)}
                onOpenImagePreview={onOpenImagePreview}
              />
            ))}
          </div>
        </>
      )}
      <footer>
        {collapsed ? null : (
          <>
            {canRetryFailed ? (
              <button className="toolbar-button primary" type="button" onClick={() => onExecutePlan(plan.id, "failed")}>
                重试失败项
              </button>
            ) : (
              <button className="toolbar-button primary" type="button" disabled={!canExecute} onClick={() => onExecutePlan(plan.id, "all")}>
                确认执行
              </button>
            )}
          </>
        )}
      </footer>
    </section>
  );
}

function CommandRow({
  command,
  referenceImages,
  report,
  sourceImagePreview,
  onOpenImagePreview
}: {
  command: WorkerCommand;
  referenceImages: BatchPlanReferenceImage[];
  report?: WorkerReport;
  sourceImagePreview: CommandSourceImagePreview | null;
  onOpenImagePreview: (title: string, images: PreviewImage[], initialPath: string) => void;
}) {
  function openSourceImagePreview(): void {
    if (!sourceImagePreview) {
      return;
    }

    onOpenImagePreview(
      "正在编辑的图片",
      [
        {
          key: sourceImagePreview.sessionId,
          label: sourceImagePreview.label,
          path: sourceImagePreview.filePath
        }
      ],
      sourceImagePreview.filePath
    );
  }

  function openCommandReferencePreview(selectedPath: string): void {
    onOpenImagePreview(
      "方案参考图",
      referenceImages.map((referenceImage, index) => ({
        key: referenceImage.id,
        label: referenceImage.label || `参考图 ${index + 1}`,
        path: referenceImage.filePath
      })),
      selectedPath
    );
  }

  return (
    <div className={`worker-command-row ${report?.status ?? "pending"} ${sourceImagePreview ? "has-source-preview" : ""}`}>
      <span>{formatWorkerStatus(report)}</span>
      {sourceImagePreview ? (
        <button
          className="command-source-preview"
          type="button"
          aria-label={`预览正在编辑的${sourceImagePreview.sessionId}`}
          onClick={openSourceImagePreview}
        >
          <img
            src={window.batchImager?.getImageUrl(sourceImagePreview.filePath) ?? sourceImagePreview.filePath}
            alt={sourceImagePreview.label}
            draggable={false}
          />
        </button>
      ) : null}
      <div>
        <strong>{command.targetSessionId}</strong>
        <div className="command-prompt-preview">
          <span>Prompt 预览</span>
          <p>{command.instruction}</p>
        </div>
        {referenceImages.length ? (
          <div className="command-reference-strip" aria-label="本任务参考图">
            {referenceImages.map((referenceImage) => (
              <button
                key={referenceImage.id}
                type="button"
                aria-label={`预览${referenceImage.label}`}
                onClick={() => openCommandReferencePreview(referenceImage.filePath)}
              >
                <img
                  src={window.batchImager?.getImageUrl(referenceImage.filePath) ?? referenceImage.filePath}
                  alt={referenceImage.label}
                  draggable={false}
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface CommandSourceImagePreview {
  filePath: string;
  label: string;
  sessionId: string;
}

function getCommandSourceImagePreview(command: WorkerCommand, imageSessions: ImageSession[]): CommandSourceImagePreview | null {
  if (command.generationMode !== "edit") {
    return null;
  }

  const sourceSessionId = command.sourceSessionId ?? command.targetSessionId;
  const sourceSession = imageSessions.find((session) => session.id === sourceSessionId);
  if (!sourceSession) {
    return null;
  }

  return {
    filePath: getSessionGenerationSourcePath(sourceSession),
    label: `正在编辑 ${sourceSession.id}`,
    sessionId: sourceSession.id
  };
}

function getPlan(state: ProjectManagerState, planId: string): BatchPlan | null {
  return state.plans.find((plan) => plan.id === planId) ?? null;
}

function hasLaterUserMessage(state: ProjectManagerState, index: number): boolean {
  return state.conversation.messages.slice(index + 1).some((message) => message.role === "user");
}

function findReport(plan: BatchPlan, commandId: string): WorkerReport | undefined {
  return plan.reports?.find((report) => report.commandId === commandId);
}

function getCommandReferencePreviews(plan: BatchPlan, command: WorkerCommand): BatchPlanReferenceImage[] {
  if (!command.referenceImageIds?.length || !plan.referenceImages?.length) {
    return [];
  }

  const byId = new Map(plan.referenceImages.map((referenceImage) => [referenceImage.id, referenceImage]));

  return command.referenceImageIds
    .map((id) => byId.get(id))
    .filter((referenceImage): referenceImage is BatchPlanReferenceImage => Boolean(referenceImage));
}

function formatPlanApprovalTitle(plan: BatchPlan): string {
  if (plan.status === "running") {
    const reportedCount = countReportedCommands(plan);
    return `Esse工作进度：${reportedCount}/${plan.commands.length}`;
  }

  if (plan.status === "completed") {
    return `Esse完成了${plan.commands.length}个任务`;
  }

  if (plan.status === "failed") {
    const failedCount = plan.reports?.filter((report) => report.status === "failed").length ?? 0;
    return `Esse有${failedCount || plan.commands.length}个任务失败`;
  }

  if (plan.status === "paused") {
    return `Esse暂停了${plan.commands.length}个任务`;
  }

  return `Esse有${plan.commands.length}个任务等你确认`;
}

function countReportedCommands(plan: BatchPlan): number {
  return new Set((plan.reports ?? []).map((report) => report.commandId)).size;
}

function formatWorkerStatus(report: WorkerReport | undefined): string {
  if (!report) {
    return "待";
  }

  if (report.status === "completed") {
    return "✓";
  }

  if (report.status === "failed") {
    return "!";
  }

  return "-";
}

function getProjectThreadContentSignature(
  state: ProjectManagerState,
  activityMessage: string | undefined,
  isCreatingPlan: boolean
): string {
  return [
    state.conversation.id,
    state.conversation.currentPlanId ?? "",
    isCreatingPlan ? "creating" : "idle",
    activityMessage ?? "",
    ...state.conversation.messages.map((message) =>
      [
        message.id,
        message.role,
        message.content,
        message.planId ?? "",
        message.preflightRequest?.requestId ?? "",
        message.preflightDecision ?? "",
        message.referenceFilePaths?.join("|") ?? ""
      ].join(":")
    ),
    ...state.plans.map((plan) =>
      [
        plan.id,
        plan.status,
        plan.commands.length,
        plan.reports?.map((report) => `${report.commandId}:${report.status}:${report.generatedImagePath ?? ""}:${report.errorMessage ?? ""}`).join("|") ?? ""
      ].join(":")
    )
  ].join("\n");
}
