#!/usr/bin/env python3
"""
build.py — 构建Cloudflare Pages 产物

与另两个站点（网站副业 / 网站副业2）保持同一套约定：
  1. 把需要发布的内容同步到输出目录
  2. 为文本资源生成 .gz 预压缩副本
  3. 生成 27 个工具的独立落地页（/tools/<slug>/）
  4. 生成 _headers（Pages 的静态头配置）、sitemap.xml、robots.txt
  5. 校验：产物完整性、关键资源存在性、落地页数量与文案覆盖

用法：
    python3 build.py                # 本地构建到 site/，用于本地预览
    python3 build.py --build        # Cloudflare Pages 云端构建到 dist/
    python3 build.py pdf.linwt.top   # 指定主域名

Cloudflare Pages 项目配置（与另两站一致）：
    构建命令：python3 build.py --build
    输出目录：dist
"""
import gzip
import json
import datetime
import os
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "site"
CF_OUT = ROOT / "dist"
DOMAIN_FILE = ROOT / "domain.txt"

# pages.py 与 build.py 同目录。Cloudflare 云端执行时 cwd 不一定等于脚本目录，
# 显式加进 sys.path 保证 import 稳定。
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pages as landing  # noqa: E402  （必须在 sys.path 处理之后）

# 主域名走 Cloudflare 自定义域名。第二个地址是备用入口（同一份内容），
# 但**不写进 sitemap、不做 canonical**：
#   1. sitemap 里出现非本资源的主机，GSC 会报「网址不在该资源中」；
#   2. 两个主机内容完全相同 = 重复内容，会分散权重。
# 备用地址靠 canonical 把权重归给主域名即可（落地页的 canonical 已指向主域名）。
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

