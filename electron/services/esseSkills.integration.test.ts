import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createProject, saveProjectSnapshot } from "./projectStore";

const require = createRequire(import.meta.url);
const yauzl = require("yauzl") as {
  open: (
    filePath: string,
    options: { lazyEntries: boolean },
    callback: (error: Error | null, zipFile?: {
      close: () => void;
      on: (event: string, listener: (...args: unknown[]) => void) => void;
      readEntry: () => void;
    }) => void
  ) => void;
};

let tempDirectory: string;

beforeEach(async () => {
  tempDirectory = await mkdtemp(path.join(os.tmpdir(), "batchimager-skills-integration-"));
});

afterEach(async () => {
  await rm(tempDirectory, { force: true, recursive: true });
});

describe("built-in Esse skills", () => {
  test("xlsx-export, pdf-portfolio, and project-package produce usable artifacts", async () => {
    const project = await createFixtureProject();
    const skillsRoot = path.join(tempDirectory, "skills");
    await cp(path.join(process.cwd(), "resources", "built-in-skills"), skillsRoot, { recursive: true });
    await installSkillDependencies(path.join(skillsRoot, "xlsx-export"));
    await installSkillDependencies(path.join(skillsRoot, "pdf-portfolio"));
    await installSkillDependencies(path.join(skillsRoot, "project-package"));

    const exportsDirectory = path.join(project.project.directory, "exports");
    const xlsxPath = path.join(exportsDirectory, "all-sessions.xlsx");
    const pdfPath = path.join(exportsDirectory, "portfolio.pdf");
    const zipPath = path.join(exportsDirectory, "delivery.zip");

    await runNodeScript(path.join(skillsRoot, "xlsx-export", "scripts", "export.mjs"), [
      "--project",
      project.project.directory,
      "--output",
      xlsxPath
    ]);
    const rows = await readXlsxRows(path.join(skillsRoot, "xlsx-export"), xlsxPath);
    expect(rows).toEqual([
      expect.objectContaining({
        image_index: 1,
        image_path: "images/generated/sess_a-home.png",
        prompt: "温馨室内家居商品图",
        session_label: "进口白色郁金香单品拍摄图",
        sku: "sess_a",
        status: "completed"
      })
    ]);

    await runNodeScript(path.join(skillsRoot, "pdf-portfolio", "scripts", "portfolio.mjs"), [
      "--project",
      project.project.directory,
      "--output",
      pdfPath,
      "--title",
      "鲜花作品集"
    ]);
    await expect(readFile(pdfPath, "utf8")).resolves.toContain("%PDF");
    await expect(stat(pdfPath)).resolves.toMatchObject({ size: expect.any(Number) });

    await runNodeScript(path.join(skillsRoot, "project-package", "scripts", "package.mjs"), [
      "--project",
      project.project.directory,
      "--output",
      zipPath
    ]);
    await expect(listZipEntries(zipPath)).resolves.toEqual(expect.arrayContaining([
      "image-list.xlsx",
      "images/1-1-sess_a-home.png",
      "manifest.json",
      "project-path.txt"
    ]));
  }, 120_000);
});

async function createFixtureProject() {
  const projectsDirectory = path.join(tempDirectory, "projects");
  const project = await createProject({
    makeId: () => "project-1",
    makeNow: () => new Date("2026-05-24T08:00:00.000Z"),
    projectsDirectory
  });
  const originalPath = path.join(project.project.directory, "images", "original", "sess_a-original.png");
  const generatedPath = path.join(project.project.directory, "images", "generated", "sess_a-home.png");
  await mkdir(path.dirname(originalPath), { recursive: true });
  await mkdir(path.dirname(generatedPath), { recursive: true });
  await sharp({
    create: {
      background: "#fff8ee",
      channels: 4,
      height: 16,
      width: 16
    }
  }).png().toFile(originalPath);
  await sharp({
    create: {
      background: "#f6dcc2",
      channels: 4,
      height: 16,
      width: 16
    }
  }).png().toFile(generatedPath);

  return await saveProjectSnapshot(project.project.directory, {
    selectedSessionId: "sess_a",
    sessions: [
      {
        chatMessages: [],
        chatStatus: "idle",
        fileName: "进口白色郁金香单品拍摄图",
        filePath: originalPath,
        generatedFilePath: generatedPath,
        generatedFilePaths: [generatedPath],
        id: "sess_a",
        lastPrompt: "温馨室内家居商品图",
        status: "completed"
      }
    ]
  });
}

async function installSkillDependencies(skillDirectory: string): Promise<void> {
  await execFilePromise("npm", ["install", "--omit=dev", "--ignore-scripts"], { cwd: skillDirectory });
}

async function runNodeScript(scriptPath: string, args: string[]): Promise<void> {
  await execFilePromise(process.execPath, [scriptPath, ...args], { cwd: path.dirname(scriptPath) });
}

function execFilePromise(command: string, args: string[], options: { cwd: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${command} ${args.join(" ")} failed\n${stdout}\n${stderr}`));
        return;
      }

      resolve();
    });
    child.stdout?.resume();
    child.stderr?.resume();
  });
}

async function readXlsxRows(skillDirectory: string, xlsxPath: string): Promise<Array<Record<string, unknown>>> {
  const skillRequire = createRequire(path.join(skillDirectory, "package.json"));
  const xlsx = skillRequire("xlsx") as {
    readFile: (filePath: string) => unknown;
    utils: {
      sheet_to_json: (worksheet: unknown) => Array<Record<string, unknown>>;
    };
  };
  const workbook = xlsx.readFile(xlsxPath) as { SheetNames: string[]; Sheets: Record<string, unknown> };
  return xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
}

function listZipEntries(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error("Unable to open zip"));
        return;
      }

      const entries: string[] = [];
      zipFile.on("entry", (entry) => {
        if (typeof entry === "object" && entry !== null && "fileName" in entry && typeof entry.fileName === "string") {
          entries.push(entry.fileName);
        }
        zipFile.readEntry();
      });
      zipFile.on("end", () => {
        zipFile.close();
        resolve(entries);
      });
      zipFile.on("error", reject);
      zipFile.readEntry();
    });
  });
}
