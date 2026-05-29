import {
  forwardRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useImperativeHandle,
  useRef
} from "react";
import { shouldSubmitComposerOnEnter } from "./composerKeyEvents";

export interface InlineComposerReference {
  fileName: string;
  filePath: string;
  id: string;
  previewUrl: string;
}

export interface InlineComposerSnapshot {
  referenceImagePaths: string[];
  text: string;
}

export interface InlineReferenceComposerHandle {
  clear: () => void;
  insertReference: (reference: InlineComposerReference) => void;
  snapshot: () => InlineComposerSnapshot;
}

interface InlineReferenceComposerProps {
  ariaLabel?: string;
  footer?: ReactNode;
  onChange: (snapshot: InlineComposerSnapshot) => void;
  onOpenReference: (filePath: string) => void;
  onRemoveReference?: (filePath: string) => void;
  onSubmit: () => void;
  placeholder: string;
}

export const InlineReferenceComposer = forwardRef<InlineReferenceComposerHandle, InlineReferenceComposerProps>(
  function InlineReferenceComposer({ ariaLabel = "智能体输入", footer, onChange, onOpenReference, onRemoveReference, onSubmit, placeholder }, ref) {
    const editorRef = useRef<HTMLDivElement>(null);
    const referencesRef = useRef(new Map<string, InlineComposerReference>());
    const savedRangeRef = useRef<Range | null>(null);
    const draggedReferenceIdRef = useRef<string | null>(null);

    useImperativeHandle(ref, () => ({
      clear() {
        if (editorRef.current) {
          editorRef.current.replaceChildren();
        }
        referencesRef.current.clear();
        savedRangeRef.current = null;
        emitChange();
      },
      insertReference(reference) {
        const existing = findReferenceNodeByPath(reference.filePath);
        if (existing) {
          moveNodeToSavedRange(existing);
          updateReferenceLabels();
          emitChange();
          return;
        }

        referencesRef.current.set(reference.id, reference);
        insertNodeAtSavedRange(createReferenceChip(reference));
        insertTextAtCurrentSelection(" ");
        updateReferenceLabels();
        emitChange();
      },
      snapshot: () => serializeEditor()
    }));

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
      if (shouldSubmitComposerOnEnter(event)) {
        event.preventDefault();
        onSubmit();
      }
    }

    function handleInput(): void {
      updateSavedRange();
      updateReferenceLabels();
      emitChange();
    }

    function handleClick(event: MouseEvent<HTMLDivElement>): void {
      handleReferenceClick(event);
      updateSavedRange();
      emitChange();
    }

    function handleReferenceClick(event: MouseEvent<HTMLDivElement>): void {
      const target = event.target as HTMLElement | null;
      const removeButton = target?.closest<HTMLButtonElement>(".inline-reference-remove");
      const chip = target?.closest<HTMLElement>("[data-inline-reference-id]");
      if (!chip) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const reference = referencesRef.current.get(chip.dataset.inlineReferenceId ?? "");
      if (!reference) {
        return;
      }

      if (removeButton) {
        chip.remove();
        referencesRef.current.delete(reference.id);
        onRemoveReference?.(reference.filePath);
        updateReferenceLabels();
        emitChange();
        return;
      }

      onOpenReference(reference.filePath);
    }

    function handleDragStart(event: React.DragEvent<HTMLDivElement>): void {
      const chip = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-inline-reference-id]");
      if (!chip) {
        return;
      }

      draggedReferenceIdRef.current = chip.dataset.inlineReferenceId ?? null;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", chip.textContent?.trim() ?? "");
    }

    function handleDragOver(event: React.DragEvent<HTMLDivElement>): void {
      if (!draggedReferenceIdRef.current) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }

    function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
      const referenceId = draggedReferenceIdRef.current;
      if (!referenceId) {
        return;
      }

      const chip = findReferenceNodeById(referenceId);
      const range = getDropRange(event);
      if (!chip || !range) {
        draggedReferenceIdRef.current = null;
        return;
      }

      event.preventDefault();
      chip.remove();
      range.insertNode(chip);
      const spacer = document.createTextNode(" ");
      chip.after(spacer);
      range.setStartAfter(spacer);
      range.collapse(true);
      restoreSelection(range);
      savedRangeRef.current = range;
      draggedReferenceIdRef.current = null;
      updateReferenceLabels();
      emitChange();
    }

    function handlePaste(event: ClipboardEvent<HTMLDivElement>): void {
      const html = event.clipboardData.getData("text/html");
      const pastedReferences = parseInlineReferenceClipboardHtml(html);
      if (pastedReferences.length === 0) {
        return;
      }

      event.preventDefault();
      for (const part of pastedReferences) {
        if (part.type === "text") {
          insertTextAtCurrentSelection(part.text);
          continue;
        }

        referencesRef.current.set(part.reference.id, part.reference);
        insertNodeAtSavedRange(createReferenceChip(part.reference));
      }
      updateReferenceLabels();
      emitChange();
    }

    function createReferenceChip(reference: InlineComposerReference): HTMLSpanElement {
      const chip = document.createElement("span");
      chip.className = "inline-reference-chip";
      chip.contentEditable = "false";
      chip.draggable = true;
      chip.dataset.inlineReferenceId = reference.id;

      const image = document.createElement("img");
      image.alt = reference.fileName;
      image.draggable = false;
      image.src = reference.previewUrl;

      const label = document.createElement("span");
      label.className = "inline-reference-label";
      label.textContent = "图片";

      const remove = document.createElement("button");
      remove.className = "inline-reference-remove";
      remove.type = "button";
      remove.ariaLabel = `移除图片 ${reference.fileName}`;
      remove.textContent = "×";

      chip.append(image, label, remove);
      return chip;
    }

    function moveNodeToSavedRange(node: HTMLElement): void {
      node.remove();
      insertNodeAtSavedRange(node);
      insertTextAtCurrentSelection(" ");
    }

    function insertNodeAtSavedRange(node: Node): void {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }

      editor.focus();
      const range = getUsableSavedRange() ?? document.createRange();
      if (!range.commonAncestorContainer || !editor.contains(range.commonAncestorContainer)) {
        range.selectNodeContents(editor);
        range.collapse(false);
      }
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      restoreSelection(range);
      savedRangeRef.current = range;
    }

    function insertTextAtCurrentSelection(text: string): void {
      const editor = editorRef.current;
      const selection = window.getSelection();
      const selectedRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const range =
        selectedRange && editor && (editor.contains(selectedRange.commonAncestorContainer) || editor === selectedRange.commonAncestorContainer)
          ? selectedRange
          : getUsableSavedRange() ?? createEditorEndRange(editor);
      if (!range) {
        return;
      }
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      restoreSelection(range);
      savedRangeRef.current = range;
    }

    function createEditorEndRange(editor: HTMLDivElement | null): Range | null {
      if (!editor) {
        return null;
      }

      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      return range;
    }

    function getUsableSavedRange(): Range | null {
      const editor = editorRef.current;
      const range = savedRangeRef.current;
      if (!editor || !range) {
        return null;
      }

      return editor.contains(range.commonAncestorContainer) || editor === range.commonAncestorContainer ? range : null;
    }

    function getDropRange(event: React.DragEvent<HTMLDivElement>): Range | null {
      if ("caretPositionFromPoint" in document) {
        const position = document.caretPositionFromPoint(event.clientX, event.clientY);
        if (position) {
          const range = document.createRange();
          range.setStart(position.offsetNode, position.offset);
          range.collapse(true);
          return range;
        }
      }

      const legacyDocument = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      return legacyDocument.caretRangeFromPoint?.(event.clientX, event.clientY) ?? savedRangeRef.current;
    }

    function updateSavedRange(): void {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection?.rangeCount) {
        return;
      }

      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer) || editor === range.commonAncestorContainer) {
        savedRangeRef.current = range.cloneRange();
      }
    }

    function restoreSelection(range: Range): void {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    function serializeEditor(): InlineComposerSnapshot {
      const editor = editorRef.current;
      if (!editor) {
        return { referenceImagePaths: [], text: "" };
      }

      let imageIndex = 0;
      const referenceImagePaths: string[] = [];
      const text = serializeNode(editor, () => {
        imageIndex += 1;
        return imageIndex;
      }, referenceImagePaths).replace(/\u00a0/g, " ").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim();

      return { referenceImagePaths, text };
    }

    function serializeNode(node: Node, nextImageIndex: () => number, referenceImagePaths: string[]): string {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent ?? "";
      }

      if (!(node instanceof HTMLElement)) {
        return "";
      }

      const referenceId = node.dataset.inlineReferenceId;
      if (referenceId) {
        const reference = referencesRef.current.get(referenceId);
        if (reference) {
          referenceImagePaths.push(reference.filePath);
        }
        return `【图片${nextImageIndex()}】`;
      }

      if (node.tagName === "BR") {
        return "\n";
      }

      return Array.from(node.childNodes).map((child) => serializeNode(child, nextImageIndex, referenceImagePaths)).join("");
    }

    function updateReferenceLabels(): void {
      for (const [index, chip] of getReferenceNodes().entries()) {
        const label = chip.querySelector<HTMLElement>(".inline-reference-label");
        if (label) {
          label.textContent = `图片${index + 1}`;
        }
      }
    }

    function emitChange(): void {
      onChange(serializeEditor());
    }

    function getReferenceNodes(): HTMLElement[] {
      return Array.from(editorRef.current?.querySelectorAll<HTMLElement>("[data-inline-reference-id]") ?? []);
    }

    function findReferenceNodeById(referenceId: string): HTMLElement | null {
      return editorRef.current?.querySelector<HTMLElement>(`[data-inline-reference-id="${CSS.escape(referenceId)}"]`) ?? null;
    }

    function findReferenceNodeByPath(filePath: string): HTMLElement | null {
      for (const chip of getReferenceNodes()) {
        const reference = referencesRef.current.get(chip.dataset.inlineReferenceId ?? "");
        if (reference?.filePath === filePath) {
          return chip;
        }
      }
      return null;
    }

    return (
      <div className="inline-composer-shell">
        <div
          aria-label={ariaLabel}
          className="inline-reference-composer"
          contentEditable
          data-placeholder={placeholder}
          role="textbox"
          tabIndex={0}
          onClick={handleClick}
          onDragOver={handleDragOver}
          onDragStart={handleDragStart}
          onDrop={handleDrop}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onKeyUp={updateSavedRange}
          onMouseUp={updateSavedRange}
          onPaste={handlePaste}
          ref={editorRef}
          suppressContentEditableWarning
        />
        {footer}
      </div>
    );
  }
);