# 27 个工具落地页：文案会随时调整，同样不缓存。
# 注意 Pages 的 _headers 路径是「精确 + 尾部通配」，/tools/ 只匹配这一个 URL，
# 匹配不到 /tools/merge/，所以两条都得写。
/tools/*
  Cache-Control: no-cache

/tools/
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

# 其余静态资源给长缓存。文件名不带内容哈希，所以用 must-revalidate 而不是
# immutable —— 万一升级了某个库，客户端最多多回源一次，不会拿到旧版本。
/lib/*
  Cache-Control: public, max-age=604800, must-revalidate

/vendor/*
  Cache-Control: public, max-age=604800, must-revalidate
"""


# 需要预压缩的扩展名。只处理文本类资源 —— 已经压缩过的
# （*.traineddata.gz）和图片（*.png/*.jpg）压了没意义。
COMPRESSIBLE = {".html", ".css", ".js", ".mjs", ".json", ".xml", ".txt", ".svg", ".webmanifest"}


def precompress(outdir):
    """为文本资源生成 .gz 副本。

    为什么不靠 Cloudflare 自动压缩：实测 Pages 返回的响应里没有
    content-encoding，470KB 的 pdf-lib 走了 1.7 秒。自己压好更可靠，
    Cloudflare 会自动选用预压缩文件并补上正确的响应头。

    只生成 .gz，不生成 .br —— 依赖 Python 标准库实现 Brotli 不可行，
    而 Cloudflare 在收到 .gz 后会自行转成 Brotli 下发给支持的浏览器。
    """
    count = 0
    saved = 0
    for path in outdir.rglob("*"):
        if not path.is_file() or path.suffix not in COMPRESSIBLE:
            continue
        # 小文件压了反而可能变大，收益为负
        raw = path.stat().st_size
        if raw < 1024:
            continue
        data = path.read_bytes()
        packed = gzip.compress(data, compresslevel=9)
        if len(packed) >= raw:
            continue
        path.with_name(path.name + ".gz").write_bytes(packed)
        count += 1
        saved += raw - len(packed)
    return count, saved


# ---------------------------------------------------------------- 落地页生成

def esc(text):
    """落地页文案是我们自己写的，但插值进 HTML 前一律转义，防止以后
    有人往文案里加引号或尖括号把页面结构写坏。"""
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def parse_registry():
    """从 lib/registry.js 里读出工具清单。

    为什么不另建一份 JSON：registry.js 已经是运行时的唯一事实来源，
    再抄一份必然会对不上。这里只做很窄的行级解析（key / group / title /
    description），解析不出来会在校验阶段直接让构建失败，不会静默出错。
    """
    src = (ROOT / "lib" / "registry.js").read_text(encoding="utf-8")
    tools = {}
    current = None
    for line in src.splitlines():
        opened = re.match(r'^  "?([\w-]+)"?: \{$', line)
        if opened:
            current = opened.group(1)
            tools[current] = {}
            continue
        if current is None:
            continue
        field = re.match(r'^\s{4}(group|title|description): "(.*)",$', line)
        if field:
            tools[current][field.group(1)] = field.group(2)
    return {k: v for k, v in tools.items() if v.get("title")}


def replace_once(text, old, new, what):
    """替换且只允许替换一次 —— 如果锚点在模板里消失了（有人改了
    index.html），宁可构建失败，也不要默默生成一个没改到的页面。"""
    if old not in text:
        raise SystemExit(f"落地页生成失败：index.html 里找不到锚点「{what}」")
    return text.replace(old, new, 1)


def render_steps(data):
    items = "\n".join(
        '          <li><span>{}</span><div><strong>{}</strong><p>{}</p></div></li>'.format(
            i + 1, esc(title), esc(desc)
        )
        for i, (title, desc) in enumerate(data["steps"])
    )
    return """    <section class="steps-section">
      <div class="container">
        <div class="section-head compact">
          <div><span class="section-index">03 / HOW TO USE</span><h2>怎么用这个工具</h2></div>
          <p>{intro}</p>
        </div>
        <ol class="steps four">
{items}
        </ol>
      </div>
    </section>""".format(intro=esc(data["intro"]), items=items)


def render_faq(data, tool_title):
    items = "\n".join(
        '          <details{}><summary>{}</summary><p>{}</p></details>'.format(
            " open" if i == 0 else "", esc(q), esc(a)
        )
        for i, (q, a) in enumerate(data["faq"])
    )
    return """    <section class="faq-section">
      <div class="container faq-grid">
        <div><span class="section-index">04 / FAQ</span><h2>关于{title}</h2></div>
        <div class="faq-list">
{items}
        </div>
      </div>
    </section>""".format(title=esc(tool_title), items=items)


def render_related(related, tools):
    links = []
    for slug in related:
        meta = tools.get(slug)
        if not meta:
            continue
        links.append(
            '          <a class="related-link" href="../{slug}/">'
            "<strong>{title}</strong><small>{desc}</small>"
            "<span>去使用 <b>→</b></span></a>".format(
                slug=slug, title=esc(meta["title"]), desc=esc(meta["description"])
            )
        )
    return """    <section class="related-section">
      <div class="container">
        <div class="section-head compact">
          <div><span class="section-index">06 / RELATED</span><h2>顺手还能做这些</h2></div>
        </div>
        <div class="related-grid">
{links}
        </div>
      </div>
    </section>""".format(links="\n".join(links))


def render_jsonld(slug, data, meta, url, home_url):
    graph = [
        {
            "@type": "WebPage",
            "@id": url + "#webpage",
            "url": url,
            "name": data["seo_title"],
            "description": data["desc"],
            "inLanguage": "zh-CN",
            "isPartOf": {"@type": "WebSite", "url": home_url, "name": "轻页 PDF"},
            "breadcrumb": {"@id": url + "#breadcrumb"},
        },
        {
            "@type": "BreadcrumbList",
            "@id": url + "#breadcrumb",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "首页", "item": home_url},
                {
                    "@type": "ListItem",
                    "position": 2,
                    "name": landing.GROUP_NAMES.get(meta["group"], "工具"),
                    "item": home_url + "#tools",
                },
                {"@type": "ListItem", "position": 3, "name": meta["title"]},
            ],
        },
        {
            "@type": "FAQPage",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": q,
                    "acceptedAnswer": {"@type": "Answer", "text": a},
                }
                for q, a in data["faq"]
            ],
        },
    ]
    body = json.dumps(
        {"@context": "https://schema.org", "@graph": graph},
        ensure_ascii=False,
        indent=2,
    )
    # JSON-LD 里出现 "</script>" 会提前闭合脚本块；把 < 转成 unicode 转义最稳。
    return body.replace("<", "\\u003c")


def build_landing_page(template, slug, data, meta, tools, home_url):
    """把 index.html 模板改造成某个工具的落地页。

    保留整站结构（导航、27 个工具网格、隐私说明、通用 FAQ、页脚），
    只替换首屏文案、使用步骤，并追加该工具专属的问答与相关工具，
    保证每页都有唯一的标题、H1、描述和正文。
    """
    page_url = "{}/tools/{}/".format(home_url.rstrip("/"), slug)
    group = landing.GROUP_NAMES.get(meta["group"], "工具")

    html = template

    # 1. 资源路径：页面深了两层，./x 要改成 ../../x
    html = re.sub(r'((?:href|src)=")\./', r"\1../../", html)

    # 2. head 里的元信息
    html = replace_once(html, "<title>轻页 PDF｜27 个文件不上传的在线 PDF 工具箱</title>",
                        "<title>{}</title>".format(esc(data["seo_title"])), "title")
    html = re.sub(r'(<meta name="description" content=")[^"]*(")',
                  lambda m: m.group(1) + esc(data["desc"]) + m.group(2), html, count=1)
    html = re.sub(r'(<meta name="keywords" content=")[^"]*(")',
                  lambda m: m.group(1) + esc("{},{},在线PDF工具,PDF处理,免费,免注册,不上传".format(
                      meta["title"], data["h1"])) + m.group(2), html, count=1)
    html = re.sub(r'(<meta property="og:title" content=")[^"]*(")',
                  lambda m: m.group(1) + esc(data["seo_title"]) + m.group(2), html, count=1)
    html = re.sub(r'(<meta property="og:description" content=")[^"]*(")',
                  lambda m: m.group(1) + esc(data["desc"]) + m.group(2), html, count=1)
    html = re.sub(r'(<meta property="og:url" content=")[^"]*(")',
                  lambda m: m.group(1) + page_url + m.group(2), html, count=1)
    html = re.sub(r'(<link rel="canonical" href=")[^"]*(")',
                  lambda m: m.group(1) + page_url + m.group(2), html, count=1)

    # 3. 结构化数据换成「网页 + 面包屑 + 问答」
    html = re.sub(
        r'  <script type="application/ld\+json">.*?</script>',
        '  <script type="application/ld+json">\n'
        + render_jsonld(slug, data, meta, page_url, home_url)
        + "\n  </script>",
        html,
        count=1,
        flags=re.S,
    )

    # 4. body 打上工具标记，main.js 靠它高亮当前工具卡片
    html = replace_once(html, "<body>", '<body data-tool="{}">'.format(slug), "body")

    # 4b. 品牌 logo 在模板里是 #top（回到本页顶部），落地页上要能回首页
    html = replace_once(
        html,
        '<a class="brand" href="#top" aria-label="轻页 PDF 首页">',
        '<a class="brand" href="../../" aria-label="轻页 PDF 首页">',
        "brand 链接",
    )

    # 5. 首屏文案
    html = replace_once(
        html,
        '<div class="eyebrow"><span class="status-dot"></span> 27 个工具 · 浏览器本地处理</div>',
        '<div class="eyebrow"><span class="status-dot"></span> {} · 浏览器本地处理</div>'.format(
            esc(group)),
        "eyebrow",
    )
    html = replace_once(
        html,
        "<h1>PDF 处理，<br /><span>轻一点。</span></h1>",
        '<nav class="breadcrumb" aria-label="面包屑导航">'
        '<a href="../../">首页</a><i>›</i><span>{}</span><i>›</i><b>{}</b></nav>'
        '<h1>{}</h1>'.format(esc(group), esc(meta["title"]), esc(data["h1"])),
        "h1",
    )
    html = re.sub(r'(<p class="hero-lead">)[^<]*(</p>)',
                  lambda m: m.group(1) + esc(data["intro"]) + m.group(2), html, count=1)
    html = replace_once(html, 'data-open-tool="merge">立即使用',
                        'data-open-tool="{}">立即使用'.format(slug), "hero CTA")

    # 6. 通用「三步完成」换成该工具的具体步骤
    start = html.index('    <section class="steps-section">')
    end = html.index("\n    </section>", start) + len("\n    </section>")
    html = html[:start] + render_steps(data) + html[end:]

    # 7. 通用 FAQ 之前插入该工具的问答
    html = replace_once(
        html,
        '    <section class="faq-section" id="faq">',
        render_faq(data, meta["title"]) + '\n    <section class="faq-section" id="faq">',
        "faq 锚点",
    )
    # 编号顺延，否则页面上会出现两个「04 / FAQ」
    html = replace_once(
        html,
        '04 / FAQ</span><h2>你可能想问',
        '05 / FAQ</span><h2>你可能想问',
        "通用 FAQ 编号",
    )

    # 8. 页脚之前插入相关工具
    html = replace_once(
        html,
        '  <footer class="site-footer">',
        render_related(data["related"], tools) + "\n  <footer class=\"site-footer\">",
        "footer 锚点",
    )

    return html


def build_landing_pages(template, tools, outdir, home_url):
    """生成 /tools/<slug>/index.html，返回生成的 slug 列表。"""
    missing = [slug for slug in tools if slug not in landing.LANDING]
    if missing:
        raise SystemExit("落地页文案缺失：{}".format(", ".join(missing)))
    orphan = [slug for slug in landing.LANDING if slug not in tools]
    if orphan:
        raise SystemExit("pages.py 里有 registry 中不存在的工具：{}".format(", ".join(orphan)))

    written = []
    for slug, meta in tools.items():
        target = outdir / "tools" / slug
        target.mkdir(parents=True, exist_ok=True)
        (target / "index.html").write_text(
            build_landing_page(template, slug, landing.LANDING[slug], meta, tools, home_url),
            encoding="utf-8",
        )
        written.append(slug)
    return written


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

    home_url = "https://{}/".format(domains[0])

    # 源码里首页的 canonical / og:url 写的是备用域名，发布时必须改成主域名。
    # 不改的话 Google 在主域名上读到「 preferred URL 是另一个主机」，
    # 权重会算给备用地址，主域名反而收录不进去。
    index_path = outdir / "index.html"
    if index_path.exists():
        text = index_path.read_text(encoding="utf-8")
        text = re.sub(
            r'(<link rel="canonical" href=")[^"]*(")',
            lambda m: m.group(1) + home_url + m.group(2), text, count=1,
        )
        text = re.sub(
            r'(<meta property="og:url" content=")[^"]*(")',
            lambda m: m.group(1) + home_url + m.group(2), text, count=1,
        )
        index_path.write_text(text, encoding="utf-8")

    tools = parse_registry()
    if len(tools) != 27:
        raise SystemExit("从 registry.js 解析到 {} 个工具，预期 27 个".format(len(tools)))
    template = (ROOT / "index.html").read_text(encoding="utf-8")
    landing_slugs = build_landing_pages(template, tools, outdir, home_url)

    compressed = precompress(outdir)

    (outdir / "_headers").write_text(HEADERS, encoding="utf-8")

    # sitemap：首页 + 27 个工具落地页。只声明主域名 ——
    # sitemap 里不能混主机，否则 GSC 会报「网址不在该资源中」。
    # lastmod 用构建日期，帮助 Google 判断哪些页面需要重新抓取。
    today = datetime.date.today().isoformat()
    urls = []
    paths = [("", "1.0", "weekly")] + [("tools/{}/".format(s), "0.8", "monthly") for s in landing_slugs]
    for path, priority, freq in paths:
        urls.append(
            "  <url>\n    <loc>https://{}/{}</loc>\n"
            "    <lastmod>{}</lastmod>\n"
            "    <changefreq>{}</changefreq>\n    <priority>{}</priority>\n  </url>".format(
                domains[0], path, today, freq, priority
            )
        )
    (outdir / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls)
        + "\n</urlset>\n",
        encoding="utf-8",
    )

    # robots.txt 的 Sitemap 同样只能指向本主机的 sitemap
    (outdir / "robots.txt").write_text(
        "User-agent: *\nAllow: /\nSitemap: https://{}/sitemap.xml\n".format(domains[0]),
        encoding="utf-8",
    )

    issues = []

    for rel in REQUIRED:
        if not (outdir / rel).exists():
            issues.append(f"产物缺少必需文件：{rel}")

    # OCR 目录为空等于 OCR 必然不可用，单独给出醒目提示
    ocr_dir = outdir / "vendor" / "ocr"
    if not ocr_dir.exists() or not any(ocr_dir.iterdir()):
        issues.append("vendor/ocr/ 为空——OCR 工具在线上会完全不可用")

    # 每个落地页都要真的存在，且标题不能还留着首页那句
    for slug in landing_slugs:
        page = outdir / "tools" / slug / "index.html"
        if not page.exists():
            issues.append(f"落地页缺失：tools/{slug}/index.html")
            continue
        text = page.read_text(encoding="utf-8", errors="replace")
        if "27 个文件不上传的在线 PDF 工具箱" in text:
            issues.append(f"落地页 {slug} 的 title 没被替换")
        if 'data-tool="{}"'.format(slug) not in text:
            issues.append(f"落地页 {slug} 缺少 data-tool 标记")
        expected = "<title>{}</title>".format(esc(landing.LANDING[slug]["seo_title"]))
        if expected not in text:
            issues.append(f"落地页 {slug} 的 title 不对，应为 {expected}")
        # 落地页深两层，不能还留着 ./ 的相对路径，否则样式和脚本全 404
        if re.search(r'(?:href|src)="\./', text):
            issues.append(f"落地页 {slug} 仍指向 ./ 的相对资源")

    # 检查 index.html 里是否残留占位域名
    index = outdir / "index.html"
    if index.exists():
        text = index.read_text(encoding="utf-8", errors="replace")
        for bad in ("example.com", "your-domain", "TODO"):
            if bad in text:
                issues.append(f"index.html 残留占位内容：{bad}")
        if 'rel="canonical" href="{}"'.format(home_url) not in text:
            issues.append("index.html 的 canonical 没指向主域名 " + home_url)

    # sitemap 里混进别的主机，GSC 会报「网址不在该资源中」，直接拦住
    sitemap = outdir / "sitemap.xml"
    if sitemap.exists():
        hosts = set(re.findall(r"<loc>https?://([^/]+)/", sitemap.read_text(encoding="utf-8")))
        if hosts - {domains[0]}:
            issues.append("sitemap 混入了非主域名的主机：" + ", ".join(sorted(hosts - {domains[0]})))

    size = sum(f.stat().st_size for f in outdir.rglob("*") if f.is_file())
    gz_count, gz_saved = compressed

    print(f"产物目录：{outdir}")
    print(f"复制项：{copied} 个" + (f"（跳过 {', '.join(skipped)}）" if skipped else ""))
    print(f"工具落地页：{len(landing_slugs)} 个（/tools/<slug>/）")
    print(f"预压缩：{gz_count} 个文件，省 {gz_saved / 1024:.0f} KB")
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
