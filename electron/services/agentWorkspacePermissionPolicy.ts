import type { AgentPermissionRisk } from "../ipcTypes";

export type AgentWorkspacePermissionMode = "allow" | "ask";

export type AgentWorkspacePermissionPolicy = Record<AgentPermissionRisk, AgentWorkspacePermissionMode>;

export const DEFAULT_AGENT_WORKSPACE_PERMISSION_POLICY: AgentWorkspacePermissionPolicy = {
  read: "allow",
  "safe-write": "allow",
  destructive: "ask",
  "external-write": "ask"
};