type InlineReferencePastePart =
  | { text: string; type: "text" }
  | { reference: InlineComposerReference; type: "reference" };

function parseInlineReferenceClipboardHtml(html: string): InlineReferencePastePart[] {
  if (!html.includes("data-batchimager-reference-path")) {
    return [];
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  const parts: InlineReferencePastePart[] = [];

  for (const child of Array.from(template.content.childNodes)) {
    collectInlineReferencePasteParts(child, parts);
  }

  return parts.filter((part) => part.type === "reference" || part.text.length > 0);
}

function collectInlineReferencePasteParts(node: Node, parts: InlineReferencePastePart[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    parts.push({ text: node.textContent ?? "", type: "text" });
    return;
  }

  if (!(node instanceof HTMLElement)) {
    return;
  }

  const filePath = node.dataset.batchimagerReferencePath;
  if (filePath) {
    const fileName = node.dataset.batchimagerReferenceName || getFileNameFromPath(filePath);
    parts.push({
      reference: {
        fileName,
        filePath,
        id: `pasted-inline-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        previewUrl: window.batchImager?.getImageUrl(filePath) ?? filePath
      },
      type: "reference"
    });
    return;
  }

  if (node.tagName === "BR") {
    parts.push({ text: "\n", type: "text" });
    return;
  }

  for (const child of Array.from(node.childNodes)) {
    collectInlineReferencePasteParts(child, parts);
  }
}

function getFileNameFromPath(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return filePath.slice(lastSlash + 1) || "reference.png";
}
