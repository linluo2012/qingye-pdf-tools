# 部署到 Cloudflare Pages

与另两个站点（`网站副业` / `网站副业2`）同一套流程：

```
改代码 → ./deploy.sh "说明" → git push → Cloudflare Pages 自动构建 → 线上更新
```

## 一次性配置

### 1. 建 Pages 项目

Cloudflare 控制台 → Workers 和 Pages → Create application → Pages → Connect to Git

| 项 | 值 |
| --- | --- |
| 框架预设 | `None` |
| 生产分支 | `main` |
| 构建命令 | `python3 build.py --build` |
| 构建输出目录 | `dist` |
| 根目录 | 留空 |
| 环境变量 | 不用加 |

> 构建命令**不能留空**，也不能漏掉 `--build`。仓库里的 `site/` 与 `dist/` 都在 `.gitignore` 中，
> 产物不入库；Cloudflare 会在云端拉下源码后自己跑 `build.py` 生成 `dist/`。
> 这与 `网站副业2` 的配置完全一致。

字段逐项说明、填错后的现象、构建日志对照表见
**[01-cloudflare-pages.html](01-cloudflare-pages.html)**（可直接在浏览器打开）。

### 2. 绑自定义域名

Pages 项目 → Custom domains → 添加 `pdf.linwt.top`。

Cloudflare 会自动加 DNS 记录；若要求手动添加，填：

```
类型：CNAME
名称：pdf
目标：<项目名>.pages.dev
```

### 3. 首次验证

推送后等约 30 秒，检查这三项：

- `https://pdf.linwt.top/` 能打开，工具列表正常
- 在浏览器开发者工具的 Network 面板里看 `vendor/pdf-lib.min.mjs` 的响应头，
  确认 `Cache-Control` 含 `max-age=604800`
- **试一次 OCR** —— 它依赖 8MB 的 wasm 与语言模型，最容易因路径或 MIME 问题失败

> 不要访问 `/_headers` 来验证配置。Cloudflare Pages 会把它当页面路由，
> 返回的是首页 HTML 而不是配置文件内容。要确认静态头是否生效，
> 只能看真实资源的响应头。

## 预压缩

`build.py` 会为所有文本资源（`.html` / `.css` / `.js` / `.mjs` / `.json` / `.xml` / `.txt` / `.svg`）
生成 `.gz` 副本，原文件同时保留。实测省下约 9MB —— 470KB 的 `pdf-lib.min.mjs` 压到 202KB。

只生成 `.gz` 不生成 `.br`：Python 标准库没有 Brotli，而 Cloudflare 收到 `.gz` 后会自行
转成 Brotli 下发给支持的浏览器，效果等同。

已经压缩过的文件（`*.traineddata.gz`）和图片不会被二次压缩。

## 关于两个入口并存

线上同时存在两个可访问地址，内容完全相同：

- `https://pdf.linwt.top/`（Cloudflare，主入口）
- `https://qingye-pdf-tools.app.workbuddy.host/`（保留）

`sitemap.xml` 与 `robots.txt` 里两个都声明了。若将来不想保留第二个，
用发布工具下线即可，代码不用动。

## 回滚

```bash
git revert HEAD --no-edit && git push origin main
```

约 30 秒后线上自动回到上一版。

## 常见问题

**OCR 报"核心组件加载失败"**
说明 `vendor/ocr/` 没被正确发布。检查 `build.py` 的 `INCLUDE_DIRS` 是否含 `vendor`。

**OCR 报 `importScripts` 失败**
`_headers` 里给 `/vendor/ocr/worker.min.js` 指定了 `Content-Type: application/javascript`。
浏览器会用该头判断是否接受 `importScripts`，类型不对会直接拒绝。

**改动没上线**
Cloudflare Pages 只在 push 到生产分支后触发。若在 Cloudflare 控制台改过构建配置，
确认构建命令仍是 `python3 build.py --build`、输出目录是 `dist`。