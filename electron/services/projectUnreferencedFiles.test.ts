import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { ProjectSnapshot } from "../ipcTypes";
import { deleteProjectUnreferencedFiles, scanProjectUnreferencedFiles } from "./projectUnreferencedFiles";

describe("projectUnreferencedFiles", () => {
  test("scans generated files without exposing paths and ignores referenced files", async () => {
    const { generatedDirectory, snapshot } = await createProjectFixture();
    const referencedPath = path.join(generatedDirectory, "referenced.png");
    const orphanPath = path.join(generatedDirectory, "orphan.png");
    await writeFile(referencedPath, "referenced");
    await writeFile(orphanPath, "orphan");

    snapshot.sessions[0].generatedFilePaths = [referencedPath];
    snapshot.projectManagerState = {
      conversation: { id: "conversation-1", messages: [] },
      plans: []
    };

    const candidates = await scanProjectUnreferencedFiles(snapshot);

    expect(candidates).toEqual([
      {
        byteSize: "orphan".length,
        candidateId: expect.stringMatching(/^orphan_[a-f0-9]{16}$/),
        fileName: "orphan.png"
      }
    ]);
    expect(JSON.stringify(candidates)).not.toContain(orphanPath);
  });

  test("physically deletes only candidates that are still unreferenced after a fresh scan", async () => {
    const { generatedDirectory, snapshot } = await createProjectFixture();
    const stableOrphanPath = path.join(generatedDirectory, "stable-orphan.png");
    const laterReferencedPath = path.join(generatedDirectory, "later-referenced.png");
    await writeFile(stableOrphanPath, "stable");
    await writeFile(laterReferencedPath, "later");

    const candidates = await scanProjectUnreferencedFiles(snapshot);
    const stableCandidate = candidates.find((candidate) => candidate.fileName === "stable-orphan.png");
    const laterCandidate = candidates.find((candidate) => candidate.fileName === "later-referenced.png");
    expect(stableCandidate).toBeDefined();
    expect(laterCandidate).toBeDefined();

    snapshot.sessions[0].chatMessages.push({
      content: "后来引用了这张图",
      generatedFilePath: laterReferencedPath,
      id: "msg_1",
      role: "assistant"
    });

    const results = await deleteProjectUnreferencedFiles(snapshot, [stableCandidate?.candidateId ?? "", laterCandidate?.candidateId ?? ""]);

    expect(results).toEqual([
      expect.objectContaining({ fileName: "stable-orphan.png", status: "deleted" }),
      expect.objectContaining({
        candidateId: laterCandidate?.candidateId,
        reason: "candidate is no longer unreferenced or does not exist",
        status: "skipped"
      })
    ]);
    await expect(readFile(stableOrphanPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(laterReferencedPath, "utf8")).resolves.toBe("later");
  });
});

async function createProjectFixture(): Promise<{ generatedDirectory: string; projectDirectory: string; snapshot: ProjectSnapshot }> {
  const projectDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-unreferenced-"));
  const generatedDirectory = path.join(projectDirectory, "images", "generated");
  await mkdir(generatedDirectory, { recursive: true });

  return {
    generatedDirectory,
    projectDirectory,
    snapshot: {
      project: {
        createdAt: "2026-05-24T00:00:00.000Z",
        directory: projectDirectory,
        id: "project_1",
        imageCount: 1,
        name: "未引用文件测试",
        updatedAt: "2026-05-24T00:00:00.000Z"
      },
      selectedSessionId: "sess_1",
      sessions: [
        {
          chatMessages: [],
          chatStatus: "idle",
          fileName: "a.jpg",
          filePath: path.join(projectDirectory, "images", "original", "a.jpg"),
          id: "sess_1",
          status: "idle"
        }
      ]
    }
  };
}
