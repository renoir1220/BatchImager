import { useEffect, useState, type FormEvent } from "react";
import type {
  ApiSettingsSnapshot,
  EsseSkillRecord,
  EsseSkillsSnapshot,
  SaveApiSettingsRequest
} from "../../electron/ipcTypes";
import { OsDialog, OsDialogClose, OsDialogTitle } from "./os";

interface ApiSettingsDialogProps {
  onClose: () => void;
}

type SaveStatus = "idle" | "loading" | "saving" | "saved" | "failed";
type SettingsTab = "api" | "skills";
type SkillsStatus = "idle" | "loading" | "saving" | "failed";

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
  const [activeTab, setActiveTab] = useState<SettingsTab>("api");
  const [skillsSnapshot, setSkillsSnapshot] = useState<EsseSkillsSnapshot | null>(null);
  const [skillsStatus, setSkillsStatus] = useState<SkillsStatus>("idle");
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [skillPathInput, setSkillPathInput] = useState("");
  const [gitUrlInput, setGitUrlInput] = useState("");
  const [skillFile, setSkillFile] = useState<{ content: string; filePath: string; name: string } | null>(null);

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

  useEffect(() => {
    if (activeTab !== "skills" || skillsSnapshot || skillsStatus === "loading") {
      return;
    }

    void loadSkills(false);
  }, [activeTab, skillsSnapshot, skillsStatus]);

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

  async function loadSkills(reload: boolean): Promise<void> {
    setSkillsStatus("loading");
    setSkillsError(null);

    try {
      const nextSnapshot = reload
        ? await getBatchImager().reloadEsseSkills()
        : await getBatchImager().listEsseSkills();
      setSkillsSnapshot(nextSnapshot);
      setSkillsStatus("idle");
    } catch (loadError) {
      setSkillsError(toErrorMessage(loadError));
      setSkillsStatus("failed");
    }
  }

  async function updateSkillEnabled(skill: EsseSkillRecord, enabled: boolean): Promise<void> {
    setSkillsStatus("saving");
    setSkillsError(null);

    try {
      setSkillsSnapshot(await getBatchImager().setEsseSkillEnabled({ enabled, name: skill.name }));
      setSkillsStatus("idle");
    } catch (updateError) {
      setSkillsError(toErrorMessage(updateError));
      setSkillsStatus("failed");
    }
  }

  async function addSkillPath(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = skillPathInput.trim();
    if (!trimmed) {
      return;
    }

    setSkillsStatus("saving");
    setSkillsError(null);
    try {
      setSkillsSnapshot(await getBatchImager().addEsseSkillPath({ path: trimmed }));
      setSkillPathInput("");
      setSkillsStatus("idle");
    } catch (pathError) {
      setSkillsError(toErrorMessage(pathError));
      setSkillsStatus("failed");
    }
  }

  async function installSkillFromGit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = gitUrlInput.trim();
    if (!trimmed) {
      return;
    }

    setSkillsStatus("saving");
    setSkillsError(null);
    try {
      setSkillsSnapshot(await getBatchImager().installEsseSkillFromGit({ gitUrl: trimmed }));
      setGitUrlInput("");
      setSkillsStatus("idle");
    } catch (installError) {
      setSkillsError(toErrorMessage(installError));
      setSkillsStatus("failed");
    }
  }

  async function removeSkill(skill: EsseSkillRecord): Promise<void> {
    setSkillsStatus("saving");
    setSkillsError(null);
    try {
      setSkillsSnapshot(await getBatchImager().removeEsseSkill({ name: skill.name }));
      setSkillsStatus("idle");
    } catch (removeError) {
      setSkillsError(toErrorMessage(removeError));
      setSkillsStatus("failed");
    }
  }

  async function readSkillFile(skill: EsseSkillRecord): Promise<void> {
    setSkillsError(null);
    try {
      const result = await getBatchImager().readEsseSkillFile({ name: skill.name });
      setSkillFile({ ...result, name: skill.name });
    } catch (readError) {
      setSkillsError(toErrorMessage(readError));
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

      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        <button
          aria-selected={activeTab === "api"}
          className="settings-tab"
          role="tab"
          type="button"
          onClick={() => setActiveTab("api")}
        >
          API
        </button>
        <button
          aria-selected={activeTab === "skills"}
          className="settings-tab"
          role="tab"
          type="button"
          onClick={() => setActiveTab("skills")}
        >
          Skills
        </button>
      </div>

      {activeTab === "api" ? (
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
      ) : (
        <SkillsTab
          gitUrlInput={gitUrlInput}
          onAddSkillPath={addSkillPath}
          onGitUrlInputChange={setGitUrlInput}
          onInstallSkillFromGit={installSkillFromGit}
          onPathInputChange={setSkillPathInput}
          onReadSkillFile={readSkillFile}
          onReload={() => loadSkills(true)}
          onRemoveSkill={removeSkill}
          onToggleSkill={updateSkillEnabled}
          pathInput={skillPathInput}
          snapshot={skillsSnapshot}
          status={skillsStatus}
          error={skillsError}
        />
      )}

      {skillFile ? (
        <div className="skill-file-modal" role="dialog" aria-label={`${skillFile.name} SKILL.md`}>
          <div className="skill-file-panel">
            <header className="skill-file-header">
              <div>
                <h3>{skillFile.name}</h3>
                <span>{skillFile.filePath}</span>
              </div>
              <button className="icon-button" type="button" aria-label="关闭 SKILL.md" onClick={() => setSkillFile(null)}>
                ×
              </button>
            </header>
            <pre>{skillFile.content}</pre>
          </div>
        </div>
      ) : null}
    </OsDialog>
  );
}

