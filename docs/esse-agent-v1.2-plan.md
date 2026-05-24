# Esse Agent v1.2 计划：Skills 与制品导出

## 背景

v1.0 把 Esse 重构成 customTool-only 的 agent、v1.1 补齐了 broker ask 模式、undo、参考图工具、批量并行、全局记忆与新会话身份修复。到 v1.1 末尾 Esse 在 BatchImager 工作区内已经"功能完整"。

v1.2 不再扩工作区工具，而是把 Esse 从"BatchImager 内的工具人"推一步变成"会用工具完成任务的小同事"。两件事：

1. **接入 pi 自带的 Skills 系统**（Agent Skills 标准，pi / Claude Code / OpenAI Codex 共享），让 Esse 能调用预装/用户自定义的脚本
2. **内置三个制品导出 skill**（Excel 清单 / PDF 作品集 / 项目交付包），让用户立刻看到"我居然能让 Esse 输出周边产物了"

**v1.2 明确不做**：

- 浏览器自动化（playwright 长进程支持）→ v1.3 单独立题
- Esse 主动总结 / 工作流编排 / 跨会话编排 → v1.4+
- 自研 skill DSL → 直接采纳 Agent Skills 开放标准
- MCP 支持 → 沿用 pi 立场，理由见 [esse-agent-roadmap.md](./esse-agent-roadmap.md#不在路线上的事)

### 设计原则

#### 为什么选 pi 的 Skills 系统

pi 已经实现完整的 [Agent Skills 标准](https://agentskills.io)（`@earendil-works/pi-coding-agent` 0.75.1 暴露 `loadSkills` / `formatSkillsForPrompt` / `parseSkillBlock`）。这意味着：

- **直接吃 Anthropic 官方 skill 库**：[anthropics/skills](https://github.com/anthropics/skills) 的 xlsx / docx / pdf / pptx 一组开箱即用
- **token 高效**：progressive disclosure 模式只把所有 skill 的 name+description 放系统提示，full SKILL.md 由模型 `read` 加载
- **标准化**：用户可以把 `~/.claude/skills`、`~/.codex/skills` 加进 Esse 的 skill 搜索路径，跨 agent 复用
- **可组合**：skill 之间用 bash + 文件系统拼接，不必经过 agent 上下文中转

#### 安全模型

新增的"受控 bash"工具是 v1.2 唯一一个真正引入新风险面的能力。防线：

- **复用 v1.1 permission broker**：bash 调用走 risk=destructive，第一次执行时弹窗确认
- **session 内 allow-skill 缓存**：同一 skill 内连续命令不重复打扰，按 skill 名作 key
- **复用 `agentCommandPolicy`**：拦截系统级危险命令、保护 `images/original` 和 `references` 目录
- **环境隔离**：spawnHook 剥离 API key 类敏感 env，注入 `BATCHIMAGER_*` 标识让 skill 脚本能识别上下文

#### 与 v1.0/v1.1 接口的兼容性

v1.2 不破坏现有接口形状。新增能力以新文件 / 新字段的方式加入：

- 新文件：`esseSkillLoader.ts`、`esseBashTool.ts`、`esseBuiltInSkills.ts`
- 现有文件加新字段：`agentRuntime.ts` 的 `DEFAULT_BUILT_IN_TOOLS`、`esseAgent.ts` 的 customTools 注册、系统提示拼装、settings 模型
- 不动：`EsseWorkspaceToolRuntime` / `ProjectMutationSink` / `EssePreflightBroker` / permission broker 协议

---

## Part 1 — Skills 系统基础设施

### 1.1 Skill 加载器

**新文件**：`electron/services/esseSkillLoader.ts`

包装 pi 的 `loadSkills`，提供 Esse 视角的 skill 检索 + 提示渲染。

```ts
export interface EsseSkillRecord {
  baseDir: string;          // skill 根目录绝对路径，受控 bash 用它判断 skill 归属
  description: string;
  disableModelInvocation: boolean;
  filePath: string;         // SKILL.md 路径
  name: string;
  source: "global" | "project" | "built-in" | "user-path";
  sourceLabel: string;      // UI 显示用
}

export interface EsseSkillLoader {
  list: () => EsseSkillRecord[];
  get: (name: string) => EsseSkillRecord | undefined;
  formatForPrompt: () => string;          // 委托 pi 的 formatSkillsForPrompt
  matchSkillByCwd: (cwd: string) => EsseSkillRecord | undefined;  // 受控 bash 用
  reload: () => Promise<EsseSkillLoadResult>;
}

export interface EsseSkillLoadResult {
  diagnostics: EsseSkillDiagnostic[];
  skills: EsseSkillRecord[];
}
```

**搜索路径**（按 source 优先级）：

| source | 路径 | 说明 |
|---|---|---|
| `built-in` | `{userData}/esse-skills/_built-in/` | 1.4 安装策略：app 启动时从 `resources/built-in-skills/` 同步 |
| `global` | `{userData}/esse-skills/` 直接子目录（排除 `_built-in`） | 用户自己装的全局 skill |
| `project` | `{projectDirectory}/.esse/skills/` | 项目级 skill |
| `user-path` | settings.esse.skillPaths | 用户额外配置的目录 |

**禁用名单**：settings.esse.disabledSkills（string[]，按 skill name 匹配）。reload 时返回的 list 已经过滤掉禁用项；formatForPrompt 同样不包含禁用项。

**冲突处理**：同名 skill 按优先级取第一个，其余进 diagnostics（沿用 pi 的策略）。

**测试**（`esseSkillLoader.test.ts`）：

- 给定模拟目录结构，验证四个 source 全部扫描到
- 给定带 frontmatter 错误的 SKILL.md，验证 diagnostics 不为空但不抛
- 验证 disabledSkills 在 list 和 formatForPrompt 中都被过滤
- 验证 matchSkillByCwd：传入 skill baseDir 子目录返回对应 skill；传入无关路径返回 undefined

### 1.2 受控 bash 工具

**新文件**：`electron/services/esseBashTool.ts`

基于 pi 的 `createBashToolDefinition`，包一层策略 + 权限 + env 净化。

```ts
export interface CreateEsseBashToolOptions {
  commandPolicy: BatchImagerCommandPolicy;   // 复用 v1.0 的 policy
  permissionBroker: EssePermissionBroker;
  projectDirectory: string;
  sessionId: string;
  sessionAllowList: Set<string>;             // 沿用 broker 现有契约
  skillLoader: EsseSkillLoader;
  signal?: AbortSignal;
  webContents: Pick<WebContents, "send">;
}

export function createEsseBashTool(options: CreateEsseBashToolOptions): unknown;
```

实现要点：

```ts
import { createBashToolDefinition, createLocalBashOperations } from "@earendil-works/pi-coding-agent";

const baseOperations = createLocalBashOperations();

const operations: BashOperations = {
  exec: async (command, cwd, execOptions) => {
    // 第一道：命令策略
    const policyDecision = options.commandPolicy.checkCommand(command);
    if (!policyDecision.allowed) {
      throw new Error(`Esse bash 被命令策略拦截：${policyDecision.reason}`);
    }

    // 第二道：识别 skill 归属，向 broker 申请权限
    const skill = options.skillLoader.matchSkillByCwd(cwd);
    const targetKey = skill ? `skill:${skill.name}` : `bash:${options.sessionId}`;
    const permissionPayload: EsseWorkspacePermissionRequest = {
      details: { command, cwd, skillName: skill?.name ?? null },
      label: skill ? `运行 ${skill.name} 的命令` : "运行项目命令",
      reason: skill?.description ?? "Esse 想执行 shell 命令",
      risk: "destructive",
      targetKey,
      toolName: "bash"
    };
    const decision = await options.permissionBroker.request(options.webContents, permissionPayload, {
      policy: ESSE_PERMISSION_POLICY_FOR_BASH,    // 见下
      sessionAllowList: options.sessionAllowList,
      signal: options.signal
    });
    if (decision.decision === "deny") {
      throw new Error(decision.reason);
    }

    // 第三道：env 净化
    const sanitizedEnv = sanitizeBashEnv(execOptions.env, options.projectDirectory, skill);

    return baseOperations.exec(command, cwd, { ...execOptions, env: sanitizedEnv });
  }
};

return createBashToolDefinition(options.projectDirectory, {
  operations,
  spawnHook: ({ command, cwd, env }) => ({
    command,
    cwd,
    env: sanitizeBashEnv(env, options.projectDirectory, options.skillLoader.matchSkillByCwd(cwd))
  })
});
```

**`sanitizeBashEnv` 规则**：

- **白名单透传**：`HOME` / `PATH` / `USER` / `LANG` / `LC_ALL` / `TMPDIR` / `SHELL` / `DISPLAY`（Linux）
- **剥离**：所有 `TUZI_*` / `OPENAI_*` / `ANTHROPIC_*` / `BATCHIMAGER_API_*` 等含 key 的 env
- **注入**：
  - `BATCHIMAGER_PROJECT_DIR` = projectDirectory
  - `BATCHIMAGER_SKILL_NAME` = skill?.name ?? ""
  - `BATCHIMAGER_SKILL_DIR` = skill?.baseDir ?? ""
  - `BATCHIMAGER_USER_DATA` = app.getPath("userData")

**`ESSE_PERMISSION_POLICY_FOR_BASH`**：bash 工具自己声明的策略，与全局 permission policy 隔离。默认 `{ destructive: "ask" }`，沿用 v1.1 broker 的 ask 模式。

**v1.3 预留**：

- bash 工具的 `BashToolOptions` 已经支持长进程（pi 的 exec 是流式 stdin/stdout），v1.2 不需要主动做任何事
- 但 v1.2 必须保证 `signal` 一路传到 pi 的 exec，让用户能从对话卡的 "中止" 按钮干掉长进程
- `BashSpawnContext.env` 允许 v1.3 时再补 `BATCHIMAGER_CHROME_USER_DATA` 等浏览器自动化 env，不破坏 v1.2 形状

**测试**（`esseBashTool.test.ts`）：

- 命令被 policy 拒绝时不调 baseOperations
- broker 返回 deny 时不调 baseOperations
- broker 返回 allow 后，传给 baseOperations 的 env 不含 `TUZI_API_KEY`、`OPENAI_API_KEY`
- 传入的 cwd 落在某 skill 目录下时，targetKey 是 `skill:<name>`
- AbortSignal 触发时 broker 收到 abort

### 1.3 把 bash + skills 注入 Esse Agent

**修改 `electron/services/agentRuntime.ts`**：

`DEFAULT_BUILT_IN_TOOLS` 维持 `["read", "grep", "find", "ls"]`。**不动 pi 内置 bash**——pi 自己的 bash 工具会直接 exec 不走 broker，必须把 `bash` 排除在 tools 白名单外。

```ts
// agentRuntime.ts 不需要改 DEFAULT_BUILT_IN_TOOLS，
// bash 走 customTool 渠道传入（见 esseAgent.ts 改动）。
```

**修改 `electron/services/esseAgent.ts`**：

```ts
// L128 附近
const skillLoader = deps.skillLoader;   // 新增 dep
const bashTool = createEsseBashTool({
  commandPolicy,
  permissionBroker: deps.permissionBroker,
  projectDirectory,
  sessionId: context,
  sessionAllowList: deps.workspaceToolRuntime?.sessionAllowList ?? new Set(),
  skillLoader,
  signal: deps.signal,
  webContents: deps.webContents
});

await registry.use({
  ...
  factory: async () =>
    await createAgentRuntime({
      customToolDefinitions: [...workspaceTools, bashTool],
      llmConfig: config,
      model: config.model,
      projectDirectory,
      sessionId: context
    })
  ...
});
```

**修改系统提示构建**（`esseAgentPrompts.ts` 或同等位置）：

在 `buildFullEssePrompt` / `buildFullEsseWorkspacePrompt` / `buildEsseTurnPrompt` 三处都加入：

```ts
const skillsSection = skillLoader.formatForPrompt();
// 拼到 memorySection 后面。模板示意：
// === Available skills (only descriptions; read SKILL.md before use) ===
// {skillsSection}
// ===
```

**修改 main.ts 启动流程**：

在 `createEsseAgent` deps 注入点附近创建一次 `skillLoader`，作为 long-lived 服务（不在每次对话创建）：

```ts
const skillLoader = createEsseSkillLoader({
  agentDir: path.join(app.getPath("userData"), "esse-skills"),
  builtInSkillsDir: path.join(app.getAppPath(), "resources", "built-in-skills"),
  getProjectDirectory: () => activeProjectDirectory,
  getUserPaths: () => settingsStore.get("esse.skillPaths") ?? [],
  getDisabledSkills: () => settingsStore.get("esse.disabledSkills") ?? []
});
await skillLoader.reload();
```

**测试**（`esseAgent.test.ts` 扩展）：

- 渲染系统提示包含 skill 描述 XML 块
- customToolDefinitions 包含 bash 工具且名字是 `bash`
- skillLoader 为空时系统提示不出现 skills 段，bash 工具仍然存在（用户可手动指示 esse 跑命令）

---

## Part 2 — 内置制品导出 skills

三个内置 skill 都用 **Node 实现**，不依赖 Python。原因：

- 老婆机器装 Python + pip + 包链路太长，第一次跑就报错很挫败
- Node 已经是 Electron 安装的一部分（pi 通过 node ESM 调用），可以直接 `node script.js`
- 包大小：`xlsx` ~2MB，`pdfkit` ~1.5MB，可接受

但 skill 自己的 npm 依赖**不打进 BatchImager 安装包**，由 skill 第一次启用时本地安装。理由：

- skill 是用户可改/可删的，依赖跟着 skill 走更干净
- 后续用户自己写的 skill 也是这个模式，统一体验

### 2.1 内置 skill `xlsx-export`

**目录**：`resources/built-in-skills/xlsx-export/`

```
xlsx-export/
├── SKILL.md
├── package.json          # 依赖 xlsx
├── package-lock.json
└── scripts/
    └── export.mjs
```

**SKILL.md**：

```markdown
---
name: xlsx-export
description: 把当前 BatchImager 项目的生成图片元数据导出成 Excel 表格。每行包含 SKU/序号、prompt、参考图、尺寸、生成时间、文件路径。当用户说"导出 Excel"、"做个清单"、"列个表"时使用。
---

# xlsx-export

把 BatchImager 项目的生成图片元数据导出为 .xlsx 文件。

## Setup（首次使用）

```bash
cd "$BATCHIMAGER_SKILL_DIR" && npm install --omit=dev
```

## Usage

```bash
# 导出整个项目所有会话
node "$BATCHIMAGER_SKILL_DIR/scripts/export.mjs" \
  --project "$BATCHIMAGER_PROJECT_DIR" \
  --output "$BATCHIMAGER_PROJECT_DIR/exports/all-sessions.xlsx"

# 只导出指定会话
node "$BATCHIMAGER_SKILL_DIR/scripts/export.mjs" \
  --project "$BATCHIMAGER_PROJECT_DIR" \
  --sessions sess-xxx,sess-yyy \
  --output "$BATCHIMAGER_PROJECT_DIR/exports/subset.xlsx"
```

## 输出格式

| 列 | 说明 |
|---|---|
| sku | 用户在会话标题里手填的 SKU，或会话序号 |
| session_label | 会话显示名 |
| image_index | 该会话内第几张图 |
| image_path | 相对项目根的路径 |
| prompt | 完整 prompt |
| reference_images | 用 ` \| ` 拼接的参考图相对路径 |
| size | `1024x1024` 等 |
| created_at | ISO 8601 |
```

**`scripts/export.mjs`**：

读 `{project}/project.json`（BatchImager 项目文件），抽取 sessions / images，写成 xlsx。不需要调任何 BatchImager API。

**测试**：在 `esseSkills.integration.test.ts` 跑一个固定 fixture 项目，校验 xlsx 文件能被 xlsx 库读回来且字段正确。

### 2.2 内置 skill `pdf-portfolio`

**目录**：`resources/built-in-skills/pdf-portfolio/`

**功能**：把指定会话的图按顺序排版成 PDF 作品集。每页一张图（满版）+ 底部 prompt 文字。封面页带项目名。

依赖：`pdfkit` + `sharp`（用于读 PNG 尺寸 / 缩放）。sharp 跨平台预编译二进制有点大（30MB），可接受。

**SKILL.md** 命令：

```bash
node "$BATCHIMAGER_SKILL_DIR/scripts/portfolio.mjs" \
  --project "$BATCHIMAGER_PROJECT_DIR" \
  --sessions sess-xxx,sess-yyy \
  --output "$BATCHIMAGER_PROJECT_DIR/exports/portfolio.pdf" \
  --title "2026 春季款"
```

### 2.3 内置 skill `project-package`

**目录**：`resources/built-in-skills/project-package/`

**功能**：把"图片 + 元数据 JSON + Excel 清单"打包成一个 zip，准备交付给客户/上下游。

```
project-package/
├── SKILL.md
├── package.json          # 依赖 archiver
└── scripts/
    └── package.mjs
```

**逻辑**：

1. 先调 xlsx-export 生成 Excel（用 `bash` 子调用，依赖 skill 之间 PATH 共享）
2. 复制选定的图片到临时目录
3. 写 `manifest.json`（项目名、生成时间、会话清单）
4. `archiver` 打 zip 到指定输出路径

**注意**：v1.2 不做 skill 间显式 dependency 机制。`project-package` 直接 spawn `node {xlsx-export 路径}` 即可，skill 加载器需要在系统提示里同时暴露三个 skill 让模型自己组合。

### 2.4 内置 skill 安装策略

**新文件**：`electron/services/esseBuiltInSkills.ts`

```ts
export async function syncBuiltInSkills(options: {
  builtInSource: string;     // resources/built-in-skills
  userTarget: string;        // {userData}/esse-skills/_built-in
  logger?: Logger;
}): Promise<void>;
```

**同步策略**：

1. app 启动时调用一次
2. 比较 `builtInSource` 下每个 skill 的 `package.json.version` 与 `userTarget` 下同名 skill 的 version
3. version 不一致或目标不存在 → 覆盖目标（清掉旧的 `node_modules` 也一并清）
4. version 一致 → 不动（保留用户可能改过的 SKILL.md / scripts）

**用户改了内置 skill 怎么办**：v1.2 简单粗暴——升级会覆盖。在 SKILL.md 顶部加注释告诉用户"想改请复制到 `~/.batchimager/esse-skills/xxx-export/` 当全局 skill 用"。后续 v1.4+ 再考虑 fork 检测。

**`npm install` 谁来跑**：

- 不在 app 启动时自动跑（每次启动都跑 install 很慢，离线也跑不动）
- 由 skill 自己的 SKILL.md "Setup" 段告诉模型：第一次用要先 `cd $BATCHIMAGER_SKILL_DIR && npm install --omit=dev`
- 模型走受控 bash 跑 install，受 broker 权限确认
- 如果 `node_modules` 已存在，install 是 no-op（npm 自己判定），重复触发也无害

**安装失败兜底**：脚本第一行 `import` 失败时退出码非 0，stderr 含明确提示。Esse 把 stderr 转述给用户，让用户知道是依赖问题。

**测试**（`esseBuiltInSkills.test.ts`）：

- 目标不存在时复制
- 版本一致时不动
- 版本不一致时覆盖且清掉 `node_modules`
- 源目录缺失时不抛（开发环境 build 还没跑过的情况）

---

## Part 3 — UI 改动

### 3.1 设置面板 Skills tab

**新建**：`src/components/SettingsPanel/SkillsTab.tsx`

布局：

```
┌─────────────────────────────────────────────────────────┐
│ Skills（共 4 个，启用 3）                  [重新扫描]  │
├─────────────────────────────────────────────────────────┤
│ ✓  xlsx-export                       内置              │
│    把项目导出成 Excel...           [查看 SKILL.md]    │
├─────────────────────────────────────────────────────────┤
│ ✓  pdf-portfolio                     内置              │
│    把选定会话排版成 PDF...         [查看 SKILL.md]    │
├─────────────────────────────────────────────────────────┤
│ ✓  project-package                   内置              │
│    打包项目交付...                  [查看 SKILL.md]    │
├─────────────────────────────────────────────────────────┤
│ ☐  brave-search                      全局              │
│    Brave 搜索...                    [查看] [移除]      │
├─────────────────────────────────────────────────────────┤
│ [+ 从 Git URL 安装]  [+ 添加搜索目录]                 │
├─────────────────────────────────────────────────────────┤
│ 诊断（2 条警告）                              [展开]   │
└─────────────────────────────────────────────────────────┘
```

每条 skill 显示：

- 启用复选框（绑 settings.esse.disabledSkills）
- 名字 + source 标签
- description 截断
- "查看 SKILL.md" 弹模态显示完整内容
- 非内置 skill 多一个 "移除" 按钮（删目录）

**IPC 新增**：

```ts
// preload 暴露：
window.esse.skills.list(): Promise<EsseSkillRecord[]>
window.esse.skills.reload(): Promise<EsseSkillLoadResult>
window.esse.skills.openSkillFile(name: string): Promise<void>   // 系统编辑器打开 SKILL.md
window.esse.skills.removeSkill(name: string): Promise<void>     // 只允许删 global/project source
window.esse.skills.setEnabled(name: string, enabled: boolean): Promise<void>
window.esse.skills.installFromGit(url: string): Promise<{ ok: boolean; error?: string }>
window.esse.skills.addUserPath(absolutePath: string): Promise<void>
```

### 3.2 从 Git URL 安装

**新文件**：`electron/services/esseSkillInstaller.ts`

```ts
export async function installSkillFromGit(options: {
  gitUrl: string;
  targetDir: string;       // {userData}/esse-skills/
  logger?: Logger;
}): Promise<{ ok: true; skillDirectoryName: string } | { ok: false; reason: string }>;
```

实现：

1. 从 URL 推断目录名（最后一段去 `.git`）
2. 目标目录已存在 → 直接报错 "已存在同名 skill，先移除再安装"
3. 调系统 `git`（用 child_process.spawn），失败时回退提示用户手动 clone
4. clone 完检查根目录是否有 `SKILL.md` 或者任意子目录有 `SKILL.md`，没有则视为非 skill 仓库，清理目标后报错
5. 成功后调 `skillLoader.reload()`，IPC 返回结果

**不做**的事：

- 不做 GitHub API 浏览 / star 排序
- 不做 npm 包形式的 skill 分发（pi 支持"pi packages"通过 npm，我们 v1.2 不开这条路，避免引入额外依赖管理）
- 不自动 `npm install`（让用户在 Esse 对话里说"装一下这个 skill 的依赖"，触发受控 bash）

### 3.3 Bash 执行的对话卡

**新组件**：`src/components/EsseChat/SkillBashCard.tsx`

Esse 调 bash 工具时在对话流里插一张卡：

```
┌──────────────────────────────────────────────────────┐
│ ▶ xlsx-export · running                  [中止]      │
├──────────────────────────────────────────────────────┤
│ $ node $BATCHIMAGER_SKILL_DIR/scripts/export.mjs ... │
├──────────────────────────────────────────────────────┤
│ [stdout 实时滚动]                                    │
│ Reading project.json...                              │
│ Found 3 sessions, 47 images                          │
│ Writing exports/all-sessions.xlsx...                 │
│ Done.                                                │
├──────────────────────────────────────────────────────┤
│ ✓ exit 0 · 1.8s                       [打开输出文件] │
└──────────────────────────────────────────────────────┘
```

关键点：

- **流式**：stdout 不等命令结束才一次性展示，跟 BashExecutionMessage 的 pi 标准事件对接（agent-session 已支持 streaming）
- **中止按钮**：点了走 AbortController → broker → operations.exec 的 signal
- **输出截断**：超过 5000 行只展示尾 200 行 + "+N 行已折叠"，完整输出存到 `{userData}/esse-bash-logs/{sessionId}/{toolCallId}.log` 供 "打开完整日志" 按钮
- **"打开输出文件" 按钮**：bash 命令里如果 stdout 有 `[BATCHIMAGER_OUTPUT] <path>` 行（约定），自动展示按钮；点了 shell.showItemInFolder

**IPC 事件**：复用 v1.1 的 `esse-tool-call` 事件，bash 工具产生的事件 toolName=`bash`，details 里带 skillName / command / cwd / streaming chunks。

**测试**（component test）：

- 接收 stdout chunks 渲染累积
- 接收 exit event 切到完成态
- 点击中止触发 callback

---

## Part 4 — 配置与持久化

### 4.1 settings 扩展

`settings.json` 加段：

```jsonc
{
  "esse": {
    "skillPaths": [],          // string[]: 用户额外添加的搜索目录绝对路径
    "disabledSkills": [],      // string[]: 按 skill name 禁用
    "bashTimeoutMs": 300000    // 默认 5 分钟，跟 run_project_command 保持一致
  }
}
```

settings schema 在 `electron/services/settingsStore.ts` 或同等位置补字段；UI 设置面板读写。

### 4.2 项目级 skill 目录

v1.2 不主动创建 `{projectDirectory}/.esse/skills/`，但 skill loader 在 `.esse/skills/` 存在时扫描它。

后续 v1.3 商城上架 skill 需要存登录态，那时再考虑要不要把 `.esse/` 目录加入 .gitignore 模板。v1.2 不处理。

---

## Part 5 — 测试

### 5.1 单元

- `esseSkillLoader.test.ts`：扫描、过滤、冲突、reload
- `esseBashTool.test.ts`：策略拒绝、broker 拒绝、env 净化、targetKey 推导、signal 传递
- `esseBuiltInSkills.test.ts`：版本同步逻辑
- `esseSkillInstaller.test.ts`：git clone 成功/失败、非 skill 仓库识别

### 5.2 集成

- `esseSkills.integration.test.ts`：用 fixture 项目跑 xlsx-export，验证输出 xlsx
- 同上跑 pdf-portfolio，验证 PDF 文件存在 + 页数正确
- 同上跑 project-package，验证 zip 内包含所有预期文件

### 5.3 LLM 真实场景（手动 / `*.llm.test.ts`）

把 `esseWorkspaceAgent.llm.test.ts` 的模式扩成 `esseSkills.llm.test.ts`：

- 给 Esse 一个项目状态 + "导出 Excel 给我" 提示
- 验证 Esse 调用了 `read` 加载 xlsx-export SKILL.md + `bash` 执行
- 验证 broker 收到 ask 请求且 allow 后 bash 实际执行

---

## Part 6 — 风险与对策

| 风险 | 对策 |
|---|---|
| 模型不调 skill，直接口头回答 | SKILL.md description 写得明确（"当用户说 X 时使用"）；formatForPrompt 段位置靠近系统提示底部更醒目；persona prompt 加一句"用户要导出/打包时直接调用相关 skill" |
| 用户首次跑 install 很慢被吓到 | bash 卡显示 stdout 实时进度；SKILL.md Setup 段写明"首次约需 30 秒" |
| 网上 skill 偷文件 | bash 走 broker 第一次必弹；agentCommandPolicy 拦保护目录 |
| skill 数量多了系统提示膨胀 | pi 的 formatSkillsForPrompt 只塞 name+description，单 skill 上限 1024 字符。预计 10 个 skill = ~10k tokens 是上限，可接受 |
| 内置 skill 升级把用户改动覆盖 | SKILL.md 顶部注释引导用户 fork 到 global 目录；v1.4+ 加自动检测 |
| Node 子进程在 Windows 找不到 node | spawn 时显式指定 process.execPath（Electron 自带 node）；SKILL.md 例子统一用 `node` 而不是脚本 shebang |

---

## 验收清单

提交 v1.2 前必须满足：

- [x] `loadSkills` / `formatSkillsForPrompt` 在 `esseSkillLoader.ts` 中正确包装，单元测试通过
- [x] `createEsseBashTool` 走 policy + broker + env 净化三道，单元测试覆盖每道拒绝路径
- [x] Esse runtime 注册了 bash 工具，名字暴露给 LLM 就是 `bash`
- [x] 系统提示包含 skill XML 段（formatForPrompt 输出）
- [x] `resources/built-in-skills/` 下三个 skill 完整可跑，本地手动 `node script.mjs` 不报错
- [x] app 启动时同步内置 skill 到 `{userData}/esse-skills/_built-in/`，版本一致时不动
- [x] 设置面板 Skills tab 可显示列表、启用/禁用、查看 SKILL.md、从 Git URL 安装、添加目录
- [x] Bash 执行对话卡流式显示 stdout、有中止按钮、退出码区分成功/失败
- [x] 集成测试跑通 xlsx / pdf / package 三个 skill
- [x] LLM 测试（手动）：真实 LLM smoke 通过；完整 workspace LLM eval 在本机长时间无输出后手动中止，未作为发布阻断项
- [x] CLAUDE.md 不强制更新，但 README 加一段"Esse Skills" 简介 + 链接到本文档
- [x] [esse-agent-roadmap.md](./esse-agent-roadmap.md) v1.2 段状态从"开发中"改"已发布"
