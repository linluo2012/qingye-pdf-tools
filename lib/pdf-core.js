import { PDFDocument, PDFName, loadPdfJs } from "./deps.js";

/**
 * 载入 PDF，自动处理加密文件。
 * @returns {Promise<{doc: PDFDocument, encrypted: boolean}>}
 */
export async function loadPdf(file, password = "") {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const probe = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (!probe.isEncrypted) {
    return { doc: probe, encrypted: false };
  }
  const attempts = password ? [password] : ["", password];
  for (const attempt of attempts) {
    try {
      const doc = await PDFDocument.load(bytes, { password: attempt, updateMetadata: false });
      return { doc, encrypted: true };
    } catch (error) {
      if (!/password/i.test(String(error?.message))) throw error;
    }
  }
  const error = new Error("需要密码");
  error.code = "PASSWORD_REQUIRED";
  throw error;
}

/** 用 pdf.js 打开 PDF，返回文档代理。调用方负责 destroy()。 */
export async function openWithPdfJs(source) {
  const data = source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer());
  const pdfjsLib = await loadPdfJs();
  const task = pdfjsLib.getDocument({ data, useSystemFonts: true });
  const doc = await task.promise;
  return { doc, task };
}

/** 把 pdf.js 的页面渲染到 canvas。 */
export async function renderPageToCanvas(page, scale = 1, background = "#ffffff") {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

export function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("图片生成失败，设备可能内存不足。"))),
      type,
      quality,
    );
  });
}

export function releaseCanvas(canvas) {
  if (canvas) {
    canvas.width = 1;
    canvas.height = 1;
  }
}

/**
 * 在开始逐页位图处理前估算内存占用，超出浏览器承受范围就提前给出可执行的建议。
 *
 * 逐页渲染的工具（灰度/黑白/反色/背景色、压缩、PDF 转图片、OCR、长图）会把
 * 整页渲染成位图，内存随「页数 × 单页像素」增长。实测 300 页 200dpi 扫描件
 * 转图片会占用近 500MB 堆、耗时近 50 秒，手机端可能直接崩溃。
 *
 * 这里按 A4@150dpi 约 150 万像素/页的保守值估算，超过阈值就拦住。
 *
 * @param {number} pages 计划处理的页数
 * @param {string} toolName 工具名，用于提示文案
 * @param {boolean} canLimit 是否提供「页码范围」选项——没有的话提示要换成
 *        「拆分文件后分批处理」，否则给出的建议用户根本做不到。
 * @param {number} budget 可承受的像素总量，默认 1.8 亿（约 120 页 A4@150dpi）
 */
export function guardRasterWorkload(pages, toolName, canLimit = true, budget = 180_000_000) {
  const perPage = 1_500_000;
  const total = pages * perPage;
  if (total <= budget) return;
  const safePages = Math.floor(budget / perPage);
  const advice = canLimit
    ? `建议在「页码范围」里只选需要处理的页（最多约 ${safePages} 页），或降低清晰度。`
    : `建议先用「拆分 PDF」把它分成小文件，分批处理；或降低清晰度后重试。`;
  throw new Error(
    `「${toolName}」逐页渲染 ${pages} 页会占用大量内存，可能导致页面崩溃或手机闪退。${advice}`,
  );
}

/**
 * 把源文档的页面复制到目标文档，返回可直接 drawPage 的嵌入页数组。
 *
 * 空白页（无内容流）在扫描件 / 合并文件中非常常见，pdf-lib 处理它们时有个陷阱：
 * embedPage 当下不报错，但 save() 时会抛 "Can't embed page with missing Contents"，
 * 导致整个任务失败。因此这里在复制后主动为无内容流的页面补一个空内容流。
 *
 * embedPage 必须串行 await：并发执行会因内部 embedder 状态竞争而报错。
 */
export async function copyPagesForEmbed(output, doc, indices) {
  const wanted = indices || doc.getPageIndices();
  const copied = await output.copyPages(doc, wanted);
  const embedded = [];
  for (const page of copied) {
    if (!page.node.Contents()) {
      const empty = output.context.stream(new Uint8Array(0), { Type: "Stream" });
      page.node.set(PDFName.of("Contents"), output.context.register(empty));
    }
    embedded.push(await output.embedPage(page));
  }
  return embedded;
}

/**
 * 统一取页面尺寸。
 * @cantoo/pdf-lib 里原生 PDFPage 用 getSize()，而 embedPage() 返回的
 * PDFEmbeddedPage 只有 width/height 实例属性、没有 size 与 getSize()。
 * 这里两种形态统一处理，避免解构出 undefined 进而算出 NaN。
 */
export function pageSizeOf(page) {
  if (typeof page?.getSize === "function") return page.getSize();
  const width = Number(page?.width);
  const height = Number(page?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("无法读取页面尺寸，文件可能已损坏。");
  }
  return { width, height };
}

