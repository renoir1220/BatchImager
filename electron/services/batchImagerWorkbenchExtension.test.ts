import { describe, expect, test } from "vitest";
import type { ProjectSnapshot } from "../ipcTypes";
import {
  BATCH_IMAGER_WORKBENCH_EXTENSION_TOOL_NAMES,
  createBatchImagerWorkbenchExtension,
  createBatchImagerWorkbenchExtensionTools,
  toBatchImagerWorkbenchCapabilityRuntime
} from "./batchImagerWorkbenchExtension";
import type { AgentToolResult } from "./batchImagerAgentTools";

describe("batchImagerWorkbenchExtension", () => {
  test("registers the first BatchImager workbench capabilities as one controlled Pi extension", async () => {
    const registeredTools: Array<{ name: string }> = [];
    const extension = createBatchImagerWorkbenchExtension(() =>
      toBatchImagerWorkbenchCapabilityRuntime({ getState: () => createSnapshot() })
    );

    await extension({
      registerTool: (tool) => {
        registeredTools.push(tool);
      }
    });

    expect(registeredTools.map((tool) => tool.name)).toEqual(BATCH_IMAGER_WORKBENCH_EXTENSION_TOOL_NAMES);
  });

  test("can register the complete workspace tool world through the same controlled extension", async () => {
    const calls: string[] = [];
    const registeredTools: Array<{ name: string }> = [];
    const extension = createBatchImagerWorkbenchExtension(
      () => toBatchImagerWorkbenchCapabilityRuntime({ getState: () => createSnapshot() }),
      {
        additionalTools: [
          {
            name: "list_sessions",
            label: "列出工作区",
            description: "overridden list_sessions",
            parameters: {},
            async execute() {
              calls.push("overridden-list");
              return { content: [{ type: "text", text: "overridden" }] };
            }
          },
          {
            name: "rename_session",
            label: "重命名图片",
            description: "rename session",
            parameters: {},
            async execute() {
              calls.push("rename");
              return { content: [{ type: "text", text: "renamed" }] };
            }
          }
        ]
      }
    );

    await extension({
      registerTool: (tool) => {
        registeredTools.push(tool);
      }
    });
    const listSessions = registeredTools.find((tool) => tool.name === "list_sessions") as {
      execute: (toolCallId: string, params: Record<string, unknown>) => Promise<AgentToolResult>;
    };

    await listSessions.execute("call-1", {});

    expect(registeredTools.map((tool) => tool.name)).toEqual([
      ...BATCH_IMAGER_WORKBENCH_EXTENSION_TOOL_NAMES,
      "rename_session"
    ]);
    expect(calls).toEqual(["overridden-list"]);
  });

  test("executes capability tools with the same model-visible result contract", async () => {
    const tools = new Map(
      createBatchImagerWorkbenchExtensionTools(() =>
        toBatchImagerWorkbenchCapabilityRuntime({
          getState: () =>
            createSnapshot({
              sessions: [
                createSession("sess_1", {
                  fileName: "flower.jpg",
                  generatedFilePath: "/private/project/generated/a-2.png",
                  generatedFilePaths: ["/private/project/generated/a-1.png", "/private/project/generated/a-2.png"]
                })
              ]
            })
        })
      ).map((tool) => [tool.name, tool])
    );

    const listResult = await tools.get("list_sessions")?.execute("call-1", {});
    const recordResult = await tools.get("get_session_records")?.execute("call-2", { sessionId: "sess_1" });
    const missingResult = await tools.get("get_session_records")?.execute("call-3", { sessionId: "missing" });

    expect(listResult?.content[0]?.text).toContain("referenceImageId=workspace-ref-sess_1");
    expect((listResult?.details?.sessions as Array<{ fileName: string }>)[0]?.fileName).toBe("flower.jpg");
    expect(recordResult?.content[0]?.text).toContain("recordIndex=2; fileName=a-2.png; isCurrent=true");
    expect(missingResult).toMatchObject<Partial<AgentToolResult>>({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("Reason: session not found.") }]
    });
    expect(JSON.stringify(listResult)).not.toContain("/private/project");
    expect(JSON.stringify(recordResult)).not.toContain("/private/project");
  });

  test("keeps scan_unreferenced_files details path-safe even if a lower layer returns extra fields", async () => {
    const tools = new Map(
      createBatchImagerWorkbenchExtensionTools(() =>
        toBatchImagerWorkbenchCapabilityRuntime({
          getState: () => createSnapshot(),
          scanUnreferencedFiles: async () => [
            {
              byteSize: 1024,
              candidateId: "orphan_1",
              fileName: "orphan.png",
              filePath: "/private/project/images/generated/orphan.png"
            }
          ]
        })
      ).map((tool) => [tool.name, tool])
    );

    const result = await tools.get("scan_unreferenced_files")?.execute("call-1", {});

    expect(result?.content[0]?.text).toContain("candidateId=orphan_1; fileName=orphan.png; byteSize=1024");
    expect(JSON.stringify(result?.details)).not.toContain("/private/project");
  });
});

function createSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    project: {
      createdAt: "2026-05-24T00:00:00.000Z",
      directory: "/project",
      id: "project_1",
      imageCount: 1,
      name: "测试项目",
      updatedAt: "2026-05-24T00:00:00.000Z"
    },
    selectedSessionId: "sess_1",
    sessions: [createSession("sess_1")],
    ...overrides
  };
}

function createSession(id: string, overrides: Partial<ProjectSnapshot["sessions"][number]> = {}): ProjectSnapshot["sessions"][number] {
  return {
    chatMessages: [],
    chatStatus: "idle",
    fileName: `${id}.jpg`,
    filePath: `/project/original/${id}.jpg`,
    id,
    status: "idle",
    ...overrides
  };
}
