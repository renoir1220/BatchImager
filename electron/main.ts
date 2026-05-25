import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, net, protocol, screen, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AddEsseSkillPathRequest,
  AddEsseMemoryRequest,
  CancelOperationRequest,
  CancelEsseBatchTaskAllRequest,
  CancelEsseBatchTaskItemRequest,
  CopyImageToClipboardRequest,
  CreatePlaceholderImageRequest,
  DeleteProjectRequest,
  ExportImagesRequest,
  GenerateImageRequest,
  InstallEsseSkillFromGitRequest,
  ImportProjectImagesRequest,
  OpenProjectRequest,
  RemoveEsseMemoryRequest,
  RemoveEsseSkillRequest,
  RetryEsseBatchTaskFailedRequest,
  RetryEsseBatchTaskItemRequest,
  ReadEsseSkillFileRequest,
  RenameProjectRequest,
  SaveApiSettingsRequest,
  SaveReferenceImageRequest,
  SaveProjectSnapshotRequest,
  SendChatMessageRequest,
  SendEsseMessageRequest,
  EssePermissionResponse,
  EssePreflightResponse,
  ShowFileInFolderRequest,
  SetEsseSkillEnabledRequest,
  ProjectSnapshot
} from "./ipcTypes";
import { createAppLogger, type AppLogger } from "./services/appLogger";
import { createBatchImagerCommandPolicy } from "./services/agentCommandPolicy";
import { createEsseBashTool } from "./services/esseBashTool";
import { syncBuiltInSkills } from "./services/esseBuiltInSkills";
import { createBlankGenerationSeed } from "./services/blankGenerationSeed";
import { runEsseAgentTurn } from "./services/esseAgent";
import { EsseBatchTaskRegistry } from "./services/esseBatchTaskRegistry";
import { createEsseImagePreflightExecutor, retryEsseBatchTaskItem } from "./services/esseImagePreflightExecutor";
import { createEsseMemoryStore, type EsseMemoryStore } from "./services/esseMemoryStore";
import { createEssePackagePreflightExecutor } from "./services/essePackagePreflightExecutor";
import { EssePermissionBroker } from "./services/essePermissionBroker";
import { DEFAULT_ESSE_PERMISSION_POLICY } from "./services/essePermissionPolicy";
import { createProjectSnapshotWorkspaceRuntime } from "./services/esseWorkspaceRuntime";
import { EssePreflightBroker } from "./services/essePreflightBroker";
import { createEsseSkillLoader, type EsseSkillLoader } from "./services/esseSkillLoader";
import { installSkillFromGit } from "./services/esseSkillInstaller";
import {
  addEsseSkillPath,
  loadEsseSkillSettings,
  saveEsseSkillSettings,
  setEsseSkillEnabled,
  type EsseSkillSettings
} from "./services/esseSkillSettings";
import { createImageGenerationExecutor, type ImageGenerationExecutor } from "./services/imageGenerationService";
import { packageGeneratedImages } from "./services/imagePackage";
import { configureLocalConfig, getApiSettingsSnapshot, loadTuziConfig, loadTuziLlmConfig, saveApiSettings } from "./services/localConfig";
import { saveReferenceImageToDirectory } from "./services/localImageStorage";
import { runImageSessionAgent, warmupImageSessionAgentDependencies } from "./services/imageSessionAgent";
import { getSharedAgentRuntimeRegistry } from "./services/agentRuntimeRegistry";
import { deleteProject, listProjectCards } from "./services/projectList";
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
  applyProjectSnapshotMutation,
  getProjectGeneratedDirectory,
  getProjectReferencesDirectory,
  importImagesToProject,
  openProject,
  renameProject
} from "./services/projectStore";
import { ProjectMutationSinkRegistry } from "./services/projectMutationSink";
import { ensureProjectThumbnails } from "./services/projectThumbnails";
import { normalizePathForComparison } from "./services/pathUtils";

const IMAGE_PROTOCOL = "batchimager-file";
const APP_ICON_PATH = path.join(app.getAppPath(), "src", "assets", "app-icons", "batchimager-esse-os26-light.png");
const APP_ICON_WINDOWS_PATH = path.join(app.getAppPath(), "src", "assets", "app-icons", "batchimager-windows.ico");
const MACOS_TRAFFIC_LIGHT_POSITION = { x: 16, y: 16 };
const DEFAULT_WINDOW_MARGIN = 0;
const activeOperationControllers = new Map<string, AbortController>();
let logger: AppLogger | undefined;
let activeProjectDirectory: string | undefined;
let esseSkillLoader: EsseSkillLoader | undefined;
let esseSkillSettings: EsseSkillSettings = { disabledSkills: [], skillPaths: [] };
let esseMemoryStore: EsseMemoryStore | undefined;
let builtInSkillsReady: Promise<void> | undefined;
let confirmedRunningWorkClose = false;
let inFlightGenerationCount = 0;
let rendererRunningWorkCount = 0;
const projectSnapshotSinkRegistry = new ProjectMutationSinkRegistry<ProjectSnapshot>();
const esseBatchTaskRegistry = new EsseBatchTaskRegistry();
const essePermissionBroker = new EssePermissionBroker();
const essePreflightBroker = new EssePreflightBroker();

app.setName("Esse");
app.setPath("userData", path.join(app.getPath("appData"), "BatchImager"));
if (process.platform === "win32") {
  app.setAppUserModelId("com.batchimager.desktop");
}

