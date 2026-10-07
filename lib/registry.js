import * as handlers from "./tools.js";
import { formatBytes, escapeHtml, baseName } from "./pdf-core.js";

const PDF_ACCEPT = ".pdf,application/pdf";
const IMG_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

const rangeField = (id, label, hint = "留空表示全部页面", full = true) => `
  <div class="option-field${full ? " full" : ""}">
    <label for="${id}">${label}</label>
    <input id="${id}" type="text" placeholder="例如：1-3, 5, 8-10" />
    <span class="option-hint">${hint}</span>
  </div>`;

// 栅格类工具共用的选项。带页码范围是因为这类工具逐页渲染位图，
// 页数多时内存吃紧（300 页 200dpi 实测接近 500MB），用户需要能只处理部分页。
const rasterOptions = (extra = "") => `
  ${rangeField("raster-pages", "处理页码范围", "留空表示全部页面；页数很多时建议只处理需要的部分")}
  <div class="option-field">
    <label for="raster-scale">输出清晰度</label>
    <select id="raster-scale">
      <option value="1.2">标准 · 约 96 DPI</option>
      <option value="1.6" selected>高清 · 约 130 DPI</option>
      <option value="2.2">超清 · 约 176 DPI</option>
    </select>
  </div>
  <div class="option-field">
    <label for="raster-quality">图片质量</label>
    <select id="raster-quality">
      <option value="0.6">较低 · 体积优先</option>
      <option value="0.82" selected>标准</option>
      <option value="0.92">较高 · 画质优先</option>
    </select>
  </div>
  ${extra}`;

