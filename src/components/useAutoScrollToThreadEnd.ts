import { useLayoutEffect, type RefObject } from "react";

export function useAutoScrollToThreadEnd(
  containerRef: RefObject<HTMLElement | null>,
  contentSignature: string
): void {
  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    if (typeof container.scrollTo === "function") {
      container.scrollTo({
        behavior: "auto",
        top: container.scrollHeight
      });
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [containerRef, contentSignature]);
}
