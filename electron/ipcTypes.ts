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

export interface CancelEsseBatchTaskItemRequest {
  batchTaskId: string;
  sessionId: string;
}

export interface CancelEsseBatchTaskItemResponse {
  canceled: boolean;
}

export interface CancelEsseBatchTaskAllRequest {
  batchTaskId: string;
}

export interface CancelEsseBatchTaskAllResponse {
  canceledCount: number;
}

export interface ApiSettingsSnapshot {
  activeImageApiProfileId: ImageApiProfileId;
  configPath?: string;
  imageApiKeyConfigured: boolean;
  imageBaseUrl: string;
  imageModel: string;
  imageApiProfiles: ImageApiProfileSnapshot[];
  llmApiKeyConfigured: boolean;
  llmBaseUrl: string;
  llmModel: string;
}

export type ImageApiProfileId = "primary" | "secondary";

export interface ImageApiProfileSnapshot {
  active: boolean;
  apiKeyConfigured: boolean;
  baseUrl: string;
  id: ImageApiProfileId;
  llmApiKeyConfigured: boolean;
  llmBaseUrl: string;
  llmModel: string;
  model: string;
  name: string;
}

export interface SaveImageApiProfileRequest {
  apiKey?: string;
  baseUrl: string;
  id: ImageApiProfileId;
  llmApiKey?: string;
  llmBaseUrl: string;
  llmModel: string;
  model: string;
  name: string;
}

export interface SaveApiSettingsRequest {
  activeImageApiProfileId?: ImageApiProfileId;
  imageApiKey?: string;
  imageBaseUrl: string;
  imageModel: string;
  imageApiProfiles?: SaveImageApiProfileRequest[];
  llmApiKey?: string;
  llmBaseUrl: string;
  llmModel: string;
}

export type EsseMemoryCategory = "用户偏好" | "默认约束" | "工作流惯例";

export interface EsseMemoryEntry {
  category: EsseMemoryCategory;
  content: string;
  createdAt: string;
  id: string;
}

export interface EsseMemoryConflict {
  conflictsWith: EsseMemoryEntry;
  similarity: number;
  suggestedNext: string;
}

export interface EsseMemorySnapshot {
  categories: EsseMemoryCategory[];
  entries: EsseMemoryEntry[];
  filePath: string;
}

export interface AddEsseMemoryRequest {
  category?: EsseMemoryCategory;
  content: string;
}

export interface AddEsseMemoryResponse {
  conflict?: EsseMemoryConflict;
  snapshot: EsseMemorySnapshot;
}

export interface RemoveEsseMemoryRequest {
  id: string;
}

export type EsseSkillSource = "built-in" | "global" | "project" | "user-path";

export interface EsseSkillRecord {
  baseDir: string;
  description: string;
  disableModelInvocation: boolean;
  enabled: boolean;
  filePath: string;
  name: string;
  source: EsseSkillSource;
  sourceLabel: string;
}

export interface EsseSkillDiagnostic {
  message: string;
  path?: string;
  type: "warning" | "error" | "collision";
}

export interface EsseSkillsSnapshot {
  diagnostics: EsseSkillDiagnostic[];
  disabledSkills: string[];
  skillPaths: string[];
  skills: EsseSkillRecord[];
}

export interface SetEsseSkillEnabledRequest {
  enabled: boolean;
  name: string;
}

export interface AddEsseSkillPathRequest {
  path: string;
}

export interface InstallEsseSkillFromGitRequest {
  gitUrl: string;
}

export interface RemoveEsseSkillRequest {
  name: string;
}

export interface ReadEsseSkillFileRequest {
  name: string;
}

export interface ReadEsseSkillFileResponse {
  content: string;
  filePath: string;
}

export interface ShowFileInFolderRequest {
  filePath: string;
}

export type EsseBashExecutionStatus = "running" | "completed" | "failed";

export interface EsseBashExecutionEvent {
  command: string;
  cwd: string;
  exitCode?: number | null;
  fullOutputPath?: string;
  isError?: boolean;
  output?: string;
  outputPath?: string;
  skillName?: string | null;
  status: EsseBashExecutionStatus;
  toolCallId: string;
}

export interface RetryEsseBatchTaskItemRequest {
  batchTaskId: string;
  sessionId: string;
}

export interface RetryEsseBatchTaskItemResponse {
  accepted: boolean;
  reason?: string;
  retryCount?: number;
  sessionId?: string;
}

export interface RetryEsseBatchTaskFailedRequest {
  batchTaskId: string;
}

