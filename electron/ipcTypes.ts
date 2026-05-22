export interface GenerateImageRequest {
  imagePath: string;
  prompt: string;
  referenceImagePaths?: string[];
  sessionId: string;
  size?: string;
}

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
export type PersistedImageSessionContextType = "batch-prompt" | "generated-image";

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
  project: ProjectMetadata;
  selectedSessionId?: string | null;
  sessions: PersistedImageSession[];
}

export interface ImportProjectImagesRequest {
  sourcePaths: string[];
}

export interface SaveProjectSnapshotRequest {
  selectedSessionId?: string | null;
  sessions: PersistedImageSession[];
}
