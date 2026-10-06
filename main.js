import { TOOLS, valueOf } from "./lib/registry.js";
import { formatBytes, escapeHtml, baseName, openWithPdfJs, renderPageToCanvas, releaseCanvas } from "./lib/pdf-core.js";
import { loadPdfJs } from "./lib/deps.js";

const dialog = document.querySelector("#tool-dialog");
const readerDialog = document.querySelector("#reader-dialog");
const els = {
  kicker: document.querySelector("#dialog-kicker"),
  title: document.querySelector("#dialog-title"),
  description: document.querySelector("#dialog-description"),
  fileInput: document.querySelector("#file-input"),
  dropZone: document.querySelector("#drop-zone"),
  dropTitle: document.querySelector("#drop-title"),
  dropHelp: document.querySelector("#drop-help"),
  fileListWrap: document.querySelector("#file-list-wrap"),
  fileList: document.querySelector("#file-list"),
  clearFiles: document.querySelector("#clear-files"),
  workspace: document.querySelector("#page-workspace"),
  options: document.querySelector("#tool-options"),
  notice: document.querySelector("#tool-notice"),
  processButton: document.querySelector("#process-button"),
  progressWrap: document.querySelector("#progress-wrap"),
  progressBar: document.querySelector("#progress-bar"),
  progressText: document.querySelector("#progress-text"),
  progressValue: document.querySelector("#progress-value"),
  resultBox: document.querySelector("#result-box"),
  toast: document.querySelector("#toast"),
};

const state = {
  tool: "merge",
  files: [],
  pageOrder: [],
  resultUrls: [],
  busy: false,
};

const reader = {
  task: null,
  doc: null,
  page: 1,
  zoom: 0,
  rendering: false,
};

/* ------------------------------------------------------------ 通用 UI */

function setProgress(value, text) {
  const safe = Math.max(0, Math.min(100, Math.round(value)));
  els.progressWrap.hidden = false;
  els.progressBar.style.width = `${safe}%`;
  els.progressValue.textContent = `${safe}%`;
  els.progressText.textContent = text;
}

function resetProgress() {
  els.progressWrap.hidden = true;
  els.progressBar.style.width = "0%";
  els.progressValue.textContent = "0%";
  els.progressText.textContent = "准备处理";
}

function cleanupUrls() {
  state.resultUrls.forEach((url) => URL.revokeObjectURL(url));
  state.resultUrls = [];
}

let toastTimer;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.style.background = isError ? "#8f2e1a" : "#1d211f";
  els.toast.classList.add("visible");
  toastTimer = setTimeout(() => els.toast.classList.remove("visible"), 3800);
}

