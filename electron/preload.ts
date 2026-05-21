import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AppLogEntry,
  GenerateImageRequest,
  GenerateImageResponse,
  ImportProjectImagesRequest,
  ProjectSnapshot,
  SaveReferenceImageRequest,
  SaveReferenceImageResponse,
  SaveProjectSnapshotRequest,
  SendChatMessageRequest,
  SendChatMessageResponse
} from "./ipcTypes";

const IMAGE_PROTOCOL = "batchimager-file";

const api = {
  createProject: async (): Promise<ProjectSnapshot> => ipcRenderer.invoke("project:create"),
  openProject: async (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke("project:open"),
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
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  getImageUrl: (filePath: string): string => {
    const encodedPath = Buffer.from(filePath, "utf8").toString("base64url");
    return `${IMAGE_PROTOCOL}://image/${encodeURIComponent(encodedPath)}`;
  }
};

contextBridge.exposeInMainWorld("batchImager", api);

export type BatchImagerApi = typeof api;
