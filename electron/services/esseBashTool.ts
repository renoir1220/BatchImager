import type { WebContents } from "electron";
import type { EsseBashExecutionEvent } from "../ipcTypes";
import type { BatchImagerCommandPolicy } from "./agentCommandPolicy";
import type { EssePermissionBroker } from "./essePermissionBroker";
import type { AgentWorkspacePermissionPolicy } from "./agentWorkspacePermissionPolicy";
import type { EsseSkillLoader, EsseSkillRecord } from "./esseSkillLoader";

export interface EsseBashOperations {
  exec: (
    command: string,
    cwd: string,
    options: {
      env?: NodeJS.ProcessEnv;
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
    }
  ) => Promise<{ exitCode: number | null }>;
}

export interface EsseBashSpawnContext {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface EsseBashToolOptions {
  operations?: EsseBashOperations;
  spawnHook?: (context: EsseBashSpawnContext) => EsseBashSpawnContext;
}

export interface CreateEsseBashToolOptions {
  bashSdk?: EsseBashSdk;
  commandPolicy: BatchImagerCommandPolicy;
  permissionBroker: EssePermissionBroker;
  projectDirectory: string;
  sessionAllowList: Set<string>;
  sessionId: string;
  signal?: AbortSignal;
  skillLoader: EsseSkillLoader;
  userDataDirectory: string;
  webContents: Pick<WebContents, "send">;
}

export interface EsseBashSdk {
  createBashToolDefinition: (cwd: string, options?: EsseBashToolOptions) => unknown;
  createLocalBashOperations: () => EsseBashOperations;
}

interface EsseBashToolDefinition {
  execute?: (
    toolCallId: string,
    params: { command?: unknown; timeout?: unknown },
    signal?: AbortSignal,
    onUpdate?: (partialResult: unknown) => void,
    ctx?: unknown
  ) => Promise<unknown>;
  name?: string;
}

const AGENT_PERMISSION_POLICY_FOR_BASH: AgentWorkspacePermissionPolicy = {
  read: "allow",
  "safe-write": "allow",
  destructive: "ask",
  "external-write": "ask"
};

const ALLOWED_ENV_KEYS = new Set(["HOME", "PATH", "Path", "USER", "LANG", "LC_ALL", "TMPDIR", "SHELL", "DISPLAY"]);
const BASH_RUNNING_EVENT_INTERVAL_MS = 250;
// GUI-launched Electron apps often miss Homebrew paths; keep this explicit instead of inheriting the full shell env.
const DEFAULT_POSIX_BASH_PATH_ENTRIES = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin"
];
const MAX_BASH_EVENT_OUTPUT_CHARS = 12_000;
const MAX_BASH_EVENT_OUTPUT_LINES = 240;
const SECRET_ENV_PATTERN = /(?:^TUZI_|^OPENAI_|^ANTHROPIC_|^BATCHIMAGER_API_|API_KEY|TOKEN|SECRET|PASSWORD)/i;

export async function createEsseBashTool(options: CreateEsseBashToolOptions): Promise<unknown> {
  const sdk = options.bashSdk ?? await loadPiBashSdk();
  const baseOperations = sdk.createLocalBashOperations();

  const operations: EsseBashOperations = {
    exec: async (command, cwd, execOptions) => {
      const policyDecision = options.commandPolicy.checkCommand(command);
      if (!policyDecision.allowed) {
        throw new Error(`Esse bash 被命令策略拦截：${policyDecision.reason ?? "未通过策略检查"}`);
      }

      const skill = inferSkillForBash(command, cwd, options.skillLoader);
      const targetKey = skill ? `skill:${skill.name}` : `bash:${options.sessionId}`;
      const linkedSignal = linkAbortSignals(options.signal, execOptions.signal);
      try {
        const permission = await options.permissionBroker.request(
          options.webContents,
          {
            label: skill ? `运行 ${skill.name} 的命令` : "运行项目命令",
            params: { command, cwd, skillName: skill?.name ?? null },
            requiresPreflight: false,
            risk: "destructive",
            targetKey,
            toolName: "bash"
          },
          {
      policy: AGENT_PERMISSION_POLICY_FOR_BASH,
            sessionAllowList: options.sessionAllowList,
            signal: linkedSignal.signal
          }
        );
        if (permission.decision === "deny") {
          throw new Error(permission.reason);
        }

        return await baseOperations.exec(command, cwd, {
          ...execOptions,
          env: sanitizeBashEnv(execOptions.env, options.projectDirectory, options.userDataDirectory, skill),
          signal: linkedSignal.signal
        });
      } finally {
        linkedSignal.cleanup();
      }
    }
  };

  const toolDefinition = sdk.createBashToolDefinition(options.projectDirectory, {
    operations,
    spawnHook: (context) => sanitizeSpawnContext(context, options)
  });
  return wrapBashToolDefinition(toolDefinition, options);
}

