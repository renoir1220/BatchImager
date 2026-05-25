interface InlineReferenceMessageProps {
  content: string;
  onOpenReference: (referenceFilePaths: string[], selectedPath: string) => void;
  referenceFilePaths?: string[];
}

export function InlineReferenceMessage({ content, onOpenReference, referenceFilePaths = [] }: InlineReferenceMessageProps) {
  return (
    <div className="inline-reference-message">
      {splitContentByImageTokens(content).map((part, index) => {
        if (part.type === "text") {
          return <TextWithLineBreaks key={`text-${index}`} text={part.text} />;
        }

        const filePath = referenceFilePaths[part.index - 1];
        if (!filePath) {
          return <span key={`missing-${index}`}>{part.raw}</span>;
        }

        return (
          <button
            className="inline-message-reference"
            key={`ref-${index}-${filePath}`}
            type="button"
            aria-label={`预览${part.raw}`}
            contentEditable={false}
            data-batchimager-reference-name={getFileNameFromPath(filePath)}
            data-batchimager-reference-path={filePath}
            onClick={() => onOpenReference(referenceFilePaths, filePath)}
          >
            <img src={window.batchImager?.getImageUrl(filePath) ?? filePath} alt={part.raw} draggable={false} />
            <span>{part.raw.slice(1, -1)}</span>
          </button>
        );
      })}
    </div>
  );
}

type InlineMessagePart =
  | { text: string; type: "text" }
  | { index: number; raw: string; type: "reference" };

function splitContentByImageTokens(content: string): InlineMessagePart[] {
  const parts: InlineMessagePart[] = [];
  const pattern = /【图片(\d+)】/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > cursor) {
      parts.push({ text: content.slice(cursor, match.index), type: "text" });
    }
    parts.push({ index: Number(match[1]), raw: match[0], type: "reference" });
    cursor = match.index + match[0].length;
  }

  if (cursor < content.length) {
    parts.push({ text: content.slice(cursor), type: "text" });
  }

  return parts;
}

function TextWithLineBreaks({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, index, lines) => (
        <span key={`${line}-${index}`}>
          {line}
          {index < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </>
  );
}

function getFileNameFromPath(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return filePath.slice(lastSlash + 1) || "reference.png";
}
