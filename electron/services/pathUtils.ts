import path from "node:path";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;

export function isWindowsAbsolutePath(value: string): boolean {
  return WINDOWS_ABSOLUTE_PATH_PATTERN.test(value.trim());
}

export function joinPathPreservingRoot(root: string, ...segments: string[]): string {
  const trimmedRoot = root.trim();

  if (isWindowsAbsolutePath(trimmedRoot)) {
    return [trimmedRoot.replace(/[\\/]+$/, ""), ...segments.map((segment) => segment.replace(/^[\\/]+|[\\/]+$/g, ""))].join("\\");
  }

  return path.join(trimmedRoot, ...segments);
}

export function normalizePathForComparison(value: string): string {
  return resolvePathForComparison(value).replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function resolvePathForComparison(value: string): string {
  const trimmed = value.trim();

  if (isWindowsAbsolutePath(trimmed)) {
    return trimmed.replace(/\//g, "\\").replace(/\\+$/, "");
  }

  return path.resolve(trimmed);
}

export function isPathInsideOrSame(targetPath: string, rootPath: string): boolean {
  const target = normalizePathForComparison(targetPath);
  const root = normalizePathForComparison(rootPath);

  return target === root || target.startsWith(`${root}/`);
}
