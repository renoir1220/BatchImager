import path from "node:path";

export interface AgentCommandRequest {
  command: string;
}

export interface AgentCommandDecision {
  allowed: boolean;
  reason?: string;
  suggestion?: string;
}

export interface BatchImagerCommandPolicy {
  checkCommand: (command: string | AgentCommandRequest) => AgentCommandDecision;
}

interface BatchImagerCommandPolicyOptions {
  projectDirectory: string;
}

const SYSTEM_DANGEROUS_PATTERNS: RegExp[] = [
  /^\s*shutdown\b/i,
  /^\s*(restart-computer|stop-computer)\b/i,
  /^\s*(format|format-volume|diskpart)\b/i,
  /^\s*reg\s+(add|delete|import|restore|save|unload)\b/i,
  /^\s*schtasks\s+\/(create|delete|change)\b/i,
  /^\s*(icacls|takeown|set-acl|chmod|chown)\b/i,
  /^\s*taskkill\b.*\s\/f\b/i,
  /^\s*(sc|net\s+user)\b/i
];

const DESTRUCTIVE_FILE_COMMAND_PATTERN =
  /^\s*(rm|del|erase|rmdir|rd|remove-item|move-item|mv|copy|copy-item|cp)\b/i;

export function createBatchImagerCommandPolicy(options: BatchImagerCommandPolicyOptions): BatchImagerCommandPolicy {
  const projectDirectory = path.resolve(options.projectDirectory);
  const protectedRoots = [
    path.join(projectDirectory, "images", "original"),
    path.join(projectDirectory, "references")
  ];

  return {
    checkCommand(commandOrRequest) {
      const command = typeof commandOrRequest === "string" ? commandOrRequest : commandOrRequest.command;
      const trimmed = command.trim();

      if (!trimmed) {
        return allow();
      }

      if (SYSTEM_DANGEROUS_PATTERNS.some((pattern) => pattern.test(trimmed))) {
        return deny("检测到系统级危险命令，已阻止执行。", "请改用项目内文件操作或受控的 BatchImager 工具。");
      }

      if (isRecursiveDeletionOfRootOrUserDirectory(trimmed, projectDirectory)) {
        return deny("检测到根目录或用户目录的递归删除命令，已阻止执行。", "如果需要清理项目缓存，请只删除项目内明确的缓存或构建目录。");
      }

      if (DESTRUCTIVE_FILE_COMMAND_PATTERN.test(trimmed) && protectedRoots.some((root) => commandMentionsPath(trimmed, root))) {
        return deny(
          "命令会修改或删除原始图片/参考图目录，已阻止执行。",
          "请读取这些图片作为输入，把新结果写入 images/generated 或项目工作目录。"
        );
      }

      return allow();
    }
  };
}

function isRecursiveDeletionOfRootOrUserDirectory(command: string, projectDirectory: string): boolean {
  if (!isRecursiveDeleteCommand(command)) {
    return false;
  }

  const normalized = normalizeCommand(command);

  if (/\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+["']?\/["']?\s*$/i.test(command)) {
    return true;
  }

  const userRoot = getUserRoot(projectDirectory);
  if (userRoot && normalized.includes(normalizeForCommand(userRoot))) {
    return true;
  }

  const windowsUsersRoot = normalizeForCommand("C:\\Users");
  return normalized.includes(windowsUsersRoot);
}

function isRecursiveDeleteCommand(command: string): boolean {
  return (
    /\brm\s+-[a-z]*r[a-z]*f?[a-z]*/i.test(command) ||
    /\b(remove-item|rmdir|rd)\b.*(?:-recurse|\/s)\b/i.test(command)
  );
}

function getUserRoot(projectDirectory: string): string | undefined {
  const normalized = path.resolve(projectDirectory);
  const parts = normalized.split(/[\\/]+/);
  const usersIndex = parts.findIndex((part) => part.toLowerCase() === "users");

  if (usersIndex < 0 || !parts[usersIndex + 1]) {
    return undefined;
  }

  return parts.slice(0, usersIndex + 2).join(path.sep);
}

function commandMentionsPath(command: string, targetPath: string): boolean {
  return normalizeCommand(command).includes(normalizeForCommand(targetPath));
}

function normalizeCommand(command: string): string {
  return normalizeForCommand(command).replace(/["']/g, "");
}

function normalizeForCommand(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/, "").toLowerCase();
}

function allow(): AgentCommandDecision {
  return { allowed: true };
}

function deny(reason: string, suggestion: string): AgentCommandDecision {
  return { allowed: false, reason, suggestion };
}
