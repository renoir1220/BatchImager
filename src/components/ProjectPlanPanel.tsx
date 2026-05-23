import { FormEvent, KeyboardEvent, MouseEvent, useState } from "react";
import type { AppLogEntry } from "../../electron/ipcTypes";
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
import { usePastedReferenceImages } from "./usePastedReferenceImages";
import {
  canRunPlanCommands,
  type ProjectPlanExecutionMode
} from "../domain/projectPlanExecution";

interface ProjectPlanPanelProps {
  activityLogs: AppLogEntry[];
  isCreatingPlan: boolean;
  projectManagerState: ProjectManagerState;
  onExecutePlan: (planId: string, mode: ProjectPlanExecutionMode) => void;
  onCopyImage: (imagePath: string) => void;
  onOpenImagePreview: (title: string, images: PreviewImage[], initialPath: string) => void;
  onSendMessage: (content: string, outputSize?: string, referenceImagePaths?: string[], persona?: EssePersona) => void;
}

const ESSE_PERSONA_OPTIONS: { label: string; value: EssePersona }[] = [
  { label: "老黄牛", value: "old-ox" },
  { label: "优秀员工", value: "excellent-employee" },
  { label: "问题少女", value: "question-girl" },
  { label: "无情的机器人", value: "robot" }
];
export function ProjectPlanPanel({
  activityLogs,
  isCreatingPlan,
  projectManagerState,
  onExecutePlan,
  onCopyImage,
  onOpenImagePreview,
  onSendMessage
}: ProjectPlanPanelProps) {
  const [expandedPlanIds, setExpandedPlanIds] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [customSize, setCustomSize] = useState("");
  const [selectedPersona, setSelectedPersona] = useState<EssePersona>("excellent-employee");
  const pastedReferences = usePastedReferenceImages();
  const isAgentWorking = isCreatingPlan || projectManagerState.plans.some((plan) => plan.status === "running");
  const currentActivityLog = activityLogs.at(-1);
  const canSend = Boolean(
    message.trim() && !isCreatingPlan && !pastedReferences.isSavingReference && isGenerationSizeSelectionValid(selectedSize, customSize)
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
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
    <div className="project-plan-panel" aria-label="项目方案">
      <div className="project-manager-thread">
        {projectManagerState.conversation.messages.length === 0 ? (
          <div className="thread-line muted">说明整批图片想怎么做。这里可以先讨论方向，也可以生成新图或创建待确认的批处理方案。</div>
        ) : (
          projectManagerState.conversation.messages.map((message, index) => {
            const plan = message.planId ? getPlan(projectManagerState, message.planId) : null;
            const shouldCollapse = plan ? hasLaterUserMessage(projectManagerState, index) : false;
            const collapsed = Boolean(plan && shouldCollapse && !expandedPlanIds.has(plan.id));

            return (
              <div className={`message-row ${message.role}`} key={message.id}>
                <div className={`thread-line ${message.role}`}>
                  <MarkdownMessage content={message.content} />
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
                      plan={plan}
                      onOpenImagePreview={onOpenImagePreview}
                      onExecutePlan={onExecutePlan}
                      onToggleCollapse={() =>
                        setExpandedPlanIds((currentIds) => toggleExpandedPlanId(currentIds, plan.id))
                      }
                    />
                  ) : null}
                </div>
                <MessageActions content={message.content} tone={message.role} />
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
            disabled={isCreatingPlan}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleComposerKeyDown}
          />
          <div className="composer-toolbar">
            <GenerationSizeControl
              customValue={customSize}
              disabled={isCreatingPlan}
              idPrefix="esse"
              label="生成比例："
              selectedValue={selectedSize}
              onCustomValueChange={setCustomSize}
              onSelectedValueChange={setSelectedSize}
            />
            <label className="esse-persona-switch">
              <span>人格：</span>
              <select
                aria-label="选择 Esse 人格"
                disabled={isCreatingPlan}
                value={selectedPersona}
                onChange={(event) => setSelectedPersona(event.target.value as EssePersona)}
              >
                {ESSE_PERSONA_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" disabled={!canSend} aria-label="发送">
            ↑
          </button>
        </form>
      </div>
    </div>
  );
}

function PlanCard({
  collapsed,
  plan,
  onOpenImagePreview,
  onExecutePlan,
  onToggleCollapse
}: {
  collapsed: boolean;
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
        <div>
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
  onOpenImagePreview
}: {
  command: WorkerCommand;
  referenceImages: BatchPlanReferenceImage[];
  report?: WorkerReport;
  onOpenImagePreview: (title: string, images: PreviewImage[], initialPath: string) => void;
}) {
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
    <div className={`worker-command-row ${report?.status ?? "pending"}`}>
      <span>{formatWorkerStatus(report)}</span>
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

function getPlan(state: ProjectManagerState, planId: string): BatchPlan | null {
  return state.plans.find((plan) => plan.id === planId) ?? null;
}

function hasLaterUserMessage(state: ProjectManagerState, index: number): boolean {
  return state.conversation.messages.slice(index + 1).some((message) => message.role === "user");
}

function toggleExpandedPlanId(currentIds: Set<string>, planId: string): Set<string> {
  const nextIds = new Set(currentIds);

  if (nextIds.has(planId)) {
    nextIds.delete(planId);
  } else {
    nextIds.add(planId);
  }

  return nextIds;
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
    return `方案有${plan.commands.length}个任务执行中`;
  }

  if (plan.status === "completed") {
    return `方案有${plan.commands.length}个任务已完成`;
  }

  if (plan.status === "failed") {
    return `方案有${plan.commands.length}个任务有失败`;
  }

  if (plan.status === "paused") {
    return `方案有${plan.commands.length}个任务已暂停`;
  }

  return `方案有${plan.commands.length}个任务待审批`;
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
