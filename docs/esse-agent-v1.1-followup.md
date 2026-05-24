# Esse Agent v1.1 跟进修复

v1.1 主体已合（25 commits）。代码评审发现 3 个真 bug、1 处实现细节问题、2 处与 plan 的偏离要追认。每项给出具体 patch 指令、测试要求、验收点。修完 v1.1 收尾。

---

## Bug 1：EsseBatchTaskRegistry.retryCountsByBatchId 内存泄漏

### 现状

[electron/services/esseBatchTaskRegistry.ts](electron/services/esseBatchTaskRegistry.ts)

`tasksById` 在 batch 完成（notifyItemComplete → deleteTaskIfDrained）或 cancelAll 时正确清理；但 `retryCountsByBatchId` 永远不清理。长跑的 main 进程会无限累积。

### Patch

```diff
   private deleteTaskIfDrained(task: RegisteredBatchTask): void {
     if (task.controllersBySessionId.size === 0) {
       this.tasksById.delete(task.batchTaskId);
+      this.retryCountsByBatchId.delete(task.batchTaskId);
     }
   }
```

`cancelAll` 也要补：

```diff
   cancelAll(batchTaskId: string): { canceledCount: number } {
     const task = this.tasksById.get(batchTaskId);
     if (!task) {
       return { canceledCount: 0 };
     }

     let canceledCount = 0;
     for (const controller of task.controllersBySessionId.values()) {
       controller.abort();
       canceledCount += 1;
     }
     this.tasksById.delete(batchTaskId);
+    this.retryCountsByBatchId.delete(batchTaskId);
     return { canceledCount };
   }
```

### 测试

`esseBatchTaskRegistry.test.ts` 新增：

- 注册 batch → cancel/complete 所有 item → 断言 `retryCountsByBatchId.size === 0`（用一个 getter 暴露 size，或 friend access）
- 100 次循环 register + 全部 complete → 内部 Map 不增长
- cancelAll 后同样不残留 retryCounts

### 验收

跑测试通过 + grep 确认 `retryCountsByBatchId.delete` 在两个清理点都被调用。

---

## Bug 2：package_generated_images 双重确认

### 现状