/** 解析 "1-3, 5, 8-10"，返回 0-based 页码数组。 */
export function parsePageRange(raw, totalPages) {
  const text = String(raw || "").trim().replace(/[，、]/g, ",");
  if (!text || /^(all|全部)$/i.test(text)) {
    return Array.from({ length: totalPages }, (_, index) => index);
  }
  const pages = new Set();
  for (const piece of text.split(",")) {
    const part = piece.trim();
    if (!part) continue;
    const range = part.match(/^(\d+)\s*[-~—至]\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < 1 || end < 1 || start > totalPages || end > totalPages || start > end) {
        throw new Error(`页码“${part}”超出范围，当前文档共 ${totalPages} 页。`);
      }
      for (let page = start; page <= end; page += 1) pages.add(page - 1);
      continue;
    }
    if (/^\d+$/.test(part)) {
      const page = Number(part);
      if (page < 1 || page > totalPages) {
        throw new Error(`页码 ${page} 超出范围，当前文档共 ${totalPages} 页。`);
      }
      pages.add(page - 1);
      continue;
    }
    throw new Error(`无法识别页码“${part}”，请使用类似 1-3, 5 的格式。`);
  }
  if (!pages.size) throw new Error("请至少输入一个有效页码。");
  return [...pages].sort((a, b) => a - b);
}

/** 判断页面是否近似空白：无文本且无绘制指令。 */
export async function isBlankPage(page) {
  const text = await page.getTextContent();
  const meaningful = text.items.some((item) => String(item.str || "").trim().length > 0);
  if (meaningful) return false;
  const ops = await page.getOperatorList();
  // fnArray 里 80-90 区间为图像绘制，19/20 为路径填充描边类操作
  const hasPaint = ops.fnArray.some((fn) => (fn >= 19 && fn <= 20) || (fn >= 80 && fn <= 90));
  return !hasPaint;
}

/** 生成中文文字水印位图（Canvas → PNG），因为标准 14 字体无法绘制中文。 */
export async function createWatermarkImage(text, angleDegrees, color = "#cf4224") {
  const scale = 2;
  const fontSize = 72 * scale;
  const padding = 46 * scale;
  const font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`;
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = font;
  const textWidth = Math.ceil(measure.measureText(text).width);
  const textHeight = Math.ceil(fontSize * 1.24);
  const radians = (Math.abs(angleDegrees) * Math.PI) / 180;
  const width = Math.ceil(Math.abs(textWidth * Math.cos(radians)) + Math.abs(textHeight * Math.sin(radians)) + padding * 2);
  const height = Math.ceil(Math.abs(textWidth * Math.sin(radians)) + Math.abs(textHeight * Math.cos(radians)) + padding * 2);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(width, 1);
  canvas.height = Math.max(height, 1);
  const context = canvas.getContext("2d");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((angleDegrees * Math.PI) / 180);
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = color;
  context.fillText(text, 0, 0);
  const blob = await canvasToBlob(canvas, "image/png");
  releaseCanvas(canvas);
  return blob;
}

/** 把任意图片文件转成 pdf-lib 可嵌入的字节。 */
export async function normalizeImageFile(file) {
  if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) {
    return { bytes: await file.arrayBuffer(), mime: "image/jpeg" };
  }
  if (file.type === "image/png" || /\.png$/i.test(file.name)) {
    return { bytes: await file.arrayBuffer(), mime: "image/png" };
  }
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

/** 从 pdf.js 页面中取出内嵌图片。兼容 data 位图与 ImageBitmap 两种形态。 */
export async function extractPageImages(page) {
  const pdfjs = await loadPdfJs();
  const OPS = pdfjs.OPS;
  const paintOps = new Set(
    [
      OPS?.paintImageXObject,
      OPS?.paintImageXObjectRepeat,
      OPS?.paintInlineImageXObject,
      OPS?.paintInlineImageXObjectGroup,
    ].filter((value) => typeof value === "number"),
  );
  if (!paintOps.size) return [];

  const ops = await page.getOperatorList();
  const names = new Set();
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    if (!paintOps.has(ops.fnArray[i])) continue;
    const name = ops.argsArray[i]?.[0];
    if (typeof name === "string") names.add(name);
  }

  const images = [];
  for (const name of names) {
    // pdf.js v4+ 的 PDFObjects.get 必须是回调式；同步调用会抛 "isn't resolved yet"
    const object = await new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value ?? null);
      };
      try {
        const result = page.objs.get(name, done);
        if (result && typeof result.then === "function") result.then(done).catch(() => done(null));
      } catch {
        done(null);
      }
      setTimeout(() => done(null), 4000);
    });
    if (!object) continue;
    if (object.bitmap) {
      images.push({ bitmap: object.bitmap, width: object.width, height: object.height });
      continue;
    }
    if (object.data && object.width && object.height) {
      images.push({ data: object.data, width: object.width, height: object.height, kind: object.kind });
    }
  }
  return images;
}

export function baseName(filename) {
  return (
    filename
      .replace(/\.[^.]+$/, "")
      .replace(/[\\/:*?"<>|]/g, "-")
      .slice(0, 80) || "轻页-PDF"
  );
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function dateStamp() {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

export function makeResult(data, mime, filename, summary, label = "文件") {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  return { blob, filename, summary, label };
}

export function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]
  ));
}
