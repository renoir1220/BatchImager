import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import type { BatchImagerApi } from "../../electron/preload";

type BatchImagerApiMock = Partial<BatchImagerApi>;

const defaultBatchImagerApi: BatchImagerApiMock = {
  getImageUrl: (filePath: string) => `batchimager-test://${encodeURIComponent(filePath)}`
};

export function renderWithBatchImager(ui: ReactElement, api: BatchImagerApiMock = {}): RenderResult {
  window.batchImager = {
    ...defaultBatchImagerApi,
    ...api
  } as BatchImagerApi;

  return render(ui);
}
