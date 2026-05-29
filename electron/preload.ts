import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AppLogEntry,
  AddEsseSkillPathRequest,
  AddEsseMemoryRequest,
  AddEsseMemoryResponse,
  ApiSettingsSnapshot,
  AgentAssistantMessageUpdateEvent,
  AgentBashExecutionEvent,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPermissionResponseAck,
  AgentPreflightRequest,
  AgentPreflightResponse,
  AgentPreflightResponseAck,
  AgentProviderDescriptor,
  CancelAgentBatchTaskAllRequest,
  CancelAgentBatchTaskAllResponse,
  CancelAgentBatchTaskItemRequest,
  CancelAgentBatchTaskItemResponse,
  CancelEsseBatchTaskAllRequest,
  CancelEsseBatchTaskAllResponse,
  CancelEsseBatchTaskItemRequest,
  CancelEsseBatchTaskItemResponse,
  CancelOperationRequest,
  CancelOperationResponse,
  ChatImageGenerationStartedEvent,
  CopyImageToClipboardRequest,
  CopyImageToClipboardResponse,
  CreatePlaceholderImageRequest,
  CreatePlaceholderImageResponse,
  DeleteProjectRequest,
  ExportImagesRequest,
  ExportImagesResponse,
  GenerateImageRequest,
  InstallEsseSkillFromGitRequest,
  GenerateImageResponse,
  ImportProjectImagesRequest,
  OpenProjectRequest,
  ProjectListEntry,
  ProjectSnapshot,
  RemoveEsseMemoryRequest,
  RenameProjectRequest,
  RemoveEsseSkillRequest,
  RetryEsseBatchTaskFailedRequest,
  RetryEsseBatchTaskFailedResponse,
  RetryEsseBatchTaskItemRequest,
  RetryEsseBatchTaskItemResponse,
  RetryAgentBatchTaskFailedRequest,
  RetryAgentBatchTaskFailedResponse,
  RetryAgentBatchTaskItemRequest,
  RetryAgentBatchTaskItemResponse,
  SaveApiSettingsRequest,
  ReadEsseSkillFileRequest,
  ReadEsseSkillFileResponse,
  SaveReferenceImageRequest,
  SaveReferenceImageResponse,
  SaveProjectSnapshotRequest,
  EssePreflightRequest,
  EssePreflightResponse,
  EssePreflightResponseAck,
  SendChatMessageRequest,
  SendChatMessageResponse,
  EssePermissionRequest,
  EssePermissionResponse,
  EssePermissionResponseAck,
  EsseAssistantMessageUpdateEvent,
  EsseBashExecutionEvent,
  EsseMemorySnapshot,
  SendEsseMessageRequest,
  SendEsseMessageResponse,
  SendAgentMessageRequest,
  SendAgentMessageResponse,
  EsseSkillsSnapshot,
  ShowFileInFolderRequest,
  SetEsseSkillEnabledRequest
} from "./ipcTypes";

const IMAGE_PROTOCOL = "batchimager-file";