export function sanitizeBashEnv(
  input: NodeJS.ProcessEnv | undefined,
  projectDirectory: string,
  userDataDirectory: string,
  skill: EsseSkillRecord | undefined
): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(input ?? process.env)) {
    if (value === undefined) {
      continue;
    }

    if (ALLOWED_ENV_KEYS.has(key) && !SECRET_ENV_PATTERN.test(key)) {
      sanitized[key] = value;
    }
  }

  const bashPath = buildBashPath(sanitized.PATH ?? sanitized.Path);
  if (bashPath) {
    sanitized.PATH = bashPath;
    if (process.platform === "win32" && sanitized.Path) {
      sanitized.Path = bashPath;
    }
  }
  sanitized.BATCHIMAGER_PROJECT_DIR = projectDirectory;
  sanitized.BATCHIMAGER_SKILL_NAME = skill?.name ?? "";
  sanitized.BATCHIMAGER_SKILL_DIR = skill?.baseDir ?? "";
  sanitized.BATCHIMAGER_USER_DATA = userDataDirectory;

  return sanitized;
}

function buildBashPath(inputPath: string | undefined): string {
  const delimiter = process.platform === "win32" ? ";" : ":";
  const defaultEntries = process.platform === "win32" ? [] : DEFAULT_POSIX_BASH_PATH_ENTRIES;
  const entries = [...splitPathEntries(inputPath, delimiter), ...defaultEntries];
  const seen = new Set<string>();
  const uniqueEntries: string[] = [];

  for (const entry of entries) {
    const normalizedEntry = entry.trim();
    if (!normalizedEntry || seen.has(normalizedEntry)) {
      continue;
    }

    seen.add(normalizedEntry);
    uniqueEntries.push(normalizedEntry);
  }

  return uniqueEntries.join(delimiter);
}

function splitPathEntries(inputPath: string | undefined, delimiter: string): string[] {
  return inputPath?.split(delimiter) ?? [];
}

function sanitizeSpawnContext(context: EsseBashSpawnContext, options: CreateEsseBashToolOptions): EsseBashSpawnContext {
  const skill = inferSkillForBash(context.command, context.cwd, options.skillLoader);
  return {
    command: context.command,
    cwd: context.cwd,
    env: sanitizeBashEnv(context.env, options.projectDirectory, options.userDataDirectory, skill)
  };
}

function inferSkillForBash(command: string, cwd: string, skillLoader: EsseSkillLoader): EsseSkillRecord | undefined {
  const cwdMatch = skillLoader.matchSkillByCwd(cwd);
  if (cwdMatch) {
    return cwdMatch;
  }

  const normalizedCommand = command.replaceAll("\\", "/");
  return skillLoader.list().find((skill) => {
    const normalizedBaseDir = skill.baseDir.replaceAll("\\", "/");
    return normalizedCommand.includes(normalizedBaseDir) || normalizedCommand.includes(skill.name);
  });
}

function wrapBashToolDefinition(toolDefinition: unknown, options: CreateEsseBashToolOptions): unknown {
  if (!isBashToolDefinition(toolDefinition)) {
    return toolDefinition;
  }

  return {
    ...toolDefinition,
    execute: async (
      toolCallId: string,
      params: { command?: unknown; timeout?: unknown },
      signal?: AbortSignal,
      onUpdate?: (partialResult: unknown) => void,
      ctx?: unknown
    ) => {
      const command = typeof params.command === "string" ? params.command : "";
      const skill = inferSkillForBash(command, options.projectDirectory, options.skillLoader);
      const publisher = createBashExecutionEventPublisher((event) => publishBashExecutionEvent(options, event));
      publisher.publishImmediate({
        command,
        cwd: options.projectDirectory,
        skillName: skill?.name ?? null,
        status: "running",
        toolCallId
      });
      try {
        const result = await toolDefinition.execute?.(
          toolCallId,
          params,
          signal,
          (partialResult) => {
            const output = extractTextContent(partialResult);
            publisher.publishRunning({
              command,
              cwd: options.projectDirectory,
              fullOutputPath: extractFullOutputPath(partialResult),
              output,
              outputPath: extractBatchImagerOutputPath(output),
              skillName: skill?.name ?? null,
              status: "running",
              toolCallId
            });
            onUpdate?.(partialResult);
          },
          ctx
        );
        const output = extractTextContent(result);
        publisher.publishFinal({
          command,
          cwd: options.projectDirectory,
          exitCode: extractExitCode(result),
          fullOutputPath: extractFullOutputPath(result),
          isError: false,
          output,
          outputPath: extractBatchImagerOutputPath(output),
          skillName: skill?.name ?? null,
          status: "completed",
          toolCallId
        });
        return result;
      } catch (error) {
        publisher.publishFinal({
          command,
          cwd: options.projectDirectory,
          isError: true,
          output: error instanceof Error ? error.message : String(error),
          skillName: skill?.name ?? null,
          status: "failed",
          toolCallId
        });
        throw error;
      } finally {
        publisher.dispose();
      }
    }
  };
}

function isBashToolDefinition(value: unknown): value is EsseBashToolDefinition {
  return typeof value === "object" && value !== null && typeof (value as EsseBashToolDefinition).execute === "function";
}

