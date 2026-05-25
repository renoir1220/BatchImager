import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export function shouldSubmitComposerOnEnter(event: ReactKeyboardEvent<HTMLElement>): boolean {
  if (event.key !== "Enter" || event.shiftKey) {
    return false;
  }

  return !isImeCompositionEvent(event);
}

function isImeCompositionEvent(event: ReactKeyboardEvent<HTMLElement>): boolean {
  const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent & {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  };

  return nativeEvent.isComposing === true || event.key === "Process" || nativeEvent.keyCode === 229 || nativeEvent.which === 229;
}
