const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".heif"
]);

export function isSupportedImagePath(filePath: string): boolean {
  const extension = getExtension(filePath);
  return SUPPORTED_IMAGE_EXTENSIONS.has(extension.toLowerCase());
}

export function dedupeImageFiles(filePaths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const filePath of filePaths) {
    if (!isSupportedImagePath(filePath)) {
      continue;
    }

    const normalized = filePath.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(filePath);
  }

  return result;
}

function getExtension(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const fileName = filePath.slice(lastSlash + 1);
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex <= 0) {
    return "";
  }

  return fileName.slice(dotIndex);
}
