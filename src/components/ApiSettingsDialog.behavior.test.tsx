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

  test("lists skills and toggles enablement", async () => {
    const user = userEvent.setup();
    const setEsseSkillEnabled = vi.fn().mockResolvedValue({
      diagnostics: [],
      disabledSkills: ["xlsx-export"],
      skillPaths: [],
      skills: [
        {
          baseDir: "/Users/test/Library/Application Support/BatchImager/esse-skills/_built-in/xlsx-export",
          description: "把项目导出成 Excel 表格",
          disableModelInvocation: false,
          enabled: false,
          filePath: "/Users/test/skill/SKILL.md",
          name: "xlsx-export",
          source: "built-in",
          sourceLabel: "内置"
        }
      ]
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
      listEsseSkills: vi.fn().mockResolvedValue({
        diagnostics: [],
        disabledSkills: [],
        skillPaths: [],
        skills: [
          {
            baseDir: "/Users/test/Library/Application Support/BatchImager/esse-skills/_built-in/xlsx-export",
            description: "把项目导出成 Excel 表格",
            disableModelInvocation: false,
            enabled: true,
            filePath: "/Users/test/skill/SKILL.md",
            name: "xlsx-export",
            source: "built-in",
            sourceLabel: "内置"
          }
        ]
      }),
      setEsseSkillEnabled
    });

    await user.click(await screen.findByRole("tab", { name: "Skills" }));
    expect(await screen.findByText("把项目导出成 Excel 表格")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "xlsx-export" }));

    await waitFor(() => expect(setEsseSkillEnabled).toHaveBeenCalledWith({ enabled: false, name: "xlsx-export" }));
    expect(await screen.findByText("Skills（共 1 个，启用 0）")).toBeInTheDocument();
  });

  test("can install a skill from Git URL and view SKILL.md", async () => {
    const user = userEvent.setup();
    const installEsseSkillFromGit = vi.fn().mockResolvedValue({
      diagnostics: [],
      disabledSkills: [],
      skillPaths: [],
      skills: [
        {
          baseDir: "/Users/test/skill",
          description: "生成 PDF 作品集",
          disableModelInvocation: false,
          enabled: true,
          filePath: "/Users/test/skill/SKILL.md",
          name: "pdf-portfolio",
          source: "global",
          sourceLabel: "全局"
        }
      ]
    });
    const readEsseSkillFile = vi.fn().mockResolvedValue({
      content: "---\nname: pdf-portfolio\n---\n# pdf-portfolio\n",
      filePath: "/Users/test/skill/SKILL.md"
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
      installEsseSkillFromGit,
      listEsseSkills: vi.fn().mockResolvedValue({
        diagnostics: [],
        disabledSkills: [],
        skillPaths: [],
        skills: [
          {
            baseDir: "/Users/test/skill",
            description: "生成 PDF 作品集",
            disableModelInvocation: false,
            enabled: true,
            filePath: "/Users/test/skill/SKILL.md",
            name: "pdf-portfolio",
            source: "global",
            sourceLabel: "全局"
          }
        ]
      }),
      readEsseSkillFile
    });

    await user.click(await screen.findByRole("tab", { name: "Skills" }));
    await user.type(await screen.findByLabelText("Git URL"), "https://github.com/acme/pdf-portfolio.git");
    await user.click(screen.getByRole("button", { name: "从 Git URL 安装" }));
    await waitFor(() =>
      expect(installEsseSkillFromGit).toHaveBeenCalledWith({ gitUrl: "https://github.com/acme/pdf-portfolio.git" })
    );

    await user.click(screen.getByRole("button", { name: "查看 SKILL.md" }));
    expect(await screen.findByRole("dialog", { name: "pdf-portfolio SKILL.md" })).toBeInTheDocument();
    expect(screen.getByText(/# pdf-portfolio/)).toBeInTheDocument();
  });
});
