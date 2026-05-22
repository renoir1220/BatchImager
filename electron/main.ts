import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, net, protocol } from "electron";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  CopyImageToClipboardRequest,
  CreatePlaceholderImageRequest,
  CreateProjectManagerPlanRequest,
  GenerateImageRequest,
  ImportProjectImagesRequest,
  OpenProjectRequest,
  RenameProjectRequest,
  SaveReferenceImageRequest,
  SaveProjectSnapshotRequest,
  SendChatMessageRequest,
  SendEsseMessageRequest
} from "./ipcTypes";
import { createAppLogger, type AppLogger } from "./services/appLogger";
import { createBlankGenerationSeed } from "./services/blankGenerationSeed";
import { runEsseAgentTurn } from "./services/esseAgent";
import { createImageGenerationExecutor, type ImageGenerationExecutor } from "./services/imageGenerationService";
import { packageGeneratedImages } from "./services/imagePackage";
import { loadTuziConfig, loadTuziLlmConfig } from "./services/localConfig";
import { saveReferenceImageToDirectory } from "./services/localImageStorage";
import { runImageToolChat } from "./services/openAiChatApi";
import { runPiImageToolChat, warmupPiImageToolChatDependencies } from "./services/piImageToolChat";
import { runProjectManagerPlanAgent } from "./services/projectManagerAgent";
import { listProjectCards } from "./services/projectList";
import { rememberProjectDirectory } from "./services/projectIndex";
import {
  markGenerationJobCompleted,
  markGenerationJobFailed,
  markGenerationJobRemoteReceived,
  recoverInterruptedGenerationJobs,
  startGenerationJob
} from "./services/generationRecovery";
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

