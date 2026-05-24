import { describe, expect, test } from "vitest";
import type { ProjectSnapshot } from "../ipcTypes";
import { createEssePackagePreflightExecutor } from "./essePackagePreflightExecutor";

describe("essePackagePreflightExecutor", () => {
  test("packages all generated images through the injected package writer", async () => {
    const packageCalls: Array<{ desktopDirectory: string; fileName?: string; imagePaths: string[] }> = [];
    const executor = createEssePackagePreflightExecutor({
      desktopDirectory: "/desktop",
      packageGeneratedImages: async (input) => {
        packageCalls.push(input);
        return { outputPath: "/desktop/esse.zip" };
      }
    });

    const result = await executor(
      { fileName: "esse.zip", tool: "package_generated_images" },
      { getState: () => createSnapshot() }
    );

    expect(result).toEqual({
      affectedSessionIds: ["sess_1", "sess_2"],
      ok: true,
      summary: "已打包 3 张生成图：/desktop/esse.zip"
    });
    expect(packageCalls).toEqual([
      {
        desktopDirectory: "/desktop",
        fileName: "esse.zip",
        imagePaths: ["/generated/a-1.png", "/generated/a-2.png", "/generated/b-1.png"]
      }
    ]);
  });

  test("packages only selected sessions and rejects unknown session ids", async () => {
    const packageCalls: Array<{ imagePaths: string[] }> = [];
    const executor = createEssePackagePreflightExecutor({
      desktopDirectory: "/desktop",
      packageGeneratedImages: async (input) => {
        packageCalls.push(input);
        return { outputPath: "/desktop/selected.zip" };
      }
    });

    await expect(
      executor({ sessionIds: ["sess_2"], tool: "package_generated_images" }, { getState: () => createSnapshot() })
    ).resolves.toMatchObject({ affectedSessionIds: ["sess_2"], ok: true });
    expect(packageCalls[0].imagePaths).toEqual(["/generated/b-1.png"]);

    await expect(
      executor({ sessionIds: ["missing"], tool: "package_generated_images" }, { getState: () => createSnapshot() })
    ).resolves.toEqual({
      detail: "no session with id missing",
      ok: false,
      reason: "session not found",
      suggestedNext: "call list_sessions to list current ids."
    });
  });

  test("rejects sessions without generated images before calling the package writer", async () => {
    let packageCallCount = 0;
    const executor = createEssePackagePreflightExecutor({
      desktopDirectory: "/desktop",
      packageGeneratedImages: async () => {
        packageCallCount += 1;
        return { outputPath: "/desktop/empty.zip" };
      }
    });

    const result = await executor(
      { sessionIds: ["sess_empty"], tool: "package_generated_images" },
      {
        getState: () => ({
          ...createSnapshot(),
          sessions: [
            {
              chatMessages: [],
              chatStatus: "idle",
              fileName: "empty.jpg",
              filePath: "/original/empty.jpg",
              id: "sess_empty",
              status: "idle"
            }
          ]
        })
      }
    );

    expect(result).toEqual({
      ok: false,
      reason: "no generated images to package",
      suggestedNext: "generate images first or choose sessions with generated records."
    });
    expect(packageCallCount).toBe(0);
  });
});

function createSnapshot(): ProjectSnapshot {
  return {
    project: {
      createdAt: "2026-05-24T00:00:00.000Z",
      directory: "/project",
      id: "project_1",
      imageCount: 2,
      name: "测试项目",
      updatedAt: "2026-05-24T00:00:00.000Z"
    },
    sessions: [
      {
        chatMessages: [],
        chatStatus: "idle",
        fileName: "a.jpg",
        filePath: "/original/a.jpg",
        generatedFilePaths: ["/generated/a-1.png", "/generated/a-2.png"],
        id: "sess_1",
        status: "idle"
      },
      {
        chatMessages: [],
        chatStatus: "idle",
        fileName: "b.jpg",
        filePath: "/original/b.jpg",
        generatedFilePaths: ["/generated/b-1.png"],
        id: "sess_2",
        status: "idle"
      }
    ]
  };
}
