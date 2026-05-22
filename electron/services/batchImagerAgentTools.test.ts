import { describe, expect, test } from "vitest";
import { createRunProjectCommandTool } from "./batchImagerAgentTools";
import { createBatchImagerCommandPolicy } from "./agentCommandPolicy";

describe("batchImagerAgentTools", () => {
  test("runs allowed project commands through an injected executor", async () => {
    const executed: Array<{ command: string; cwd: string; timeoutMs: number }> = [];
    const tool = createRunProjectCommandTool({
      commandPolicy: createBatchImagerCommandPolicy({ projectDirectory: "C:\\project" }),
      execCommand: async (request) => {
        executed.push(request);
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
      projectDirectory: "C:\\project",
      timeoutMs: 10_000
    });

    const result = await tool.execute("call-1", { command: "npm test" });

    expect(executed).toEqual([{ command: "npm test", cwd: "C:\\project", timeoutMs: 10_000 }]);
    expect(result.content).toEqual([{ type: "text", text: "exitCode: 0\nstdout:\nok" }]);
  });

  test("blocks denied commands before execution and returns an actionable tool error", async () => {
    const executed: string[] = [];
    const tool = createRunProjectCommandTool({
      commandPolicy: createBatchImagerCommandPolicy({ projectDirectory: "C:\\project" }),
      execCommand: async (request) => {
        executed.push(request.command);
        return { exitCode: 0, stdout: "unused", stderr: "" };
      },
      projectDirectory: "C:\\project"
    });

    const result = await tool.execute("call-1", { command: "shutdown /s /t 0" });

    expect(executed).toEqual([]);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("系统级危险命令");
    expect(result.content[0]?.text).toContain("请改用项目内文件操作");
  });
});
