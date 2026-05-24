---
name: xlsx-export
description: 把当前 BatchImager 项目的生成图片元数据导出成 Excel 表格。每行包含会话、生成图、prompt、状态、文件路径。当用户说“导出 Excel”“做个清单”“列个表”时使用。
---

# xlsx-export

内置 skill。请不要直接修改本目录；如果需要自定义，请复制到全局 skills 目录后再改。

## Setup

首次使用前运行：

```bash
cd "$BATCHIMAGER_SKILL_DIR" && npm install --omit=dev
```

## Usage

```bash
node "$BATCHIMAGER_SKILL_DIR/scripts/export.mjs" \
  --project "$BATCHIMAGER_PROJECT_DIR" \
  --output "$BATCHIMAGER_PROJECT_DIR/exports/all-sessions.xlsx"
```

只导出指定 session：

```bash
node "$BATCHIMAGER_SKILL_DIR/scripts/export.mjs" \
  --project "$BATCHIMAGER_PROJECT_DIR" \
  --sessions sess_a,sess_b \
  --output "$BATCHIMAGER_PROJECT_DIR/exports/subset.xlsx"
```

成功时 stdout 会输出 `[BATCHIMAGER_OUTPUT] <path>`。
