import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import PDFDocument from "pdfkit";

const args = parseArgs(process.argv.slice(2));
const projectDirectory = requireArg(args.project, "--project");
const outputPath = path.resolve(requireArg(args.output, "--output"));
const title = args.title || "BatchImager 作品集";
const selectedSessionIds = parseSessionIds(args.sessions);
const entries = readImageEntries(projectDirectory, selectedSessionIds);

await mkdir(path.dirname(outputPath), { recursive: true });
await writePortfolio({ entries, outputPath, projectDirectory, title });

console.log(`Exported ${entries.length} images.`);
console.log(`[BATCHIMAGER_OUTPUT] ${outputPath}`);

function readImageEntries(projectDirectory, selectedSessionIds) {
  const db = new DatabaseSync(path.join(projectDirectory, "project.sqlite"), { readOnly: true });
  try {
    const sessions = db.prepare("select * from image_sessions order by sort_order asc").all();
    return sessions
      .filter((session) => selectedSessionIds.size === 0 || selectedSessionIds.has(session.id))
      .flatMap((session, sessionIndex) => {
        const generatedPaths = parseJsonArray(session.generated_file_paths_json);
        const imagePaths = generatedPaths.length > 0 ? generatedPaths : [session.generated_file_path].filter(Boolean);
        return imagePaths.map((imagePath, imageIndex) => ({
          imageIndex: imageIndex + 1,
          imagePath,
          prompt: session.last_prompt ?? "",
          sessionIndex: sessionIndex + 1,
          sessionLabel: session.file_name
        }));
      });
  } finally {
    db.close();
  }
}

function writePortfolio({ entries, outputPath, projectDirectory, title }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, margin: 42, size: "A4" });
    const stream = createWriteStream(outputPath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);

    doc.addPage();
    doc.fontSize(28).text(title, { align: "center" });
    doc.moveDown();
    doc.fontSize(12).fillColor("#666666").text(`项目：${projectDirectory}`, { align: "center" });
    doc.moveDown();
    doc.text(`图片数：${entries.length}`, { align: "center" });

    for (const entry of entries) {
      doc.addPage();
      const imageBox = {
        height: doc.page.height - 150,
        width: doc.page.width - 84,
        x: 42,
        y: 42
      };
      try {
        doc.image(entry.imagePath, imageBox.x, imageBox.y, { fit: [imageBox.width, imageBox.height], align: "center", valign: "center" });
      } catch (error) {
        doc.fontSize(12).fillColor("#b42318").text(`图片无法嵌入：${entry.imagePath}`);
      }
      doc.fillColor("#242522").fontSize(10).text(`${entry.sessionIndex}.${entry.imageIndex} ${entry.sessionLabel}`, 42, doc.page.height - 92, {
        width: doc.page.width - 84
      });
      if (entry.prompt) {
        doc.fillColor("#666666").fontSize(9).text(entry.prompt, 42, doc.page.height - 72, {
          height: 42,
          width: doc.page.width - 84
        });
      }
    }

    doc.end();
  });
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