export interface RetryEsseBatchTaskFailedResponse {
  acceptedCount: number;
  rejected: Array<{ reason: string; sessionId: string }>;
}

export interface CopyImageToClipboardRequest {
  imagePath: string;
}

export interface CopyImageToClipboardResponse {
  ok: true;
}

export interface ExportImagesRequest {
  fileName?: string;
  imagePaths: string[];
}

export interface ExportImagesResponse {
  outputPath: string;
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
  generationMode?: ImageGenerationMode;
  generatedImagePath?: string;
  remoteUrl?: string;
  sessionId: string;
}

export interface ChatImageGenerationStartedEvent {
  prompt: string;
  referenceImagePaths?: string[];
  sessionId: string;
  sourceImagePath: string;
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
  originatedFromGeneration?: boolean;
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

export interface EsseBatchTaskCardItem {
  command: EssePreflightCommand;
  displayLabel: string;
  mode: "edit" | "generate";
  promptSummary: string;
  sessionId: string;
}

export interface EsseBatchTaskCardData {
  batchTaskId: string;
  items: EsseBatchTaskCardItem[];
  referenceImages?: BatchPlanReferenceImage[];
}

export interface ProjectManagerMessage {
  id: string;
  role: ProjectManagerMessageRole;
  content: string;
  bashExecution?: EsseBashExecutionEvent;
  batchTask?: EsseBatchTaskCardData;
  contextType?: "esse-bash-execution" | "esse-batch-task" | "esse-tool-call";
  planId?: string;
  permissionDecision?: "pending" | "allow-once" | "allow-session" | "deny";
  permissionRequest?: EssePermissionRequest;
  preflightDecision?: "pending" | "execute" | "modify" | "cancel";
  preflightRequest?: EssePreflightRequest;
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

export type SerializableUndoDescriptor = {
  kind: "restore-workspace";
  projectImageCount: number;
  referenceImages?: BatchPlanReferenceImage[];
  selectedSessionId?: string | null;
  sessions: PersistedImageSession[];
};

export interface PersistedUndoEntry {
  affectedSessionIds: string[];
  createdAt: string;
  id: string;
  inverseDescriptor: SerializableUndoDescriptor;
  sinkRevisionAfter?: number;
  summary: string;
  toolName: string;
  undone?: boolean;
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
  referenceImageNames?: string[];
  size?: string;
  target?: { fileName?: string; sessionId?: string; sourceSessionId?: string; type: "existing" | "new" };
}

export interface EssePreflightPayload {
  commands: EssePreflightCommand[];
  estimatedApiCalls: number;
  estimatedDurationSeconds?: number;
  referenceImages?: BatchPlanReferenceImage[];
  tool: EssePreflightToolName;
}

export interface EssePreflightRequest {
  payload: EssePreflightPayload;
  requestId: string;
}

export interface EssePreflightResponse {
  decision: "execute" | "modify" | "cancel";
  detail?: string;
  modifiedCommands?: EssePreflightCommand[];
  requestId: string;
}

export interface EssePreflightResponseAck {
  accepted: boolean;
}

export type EssePermissionRisk = "read" | "safe-write" | "destructive" | "external-write";

export interface EssePermissionPayload {
  affectedDisplayLabel?: string;
  affectedFileName?: string;
  label: string;
  params: Record<string, unknown>;
  requiresPreflight: boolean;
  risk: EssePermissionRisk;
  targetKey?: string;
  toolName: string;
}

export interface EssePermissionRequest {
  payload: EssePermissionPayload;
  requestId: string;
}

export interface EssePermissionResponse {
  decision: "allow-once" | "allow-session" | "deny";
  reason?: string;
  requestId: string;
}

export interface EssePermissionResponseAck {
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

export interface EsseAssistantMessageUpdateEvent {
  content: string;
  operationId?: string;
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

export interface DeleteProjectRequest {
  directory: string;
}

export interface OpenProjectRequest {
  directory?: string;
}

export interface ProjectSnapshot {
  esseUndoLog?: PersistedUndoEntry[];
  projectManagerState?: ProjectManagerState;
  project: ProjectMetadata;
  referenceImages?: BatchPlanReferenceImage[];
  selectedSessionId?: string | null;
  sessions: PersistedImageSession[];
}

export interface ImportProjectImagesRequest {
  sourcePaths: string[];
}

export interface SaveProjectSnapshotRequest {
  esseUndoLog?: PersistedUndoEntry[];
  projectManagerState?: ProjectManagerState;
  referenceImages?: BatchPlanReferenceImage[];
  selectedSessionId?: string | null;
  sessions: PersistedImageSession[];
}
