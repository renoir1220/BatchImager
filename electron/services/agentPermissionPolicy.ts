import path from "node:path";

export type AgentFileOperation = "copy" | "delete" | "edit" | "list" | "overwrite" | "read" | "rename" | "write";

export interface AgentFileOperationRequest {
  operation: AgentFileOperation;
  path: string;
}

export interface AgentPermissionDecision {
  allowed: boolean;
  reason?: string;
  suggestion?: string;
}

export interface BatchImagerPermissionPolicy {
  checkFileOperation: (request: AgentFileOperationRequest) => AgentPermissionDecision;
  protectedRoots: string[];
}

interface BatchImagerPermissionPolicyOptions {
  externalWriteRoots?: string[];
  projectDirectory: string;
}

const READ_ONLY_OPERATIONS = new Set<AgentFileOperation>(["copy", "list", "read"]);

export function createBatchImagerPermissionPolicy(
  options: BatchImagerPermissionPolicyOptions
): BatchImagerPermissionPolicy {
  const projectDirectory = resolvePath(options.projectDirectory);
  const protectedRoots = [
    path.join(projectDirectory, "images", "original"),
    path.join(projectDirectory, "references")
  ];
  const externalWriteRoots = (options.externalWriteRoots ?? []).map(resolvePath);

  return {
    protectedRoots,
    checkFileOperation(request) {
      const targetPath = resolvePath(request.path);

      if (READ_ONLY_OPERATIONS.has(request.operation)) {
        return allow();
      }

      if (isPathInside(targetPath, projectDirectory) && isSamePath(targetPath, projectDirectory)) {
        return deny(
          "不能直接修改或删除项目根目录。",
          "请在项目内创建具体文件，或写入 images/generated、agent 等工作目录。"
        );
      }

      const protectedRoot = protectedRoots.find((root) => isPathInside(targetPath, root));
      if (protectedRoot) {
        return deny(
          getProtectedRootReason(protectedRoot, projectDirectory),
          "请读取原图或参考图后，把新文件写入 images/generated，或在项目工作目录创建副本。"
        );
      }

      if (isPathInside(targetPath, projectDirectory)) {
        return allow();
      }

      if (externalWriteRoots.some((root) => isPathInside(targetPath, root))) {
        return allow();
      }

      return deny("默认不允许写入当前 BatchImager 项目之外的路径。", "请写入当前项目目录，或先把目标目录登记为外部导出目录。");
    }
  };
}

function getProtectedRootReason(protectedRoot: string, projectDirectory: string): string {
  if (isPathInside(protectedRoot, path.join(projectDirectory, "images", "original"))) {
    return "原始图片是用户资产，只允许读取和复制，不能覆盖、删除或重命名。";
  }

  return "参考图是用户资产，只允许读取和复制，不能覆盖、删除或重命名。";
}

function allow(): AgentPermissionDecision {
  return { allowed: true };
}

function deny(reason: string, suggestion: string): AgentPermissionDecision {
  return { allowed: false, reason, suggestion };
}

function resolvePath(value: string): string {
  return path.resolve(value);
}

function isPathInside(targetPath: string, rootPath: string): boolean {
  const target = normalizeForCompare(targetPath);
  const root = normalizeForCompare(rootPath);

  return target === root || target.startsWith(`${root}${path.sep}`);
}

function isSamePath(left: string, right: string): boolean {
  return normalizeForCompare(left) === normalizeForCompare(right);
}

function normalizeForCompare(value: string): string {
  return path.normalize(value).replace(/[\\/]+$/, "").toLowerCase();
}