const api = {
  platform: process.platform,
  createProject: async (): Promise<ProjectSnapshot> => ipcRenderer.invoke("project:create"),
  listProjects: async (): Promise<ProjectListEntry[]> => ipcRenderer.invoke("project:list"),
  openProject: async (request?: OpenProjectRequest): Promise<ProjectSnapshot | null> => ipcRenderer.invoke("project:open", request),
  rememberProjectDirectory: async (): Promise<ProjectListEntry[] | null> => ipcRenderer.invoke("project:remember-directory"),
  renameProject: async (request: RenameProjectRequest): Promise<ProjectListEntry[]> => ipcRenderer.invoke("project:rename", request),
  deleteProject: async (request: DeleteProjectRequest): Promise<ProjectListEntry[]> => ipcRenderer.invoke("project:delete", request),
  importImages: async (request: ImportProjectImagesRequest): Promise<ProjectSnapshot> =>
    ipcRenderer.invoke("project:import-images", request),
  saveProjectSnapshot: async (request: SaveProjectSnapshotRequest): Promise<ProjectSnapshot> =>
    ipcRenderer.invoke("project:save-snapshot", request),
  generateImage: async (request: GenerateImageRequest): Promise<GenerateImageResponse> =>
    ipcRenderer.invoke("generation:generate-image", request),
  cancelOperation: async (request: CancelOperationRequest): Promise<CancelOperationResponse> =>
    ipcRenderer.invoke("app:cancel-operation", request),
  cancelAgentBatchTaskItem: async (request: CancelAgentBatchTaskItemRequest): Promise<CancelAgentBatchTaskItemResponse> =>
    ipcRenderer.invoke("agent:batch-task-cancel-item", request),
  cancelAgentBatchTaskAll: async (request: CancelAgentBatchTaskAllRequest): Promise<CancelAgentBatchTaskAllResponse> =>
    ipcRenderer.invoke("agent:batch-task-cancel-all", request),
  cancelEsseBatchTaskItem: async (request: CancelEsseBatchTaskItemRequest): Promise<CancelEsseBatchTaskItemResponse> =>
    ipcRenderer.invoke("esse:batch-task-cancel-item", request),
  cancelEsseBatchTaskAll: async (request: CancelEsseBatchTaskAllRequest): Promise<CancelEsseBatchTaskAllResponse> =>
    ipcRenderer.invoke("esse:batch-task-cancel-all", request),
  retryEsseBatchTaskItem: async (request: RetryEsseBatchTaskItemRequest): Promise<RetryEsseBatchTaskItemResponse> =>
    ipcRenderer.invoke("esse:batch-task-retry-item", request),
  retryEsseBatchTaskFailed: async (request: RetryEsseBatchTaskFailedRequest): Promise<RetryEsseBatchTaskFailedResponse> =>
    ipcRenderer.invoke("esse:batch-task-retry-failed", request),
  retryAgentBatchTaskItem: async (request: RetryAgentBatchTaskItemRequest): Promise<RetryAgentBatchTaskItemResponse> =>
    ipcRenderer.invoke("agent:batch-task-retry-item", request),
  retryAgentBatchTaskFailed: async (request: RetryAgentBatchTaskFailedRequest): Promise<RetryAgentBatchTaskFailedResponse> =>
    ipcRenderer.invoke("agent:batch-task-retry-failed", request),
  createPlaceholderImage: async (request: CreatePlaceholderImageRequest): Promise<CreatePlaceholderImageResponse> =>
    ipcRenderer.invoke("images:create-placeholder", request),
  saveReferenceImage: async (request: SaveReferenceImageRequest): Promise<SaveReferenceImageResponse> =>
    ipcRenderer.invoke("images:save-reference", request),
  copyImageToClipboard: async (request: CopyImageToClipboardRequest): Promise<CopyImageToClipboardResponse> =>
    ipcRenderer.invoke("images:copy-to-clipboard", request),
  exportImages: async (request: ExportImagesRequest): Promise<ExportImagesResponse> =>
    ipcRenderer.invoke("images:export", request),
  sendChatMessage: async (request: SendChatMessageRequest): Promise<SendChatMessageResponse> =>
    ipcRenderer.invoke("chat:send-message", request),
  sendEsseMessage: async (request: SendEsseMessageRequest): Promise<SendEsseMessageResponse> =>
    ipcRenderer.invoke("esse:send-message", request),
  listAgentProviders: async (): Promise<AgentProviderDescriptor[]> => ipcRenderer.invoke("agent:list-providers"),
  sendAgentMessage: async (request: SendAgentMessageRequest): Promise<SendAgentMessageResponse> =>
    ipcRenderer.invoke("agent:send-message", request),
  respondAgentPreflight: async (response: AgentPreflightResponse): Promise<AgentPreflightResponseAck> =>
    ipcRenderer.invoke("agent:preflight-response", response),
  respondAgentPermission: async (response: AgentPermissionResponse): Promise<AgentPermissionResponseAck> =>
    ipcRenderer.invoke("agent:permission-response", response),
  respondEssePreflight: async (response: EssePreflightResponse): Promise<EssePreflightResponseAck> =>
    ipcRenderer.invoke("esse:preflight-response", response),
  respondEssePermission: async (response: EssePermissionResponse): Promise<EssePermissionResponseAck> =>
    ipcRenderer.invoke("esse:permission-response", response),
  getLogs: async (): Promise<AppLogEntry[]> => ipcRenderer.invoke("logs:list"),
  getApiSettings: async (): Promise<ApiSettingsSnapshot> => ipcRenderer.invoke("settings:get-api"),
  saveApiSettings: async (request: SaveApiSettingsRequest): Promise<ApiSettingsSnapshot> =>
    ipcRenderer.invoke("settings:save-api", request),
  listEsseSkills: async (): Promise<EsseSkillsSnapshot> => ipcRenderer.invoke("esse:skills-list"),
  reloadEsseSkills: async (): Promise<EsseSkillsSnapshot> => ipcRenderer.invoke("esse:skills-reload"),
  listEsseMemories: async (): Promise<EsseMemorySnapshot> => ipcRenderer.invoke("esse:memory-list"),
  addEsseMemory: async (request: AddEsseMemoryRequest): Promise<AddEsseMemoryResponse> =>
    ipcRenderer.invoke("esse:memory-add", request),
  removeEsseMemory: async (request: RemoveEsseMemoryRequest): Promise<EsseMemorySnapshot> =>
    ipcRenderer.invoke("esse:memory-remove", request),
  setEsseSkillEnabled: async (request: SetEsseSkillEnabledRequest): Promise<EsseSkillsSnapshot> =>
    ipcRenderer.invoke("esse:skills-set-enabled", request),
  addEsseSkillPath: async (request: AddEsseSkillPathRequest): Promise<EsseSkillsSnapshot> =>
    ipcRenderer.invoke("esse:skills-add-path", request),
  installEsseSkillFromGit: async (request: InstallEsseSkillFromGitRequest): Promise<EsseSkillsSnapshot> =>
    ipcRenderer.invoke("esse:skills-install-git", request),
  removeEsseSkill: async (request: RemoveEsseSkillRequest): Promise<EsseSkillsSnapshot> =>
    ipcRenderer.invoke("esse:skills-remove", request),
  readEsseSkillFile: async (request: ReadEsseSkillFileRequest): Promise<ReadEsseSkillFileResponse> =>
    ipcRenderer.invoke("esse:skills-read-file", request),
  showFileInFolder: async (request: ShowFileInFolderRequest): Promise<{ ok: true }> =>
    ipcRenderer.invoke("files:show-in-folder", request),
  setRunningWorkCount: (count: number): void => {
    ipcRenderer.send("app:set-running-work-count", count);
  },
  subscribeLogs: (listener: (entry: AppLogEntry) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: AppLogEntry) => listener(entry);
    ipcRenderer.on("logs:entry", handler);

    return () => {
      ipcRenderer.removeListener("logs:entry", handler);
    };
  },
  subscribeProjectThumbnailUpdates: (listener: (projectDirectory: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, projectDirectory: string) => listener(projectDirectory);
    ipcRenderer.on("project:thumbnails-updated", handler);

    return () => {
      ipcRenderer.removeListener("project:thumbnails-updated", handler);
    };
  },
  subscribeProjectSnapshotUpdates: (listener: (snapshot: ProjectSnapshot) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: ProjectSnapshot) => listener(snapshot);
    ipcRenderer.on("project:snapshot-updated", handler);

    return () => {
      ipcRenderer.removeListener("project:snapshot-updated", handler);
    };
  },
  subscribeAgentPreflightRequests: (listener: (request: AgentPreflightRequest) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, request: AgentPreflightRequest) => listener(request);
    ipcRenderer.on("agent:preflight-request", handler);

    return () => {
      ipcRenderer.removeListener("agent:preflight-request", handler);
    };
  },
  subscribeAgentPermissionRequests: (listener: (request: AgentPermissionRequest) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, request: AgentPermissionRequest) => listener(request);
    ipcRenderer.on("agent:permission-request", handler);

    return () => {
      ipcRenderer.removeListener("agent:permission-request", handler);
    };
  },
  subscribeEssePreflightRequests: (listener: (request: EssePreflightRequest) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, request: EssePreflightRequest) => listener(request);
    ipcRenderer.on("esse:preflight-request", handler);

    return () => {
      ipcRenderer.removeListener("esse:preflight-request", handler);
    };
  },
  subscribeEssePermissionRequests: (listener: (request: EssePermissionRequest) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, request: EssePermissionRequest) => listener(request);
    ipcRenderer.on("esse:permission-request", handler);

    return () => {
      ipcRenderer.removeListener("esse:permission-request", handler);
    };
  },
  subscribeAgentBashExecutionEvents: (listener: (event: AgentBashExecutionEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, bashEvent: AgentBashExecutionEvent) => listener(bashEvent);
    ipcRenderer.on("agent:bash-execution", handler);

    return () => {
      ipcRenderer.removeListener("agent:bash-execution", handler);
    };
  },
  subscribeEsseBashExecutionEvents: (listener: (event: EsseBashExecutionEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, bashEvent: EsseBashExecutionEvent) => listener(bashEvent);
    ipcRenderer.on("esse:bash-execution", handler);

    return () => {
      ipcRenderer.removeListener("esse:bash-execution", handler);
    };
  },
  subscribeAgentAssistantMessageUpdates: (listener: (event: AgentAssistantMessageUpdateEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, updateEvent: AgentAssistantMessageUpdateEvent) => listener(updateEvent);
    ipcRenderer.on("agent:assistant-message-update", handler);

    return () => {
      ipcRenderer.removeListener("agent:assistant-message-update", handler);
    };
  },
  subscribeEsseAssistantMessageUpdates: (listener: (event: EsseAssistantMessageUpdateEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, updateEvent: EsseAssistantMessageUpdateEvent) => listener(updateEvent);
    ipcRenderer.on("esse:assistant-message-update", handler);

    return () => {
      ipcRenderer.removeListener("esse:assistant-message-update", handler);
    };
  },
  subscribeChatImageGenerationStarted: (listener: (event: ChatImageGenerationStartedEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, startedEvent: ChatImageGenerationStartedEvent) => listener(startedEvent);
    ipcRenderer.on("chat:image-generation-started", handler);

    return () => {
      ipcRenderer.removeListener("chat:image-generation-started", handler);
    };
  },
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  getImageUrl: (filePath: string): string => {
    const encodedPath = Buffer.from(filePath, "utf8").toString("base64url");
    return `${IMAGE_PROTOCOL}://image/${encodeURIComponent(encodedPath)}`;
  }
};

contextBridge.exposeInMainWorld("batchImager", api);

export type BatchImagerApi = typeof api;
