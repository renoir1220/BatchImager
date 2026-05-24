import { describe, expect, test, vi } from "vitest";
import { createEsseBashTool, sanitizeBashEnv, type EsseBashOperations, type EsseBashToolOptions } from "./esseBashTool";
import type { BatchImagerCommandPolicy } from "./agentCommandPolicy";
import type { EssePermissionBroker } from "./essePermissionBroker";
import type { EsseSkillLoader } from "./esseSkillLoader";

describe("createEsseBashTool", () => {
  test("blocks commands rejected by policy before broker or execution", async () => {
    const exec = vi.fn();
    const permissionBroker = { request: vi.fn() } as unknown as EssePermissionBroker;
    const { operations } = await createTool({
      exec,
      permissionBroker,
      commandPolicy: { checkCommand: () => ({ allowed: false, reason: "nope" }) }
    });

    await expect(operations.exec("rm -rf /", "/project", { onData: vi.fn() })).rejects.toThrow("nope");
    expect(permissionBroker.request).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  test("blocks execution when broker denies permission", async () => {
    const exec = vi.fn();
    const permissionBroker = {
      request: vi.fn().mockResolvedValue({ decision: "deny", reason: "user denied" })
    } as unknown as EssePermissionBroker;
    const { operations } = await createTool({ exec, permissionBroker });

    await expect(operations.exec("node export.mjs", "/project", { onData: vi.fn() })).rejects.toThrow("user denied");
    expect(exec).not.toHaveBeenCalled();
  });

  test("sanitizes secret env values and derives skill permission target", async () => {
    const exec = vi.fn().mockResolvedValue({ exitCode: 0 });
    const permissionBroker = {
      request: vi.fn().mockResolvedValue({ decision: "allow" })
    } as unknown as EssePermissionBroker;
    const { operations } = await createTool({
      exec,
      permissionBroker,
      skillLoader: createTestSkillLoader({
        baseDir: "/project/.esse/skills/xlsx-export",
        description: "导出 Excel",
        disableModelInvocation: false,
        filePath: "/project/.esse/skills/xlsx-export/SKILL.md",
        name: "xlsx-export",
        source: "project",
        sourceLabel: "项目"
      })
    });

    await operations.exec("node export.mjs", "/project/.esse/skills/xlsx-export/scripts", {
      env: {
        HOME: "/Users/test",
        OPENAI_API_KEY: "secret",
        PATH: "/usr/bin",
        TUZI_API_KEY: "secret"
      },
      onData: vi.fn()
    });

    expect(permissionBroker.request).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ targetKey: "skill:xlsx-export", toolName: "bash" }),
      expect.anything()
    );
    expect(exec).toHaveBeenCalledWith(
      "node export.mjs",
      "/project/.esse/skills/xlsx-export/scripts",
      expect.objectContaining({
        env: expect.objectContaining({
          BATCHIMAGER_PROJECT_DIR: "/project",
          BATCHIMAGER_SKILL_NAME: "xlsx-export",
          HOME: "/Users/test",
          PATH: "/usr/bin"
        })
      })
    );
    expect(exec.mock.calls[0][2].env).not.toHaveProperty("OPENAI_API_KEY");
    expect(exec.mock.calls[0][2].env).not.toHaveProperty("TUZI_API_KEY");
  });

  test("publishes bash execution lifecycle events from wrapped tool updates", async () => {
    const webContents = { send: vi.fn() };
    const permissionBroker = {
      request: vi.fn().mockResolvedValue({ decision: "allow" })
    } as unknown as EssePermissionBroker;
    const tool = await createEsseBashTool({
      bashSdk: {
        createBashToolDefinition: (_cwd, _toolOptions) => ({
          name: "bash",
          execute: async (_toolCallId, _params, _signal, onUpdate) => {
            onUpdate?.({
              content: [{ type: "text", text: "Exported 1 rows.\n[BATCHIMAGER_OUTPUT] /project/exports/list.xlsx" }],
              details: { fullOutputPath: "/tmp/pi-bash.log" }
            });
            return {
              content: [{ type: "text", text: "Exported 1 rows.\n[BATCHIMAGER_OUTPUT] /project/exports/list.xlsx" }],
              details: { exitCode: 0, fullOutputPath: "/tmp/pi-bash.log" }
            };
          }
        }),
        createLocalBashOperations: () => ({ exec: vi.fn() })
      },
      commandPolicy: { checkCommand: () => ({ allowed: true }) },
      permissionBroker,
      projectDirectory: "/project",
      sessionAllowList: new Set(),
      sessionId: "esse-agent",
      skillLoader: createTestSkillLoader({
        baseDir: "/skills/xlsx-export",
        description: "导出 Excel",
        disableModelInvocation: false,
        filePath: "/skills/xlsx-export/SKILL.md",
        name: "xlsx-export",
        source: "built-in",
        sourceLabel: "内置"
      }),
      userDataDirectory: "/user-data",
      webContents
    }) as {
      execute: (toolCallId: string, params: { command: string }) => Promise<unknown>;
    };

    await tool.execute("call-1", { command: "node /skills/xlsx-export/scripts/export.mjs" });

    expect(webContents.send).toHaveBeenCalledWith(
      "esse:bash-execution",
      expect.objectContaining({ status: "running", toolCallId: "call-1", skillName: "xlsx-export" })
    );
    expect(webContents.send).toHaveBeenCalledWith(
      "esse:bash-execution",
      expect.objectContaining({
        outputPath: "/project/exports/list.xlsx",
        status: "completed",
        toolCallId: "call-1"
      })
    );
  });
});

