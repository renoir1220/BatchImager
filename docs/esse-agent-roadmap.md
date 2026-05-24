# Esse Agent 演进路线

本文档统揽 Esse 从 v1.0 到未来版本的演进方向，每个版本指向更详细的 plan 文档。新建版本计划前先在此登记，避免相互冲突。

## 总体设计哲学

Esse 不是"问答机器人"，而是"对项目有操作权的小同事"。每个版本的衡量标准：

> 用户花的"指挥成本"是不是显著低于自己手动操作的成本？

具体取舍：

- **每次只往前迈一档**：v1.0 把 Esse 立成 agent，v1.1 让它日常可用，v1.2 让它"会用外部工具"，v1.3 让它"会驱动浏览器"。每个版本完成一件事，不试图同时引入多个新概念
- **优先选标准协议**：[Agent Skills 标准](https://agentskills.io)、pi SDK 的 customTool 协议——选公共标准让 Esse 复用更广的生态
- **安全靠分层防线，不靠功能阉割**：默认权限给到位，靠 permission broker + command policy + env 净化拦风险，不为了安全砍能力
- **状态权威在 main 进程**：渲染层不持有原始状态，避免双写不一致；customTool 通过 `EsseWorkspaceToolRuntime` 走 sink

---

## 已发布

### v1.0 — Agent 重构（已发布）

- [esse-workspace-record-tool-plan.md](./esse-workspace-record-tool-plan.md)
- 把 Esse 从"JSON 响应生成器"重构成 customTool-only agent
- 立 main 为状态权威，`ProjectMutationSink` 串行化项目状态变更
- preflight broker 与 permission broker 解耦
- 工作区基础工具：list/select/append/edit/delete 会话、修改 prompt/size/reference

### v1.1 — 日常可用化（已发布）

- [esse-agent-v1.1-plan.md](./esse-agent-v1.1-plan.md) + [esse-agent-v1.1-followup.md](./esse-agent-v1.1-followup.md)
- v1.0 遗留 bug 全部清掉，plan 与代码对齐
- broker ask 模式：destructive / external-write 默认弹窗确认，session 内 allow 缓存
- undo 工具
- 参考图管理（list/add/remove）
- preflight v2 modify
- 批量并行：fire-and-forget 批任务卡 + 失败项重试 + 新会话身份修复
- 全局 markdown 记忆（Claude Code 风格触发）

---

## 已发布

### v1.2 — 会用工具的同事（已发布）

> **主题**：让 Esse 能调外部 skill 完成 BatchImager 工作区之外的事。
> **杠杆点**：制品导出（Excel / PDF / 项目交付包）三个内置 skill 让用户立刻看到价值。

- [esse-agent-v1.2-plan.md](./esse-agent-v1.2-plan.md)
- 接入 pi 的 Skills 系统（loadSkills / formatSkillsForPrompt）
- 受控 bash 工具（policy + broker + env 净化）
- 内置三个制品导出 skill（Node 实现，不依赖 Python）
- 设置面板 Skills tab + Git URL 一键安装
- Bash 执行对话卡（流式 stdout + 中止）

---

## 规划中

### v1.3 — 浏览器自动化基础设施（规划中）

> **主题**：让 Esse 能驱动 playwright 跑长进程，为商城上架等真实业务场景打地基。
> **核心约束**：BatchImager 不写商城专属脚本，专属脚本由 Claude Code / Codex 现场生成放进 skill 目录。

- [esse-agent-v1.3-plan.md](./esse-agent-v1.3-plan.md)（草稿）
- bash 工具长进程支持 + 进度心跳 + 后台模式（可选）
- 内置 `browser-automation-base` skill 模板
- Skills 面板增强：凭据管理 / 运行历史 / 依赖检测
- 给 coding agent 看的 skill 编写指南

---

## 候选方向（v1.4+，未排期）

按"对用户感知价值"粗排，正式立项时再做取舍。

### 工作流编排（A 类同事感）

> 用户一句话甩出去后回来已经搞完了。

- "把这 50 张产品图按色系分三组生成，每组用不同 prompt 模板" → Esse 自动拆解、批量调度、命名归档
- "会话 A 的风格规则套到会话 B 全部图" → 跨会话读写 + 批量重跑
- 技术核心：Esse 能调度多个 customTool 串成"读 → 决策 → 写 → 验证"的流水线，且能在中途因风险点停下来跟用户确认

### 主动总结（C 类同事感）

> Esse 不只在被问时回答，会主动给提示。

- 批量任务跑完 Esse 自动发"30 张里 4 张风格偏离主题色，要不要重生成"
- 检测到用户连续 5 张同一 prompt → "你是想生成同一张图的变体吗，要不要切到批量？"
- 技术核心：在 mutation sink 上挂观察者，达到阈值时触发 Esse 一次"自发 turn"

### 项目 brief 理解（D 类同事感）

> 用户拖入需求文档，Esse 直接搭好工作区。

- 拖入 brief.docx / brief.pdf / brief.md → xlsx skill 读出 → Esse 自动建一组会话和 prompt 模板
- 拖入截图 → "按这个风格做" → 自动加到参考图库

### 多 skill 协作 / skill 依赖

v1.2 不做 skill 显式 dependency，只能 skill 间 spawn 调用。如果生态丰富后变成痛点，再补：

- skill frontmatter 加 `requires` 字段
- skill loader 拓扑排序展示
- "跑 A 前先确保 B 已 setup"

### 跨项目记忆

v1.1 全局记忆已经做了。如果用户提出"项目级记忆"需求（v1.1 讨论时回滚过，理由"上下文够了"），再单独立项。

---

## 不在路线上的事

明确不做，避免反复讨论：

- **MCP 集成**：沿用 pi 立场。理由：MCP server 通常一上来吃十几 k tokens（Playwright MCP 13.7k、Chrome DevTools MCP 18k），可组合性差，不可方便修改。skill + bash 模型在我们的场景下完整覆盖需求。如果未来某个用户场景**只有** MCP 形式的服务（比如某个企业内部系统只暴露 MCP），可以作为单独 skill 包装一层
- **多模型路由 / model 自动切换**：维持单模型配置，让用户在 settings 里选。Esse 不为"省钱"主动降级模型
- **训练 / 微调流程**：BatchImager 是消费工具不是训练平台
- **协同编辑 / 多用户**：单用户本地工具
- **云端会话同步**：项目数据本地优先，不主动做云端

---

## 版本号与发布节奏

- **major.minor**：major 重构核心抽象时升（v1.0 -> v2.0 暂无计划）；minor 加显著用户可感能力
- **patch**：bug fix / 小优化，不进路线图
- **草稿状态**：plan 文档在 `## 状态` 段标注 `草稿` / `开发中` / `已发布`
- **本路线图同步**：每次发版后更新本文档对应版本段的状态

## 修订记录

- 2026-05-24：v1.2 已发布：接入 Agent Skills、受控 bash、三个内置导出 skill、Settings Skills 管理和 bash 执行卡
- 2026-05-24：建立路线图，登记 v1.0 / v1.1 已发，v1.2 开发中，v1.3 规划中
