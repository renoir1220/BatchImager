import { app, BrowserWindow, dialog, ipcMain, net, protocol } from "electron";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  GenerateImageRequest,
  ImportProjectImagesRequest,
  SaveReferenceImageRequest,
  SaveProjectSnapshotRequest,
  SendChatMessageRequest
} from "./ipcTypes";
import { createAppLogger, type AppLogger } from "./services/appLogger";
import { loadTuziConfig, loadTuziLlmConfig } from "./services/localConfig";
import { saveReferenceImageToDirectory } from "./services/localImageStorage";
import { runImageToolChat } from "./services/openAiChatApi";
import { runPiImageToolChat } from "./services/piImageToolChat";
import {
  createProject,
  getProjectGeneratedDirectory,
  getProjectReferencesDirectory,
  importImagesToProject,
  openProject,
  saveProjectSnapshot
} from "./services/projectStore";
import { generateProductImage } from "./services/tuziImageApi";

const IMAGE_PROTOCOL = "batchimager-file";
let logger: AppLogger | undefined;
let activeProjectDirectory: string | undefined;

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "BatchImager",
    backgroundColor: "#f4f4f2",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

  if (app.isPackaged) {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  } else {
    void mainWindow.loadURL(devServerUrl);
  }
}

function registerImageProtocol(): void {
  protocol.handle(IMAGE_PROTOCOL, (request) => {
    const url = new URL(request.url);
    const encodedPath = url.pathname.replace(/^\//, "");
    const filePath = Buffer.from(decodeURIComponent(encodedPath), "base64url").toString("utf8");

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function registerIpc(appLogger: AppLogger): void {
  appLogger.subscribe((entry) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("logs:entry", entry);
    }
  });

  ipcMain.handle("project:create", async () => {
    const projectsDirectory = path.join(app.getPath("userData"), "projects");
    const snapshot = await createProject({ projectsDirectory });
    activeProjectDirectory = snapshot.project.directory;
    appLogger.info("Project created", {
      data: { projectDirectory: snapshot.project.directory, projectId: snapshot.project.id },
      publicMessage: "已新建项目。"
    });

    return snapshot;
  });

  ipcMain.handle("project:open", async () => {
    const projectsDirectory = path.join(app.getPath("userData"), "projects");
    await mkdir(projectsDirectory, { recursive: true });
    const result = await dialog.showOpenDialog({
      title: "打开项目",
      defaultPath: projectsDirectory,
      properties: ["openDirectory"]
    });

    if (result.canceled || !result.filePaths[0]) {
      appLogger.info("Open project canceled", { publicMessage: "已取消打开项目。" });
      return null;
    }

    const snapshot = await openProject(result.filePaths[0]);
    activeProjectDirectory = snapshot.project.directory;
    appLogger.info("Project opened", {
      data: {
        imageCount: snapshot.sessions.length,
        projectDirectory: snapshot.project.directory,
        projectId: snapshot.project.id
      },
      publicMessage: `已打开项目：${snapshot.sessions.length} 张图片。`
    });

    return snapshot;
  });

  ipcMain.handle("project:import-images", async (_event, request: ImportProjectImagesRequest) => {
    assertImportProjectImagesRequest(request);
    const projectDirectory = requireActiveProjectDirectory();

    let sourcePaths = request.sourcePaths;

    if (sourcePaths.length === 0) {
      appLogger.info("Opening image picker", { publicMessage: "打开图片选择器..." });
      const result = await dialog.showOpenDialog({
        title: "选择图片",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "图片",
            extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif"]
          }
        ]
      });

      if (result.canceled) {
        appLogger.info("Image picker canceled", { publicMessage: "已取消导入。" });
        return openProject(projectDirectory);
      }

      sourcePaths = result.filePaths;
    }

    const snapshot = await importImagesToProject(projectDirectory, sourcePaths);
    appLogger.info("Images imported into project", {
      data: { imageCount: snapshot.sessions.length, projectDirectory, sourceCount: sourcePaths.length },
      publicMessage: `项目中共有 ${snapshot.sessions.length} 张图片。`
    });

    return snapshot;
  });

  ipcMain.handle("project:save-snapshot", async (_event, request: SaveProjectSnapshotRequest) => {
    assertSaveProjectSnapshotRequest(request);
    return saveProjectSnapshot(requireActiveProjectDirectory(), request);
  });

  ipcMain.handle("generation:generate-image", async (_event, request: GenerateImageRequest) => {
    assertGenerateImageRequest(request);

    const outputDirectory = getProjectGeneratedDirectory(requireActiveProjectDirectory());
    appLogger.info("Direct image generation IPC received", {
      context: `image:${request.sessionId}`,
      data: { imagePath: request.imagePath, size: request.size },
      publicMessage: "收到图片生成任务。"
    });

    try {
      const result = await generateProductImage(request, loadTuziConfig(outputDirectory), undefined, appLogger);

      return {
        ...result,
        sessionId: request.sessionId
      };
    } catch (error) {
      appLogger.error("Direct image generation failed", {
        context: `image:${request.sessionId}`,
        error,
        publicMessage: `图片生成失败：${toUserErrorMessage(error)}`
      });
      throw error;
    }
  });

  ipcMain.handle("images:save-reference", async (_event, request: SaveReferenceImageRequest) => {
    assertSaveReferenceImageRequest(request);

    const referenceDirectory = getProjectReferencesDirectory(requireActiveProjectDirectory());
    await mkdir(referenceDirectory, { recursive: true });

    const result = await saveReferenceImageToDirectory(request, referenceDirectory);
    appLogger.info("Reference image saved", {
      data: { fileName: result.fileName, filePath: result.filePath },
      publicMessage: `已添加参考图：${result.fileName}`
    });

    return result;
  });

  ipcMain.handle("chat:send-message", async (_event, request: SendChatMessageRequest) => {
    assertSendChatMessageRequest(request);

    const outputDirectory = getProjectGeneratedDirectory(requireActiveProjectDirectory());
    appLogger.info("Chat IPC received", {
      context: `chat:${request.sessionId}`,
      data: { imagePath: request.imagePath, messageCount: request.messages.length },
      publicMessage: "收到会话消息。"
    });

    try {
      const llmConfig = loadTuziLlmConfig();
      const result =
        llmConfig.chatAgent === "pi"
          ? await runPiImageToolChat(request, llmConfig, requireActiveProjectDirectory(), {
              generateImage: (toolRequest) => generateProductImage(toolRequest, loadTuziConfig(outputDirectory), undefined, appLogger),
              logger: appLogger
            })
          : await runImageToolChat(request, llmConfig, {
              fetch,
              generateImage: (toolRequest) => generateProductImage(toolRequest, loadTuziConfig(outputDirectory), undefined, appLogger),
              logger: appLogger
            });

      return {
        assistantMessage: result.content,
        generatedImagePath: result.generatedImage?.outputPath,
        remoteUrl: result.generatedImage?.remoteUrl,
        sessionId: request.sessionId
      };
    } catch (error) {
      appLogger.error("Chat request failed", {
        context: `chat:${request.sessionId}`,
        error,
        publicMessage: `会话失败：${toUserErrorMessage(error)}`
      });
      throw error;
    }
  });

  ipcMain.handle("logs:list", () => appLogger.getEntries());
}

