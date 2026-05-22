export const DEFAULT_SESSION_PANEL_WIDTH = 324;
export const SESSION_PANEL_WIDTH_STORAGE_KEY = "batchimager.sessionPanelWidth";

const MIN_SESSION_PANEL_WIDTH = 280;
const MAX_SESSION_PANEL_WIDTH = 640;
const MIN_WORKSPACE_WIDTH = 420;

interface WidthStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function readStoredSessionPanelWidth(
  storage: Pick<WidthStorage, "getItem"> | undefined,
  viewportWidth: number
): number {
  const storedValue = storage?.getItem(SESSION_PANEL_WIDTH_STORAGE_KEY);
  const parsed = storedValue ? Number(storedValue) : DEFAULT_SESSION_PANEL_WIDTH;

  return clampSessionPanelWidth(parsed, viewportWidth);
}

export function saveStoredSessionPanelWidth(
  storage: Pick<WidthStorage, "setItem"> | undefined,
  width: number,
  viewportWidth: number
): number {
  const nextWidth = clampSessionPanelWidth(width, viewportWidth);
  storage?.setItem(SESSION_PANEL_WIDTH_STORAGE_KEY, String(nextWidth));

  return nextWidth;
}

export function clampSessionPanelWidth(width: number, viewportWidth: number): number {
  const viewportMax = Math.max(MIN_SESSION_PANEL_WIDTH, Math.min(MAX_SESSION_PANEL_WIDTH, viewportWidth - MIN_WORKSPACE_WIDTH));
  const numericWidth = Number.isFinite(width) ? width : DEFAULT_SESSION_PANEL_WIDTH;

  return Math.round(Math.min(Math.max(numericWidth, MIN_SESSION_PANEL_WIDTH), viewportMax));
}
