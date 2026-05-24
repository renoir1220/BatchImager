# Esse Agent v1.3 计划草稿：浏览器自动化基础设施

> **状态**：草稿。v1.2 收尾前细节可能再调整，但本文档的"v1.2 必须预留的接口"已经定稿，Codex 实现 v1.2 时必须按此预留。

## 背景

v1.2 让 Esse 能调 skill，跑短命令（导出 Excel、打 zip）。但有一类用户的真实工作流是**用浏览器在第三方网站上完成事务**——商品上架、批量回复消息、报表上传、抓数据。这些事 BatchImager 工作区工具碰不到，short-running skill 也不够（playwright 启动后会跑几分钟到几十分钟）。

v1.3 不写任何"商城专属"的脚本。**专属脚本由更强的 agent（Claude Code / Codex）写好放进 skill 目录，Esse 负责执行 + 与用户交互**。这是用户在 v1.2 讨论中明确的诉求："不期望 Esse 一开始就能去探索这个网站并自动完成脚本……Esse 至少能用就行"。

## 核心目标场景

> "我老婆做完商品图后，下一步要拿着图 + Excel 商品资料，到 XX 商城上架。希望 Esse 能通过 playwright 帮她完成自动上架。"

理想流程：

1. 用户在 Esse 对话里说："把这个项目的 30 个商品上架到 XX 商城"
2. Esse 识别意图 → 调 `read` 加载 `upload-to-xxx-shop` 的 SKILL.md
3. SKILL.md 描述了输入约定（图片目录 + Excel 路径 + 登录态文件位置）
4. Esse 调受控 bash 启动脚本，**浏览器窗口可见**（让用户监督）
5. 脚本：
   - 加载 storageState（cookies），未登录则提示用户在浏览器里手动登录
   - 读 Excel 一行一行处理：填表 → 上传图 → 提交
   - 出错截图，继续下一个
6. 跑完后 stdout 输出结构化结果（成功/失败 SKU 清单）
7. Esse 转述给用户："30 个里 28 个成功，2 个失败：prod_007 卡在验证码，prod_012 类目找不到，要不要重试"

## 主要工作

### A. 长进程 + 流式 stdout 增强

v1.2 的受控 bash 已经支持流式 stdout（pi `createBashToolDefinition` 原生支持），v1.3 需要：

- **超时上限取消**：playwright 自动化可能跑 30 分钟，bash 工具的 timeout 必须支持显式 `--no-timeout` 标记或 skill frontmatter 字段
- **进度心跳**：长进程 5 分钟没输出会让 Esse 上下文觉得"卡死"。约定 skill 脚本周期性输出 `[BATCHIMAGER_PROGRESS] <message>` 行，对话卡专门渲染，不进入模型上下文
- **后台模式**（可选）：用户可以让 Esse 把 skill "扔到后台" 继续聊别的事，bash 完成时插入完成通知。技术上需要把 bash 工具的 promise 解耦出 turn budget，等 v1.3 设计阶段再敲定

### B. 内置 skill `browser-automation-base`

**目的**：给"商城上架"这类 skill 提供地基，让 Claude Code / Codex 在它上面写专属脚本只关心"这个网站的字段映射"，不关心"playwright 怎么启动"。

**目录结构**：

```
browser-automation-base/
├── SKILL.md
├── package.json              # playwright-core（不带浏览器）+ chrome-launcher
├── scripts/
│   ├── launch-browser.mjs    # 启动系统 Chrome / Edge，加载 storageState
│   ├── save-storage.mjs      # 保存登录态
│   └── utils/
│       ├── progress.mjs      # 输出 [BATCHIMAGER_PROGRESS]
│       └── error-capture.mjs # 失败截图归档
└── README.md                 # 给 Claude Code/Codex 看：怎么基于这个 skill 写专属脚本
```

**关键设计**：

- **不下载 chromium**：用 `playwright-core` 而不是 `playwright`，配合 chrome-launcher 启动系统 Chrome（或 Edge，Windows 自带）
- **storageState 位置**：`{projectDirectory}/.esse/browser-states/{skill-name}.json`，跨项目不共享（项目隔离登录态）
- **失败截图**：自动写到 `{projectDirectory}/.esse/runs/{timestamp}/{label}/error.png`，对话卡末尾给"打开运行目录"按钮

