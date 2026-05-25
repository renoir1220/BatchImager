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

  function checkSegment(segment: string): AgentCommandDecision {
    const trimmed = segment.trim();

    if (!trimmed) {
      return allow();
    }

    if (SYSTEM_DANGEROUS_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      return deny("检测到系统级危险命令，已阻止执行。", "请改用项目内文件操作或受控的 BatchImager 工具。");
    }

    if (isProjectDatabaseInspection(trimmed, projectDirectory)) {
      return deny(
        "不允许通过 bash/sqlite 读取 BatchImager 项目数据库。",
        "请改用 list_sessions、get_session_records、read_image_metadata 等工作区工具读取项目状态。"
      );
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

  function checkCommandInternal(command: string, fromSubstitution: boolean): AgentCommandDecision {
    const trimmed = command.trim();

    if (!trimmed) {
      return allow();
    }

    // 命令替换：$( ... ) 与 ` ... ` 内的子命令同样要走完整策略，且要递归处理嵌套
    // （e.g. $(rm -rf $(pwd))：外层 paren-counting 提取，内层再递归一次）。
    const substitutions = extractCommandSubstitutions(trimmed);
    for (const inner of substitutions) {
      const innerDecision = checkCommandInternal(inner, true);
      if (!innerDecision.allowed) {
        return {
          allowed: false,
          reason: fromSubstitution
            ? innerDecision.reason ?? "命令替换中包含被禁止的子命令。"
            : `命令替换中包含被禁止的子命令：${innerDecision.reason ?? "未通过策略检查"}`,
          ...(innerDecision.suggestion ? { suggestion: innerDecision.suggestion } : {})
        };
      }
    }

    // 链式拼接 (;, &&, ||, |, &) 按段拆分，逐段审核。
    const segments = splitTopLevelSegments(trimmed);
    for (const segment of segments) {
      const decision = checkSegment(segment);
      if (!decision.allowed) {
        return decision;
      }
    }

    return allow();
  }

  return {
    checkCommand(commandOrRequest) {
      const command = typeof commandOrRequest === "string" ? commandOrRequest : commandOrRequest.command;
      return checkCommandInternal(command, false);
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

  const normalizedProject = normalizeForCommand(projectDirectory);
  if (normalized.includes(`${normalizedProject}/`)) {
    return false;
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

function isProjectDatabaseInspection(command: string, projectDirectory: string): boolean {
  const normalized = normalizeCommand(command);
  if (!/\bsqlite3(?:\.exe)?\b/i.test(command)) {
    return false;
  }

  const projectDatabase = `${normalizeForCommand(projectDirectory)}/project.sqlite`;
  return normalized.includes("project.sqlite") || normalized.includes(projectDatabase);
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

// 提取顶层的 $( ... ) 与 ` ... ` 内容。嵌套用 paren / backtick 配对，
// 不依赖正则。返回的子串还可能含有更深一层嵌套，需要由调用方递归处理。
function extractCommandSubstitutions(command: string): string[] {
  const found: string[] = [];
  let quoteChar: '"' | "'" | undefined;

  for (let index = 0; index < command.length; index += 1) {
    const ch = command[index];

    if (quoteChar) {
      if (ch === quoteChar) {
        quoteChar = undefined;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      continue;
    }

    if (ch === "$" && command[index + 1] === "(") {
      const end = findMatchingParen(command, index + 1);
      if (end > index + 1) {
        found.push(command.slice(index + 2, end));
        index = end;
      }
      continue;
    }

    if (ch === "`") {
      const end = command.indexOf("`", index + 1);
      if (end > index) {
        found.push(command.slice(index + 1, end));
        index = end;
      }
    }
  }

  return found;
}

function findMatchingParen(command: string, openIndex: number): number {
  let depth = 0;
  let quoteChar: '"' | "'" | undefined;

  for (let index = openIndex; index < command.length; index += 1) {
    const ch = command[index];

    if (quoteChar) {
      if (ch === quoteChar) {
        quoteChar = undefined;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      continue;
    }

    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function splitTopLevelSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quoteChar: '"' | "'" | undefined;
  let parenDepth = 0;
  let inBacktick = false;

  for (let index = 0; index < command.length; index += 1) {
    const ch = command[index];
    const next = command[index + 1];

    if (quoteChar) {
      current += ch;
      if (ch === quoteChar) {
        quoteChar = undefined;
      }
      continue;
    }

    if (inBacktick) {
      current += ch;
      if (ch === "`") {
        inBacktick = false;
      }
      continue;
    }

    if (parenDepth > 0) {
      current += ch;
      if (ch === "(") {
        parenDepth += 1;
      } else if (ch === ")") {
        parenDepth -= 1;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      current += ch;
      continue;
    }

    if (ch === "`") {
      inBacktick = true;
      current += ch;
      continue;
    }

    if (ch === "$" && next === "(") {
      parenDepth += 1;
      current += ch;
      continue;
    }

    if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
      segments.push(current);
      current = "";
      index += 1;
      continue;
    }

    if (ch === ";" || ch === "|" || ch === "&") {
      segments.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  segments.push(current);
  return segments.filter((segment) => segment.trim().length > 0);
}

function allow(): AgentCommandDecision {
  return { allowed: true };
}

function deny(reason: string, suggestion: string): AgentCommandDecision {
  return { allowed: false, reason, suggestion };
}
