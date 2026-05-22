import type { ProjectManagerState } from "../types/projectManager";

interface ResolvedProjectManagerReferences {
  errorMessage?: string;
  referenceImagePaths: string[];
}

const REFERENCE_INTENT_PATTERN =
  /(?:参考图|附件|附图|这张参考|这个参考|那张参考|刚才.*图|之前.*图|上次.*图|第一个\s*prompt|第一条\s*prompt|沿用.*图|继续.*图)/i;

const MISSING_ATTACHMENT_PATTERN = /(?:附件|附图|参考图|刚才.*图|之前.*图|第一个\s*prompt.*图|第一条\s*prompt.*图)/i;

export function resolveProjectManagerReferenceImages(
  state: ProjectManagerState,
  content: string,
  pastedReferenceImagePaths: string[] = []
): ResolvedProjectManagerReferences {
  const pastedPaths = uniqueNonEmptyPaths(pastedReferenceImagePaths);

  if (pastedPaths.length > 0) {
    return { referenceImagePaths: pastedPaths };
  }

  const shouldReuseRecentReferences = REFERENCE_INTENT_PATTERN.test(content);
  const recentReferencePaths = shouldReuseRecentReferences ? getLatestConversationReferencePaths(state) : [];

  if (recentReferencePaths.length > 0) {
    return { referenceImagePaths: recentReferencePaths };
  }

  if (MISSING_ATTACHMENT_PATTERN.test(content)) {
    return {
      errorMessage: "我没有收到可用的参考图附件，请先粘贴或添加参考图后再发送。",
      referenceImagePaths: []
    };
  }

  return { referenceImagePaths: [] };
}

function getLatestConversationReferencePaths(state: ProjectManagerState): string[] {
  for (const message of [...state.conversation.messages].reverse()) {
    const paths = uniqueNonEmptyPaths(message.referenceFilePaths ?? []);

    if (paths.length > 0) {
      return paths;
    }
  }

  return [];
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