describe("sanitizeBashEnv", () => {
  test("injects BatchImager context without leaking API keys", () => {
    const env = sanitizeBashEnv(
      { HOME: "/Users/test", OPENAI_API_KEY: "secret", PATH: "/usr/bin" },
      "/project",
      "/user-data",
      undefined
    );

    expect(env).toMatchObject({
      BATCHIMAGER_PROJECT_DIR: "/project",
      BATCHIMAGER_SKILL_DIR: "",
      BATCHIMAGER_SKILL_NAME: "",
      BATCHIMAGER_USER_DATA: "/user-data",
      HOME: "/Users/test",
      PATH: "/usr/bin"
    });
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
  });
});

async function createTool(options: {
  commandPolicy?: BatchImagerCommandPolicy;
  exec: EsseBashOperations["exec"];
  permissionBroker: EssePermissionBroker;
  skillLoader?: EsseSkillLoader;
}): Promise<{ operations: EsseBashOperations }> {
  let capturedOptions: EsseBashToolOptions | undefined;
  await createEsseBashTool({
    bashSdk: {
      createBashToolDefinition: (_cwd, toolOptions) => {
        capturedOptions = toolOptions;
        return { name: "bash" };
      },
      createLocalBashOperations: () => ({ exec: options.exec })
    },
    commandPolicy: options.commandPolicy ?? { checkCommand: () => ({ allowed: true }) },
    permissionBroker: options.permissionBroker,
    projectDirectory: "/project",
    sessionAllowList: new Set(),
    sessionId: "esse-agent",
    skillLoader: options.skillLoader ?? createTestSkillLoader(),
    userDataDirectory: "/user-data",
    webContents: { send: vi.fn() }
  });

  if (!capturedOptions?.operations) {
    throw new Error("operations not captured");
  }

  return { operations: capturedOptions.operations };
}

function createTestSkillLoader(skill?: ReturnType<EsseSkillLoader["list"]>[number]): EsseSkillLoader {
  return {
    formatForPrompt: () => "",
    get: (name) => (skill?.name === name ? skill : undefined),
    list: () => (skill ? [skill] : []),
    matchSkillByCwd: (cwd) =>
      skill && (cwd === skill.baseDir || cwd.startsWith(`${skill.baseDir}/`))
        ? skill
        : undefined,
    reload: async () => ({ diagnostics: [], skills: skill ? [skill] : [] })
  };
}