function showResult(result) {
  if (result.inline) {
    els.resultBox.innerHTML = result.inline;
    els.resultBox.hidden = false;
    els.resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  const url = URL.createObjectURL(result.blob);
  state.resultUrls.push(url);
  els.resultBox.innerHTML = `
    <strong>${escapeHtml(result.label || "文件")}已准备好</strong>
    <p>${escapeHtml(result.summary)} 大小 ${formatBytes(result.blob.size)}。</p>
    <a href="${url}" download="${escapeHtml(result.filename)}">下载 ${escapeHtml(result.filename)}</a>`;
  els.resultBox.hidden = false;
  els.resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function normalizeError(error) {
  if (error?.code === "PASSWORD_REQUIRED") return "这个 PDF 已加密，请在下方填入密码后重试。";
  const message = String(error?.message || error);
  if (/password/i.test(message)) return "密码不正确，请重新输入。";
  if (/out of memory|allocation failed|Array buffer|allocation/i.test(message)) {
    return "设备内存不足，请关闭其他应用、降低清晰度或拆分文件后重试。";
  }
  if (/fetch|network|Failed to (load|import)|dynamically imported/i.test(message)) {
    return "核心组件加载失败，请检查网络后刷新页面重试。";
  }
  if (/Web Crypto|crypto/i.test(message)) return "当前浏览器不支持加密所需的 Web Crypto，请改用 Chrome、Edge 或 Safari。";
  return message.length > 200 ? "处理失败，请确认文件有效并减小文件体积后重试。" : message;
}

/* ------------------------------------------------------------ 工具面板 */

function openTool(key) {
  const tool = TOOLS[key];
  if (!tool) return;
  state.tool = key;
  state.files = [];
  state.pageOrder = [];
  cleanupUrls();
  resetProgress();

  els.kicker.textContent = tool.kicker;
  els.title.textContent = tool.title;
  els.description.textContent = tool.description;
  els.dropTitle.textContent = tool.dropTitle;
  els.dropHelp.textContent = tool.dropHelp;
  els.fileInput.accept = tool.accept;
  els.fileInput.multiple = tool.multiple;
  els.fileInput.value = "";
  els.options.innerHTML = tool.options;
  els.notice.textContent = tool.notice;
  els.notice.hidden = !tool.notice;
  els.processButton.textContent = tool.action;
  els.workspace.hidden = true;
  els.workspace.innerHTML = "";
  els.resultBox.hidden = true;
  applyConditionalFields();
  renderFiles();
  dialog.showModal();
  document.body.style.overflow = "hidden";
}

function closeTool() {
  if (state.busy) {
    showToast("正在处理文件，请稍候。", true);
    return;
  }
  dialog.close();
  document.body.style.overflow = "";
  state.files = [];
  state.pageOrder = [];
  cleanupUrls();
}

function applyConditionalFields() {
  const action = document.querySelector("#meta-action");
  if (!action) return;
  const sync = () => {
    document.querySelectorAll("#tool-options [data-when]").forEach((node) => {
      node.hidden = node.dataset.when !== action.value;
    });
  };
  action.addEventListener("change", sync);
  sync();
}

function isAccepted(file) {
  if (state.tool === "image-to-pdf") {
    return /^image\/(jpeg|png|webp)$/i.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
  }
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function addFiles(incoming) {
  const tool = TOOLS[state.tool];
  const valid = incoming.filter(isAccepted);
  if (!valid.length) {
    showToast(state.tool === "image-to-pdf" ? "请选择 JPG、PNG 或 WebP 图片。" : "请选择 PDF 文件。", true);
    return;
  }
  if (valid.some((file) => file.size > 150 * 1024 * 1024)) {
    showToast("单个文件不能超过 150 MB。", true);
    return;
  }
  state.files = tool.multiple ? [...state.files, ...valid] : [valid[0]];
  els.fileInput.value = "";
  cleanupUrls();
  els.resultBox.hidden = true;
  renderFiles();
  if (TOOLS[state.tool].workspace === "organize" && state.files.length === 1) {
    buildPageWorkspace();
  }
}

function clearFiles() {
  if (state.busy) return;
  state.files = [];
  state.pageOrder = [];
  cleanupUrls();
  els.resultBox.hidden = true;
  els.workspace.hidden = true;
  els.workspace.innerHTML = "";
  renderFiles();
}

function renderFiles() {
  const tool = TOOLS[state.tool];
  els.fileListWrap.hidden = state.files.length === 0;
  els.processButton.disabled = state.files.length < tool.minFiles || state.busy;
  els.fileList.innerHTML = "";
  state.files.forEach((file, index) => {
    const item = document.createElement("li");
    item.className = "file-item";
    const type = state.tool === "image-to-pdf" ? (file.name.split(".").pop() || "IMG").toUpperCase() : "PDF";
    item.innerHTML = `
      <span class="file-type">${escapeHtml(type.slice(0, 4))}</span>
      <span class="file-meta"><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}</small></span>
      <span class="file-actions">
        ${tool.multiple ? `<button type="button" data-action="up" aria-label="上移" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-action="down" aria-label="下移" ${index === state.files.length - 1 ? "disabled" : ""}>↓</button>` : ""}
        <button type="button" data-action="remove" aria-label="移除">×</button>
      </span>`;
    item.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => updateFile(index, button.dataset.action));
    });
    els.fileList.append(item);
  });
}

