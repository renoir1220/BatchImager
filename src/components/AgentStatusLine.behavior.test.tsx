// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AgentStatusLine } from "./AgentStatusLine";

describe("AgentStatusLine", () => {
  test("shows an approximate token count while the agent is working", () => {
    render(<AgentStatusLine isWorking message="Esse 正在组织回复..." tokenCount={1280} />);

    expect(screen.getByText("Esse 正在组织回复...")).toBeInTheDocument();
    expect(screen.getByText("约 1.3k tokens")).toBeInTheDocument();
  });

  test("hides the token count when the agent is idle", () => {
    render(<AgentStatusLine isWorking={false} tokenCount={1280} />);

    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument();
  });
});
