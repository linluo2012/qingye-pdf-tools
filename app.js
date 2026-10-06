import {
  PDFDocument,
  degrees
} from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const tools = {
  merge: {
    kicker: "ORGANIZE / 01",
    title: "合并 PDF",
    description: "多个 PDF 按列表顺序合并，原始页面尺寸保持不变。",
    accept: ".pdf,application/pdf",
    multiple: true,
    minFiles: 2,
    dropTitle: "选择多个 PDF 文件",
    dropHelp: "可拖入文件，添加后可调整顺序",
    action: "合并并下载",
    options: "",
    notice: "",
  },
  split: {
    kicker: "ORGANIZE / 02",
    title: "拆分 / 提取 PDF",
    description: "提取指定页为一个 PDF，或将每页拆成单独文件。",
    accept: ".pdf,application/pdf",
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "支持输入 1-3, 5, 8-10 这样的页码范围",
    action: "开始拆分",
    options: `
      <div class="option-field full">
        <label for="split-mode">处理方式</label>
        <select id="split-mode">
          <option value="extract">提取指定页到一个 PDF</option>
          <option value="each">所选页面逐页拆分并打包</option>
        </select>
      </div>
      <div class="option-field full">
        <label for="split-pages">页码范围</label>
        <input id="split-pages" type="text" inputmode="text" placeholder="例如：1-3, 5, 8-10；留空表示全部" />
        <span class="option-hint">页码从 1 开始，重复页码会自动去重。</span>
      </div>`,
    notice: "",
  },
  compress: {
    kicker: "OPTIMIZE / 03",
    title: "压缩 PDF",
    description: "适合扫描件和图片型 PDF，可显著减小文件体积。",
    accept: ".pdf,application/pdf",
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "页面将在本地重新渲染并压缩",
    action: "压缩并下载",
    options: `
      <div class="option-field full">
        <label for="compress-level">压缩级别</label>
        <select id="compress-level">
          <option value="strong">强压缩 · 适合在线提交</option>
          <option value="balanced" selected>均衡 · 适合日常分享</option>
          <option value="clear">清晰 · 适合打印预览</option>
        </select>
      </div>`,
    notice: "压缩会将页面转换为图片，文本搜索、链接、表单、批注和数字签名不会保留。文字型 PDF 可能不会明显变小。",
  },
  rotate: {
    kicker: "ORGANIZE / 04",
    title: "旋转 PDF",
    description: "旋转全部页面，或只处理你输入的页码。",
    accept: ".pdf,application/pdf",
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "原文档内容不会被重新渲染",
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
      <div class="option-field">
        <label for="rotate-pages">应用页码</label>
        <input id="rotate-pages" type="text" placeholder="留空表示全部" />
        <span class="option-hint">例如：1-3, 6</span>
      </div>`,
    notice: "",
  },
  "pdf-to-image": {
    kicker: "CONVERT / 05",
    title: "PDF 转图片",
    description: "将 PDF 页面转换为 PNG 或 JPG，多页自动打包为 ZIP。",
    accept: ".pdf,application/pdf",
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "支持指定页面和导出清晰度",
    action: "转换并下载",
    options: `
      <div class="option-field">
        <label for="image-format">图片格式</label>
        <select id="image-format"><option value="png">PNG · 无损</option><option value="jpg">JPG · 体积更小</option></select>
      </div>
      <div class="option-field">
        <label for="image-scale">清晰度</label>
        <select id="image-scale"><option value="1.5">标准 · 约 108 DPI</option><option value="2" selected>高清 · 约 144 DPI</option><option value="3">超清 · 约 216 DPI</option></select>
      </div>
      <div class="option-field full">
        <label for="image-pages">页码范围</label>
        <input id="image-pages" type="text" placeholder="留空表示全部页面" />
      </div>`,
    notice: "超清模式会占用更多内存，大页数文档建议选择“标准”或分段转换。",
  },
  "image-to-pdf": {
    kicker: "CONVERT / 06",
    title: "图片转 PDF",
    description: "将多张 JPG、PNG 或 WebP 图片按顺序整理成一份 PDF。",
    accept: ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp",
    multiple: true,
    minFiles: 1,
    dropTitle: "选择一张或多张图片",
    dropHelp: "添加后可调整图片顺序",
    action: "生成并下载",
    options: `
      <div class="option-field">
        <label for="page-size">页面尺寸</label>
        <select id="page-size"><option value="auto">跟随图片</option><option value="a4">A4 纸张</option></select>
      </div>
      <div class="option-field">
        <label for="page-margin">页面留白</label>
        <select id="page-margin"><option value="0">无留白</option><option value="24" selected>窄边距</option><option value="48">宽边距</option></select>
      </div>`,
    notice: "透明 PNG 会保留透明区域；WebP 将先在浏览器中转为 PNG。",
  },
  watermark: {
    kicker: "EDIT / 07",
    title: "添加文字水印",
    description: "给每一页添加居中的中文或英文文字水印。",
    accept: ".pdf,application/pdf",
    multiple: false,
    minFiles: 1,
    dropTitle: "选择一个 PDF 文件",
    dropHelp: "水印将在本地写入全部页面",
    action: "添加并下载",
    options: `
      <div class="option-field full">
        <label for="watermark-text">水印文字</label>
        <input id="watermark-text" type="text" maxlength="40" value="内部资料" placeholder="请输入水印文字" />
      </div>
      <div class="option-field">
        <label for="watermark-opacity">透明度</label>
        <select id="watermark-opacity"><option value="0.12">浅色</option><option value="0.2" selected>标准</option><option value="0.32">明显</option></select>
      </div>
      <div class="option-field">
        <label for="watermark-angle">倾斜角度</label>
        <select id="watermark-angle"><option value="-30">-30°</option><option value="-45" selected>-45°</option><option value="0">0°</option><option value="30">30°</option></select>
      </div>`,
    notice: "水印会成为页面内容的一部分。请保留原文件，以便需要时恢复。",
  },
};

const state = {
  activeTool: "merge",
  files: [],
  resultUrls: [],
  processing: false,
};

const dialog = document.querySelector("#tool-dialog");
const titleEl = document.querySelector("#dialog-title");
const kickerEl = document.querySelector("#dialog-kicker");
const descriptionEl = document.querySelector("#dialog-description");
const fileInput = document.querySelector("#file-input");
const dropZone = document.querySelector("#drop-zone");
const dropTitle = document.querySelector("#drop-title");
const dropHelp = document.querySelector("#drop-help");
const fileListWrap = document.querySelector("#file-list-wrap");
const fileList = document.querySelector("#file-list");
const clearFilesButton = document.querySelector("#clear-files");
const optionsEl = document.querySelector("#tool-options");
const noticeEl = document.querySelector("#tool-notice");
const processButton = document.querySelector("#process-button");
const progressWrap = document.querySelector("#progress-wrap");
const progressBar = document.querySelector("#progress-bar");
const progressText = document.querySelector("#progress-text");
const progressValue = document.querySelector("#progress-value");
const resultBox = document.querySelector("#result-box");
const toast = document.querySelector("#toast");

document.querySelector("#year").textContent = new Date().getFullYear();

document.querySelectorAll("[data-open-tool]").forEach((button) => {
  button.addEventListener("click", () => openTool(button.dataset.openTool));
});

document.querySelector(".dialog-close").addEventListener("click", closeTool);
dialog.addEventListener("click", (event) => {
  if (event.target === dialog && !state.processing) closeTool();
});
dialog.addEventListener("cancel", (event) => {
  if (state.processing) event.preventDefault();
});

dropZone.addEventListener("click", () => !state.processing && fileInput.click());
dropZone.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && !state.processing) {
    event.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", () => addFiles([...fileInput.files]));
["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  if (!state.processing) dropZone.classList.add("dragging");
}));
["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
}));
dropZone.addEventListener("drop", (event) => {
  if (!state.processing) addFiles([...event.dataTransfer.files]);
});
clearFilesButton.addEventListener("click", clearFiles);
processButton.addEventListener("click", processCurrentTool);

function openTool(toolKey) {
  if (!tools[toolKey]) return;
  state.activeTool = toolKey;
  state.files = [];
  cleanupResultUrls();
  resetProgress();
  resultBox.hidden = true;

  const tool = tools[toolKey];
  kickerEl.textContent = tool.kicker;
  titleEl.textContent = tool.title;
  descriptionEl.textContent = tool.description;
  dropTitle.textContent = tool.dropTitle;
  dropHelp.textContent = tool.dropHelp;
  fileInput.accept = tool.accept;
  fileInput.multiple = tool.multiple;
  fileInput.value = "";
  optionsEl.innerHTML = tool.options;
  noticeEl.textContent = tool.notice;
  noticeEl.hidden = !tool.notice;
  processButton.textContent = tool.action;
  processButton.disabled = true;
  renderFiles();
  dialog.showModal();
  document.body.style.overflow = "hidden";
}

function closeTool() {
  if (state.processing) {
    showToast("正在处理文件，请稍候。", true);
    return;
  }
  dialog.close();
  document.body.style.overflow = "";
  state.files = [];
  cleanupResultUrls();
}

function addFiles(incoming) {
  const tool = tools[state.activeTool];
  const valid = incoming.filter((file) => isAccepted(file, state.activeTool));
  if (!valid.length) {
    showToast(state.activeTool === "image-to-pdf" ? "请选择 JPG、PNG 或 WebP 图片。" : "请选择 PDF 文件。", true);
    return;
  }
  if (valid.some((file) => file.size > 150 * 1024 * 1024)) {
    showToast("单个文件不能超过 150 MB。", true);
    return;
  }
  state.files = tool.multiple ? [...state.files, ...valid] : [valid[0]];
  fileInput.value = "";
  cleanupResultUrls();
  resultBox.hidden = true;
  renderFiles();
}

function isAccepted(file, toolKey) {
  if (toolKey === "image-to-pdf") return /^image\/(jpeg|png|webp)$/i.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function clearFiles() {
  if (state.processing) return;
  state.files = [];
  cleanupResultUrls();
  resultBox.hidden = true;
  renderFiles();
}

function renderFiles() {
  const tool = tools[state.activeTool];
  fileListWrap.hidden = state.files.length === 0;
  processButton.disabled = state.files.length < tool.minFiles || state.processing;
  fileList.innerHTML = "";

  state.files.forEach((file, index) => {
    const item = document.createElement("li");
    item.className = "file-item";
    const type = state.activeTool === "image-to-pdf" ? (file.name.split(".").pop() || "IMG").toUpperCase() : "PDF";
    item.innerHTML = `
      <span class="file-type">${escapeHtml(type.slice(0, 4))}</span>
      <span class="file-meta"><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}</small></span>
      <span class="file-actions">
        ${tool.multiple ? `<button type="button" data-action="up" aria-label="上移" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-action="down" aria-label="下移" ${index === state.files.length - 1 ? "disabled" : ""}>↓</button>` : ""}
        <button type="button" data-action="remove" aria-label="移除">×</button>
      </span>`;
    item.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => updateFile(index, button.dataset.action)));
    fileList.append(item);
  });
}

function updateFile(index, action) {
  if (state.processing) return;
  if (action === "remove") state.files.splice(index, 1);
  if (action === "up" && index > 0) [state.files[index - 1], state.files[index]] = [state.files[index], state.files[index - 1]];
  if (action === "down" && index < state.files.length - 1) [state.files[index + 1], state.files[index]] = [state.files[index], state.files[index + 1]];
  cleanupResultUrls();
  resultBox.hidden = true;
  renderFiles();
}

async function processCurrentTool() {
  if (state.processing) return;
  state.processing = true;
  processButton.disabled = true;
  resultBox.hidden = true;
  cleanupResultUrls();
  setProgress(2, "正在读取文件");

  try {
    const handlers = {
      merge: handleMerge,
      split: handleSplit,
      compress: handleCompress,
      rotate: handleRotate,
      "pdf-to-image": handlePdfToImage,
      "image-to-pdf": handleImageToPdf,
      watermark: handleWatermark,
    };
    const result = await handlers[state.activeTool]();
    setProgress(100, "处理完成");
    showResult(result);
  } catch (error) {
    console.error(error);
    resetProgress();
    showToast(normalizeError(error), true);
  } finally {
    state.processing = false;
    processButton.disabled = state.files.length < tools[state.activeTool].minFiles;
  }
}

async function handleMerge() {
  const output = await PDFDocument.create();
  let done = 0;
  for (const file of state.files) {
    const source = await loadPdf(file);
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
    done += 1;
    setProgress(10 + Math.round((done / state.files.length) * 75), `正在合并第 ${done} 个文件`);
    await yieldToBrowser();
  }
  const bytes = await output.save({ useObjectStreams: true });
  return makeResult(bytes, "application/pdf", `轻页-合并-${dateStamp()}.pdf`, `已合并 ${state.files.length} 个文件，共 ${output.getPageCount()} 页。`);
}

async function handleSplit() {
  const source = await loadPdf(state.files[0]);
  const total = source.getPageCount();
  const selected = parsePageRange(valueOf("split-pages"), total);
  const mode = valueOf("split-mode");
  if (mode === "extract") {
    const output = await PDFDocument.create();
    const pages = await output.copyPages(source, selected);
    pages.forEach((page) => output.addPage(page));
    setProgress(80, "正在生成提取文件");
    const bytes = await output.save({ useObjectStreams: true });
    return makeResult(bytes, "application/pdf", `${baseName(state.files[0].name)}-提取页.pdf`, `已提取 ${selected.length} 页。`);
  }

  const zip = new JSZip();
  for (let i = 0; i < selected.length; i += 1) {
    const output = await PDFDocument.create();
    const [page] = await output.copyPages(source, [selected[i]]);
    output.addPage(page);
    zip.file(`第-${String(selected[i] + 1).padStart(3, "0")}-页.pdf`, await output.save());
    setProgress(10 + Math.round(((i + 1) / selected.length) * 70), `正在拆分第 ${i + 1} / ${selected.length} 页`);
    await yieldToBrowser();
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }, (meta) => setProgress(82 + Math.round(meta.percent * 0.15), "正在打包文件"));
  return makeResult(blob, "application/zip", `${baseName(state.files[0].name)}-拆分.zip`, `已拆分 ${selected.length} 页并打包。`);
}

async function handleRotate() {
  const source = await loadPdf(state.files[0]);
  const selected = parsePageRange(valueOf("rotate-pages"), source.getPageCount());
  const angle = Number(valueOf("rotate-angle"));
  selected.forEach((index, order) => {
    const page = source.getPage(index);
    const current = page.getRotation().angle || 0;
    page.setRotation(degrees((current + angle) % 360));
    setProgress(15 + Math.round(((order + 1) / selected.length) * 70), `正在旋转第 ${index + 1} 页`);
  });
  const bytes = await source.save({ useObjectStreams: true });
  return makeResult(bytes, "application/pdf", `${baseName(state.files[0].name)}-已旋转.pdf`, `已旋转 ${selected.length} 页。`);
}

async function handlePdfToImage() {
  const file = state.files[0];
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const selected = parsePageRange(valueOf("image-pages"), pdf.numPages);
  const format = valueOf("image-format");
  const scale = Number(valueOf("image-scale"));
  const mime = format === "jpg" ? "image/jpeg" : "image/png";
  const zip = new JSZip();
  let singleBlob = null;

  for (let i = 0; i < selected.length; i += 1) {
    const pageNumber = selected[i] + 1;
    const page = await pdf.getPage(pageNumber);
    const canvas = await renderPage(page, scale);
    const blob = await canvasToBlob(canvas, mime, format === "jpg" ? 0.9 : undefined);
    if (selected.length === 1) singleBlob = blob;
    else zip.file(`第-${String(pageNumber).padStart(3, "0")}-页.${format}`, blob);
    releaseCanvas(canvas);
    page.cleanup();
    setProgress(8 + Math.round(((i + 1) / selected.length) * 78), `正在转换第 ${i + 1} / ${selected.length} 页`);
    await yieldToBrowser();
  }
  await pdf.destroy();

  if (singleBlob) return makeResult(singleBlob, mime, `${baseName(file.name)}-第${selected[0] + 1}页.${format}`, "图片已经生成。", "图片");
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }, (meta) => setProgress(86 + Math.round(meta.percent * 0.12), "正在打包图片"));
  return makeResult(blob, "application/zip", `${baseName(file.name)}-图片.zip`, `已转换 ${selected.length} 页并打包。`, "图片包");
}

async function handleImageToPdf() {
  const output = await PDFDocument.create();
  const pageSize = valueOf("page-size");
  const margin = Number(valueOf("page-margin"));

  for (let i = 0; i < state.files.length; i += 1) {
    const file = state.files[i];
    const imageData = await normalizeImage(file);
    const embedded = imageData.mime === "image/jpeg" ? await output.embedJpg(imageData.bytes) : await output.embedPng(imageData.bytes);
    let pageWidth;
    let pageHeight;
    if (pageSize === "a4") {
      const landscape = embedded.width > embedded.height;
      [pageWidth, pageHeight] = landscape ? [841.89, 595.28] : [595.28, 841.89];
    } else {
      const scale = Math.min(1, 1400 / Math.max(embedded.width, embedded.height));
      pageWidth = Math.max(embedded.width * 0.75 * scale + margin * 2, 72);
      pageHeight = Math.max(embedded.height * 0.75 * scale + margin * 2, 72);
    }
    const page = output.addPage([pageWidth, pageHeight]);
    const maxWidth = Math.max(1, pageWidth - margin * 2);
    const maxHeight = Math.max(1, pageHeight - margin * 2);
    const scale = Math.min(maxWidth / embedded.width, maxHeight / embedded.height);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    page.drawImage(embedded, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
    setProgress(8 + Math.round(((i + 1) / state.files.length) * 78), `正在写入第 ${i + 1} / ${state.files.length} 张图片`);
    await yieldToBrowser();
  }
  const bytes = await output.save({ useObjectStreams: true });
  return makeResult(bytes, "application/pdf", `轻页-图片集-${dateStamp()}.pdf`, `已将 ${state.files.length} 张图片生成 PDF。`);
}

async function handleWatermark() {
  const source = await loadPdf(state.files[0]);
  const text = valueOf("watermark-text").trim();
  if (!text) throw new Error("请输入水印文字。");
  const opacity = Number(valueOf("watermark-opacity"));
  const angle = Number(valueOf("watermark-angle"));
  const markBlob = await createWatermarkImage(text, angle);
  const markImage = await source.embedPng(await markBlob.arrayBuffer());
  const pages = source.getPages();
  pages.forEach((page, index) => {
    const { width, height } = page.getSize();
    const desiredWidth = Math.min(width * 0.64, 460);
    const desiredHeight = desiredWidth * (markImage.height / markImage.width);
    page.drawImage(markImage, {
      x: (width - desiredWidth) / 2,
      y: (height - desiredHeight) / 2,
      width: desiredWidth,
      height: desiredHeight,
      opacity,
    });
    setProgress(12 + Math.round(((index + 1) / pages.length) * 76), `正在添加第 ${index + 1} / ${pages.length} 页水印`);
  });
  const bytes = await source.save({ useObjectStreams: true });
  return makeResult(bytes, "application/pdf", `${baseName(state.files[0].name)}-水印.pdf`, `已为 ${pages.length} 页添加水印。`);
}

async function handleCompress() {
  const presets = {
    strong: { maxWidth: 1100, quality: 0.5, label: "强压缩" },
    balanced: { maxWidth: 1600, quality: 0.68, label: "均衡" },
    clear: { maxWidth: 2200, quality: 0.82, label: "清晰" },
  };
  const preset = presets[valueOf("compress-level")];
  const file = state.files[0];
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: sourceBytes }).promise;
  const output = await PDFDocument.create();

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.max(1, Math.min(3, preset.maxWidth / baseViewport.width));
    const canvas = await renderPage(page, scale);
    const blob = await canvasToBlob(canvas, "image/jpeg", preset.quality);
    const image = await output.embedJpg(await blob.arrayBuffer());
    const outputPage = output.addPage([baseViewport.width, baseViewport.height]);
    outputPage.drawImage(image, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height });
    releaseCanvas(canvas);
    page.cleanup();
    setProgress(5 + Math.round((pageNumber / pdf.numPages) * 86), `正在压缩第 ${pageNumber} / ${pdf.numPages} 页`);
    await yieldToBrowser();
  }
  await pdf.destroy();
  const bytes = await output.save({ useObjectStreams: true });
  const change = file.size ? Math.round((1 - bytes.byteLength / file.size) * 100) : 0;
  const summary = change > 0 ? `${preset.label}完成，体积约减小 ${change}%（实际结果因文档而异）。` : `${preset.label}完成。该文件已较紧凑，结果可能不会更小。`;
  return makeResult(bytes, "application/pdf", `${baseName(file.name)}-压缩.pdf`, summary);
}

async function loadPdf(file) {
  try {
    return await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  } catch (error) {
    if (/encrypt|password/i.test(String(error))) throw new Error(`“${file.name}”可能已加密或需要密码，暂时无法处理。`);
    throw new Error(`无法读取“${file.name}”，请确认文件完整且为有效 PDF。`);
  }
}

function parsePageRange(raw, totalPages) {
  const text = String(raw || "").trim().replaceAll("，", ",");
  if (!text || /^all$/i.test(text) || text === "全部") return Array.from({ length: totalPages }, (_, index) => index);
  const pages = new Set();
  for (const piece of text.split(",")) {
    const part = piece.trim();
    if (!part) continue;
    const range = part.match(/^(\d+)\s*[-~—]\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < 1 || end < 1 || start > totalPages || end > totalPages || start > end) throw new Error(`页码“${part}”超出范围，当前文档共 ${totalPages} 页。`);
      for (let page = start; page <= end; page += 1) pages.add(page - 1);
    } else if (/^\d+$/.test(part)) {
      const page = Number(part);
      if (page < 1 || page > totalPages) throw new Error(`页码 ${page} 超出范围，当前文档共 ${totalPages} 页。`);
      pages.add(page - 1);
    } else {
      throw new Error(`无法识别页码“${part}”，请使用类似 1-3, 5 的格式。`);
    }
  }
  if (!pages.size) throw new Error("请至少输入一个有效页码。");
  return [...pages].sort((a, b) => a - b);
}

async function renderPage(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: false });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

async function normalizeImage(file) {
  if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) return { bytes: await file.arrayBuffer(), mime: "image/jpeg" };
  if (file.type === "image/png" || /\.png$/i.test(file.name)) return { bytes: await file.arrayBuffer(), mime: "image/png" };
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await canvasToBlob(canvas, "image/png");
  releaseCanvas(canvas);
  return { bytes: await blob.arrayBuffer(), mime: "image/png" };
}

async function createWatermarkImage(text, angle) {
  const scale = 2;
  const fontSize = 72 * scale;
  const padding = 45 * scale;
  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");
  measureContext.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`;
  const textWidth = Math.ceil(measureContext.measureText(text).width);
  const textHeight = Math.ceil(fontSize * 1.22);
  const radians = Math.abs(angle) * Math.PI / 180;
  const width = Math.ceil(Math.abs(textWidth * Math.cos(radians)) + Math.abs(textHeight * Math.sin(radians)) + padding * 2);
  const height = Math.ceil(Math.abs(textWidth * Math.sin(radians)) + Math.abs(textHeight * Math.cos(radians)) + padding * 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(width, 1);
  canvas.height = Math.max(height, 1);
  const context = canvas.getContext("2d");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(angle * Math.PI / 180);
  context.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#cf4224";
  context.fillText(text, 0, 0);
  const blob = await canvasToBlob(canvas, "image/png");
  releaseCanvas(canvas);
  return blob;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片生成失败，设备可能没有足够内存。")), type, quality));
}

function releaseCanvas(canvas) {
  canvas.width = 1;
  canvas.height = 1;
}

function makeResult(data, mime, filename, summary, label = "文件") {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  return { blob, filename, summary, label };
}

function showResult(result) {
  const url = URL.createObjectURL(result.blob);
  state.resultUrls.push(url);
  resultBox.innerHTML = `
    <strong>${escapeHtml(result.label || "文件")}已准备好</strong>
    <p>${escapeHtml(result.summary)} 结果大小 ${formatBytes(result.blob.size)}。</p>
    <a href="${url}" download="${escapeHtml(result.filename)}">下载 ${escapeHtml(result.filename)}</a>`;
  resultBox.hidden = false;
  resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setProgress(value, text) {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));
  progressWrap.hidden = false;
  progressBar.style.width = `${safeValue}%`;
  progressValue.textContent = `${safeValue}%`;
  progressText.textContent = text;
}

function resetProgress() {
  progressWrap.hidden = true;
  progressBar.style.width = "0%";
  progressValue.textContent = "0%";
  progressText.textContent = "准备处理";
}

function cleanupResultUrls() {
  state.resultUrls.forEach((url) => URL.revokeObjectURL(url));
  state.resultUrls = [];
}

function valueOf(id) {
  return document.getElementById(id)?.value ?? "";
}

function baseName(filename) {
  return filename.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80) || "轻页-PDF";
}

function dateStamp() {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function normalizeError(error) {
  const message = error?.message || String(error);
  if (/memory|allocation|Array buffer|canvas/i.test(message)) return "设备内存不足，请关闭其他应用、降低清晰度或拆分文件后重试。";
  if (/worker|fetch|network|cdn/i.test(message)) return "核心组件加载失败，请检查网络后刷新页面重试。";
  return message.length > 180 ? "处理失败，请确认文件有效并减小文件体积后重试。" : message;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

let toastTimer;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.style.background = isError ? "#8f2e1a" : "#1d211f";
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3600);
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