[electron/services/esseWorkspaceTools.ts:580](electron/services/esseWorkspaceTools.ts#L580) 把 `package_generated_images` 标 `risk: "external-write"`。
[electron/services/essePermissionPolicy.ts:11](electron/services/essePermissionPolicy.ts#L11) 默认 `external-write: "ask"`。
同时 `requiresPreflight: true`。

结果：用户每次打包要点 broker 卡片一次 + preflight 卡片一次。preflight 已经覆盖打包内容（多少张、写哪里、估算 0 API 调用），broker 再问一遍冗余。

### Patch

`package_generated_images` 改成 safe-write，preflight 单独兜底：

```diff
   {
     name: "package_generated_images",
     label: "打包生成图",
-    risk: "external-write",
+    risk: "safe-write",
     requiresPreflight: true,
     description: ...,
     ...
     async execute(_toolCallId, params) {
       ...
-      const permission = await requestWorkspaceToolPermission(runtime, { label: "打包生成图", name: "package_generated_images", requiresPreflight: true, risk: "external-write" }, params);
+      const permission = await requestWorkspaceToolPermission(runtime, { label: "打包生成图", name: "package_generated_images", requiresPreflight: true, risk: "safe-write" }, params);
```

**不要**改 essePermissionPolicy 把 external-write 默认 allow——`add_reference_image` 仍是 external-write 且**没有** preflight，broker 拦它是合理的（写文件到项目目录是不可逆操作）。让 broker 只挡真正没有其他保护的工具。

### 测试

`esseWorkspaceTools.test.ts` 新增：

- mock policy `external-write: "ask"` + mock broker 计数 request 次数 → 调 `package_generated_images` → 断言 broker.request 被调 0 次（safe-write 默认 allow），preflight.request 被调 1 次
- 同样 mock 调 `add_reference_image` → 断言 broker.request 被调 1 次（external-write 仍走 ask）

### 验收

跑测试通过 + 手动 smoke：用户点"打包到桌面"应该只看到 1 个确认卡片（preflight），不再有 permission 卡片。

---

## Bug 3：Undo 是完整 state 回滚（接受现状 + 加防御）

### 现状

[electron/services/esseWorkspaceTools.ts:1144](electron/services/esseWorkspaceTools.ts#L1144) `createRestoreWorkspaceDescriptor` 每次写工具调用前都 deep-clone 整组 sessions 作为 inverse。导致：

1. **存储膨胀**：100 张图项目单条 entry 500KB+，50 条上限 = 25MB 项目 SQLite。
2. **undo 会回退中间的非 esse 操作**：T1 Esse 写 → T2 用户 UI 写 → T3 undo，T2 用户改的内容丢失。

与 plan v1.1 设计的 8 种 per-tool inverse descriptor 偏离，但 Codex 这个简化是工程合理取舍（避免维护 8 种 reducer 逆操作）。

### 决策：接受现状 + 三层防御

**不**改成 per-tool inverse（B 方案）或 diff-only（C 方案）——工作量大、收益不匹配。采用 A 方案：保留现实现 + 加防御 + 更新 plan 风险章节。

### Patch

#### 1. 防御性检测中间的非 esse 写入

在 `appendUndoEntry` / `createUndoEntry` 加 `expectedNextSinkRevision`，记录 sink 当前版本号；undo 时如果 sink 当前 revision 与 entry 记录的下一条预期 revision 不匹配，说明中间有其他写入，给用户明确提示。

`ProjectMutationSink` 加版本号：

```diff
 export class ProjectMutationSink<TState> {
   private chain: Promise<unknown> = Promise.resolve();
+  private currentRevision = 0;
+
+  getRevision(): number {
+    return this.currentRevision;
+  }

   apply(mutator: (current: TState) => TState): Promise<TState> {
     const next = this.chain.then(async () => {
       const state = await this.options.applyTransaction(mutator);
+      this.currentRevision += 1;
       this.options.broadcast?.(state);
       return state;
     });
     this.chain = next.catch(() => undefined);
     return next;
   }
 }
```

`PersistedUndoEntry` 加字段（不破坏现有数据，旧条目读出时该字段 undefined，按"无防御"对待）：

```diff
 interface PersistedUndoEntry {
   affectedSessionIds: string[];
   createdAt: string;
   id: string;
   inverseDescriptor: SerializableUndoDescriptor;
+  sinkRevisionAfter?: number;  // entry 写入时 sink 完成 apply 后的 revision
   summary: string;
   toolName: string;
   undone?: boolean;
 }
```

`appendUndoEntry` 写入时填 `sinkRevisionAfter = sink.getRevision()`（需要把 sink 引用传到 mutationTool）。

undoLastActions 拿到 entries 后，检查最后一条 entry 的 `sinkRevisionAfter + N` 是否等于 sink 当前 revision（N = entries.length - 1）。不一致 → 返回 ok=true 但 result.summary 加警告：

```ts
const expectedRevision = entries[0].sinkRevisionAfter + entries.length;
const actualRevision = sink.getRevision();
const hasInterleaved = expectedRevision !== undefined && actualRevision > expectedRevision;

if (hasInterleaved) {
  // 在 reply 摘要前缀加警告
  summaryWithWarning = `⚠️ 撤销期间检测到 ${actualRevision - expectedRevision} 个非 Esse 操作可能也被回退。${baseSummary}`;
}
```

这不阻断 undo，但让用户和模型看到风险。模型应该在 reply 里转告用户。

#### 2. 更新 prompt 警告

`buildEsseWorkspaceTurnPrompt` 工作流部分加：

```
- undo_last_actions 会把工作区整体回退到那个时刻的状态。如果在 esse 写操作之间用户手动改过工作区（添加图片、改参考图等），undo 也会把那些手动操作一起回退。tool 结果如果带 ⚠️ 警告，必须在 reply 里告诉用户"这次撤销可能影响了 N 个非 Esse 操作"。
```

#### 3. 更新 v1.1 plan 文档

在 `docs/esse-agent-v1.1-plan.md` 的 2.2 Undo 工具章节，把"per-tool inverse descriptor"段替换成：

```markdown
#### 实现选择：完整 state 快照而非 per-tool inverse

v1.1 实际实现采用简化方案：每条 undo entry 保存调用前的完整 workspace state（sessions + selectedSessionId + referenceImages + projectImageCount），undo 时直接替换为这个快照。

取舍说明：
- ✅ 实现简单，所有 reducer 自动支持 undo，不用维护 N 种 per-tool 逆操作
- ⚠️ 存储膨胀：单条 entry ~500KB（100 张图项目），50 条上限 ~25MB
- ⚠️ undo 会回退中间发生的非 Esse 操作（手动 UI 操作等）

防御：通过 sink revision 检测中间非 esse 写入，warning 透传给模型和用户；不阻断 undo。

如果未来生产观察到存储或语义问题，再考虑改成 per-tool inverse 或 diff-only 方案。
```

风险章节同步更新原"Undo 日志膨胀"条，反映实际存储量。

### 测试

新增：

- mutationSink revision 正确递增（成功 +1，失败不变）
- undo 内部计算 expectedRevision vs sink.getRevision() 正确识别中间写入
- 模拟"esse 写 → 直接 sink.apply 一次（模拟手动 IPC）→ undo"，断言 result.summary 包含 ⚠️ 警告
- 模拟连续 esse 写之间无其他写入 → undo summary 不含警告

### 验收

跑测试通过 + plan 文档更新 + LLM eval 加场景验证模型看到 ⚠️ 时在 reply 中转告。

---

## 实现细节 1：memory renderForPrompt 可能截掉规则段

### 现状

[electron/services/esseMemoryStore.ts:215-225](electron/services/esseMemoryStore.ts#L215)：

```ts
const selected: string[] = [];
for (const line of lines) {
  const candidate = [...selected, line, "- 更多记忆请用 list_remembered_preferences 查看。"].join("\n");
  if (candidate.length > MAX_PROMPT_CHARS) {
    selected.push("- 更多记忆请用 list_remembered_preferences 查看。");
    break;
  }
  selected.push(line);
}
```

按 line 累积，记忆条目占用预算后，后面的"记忆管理规则"段可能被截掉。规则段告诉模型"调 remember 后要 reply 告知用户"——被截后模型不知道这条约束。

### Patch

改成"规则段保留预算，记忆条目按剩余预算填充"：

```ts
const RULES_LINES = [
  "记忆管理规则：",
  "- 在做决策时优先遵守上述记忆中的偏好和约束",
  // ...其余规则
];
const RULES_TEXT = RULES_LINES.join("\n");

function renderMemoryForPrompt(entries: EsseMemoryEntry[]): string {
  if (!entries.length) return "";

  const header = "==== 全局记忆（用户跨项目偏好，必须遵守）====";
  const truncationHint = "- 更多记忆请用 list_remembered_preferences 查看。";
  const reservedLength = header.length + 1 + RULES_TEXT.length + 1 + truncationHint.length;
  const budgetForEntries = MAX_PROMPT_CHARS - reservedLength;

  const entryLines: string[] = [];
  for (const category of MEMORY_CATEGORIES) {
    const categoryEntries = entries.filter((entry) => entry.category === category);
    if (!categoryEntries.length) continue;
    const candidateLines = [`${category}：`, ...categoryEntries.map((entry) => `- ${entry.content}`)];
    const candidateText = [...entryLines, ...candidateLines].join("\n");
    if (candidateText.length > budgetForEntries) {
      entryLines.push(truncationHint);
      break;
    }
    entryLines.push(...candidateLines);
  }

  return [header, ...entryLines, RULES_TEXT].join("\n");
}
```

预算分配：规则段总是包含 + 记忆条目按剩余预算填充 + 超限时插提示而不是丢规则。

### 测试

- 大量记忆条目（>2000 字符）→ 输出包含 "记忆管理规则" 段
- 大量记忆条目 → 输出包含 truncationHint
- 单条记忆 → 输出不含 truncationHint
- 0 条 → 返回空字符串

### 验收

测试通过 + grep 确认 prompt 注入路径调用新逻辑。

---

## 流程修复：main.ts 有未提交的 app icon 改动

### 现状

`git diff electron/main.ts` 显示有 `loadAppIconForTheme` / `applyAppIcon` / `registerAppIconThemeListener` 等改动，是主题切换 app icon 功能，**与 v1.1 plan 无关**。留在工作目录污染下次提交。

### Patch

让 codex 单独提一个 commit："Add theme-aware app icon"，包含：

- `electron/main.ts` 当前未提交改动
- `src/assets/app-icons/batchimager-esse-os26-dark.png` / `-light.png` 新文件
- `src/assets/app-icons/batchimager-esse-os26.png` / `batchimager.icns` / `batchimager.ico` 现有 modified

不要混进 v1.1 follow-up 的修复 PR。

---

## plan 偏离追认

### 偏离 A：generate_image / run_batch_generation 风险标 safe-write 而非 destructive

v1.0 review 时 Codex 建议过"显式标 destructive 让 broker 后续切 ask"，但实际实现标了 safe-write。这是**正确判断**：preflight 已经管 API 成本，broker 再标 destructive 会让 v1.1 default ask 后出现"4 张图弹 4 次 broker 卡片 + 1 次 preflight"灾难。

### Patch

更新 `docs/esse-agent-v1.1-plan.md` 的 2.1 章节，在 policy 表后加：

```markdown
#### 为什么 generate_image / run_batch_generation 是 safe-write

虽然这些工具调 imagen API、消耗 credit，但 broker policy 把它们标 destructive 会与 preflight 形成双重确认：用户在 preflight 已经看到完整命令列表和 API 调用数，broker 再问一遍就是冗余。

风险类别的设计原则：
- broker 拦截"没有其他用户保护的写操作"
- preflight 已覆盖的工具不再走 broker

按这个原则：
- generate_image / run_batch_generation：有 preflight → safe-write，broker 默认 allow
- package_generated_images：有 preflight → safe-write，broker 默认 allow（v1.1 修复后）
- add_reference_image：无 preflight → external-write，broker 默认 ask
- delete_session_record 等数据销毁：无 preflight → destructive，broker 默认 ask
```

### 偏离 B：Undo 实现简化

见 Bug 3 已合并处理。plan 2.2 章节按 Bug 3 patch 更新。

---

## 提交策略

建议拆 4 个 PR：

1. **PR A：内存泄漏 + permission 双重确认**（Bug 1 + Bug 2）。低风险，先合。
2. **PR B：memory prompt 截断**（实现细节 1）。独立，无依赖。
3. **PR C：Undo sink revision 防御 + plan 文档更新**（Bug 3 + 偏离 B）。中等改动，影响 mutationSink 接口。
4. **PR D：app icon 主题**（流程修复）。独立。

PR A/B/D 可以并行；PR C 因为改 mutationSink 接口，建议最后合，让 A/B 验证一段时间没问题再做。

---

## 全部修完后的最终验收

- `npm run eval:esse`：所有用例通过，新增的 4 个 Bug/细节测试也通过
- `npm run eval:esse:llm`：8 个场景仍通过 + 新增 1 个 "撤销带警告"场景
- `npm test`：全绿
- `npm run typecheck` / `npm run build`：通过
- 手动 smoke：
  - 打包到桌面 → 只看到 1 个确认卡片
  - 跑 100 次 batch 后 inspect main 进程内存，retryCountsByBatchId 应该是空
  - undo 在 esse 写之间夹一个手动操作的场景 → reply 包含 ⚠️ 警告

修完即可声明 v1.1 收尾，开始规划 v1.2。
