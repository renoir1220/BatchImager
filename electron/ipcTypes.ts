export interface GenerateImageRequest {
  imagePath: string;
  prompt: string;
  referenceImagePaths?: string[];
  sessionId: string;
  size?: string;
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

export interface CreateProjectManagerPlanRequest {
  outputSize?: string;
  prompt: string;
  referenceImagePaths?: string[];
  sessions: ProjectManagerPlanSession[];
}

export interface CreateProjectManagerPlanResponse {
  plan: BatchPlan;
}

export interface EsseAgentHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export type EssePersona = "old-ox" | "excellent-employee" | "question-girl" | "robot";

export interface EsseImageRequest {
  id: string;
  mode: "edit" | "generate";
  prompt: string;
  size?: string;
  sourceSessionId?: string;
  target: "existing" | "new";
}

export interface CreatePlaceholderImageRequest {
  sessionId: string;
  size?: string;
}

export interface CreatePlaceholderImageResponse {
  filePath: string;
}

export interface EsseFileTask {
  destination: "desktop";
  fileName?: string;
  id: string;
  source: "generated-images";
  type: "package";
}

export interface EsseFileResult {
  id: string;
  outputPath: string;
  type: "package";
}

export interface SendEsseMessageRequest {
  generationMode?: ImageGenerationMode;
  messages: EsseAgentHistoryMessage[];
  outputSize?: string;
  persona?: EssePersona;
  referenceImagePaths?: string[];
  selectedSessionId?: string | null;
  sessions: ProjectManagerPlanSession[];
}

export interface SendEsseMessageResponse {
  fileResults?: EsseFileResult[];
  fileTasks?: EsseFileTask[];
  imageRequests?: EsseImageRequest[];
  plan?: BatchPlan;
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