function publishBashExecutionEvent(options: CreateEsseBashToolOptions, event: EsseBashExecutionEvent): void {
  const normalized = normalizeBashExecutionEvent(event);
  options.webContents.send("agent:bash-execution", normalized);
  options.webContents.send("esse:bash-execution", normalized);
}

interface BashExecutionEventPublisher {
  dispose: () => void;
  publishFinal: (event: EsseBashExecutionEvent) => void;
  publishImmediate: (event: EsseBashExecutionEvent) => void;
  publishRunning: (event: EsseBashExecutionEvent) => void;
}

function createBashExecutionEventPublisher(send: (event: EsseBashExecutionEvent) => void): BashExecutionEventPublisher {
  let pendingRunningEvent: EsseBashExecutionEvent | undefined;
  let runningEventTimer: NodeJS.Timeout | undefined;

  const clearRunningEventTimer = () => {
    if (!runningEventTimer) {
      return;
    }

    clearTimeout(runningEventTimer);
    runningEventTimer = undefined;
  };

  const flushRunningEvent = () => {
    const event = pendingRunningEvent;
    pendingRunningEvent = undefined;
    clearRunningEventTimer();

    if (event) {
      send(event);
    }
  };

  return {
    dispose: () => {
      pendingRunningEvent = undefined;
      clearRunningEventTimer();
    },
    publishFinal: (event) => {
      pendingRunningEvent = undefined;
      clearRunningEventTimer();
      send(event);
    },
    publishImmediate: (event) => {
      send(event);
    },
    publishRunning: (event) => {
      pendingRunningEvent = { ...pendingRunningEvent, ...event };
      if (!runningEventTimer) {
        runningEventTimer = setTimeout(flushRunningEvent, BASH_RUNNING_EVENT_INTERVAL_MS);
      }
    }
  };
}

function normalizeBashExecutionEvent(event: EsseBashExecutionEvent): EsseBashExecutionEvent {
  if (typeof event.output !== "string") {
    return event;
  }

  return {
    ...event,
    output: compactBashOutputForUi(event.output)
  };
}

function compactBashOutputForUi(output: string): string {
  const normalized = output.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  const lines = normalized.split("\n");
  const lineCompacted =
    lines.length > MAX_BASH_EVENT_OUTPUT_LINES
      ? [`+${lines.length - MAX_BASH_EVENT_OUTPUT_LINES} 行已折叠`, ...lines.slice(-MAX_BASH_EVENT_OUTPUT_LINES)].join("\n")
      : normalized;

  if (lineCompacted.length <= MAX_BASH_EVENT_OUTPUT_CHARS) {
    return lineCompacted;
  }

  return `+${lineCompacted.length - MAX_BASH_EVENT_OUTPUT_CHARS} 字符已折叠\n${lineCompacted.slice(-MAX_BASH_EVENT_OUTPUT_CHARS)}`;
}

function extractTextContent(value: unknown): string {
  if (typeof value !== "object" || value === null || !("content" in value) || !Array.isArray(value.content)) {
    return "";
  }

  return value.content
    .map((item) => (typeof item === "object" && item !== null && "text" in item && typeof item.text === "string" ? item.text : ""))
    .join("\n")
    .trim();
}

function extractFullOutputPath(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("details" in value)) {
    return undefined;
  }

  const details = value.details;
  return typeof details === "object" && details !== null && "fullOutputPath" in details && typeof details.fullOutputPath === "string"
    ? details.fullOutputPath
    : undefined;
}

function extractExitCode(value: unknown): number | null | undefined {
  if (typeof value !== "object" || value === null || !("details" in value)) {
    return undefined;
  }

  const details = value.details;
  return typeof details === "object" && details !== null && "exitCode" in details && typeof details.exitCode === "number"
    ? details.exitCode
    : undefined;
}

function extractBatchImagerOutputPath(output: string): string | undefined {
  const match = output.match(/\[BATCHIMAGER_OUTPUT\]\s+(.+)/);
  return match?.[1]?.trim();
}

function linkAbortSignals(...signals: Array<AbortSignal | undefined>): { cleanup: () => void; signal?: AbortSignal } {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length <= 1) {
    return { cleanup: () => undefined, signal: activeSignals[0] };
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  const cleanups: Array<() => void> = [];
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", abort));
    }
  }

  return {
    cleanup: () => cleanups.forEach((cleanup) => cleanup()),
    signal: controller.signal
  };
}

let piBashSdkPromise: Promise<EsseBashSdk> | undefined;

async function loadPiBashSdk(): Promise<EsseBashSdk> {
  if (!piBashSdkPromise) {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    piBashSdkPromise = dynamicImport("@earendil-works/pi-coding-agent").then((sdk) => {
      if (!isPiBashSdk(sdk)) {
        throw new Error("pi bash SDK unavailable");
      }

      return sdk;
    });
  }

  return piBashSdkPromise;
}

function isPiBashSdk(value: unknown): value is EsseBashSdk {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as EsseBashSdk).createBashToolDefinition === "function" &&
    typeof (value as EsseBashSdk).createLocalBashOperations === "function"
  );
}
