import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AppLogEntry,
  AddEsseSkillPathRequest,
  ApiSettingsSnapshot,
  CancelEsseBatchTaskAllRequest,
  CancelEsseBatchTaskAllResponse,
  CancelEsseBatchTaskItemRequest,
  CancelEsseBatchTaskItemResponse,
  CancelOperationRequest,
  CancelOperationResponse,
  CopyImageToClipboardRequest,
  CopyImageToClipboardResponse,
  CreatePlaceholderImageRequest,
  CreatePlaceholderImageResponse,
  GenerateImageRequest,
  InstallEsseSkillFromGitRequest,
  GenerateImageResponse,
  ImportProjectImagesRequest,
  OpenProjectRequest,
  ProjectListEntry,
  ProjectSnapshot,
  RenameProjectRequest,
  RemoveEsseSkillRequest,
  RetryEsseBatchTaskFailedRequest,
  RetryEsseBatchTaskFailedResponse,
  RetryEsseBatchTaskItemRequest,
  RetryEsseBatchTaskItemResponse,
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
  EsseBashExecutionEvent,
  SendEsseMessageRequest,
  SendEsseMessageResponse,
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
  importImages: async (request: ImportProjectImagesRequest): Promise<ProjectSnapshot> =>
    ipcRenderer.invoke("project:import-images", request),
  saveProjectSnapshot: async (request: SaveProjectSnapshotRequest): Promise<ProjectSnapshot> =>
    ipcRenderer.invoke("project:save-snapshot", request),
  generateImage: async (request: GenerateImageRequest): Promise<GenerateImageResponse> =>
    ipcRenderer.invoke("generation:generate-image", request),
  cancelOperation: async (request: CancelOperationRequest): Promise<CancelOperationResponse> =>
    ipcRenderer.invoke("app:cancel-operation", request),
  cancelEsseBatchTaskItem: async (request: CancelEsseBatchTaskItemRequest): Promise<CancelEsseBatchTaskItemResponse> =>
    ipcRenderer.invoke("esse:batch-task-cancel-item", request),
  cancelEsseBatchTaskAll: async (request: CancelEsseBatchTaskAllRequest): Promise<CancelEsseBatchTaskAllResponse> =>
    ipcRenderer.invoke("esse:batch-task-cancel-all", request),
  retryEsseBatchTaskItem: async (request: RetryEsseBatchTaskItemRequest): Promise<RetryEsseBatchTaskItemResponse> =>
    ipcRenderer.invoke("esse:batch-task-retry-item", request),
  retryEsseBatchTaskFailed: async (request: RetryEsseBatchTaskFailedRequest): Promise<RetryEsseBatchTaskFailedResponse> =>
    ipcRenderer.invoke("esse:batch-task-retry-failed", request),
  createPlaceholderImage: async (request: CreatePlaceholderImageRequest): Promise<CreatePlaceholderImageResponse> =>
    ipcRenderer.invoke("images:create-placeholder", request),
  saveReferenceImage: async (request: SaveReferenceImageRequest): Promise<SaveReferenceImageResponse> =>
    ipcRenderer.invoke("images:save-reference", request),
  copyImageToClipboard: async (request: CopyImageToClipboardRequest): Promise<CopyImageToClipboardResponse> =>
    ipcRenderer.invoke("images:copy-to-clipboard", request),
  sendChatMessage: async (request: SendChatMessageRequest): Promise<SendChatMessageResponse> =>
    ipcRenderer.invoke("chat:send-message", request),
  sendEsseMessage: async (request: SendEsseMessageRequest): Promise<SendEsseMessageResponse> =>
    ipcRenderer.invoke("esse:send-message", request),
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
  subscribeEsseBashExecutionEvents: (listener: (event: EsseBashExecutionEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, bashEvent: EsseBashExecutionEvent) => listener(bashEvent);
    ipcRenderer.on("esse:bash-execution", handler);

    return () => {
      ipcRenderer.removeListener("esse:bash-execution", handler);
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