function createWindow(): void {
  const appIcon = loadAppIcon();
  applyAppIcon(appIcon);
  const windowState = loadWindowState();

  const mainWindow = new BrowserWindow({
    ...windowState.bounds,
    minWidth: 1024,
    minHeight: 700,
    title: "Esse",
    icon: appIcon,
    backgroundColor: "#f4f4f2",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? MACOS_TRAFFIC_LIGHT_POSITION : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:15173";

  if (app.isPackaged) {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  } else {
    void mainWindow.loadURL(devServerUrl);
  }

  mainWindow.on("close", (event) => {
    if (confirmedRunningWorkClose || getRunningWorkCount() === 0) {
      saveWindowState(mainWindow);
      return;
    }

    const shouldClose = showRunningWorkCloseDialog(mainWindow, getRunningWorkCount());
    if (!shouldClose) {
      event.preventDefault();
      return;
    }

    confirmedRunningWorkClose = true;
    saveWindowState(mainWindow);
  });
}

interface WindowState {
  bounds: Electron.Rectangle;
  isMaximized?: boolean;
}

function loadWindowState(): WindowState {
  const savedState = readSavedWindowState();
  if (savedState && isWindowBoundsVisible(savedState.bounds)) {
    return savedState;
  }

  const workArea = screen.getPrimaryDisplay().workArea;
  return {
    bounds: {
      height: Math.max(700, workArea.height - DEFAULT_WINDOW_MARGIN * 2),
      width: Math.max(1024, workArea.width - DEFAULT_WINDOW_MARGIN * 2),
      x: workArea.x + DEFAULT_WINDOW_MARGIN,
      y: workArea.y + DEFAULT_WINDOW_MARGIN
    }
  };
}

function readSavedWindowState(): WindowState | null {
  try {
    const parsed = JSON.parse(readFileSync(getWindowStateFilePath(), "utf8")) as Partial<WindowState>;
    if (!isValidWindowBounds(parsed.bounds)) {
      return null;
    }

    return {
      bounds: parsed.bounds,
      ...(parsed.isMaximized ? { isMaximized: true } : {})
    };
  } catch {
    return null;
  }
}

function saveWindowState(window: BrowserWindow): void {
  const state: WindowState = {
    bounds: window.isMaximized() ? window.getNormalBounds() : window.getBounds(),
    ...(window.isMaximized() ? { isMaximized: true } : {})
  };

  try {
    mkdirSync(path.dirname(getWindowStateFilePath()), { recursive: true });
    writeFileSync(getWindowStateFilePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (error) {
    logger?.warn("Window state save failed", { error });
  }
}

function getWindowStateFilePath(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function isValidWindowBounds(bounds: unknown): bounds is Electron.Rectangle {
  return Boolean(
    bounds &&
      typeof bounds === "object" &&
      typeof (bounds as Partial<Electron.Rectangle>).x === "number" &&
      typeof (bounds as Partial<Electron.Rectangle>).y === "number" &&
      typeof (bounds as Partial<Electron.Rectangle>).width === "number" &&
      typeof (bounds as Partial<Electron.Rectangle>).height === "number" &&
      (bounds as Partial<Electron.Rectangle>).width! >= 1024 &&
      (bounds as Partial<Electron.Rectangle>).height! >= 700
  );
}

function isWindowBoundsVisible(bounds: Electron.Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
}

function loadAppIcon(): Electron.NativeImage | undefined {
  const iconPath = process.platform === "win32" ? APP_ICON_WINDOWS_PATH : APP_ICON_PATH;

  if (!existsSync(iconPath)) {
    return undefined;
  }

  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? undefined : image;
}

function applyAppIcon(icon: Electron.NativeImage | undefined): void {
  if (!icon) {
    return;
  }

  if (process.platform === "darwin") {
    app.dock?.setIcon(icon);
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.setIcon(icon);
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
    // 切换到新项目前，丢弃所有缓存的 agent runtime（它们绑在旧项目目录上）。
    getSharedAgentRuntimeRegistry().invalidateAll();
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
    // 切到新项目，丢弃旧项目的 agent runtime 缓存。
    getSharedAgentRuntimeRegistry().invalidateAll();
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

  ipcMain.handle("project:delete", async (_event, request: DeleteProjectRequest) => {
    assertDeleteProjectRequest(request);
    const entries = await deleteProject({
      ...getProjectListOptions(),
      projectDirectory: request.directory
    });

    if (activeProjectDirectory && normalizePathForComparison(activeProjectDirectory) === normalizePathForComparison(request.directory)) {
      getSharedAgentRuntimeRegistry().invalidateAll();
      activeProjectDirectory = undefined;
    }

    appLogger.info("Project deleted", {
      data: { projectDirectory: request.directory },
      publicMessage: "项目已删除。"
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
    return getProjectSnapshotSink(requireActiveProjectDirectory()).apply((snapshot) => ({
      ...snapshot,
      esseUndoLog: request.esseUndoLog ?? snapshot.esseUndoLog,
      projectManagerState: request.projectManagerState,
      referenceImages: request.referenceImages ?? snapshot.referenceImages,
      selectedSessionId: request.selectedSessionId,
      sessions: request.sessions
    }));
  });

  ipcMain.on("app:set-running-work-count", (_event, count: number) => {
    rendererRunningWorkCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  });

  ipcMain.handle("app:cancel-operation", (_event, request: CancelOperationRequest) => {
    assertCancelOperationRequest(request);
    const controller = activeOperationControllers.get(request.operationId);

    if (!controller) {
      return { canceled: false };
    }

    controller.abort();
    appLogger.info("Operation canceled", {
      data: { operationId: request.operationId },
      publicMessage: "已停止当前任务。"
    });

    return { canceled: true };
  });

  ipcMain.handle("settings:get-api", () => getApiSettingsSnapshot());

  ipcMain.handle("settings:save-api", async (_event, request: SaveApiSettingsRequest) => {
    assertSaveApiSettingsRequest(request);
    const snapshot = await saveApiSettings(request);
    getSharedAgentRuntimeRegistry().invalidateAll();
    appLogger.info("API settings saved", {
      data: {
        imageBaseUrl: snapshot.imageBaseUrl,
        imageModel: snapshot.imageModel,
        llmBaseUrl: snapshot.llmBaseUrl,
        llmModel: snapshot.llmModel
      },
      publicMessage: "API 设置已保存。"
    });
    return snapshot;
  });

  ipcMain.handle("files:show-in-folder", (_event, request: ShowFileInFolderRequest) => {
    assertShowFileInFolderRequest(request);
    shell.showItemInFolder(request.filePath);
    return { ok: true };
  });

  ipcMain.handle("esse:skills-list", async () => buildEsseSkillsSnapshot(true));

  ipcMain.handle("esse:skills-reload", async () => buildEsseSkillsSnapshot(true));

  ipcMain.handle("esse:skills-set-enabled", async (_event, request: SetEsseSkillEnabledRequest) => {
    assertSetEsseSkillEnabledRequest(request);
    esseSkillSettings = await saveEsseSkillSettings(
      getEsseSkillSettingsPath(),
      setEsseSkillEnabled(esseSkillSettings, request.name, request.enabled)
    );
    await esseSkillLoader?.reload();
    return buildEsseSkillsSnapshot(true);
  });

  ipcMain.handle("esse:skills-add-path", async (_event, request: AddEsseSkillPathRequest) => {
    assertAddEsseSkillPathRequest(request);
    esseSkillSettings = await saveEsseSkillSettings(
      getEsseSkillSettingsPath(),
      addEsseSkillPath(esseSkillSettings, request.path)
    );
    await esseSkillLoader?.reload();
    return buildEsseSkillsSnapshot(true);
  });

  ipcMain.handle("esse:skills-install-git", async (_event, request: InstallEsseSkillFromGitRequest) => {
    assertInstallEsseSkillFromGitRequest(request);
    const result = await installSkillFromGit({
      gitUrl: request.gitUrl,
      logger: appLogger,
      targetDir: getEsseSkillsDirectory()
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    await esseSkillLoader?.reload();
    return buildEsseSkillsSnapshot(true);
  });

  ipcMain.handle("esse:skills-remove", async (_event, request: RemoveEsseSkillRequest) => {
    assertRemoveEsseSkillRequest(request);
    const skill = (await buildEsseSkillsSnapshot(true)).skills.find((candidate) => candidate.name === request.name);
    if (!skill) {
      throw new Error("Skill not found");
    }
    if (skill.source !== "global" && skill.source !== "project") {
      throw new Error("只能移除全局或项目级 Skill");
    }
    await rm(skill.baseDir, { force: true, recursive: true });
    await esseSkillLoader?.reload();
    return buildEsseSkillsSnapshot(true);
  });

  ipcMain.handle("esse:skills-read-file", async (_event, request: ReadEsseSkillFileRequest) => {
    assertReadEsseSkillFileRequest(request);
    const skill = (await buildEsseSkillsSnapshot(true)).skills.find((candidate) => candidate.name === request.name);
    if (!skill) {
      throw new Error("Skill not found");
    }
    return {
      content: await readFile(skill.filePath, "utf8"),
      filePath: skill.filePath
    };
  });

  ipcMain.handle("esse:memory-list", async () => buildEsseMemorySnapshot());

  ipcMain.handle("esse:memory-add", async (_event, request: AddEsseMemoryRequest) => {
    assertAddEsseMemoryRequest(request);
    const store = getEsseMemoryStore();
    const result = await store.add({
      category: request.category,
      content: request.content
    });
    const snapshot = await buildEsseMemorySnapshot();
    if ("conflictsWith" in result) {
      return {
        conflict: {
          conflictsWith: result.conflictsWith,
          similarity: result.similarity,
          suggestedNext: result.suggestedNext
        },
        snapshot
      };
    }
    appLogger.info("Esse memory added", {
      data: { category: result.category, id: result.id },
      publicMessage: "全局记忆已保存。"
    });
    return { snapshot };
  });

  ipcMain.handle("esse:memory-remove", async (_event, request: RemoveEsseMemoryRequest) => {
    assertRemoveEsseMemoryRequest(request);
    const result = await getEsseMemoryStore().remove(request.id);
    if (result.removed) {
      appLogger.info("Esse memory removed", {
        data: { category: result.removed.category, id: result.removed.id },
        publicMessage: "全局记忆已删除。"
      });
    }
    return buildEsseMemorySnapshot();
  });

  ipcMain.handle("generation:generate-image", async (_event, request: GenerateImageRequest) => {
    assertGenerateImageRequest(request);

    appLogger.info("Direct image generation IPC received", {
      context: `image:${request.sessionId}`,
      data: { imagePath: request.imagePath, size: request.size },
      publicMessage: "收到图片生成任务。"
    });

    try {
      const result = await withCancelableOperation(request.operationId, async (signal) => {
        const generateImage = createProjectImageGenerationExecutor(requireActiveProjectDirectory(), appLogger, signal);
        return await generateImage({ mode: "edit", ...request });
      });

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

  ipcMain.handle("images:copy-to-clipboard", async (_event, request: CopyImageToClipboardRequest) => {
    assertCopyImageToClipboardRequest(request);

    const image = nativeImage.createFromPath(request.imagePath);
    if (image.isEmpty()) {
      throw new Error("无法复制这张图片。");
    }

    clipboard.writeImage(image);
    return { ok: true };
  });

  ipcMain.handle("images:export", async (_event, request: ExportImagesRequest) => {
    assertExportImagesRequest(request);

    const result = await packageGeneratedImages({
      desktopDirectory: app.getPath("desktop"),
      fileName: request.fileName ?? "Esse-导出图片.zip",
      imagePaths: request.imagePaths
    });

    appLogger.info("Workspace images exported", {
      data: { imageCount: request.imagePaths.length, outputPath: result.outputPath },
      publicMessage: `已导出 ${request.imagePaths.length} 张图片。`
    });

    return { outputPath: result.outputPath };
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

  ipcMain.handle("chat:send-message", async (ipcEvent, request: SendChatMessageRequest) => {
    assertSendChatMessageRequest(request);

    appLogger.info("Chat IPC received", {
      context: `chat:${request.sessionId}`,
      data: { imagePath: request.imagePath, messageCount: request.messages.length },
      publicMessage: "收到会话消息。"
    });

    try {
      const result = await withCancelableOperation(request.operationId, async (signal) => {
        const llmConfig = loadTuziLlmConfig();
        const generateImage = createProjectImageGenerationExecutor(requireActiveProjectDirectory(), appLogger, signal);
        return await runImageSessionAgent(request, llmConfig, requireActiveProjectDirectory(), {
          generateImage: (toolRequest) => {
            ipcEvent.sender.send("chat:image-generation-started", {
              prompt: toolRequest.prompt,
              ...(toolRequest.referenceImagePaths?.length ? { referenceImagePaths: toolRequest.referenceImagePaths } : {}),
              sessionId: toolRequest.sessionId,
              sourceImagePath: toolRequest.imagePath
            });

            return toolRequest.mode === "generate"
              ? generateImage({
                  imagePath: toolRequest.imagePath,
                  mode: "generate",
                  prompt: toolRequest.prompt,
                  ...(toolRequest.referenceImagePaths?.length ? { referenceImagePaths: toolRequest.referenceImagePaths } : {}),
                  sessionId: toolRequest.sessionId,
                  ...(toolRequest.size ? { size: toolRequest.size } : {})
                })
              : generateImage({ ...toolRequest, mode: "edit" });
          },
          logger: appLogger,
          signal
        });
      });

      return {
        assistantMessage: result.content,
        generationMode: result.generatedMode,
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

  ipcMain.handle("esse:send-message", async (event, request: SendEsseMessageRequest) => {
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
      const result = await withCancelableOperation(request.operationId, async (signal) => {
        const permissionAllowList = new Set<string>();
        const skillLoader = requireEsseSkillLoader();
        await skillLoader.reload();
        const bashTool = await createEsseBashTool({
          commandPolicy: createBatchImagerCommandPolicy({ projectDirectory }),
          permissionBroker: essePermissionBroker,
          projectDirectory,
          sessionAllowList: permissionAllowList,
          sessionId: "esse-agent",
          signal,
          skillLoader,
          userDataDirectory: app.getPath("userData"),
          webContents: event.sender
        });
        const workspaceToolRuntime = createProjectSnapshotWorkspaceRuntime({
          executeImagePreflightTool: createEsseImagePreflightExecutor({
            batchTaskRegistry: esseBatchTaskRegistry,
            generateImage: createProjectImageGenerationExecutor(projectDirectory, appLogger),
            projectDirectory
          }),
          executePackagePreflightTool: createEssePackagePreflightExecutor({
            desktopDirectory: app.getPath("desktop"),
            packageGeneratedImages
          }),
          initialSnapshot: await openProject(projectDirectory),
          memoryStore: getEsseMemoryStore(),
          recordToolCalls: true,
          requestPermission: (payload) =>
            essePermissionBroker.request(event.sender, payload, {
              policy: DEFAULT_ESSE_PERMISSION_POLICY,
              sessionAllowList: permissionAllowList,
              signal
            }),
          requestPreflight: (payload) => essePreflightBroker.request(event.sender, payload, { signal }),
          getTurnReferenceImagePaths: () => request.referenceImagePaths ?? [],
          sink: getProjectSnapshotSink(projectDirectory)
        });

        return await runEsseAgentTurn(request, loadTuziLlmConfig(), projectDirectory, {
          bashTool,
          logger: appLogger,
          onAssistantMessageUpdate: (content) => {
            event.sender.send("esse:assistant-message-update", {
              content,
              ...(request.operationId ? { operationId: request.operationId } : {})
            });
          },
          signal,
          skillLoader,
          workspaceToolRuntime
        });
      });

      return {
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

  ipcMain.handle("esse:preflight-response", async (_event, response: EssePreflightResponse) => {
    assertEssePreflightResponse(response);
    const accepted = essePreflightBroker.respond(response);
    if (accepted) {
      await markEssePreflightDecision(requireActiveProjectDirectory(), response);
    }
    return { accepted };
  });

  ipcMain.handle("esse:permission-response", async (_event, response: EssePermissionResponse) => {
    assertEssePermissionResponse(response);
    const accepted = essePermissionBroker.respond(response);
    if (accepted) {
      await markEssePermissionDecision(requireActiveProjectDirectory(), response);
    }
    return { accepted };
  });

  ipcMain.handle("esse:batch-task-cancel-item", (_event, request: CancelEsseBatchTaskItemRequest) => {
    assertCancelEsseBatchTaskItemRequest(request);
    const result = esseBatchTaskRegistry.cancelItem(request.batchTaskId, request.sessionId);
    if (result.canceled) {
      appLogger.info("Esse batch task item canceled", {
        context: `esse-batch:${request.batchTaskId}`,
        data: { sessionId: request.sessionId },
        publicMessage: "已取消这张图的生成。"
      });
    }
    return { canceled: result.canceled };
  });

  ipcMain.handle("esse:batch-task-cancel-all", (_event, request: CancelEsseBatchTaskAllRequest) => {
    assertCancelEsseBatchTaskAllRequest(request);
    const result = esseBatchTaskRegistry.cancelAll(request.batchTaskId);
    if (result.canceledCount > 0) {
      appLogger.info("Esse batch task canceled", {
        context: `esse-batch:${request.batchTaskId}`,
        data: { canceledCount: result.canceledCount },
        publicMessage: `已取消 ${result.canceledCount} 个生成任务。`
      });
    }
    return result;
  });

  ipcMain.handle("esse:batch-task-retry-item", async (_event, request: RetryEsseBatchTaskItemRequest) => {
    assertRetryEsseBatchTaskItemRequest(request);
    const projectDirectory = requireActiveProjectDirectory();
    const result = await retryEsseBatchTaskItem(
      request,
      {
        batchTaskRegistry: esseBatchTaskRegistry,
        generateImage: createProjectImageGenerationExecutor(projectDirectory, appLogger),
        projectDirectory
      },
      await createRetryWorkspaceRuntime(projectDirectory)
    );
    if (result.accepted) {
      appLogger.info("Esse batch task item retry accepted", {
        context: `esse-batch:${request.batchTaskId}`,
        data: { retryCount: result.retryCount, sessionId: request.sessionId },
        publicMessage: "已重新提交这张图。"
      });
    }
    return result;
  });

  ipcMain.handle("esse:batch-task-retry-failed", async (_event, request: RetryEsseBatchTaskFailedRequest) => {
    assertRetryEsseBatchTaskFailedRequest(request);
    const projectDirectory = requireActiveProjectDirectory();
    const runtime = await createRetryWorkspaceRuntime(projectDirectory);
    const snapshot = runtime.getState();
    const failedSessionIds = findBatchTaskFailedSessionIds(snapshot, request.batchTaskId);
    const rejected: Array<{ reason: string; sessionId: string }> = [];
    let acceptedCount = 0;
    for (const sessionId of failedSessionIds) {
      const result = await retryEsseBatchTaskItem(
        { batchTaskId: request.batchTaskId, sessionId },
        {
          batchTaskRegistry: esseBatchTaskRegistry,
          generateImage: createProjectImageGenerationExecutor(projectDirectory, appLogger),
          projectDirectory
        },
        runtime
      );
      if (result.accepted) {
        acceptedCount += 1;
      } else {
        rejected.push({ reason: result.reason, sessionId });
      }
    }
    if (acceptedCount > 0) {
      appLogger.info("Esse batch task failed items retry accepted", {
        context: `esse-batch:${request.batchTaskId}`,
        data: { acceptedCount, rejectedCount: rejected.length },
        publicMessage: `已重新提交 ${acceptedCount} 个失败任务。`
      });
    }
    return { acceptedCount, rejected };
  });

  ipcMain.handle("logs:list", () => appLogger.getEntries());
}

async function createRetryWorkspaceRuntime(projectDirectory: string) {
  return createProjectSnapshotWorkspaceRuntime({
    initialSnapshot: await openProject(projectDirectory),
    sink: getProjectSnapshotSink(projectDirectory)
  });
}

async function markEssePreflightDecision(projectDirectory: string, response: EssePreflightResponse): Promise<void> {
  await getProjectSnapshotSink(projectDirectory).apply((snapshot) => ({
    ...snapshot,
    projectManagerState: snapshot.projectManagerState
      ? {
          ...snapshot.projectManagerState,
          conversation: {
            ...snapshot.projectManagerState.conversation,
            messages: snapshot.projectManagerState.conversation.messages.map((message) =>
              message.preflightRequest?.requestId === response.requestId
                ? { ...message, preflightDecision: response.decision }
                : message
            )
          }
        }
      : snapshot.projectManagerState
  }), { countRevision: false });
}

async function markEssePermissionDecision(projectDirectory: string, response: EssePermissionResponse): Promise<void> {
  await getProjectSnapshotSink(projectDirectory).apply((snapshot) => ({
    ...snapshot,
    projectManagerState: snapshot.projectManagerState
      ? {
          ...snapshot.projectManagerState,
          conversation: {
            ...snapshot.projectManagerState.conversation,
            messages: snapshot.projectManagerState.conversation.messages.map((message) =>
              message.permissionRequest?.requestId === response.requestId
                ? { ...message, permissionDecision: response.decision }
                : message
            )
          }
        }
      : snapshot.projectManagerState
  }), { countRevision: false });
}

function findBatchTaskFailedSessionIds(snapshot: ProjectSnapshot, batchTaskId: string): string[] {
  const sessionsById = new Map(snapshot.sessions.map((session) => [session.id, session]));
  const batchTask = snapshot.projectManagerState?.conversation.messages.find(
    (message) => message.batchTask?.batchTaskId === batchTaskId
  )?.batchTask;
  if (!batchTask) {
    return [];
  }

  return batchTask.items
    .filter((item) => sessionsById.get(item.sessionId)?.status === "failed")
    .map((item) => item.sessionId);
}

function getProjectSnapshotSink(projectDirectory: string) {
  return projectSnapshotSinkRegistry.getOrCreate(normalizePathForComparison(projectDirectory), {
    applyTransaction: (mutator) =>
      applyProjectSnapshotMutation(projectDirectory, (snapshot) => {
        const next = mutator(snapshot);
        return {
          projectManagerState: next.projectManagerState,
          selectedSessionId: next.selectedSessionId,
          sessions: next.sessions
        };
      }),
    broadcast: broadcastProjectSnapshot,
    onBroadcastError: (error, snapshot) => {
      logger?.warn("Project snapshot broadcast failed", {
        context: "project-mutation-sink",
        data: {
          imageCount: snapshot.sessions.length,
          projectDirectory: snapshot.project.directory
        },
        error
      });
    }
  });
}

function broadcastProjectSnapshot(snapshot: ProjectSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("project:snapshot-updated", snapshot);
  }
}

async function withCancelableOperation<T>(
  operationId: string | undefined,
  run: (signal: AbortSignal | undefined) => Promise<T>
): Promise<T> {
  if (!operationId) {
    return await run(undefined);
  }

  const controller = new AbortController();
  activeOperationControllers.set(operationId, controller);

  try {
    return await run(controller.signal);
  } finally {
    if (activeOperationControllers.get(operationId) === controller) {
      activeOperationControllers.delete(operationId);
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("操作已停止");
  }
}

function createProjectImageGenerationExecutor(
  projectDirectory: string,
  appLogger: AppLogger,
  signal?: AbortSignal
): ImageGenerationExecutor {
  const config = loadTuziConfig(getProjectGeneratedDirectory(projectDirectory));
  const generateImage = createImageGenerationExecutor(config, { logger: appLogger });

  return async (request) => {
    const linkedSignal = linkAbortSignals(signal, request.signal);
    throwIfAborted(linkedSignal.signal);
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
      throwIfAborted(linkedSignal.signal);
      const result = await generateImage({
        ...request,
        ...(linkedSignal.signal ? { signal: linkedSignal.signal } : {}),
        onRemoteImage: (event) => markGenerationJobRemoteReceived(projectDirectory, event)
      });
      throwIfAborted(linkedSignal.signal);
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
      linkedSignal.cleanup();
      inFlightGenerationCount = Math.max(0, inFlightGenerationCount - 1);
    }
  };
}

function linkAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): { cleanup: () => void; signal?: AbortSignal } {
  const activeSignals = signals.filter((current): current is AbortSignal => Boolean(current));
  if (activeSignals.length <= 1) {
    return { cleanup: () => undefined, signal: activeSignals[0] };
  }

  const controller = new AbortController();
  const abortLinkedSignal = () => {
    controller.abort();
  };
  const cleanupCallbacks: Array<() => void> = [];
  for (const activeSignal of activeSignals) {
    if (activeSignal.aborted) {
      abortLinkedSignal();
      continue;
    }

    activeSignal.addEventListener("abort", abortLinkedSignal, { once: true });
    cleanupCallbacks.push(() => activeSignal.removeEventListener("abort", abortLinkedSignal));
  }

  return {
    cleanup: () => {
      for (const cleanup of cleanupCallbacks) {
        cleanup();
      }
    },
    signal: controller.signal
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

function getEsseSkillsDirectory(): string {
  return path.join(app.getPath("userData"), "esse-skills");
}

function getBuiltInSkillsTargetDirectory(): string {
  return path.join(getEsseSkillsDirectory(), "_built-in");
}

function getBuiltInSkillsSourceDirectory(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "built-in-skills")
    : path.join(app.getAppPath(), "resources", "built-in-skills");
}

function getEsseSkillSettingsPath(): string {
  return path.join(app.getPath("userData"), "esse-settings.json");
}

function getEsseMemoryFilePath(): string {
  return path.join(app.getPath("userData"), "esse-memory.md");
}

function getEsseMemoryStore(): EsseMemoryStore {
  esseMemoryStore ??= createEsseMemoryStore(getEsseMemoryFilePath());
  return esseMemoryStore;
}

function createAppEsseSkillLoader(options: { includeDisabled?: boolean } = {}): EsseSkillLoader {
  return createEsseSkillLoader({
    agentDir: getEsseSkillsDirectory(),
    builtInSkillsDir: getBuiltInSkillsTargetDirectory(),
    getDisabledSkills: options.includeDisabled ? () => [] : () => esseSkillSettings.disabledSkills,
    getProjectDirectory: () => activeProjectDirectory,
    getUserPaths: () => esseSkillSettings.skillPaths
  });
}

function requireEsseSkillLoader(): EsseSkillLoader {
  if (!esseSkillLoader) {
    throw new Error("Esse skills are not ready");
  }

  return esseSkillLoader;
}

async function buildEsseSkillsSnapshot(forceReload: boolean) {
  if (builtInSkillsReady) {
    await builtInSkillsReady;
  }
  const loader = forceReload ? createAppEsseSkillLoader({ includeDisabled: true }) : requireEsseSkillLoader();
  const loadResult = forceReload ? await loader.reload() : { diagnostics: [], skills: loader.list() };
  const disabled = new Set(esseSkillSettings.disabledSkills);

  return {
    diagnostics: loadResult.diagnostics.map((diagnostic) => ({
      message: diagnostic.message,
      ...(diagnostic.path ? { path: diagnostic.path } : {}),
      type: diagnostic.type
    })),
    disabledSkills: [...esseSkillSettings.disabledSkills],
    skillPaths: [...esseSkillSettings.skillPaths],
    skills: loadResult.skills.map((skill) => ({
      ...skill,
      enabled: !disabled.has(skill.name)
    }))
  };
}

async function buildEsseMemorySnapshot() {
  const store = getEsseMemoryStore();
  return {
    categories: ["用户偏好", "默认约束", "工作流惯例"],
    entries: await store.list(),
    filePath: store.getFilePath()
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
    (request.operationId !== undefined && typeof request.operationId !== "string") ||
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

function assertCancelOperationRequest(request: CancelOperationRequest): void {
  if (typeof request !== "object" || request === null || typeof request.operationId !== "string" || !request.operationId.trim()) {
    throw new Error("Invalid cancel operation request");
  }
}

function assertSetEsseSkillEnabledRequest(request: SetEsseSkillEnabledRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    typeof request.name !== "string" ||
    !request.name.trim() ||
    typeof request.enabled !== "boolean"
  ) {
    throw new Error("Invalid Esse skill enabled request");
  }
}

function assertAddEsseSkillPathRequest(request: AddEsseSkillPathRequest): void {
  if (typeof request !== "object" || request === null || typeof request.path !== "string" || !request.path.trim()) {
    throw new Error("Invalid Esse skill path request");
  }
}

function assertInstallEsseSkillFromGitRequest(request: InstallEsseSkillFromGitRequest): void {
  if (typeof request !== "object" || request === null || typeof request.gitUrl !== "string" || !request.gitUrl.trim()) {
    throw new Error("Invalid Esse skill git install request");
  }
}

function assertRemoveEsseSkillRequest(request: RemoveEsseSkillRequest): void {
  if (typeof request !== "object" || request === null || typeof request.name !== "string" || !request.name.trim()) {
    throw new Error("Invalid Esse skill remove request");
  }
}

function assertReadEsseSkillFileRequest(request: ReadEsseSkillFileRequest): void {
  if (typeof request !== "object" || request === null || typeof request.name !== "string" || !request.name.trim()) {
    throw new Error("Invalid Esse skill read request");
  }
}

function assertAddEsseMemoryRequest(request: AddEsseMemoryRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    typeof request.content !== "string" ||
    !request.content.trim() ||
    request.content.length > 200 ||
    (request.category !== undefined && request.category !== "用户偏好" && request.category !== "默认约束" && request.category !== "工作流惯例")
  ) {
    throw new Error("Invalid Esse memory add request");
  }
}

function assertRemoveEsseMemoryRequest(request: RemoveEsseMemoryRequest): void {
  if (typeof request !== "object" || request === null || typeof request.id !== "string" || !request.id.trim()) {
    throw new Error("Invalid Esse memory remove request");
  }
}

function assertSaveApiSettingsRequest(request: SaveApiSettingsRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    (request.activeImageApiProfileId !== undefined &&
      request.activeImageApiProfileId !== "primary" &&
      request.activeImageApiProfileId !== "secondary") ||
    typeof request.imageBaseUrl !== "string" ||
    !request.imageBaseUrl.trim() ||
    typeof request.imageModel !== "string" ||
    !request.imageModel.trim() ||
    typeof request.llmBaseUrl !== "string" ||
    !request.llmBaseUrl.trim() ||
    typeof request.llmModel !== "string" ||
    !request.llmModel.trim() ||
    (request.imageApiKey !== undefined && typeof request.imageApiKey !== "string") ||
    (request.llmApiKey !== undefined && typeof request.llmApiKey !== "string")
  ) {
    throw new Error("Invalid API settings request");
  }

  if (
    request.imageApiProfiles !== undefined &&
    (!Array.isArray(request.imageApiProfiles) ||
      request.imageApiProfiles.length === 0 ||
      request.imageApiProfiles.some(
        (profile) =>
          typeof profile !== "object" ||
          profile === null ||
          (profile.id !== "primary" && profile.id !== "secondary") ||
          typeof profile.name !== "string" ||
          typeof profile.baseUrl !== "string" ||
          !profile.baseUrl.trim() ||
          typeof profile.model !== "string" ||
          !profile.model.trim() ||
          typeof profile.llmBaseUrl !== "string" ||
          !profile.llmBaseUrl.trim() ||
          typeof profile.llmModel !== "string" ||
          !profile.llmModel.trim() ||
          (profile.apiKey !== undefined && typeof profile.apiKey !== "string") ||
          (profile.llmApiKey !== undefined && typeof profile.llmApiKey !== "string")
      ))
  ) {
    throw new Error("Invalid API settings request");
  }
}

function assertShowFileInFolderRequest(request: ShowFileInFolderRequest): void {
  if (typeof request !== "object" || request === null || typeof request.filePath !== "string" || !request.filePath.trim()) {
    throw new Error("Invalid file show request");
  }
}

function assertCancelEsseBatchTaskItemRequest(request: CancelEsseBatchTaskItemRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    typeof request.batchTaskId !== "string" ||
    !request.batchTaskId.trim() ||
    typeof request.sessionId !== "string" ||
    !request.sessionId.trim()
  ) {
    throw new Error("Invalid Esse batch task item cancel request");
  }
}

function assertCancelEsseBatchTaskAllRequest(request: CancelEsseBatchTaskAllRequest): void {
  if (typeof request !== "object" || request === null || typeof request.batchTaskId !== "string" || !request.batchTaskId.trim()) {
    throw new Error("Invalid Esse batch task cancel request");
  }
}

function assertRetryEsseBatchTaskItemRequest(request: RetryEsseBatchTaskItemRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    typeof request.batchTaskId !== "string" ||
    !request.batchTaskId.trim() ||
    typeof request.sessionId !== "string" ||
    !request.sessionId.trim()
  ) {
    throw new Error("Invalid Esse batch task item retry request");
  }
}

function assertRetryEsseBatchTaskFailedRequest(request: RetryEsseBatchTaskFailedRequest): void {
  if (typeof request !== "object" || request === null || typeof request.batchTaskId !== "string" || !request.batchTaskId.trim()) {
    throw new Error("Invalid Esse batch task retry request");
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
      typeof request.selectedSessionId !== "string") ||
    (request.referenceImages !== undefined &&
      (!Array.isArray(request.referenceImages) ||
        !request.referenceImages.every(
          (referenceImage) =>
            typeof referenceImage === "object" &&
            referenceImage !== null &&
            typeof referenceImage.filePath === "string" &&
            typeof referenceImage.id === "string" &&
            typeof referenceImage.label === "string"
        ))) ||
    (request.esseUndoLog !== undefined && !Array.isArray(request.esseUndoLog))
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

function assertDeleteProjectRequest(request: DeleteProjectRequest): void {
  if (typeof request !== "object" || request === null || typeof request.directory !== "string" || !request.directory.trim()) {
    throw new Error("Invalid project delete request");
  }
}

function assertEssePreflightResponse(response: EssePreflightResponse): void {
  if (
    typeof response !== "object" ||
    response === null ||
    typeof response.requestId !== "string" ||
    !response.requestId.trim() ||
    (response.decision !== "execute" && response.decision !== "modify" && response.decision !== "cancel") ||
    (response.detail !== undefined && typeof response.detail !== "string") ||
    (response.modifiedCommands !== undefined && !Array.isArray(response.modifiedCommands))
  ) {
    throw new Error("Invalid Esse preflight response");
  }
}

function assertEssePermissionResponse(response: EssePermissionResponse): void {
  if (
    typeof response !== "object" ||
    response === null ||
    typeof response.requestId !== "string" ||
    !response.requestId.trim() ||
    (response.decision !== "allow-once" && response.decision !== "allow-session" && response.decision !== "deny") ||
    (response.reason !== undefined && typeof response.reason !== "string")
  ) {
    throw new Error("Invalid Esse permission response");
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

function assertExportImagesRequest(request: ExportImagesRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    (request.fileName !== undefined && typeof request.fileName !== "string") ||
    !Array.isArray(request.imagePaths) ||
    request.imagePaths.length === 0 ||
    !request.imagePaths.every((imagePath) => typeof imagePath === "string" && imagePath.trim())
  ) {
    throw new Error("Invalid export images request");
  }
}

function assertSendChatMessageRequest(request: SendChatMessageRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    typeof request.imagePath !== "string" ||
    typeof request.sessionId !== "string" ||
    (request.operationId !== undefined && typeof request.operationId !== "string") ||
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

app.whenReady().then(async () => {
  configureLocalConfig({ userConfigDirectory: app.getPath("userData") });
  logger = createLogger();
  esseSkillSettings = await loadEsseSkillSettings(getEsseSkillSettingsPath());
  logger.info("Application ready", {
    data: {
      isPackaged: app.isPackaged,
      userData: app.getPath("userData")
    },
    publicMessage: "应用已启动。"
  });
  esseSkillLoader = createAppEsseSkillLoader();
  registerImageProtocol();
  registerIpc(logger);
  createWindow();
  warmupImageSessionAgent(logger);
  builtInSkillsReady = syncBuiltInSkills({
    builtInSource: getBuiltInSkillsSourceDirectory(),
    logger,
    userTarget: getBuiltInSkillsTargetDirectory()
  }).then(async () => {
    await esseSkillLoader?.reload();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

function warmupImageSessionAgent(appLogger: AppLogger): void {
  void warmupImageSessionAgentDependencies()
    .then(() => {
      appLogger.info("Image session agent dependencies warmed", {
        publicMessage: "图片会话智能体已预热。"
      });
    })
    .catch((error) => {
      appLogger.warn("Image session agent dependency warmup failed", {
        error,
        publicMessage: "图片会话智能体预热失败，将在首次使用时重试。"
      });
    });
}

function assertSendEsseMessageRequest(request: SendEsseMessageRequest): void {
  if (
    typeof request !== "object" ||
    request === null ||
    (request.operationId !== undefined && typeof request.operationId !== "string") ||
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

function toUserErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "未知错误";
}

app.on("before-quit", () => {
  // 退出前清空 agent runtime 注册表，触发各 runtime 的 dispose（解绑订阅 + SDK 清理）。
  getSharedAgentRuntimeRegistry().invalidateAll();
});

app.on("window-all-closed", () => {
  app.quit();
});