### C. Skills 面板增强

- **凭据管理 tab**：显示已登录的网站（即 storageState 文件列表）、上次登录时间、"清除登录态" 按钮
- **运行历史**：最近 N 次 skill 运行的退出码、耗时、关联会话；点击展开 stdout
- **依赖检测**：启动时检测系统 Chrome 是否存在，缺失时在 Skills tab 顶部提示

### D. 文档：给 Claude Code 写 skill 的指南

新建 `docs/esse-skill-authoring-for-coding-agents.md`：

- skill 必须遵守的输出约定（progress / output 标记）
- env 可用变量列表
- 失败处理规范
- 一个完整的"商城上架"脚本骨架样例

**这份文档是 v1.3 真正的杠杆**——把专属脚本生产的成本压到极低。

## v1.2 必须预留的接口（定稿）

Codex 实现 v1.2 时必须保证以下点，否则 v1.3 要回去改 v1.2：

| 项 | 要求 | v1.2 落点 |
|---|---|---|
| AbortSignal 全链路 | bash 工具收到 abort 后能立刻杀子进程组（不只是 SIGTERM 后等命令自己退） | `createEsseBashTool` 的 `signal` 一路传给 pi 的 `operations.exec`，pi 内部用 `process.kill(-pid, 'SIGTERM')` 杀进程组 |
| Env 注入扩展点 | v1.3 要加 `BATCHIMAGER_BROWSER_CHANNEL` / `BATCHIMAGER_STORAGE_DIR` 等 env，不破坏 v1.2 形状 | `sanitizeBashEnv` 接受 `extraInjected: Record<string,string>` 参数，v1.2 传空对象 |
| stdout 流式 IPC | 对话卡能接 streaming chunk 事件 | `esse-tool-call` 事件 details 增加 `chunk` 字段；v1.2 即使只在退出时发一次也要把字段定下来 |
| 长输出归档 | v1.2 已经做了 `{userData}/esse-bash-logs/` | v1.3 复用 |
| 进度行识别 | 对话卡能根据 `[BATCHIMAGER_PROGRESS]` 前缀分流 | v1.2 不必实现分流，但 stdout 渲染组件预留 prefix-based filter hook |
| skill metadata 透传 | v1.3 可能用 frontmatter 自定义字段（`no-timeout: true`）控制 bash 行为 | v1.2 的 `EsseSkillRecord` 已经透传 pi 的整个 frontmatter 字典；v1.3 直接读 |
| 项目级 `.esse/` 目录约定 | storageState、运行历史都要放这里 | v1.2 skill loader 已经扫描 `.esse/skills/`，v1.3 在同级加 `.esse/browser-states/` 和 `.esse/runs/`；v1.2 不需要主动创建，但保证后续读写不冲突 |

## v1.3 不做的事

- **商城专属脚本**：交给 Claude Code / Codex 现场写，BatchImager 不内置
- **绕过反爬 / 验证码自动识别**：用户老婆是真实卖家，合法用途，走"可见浏览器 + 必要时人工介入"路线；v1.3 设计的就是人机协作
- **多浏览器分发**：只支持 Chrome / Edge，不做 Firefox / Safari
- **playwright record/replay UI**：不做录制器，专属脚本靠 coding agent 写

## 风险与对策（先列，v1.3 启动前再补）

| 风险 | 对策 |
|---|---|
| 用户机器没装 Chrome | 启动时检测，缺失则提示安装链接；不做内置 chromium |
| storageState 过期/被网站清掉 | 脚本检测到未登录立刻暂停 + 提示"请在窗口里重新登录" |
| 长进程吃光 Esse 上下文 | 默认 stdout 只把最后 100 行回灌模型；完整日志另存盘 |
| 多个 skill 同时跑浏览器抢资源 | v1.3 加 skill 互斥锁（同时只允许一个 `requires-browser: true` 的 skill 在跑） |
| 商家的网站改版导致脚本失效 | 由 Claude Code 重新跑一遍生成脚本即可；BatchImager 不承诺脚本可用性 |

## 后续细化时机

v1.2 进入测试阶段（验收清单 80% 完成）后，把本文档展开成完整 plan，按 v1.1 / v1.2 的格式补：

- 每个文件的具体改动
- 单元测试 / 集成测试清单
- UI 组件树
- 验收清单