export const TOOLS = {
  merge: {
    group: "organize",
    kicker: "组织管理 / 01",
    title: "合并 PDF",
    description: "多个 PDF 按列表顺序合成一个文件，页面尺寸保持原样。",
    accept: PDF_ACCEPT,
    multiple: true,
    minFiles: 2,
    dropTitle: "选择多个 PDF 文件",
    dropHelp: "可拖入文件，添加后可调整顺序",
    action: "合并并下载",
    options: "",
    notice: "",
    run: handlers.merge,
  },
  split: {
    group: "organize",
    kicker: "组织管理 / 02",
    title: "拆分 / 提取",
    description: "提取指定页为一个 PDF，或把所选页面逐页拆成独立文件。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "支持 1-3, 5, 8-10 这样的页码范围",
    action: "开始拆分",
    options: `
      <div class="option-field full">
        <label for="split-mode">处理方式</label>
        <select id="split-mode">
          <option value="extract">提取到同一个 PDF</option>
          <option value="each">逐页拆分并打包 ZIP</option>
        </select>
      </div>
      ${rangeField("split-pages", "页码范围")}`,
    notice: "",
    run: handlers.split,
  },
  organize: {
    group: "organize",
    kicker: "组织管理 / 03",
    title: "页面管理",
    description: "在缩略图网格中删除、旋转、拖动排序页面。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "添加后会自动生成页面缩略图",
    action: "生成新文件",
    options: "",
    notice: "缩略图最多渲染前 100 页，超出部分仍会按原顺序保留。",
    workspace: "organize",
    run: handlers.organize,
  },
  rotate: {
    group: "organize",
    kicker: "组织管理 / 04",
    title: "旋转 PDF",
    description: "旋转全部页面，或只处理你输入的页码。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "在原文档上修改，不重新渲染",
    action: "旋转并下载",
    options: `
      <div class="option-field">
        <label for="rotate-angle">旋转角度</label>
        <select id="rotate-angle">
          <option value="90">顺时针 90°</option>
          <option value="180">旋转 180°</option>
          <option value="270">逆时针 90°</option>
        </select>
      </div>
      ${rangeField("rotate-pages", "应用页码", "留空表示全部")}`,
    notice: "",
    run: handlers.rotate,
  },
  nup: {
    group: "organize",
    kicker: "组织管理 / 05",
    title: "多页合一（N-up）",
    description: "把多页拼到一张纸上，适合打印讲义、双面排版。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "按每张纸的版式重新排版",
    action: "拼版并下载",
    options: `
      <div class="option-field">
        <label for="nup-layout">每张版式</label>
        <select id="nup-layout">
          <option value="2x1">2 页 · 横向</option>
          <option value="2x2" selected>4 页 · 四宫格</option>
          <option value="3x2">6 页</option>
          <option value="3x3">9 页</option>
        </select>
      </div>
      <div class="option-field">
        <label for="nup-paper">纸张尺寸</label>
        <select id="nup-paper">
          <option value="a4" selected>A4</option>
          <option value="a3">A3</option>
          <option value="letter">Letter</option>
        </select>
      </div>
      <div class="option-field">
        <label for="nup-orientation">纸张方向</label>
        <select id="nup-orientation">
          <option value="portrait" selected>纵向</option>
          <option value="landscape">横向</option>
        </select>
      </div>
      <div class="option-field">
        <label for="nup-gap">页间距（pt）</label>
        <input id="nup-gap" type="number" min="0" max="60" value="8" />
      </div>`,
    notice: "拼版会重新组织页面，原始书签与表单不再保留。",
    run: handlers.nup,
  },
  "long-image": {
    group: "organize",
    kicker: "组织管理 / 06",
    title: "合并为长图",
    description: "把所有页面纵向拼接成一张连续长图。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "适合分享长文章、聊天截图",
    action: "生成长图",
    options: `
      <div class="option-field">
        <label for="long-format">图片格式</label>
        <select id="long-format"><option value="png" selected>PNG · 无损</option><option value="jpg">JPG · 体积更小</option></select>
      </div>
      <div class="option-field">
        <label for="long-scale">清晰度</label>
        <select id="long-scale"><option value="1">标准</option><option value="1.4" selected>高清</option><option value="2">超清</option></select>
      </div>
      <div class="option-field">
        <label for="long-gap">页间距（px）</label>
        <input id="long-gap" type="number" min="0" max="60" value="0" />
      </div>
      ${rangeField("long-pages", "参与页码")}`,
    notice: "为控制内存，最多建议 30 页；页数更多时请降低清晰度。",
    run: handlers.longImage,
  },
  "page-size": {
    group: "organize",
    kicker: "组织管理 / 07",
    title: "页面尺寸统一",
    description: "把混用尺寸的页面统一成 A4 / A3 / Letter。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "适合投印前统一版式",
    action: "统一尺寸",
    options: `
      <div class="option-field">
        <label for="size-target">目标尺寸</label>
        <select id="size-target">
          <option value="a4" selected>A4</option>
          <option value="a3">A3</option>
          <option value="a5">A5</option>
          <option value="letter">Letter</option>
          <option value="legal">Legal</option>
        </select>
      </div>
      <div class="option-field">
        <label for="size-orientation">方向</label>
        <select id="size-orientation">
          <option value="portrait" selected>纵向</option>
          <option value="landscape">横向</option>
        </select>
      </div>
      <div class="option-field full">
        <label for="size-mode">内容适配</label>
        <select id="size-mode">
          <option value="fit" selected>等比缩放并居中（推荐）</option>
          <option value="stretch">拉伸铺满（可能变形）</option>
        </select>
      </div>`,
    notice: "页面会被重新排版，文字层、链接和批注不保留。",
    run: handlers.pageSize,
  },

  watermark: {
    group: "edit",
    kicker: "编辑修改 / 08",
    title: "添加文字水印",
    description: "给每一页添加中文或英文文字水印。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "支持中文文字，可调整角度与透明度",
    action: "添加并下载",
    options: `
      <div class="option-field full">
        <label for="watermark-text">水印文字</label>
        <input id="watermark-text" type="text" maxlength="40" value="内部资料 请勿外传" />
      </div>
      <div class="option-field">
        <label for="watermark-position">位置</label>
        <select id="watermark-position">
          <option value="center" selected>页面居中</option>
          <option value="top">顶部</option>
          <option value="bottom">底部</option>
          <option value="header">页眉</option>
          <option value="footer">页脚</option>
          <option value="repeat">平铺满页</option>
        </select>
      </div>
      <div class="option-field">
        <label for="watermark-angle">倾斜角度</label>
        <select id="watermark-angle">
          <option value="0">0°</option>
          <option value="-30">-30°</option>
          <option value="-45" selected>-45°</option>
          <option value="30">30°</option>
          <option value="45">45°</option>
        </select>
      </div>
      <div class="option-field">
        <label for="watermark-opacity">透明度</label>
        <select id="watermark-opacity">
          <option value="0.1">很浅</option>
          <option value="0.2" selected>标准</option>
          <option value="0.35">明显</option>
        </select>
      </div>
      <div class="option-field">
        <label for="watermark-scale">大小</label>
        <select id="watermark-scale">
          <option value="0.6">小</option>
          <option value="1" selected>标准</option>
          <option value="1.4">大</option>
        </select>
      </div>
      <div class="option-field">
        <label for="watermark-color">颜色</label>
        <select id="watermark-color">
          <option value="#cf4224" selected>红色</option>
          <option value="#1d211f">黑色</option>
          <option value="#176b52">绿色</option>
          <option value="#2f5fb3">蓝色</option>
        </select>
      </div>`,
    notice: "水印会成为页面内容的一部分，请保留原文件以便恢复。",
    run: handlers.watermark,
  },
  "page-number": {
    group: "edit",
    kicker: "编辑修改 / 09",
    title: "添加页码",
    description: "自定义起始数字、位置与显示格式。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "常用于合同、报告与论文",
    action: "添加页码",
    options: `
      <div class="option-field">
        <label for="num-position">位置</label>
        <select id="num-position">
          <option value="bottom-center" selected>底部居中</option>
          <option value="bottom-left">底部左侧</option>
          <option value="bottom-right">底部右侧</option>
          <option value="top-center" selected>顶部居中</option>
          <option value="top-right">顶部右侧</option>
        </select>
      </div>
      <div class="option-field">
        <label for="num-format">格式</label>
        <select id="num-format">
          <option value="plain" selected>1</option>
          <option value="dash">- 1 -</option>
          <option value="total">1 / 10</option>
        </select>
      </div>
      <div class="option-field">
        <label for="num-start">起始数字</label>
        <input id="num-start" type="number" min="0" max="9999" value="1" />
      </div>
      <div class="option-field">
        <label for="num-size">字号</label>
        <input id="num-size" type="number" min="6" max="36" value="10" />
      </div>
      <div class="option-field">
        <label for="num-margin">边距（pt）</label>
        <input id="num-margin" type="number" min="6" max="120" value="24" />
      </div>
      <div class="option-field full">
        <label><input id="num-only" type="checkbox" style="width:auto;min-height:auto;margin-right:6px" /> 只给指定页码加页码</label>
      </div>
      ${rangeField("num-pages", "指定页码", "仅在勾选上方选项后生效")}`,
    notice: "",
    run: handlers.pageNumber,
  },
  crop: {
    group: "edit",
    kicker: "编辑修改 / 10",
    title: "裁剪页面",
    description: "按四边数值裁掉多余边缘，适合去白边。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "1 pt ≈ 1/72 英寸，A4 单边约 595×842 pt",
    action: "裁剪并下载",
    options: `
      <div class="option-field full">
        <label><input id="crop-auto" type="checkbox" checked style="width:auto;min-height:auto;margin-right:6px" /> 自动保留最小边距（推荐）</label>
      </div>
      <div class="option-field"><label for="crop-top">上边距</label><input id="crop-top" type="number" min="0" max="400" value="0" /></div>
      <div class="option-field"><label for="crop-bottom">下边距</label><input id="crop-bottom" type="number" min="0" max="400" value="0" /></div>
      <div class="option-field"><label for="crop-left">左边距</label><input id="crop-left" type="number" min="0" max="400" value="0" /></div>
      <div class="option-field"><label for="crop-right">右边距</label><input id="crop-right" type="number" min="0" max="400" value="0" /></div>`,
    notice: "裁剪通过重绘实现，文字层与链接会丢失。",
    run: handlers.crop,
  },
  grayscale: {
    group: "edit",
    kicker: "编辑修改 / 11",
    title: "灰度 / 黑白",
    description: "去掉彩色，适合打印与传真。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "黑白模式可用阈值控制深浅",
    action: "转换并下载",
    options: `
      ${rasterOptions(`
      <div class="option-field full">
        <label for="bw-threshold">黑白阈值（越高越黑）</label>
        <input id="bw-threshold" type="number" min="40" max="220" value="128" />
      </div>`)}`,
    notice: "页面会重新渲染为图片，文本层、链接与表单不再保留。",
    run: (ctx) => handlers.rasterEdit({ ...ctx, mode: "grayscale" }),
    showMode: "grayscale",
  },
  blackwhite: {
    group: "edit",
    kicker: "编辑修改 / 12",
    title: "纯黑白（二值化）",
    description: "只保留纯黑与纯白，文件最小、打印最快。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "扫描件 OCR 前建议先转黑白",
    action: "转换并下载",
    options: `
      ${rasterOptions(`
      <div class="option-field full">
        <label for="bw-threshold">黑白阈值（越高越黑）</label>
        <input id="bw-threshold" type="number" min="40" max="220" value="128" />
      </div>`)}`,
    notice: "页面会重新渲染为图片，文本层、链接与表单不再保留。",
    run: (ctx) => handlers.rasterEdit({ ...ctx, mode: "blackwhite" }),
  },
  invert: {
    group: "edit",
    kicker: "编辑修改 / 13",
    title: "反色显示",
    description: "生成白底黑字变成黑底白字的夜间阅读版本。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "适合长时间阅读与投影",
    action: "生成深色版",
    options: rasterOptions(),
    notice: "页面会重新渲染为图片，文本层与链接不再保留。",
    run: (ctx) => handlers.rasterEdit({ ...ctx, mode: "invert" }),
  },
  background: {
    group: "edit",
    kicker: "编辑修改 / 14",
    title: "页面背景色",
    description: "给页面铺一层纯色背景，打印时更省墨。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "适合打印稿与阅读优化",
    action: "应用背景色",
    options: `
      <div class="option-field">
        <label for="background-color">背景色</label>
        <select id="background-color">
          <option value="#ffffff">白色</option>
          <option value="#f5f1e6" selected>米色（护眼）</option>
          <option value="#f7f5ef">浅灰</option>
          <option value="#1d211f">深色（夜间）</option>
          <option value="#dbe7f0">淡蓝</option>
        </select>
      </div>
      ${rasterOptions()}`,
    notice: "页面会重新渲染为图片，文本层与链接不再保留。",
    run: (ctx) => handlers.rasterEdit({ ...ctx, mode: "background" }),
  },

  "pdf-to-image": {
    group: "convert",
    kicker: "格式转换 / 15",
    title: "PDF 转图片",
    description: "导出 PNG 或 JPG，多页自动打包为 ZIP。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "可指定页码与清晰度",
    action: "转换并下载",
    options: `
      <div class="option-field">
        <label for="image-format">图片格式</label>
        <select id="image-format"><option value="png">PNG · 无损</option><option value="jpg" selected>JPG · 体积更小</option></select>
      </div>
      <div class="option-field">
        <label for="image-scale">清晰度</label>
        <select id="image-scale"><option value="1.5">标准 · 约 108 DPI</option><option value="2" selected>高清 · 约 144 DPI</option><option value="3">超清 · 约 216 DPI</option></select>
      </div>
      ${rangeField("image-pages", "页码范围")}`,
    notice: "超清模式占用更多内存，大页数文档建议选择“标准”。",
    run: handlers.pdfToImage,
  },
  "image-to-pdf": {
    group: "convert",
    kicker: "格式转换 / 16",
    title: "图片转 PDF",
    description: "多张 JPG、PNG 或 WebP 按顺序整理成一份 PDF。",
    accept: IMG_ACCEPT,
    multiple: true,
    minFiles: 1,
    dropTitle: "选择一张或多张图片",
    dropHelp: "添加后可调整图片顺序",
    action: "生成并下载",
    options: `
      <div class="option-field">
        <label for="page-size">页面尺寸</label>
        <select id="page-size"><option value="auto" selected>跟随图片</option><option value="a4">A4 纸张</option></select>
      </div>
      <div class="option-field">
        <label for="page-orientation">A4 方向</label>
        <select id="page-orientation"><option value="auto" selected>自动</option><option value="portrait">纵向</option><option value="landscape">横向</option></select>
      </div>
      <div class="option-field full">
        <label for="page-margin">页面留白（pt）</label>
        <input id="page-margin" type="number" min="0" max="120" value="24" />
      </div>`,
    notice: "透明 PNG 会保留透明区域；WebP 会先在浏览器中转为 PNG。",
    run: handlers.imageToPdf,
  },
  "extract-image": {
    group: "convert",
    kicker: "格式转换 / 17",
    title: "提取内嵌图片",
    description: "抽出 PDF 里内嵌的原始图片，而不是重新截图。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "适合从报告、画册中取原图",
    action: "提取并下载",
    options: `
      <div class="option-field full">
        <label for="extract-min-size">最小边长（px）</label>
        <input id="extract-min-size" type="number" min="16" max="2000" value="80" />
        <span class="option-hint">过滤图标、色块等小图，数值越大提取越少。</span>
      </div>
      ${rangeField("extract-image-pages", "扫描页码")}`,
    notice: "只提取内嵌位图；矢量图形与文字不会被导出。",
    run: handlers.extractImage,
  },
  "extract-text": {
    group: "convert",
    kicker: "格式转换 / 18",
    title: "提取文字",
    description: "导出纯文本，方便复制到 Word、笔记或 AI。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "扫描件请改用 OCR 识别",
    action: "提取文字",
    options: `
      <div class="option-field full">
        <label for="text-format">输出格式</label>
        <select id="text-format"><option value="txt" selected>纯文本 .txt</option><option value="md">Markdown .md</option></select>
      </div>
      ${rangeField("text-pages", "页码范围")}`,
    notice: "只对含文本层的 PDF 有效，扫描件需要先做 OCR。",
    run: handlers.extractText,
  },
  reader: {
    group: "convert",
    kicker: "格式转换 / 19",
    title: "PDF 预览",
    description: "在站内直接翻阅文档，支持缩放。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "打开后可逐页翻看",
    action: "打开预览",
    options: "",
    notice: "",
    run: null,
    openReader: true,
  },

  compress: {
    group: "secure",
    kicker: "安全优化 / 20",
    title: "压缩 PDF",
    description: "适合扫描件和图片型 PDF，可明显减小体积。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "页面将在本地重新渲染并压缩",
    action: "压缩并下载",
    options: `
      ${rangeField("compress-pages", "压缩页码范围", "留空表示全部页面；页数很多时建议只压缩需要的部分")}
      <div class="option-field full">
        <label for="compress-level">压缩级别</label>
        <select id="compress-level">
          <option value="strong">强压缩 · 适合在线提交</option>
          <option value="balanced" selected>均衡 · 适合日常分享</option>
          <option value="clear">清晰 · 适合打印预览</option>
        </select>
      </div>`,
    notice: "压缩会把页面转成图片，文本搜索、链接、表单、批注与数字签名不会保留。若压缩后反而更大，会自动返回原文件。",
    run: handlers.compress,
  },
  encrypt: {
    group: "secure",
    kicker: "安全优化 / 21",
    title: "加密 PDF",
    description: "用 AES-256 设置打开密码，并可限制打印与复制。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "密码只存在于你的浏览器",
    action: "加密并下载",
    options: `
      <div class="option-field full">
        <label for="encrypt-password">打开密码（至少 4 位）</label>
        <input id="encrypt-password" type="text" placeholder="读者需要输入此密码才能打开" />
      </div>
      <div class="option-field full">
        <label for="encrypt-owner">所有者密码（可选）</label>
        <input id="encrypt-owner" type="text" placeholder="留空则自动生成" />
      </div>
      <div class="option-field full">
        <label>权限限制</label>
        <div class="check-grid">
          <label><input id="perm-printing" type="checkbox" checked style="width:auto;min-height:auto" /> 允许打印</label>
          <label><input id="perm-copy" type="checkbox" style="width:auto;min-height:auto" /> 允许复制文字</label>
          <label><input id="perm-modify" type="checkbox" style="width:auto;min-height:auto" /> 允许编辑</label>
          <label><input id="perm-annotate" type="checkbox" style="width:auto;min-height:auto" /> 允许批注</label>
        </div>
      </div>`,
    notice: "密码无法找回，请务必自行记录。加密只保护文件本身，不影响文件被转发。",
    run: handlers.encrypt,
  },
  permissions: {
    group: "secure",
    kicker: "安全优化 / 24",
    title: "权限设置",
    description: "不加打开密码，只限制打印、复制、编辑等操作。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "读者无需密码即可打开",
    action: "应用权限",
    options: `
      <div class="option-field full">
        <label for="perm-source-password">原文件密码（若已加密）</label>
        <input id="perm-source-password" type="text" placeholder="未加密可留空" />
      </div>
      <div class="option-field full">
        <label for="perm-password">所有者密码（用于解除限制）</label>
        <input id="perm-password" type="text" value="lightpdf-owner" />
      </div>
      <div class="option-field full">
        <label>权限限制</label>
        <div class="check-grid">
          <label><input id="perm-printing" type="checkbox" style="width:auto;min-height:auto" /> 允许打印</label>
          <label><input id="perm-copy" type="checkbox" style="width:auto;min-height:auto" /> 允许复制文字</label>
          <label><input id="perm-modify" type="checkbox" style="width:auto;min-height:auto" /> 允许编辑</label>
          <label><input id="perm-annotate" type="checkbox" style="width:auto;min-height:auto" /> 允许批注</label>
        </div>
      </div>`,
    notice: "权限限制是提示性的，可被高级工具绕过，不能替代真正的加密。",
    run: handlers.permissions,
  },
  decrypt: {
    group: "secure",
    kicker: "安全优化 / 22",
    title: "解密 PDF",
    description: "输入原密码，输出不带密码的副本。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个加密的 PDF",
    dropHelp: "仅用于你有权访问的文档",
    action: "生成无密码副本",
    options: `
      <div class="option-field full">
        <label for="decrypt-password">原文件密码</label>
        <input id="decrypt-password" type="text" placeholder="输入打开该 PDF 所需的密码" />
      </div>`,
    notice: "只支持标准加密（RC4 / AES）。若密码遗失，任何人都无法恢复文件内容。",
    run: handlers.decrypt,
  },
  metadata: {
    group: "secure",
    kicker: "安全优化 / 23",
    title: "元数据工具",
    description: "查看、修改或一键清除文档的作者、标题等隐藏信息。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "对外分享前建议清除隐私信息",
    action: "执行",
    options: `
      <div class="option-field full">
        <label for="meta-action">操作</label>
        <select id="meta-action">
          <option value="view" selected>查看文档信息</option>
          <option value="edit">修改文档信息</option>
          <option value="clear">清除全部信息</option>
        </select>
      </div>
      <div class="option-field full" data-when="edit">
        <label for="meta-title">标题</label>
        <input id="meta-title" type="text" placeholder="留空则不修改" />
      </div>
      <div class="option-field full" data-when="edit">
        <label for="meta-author">作者</label>
        <input id="meta-author" type="text" placeholder="留空则不修改" />
      </div>
      <div class="option-field full" data-when="edit">
        <label for="meta-subject">主题</label>
        <input id="meta-subject" type="text" placeholder="留空则不修改" />
      </div>
      <div class="option-field full" data-when="edit">
        <label for="meta-keywords">关键词（逗号分隔）</label>
        <input id="meta-keywords" type="text" placeholder="留空则不修改" />
      </div>
      <div class="option-field full">
        <label for="meta-password">原文件密码（若已加密）</label>
        <input id="meta-password" type="text" placeholder="未加密可留空" />
      </div>`,
    notice: "元数据包含作者、软件版本、创建时间等信息，可能暴露个人或公司信息。",
    run: handlers.metadata,
  },

  "delete-blank": {
    group: "cleanup",
    kicker: "清理修复 / 25",
    title: "删除空白页",
    description: "自动识别并移除没有文字和图形的页面。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "扫描件与传真件常见多余空白页",
    action: "清理并下载",
    options: `
      <div class="option-field full">
        <label for="blank-password">原文件密码（若已加密）</label>
        <input id="blank-password" type="text" placeholder="未加密可留空" />
      </div>`,
    notice: "仅含细线或极浅内容的页面可能不被识别为空白，清理后请务必检查结果。",
    run: handlers.deleteBlank,
  },
  zip: {
    group: "cleanup",
    kicker: "清理修复 / 26",
    title: "打包为 ZIP",
    description: "把多个 PDF 合成一个压缩包，方便一次发送。",
    accept: PDF_ACCEPT,
    multiple: true,
    minFiles: 1,
    dropTitle: "选择多个 PDF 文件",
    dropHelp: "支持一次选择多个文件",
    action: "生成压缩包",
    options: "",
    notice: "已是 PDF 格式的压缩收益有限，PDF 内部本身已压缩。",
    run: handlers.zip,
  },
  ocr: {
    group: "cleanup",
    kicker: "清理修复 / 27",
    title: "OCR 文字识别",
    description: "识别扫描件中的文字，输出图片页 + 识别文本。",
    accept: PDF_ACCEPT,
    multiple: false,
    minFiles: 1,
    dropTitle: "选择扫描件 PDF",
    dropHelp: "首次使用会下载识别模型",
    action: "开始识别",
    options: `
      <div class="option-field">
        <label for="ocr-language">识别语言</label>
        <select id="ocr-language">
          <option value="chi_sim+eng" selected>中文简体 + 英文</option>
          <option value="chi_sim">仅中文简体</option>
          <option value="chi_tra+eng">中文繁体 + 英文</option>
          <option value="eng">仅英文</option>
          <option value="jpn+eng">日文 + 英文</option>
        </select>
      </div>
      <div class="option-field">
        <label for="ocr-scale">识别清晰度</label>
        <select id="ocr-scale"><option value="1.5">标准</option><option value="2" selected>高清（更准）</option><option value="3">超清（较慢）</option></select>
      </div>
      ${rangeField("ocr-pages", "识别页码", "页数越多耗时越长")}`,
    notice: "首次使用需下载约 10–20 MB 识别模型。结果打包为 ZIP，包含处理后的 PDF 与识别文本两个文件。",
    run: handlers.ocr,
  },
};

export function valueOf(id) {
  return document.getElementById(id)?.value ?? "";
}

export function toolGroups() {
  return [...new Set(Object.values(TOOLS).map((tool) => tool.group))];
}

export { baseName, formatBytes, escapeHtml };
