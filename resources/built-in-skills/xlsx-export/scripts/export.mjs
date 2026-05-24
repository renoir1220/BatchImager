import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as XLSX from "xlsx";

const args = parseArgs(process.argv.slice(2));
const projectDirectory = requireArg(args.project, "--project");
const outputPath = path.resolve(requireArg(args.output, "--output"));
const selectedSessionIds = parseSessionIds(args.sessions);

await mkdir(path.dirname(outputPath), { recursive: true });
const rows = readExportRows(projectDirectory, selectedSessionIds);
const workbook = XLSX.utils.book_new();
const worksheet = XLSX.utils.json_to_sheet(rows);
worksheet["!cols"] = [
  { wch: 14 },
  { wch: 28 },
  { wch: 12 },
  { wch: 18 },
  { wch: 16 },
  { wch: 52 },
  { wch: 80 }
];
XLSX.utils.book_append_sheet(workbook, worksheet, "BatchImager");
XLSX.writeFile(workbook, outputPath);

console.log(`Exported ${rows.length} rows.`);
console.log(`[BATCHIMAGER_OUTPUT] ${outputPath}`);

function readExportRows(projectDirectory, selectedSessionIds) {
  const db = new DatabaseSync(path.join(projectDirectory, "project.sqlite"), { readOnly: true });
  try {
    const sessions = db.prepare("select * from image_sessions order by sort_order asc").all();
    return sessions
      .filter((session) => selectedSessionIds.size === 0 || selectedSessionIds.has(session.id))
      .flatMap((session, sessionIndex) => {
        const generatedPaths = parseJsonArray(session.generated_file_paths_json);
        const imagePaths = generatedPaths.length > 0 ? generatedPaths : [session.generated_file_path].filter(Boolean);
        const rows = imagePaths.length > 0 ? imagePaths : [session.file_path];
        return rows.map((imagePath, imageIndex) => ({
          sku: session.id,
          session_label: session.file_name,
          session_order: sessionIndex + 1,
          image_index: imageIndex + 1,
          status: session.status,
          image_path: toRelative(projectDirectory, imagePath),
          prompt: session.last_prompt ?? ""
        }));
      });
  } finally {
    db.close();
  }
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
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
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
