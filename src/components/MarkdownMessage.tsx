import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { renderEmojiShortcodes } from "./markdownEmoji";

interface MarkdownMessageProps {
  content: string;
}

const markdownComponents: Components = {
  a({ children, href }) {
    return (
      <a href={href} rel="noreferrer" target="_blank">
        {children}
      </a>
    );
  },
  img() {
    return null;
  }
};

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="message-markdown">
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {renderEmojiShortcodes(content)}
      </ReactMarkdown>
    </div>
  );
}
