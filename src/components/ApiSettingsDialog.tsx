import { useEffect, useState, type FormEvent } from "react";
import type {
  ApiSettingsSnapshot,
  EsseMemoryCategory,
  EsseMemoryConflict,
  EsseMemorySnapshot,
  EsseSkillRecord,
  EsseSkillsSnapshot,
  ImageApiProfileId,
  SaveImageApiProfileRequest,
  SaveApiSettingsRequest
} from "../../electron/ipcTypes";
import { OsDialog, OsDialogClose, OsDialogTitle } from "./os";

interface ApiSettingsDialogProps {
  onClose: () => void;
}

type SaveStatus = "idle" | "loading" | "saving" | "saved" | "failed";
type SettingsTab = "api" | "skills" | "memory";
type SkillsStatus = "idle" | "loading" | "saving" | "failed";
type MemoryStatus = "idle" | "loading" | "saving" | "failed";

const EMPTY_DRAFT: SaveApiSettingsRequest = {
  activeImageApiProfileId: "primary",
  imageApiKey: "",
  imageBaseUrl: "",
  imageApiProfiles: [
    { apiKey: "", baseUrl: "", id: "primary", llmApiKey: "", llmBaseUrl: "", llmModel: "", model: "", name: "图像通道 1" },
    { apiKey: "", baseUrl: "", id: "secondary", llmApiKey: "", llmBaseUrl: "", llmModel: "", model: "", name: "图像通道 2" }
  ],
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
  const [memorySnapshot, setMemorySnapshot] = useState<EsseMemorySnapshot | null>(null);
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus>("idle");
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryConflict, setMemoryConflict] = useState<EsseMemoryConflict | null>(null);
  const [memoryContentInput, setMemoryContentInput] = useState("");
  const [memoryCategoryInput, setMemoryCategoryInput] = useState<EsseMemoryCategory>("用户偏好");

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
          activeImageApiProfileId: settings.activeImageApiProfileId ?? "primary",
          imageApiKey: "",
          imageBaseUrl: settings.imageBaseUrl,
          imageApiProfiles: (settings.imageApiProfiles ?? [
            {
              active: true,
              apiKeyConfigured: settings.imageApiKeyConfigured,
              baseUrl: settings.imageBaseUrl,
              id: "primary" as const,
              llmApiKeyConfigured: settings.llmApiKeyConfigured,
              llmBaseUrl: settings.llmBaseUrl,
              llmModel: settings.llmModel,
              model: settings.imageModel,
              name: "图像通道 1"
            },
            {
              active: false,
              apiKeyConfigured: false,
              baseUrl: settings.imageBaseUrl,
              id: "secondary" as const,
              llmApiKeyConfigured: false,
              llmBaseUrl: settings.llmBaseUrl,
              llmModel: settings.llmModel,
              model: settings.imageModel,
              name: "图像通道 2"
            }
          ]).map((profile) => ({
            apiKey: "",
            baseUrl: profile.baseUrl,
            id: profile.id,
            llmApiKey: "",
            llmBaseUrl: profile.llmBaseUrl,
            llmModel: profile.llmModel,
            model: profile.model,
            name: profile.name
          })),
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

  useEffect(() => {
    if (activeTab !== "memory" || memorySnapshot || memoryStatus === "loading") {
      return;
    }

    void loadMemory();
  }, [activeTab, memorySnapshot, memoryStatus]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      const activeProfileId = draft.activeImageApiProfileId ?? "primary";
      const profiles = normalizeImageApiProfiles(draft);
      const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
      const nextSnapshot = await getBatchImager().saveApiSettings({
        ...draft,
        activeImageApiProfileId: activeProfileId,
        imageApiKey: draft.imageApiKey?.trim() || undefined,
        imageApiProfiles: profiles.map((profile) => ({
          ...profile,
          apiKey: profile.apiKey?.trim() || undefined,
          baseUrl: profile.baseUrl.trim(),
          llmApiKey: profile.llmApiKey?.trim() || undefined,
          llmBaseUrl: profile.llmBaseUrl.trim(),
          llmModel: profile.llmModel.trim(),
          model: profile.model.trim(),
          name: profile.name.trim()
        })),
        imageBaseUrl: activeProfile?.baseUrl.trim() ?? draft.imageBaseUrl.trim(),
        imageModel: activeProfile?.model.trim() ?? draft.imageModel.trim(),
        llmApiKey: activeProfile?.llmApiKey?.trim() || draft.llmApiKey?.trim() || undefined,
        llmBaseUrl: activeProfile?.llmBaseUrl.trim() ?? draft.llmBaseUrl.trim(),
        llmModel: activeProfile?.llmModel.trim() ?? draft.llmModel.trim()
      });
      setSnapshot(nextSnapshot);
      setDraft({
        activeImageApiProfileId: nextSnapshot.activeImageApiProfileId,
        imageApiKey: "",
        imageBaseUrl: nextSnapshot.imageBaseUrl,
        imageApiProfiles: nextSnapshot.imageApiProfiles.map((profile) => ({
          apiKey: "",
          baseUrl: profile.baseUrl,
          id: profile.id,
          llmApiKey: "",
          llmBaseUrl: profile.llmBaseUrl,
          llmModel: profile.llmModel,
          model: profile.model,
          name: profile.name
        })),
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

  async function loadMemory(): Promise<void> {
    setMemoryStatus("loading");
    setMemoryError(null);
    try {
      setMemorySnapshot(await getBatchImager().listEsseMemories());
      setMemoryStatus("idle");
    } catch (loadError) {
      setMemoryError(toErrorMessage(loadError));
      setMemoryStatus("failed");
    }
  }

  async function addMemory(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const content = memoryContentInput.trim();
    if (!content) {
      return;
    }

    setMemoryStatus("saving");
    setMemoryError(null);
    setMemoryConflict(null);
    try {
      const result = await getBatchImager().addEsseMemory({ category: memoryCategoryInput, content });
      setMemorySnapshot(result.snapshot);
      if (result.conflict) {
        setMemoryConflict(result.conflict);
      } else {
        setMemoryContentInput("");
      }
      setMemoryStatus("idle");
    } catch (addError) {
      setMemoryError(toErrorMessage(addError));
      setMemoryStatus("failed");
    }
  }

  async function removeMemory(id: string): Promise<void> {
    setMemoryStatus("saving");
    setMemoryError(null);
    setMemoryConflict(null);
    try {
      setMemorySnapshot(await getBatchImager().removeEsseMemory({ id }));
      setMemoryStatus("idle");
    } catch (removeError) {
      setMemoryError(toErrorMessage(removeError));
      setMemoryStatus("failed");
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
          <span>API、Skills 与全局记忆</span>
        </div>
        <OsDialogClose asChild>
          <button className="icon-button" type="button" aria-label="关闭">
            ×
          </button>
        </OsDialogClose>
      </header>

      <div className="settings-body">
        <div className="settings-tabs" role="tablist" aria-label="设置分类" aria-orientation="vertical">
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
          <button
            aria-selected={activeTab === "memory"}
            className="settings-tab"
            role="tab"
            type="button"
            onClick={() => setActiveTab("memory")}
          >
            全局记忆
          </button>
        </div>

        <div className="settings-content">
          {activeTab === "api" ? (
            <form className="settings-form" onSubmit={handleSubmit}>
              <ApiProfilesSettings
                activeProfileId={draft.activeImageApiProfileId ?? "primary"}
                configuredProfiles={snapshot?.imageApiProfiles ?? []}
                profiles={normalizeImageApiProfiles(draft)}
                onActiveProfileChange={(profileId) =>
                  setDraft((current) => {
                    const profiles = normalizeImageApiProfiles(current);
                    const activeProfile = profiles.find((profile) => profile.id === profileId) ?? profiles[0];
                    return {
                      ...current,
                      activeImageApiProfileId: profileId,
                      imageBaseUrl: activeProfile?.baseUrl ?? current.imageBaseUrl,
                      imageModel: activeProfile?.model ?? current.imageModel,
                      llmBaseUrl: activeProfile?.llmBaseUrl ?? current.llmBaseUrl,
                      llmModel: activeProfile?.llmModel ?? current.llmModel
                    };
                  })
                }
                onProfileChange={(profileId, patch) =>
                  setDraft((current) => {
                    const profiles = normalizeImageApiProfiles(current).map((profile) =>
                      profile.id === profileId ? { ...profile, ...patch } : profile
                    );
                    const activeProfile = profiles.find((profile) => profile.id === (current.activeImageApiProfileId ?? "primary"));
                    return {
                      ...current,
                      imageApiProfiles: profiles,
                      imageBaseUrl: activeProfile?.baseUrl ?? current.imageBaseUrl,
                      imageModel: activeProfile?.model ?? current.imageModel,
                      llmBaseUrl: activeProfile?.llmBaseUrl ?? current.llmBaseUrl,
                      llmModel: activeProfile?.llmModel ?? current.llmModel
                    };
                  })
                }
              />

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
          ) : activeTab === "skills" ? (
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
          ) : (
            <MemoryTab
              categoryInput={memoryCategoryInput}
              conflict={memoryConflict}
              contentInput={memoryContentInput}
              error={memoryError}
              onAddMemory={addMemory}
              onCategoryInputChange={setMemoryCategoryInput}
              onContentInputChange={setMemoryContentInput}
              onRemoveMemory={removeMemory}
              onReload={loadMemory}
              snapshot={memorySnapshot}
              status={memoryStatus}
            />
          )}
        </div>
      </div>

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

interface MemoryTabProps {
  categoryInput: EsseMemoryCategory;
  conflict: EsseMemoryConflict | null;
  contentInput: string;
  error: string | null;
  onAddMemory: (event: FormEvent<HTMLFormElement>) => void;
  onCategoryInputChange: (category: EsseMemoryCategory) => void;
  onContentInputChange: (content: string) => void;
  onReload: () => void;
  onRemoveMemory: (id: string) => void;
  snapshot: EsseMemorySnapshot | null;
  status: MemoryStatus;
}

function MemoryTab({
  categoryInput,
  conflict,
  contentInput,
  error,
  onAddMemory,
  onCategoryInputChange,
  onContentInputChange,
  onReload,
  onRemoveMemory,
  snapshot,
  status
}: MemoryTabProps) {
  const isBusy = status === "loading" || status === "saving";
  const categories = snapshot?.categories ?? ["用户偏好", "默认约束", "工作流惯例"];

  return (
    <div className="settings-form settings-memory-panel">
      <section className="settings-group">
        <div className="settings-group-title">
          <h3>全局记忆（{snapshot?.entries.length ?? 0} 条）</h3>
          <button className="toolbar-button" type="button" disabled={isBusy} onClick={onReload}>
            {status === "loading" ? "读取中..." : "刷新"}
          </button>
        </div>
        <p className="settings-help">这些内容会跨项目提供给 Esse，用来保存长期偏好、默认约束和工作流习惯。</p>
        {snapshot?.filePath ? <div className="settings-path">文件位置：{snapshot.filePath}</div> : null}
      </section>

      <section className="settings-group">
        <div className="settings-group-title">
          <h3>新增记忆</h3>
          <span>{contentInput.trim().length}/200</span>
        </div>
        <form className="memory-add-form" onSubmit={onAddMemory}>
          <label className="settings-field">
            <span>分类</span>
            <select
              value={categoryInput}
              onChange={(event) => onCategoryInputChange(event.currentTarget.value as EsseMemoryCategory)}
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field memory-content-field">
            <span>内容</span>
            <textarea
              maxLength={200}
              placeholder="例如：默认保持原图比例，不主动改成方图。"
              value={contentInput}
              onChange={(event) => onContentInputChange(event.currentTarget.value)}
            />
          </label>
          <div className="memory-form-actions">
            <button className="toolbar-button primary" type="submit" disabled={isBusy || !contentInput.trim()}>
              {status === "saving" ? "保存中..." : "保存记忆"}
            </button>
          </div>
        </form>
        {conflict ? (
          <div className="memory-conflict">
            <strong>已有相似记忆</strong>
            <span>
              [{conflict.conflictsWith.id}] {conflict.conflictsWith.content}
            </span>
          </div>
        ) : null}
      </section>

      <section className="settings-group">
        <div className="settings-group-title">
          <h3>已保存记忆</h3>
        </div>
        {snapshot ? (
          snapshot.entries.length ? (
            <div className="memory-list">
              {categories.map((category) => {
                const entries = snapshot.entries.filter((entry) => entry.category === category);
                if (!entries.length) {
                  return null;
                }

                return (
                  <div className="memory-category" key={category}>
                    <h4>{category}</h4>
                    {entries.map((entry) => (
                      <div className="memory-row" key={entry.id}>
                        <span className="memory-id">{entry.id}</span>
                        <p>{entry.content}</p>
                        <button className="toolbar-button" type="button" disabled={isBusy} onClick={() => onRemoveMemory(entry.id)}>
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="settings-empty">还没有全局记忆。</div>
          )
        ) : (
          <div className="settings-empty">打开此页后会读取全局记忆。</div>
        )}
      </section>

      {error ? <div className="dialog-error">{error}</div> : null}
    </div>
  );
}

interface ApiProfilesSettingsProps {
  activeProfileId: ImageApiProfileId;
  configuredProfiles: ApiSettingsSnapshot["imageApiProfiles"];
  onActiveProfileChange: (profileId: ImageApiProfileId) => void;
  onProfileChange: (profileId: ImageApiProfileId, patch: Partial<SaveImageApiProfileRequest>) => void;
  profiles: SaveImageApiProfileRequest[];
}

function ApiProfilesSettings({
  activeProfileId,
  configuredProfiles,
  onActiveProfileChange,
  onProfileChange,
  profiles
}: ApiProfilesSettingsProps) {
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  if (!activeProfile) {
    return null;
  }

  return (
    <section className="settings-group settings-image-profiles">
      <div className="settings-group-title">
        <h3>API 通道</h3>
        <span>当前使用：{activeProfile.name || "图像通道"}</span>
      </div>

      <div className="settings-profile-tabs" role="radiogroup" aria-label="API 通道">
        {profiles.map((profile) => (
          <button
            aria-checked={profile.id === activeProfileId}
            className="settings-profile-tab"
            key={profile.id}
            role="radio"
            type="button"
            onClick={() => onActiveProfileChange(profile.id)}
          >
            <strong>{profile.name || getDefaultProfileName(profile.id)}</strong>
            <span>
              生图 {getImageConfiguredLabel(configuredProfiles, profile.id)} · LLM {getLlmConfiguredLabel(configuredProfiles, profile.id)}
            </span>
          </button>
        ))}
      </div>

      <label className="settings-field settings-profile-name-field">
        <span>通道名称</span>
        <input required value={activeProfile.name} onChange={(event) => onProfileChange(activeProfile.id, { name: event.currentTarget.value })} />
      </label>

      <div className="settings-profile-editor">
        <section className="settings-api-card">
          <div className="settings-group-title">
            <h4>生图 API</h4>
            <span>{getImageConfiguredLabel(configuredProfiles, activeProfile.id)}</span>
          </div>
          <label className="settings-field">
            <span>生图 Base URL</span>
            <input
              required
              value={activeProfile.baseUrl}
              onChange={(event) => onProfileChange(activeProfile.id, { baseUrl: event.currentTarget.value })}
            />
          </label>
          <label className="settings-field">
            <span>生图模型</span>
            <input
              required
              value={activeProfile.model}
              onChange={(event) => onProfileChange(activeProfile.id, { model: event.currentTarget.value })}
            />
          </label>
          <label className="settings-field">
            <span>生图 API Key</span>
            <input
              autoComplete="off"
              placeholder={getImageConfiguredLabel(configuredProfiles, activeProfile.id) === "密钥已设置" ? "留空则继续使用已保存密钥" : "粘贴 API Key"}
              type="password"
              value={activeProfile.apiKey ?? ""}
              onChange={(event) => onProfileChange(activeProfile.id, { apiKey: event.currentTarget.value })}
            />
          </label>
        </section>

        <section className="settings-api-card">
          <div className="settings-group-title">
            <h4>LLM API</h4>
            <span>{getLlmConfiguredLabel(configuredProfiles, activeProfile.id)}</span>
          </div>
          <label className="settings-field">
            <span>LLM Base URL</span>
            <input
              required
              value={activeProfile.llmBaseUrl}
              onChange={(event) => onProfileChange(activeProfile.id, { llmBaseUrl: event.currentTarget.value })}
            />
          </label>
          <label className="settings-field">
            <span>LLM 模型</span>
            <input
              required
              value={activeProfile.llmModel}
              onChange={(event) => onProfileChange(activeProfile.id, { llmModel: event.currentTarget.value })}
            />
          </label>
          <label className="settings-field">
            <span>LLM API Key</span>
            <input
              autoComplete="off"
              placeholder={getLlmConfiguredLabel(configuredProfiles, activeProfile.id) === "密钥已设置" ? "留空则继续使用已保存密钥" : "粘贴 API Key"}
              type="password"
              value={activeProfile.llmApiKey ?? ""}
              onChange={(event) => onProfileChange(activeProfile.id, { llmApiKey: event.currentTarget.value })}
            />
          </label>
        </section>
      </div>
    </section>
  );
}

function normalizeImageApiProfiles(draft: SaveApiSettingsRequest): SaveImageApiProfileRequest[] {
  const profiles = draft.imageApiProfiles ?? [];
  return (["primary", "secondary"] as const).map((id) => {
    const profile = profiles.find((item) => item.id === id);
    return {
      apiKey: profile?.apiKey ?? "",
      baseUrl: profile?.baseUrl || (id === "primary" ? draft.imageBaseUrl : draft.imageBaseUrl),
      id,
      llmApiKey: profile?.llmApiKey ?? "",
      llmBaseUrl: profile?.llmBaseUrl || draft.llmBaseUrl,
      llmModel: profile?.llmModel || draft.llmModel,
      model: profile?.model || (id === "primary" ? draft.imageModel : draft.imageModel),
      name: profile?.name || getDefaultProfileName(id)
    };
  });
}

function getImageConfiguredLabel(configuredProfiles: ApiSettingsSnapshot["imageApiProfiles"], profileId: ImageApiProfileId): string {
  return configuredProfiles.find((profile) => profile.id === profileId)?.apiKeyConfigured ? "密钥已设置" : "未设置密钥";
}

function getLlmConfiguredLabel(configuredProfiles: ApiSettingsSnapshot["imageApiProfiles"], profileId: ImageApiProfileId): string {
  return configuredProfiles.find((profile) => profile.id === profileId)?.llmApiKeyConfigured ? "密钥已设置" : "未设置密钥";
}

function getDefaultProfileName(profileId: ImageApiProfileId): string {
  return profileId === "primary" ? "图像通道 1" : "图像通道 2";
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
