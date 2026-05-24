import { useEffect, useState, type FormEvent } from "react";
import type { ApiSettingsSnapshot, SaveApiSettingsRequest } from "../../electron/ipcTypes";
import { OsDialog, OsDialogClose, OsDialogTitle } from "./os";

interface ApiSettingsDialogProps {
  onClose: () => void;
}

type SaveStatus = "idle" | "loading" | "saving" | "saved" | "failed";

const EMPTY_DRAFT: SaveApiSettingsRequest = {
  imageApiKey: "",
  imageBaseUrl: "",
  imageModel: "",
  llmApiKey: "",
  llmBaseUrl: "",
  llmModel: ""
};

export function ApiSettingsDialog({ onClose }: ApiSettingsDialogProps) {
  const [draft, setDraft] = useState<SaveApiSettingsRequest>(EMPTY_DRAFT);
  const [snapshot, setSnapshot] = useState<ApiSettingsSnapshot | null>(null);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setStatus("loading");
    getBatchImager().getApiSettings()
      .then((settings) => {
        if (canceled) {
          return;
        }
        setSnapshot(settings);
        setDraft({
          imageApiKey: "",
          imageBaseUrl: settings.imageBaseUrl,
          imageModel: settings.imageModel,
          llmApiKey: "",
          llmBaseUrl: settings.llmBaseUrl,
          llmModel: settings.llmModel
        });
        setStatus("idle");
      })
      .catch((loadError) => {
        if (canceled) {
          return;
        }
        setError(toErrorMessage(loadError));
        setStatus("failed");
      });

    return () => {
      canceled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      const nextSnapshot = await getBatchImager().saveApiSettings({
        ...draft,
        imageApiKey: draft.imageApiKey?.trim() || undefined,
        imageBaseUrl: draft.imageBaseUrl.trim(),
        imageModel: draft.imageModel.trim(),
        llmApiKey: draft.llmApiKey?.trim() || undefined,
        llmBaseUrl: draft.llmBaseUrl.trim(),
        llmModel: draft.llmModel.trim()
      });
      setSnapshot(nextSnapshot);
      setDraft({
        imageApiKey: "",
        imageBaseUrl: nextSnapshot.imageBaseUrl,
        imageModel: nextSnapshot.imageModel,
        llmApiKey: "",
        llmBaseUrl: nextSnapshot.llmBaseUrl,
        llmModel: nextSnapshot.llmModel
      });
      setStatus("saved");
    } catch (saveError) {
      setError(toErrorMessage(saveError));
      setStatus("failed");
    }
  }

  return (
    <OsDialog
      overlayClassName="modal-backdrop settings-backdrop"
      contentClassName="settings-dialog"
      aria-labelledby="settings-dialog-title"
      onClose={onClose}
    >
      <header className="settings-header">
        <div>
          <OsDialogTitle asChild>
            <h2 id="settings-dialog-title">设置</h2>
          </OsDialogTitle>
          <span>LLM 与图像生成 API</span>
        </div>
        <OsDialogClose asChild>
          <button className="icon-button" type="button" aria-label="关闭">
            ×
          </button>
        </OsDialogClose>
      </header>

      <form className="settings-form" onSubmit={handleSubmit}>
        <ApiSettingsGroup
          apiKeyConfigured={snapshot?.imageApiKeyConfigured ?? false}
          apiKeyLabel="图像 API Key"
          apiKeyValue={draft.imageApiKey ?? ""}
          baseUrlLabel="图像 Base URL"
          baseUrlValue={draft.imageBaseUrl}
          modelLabel="图像模型"
          modelValue={draft.imageModel}
          onApiKeyChange={(value) => setDraft((current) => ({ ...current, imageApiKey: value }))}
          onBaseUrlChange={(value) => setDraft((current) => ({ ...current, imageBaseUrl: value }))}
          onModelChange={(value) => setDraft((current) => ({ ...current, imageModel: value }))}
          title="图像生成"
        />

        <ApiSettingsGroup
          apiKeyConfigured={snapshot?.llmApiKeyConfigured ?? false}
          apiKeyLabel="LLM API Key"
          apiKeyValue={draft.llmApiKey ?? ""}
          baseUrlLabel="LLM Base URL"
          baseUrlValue={draft.llmBaseUrl}
          modelLabel="LLM 模型"
          modelValue={draft.llmModel}
          onApiKeyChange={(value) => setDraft((current) => ({ ...current, llmApiKey: value }))}
          onBaseUrlChange={(value) => setDraft((current) => ({ ...current, llmBaseUrl: value }))}
          onModelChange={(value) => setDraft((current) => ({ ...current, llmModel: value }))}
          title="LLM 会话"
        />

        {snapshot?.configPath ? <div className="settings-path">配置保存位置：{snapshot.configPath}</div> : null}
        {status === "saved" ? <div className="settings-note">已保存，新的会话和生成任务会使用最新设置。</div> : null}
        {error ? <div className="dialog-error">{error}</div> : null}

        <footer className="dialog-actions">
          <OsDialogClose asChild>
            <button className="toolbar-button" type="button">
              关闭
            </button>
          </OsDialogClose>
          <button className="toolbar-button primary" type="submit" disabled={status === "loading" || status === "saving"}>
            {status === "saving" ? "保存中..." : "保存"}
          </button>
        </footer>
      </form>
    </OsDialog>
  );
}

interface ApiSettingsGroupProps {
  apiKeyConfigured: boolean;
  apiKeyLabel: string;
  apiKeyValue: string;
  baseUrlLabel: string;
  baseUrlValue: string;
  modelLabel: string;
  modelValue: string;
  onApiKeyChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onModelChange: (value: string) => void;
  title: string;
}

function ApiSettingsGroup({
  apiKeyConfigured,
  apiKeyLabel,
  apiKeyValue,
  baseUrlLabel,
  baseUrlValue,
  modelLabel,
  modelValue,
  onApiKeyChange,
  onBaseUrlChange,
  onModelChange,
  title
}: ApiSettingsGroupProps) {
  return (
    <section className="settings-group">
      <div className="settings-group-title">
        <h3>{title}</h3>
        <span>{apiKeyConfigured ? "密钥已设置" : "未设置密钥"}</span>
      </div>

      <label className="settings-field">
        <span>{baseUrlLabel}</span>
        <input required value={baseUrlValue} onChange={(event) => onBaseUrlChange(event.currentTarget.value)} />
      </label>
      <label className="settings-field">
        <span>{modelLabel}</span>
        <input required value={modelValue} onChange={(event) => onModelChange(event.currentTarget.value)} />
      </label>
      <label className="settings-field">
        <span>{apiKeyLabel}</span>
        <input
          autoComplete="off"
          placeholder={apiKeyConfigured ? "留空则继续使用已保存密钥" : "粘贴 API Key"}
          type="password"
          value={apiKeyValue}
          onChange={(event) => onApiKeyChange(event.currentTarget.value)}
        />
      </label>
    </section>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "保存设置失败";
}

function getBatchImager() {
  if (!window.batchImager) {
    throw new Error("BatchImager API is unavailable");
  }

  return window.batchImager;
}
