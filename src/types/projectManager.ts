import type {
  AgentBashExecutionEvent,
  AgentBatchTaskCardData,
  AgentPermissionRequest,
  AgentPreflightRequest,
  ProjectManagerContextType
} from "../../electron/ipcTypes";

export type ProjectManagerMessageRole = "user" | "assistant" | "error" | "context";
export type BatchPlanStatus = "draft" | "running" | "completed" | "failed" | "paused";
export type WorkerReportStatus = "completed" | "failed" | "skipped";

export interface ProjectManagerMessage {
  id: string;
  role: ProjectManagerMessageRole;
  content: string;
  bashExecution?: AgentBashExecutionEvent;
  batchTask?: AgentBatchTaskCardData;
  contextType?: ProjectManagerContextType;
  planId?: string;
  permissionDecision?: "pending" | "allow-once" | "allow-session" | "deny";
  permissionRequest?: AgentPermissionRequest;
  preflightDecision?: "pending" | "execute" | "modify" | "cancel";
  preflightRequest?: AgentPreflightRequest;
  referenceFilePaths?: string[];
}

export interface ProjectManagerConversation {
  currentPlanId?: string;
  id: string;
  messages: ProjectManagerMessage[];
}

export interface WorkerCommand {
  constraints: string[];
  generationMode?: "edit" | "generate";
  id: string;
  instruction: string;
  outputSize?: string;
  planId: string;
  referenceImageIds?: string[];
  referenceImageNames?: string[];
  source: "project-manager";
  sourceSessionId?: string;
  target?: "existing" | "new";
  targetSessionId: string;
}

export interface BatchPlanReferenceImage {
  filePath: string;
  id: string;
  label: string;
}

export interface WorkerReport {
  commandId: string;
  errorMessage?: string;
  generatedImagePath?: string;
  status: WorkerReportStatus;
  summary: string;
  targetSessionId: string;
}

export interface BatchPlan {
  commands: WorkerCommand[];
  globalInstruction: string;
  id: string;
  outputSize?: string;
  referenceImages?: BatchPlanReferenceImage[];
  reports?: WorkerReport[];
  status: BatchPlanStatus;
  targetSessionIds: string[];
  title: string;
}

export interface ProjectManagerState {
  conversation: ProjectManagerConversation;
  plans: BatchPlan[];
}

export interface AgentImageRequest {
  id: string;
  mode: "edit" | "generate";
  prompt: string;
  size?: string;
  sourceSessionId?: string;
  target: "existing" | "new";
}

export type EsseImageRequest = AgentImageRequest;

export type EssePersona = "old-ox" | "excellent-employee" | "question-girl" | "robot";
