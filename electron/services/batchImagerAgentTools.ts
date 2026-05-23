import { exec } from "node:child_process";
import type { BatchImagerCommandPolicy } from "./agentCommandPolicy";

export interface RunProjectCommandRequest {
  command: string;
  cwd: string;
  timeoutMs: number;
}

export interface RunProjectCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface AgentToolContent {
  text: string;
  type: "text";
}

export interface AgentToolResult {
  content: AgentToolContent[];
  details?: Record<string, unknown>;
  isError?: boolean;
}

export interface BatchImagerAgentTool {
  description: string;
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<AgentToolResult>;
  label: string;
  name: string;
  parameters: Record<string, unknown>;
}

interface CreateRunProjectCommandToolOptions {
  commandPolicy: BatchImagerCommandPolicy;
  execCommand?: (request: RunProjectCommandRequest) => Promise<RunProjectCommandResult>;
  projectDirectory: string;
  timeoutMs?: number;
}

// 5 分钟够覆盖 npm install / build / test 等长耗时项目命令；
// 之前 2 分钟会腰斩这些常规命令，LLM 拿到 timeout 后会自动重试，浪费 token。
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_CHARS = 12_000;

export function createRunProjectCommandTool(options: CreateRunProjectCommandToolOptions): BatchImagerAgentTool {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const execCommand = options.execCommand ?? execProjectCommand;

  return {
    name: "run_project_command",
    label: "运行项目命令",
    description:
      "Run a local command for the current BatchImager project. Broad project commands are allowed, but catastrophic system actions and protected image mutations are blocked.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to run in the current BatchImager project directory."
        }
      },
      required: ["command"],
      additionalProperties: false
    },
    async execute(_toolCallId, params) {
      const command = typeof params.command === "string" ? params.command.trim() : "";

      if (!command) {
        return toolError("run_project_command requires a command.");
      }

      const decision = options.commandPolicy.checkCommand(command);
      if (!decision.allowed) {
        return toolError([decision.reason, decision.suggestion].filter(Boolean).join("\n"));
      }

      const result = await execCommand({
        command,
        cwd: options.projectDirectory,
        timeoutMs
      });

      return {
        content: [{ type: "text", text: formatCommandResult(result) }],
        details: {
          exitCode: result.exitCode
        },
        ...(result.exitCode === 0 ? {} : { isError: true })
      };
    }
  };
}

function execProjectCommand(request: RunProjectCommandRequest): Promise<RunProjectCommandResult> {
  return new Promise((resolve) => {
    exec(
      request.command,
      {
        cwd: request.cwd,
        timeout: request.timeoutMs,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: getExitCode(error),
          stderr,
          stdout
        });
      }
    );
  });
}

function getExitCode(error: unknown): number {
  if (!error) {
    return 0;
  }

  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "number") {
    return error.code;
  }

  return 1;
}

function formatCommandResult(result: RunProjectCommandResult): string {
  const sections = [`exitCode: ${result.exitCode}`];

  if (result.stdout.trim()) {
    sections.push(`stdout:\n${truncateOutput(result.stdout.trim())}`);
  }

  if (result.stderr.trim()) {
    sections.push(`stderr:\n${truncateOutput(result.stderr.trim())}`);
  }

  return sections.join("\n");
}

function truncateOutput(value: string): string {
  if (value.length <= MAX_OUTPUT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n...输出已截断`;
}

function toolError(message: string): AgentToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true
  };
}
