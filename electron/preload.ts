import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AppLogEntry,
  GenerateImageRequest,
  GenerateImageResponse,
  ImportProjectImagesRequest,
  OpenProjectRequest,
  ProjectListEntry,
  ProjectSnapshot,
  RenameProjectRequest,
  SaveReferenceImageRequest,
  SaveReferenceImageResponse,
  SaveProjectSnapshotRequest,
  SendChatMessageRequest,
  SendChatMessageResponse
} from "./ipcTypes";

const IMAGE_PROTOCOL = "batchimager-file";

const api = {
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
  saveReferenceImage: async (request: SaveReferenceImageRequest): Promise<SaveReferenceImageResponse> =>
    ipcRenderer.invoke("images:save-reference", request),
  sendChatMessage: async (request: SendChatMessageRequest): Promise<SendChatMessageResponse> =>
    ipcRenderer.invoke("chat:send-message", request),
  getLogs: async (): Promise<AppLogEntry[]> => ipcRenderer.invoke("logs:list"),
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
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  getImageUrl: (filePath: string): string => {
    const encodedPath = Buffer.from(filePath, "utf8").toString("base64url");
    return `${IMAGE_PROTOCOL}://image/${encodeURIComponent(encodedPath)}`;
  }
};

contextBridge.exposeInMainWorld("batchImager", api);

export type BatchImagerApi = typeof api;
