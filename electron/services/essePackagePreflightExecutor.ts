import type { ProjectSnapshot } from "../ipcTypes";
import type { PackageGeneratedImagesResult } from "./imagePackage";
import type { EssePackagePreflightExecutionRequest, WorkspaceMutationResult } from "./esseWorkspaceTools";

interface CreateEssePackagePreflightExecutorOptions {
  desktopDirectory: string;
  packageGeneratedImages: (options: { desktopDirectory: string; fileName?: string; imagePaths: string[] }) => Promise<PackageGeneratedImagesResult>;
}

interface EssePackagePreflightExecutionContext {
  getState: () => ProjectSnapshot;
}

export function createEssePackagePreflightExecutor(options: CreateEssePackagePreflightExecutorOptions) {
  return async (
    request: EssePackagePreflightExecutionRequest,
    context: EssePackagePreflightExecutionContext
  ): Promise<WorkspaceMutationResult> => {
    const state = context.getState();
    const selectedSessions = request.sessionIds?.length
      ? request.sessionIds.map((sessionId) => state.sessions.find((session) => session.id === sessionId))
      : state.sessions;
    const missingSessionId = request.sessionIds?.find((sessionId, index) => !selectedSessions[index]);
    if (missingSessionId) {
      return {
        ok: false,
        reason: "session not found",
        detail: `no session with id ${missingSessionId}`,
        suggestedNext: "call list_sessions to list current ids."
      };
    }

    const imagePaths = [...new Set((selectedSessions as ProjectSnapshot["sessions"]).flatMap((session) => session.generatedFilePaths ?? []))];
    if (imagePaths.length === 0) {
      return {
        ok: false,
        reason: "no generated images to package",
        suggestedNext: "generate images first or choose sessions with generated records."
      };
    }

    const result = await options.packageGeneratedImages({
      desktopDirectory: options.desktopDirectory,
      ...(request.fileName ? { fileName: request.fileName } : {}),
      imagePaths
    });

    return {
      affectedSessionIds: (selectedSessions as ProjectSnapshot["sessions"]).map((session) => session.id),
      ok: true,
      summary: `已打包 ${imagePaths.length} 张生成图：${result.outputPath}`
    };
  };
}
