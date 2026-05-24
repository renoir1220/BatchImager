import { writeFile } from "node:fs/promises";
import { joinPathPreservingRoot } from "./pathUtils";

export interface SaveReferenceImageInput {
  data: ArrayBuffer;
  fileName?: string;
  mimeType: string;
}

export interface SavedReferenceImage {
  fileName: string;
  filePath: string;
}

interface SaveReferenceImageDeps {
  makeNow: () => Date;
  outputDirectory: string;
  writeFile: typeof writeFile;
}

const defaultDeps = {
  makeNow: () => new Date(),
  writeFile
};

export async function saveReferenceImage(
  input: SaveReferenceImageInput,
  deps: SaveReferenceImageDeps
): Promise<SavedReferenceImage> {
  if (!input.mimeType.startsWith("image/")) {
    throw new Error("Reference image must be an image");
  }

  const fileName = input.fileName?.trim() || `reference.${extensionForMimeType(input.mimeType)}`;
  const outputPath = joinPathPreservingRoot(
    deps.outputDirectory,
    `reference-${toTimestamp(deps.makeNow())}-${toSafeName(fileName)}.${extensionForMimeType(input.mimeType)}`
  );

  await deps.writeFile(outputPath, new Uint8Array(input.data));

  return {
    fileName,
    filePath: outputPath
  };
}

export function saveReferenceImageToDirectory(
  input: SaveReferenceImageInput,
  outputDirectory: string
): Promise<SavedReferenceImage> {
  return saveReferenceImage(input, { ...defaultDeps, outputDirectory });
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "png";
}

function toSafeName(value: string): string {
  return value
    .replace(/\.[a-zA-Z0-9]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "reference";
}

function toTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
