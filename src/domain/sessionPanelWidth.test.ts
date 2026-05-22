import { describe, expect, test } from "vitest";
import {
  clampSessionPanelWidth,
  DEFAULT_SESSION_PANEL_WIDTH,
  readStoredSessionPanelWidth,
  saveStoredSessionPanelWidth
} from "./sessionPanelWidth";

describe("sessionPanelWidth", () => {
  test("uses the default width when no stored width exists", () => {
    const storage = new MemoryStorage();

    expect(readStoredSessionPanelWidth(storage, 1440)).toBe(DEFAULT_SESSION_PANEL_WIDTH);
  });

  test("restores a stored width clamped to the current viewport", () => {
    const storage = new MemoryStorage();
    storage.setItem("batchimager.sessionPanelWidth", "900");

    expect(readStoredSessionPanelWidth(storage, 1024)).toBe(604);
  });

  test("saves the clamped width as a rounded pixel value", () => {
    const storage = new MemoryStorage();

    const width = saveStoredSessionPanelWidth(storage, 418.6, 1440);

    expect(width).toBe(419);
    expect(storage.getItem("batchimager.sessionPanelWidth")).toBe("419");
  });

  test("keeps the panel within minimum and maximum bounds", () => {
    expect(clampSessionPanelWidth(120, 1440)).toBe(280);
    expect(clampSessionPanelWidth(900, 1440)).toBe(640);
  });
});

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