function updateFile(index, action) {
  if (state.busy) return;
  if (action === "remove") {
    state.files.splice(index, 1);
    state.pageOrder = [];
    els.workspace.hidden = true;
    els.workspace.innerHTML = "";
  }
  if (action === "up" && index > 0) {
    [state.files[index - 1], state.files[index]] = [state.files[index], state.files[index - 1]];
  }
  if (action === "down" && index < state.files.length - 1) {
    [state.files[index + 1], state.files[index]] = [state.files[index], state.files[index + 1]];
  }
  cleanupUrls();
  els.resultBox.hidden = true;
  renderFiles();
}

/* ------------------------------------------------------- 页面管理缩略图 */

async function buildPageWorkspace() {
  const file = state.files[0];
  els.workspace.hidden = false;
  els.workspace.innerHTML = `<div class="workspace-loading">正在生成页面缩略图…</div>`;
  try {
    const { doc, task } = await openWithPdfJs(file);
    const total = doc.numPages;
    const limit = Math.min(total, 100);
    state.pageOrder = Array.from({ length: total }, (_, index) => ({ index, removed: false, rotation: 0 }));
    const grid = document.createElement("div");
    grid.className = "page-grid";
    els.workspace.innerHTML = `
      <div class="workspace-head">
        <strong>页面顺序（共 ${total} 页${total > limit ? `，仅显示前 ${limit} 页缩略图` : ""}）</strong>
        <span class="workspace-actions">
          <button type="button" data-ws="reverse">反转顺序</button>
          <button type="button" data-ws="restore">重置</button>
        </span>
      </div>`;
    const host = document.createElement("div");
    host.className = "page-grid";
    els.workspace.append(host);
    els.workspace.querySelectorAll("[data-ws]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.ws === "reverse") {
          state.pageOrder = [...state.pageOrder].reverse();
        } else {
          state.pageOrder = state.pageOrder.map((item) => ({ ...item, removed: false }));
        }
        renderPageGrid();
      });
    });

    const thumbs = new Map();
    for (let i = 0; i < limit; i += 1) {
      const page = await doc.getPage(i + 1);
      const canvas = await renderPageToCanvas(page, 0.28);
      thumbs.set(i, canvas.toDataURL("image/jpeg", 0.7));
      releaseCanvas(canvas);
    }
    await task.destroy();
    renderPageGrid(thumbs);
  } catch (error) {
    els.workspace.innerHTML = `<div class="workspace-error">${escapeHtml(normalizeError(error))}</div>`;
  }
}

function renderPageGrid(thumbs = new Map()) {
  const host = els.workspace.querySelector(".page-grid");
  if (!host) return;
  host.innerHTML = "";
  state.pageOrder.forEach((item, position) => {
    const cell = document.createElement("div");
    cell.className = `page-cell${item.removed ? " is-removed" : ""}`;
    cell.draggable = !item.removed;
    const src = thumbs.get(item.index);
    cell.innerHTML = `
      <div class="page-thumb">${src ? `<img src="${src}" alt="第 ${item.index + 1} 页" />` : `<span class="page-thumb-fallback">第 ${item.index + 1} 页</span>`}</div>
      <div class="page-cell-bar">
        <span>${position + 1}<small>原 ${item.index + 1}</small></span>
        <span class="page-cell-actions">
          <button type="button" data-op="left" title="左转">↺</button>
          <button type="button" data-op="right" title="右转">↻</button>
          <button type="button" data-op="remove" title="${item.removed ? "恢复" : "删除"}">${item.removed ? "↩" : "×"}</button>
        </span>
      </div>`;
    if (item.rotation) {
      const img = cell.querySelector("img");
      if (img) img.style.transform = `rotate(${item.rotation}deg)`;
    }
    cell.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", String(position));
      cell.classList.add("is-dragging");
    });
    cell.addEventListener("dragend", () => cell.classList.remove("is-dragging"));
    cell.addEventListener("dragover", (event) => event.preventDefault());
    cell.addEventListener("drop", (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer.getData("text/plain"));
      if (Number.isNaN(from) || from === position) return;
      const [moved] = state.pageOrder.splice(from, 1);
      state.pageOrder.splice(position, 0, moved);
      renderPageGrid(thumbs);
    });
    cell.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        const target = state.pageOrder[position];
        if (button.dataset.op === "remove") target.removed = !target.removed;
        if (button.dataset.op === "left") target.rotation = (target.rotation + 270) % 360;
        if (button.dataset.op === "right") target.rotation = (target.rotation + 90) % 360;
        renderPageGrid(thumbs);
      });
    });
    host.append(cell);
  });
  const remaining = state.pageOrder.filter((item) => !item.removed).length;
  let counter = els.workspace.querySelector("[data-remaining]");
  if (!counter) {
    counter = document.createElement("span");
    counter.dataset.remaining = "1";
    counter.className = "workspace-remaining";
    els.workspace.querySelector(".workspace-head")?.append(counter);
  }
  counter.textContent = `将输出 ${remaining} 页`;
}

