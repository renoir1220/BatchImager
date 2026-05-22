import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

function readProjectFile(filePath: string): string {
  return readFileSync(resolve(process.cwd(), filePath), "utf8");
}

describe("right sidebar chat surface", () => {
  test("session and Esse messages render through the shared markdown component", () => {
    expect(readProjectFile("src/components/MarkdownMessage.tsx")).toContain("ReactMarkdown");
    expect(readProjectFile("src/components/MarkdownMessage.tsx")).toContain("remarkGfm");
    expect(readProjectFile("src/components/SessionPanel.tsx")).toContain("MarkdownMessage");
    expect(readProjectFile("src/components/ProjectPlanPanel.tsx")).toContain("MarkdownMessage");
  });

  test("message bubbles expose lightweight hover actions", () => {
    const sessionPanel = readProjectFile("src/components/SessionPanel.tsx");
    const projectPanel = readProjectFile("src/components/ProjectPlanPanel.tsx");
    const actions = readProjectFile("src/components/MessageActions.tsx");
    const styles = readProjectFile("src/styles.css");

    expect(sessionPanel).toContain("MessageActions");
    expect(projectPanel).toContain("MessageActions");
    expect(actions).toContain("message-actions");
    expect(styles).toContain(".message-row:hover .message-actions");
    expect(actions).toContain("复制");
  });

  test("right sidebar composer uses a multiline prompt surface", () => {
    const sessionPanel = readProjectFile("src/components/SessionPanel.tsx");
    const projectPanel = readProjectFile("src/components/ProjectPlanPanel.tsx");
    const styles = readProjectFile("src/styles.css");

    expect(sessionPanel).toContain("<textarea");
    expect(projectPanel).toContain("<textarea");
    expect(styles).toContain(".session-composer textarea");
    expect(styles).toContain("border-radius: 22px");
  });

  test("composer ratio controls do not repeat the active tab name", () => {
    const sessionPanel = readProjectFile("src/components/SessionPanel.tsx");
    const projectPanel = readProjectFile("src/components/ProjectPlanPanel.tsx");
    const styles = readProjectFile("src/styles.css");

    expect(sessionPanel).not.toContain("composer-agent-label");
    expect(projectPanel).not.toContain("composer-agent-label");
    expect(styles).not.toContain(".composer-agent-label");
  });

  test("assistant messages do not expose Lovart-style suggested next actions", () => {
    const sessionPanel = readProjectFile("src/components/SessionPanel.tsx");
    const projectPanel = readProjectFile("src/components/ProjectPlanPanel.tsx");
    const styles = readProjectFile("src/styles.css");

    expect(sessionPanel).not.toContain("SuggestedPromptActions");
    expect(projectPanel).not.toContain("SuggestedPromptActions");
    expect(sessionPanel).not.toContain("SESSION_SUGGESTED_PROMPTS");
    expect(projectPanel).not.toContain("ESSE_SUGGESTED_PROMPTS");
    expect(styles).not.toContain(".suggested-action-list");
  });

  test("chat image attachments render as lightweight asset cards", () => {
    const sessionPanel = readProjectFile("src/components/SessionPanel.tsx");
    const styles = readProjectFile("src/styles.css");

    expect(sessionPanel).toContain("thread-image-card");
    expect(sessionPanel).toContain("thread-image-title");
    expect(styles).toContain(".thread-image-card");
    expect(styles).toContain(".thread-image-title");
  });

  test("session and Esse chat images can be opened and copied from the thread", () => {
    const sessionPanel = readProjectFile("src/components/SessionPanel.tsx");
    const projectPanel = readProjectFile("src/components/ProjectPlanPanel.tsx");
    const app = readProjectFile("src/App.tsx");

    expect(sessionPanel).toContain("onOpenImagePreview");
    expect(sessionPanel).toContain("onContextMenu");
    expect(sessionPanel).toContain("onDoubleClick");
    expect(projectPanel).toContain("onOpenImagePreview");
    expect(projectPanel).toContain("onContextMenu");
    expect(projectPanel).toContain("onDoubleClick");
    expect(app).toContain("handleOpenChatImagePreview");
    expect(app).toContain("copyImageToClipboard");
  });

  test("assistant thread reads as a light content stream instead of stacked cards", () => {
    const styles = readProjectFile("src/styles.css");
    const assistantRule = styles.match(/\.thread-line\.assistant\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    const panelRule = styles.match(/\.session-panel\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

    expect(assistantRule).toContain("background: transparent");
    expect(assistantRule).toContain("border-color: transparent");
    expect(panelRule).toContain("background: var(--chat-surface)");
  });
});
