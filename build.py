#!/usr/bin/env python3
"""
build.py — 构建 Cloudflare Pages 产物

与另两个站点（网站副业 / 网站副业2）保持同一套约定：
  1. 把需要发布的内容同步到输出目录
  2. 生成 _headers（Pages 的静态头配置）
  3. 生成 sitemap.xml / robots.txt（同时声明多个入口域名）
  4. 校验：产物完整性、关键资源存在性

用法：
    python3 build.py                # 本地构建到 site/，用于本地预览
    python3 build.py --build        # Cloudflare Pages 云端构建到 dist/
    python3 build.py pdf.linwt.top   # 指定主域名

Cloudflare Pages 项目配置（与另两站一致）：
    构建命令：python3 build.py --build
    输出目录：dist
"""
import os
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "site"
CF_OUT = ROOT / "dist"
DOMAIN_FILE = ROOT / "domain.txt"

# 主域名走 Cloudflare，自定义域名；worker 链接作为备用入口也写进 sitemap，
# 因为线上确实存在两个可访问地址，两个都提交给搜索引擎更保险。
DEFAULT_DOMAINS = ["pdf.linwt.top", "qingye-pdf-tools.app.workbuddy.host"]

# 需要原样拷贝到产物的文件与目录。
# 注意：vendor/ 有 21MB（含 OCR 的三份 wasm 内核与语言模型），必须一起发布，
# 否则 OCR 工具在线上会因找不到内核而整个不可用。
INCLUDE_FILES = [
    "index.html",
    "main.js",
    "styles.css",
    "_headers",
    "favicon.ico",
]
INCLUDE_DIRS = ["lib", "vendor"]

# 产物里必须存在的东西，缺任何一项都不该发布。
REQUIRED = [
    "index.html",
    "main.js",
    "styles.css",
    "lib/tools.js",
    "lib/registry.js",
    "lib/deps.js",
    "lib/pdf-core.js",
    # OCR 全链路
    "vendor/ocr/tesseract.esm.min.js",
    "vendor/ocr/worker.min.js",
    "vendor/ocr/chi_sim.traineddata.gz",
    "vendor/ocr/eng.traineddata.gz",
]


def read_domains():
    """主域名优先取环境变量，其次 domain.txt，最后用默认值。"""
    env = os.environ.get("SITE_DOMAIN", "").strip()
    if env:
        return [env] + [d for d in DEFAULT_DOMAINS if d != env]
    if DOMAIN_FILE.exists():
        first = DOMAIN_FILE.read_text(encoding="utf-8").strip().splitlines()
        first = [x.strip() for x in first if x.strip()]
        if first:
            return first + [d for d in DEFAULT_DOMAINS if d not in first]
    return list(DEFAULT_DOMAINS)


HEADERS = """\
# Cloudflare Pages 静态头配置
# 由 build.py 生成，请勿手改（改 build.py 里的 HEADERS）。

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: geolocation=(), microphone=(), camera=()

# 页面与入口脚本不缓存，保证改动立刻生效
/
  Cache-Control: no-cache

/index.html
  Cache-Control: no-cache

/main.js
  Cache-Control: no-cache

# OCR 的 wasm 内核：内容寻址不现实（文件名固定），用 must-revalidate
# 避免用户拿到旧内核与新 worker 不匹配。语言模型体积大且极少变动，
# 给长缓存。
/vendor/ocr/*.wasm.js
  Cache-Control: public, max-age=0, must-revalidate
  Content-Type: application/javascript

/vendor/ocr/*.traineddata.gz
  Cache-Control: public, max-age=31536000, immutable
  Content-Type: application/gzip

# tesseract 自己用 importScripts 加载内核，MIME 类型不对会被浏览器拒绝
/vendor/ocr/worker.min.js
  Cache-Control: public, max-age=0, must-revalidate
  Content-Type: application/javascript

# 其余静态资源可以长期缓存
/lib/*
  Cache-Control: public, max-age=3600

/vendor/*
  Cache-Control: public, max-age=3600
"""


def build(domains, outdir):
    if outdir.exists():
        shutil.rmtree(outdir)
    outdir.mkdir(parents=True)

    copied = 0
    skipped = []
    for name in INCLUDE_FILES:
        src = ROOT / name
        if src.exists():
            shutil.copy2(src, outdir / name)
            copied += 1
        else:
            skipped.append(name)
    for d in INCLUDE_DIRS:
        src = ROOT / d
        if src.exists():
            shutil.copytree(src, outdir / d)
            copied += 1
        else:
            skipped.append(d + "/")

    (outdir / "_headers").write_text(HEADERS, encoding="utf-8")

    # sitemap：两个入口都列出来
    urls = []
    for d in domains:
        urls.append(
            f"  <url>\n    <loc>https://{d}/</loc>\n"
            f"    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>"
        )
    (outdir / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls)
        + "\n</urlset>\n",
        encoding="utf-8",
    )

    lines = ["User-agent: *", "Allow: /"]
    for d in domains:
        lines.append(f"Sitemap: https://{d}/sitemap.xml")
    (outdir / "robots.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    issues = []

    for rel in REQUIRED:
        if not (outdir / rel).exists():
            issues.append(f"产物缺少必需文件：{rel}")

    # OCR 目录为空等于 OCR 必然不可用，单独给出醒目提示
    ocr_dir = outdir / "vendor" / "ocr"
    if not ocr_dir.exists() or not any(ocr_dir.iterdir()):
        issues.append("vendor/ocr/ 为空——OCR 工具在线上会完全不可用")

    # 检查 index.html 里是否残留占位域名
    index = outdir / "index.html"
    if index.exists():
        text = index.read_text(encoding="utf-8", errors="replace")
        for bad in ("example.com", "your-domain", "TODO"):
            if bad in text:
                issues.append(f"index.html 残留占位内容：{bad}")

    size = sum(f.stat().st_size for f in outdir.rglob("*") if f.is_file())

    print(f"产物目录：{outdir}")
    print(f"复制项：{copied} 个" + (f"（跳过 {', '.join(skipped)}）" if skipped else ""))
    print(f"产物体积：{size / 1024 / 1024:.1f} MB")
    print(f"声明域名：{', '.join(domains)}")

    if issues:
        print("\n构建失败：")
        for i in issues:
            print(f"  ✗ {i}")
        return 1

    print("\n构建校验通过。")
    return 0


def main() -> int:
    domains = read_domains()
    argv = [a for a in sys.argv[1:] if not a.startswith("-")]
    if argv:
        given = argv[0].split(",")
        domains = given + [d for d in DEFAULT_DOMAINS if d not in given]

    cloud = "--build" in sys.argv
    target = CF_OUT if cloud else OUT
    return build(domains, target)


if __name__ == "__main__":
    raise SystemExit(main())