/* ------------------------------------------------------------ 预览阅读器 */

async function openReader(file) {
  readerDialog.showModal();
  document.querySelector("#reader-name").textContent = file.name;
  document.querySelector("#reader-meta").textContent = "正在加载…";
  const canvas = document.querySelector("#reader-canvas");
  const context = canvas.getContext("2d");
  context.fillStyle = "#3a3f3b";
  context.fillRect(0, 0, canvas.width, canvas.height);
  try {
    const { doc, task } = await openWithPdfJs(file);
    reader.task?.destroy();
    reader.doc = doc;
    reader.task = task;
    reader.page = 1;
    reader.zoom = 0;
    document.querySelector("#reader-total").textContent = String(doc.numPages);
    document.querySelector("#reader-page-input").max = String(doc.numPages);
    document.querySelector("#reader-meta").textContent = `${formatBytes(file.size)} · ${doc.numPages} 页`;
    await renderReaderPage();
  } catch (error) {
    document.querySelector("#reader-meta").textContent = normalizeError(error);
  }
}

async function renderReaderPage() {
  if (!reader.doc || reader.rendering) return;
  reader.rendering = true;
  try {
    const page = await reader.doc.getPage(reader.page);
    const base = page.getViewport({ scale: 1 });
    const fit = Math.min((window.innerWidth - 80) / base.width, (window.innerHeight - 190) / base.height, 2);
    const scale = reader.zoom || fit;
    const viewport = page.getViewport({ scale });
    const canvas = document.querySelector("#reader-canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    document.querySelector("#reader-zoom-label").textContent = reader.zoom
      ? `${Math.round((scale / base.width) * 72)}%`
      : "适应";
    document.querySelector("#reader-page-input").value = String(reader.page);
  } catch (error) {
    showToast(normalizeError(error), true);
  } finally {
    reader.rendering = false;
  }
}

function closeReader() {
  readerDialog.close();
  reader.task?.destroy();
  reader.task = null;
  reader.doc = null;
}

/* ------------------------------------------------------------ 执行处理 */

async function process() {
  const tool = TOOLS[state.tool];
  if (state.busy) return;
  if (tool.openReader) {
    const file = state.files[0];
    closeTool();
    openReader(file);
    return;
  }
  if (!tool.run) return;

  state.busy = true;
  els.processButton.disabled = true;
  els.resultBox.hidden = true;
  cleanupUrls();
  setProgress(2, "准备处理");

  const ctx = {
    files: state.files,
    value: valueOf,
    progress: setProgress,
    pageOrder: state.pageOrder,
    mode: tool.showMode,
  };

  try {
    const result = await tool.run(ctx);
    setProgress(100, "处理完成");
    showResult(result);
  } catch (error) {
    console.error(error);
    resetProgress();
    showToast(normalizeError(error), true);
  } finally {
    state.busy = false;
    els.processButton.disabled = state.files.length < tool.minFiles;
  }
}

/* ------------------------------------------------------------ 事件绑定 */

document.querySelector("#year").textContent = new Date().getFullYear();
document.querySelectorAll("[data-open-tool]").forEach((button) => {
  button.addEventListener("click", () => openTool(button.dataset.openTool));
});

document.querySelector(".dialog-close").addEventListener("click", closeTool);
dialog.addEventListener("click", (event) => {
  if (event.target === dialog && !state.busy) closeTool();
});
dialog.addEventListener("cancel", (event) => {
  if (state.busy) event.preventDefault();
});

els.dropZone.addEventListener("click", () => !state.busy && els.fileInput.click());
els.dropZone.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && !state.busy) {
    event.preventDefault();
    els.fileInput.click();
  }
});
els.fileInput.addEventListener("change", () => addFiles([...els.fileInput.files]));
["dragenter", "dragover"].forEach((name) => els.dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  if (!state.busy) els.dropZone.classList.add("dragging");
}));
["dragleave", "drop"].forEach((name) => els.dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  els.dropZone.classList.remove("dragging");
}));
els.dropZone.addEventListener("drop", (event) => {
  if (!state.busy) addFiles([...event.dataTransfer.files]);
});
els.clearFiles.addEventListener("click", clearFiles);
els.processButton.addEventListener("click", process);