interface SkillsTabProps {
  error: string | null;
  gitUrlInput: string;
  onAddSkillPath: (event: FormEvent<HTMLFormElement>) => void;
  onGitUrlInputChange: (value: string) => void;
  onInstallSkillFromGit: (event: FormEvent<HTMLFormElement>) => void;
  onPathInputChange: (value: string) => void;
  onReadSkillFile: (skill: EsseSkillRecord) => void;
  onReload: () => void;
  onRemoveSkill: (skill: EsseSkillRecord) => void;
  onToggleSkill: (skill: EsseSkillRecord, enabled: boolean) => void;
  pathInput: string;
  snapshot: EsseSkillsSnapshot | null;
  status: SkillsStatus;
}

function SkillsTab({
  error,
  gitUrlInput,
  onAddSkillPath,
  onGitUrlInputChange,
  onInstallSkillFromGit,
  onPathInputChange,
  onReadSkillFile,
  onReload,
  onRemoveSkill,
  onToggleSkill,
  pathInput,
  snapshot,
  status
}: SkillsTabProps) {
  const enabledCount = snapshot?.skills.filter((skill) => skill.enabled).length ?? 0;
  const totalCount = snapshot?.skills.length ?? 0;
  const isBusy = status === "loading" || status === "saving";

  return (
    <div className="settings-form settings-skills-panel">
      <section className="settings-group">
        <div className="settings-group-title">
          <h3>Skills（共 {totalCount} 个，启用 {enabledCount}）</h3>
          <button className="toolbar-button" type="button" disabled={isBusy} onClick={onReload}>
            {status === "loading" ? "扫描中..." : "重新扫描"}
          </button>
        </div>

        {snapshot ? (
          <div className="skill-list">
            {snapshot.skills.length ? snapshot.skills.map((skill) => (
              <div className="skill-row" key={`${skill.source}:${skill.name}:${skill.baseDir}`}>
                <label className="skill-enable">
                  <input
                    checked={skill.enabled}
                    disabled={isBusy}
                    type="checkbox"
                    onChange={(event) => onToggleSkill(skill, event.currentTarget.checked)}
                  />
                  <span>{skill.name}</span>
                </label>
                <span className="skill-source">{skill.sourceLabel}</span>
                <p>{skill.description || "没有描述"}</p>
                <div className="skill-actions">
                  <button className="toolbar-button" type="button" onClick={() => onReadSkillFile(skill)}>
                    查看 SKILL.md
                  </button>
                  {skill.source === "global" || skill.source === "project" ? (
                    <button className="toolbar-button" type="button" disabled={isBusy} onClick={() => onRemoveSkill(skill)}>
                      移除
                    </button>
                  ) : null}
                </div>
              </div>
            )) : <div className="settings-empty">还没有扫描到 Skills。</div>}
          </div>
        ) : (
          <div className="settings-empty">打开此页后会扫描可用 Skills。</div>
        )}
      </section>

      <section className="settings-group">
        <div className="settings-group-title">
          <h3>安装与搜索路径</h3>
          <span>支持标准 Agent Skills</span>
        </div>
        <form className="settings-inline-form" onSubmit={onInstallSkillFromGit}>
          <label className="settings-field">
            <span>Git URL</span>
            <input
              placeholder="https://github.com/user/skill.git"
              value={gitUrlInput}
              onChange={(event) => onGitUrlInputChange(event.currentTarget.value)}
            />
          </label>
          <button className="toolbar-button" type="submit" disabled={isBusy || !gitUrlInput.trim()}>
            从 Git URL 安装
          </button>
        </form>
        <form className="settings-inline-form" onSubmit={onAddSkillPath}>
          <label className="settings-field">
            <span>搜索目录</span>
            <input
              placeholder="/Users/me/.codex/skills"
              value={pathInput}
              onChange={(event) => onPathInputChange(event.currentTarget.value)}
            />
          </label>
          <button className="toolbar-button" type="submit" disabled={isBusy || !pathInput.trim()}>
            添加搜索目录
          </button>
        </form>
        {snapshot?.skillPaths.length ? (
          <div className="settings-path-list">
            {snapshot.skillPaths.map((skillPath) => <span key={skillPath}>{skillPath}</span>)}
          </div>
        ) : null}
      </section>

      {snapshot?.diagnostics.length ? (
        <section className="settings-group">
          <div className="settings-group-title">
            <h3>诊断（{snapshot.diagnostics.length} 条）</h3>
          </div>
          <div className="skill-diagnostics">
            {snapshot.diagnostics.map((diagnostic, index) => (
              <div key={`${diagnostic.type}:${diagnostic.path ?? index}`}>
                <strong>{diagnostic.type}</strong>
                <span>{diagnostic.message}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {error ? <div className="dialog-error">{error}</div> : null}
    </div>
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