const IMAGE_PROTOCOL = "batchimager-file";
let logger: AppLogger | undefined;
let activeProjectDirectory: string | undefined;
let confirmedRunningWorkClose = false;
let inFlightGenerationCount = 0;
let rendererRunningWorkCount = 0;

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

  mainWindow.on("close", (event) => {
    if (confirmedRunningWorkClose || getRunningWorkCount() === 0) {
      return;
    }

    const shouldClose = showRunningWorkCloseDialog(mainWindow, getRunningWorkCount());
    if (!shouldClose) {
      event.preventDefault();
      return;
    }

    confirmedRunningWorkClose = true;
  });
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
    await recoverProjectBeforeOpen(projectDirectory, appLogger);
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

  ipcMain.on("app:set-running-work-count", (_event, count: number) => {
    rendererRunningWorkCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  });

  ipcMain.handle("generation:generate-image", async (_event, request: GenerateImageRequest) => {
    assertGenerateImageRequest(request);

    appLogger.info("Direct image generation IPC received", {
      context: `image:${request.sessionId}`,
      data: { imagePath: request.imagePath, size: request.size },
      publicMessage: "收到图片生成任务。"
    });

    try {
      const generateImage = createProjectImageGenerationExecutor(requireActiveProjectDirectory(), appLogger);
      const result = await generateImage({ mode: "edit", ...request });

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

  ipcMain.handle("project-manager:create-plan", async (_event, request: CreateProjectManagerPlanRequest) => {
    assertCreateProjectManagerPlanRequest(request);
    const projectDirectory = requireActiveProjectDirectory();

    appLogger.info("Project manager plan IPC received", {
      context: "project-manager",
      data: {
        imageCount: request.sessions.length,
        outputSize: request.outputSize,
        referenceImageCount: request.referenceImagePaths?.length ?? 0
      },
      publicMessage: "正在生成批量方案..."
    });

    try {
      const plan = await runProjectManagerPlanAgent(request, loadTuziLlmConfig(), projectDirectory, { logger: appLogger });

      return { plan };
    } catch (error) {
      appLogger.error("Project manager plan request failed", {
        context: "project-manager",
        error,
        publicMessage: `方案生成失败：${toUserErrorMessage(error)}`
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

  ipcMain.handle("images:copy-to-clipboard", async (_event, request: CopyImageToClipboardRequest) => {
    assertCopyImageToClipboardRequest(request);

    const image = nativeImage.createFromPath(request.imagePath);
    if (image.isEmpty()) {
      throw new Error("无法复制这张图片。");
    }

    clipboard.writeImage(image);
    return { ok: true };
  });

  ipcMain.handle("images:create-placeholder", async (_event, request: CreatePlaceholderImageRequest) => {
    assertCreatePlaceholderImageRequest(request);
    const outputDirectory = getProjectGeneratedDirectory(requireActiveProjectDirectory());
    const filePath = await createBlankGenerationSeed({
      outputDirectory,
      sessionId: request.sessionId,
      size: request.size
    });

    appLogger.info("Placeholder image created", {
      context: `image:${request.sessionId}`,
      data: { filePath, size: request.size },
      publicMessage: "已创建图片占位。"
    });

    return { filePath };
  });

  ipcMain.handle("chat:send-message", async (_event, request: SendChatMessageRequest) => {
    assertSendChatMessageRequest(request);

    appLogger.info("Chat IPC received", {
      context: `chat:${request.sessionId}`,
      data: { imagePath: request.imagePath, messageCount: request.messages.length },
      publicMessage: "收到会话消息。"
    });

    try {
      const llmConfig = loadTuziLlmConfig();
      const generateImage = createProjectImageGenerationExecutor(requireActiveProjectDirectory(), appLogger);
      const result =
        llmConfig.chatAgent === "pi"
          ? await runPiImageToolChat(request, llmConfig, requireActiveProjectDirectory(), {
              generateImage: (toolRequest) =>
                request.generationMode === "generate"
                  ? generateImage({
                      mode: "generate",
                      prompt: toolRequest.prompt,
                      ...(toolRequest.referenceImagePaths?.length ? { referenceImagePaths: toolRequest.referenceImagePaths } : {}),
                      sessionId: toolRequest.sessionId,
                      ...(toolRequest.size ? { size: toolRequest.size } : {})
                    })
                  : generateImage({ mode: "edit", ...toolRequest }),
              logger: appLogger
            })
          : await runImageToolChat(request, llmConfig, {
              fetch,
              generateImage: (toolRequest) =>
                request.generationMode === "generate"
                  ? generateImage({
                      mode: "generate",
                      prompt: toolRequest.prompt,
                      ...(toolRequest.referenceImagePaths?.length ? { referenceImagePaths: toolRequest.referenceImagePaths } : {}),
                      sessionId: toolRequest.sessionId,
                      ...(toolRequest.size ? { size: toolRequest.size } : {})
                    })
                  : generateImage({ mode: "edit", ...toolRequest }),
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

  ipcMain.handle("esse:send-message", async (_event, request: SendEsseMessageRequest) => {
    assertSendEsseMessageRequest(request);
    const projectDirectory = requireActiveProjectDirectory();

    appLogger.info("Esse IPC received", {
      context: "esse-agent",
      data: {
        imageCount: request.sessions.length,
        messageCount: request.messages.length,
        outputSize: request.outputSize,
        persona: request.persona
      },
      publicMessage: "收到 Esse 消息。"
    });

    try {
      const result = await runEsseAgentTurn(request, loadTuziLlmConfig(), projectDirectory, { logger: appLogger });
      const fileResults = [];

      for (const fileTask of result.fileTasks ?? []) {
        if (fileTask.type !== "package" || fileTask.source !== "generated-images" || fileTask.destination !== "desktop") {
          continue;
        }

        const packaged = await packageGeneratedImages({
          desktopDirectory: app.getPath("desktop"),
          fileName: fileTask.fileName,
          imagePaths: collectGeneratedImagePaths(request.sessions)
        });

        fileResults.push({
          id: fileTask.id,
          outputPath: packaged.outputPath,
          type: "package" as const
        });
        appLogger.info("Esse file task completed", {
          context: "esse-agent",
          data: { outputPath: packaged.outputPath },
          publicMessage: "Esse 已将生成图片打包到桌面。"
        });
      }

      return {
        ...(fileResults.length ? { fileResults } : {}),
        ...(result.fileTasks?.length ? { fileTasks: result.fileTasks } : {}),
        ...(result.imageRequests?.length ? { imageRequests: result.imageRequests } : {}),
        ...(result.plan ? { plan: result.plan } : {}),
        reply: result.reply
      };
    } catch (error) {
      appLogger.error("Esse request failed", {
        context: "esse-agent",
        error,
        publicMessage: `Esse 处理失败：${toUserErrorMessage(error)}`
      });
      throw error;
    }
  });

  ipcMain.handle("logs:list", () => appLogger.getEntries());
}

function collectGeneratedImagePaths(sessions: SendEsseMessageRequest["sessions"]): string[] {
  const paths = new Set<string>();

  for (const session of sessions) {
    for (const generatedFilePath of session.generatedFilePaths ?? []) {
      paths.add(generatedFilePath);
    }
  }

  return [...paths];
}

function createProjectImageGenerationExecutor(projectDirectory: string, appLogger: AppLogger): ImageGenerationExecutor {
  const config = loadTuziConfig(getProjectGeneratedDirectory(projectDirectory));
  const generateImage = createImageGenerationExecutor(config, { logger: appLogger });

  return async (request) => {
    inFlightGenerationCount += 1;
    await startGenerationJob(projectDirectory, {
      imagePath: request.mode === "edit" ? request.imagePath : undefined,
      mode: request.mode,
      prompt: request.prompt,
      referenceImagePaths: request.referenceImagePaths,
      sessionId: request.sessionId,
      size: request.size
    });

    try {
      const result = await generateImage({
        ...request,
        onRemoteImage: (event) => markGenerationJobRemoteReceived(projectDirectory, event)
      });
      await markGenerationJobCompleted(projectDirectory, {
        outputPath: result.outputPath,
        sessionId: request.sessionId
      });
      return result;
    } catch (error) {
      await markGenerationJobFailed(projectDirectory, {
        errorMessage: toUserErrorMessage(error),
        sessionId: request.sessionId
      });
      throw error;
    } finally {
      inFlightGenerationCount = Math.max(0, inFlightGenerationCount - 1);
    }
  };
}

async function recoverProjectBeforeOpen(projectDirectory: string, appLogger: AppLogger): Promise<void> {
  try {
    const result = await recoverInterruptedGenerationJobs(projectDirectory, { fetch });

    if (result.completed > 0 || result.failed > 0) {
      appLogger.info("Interrupted image generations recovered", {
        data: { completed: result.completed, failed: result.failed, projectDirectory },
        publicMessage:
          result.failed > 0
            ? `已恢复 ${result.completed} 个生成任务，${result.failed} 个任务需要重试。`
            : `已恢复 ${result.completed} 个生成任务。`
      });
    }
  } catch (error) {
    appLogger.warn("Interrupted image generation recovery failed", {
      data: { projectDirectory },
      error,
      publicMessage: "恢复上次生成任务失败，请检查失败图片后重试。"
    });
  }
}

function getRunningWorkCount(): number {
  return Math.max(rendererRunningWorkCount, inFlightGenerationCount);
}

function showRunningWorkCloseDialog(window: BrowserWindow, runningWorkCount: number): boolean {
  const choice = dialog.showMessageBoxSync(window, {
    buttons: ["继续生成", "退出"],
    cancelId: 0,
    defaultId: 0,
    detail: `当前还有 ${runningWorkCount} 个任务正在处理。退出后，下次打开项目会尝试恢复；无法恢复的图片会显示重试按钮。`,
    message: "仍有图片正在生成，确定要退出吗？",
    noLink: true,
    type: "warning"
  });

  return choice === 1;
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

function assertCopyImageToClipboardRequest(request: CopyImageToClipboardRequest): void {
  if (typeof request !== "object" || request === null || typeof request.imagePath !== "string" || !request.imagePath.trim()) {
    throw new Error("Invalid copy image request");
  }
}

function assertSendChatMessageRequest(request: SendChatMessageRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    typeof request.imagePath !== "string" ||
    typeof request.sessionId !== "string" ||
    (request.outputSize !== undefined && typeof request.outputSize !== "string") ||
    (request.generationMode !== undefined && request.generationMode !== "edit" && request.generationMode !== "generate") ||
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

function assertSendEsseMessageRequest(request: SendEsseMessageRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    (request.outputSize !== undefined && typeof request.outputSize !== "string") ||
    (request.persona !== undefined && !isValidEssePersona(request.persona)) ||
    (request.selectedSessionId !== undefined && request.selectedSessionId !== null && typeof request.selectedSessionId !== "string") ||
    (request.referenceImagePaths !== undefined &&
      (!Array.isArray(request.referenceImagePaths) ||
        !request.referenceImagePaths.every((referenceImagePath) => typeof referenceImagePath === "string"))) ||
    !Array.isArray(request.messages) ||
    !request.messages.every(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string"
    ) ||
    !Array.isArray(request.sessions) ||
    !request.sessions.every(
      (session) =>
        typeof session === "object" &&
        session !== null &&
        typeof session.id === "string" &&
        typeof session.fileName === "string" &&
        (session.currentImagePath === undefined || typeof session.currentImagePath === "string") &&
        (session.generatedFilePaths === undefined ||
          (Array.isArray(session.generatedFilePaths) &&
            session.generatedFilePaths.every((generatedFilePath) => typeof generatedFilePath === "string")))
    )
  ) {
    throw new Error("Invalid Esse message request");
  }
}

function isValidEssePersona(value: unknown): boolean {
  return value === "old-ox" || value === "excellent-employee" || value === "question-girl" || value === "robot";
}

function assertCreatePlaceholderImageRequest(request: CreatePlaceholderImageRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    typeof request.sessionId !== "string" ||
    (request.size !== undefined && typeof request.size !== "string")
  ) {
    throw new Error("Invalid placeholder image request");
  }
}

function assertCreateProjectManagerPlanRequest(request: CreateProjectManagerPlanRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    typeof request.prompt !== "string" ||
    (request.outputSize !== undefined && typeof request.outputSize !== "string") ||
    (request.referenceImagePaths !== undefined &&
      (!Array.isArray(request.referenceImagePaths) ||
        !request.referenceImagePaths.every((referenceImagePath) => typeof referenceImagePath === "string"))) ||
    !Array.isArray(request.sessions) ||
    !request.sessions.every(
      (session) =>
        typeof session === "object" &&
        session !== null &&
        typeof session.id === "string" &&
        typeof session.fileName === "string"
    )
  ) {
    throw new Error("Invalid project manager plan request");
  }
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
