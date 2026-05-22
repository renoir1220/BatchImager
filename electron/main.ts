import { app, BrowserWindow, dialog, ipcMain, net, protocol } from "electron";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  GenerateImageRequest,
  ImportProjectImagesRequest,
  OpenProjectRequest,
  RenameProjectRequest,
  SaveReferenceImageRequest,
  SaveProjectSnapshotRequest,
  SendChatMessageRequest
} from "./ipcTypes";
import { createAppLogger, type AppLogger } from "./services/appLogger";
import { loadTuziConfig, loadTuziLlmConfig } from "./services/localConfig";
import { saveReferenceImageToDirectory } from "./services/localImageStorage";
import { runImageToolChat } from "./services/openAiChatApi";
import { runPiImageToolChat, warmupPiImageToolChatDependencies } from "./services/piImageToolChat";
import { listProjectCards } from "./services/projectList";
import { rememberProjectDirectory } from "./services/projectIndex";
import {
  createProject,
  getProjectGeneratedDirectory,
  getProjectReferencesDirectory,
  importImagesToProject,
  openProject,
  renameProject,
  saveProjectSnapshot
} from "./services/projectStore";
import { ensureProjectThumbnails } from "./services/projectThumbnails";
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
    const projectsDirectory = getProjectsDirectory();
    const snapshot = await createProject({ projectsDirectory });
    activeProjectDirectory = snapshot.project.directory;
    appLogger.info("Project created", {
      data: { projectDirectory: snapshot.project.directory, projectId: snapshot.project.id },
      publicMessage: "已新建项目。"
    });

    return snapshot;
  });

  ipcMain.handle("project:list", async () => {
    const entries = await listProjectCards(getProjectListOptions());
    void warmProjectThumbnailCaches(entries, appLogger);

    return entries;
  });

  ipcMain.handle("project:open", async (_event, request?: OpenProjectRequest) => {
    assertOpenProjectRequest(request);
    const projectDirectory = request?.directory ?? (await pickProjectDirectory("打开项目"));

    if (!projectDirectory) {
      appLogger.info("Open project canceled", { publicMessage: "已取消打开项目。" });
      return null;
    }

    await rememberProjectDirectory({
      indexFilePath: getProjectIndexFilePath(),
      projectDirectory
    });
    const snapshot = await openProject(projectDirectory);
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

  ipcMain.handle("project:remember-directory", async () => {
    const projectDirectory = await pickProjectDirectory("添加项目文件夹");

    if (!projectDirectory) {
      appLogger.info("Add project directory canceled", { publicMessage: "已取消添加项目。" });
      return null;
    }

    await rememberProjectDirectory({
      indexFilePath: getProjectIndexFilePath(),
      projectDirectory
    });
    const entries = await listProjectCards(getProjectListOptions());
    void warmProjectThumbnailCaches(entries, appLogger);
    appLogger.info("Project directory remembered", {
      data: { projectDirectory },
      publicMessage: "已添加项目文件夹。"
    });

    return entries;
  });

  ipcMain.handle("project:rename", async (_event, request: RenameProjectRequest) => {
    assertRenameProjectRequest(request);
    await renameProject(request.directory, request.name);
    const entries = await listProjectCards(getProjectListOptions());
    appLogger.info("Project renamed", {
      data: { projectDirectory: request.directory },
      publicMessage: "项目已重命名。"
    });

    return entries;
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

function getProjectsDirectory(): string {
  return path.join(app.getPath("userData"), "projects");
}

function getProjectIndexFilePath(): string {
  return path.join(app.getPath("userData"), "project-index.json");
}

function getProjectListOptions(): { indexFilePath: string; projectsDirectory: string } {
  return {
    indexFilePath: getProjectIndexFilePath(),
    projectsDirectory: getProjectsDirectory()
  };
}

async function pickProjectDirectory(title: string): Promise<string | null> {
  const projectsDirectory = getProjectsDirectory();
  await mkdir(projectsDirectory, { recursive: true });
  const result = await dialog.showOpenDialog({
    title,
    defaultPath: projectsDirectory,
    properties: ["openDirectory"]
  });

  return result.canceled ? null : result.filePaths[0] ?? null;
}

async function warmProjectThumbnailCaches(
  entries: Awaited<ReturnType<typeof listProjectCards>>,
  appLogger: AppLogger
): Promise<void> {
  for (const entry of entries) {
    if (!entry.summary || entry.thumbnailPaths.length >= entry.summary.previewSourcePaths.length) {
      continue;
    }

    try {
      await ensureProjectThumbnails(entry.directory, entry.summary.previewSourcePaths);
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send("project:thumbnails-updated", entry.directory);
      }
    } catch (error) {
      appLogger.warn("Project thumbnail cache warm failed", {
        data: { projectDirectory: entry.directory },
        error,
        publicMessage: "项目预览图生成失败。"
      });
    }
  }
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

function assertOpenProjectRequest(request: OpenProjectRequest | undefined): void {
  if (
    request !== undefined &&
    (typeof request !== "object" || request === null || (request.directory !== undefined && typeof request.directory !== "string"))
  ) {
    throw new Error("Invalid project open request");
  }
}

function assertRenameProjectRequest(request: RenameProjectRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    typeof request.directory !== "string" ||
    typeof request.name !== "string"
  ) {
    throw new Error("Invalid project rename request");
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
  warmupPiChat(logger);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

function warmupPiChat(appLogger: AppLogger): void {
  void warmupPiImageToolChatDependencies()
    .then(() => {
      appLogger.info("Pi chat dependencies warmed", {
        publicMessage: "Pi 会话引擎已预热。"
      });
    })
    .catch((error) => {
      appLogger.warn("Pi chat dependency warmup failed", {
        error,
        publicMessage: "Pi 会话引擎预热失败，将在首次使用时重试。"
      });
    });
}

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
