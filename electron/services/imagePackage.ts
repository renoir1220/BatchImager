import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface PackageGeneratedImagesOptions {
  desktopDirectory: string;
  fileName?: string;
  imagePaths: string[];
}

interface PackageGeneratedImagesResult {
  outputPath: string;
}

interface ZipEntry {
  crc32: number;
  data: Buffer;
  fileName: string;
  localHeaderOffset: number;
}

const DEFAULT_PACKAGE_NAME = "BatchImager-生成图片.zip";

export async function packageGeneratedImages(options: PackageGeneratedImagesOptions): Promise<PackageGeneratedImagesResult> {
  const imagePaths = [...new Set(options.imagePaths.filter(Boolean))];

  if (imagePaths.length === 0) {
    throw new Error("没有可打包的生成图片");
  }

  const entries: ZipEntry[] = [];

  for (const [index, imagePath] of imagePaths.entries()) {
    const data = await readFile(imagePath);
    entries.push({
      crc32: crc32(data),
      data,
      fileName: toZipFileName(imagePath, index),
      localHeaderOffset: 0
    });
  }

  await mkdir(options.desktopDirectory, { recursive: true });
  const outputPath = path.join(options.desktopDirectory, toSafeZipName(options.fileName));
  await writeFile(outputPath, buildZip(entries));

  return { outputPath };
}

function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    entry.localHeaderOffset = offset;
    const localHeader = createLocalHeader(entry);
    localParts.push(localHeader, entry.data);
    offset += localHeader.byteLength + entry.data.byteLength;
  }

  const centralDirectoryOffset = offset;

  for (const entry of entries) {
    const centralHeader = createCentralDirectoryHeader(entry);
    centralParts.push(centralHeader);
    offset += centralHeader.byteLength;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  const endRecord = createEndOfCentralDirectory(entries.length, centralDirectorySize, centralDirectoryOffset);

  return Buffer.concat([...localParts, ...centralParts, endRecord]);
}

function createLocalHeader(entry: ZipEntry): Buffer {
  const fileName = Buffer.from(entry.fileName, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(entry.crc32, 14);
  header.writeUInt32LE(entry.data.byteLength, 18);
  header.writeUInt32LE(entry.data.byteLength, 22);
  header.writeUInt16LE(fileName.byteLength, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, fileName]);
}

function createCentralDirectoryHeader(entry: ZipEntry): Buffer {
  const fileName = Buffer.from(entry.fileName, "utf8");
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(entry.data.byteLength, 20);
  header.writeUInt32LE(entry.data.byteLength, 24);
  header.writeUInt16LE(fileName.byteLength, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.localHeaderOffset, 42);

  return Buffer.concat([header, fileName]);
}

function createEndOfCentralDirectory(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number): Buffer {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralDirectorySize, 12);
  record.writeUInt32LE(centralDirectoryOffset, 16);
  record.writeUInt16LE(0, 20);

  return record;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function toZipFileName(filePath: string, index: number): string {
  const ext = path.extname(filePath) || ".png";
  const stem = path.basename(filePath, ext).replace(/[\\/:*?"<>|]+/g, "-") || `image-${index + 1}`;

  return `${String(index + 1).padStart(2, "0")}-${stem}${ext}`;
}

function toSafeZipName(fileName: string | undefined): string {
  const candidate = fileName?.trim() || DEFAULT_PACKAGE_NAME;
  const safe = candidate.replace(/[\\/:*?"<>|]+/g, "-");

  return safe.toLowerCase().endsWith(".zip") ? safe : `${safe}.zip`;
}
