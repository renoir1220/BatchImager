/// <reference types="vite/client" />

import type { BatchImagerApi } from "../electron/preload";

declare global {
  interface Window {
    batchImager?: BatchImagerApi;
  }
}
