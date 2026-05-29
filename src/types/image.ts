export type ImageSessionStatus = "idle" | "queued" | "generating" | "completed" | "needs-review" | "failed";
export type ImageSessionChatStatus = "idle" | "sending";
export type ImageSessionChatRole = "user" | "assistant" | "error" | "context";
export type ImageSessionContextType =
  | "batch-prompt"
  | "generated-image"
  | "project-command"
  | "agent-task"
  | "esse-task";

export interface ImageSessionChatMessage {
  contextType?: ImageSessionContextType;
  id: string;
  role: ImageSessionChatRole;
  content: string;
  generatedFilePath?: string;
  referenceFilePaths?: string[];
  sourceFilePath?: string;
}

export interface ImageSession {
  id: string;
  filePath: string;
  fileName: string;
  generationMode?: "edit" | "generate";
  chatMessages: ImageSessionChatMessage[];
  chatStatus: ImageSessionChatStatus;
  generatedFilePath?: string;
  generatedFilePaths?: string[];
  lastPrompt?: string;
  errorMessage?: string;
  originatedFromGeneration?: boolean;
  showOriginalInList?: boolean;
  status: ImageSessionStatus;
}