document.querySelector("#reader-close").addEventListener("click", closeReader);
document.querySelector("#reader-prev").addEventListener("click", () => {
  if (reader.page > 1) {
    reader.page -= 1;
    renderReaderPage();
  }
});
document.querySelector("#reader-next").addEventListener("click", () => {
  if (reader.doc && reader.page < reader.doc.numPages) {
    reader.page += 1;
    renderReaderPage();
  }
});
document.querySelector("#reader-page-input").addEventListener("change", (event) => {
  const value = Number(event.target.value);
  if (reader.doc && value >= 1 && value <= reader.doc.numPages) {
    reader.page = value;
    renderReaderPage();
  }
});
document.querySelector("#reader-zoom-in").addEventListener("click", () => {
  reader.zoom = Math.min(4, (reader.zoom || 1.4) * 1.25);
  renderReaderPage();
});
document.querySelector("#reader-zoom-out").addEventListener("click", () => {
  reader.zoom = Math.max(0.3, (reader.zoom || 1.4) / 1.25);
  renderReaderPage();
});
document.addEventListener("keydown", (event) => {
  if (!readerDialog.open) return;
  if (event.key === "ArrowLeft") document.querySelector("#reader-prev").click();
  if (event.key === "ArrowRight") document.querySelector("#reader-next").click();
});

/* ------------------------------------------------------------ 工具检索 */

const searchInput = document.querySelector("#tool-search");
const chips = [...document.querySelectorAll(".chip")];
const cards = [...document.querySelectorAll(".tool-card")];
const emptyHint = document.querySelector("#empty-hint");
let activeFilter = "all";

function applyFilter() {
  const keyword = searchInput.value.trim().toLowerCase();
  let visible = 0;
  cards.forEach((card) => {
    const matchGroup = activeFilter === "all" || card.dataset.group === activeFilter;
    const matchText = !keyword || `${card.dataset.name} ${card.textContent}`.toLowerCase().includes(keyword);
    const show = matchGroup && matchText;
    card.hidden = !show;
    if (show) visible += 1;
  });
  emptyHint.hidden = visible > 0;
}

searchInput.addEventListener("input", applyFilter);
chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    chips.forEach((other) => other.classList.toggle("is-active", other === chip));
    activeFilter = chip.dataset.filter;
    applyFilter();
  });
});

window.__qingye = { openTool, state, TOOLS, loadPdfJs, baseName };
