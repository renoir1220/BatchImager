// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { renderWithBatchImager } from "../test/renderWithBatchImager";
import { ApiSettingsDialog } from "./ApiSettingsDialog";

describe("ApiSettingsDialog", () => {
  test("loads API settings without rendering saved keys", async () => {
    renderWithBatchImager(<ApiSettingsDialog onClose={vi.fn()} />, {
      getApiSettings: vi.fn().mockResolvedValue({
        configPath: "/Users/test/Library/Application Support/BatchImager/api-settings.json",
        imageApiKeyConfigured: true,
        imageBaseUrl: "https://image.example",
        imageModel: "gpt-image-2",
        llmApiKeyConfigured: true,
        llmBaseUrl: "https://llm.example",
        llmModel: "gpt-5.5"
      })
    });

    expect(await screen.findByRole("dialog", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByLabelText("图像 Base URL")).toHaveValue("https://image.example");
    expect(screen.getByLabelText("LLM Base URL")).toHaveValue("https://llm.example");
    expect(screen.getAllByText("密钥已设置")).toHaveLength(2);
    expect(screen.queryByDisplayValue("image-key")).not.toBeInTheDocument();
  });

  test("saves updated endpoints and newly entered keys", async () => {
    const user = userEvent.setup();
    const saveApiSettings = vi.fn().mockResolvedValue({
      imageApiKeyConfigured: true,
      imageBaseUrl: "https://image.next",
      imageModel: "gpt-image-2",
      llmApiKeyConfigured: true,
      llmBaseUrl: "https://llm.next",
      llmModel: "gpt-5.5"
    });

    renderWithBatchImager(<ApiSettingsDialog onClose={vi.fn()} />, {
      getApiSettings: vi.fn().mockResolvedValue({
        imageApiKeyConfigured: false,
        imageBaseUrl: "https://image.example",
        imageModel: "gpt-image-2",
        llmApiKeyConfigured: false,
        llmBaseUrl: "https://llm.example",
        llmModel: "gpt-5.5"
      }),
      saveApiSettings
    });

    const imageBaseUrl = await screen.findByLabelText("图像 Base URL");
    await user.clear(imageBaseUrl);
    await user.type(imageBaseUrl, "https://image.next");
    await user.type(screen.getByLabelText("图像 API Key"), "image-key");
    await user.clear(screen.getByLabelText("LLM Base URL"));
    await user.type(screen.getByLabelText("LLM Base URL"), "https://llm.next");
    await user.type(screen.getByLabelText("LLM API Key"), "llm-key");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(saveApiSettings).toHaveBeenCalledWith({
        imageApiKey: "image-key",
        imageBaseUrl: "https://image.next",
        imageModel: "gpt-image-2",
        llmApiKey: "llm-key",
        llmBaseUrl: "https://llm.next",
        llmModel: "gpt-5.5"
      })
    );
    expect(await screen.findByText("已保存，新的会话和生成任务会使用最新设置。")).toBeInTheDocument();
  });
});
