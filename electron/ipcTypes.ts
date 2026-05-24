export interface GenerateImageRequest {
  imagePath: string;
  operationId?: string;
  prompt: string;
  referenceImagePaths?: string[];
  sessionId: string;
  size?: string;
}

export interface CancelOperationRequest {
  operationId: string;
}

export interface CancelOperationResponse {
  canceled: boolean;
}

export interface CopyImageToClipboardRequest {
  imagePath: string;
}

export interface CopyImageToClipboardResponse {
  ok: true;
}

export type ImageGenerationMode = "edit" | "generate";

export interface GenerateImageResponse {
  outputPath: string;
  remoteUrl?: string;
  sessionId: string;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatImageContext {
  currentImageLabel?: string;
  fileName?: string;
  originalImageLabel?: string;
  previousGenerationPrompt?: string;
  referenceImageCount?: number;
}

export interface ChatReferenceImage {
  filePath: string;
  id: string;
  label: string;
  pinned?: boolean;
}

export interface SendChatMessageRequest {
  context?: ChatImageContext;
  generationMode?: ImageGenerationMode;
  imagePath: string;
  messages: ChatHistoryMessage[];
  operationId?: string;
  outputSize?: string;
  referenceImages?: ChatReferenceImage[];
  referenceImagePaths?: string[];
  sessionId: string;
}

export interface SendChatMessageResponse {
  assistantMessage: string;
  generatedImagePath?: string;
  remoteUrl?: string;
  sessionId: string;
}

export interface SaveReferenceImageRequest {
  data: ArrayBuffer;
  fileName?: string;
  mimeType: string;
}

export interface SaveReferenceImageResponse {
  fileName: string;
  filePath: string;
}

export type AppLogLevel = "debug" | "info" | "warn" | "error";

export interface AppLogEntry {
  context?: string;
  level: AppLogLevel;
  message: string;
  timestamp: string;
}

export type PersistedImageSessionStatus = "idle" | "queued" | "generating" | "completed" | "needs-review" | "failed";
export type PersistedImageSessionChatStatus = "idle" | "sending";
export type PersistedImageSessionChatRole = "user" | "assistant" | "error" | "context";
export type PersistedImageSessionContextType = "batch-prompt" | "generated-image" | "project-command" | "esse-task";

export interface PersistedImageSessionChatMessage {
  contextType?: PersistedImageSessionContextType;
  id: string;
  role: PersistedImageSessionChatRole;
  content: string;
  generatedFilePath?: string;
  referenceFilePaths?: string[];
  sourceFilePath?: string;
}

export interface PersistedImageSession {
  id: string;
  filePath: string;
  fileName: string;
  generationMode?: ImageGenerationMode;
  chatMessages: PersistedImageSessionChatMessage[];
  chatStatus: PersistedImageSessionChatStatus;
  generatedFilePath?: string;
  generatedFilePaths?: string[];
  lastPrompt?: string;
  errorMessage?: string;
  showOriginalInList?: boolean;
  status: PersistedImageSessionStatus;
}

export interface ProjectMetadata {
  createdAt: string;
  directory: string;
  id: string;
  imageCount: number;
  name: string;
  updatedAt: string;
}

export interface ProjectSummary extends ProjectMetadata {
  previewSourcePaths: string[];
}

export type ProjectManagerMessageRole = "user" | "assistant" | "error" | "context";
export type BatchPlanStatus = "draft" | "running" | "completed" | "failed" | "paused";
export type WorkerReportStatus = "completed" | "failed" | "skipped";

export interface ProjectManagerMessage {
  id: string;
  role: ProjectManagerMessageRole;
  content: string;
  contextType?: "esse-tool-call";
  planId?: string;
  referenceFilePaths?: string[];
}

export interface ProjectManagerConversation {
  currentPlanId?: string;
  id: string;
  messages: ProjectManagerMessage[];
}

export interface WorkerCommand {
  constraints: string[];
  generationMode?: ImageGenerationMode;
  id: string;
  instruction: string;
  outputSize?: string;
  planId: string;
  referenceImageIds?: string[];
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

export interface ProjectManagerPlanSession {
  currentImagePath?: string;
  fileName: string;
  generatedFilePaths?: string[];
  id: string;
}

export interface EsseAgentHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export type EssePersona = "old-ox" | "excellent-employee" | "question-girl" | "robot";

export interface CreatePlaceholderImageRequest {
  sessionId: string;
  size?: string;
}

export interface CreatePlaceholderImageResponse {
  filePath: string;
}

export type EssePreflightToolName = "generate_image" | "run_batch_generation" | "package_generated_images";

export interface EssePreflightCommand {
  displayLabel?: string;
  mode?: "edit" | "generate";
  prompt?: string;
  referenceImageIds?: string[];
  size?: string;
  target?: { fileName?: string; sessionId?: string; type: "existing" | "new" };
}

export interface EssePreflightPayload {
  commands: EssePreflightCommand[];
  estimatedApiCalls: number;
  estimatedDurationSeconds?: number;
  tool: EssePreflightToolName;
}

export interface EssePreflightRequest {
  payload: EssePreflightPayload;
  requestId: string;
}

export interface EssePreflightResponse {
  decision: "execute" | "cancel";
  detail?: string;
  requestId: string;
}

export interface EssePreflightResponseAck {
  accepted: boolean;
}

export interface SendEsseMessageRequest {
  generationMode?: ImageGenerationMode;
  messages: EsseAgentHistoryMessage[];
  operationId?: string;
  outputSize?: string;
  persona?: EssePersona;
  referenceImagePaths?: string[];
  selectedSessionId?: string | null;
  sessions: ProjectManagerPlanSession[];
}

export interface SendEsseMessageResponse {
  reply: string;
}

export interface ProjectListEntry {
  directory: string;
  isExternal: boolean;
  isUnavailable: boolean;
  summary?: ProjectSummary;
  thumbnailPaths: string[];
}

export interface RenameProjectRequest {
  directory: string;
  name: string;
}

export interface OpenProjectRequest {
  directory?: string;
}

export interface ProjectSnapshot {
  projectManagerState?: ProjectManagerState;
  project: ProjectMetadata;
  selectedSessionId?: string | null;
  sessions: PersistedImageSession[];
}

export interface ImportProjectImagesRequest {
  sourcePaths: string[];
}

export interface SaveProjectSnapshotRequest {
  projectManagerState?: ProjectManagerState;
  selectedSessionId?: string | null;
  sessions: PersistedImageSession[];
}
