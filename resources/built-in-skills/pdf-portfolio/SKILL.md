---
name: pdf-portfolio
description: 把当前 BatchImager 项目的生成图片排版成 PDF 作品集。每页展示一张图和对应 prompt。当用户说“导出 PDF”“作品集”“给客户看一版”时使用。
---

# pdf-portfolio

内置 skill。请不要直接修改本目录；如果需要自定义，请复制到全局 skills 目录后再改。

## Setup

首次使用前运行：

```bash
cd "$BATCHIMAGER_SKILL_DIR" && npm install --omit=dev
```

## Usage

```bash
node "$BATCHIMAGER_SKILL_DIR/scripts/portfolio.mjs" \
  --project "$BATCHIMAGER_PROJECT_DIR" \
  --output "$BATCHIMAGER_PROJECT_DIR/exports/portfolio.pdf" \
  --title "BatchImager 作品集"
```

只导出指定 session：

```bash
node "$BATCHIMAGER_SKILL_DIR/scripts/portfolio.mjs" \
  --project "$BATCHIMAGER_PROJECT_DIR" \
  --sessions sess_a,sess_b \
  --output "$BATCHIMAGER_PROJECT_DIR/exports/portfolio.pdf"
```

成功时 stdout 会输出 `[BATCHIMAGER_OUTPUT] <path>`。
