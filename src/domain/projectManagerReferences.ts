import type { ProjectManagerState } from "../types/projectManager";

interface ResolvedProjectManagerReferences {
  errorMessage?: string;
  referenceImagePaths: string[];
}

export function resolveProjectManagerReferenceImages(
  _state: ProjectManagerState,
  _content: string,
  pastedReferenceImagePaths: string[] = []
): ResolvedProjectManagerReferences {
  return { referenceImagePaths: uniqueNonEmptyPaths(pastedReferenceImagePaths) };
}

function uniqueNonEmptyPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const path of paths) {
    const trimmedPath = path.trim();

    if (!trimmedPath || seen.has(trimmedPath)) {
      continue;
    }

    seen.add(trimmedPath);
    result.push(trimmedPath);
  }

  return result;
}
