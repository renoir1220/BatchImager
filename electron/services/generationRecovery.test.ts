import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createProject, openProject, saveProjectSnapshot } from "./projectStore";
import {
  markGenerationJobCompleted,
  markGenerationJobFailed,
  markGenerationJobRemoteReceived,
  recoverInterruptedGenerationJobs,
  startGenerationJob
} from "./generationRecovery";

const tempRoots: string[] = [];

describe("generationRecovery", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { force: true, recursive: true })));
    tempRoots.length = 0;
  });

  test("downloads a remote image for an interrupted job that already received a result url", async () => {
    const project = await makeProject();
    const sourcePath = path.join(project.project.directory, "images", "original", "img-1-flower.png");
    await saveProjectSnapshot(project.project.directory, {
      selectedSessionId: "img-1",
      sessions: [
        {
          chatMessages: [],
          chatStatus: "idle",
          fileName: "flower.png",
          filePath: sourcePath,
          id: "img-1",
          lastPrompt: "白底商品图",
          status: "generating"
        }
      ]
    });
    await startGenerationJob(project.project.directory, {
      imagePath: sourcePath,
      mode: "edit",
      prompt: "白底商品图",
      sessionId: "img-1"
    });
    await markGenerationJobRemoteReceived(project.project.directory, {
      remoteUrl: "https://cdn.example.com/generated.png",
      requestSize: "1536x1024",
      sessionId: "img-1"
    });

    const recovered = await recoverInterruptedGenerationJobs(project.project.directory, {
      fetch: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      makeNow: () => new Date("2026-05-22T08:00:00.000Z")
    });

    expect(recovered).toEqual({ completed: 1, failed: 0 });
    const reopened = await openProject(project.project.directory);
    expect(reopened.sessions[0]).toMatchObject({
      generatedFilePath: expect.stringContaining("img-1-2026-05-22T08-00-00-000Z.png"),
      generatedFilePaths: [expect.stringContaining("img-1-2026-05-22T08-00-00-000Z.png")],
      status: "completed"
    });
    await expect(readFile(reopened.sessions[0].generatedFilePath ?? "")).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  test("marks interrupted jobs without a recoverable url as failed so they stop spinning", async () => {
    const project = await makeProject();
    const sourcePath = path.join(project.project.directory, "images", "original", "img-1-flower.png");
    await saveProjectSnapshot(project.project.directory, {
      selectedSessionId: "img-1",
      sessions: [
        {
          chatMessages: [],
          chatStatus: "idle",
          fileName: "flower.png",
          filePath: sourcePath,
          id: "img-1",
          lastPrompt: "白底商品图",
          status: "generating"
        }
      ]
    });
    await startGenerationJob(project.project.directory, {
      imagePath: sourcePath,
      mode: "edit",
      prompt: "白底商品图",
      sessionId: "img-1"
    });

    const recovered = await recoverInterruptedGenerationJobs(project.project.directory);

    expect(recovered).toEqual({ completed: 0, failed: 1 });
    await expect(openProject(project.project.directory)).resolves.toMatchObject({
      sessions: [
        {
          errorMessage: "上次生成中断，未拿到可恢复的图片地址。请重试。",
          status: "failed"
        }
      ]
    });
  });

  test("keeps completed and failed jobs out of recovery", async () => {
    const project = await makeProject();
    await startGenerationJob(project.project.directory, {
      mode: "generate",
      prompt: "生成新图",
      sessionId: "img-1"
    });
    await markGenerationJobCompleted(project.project.directory, {
      outputPath: "C:/generated/out.png",
      sessionId: "img-1"
    });
    await startGenerationJob(project.project.directory, {
      mode: "generate",
      prompt: "生成新图",
      sessionId: "img-2"
    });
    await markGenerationJobFailed(project.project.directory, {
      errorMessage: "接口失败",
      sessionId: "img-2"
    });

    await expect(recoverInterruptedGenerationJobs(project.project.directory)).resolves.toEqual({ completed: 0, failed: 0 });
  });
});

async function makeProject(): Promise<Awaited<ReturnType<typeof createProject>>> {
  const root = await mkdtemp(path.join(os.tmpdir(), "batchimager-generation-recovery-"));
  tempRoots.push(root);
  return createProject({
    makeId: () => "project-1",
    makeNow: () => new Date("2026-05-22T07:00:00.000Z"),
    projectsDirectory: root
  });
}
