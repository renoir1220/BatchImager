import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import archiver from "archiver";

const args = parseArgs(process.argv.slice(2));
const projectDirectory = requireArg(args.project, "--project");
const outputPath = path.resolve(requireArg(args.output, "--output"));
const selectedSessionIds = parseSessionIds(args.sessions);
const manifest = readManifest(projectDirectory, selectedSessionIds);
const tempDirectory = path.join(os.tmpdir(), `batchimager-package-${Date.now()}`);
const manifestPath = path.join(tempDirectory, "manifest.json");
const xlsxPath = path.join(tempDirectory, "image-list.xlsx");
const xlsxExportScript = args.xlsxExportScript || path.resolve(getScriptDirectory(), "..", "..", "xlsx-export", "scripts", "export.mjs");

await mkdir(path.dirname(outputPath), { recursive: true });
await mkdir(tempDirectory, { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await runXlsxExport({ outputPath: xlsxPath, projectDirectory, selectedSessionIds, xlsxExportScript });
await writeZip({ manifest, manifestPath, outputPath, projectDirectory, xlsxPath });

console.log(`Packaged ${manifest.rows.length} images.`);
console.log(`[BATCHIMAGER_OUTPUT] ${outputPath}`);

function readManifest(projectDirectory, selectedSessionIds) {
  const db = new DatabaseSync(path.join(projectDirectory, "project.sqlite"), { readOnly: true });
  try {
    const project = db.prepare("select * from projects limit 1").get();
    const sessions = db.prepare("select * from image_sessions order by sort_order asc").all();
    const rows = sessions
      .filter((session) => selectedSessionIds.size === 0 || selectedSessionIds.has(session.id))
      .flatMap((session, sessionIndex) => {
        const generatedPaths = parseJsonArray(session.generated_file_paths_json);
        const imagePaths = generatedPaths.length > 0 ? generatedPaths : [session.generated_file_path].filter(Boolean);
        return imagePaths.map((imagePath, imageIndex) => ({
          imageIndex: imageIndex + 1,
          imagePath,
          prompt: session.last_prompt ?? "",
          sessionId: session.id,
          sessionLabel: session.file_name,
          sessionOrder: sessionIndex + 1,
          status: session.status
        }));
      });

    return {
      createdAt: new Date().toISOString(),
      project: {
        id: project?.id ?? "",
        name: project?.name ?? "",
        path: projectDirectory
      },
      rows
    };
  } finally {
    db.close();
  }
}

function writeZip({ manifest, manifestPath, outputPath, projectDirectory, xlsxPath }) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.file(manifestPath, { name: "manifest.json" });
    archive.file(xlsxPath, { name: "image-list.xlsx" });
    for (const row of manifest.rows) {
      archive.file(row.imagePath, { name: path.join("images", `${row.sessionOrder}-${row.imageIndex}-${path.basename(row.imagePath)}`) });
    }
    archive.append(`${projectDirectory}\n`, { name: "project-path.txt" });
    archive.finalize();
  });
}

function runXlsxExport({ outputPath, projectDirectory, selectedSessionIds, xlsxExportScript }) {
  const args = [
    xlsxExportScript,
    "--project",
    projectDirectory,
    "--output",
    outputPath
  ];
  if (selectedSessionIds.size > 0) {
    args.push("--sessions", [...selectedSessionIds].join(","));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "inherit", "inherit"]
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`xlsx-export failed with exit code ${code ?? "unknown"}`));
      }
    });
  });
}

function getScriptDirectory() {
  return path.dirname(fileURLToPath(import.meta.url));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    parsed[arg.slice(2)] = argv[index + 1] ?? "";
    index += 1;
  }
  return parsed;
}

function requireArg(value, name) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseSessionIds(value) {
  return new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean));
}

function parseJsonArray(value) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toRelative(root, filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}