function createLogger(): AppLogger {
  const logDirectory = path.join(app.getPath("userData"), "logs");
  const logFilePath = path.join(logDirectory, "batchimager.log");

  return createAppLogger({
    writeLine: async (line) => {
      await mkdir(logDirectory, { recursive: true });
      await appendFile(logFilePath, `${line}\n`, "utf8");
    }
  });
}

function assertGenerateImageRequest(request: GenerateImageRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    typeof request.imagePath !== "string" ||
    typeof request.prompt !== "string" ||
    typeof request.sessionId !== "string" ||
    (request.referenceImagePaths !== undefined &&
      (!Array.isArray(request.referenceImagePaths) ||
        !request.referenceImagePaths.every((referenceImagePath) => typeof referenceImagePath === "string"))) ||
    (request.size !== undefined && typeof request.size !== "string")
  ) {
    throw new Error("Invalid image generation request");
  }
}

function assertImportProjectImagesRequest(request: ImportProjectImagesRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    !Array.isArray(request.sourcePaths) ||
    !request.sourcePaths.every((sourcePath) => typeof sourcePath === "string")
  ) {
    throw new Error("Invalid project image import request");
  }
}

function assertSaveProjectSnapshotRequest(request: SaveProjectSnapshotRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    !Array.isArray(request.sessions) ||
    !request.sessions.every((session) => typeof session === "object" && session !== null && typeof session.id === "string") ||
    (request.selectedSessionId !== undefined &&
      request.selectedSessionId !== null &&
      typeof request.selectedSessionId !== "string")
  ) {
    throw new Error("Invalid project snapshot save request");
  }
}

function requireActiveProjectDirectory(): string {
  if (!activeProjectDirectory) {
    throw new Error("请先新建或打开项目");
  }

  return activeProjectDirectory;
}

function assertSaveReferenceImageRequest(request: SaveReferenceImageRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    !(request.data instanceof ArrayBuffer) ||
    typeof request.mimeType !== "string" ||
    (request.fileName !== undefined && typeof request.fileName !== "string")
  ) {
    throw new Error("Invalid reference image request");
  }
}

function assertSendChatMessageRequest(request: SendChatMessageRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    typeof request.imagePath !== "string" ||
    typeof request.sessionId !== "string" ||
    (request.outputSize !== undefined && typeof request.outputSize !== "string") ||
    (request.context !== undefined &&
      (typeof request.context !== "object" ||
        request.context === null ||
        (request.context.currentImageLabel !== undefined && typeof request.context.currentImageLabel !== "string") ||
        (request.context.fileName !== undefined && typeof request.context.fileName !== "string") ||
        (request.context.originalImageLabel !== undefined && typeof request.context.originalImageLabel !== "string") ||
        (request.context.previousGenerationPrompt !== undefined &&
          typeof request.context.previousGenerationPrompt !== "string") ||
        (request.context.referenceImageCount !== undefined && typeof request.context.referenceImageCount !== "number"))) ||
    (request.referenceImagePaths !== undefined &&
      (!Array.isArray(request.referenceImagePaths) ||
        !request.referenceImagePaths.every((referenceImagePath) => typeof referenceImagePath === "string"))) ||
    (request.referenceImages !== undefined &&
      (!Array.isArray(request.referenceImages) ||
        !request.referenceImages.every(
          (referenceImage) =>
            typeof referenceImage === "object" &&
            referenceImage !== null &&
            typeof referenceImage.filePath === "string" &&
            typeof referenceImage.id === "string" &&
            typeof referenceImage.label === "string" &&
            (referenceImage.pinned === undefined || typeof referenceImage.pinned === "boolean")
        ))) ||
    !Array.isArray(request.messages) ||
    !request.messages.every(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string"
    )
  ) {
    throw new Error("Invalid chat message request");
  }
}

app.whenReady().then(() => {
  logger = createLogger();
  logger.info("Application ready", {
    data: {
      isPackaged: app.isPackaged,
      userData: app.getPath("userData")
    },
    publicMessage: "应用已启动。"
  });
  registerImageProtocol();
  registerIpc(logger);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

function toUserErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "未知错误";
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
