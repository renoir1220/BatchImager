import type { EssePermissionRisk } from "../ipcTypes";

export type EssePermissionMode = "allow" | "ask";

export type EssePermissionPolicy = Record<EssePermissionRisk, EssePermissionMode>;

export const DEFAULT_ESSE_PERMISSION_POLICY: EssePermissionPolicy = {
  read: "allow",
  "safe-write": "allow",
  destructive: "ask",
  "external-write": "ask"
};
