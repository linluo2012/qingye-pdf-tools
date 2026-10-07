import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  JSZip,
  pagePreset,
  loadOcr,
  disposeOcr,
} from "./deps.js";
import {
  loadPdf,
  openWithPdfJs,
  renderPageToCanvas,
  canvasToBlob,
  releaseCanvas,
  guardRasterWorkload,
  pageSizeOf,
  copyPagesForEmbed,
  parsePageRange,
  isBlankPage,
  createWatermarkImage,
  normalizeImageFile,
  extractPageImages,
  baseName,
  dateStamp,
  makeResult,
  yieldToBrowser,
} from "./pdf-core.js";

/* ---------------------------------------------------------------- 组织管理 */

export async function merge({ files, progress }) {
  const output = await PDFDocument.create();
  for (let i = 0; i < files.length; i += 1) {
    const { doc } = await loadPdf(files[i]);
    const pages = await output.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => output.addPage(page));
    progress(8 + Math.round(((i + 1) / files.length) * 78), `正在合并第 ${i + 1} / ${files.length} 个文件`);
    await yieldToBrowser();
  }
  const bytes = await output.save({ useObjectStreams: true });
  return makeResult(bytes, "application/pdf", `轻页-合并-${dateStamp()}.pdf`, `已合并 ${files.length} 个文件，共 ${output.getPageCount()} 页。`, "合并结果");
}

export async function split({ files, value, progress }) {
  const { doc } = await loadPdf(files[0]);
  const total = doc.getPageCount();
  const selected = parsePageRange(value("split-pages"), total);

  if (value("split-mode") === "extract") {
    const output = await PDFDocument.create();
    const pages = await output.copyPages(doc, selected);
    pages.forEach((page) => output.addPage(page));
    progress(85, "正在生成提取文件");
    const bytes = await output.save({ useObjectStreams: true });
    return makeResult(bytes, "application/pdf", `${baseName(files[0].name)}-提取页.pdf`, `已提取 ${selected.length} 页。`, "提取结果");
  }

  const zip = new JSZip();
  for (let i = 0; i < selected.length; i += 1) {
    const output = await PDFDocument.create();
    const [page] = await output.copyPages(doc, [selected[i]]);
    output.addPage(page);
    zip.file(`第-${String(selected[i] + 1).padStart(3, "0")}-页.pdf`, await output.save());
    progress(8 + Math.round(((i + 1) / selected.length) * 72), `正在拆分第 ${i + 1} / ${selected.length} 页`);
    await yieldToBrowser();
  }
  const blob = await zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
    (meta) => progress(82 + Math.round(meta.percent * 0.15), "正在打包文件"),
  );
  return makeResult(blob, "application/zip", `${baseName(files[0].name)}-拆分.zip`, `已拆分 ${selected.length} 页并打包。`, "拆分结果");
}

export async function organize({ files, pageOrder, progress }) {
  const { doc } = await loadPdf(files[0]);
  const kept = (pageOrder || []).filter((item) => !item.removed);
  if (!kept.length) throw new Error("所有页面都被移除了，请至少保留一页。");
  const output = await PDFDocument.create();
  const pages = await output.copyPages(doc, kept.map((item) => item.index));
  pages.forEach((page) => output.addPage(page));
  progress(88, "正在生成新文件");
  const bytes = await output.save({ useObjectStreams: true });
  return makeResult(bytes, "application/pdf", `${baseName(files[0].name)}-已整理.pdf`, `输出 ${kept.length} 页（原始 ${doc.getPageCount()} 页）。`, "整理结果");
}

export async function rotate({ files, value, progress }) {
  const { doc } = await loadPdf(files[0]);
  const selected = parsePageRange(value("rotate-pages"), doc.getPageCount());
  const angle = Number(value("rotate-angle"));
  selected.forEach((index, order) => {
    const page = doc.getPage(index);
    page.setRotation(degrees((page.getRotation().angle + angle + 360) % 360));
    progress(12 + Math.round(((order + 1) / selected.length) * 74), `正在旋转第 ${index + 1} 页`);
  });
  const bytes = await doc.save({ useObjectStreams: true });
  return makeResult(bytes, "application/pdf", `${baseName(files[0].name)}-已旋转.pdf`, `已旋转 ${selected.length} 页。`, "旋转结果");
}

export async function nup({ files, value, progress }) {
  const { doc } = await loadPdf(files[0]);
  const [cols, rows] = value("nup-layout").split("x").map(Number);
  const perSheet = cols * rows;
  const preset = pagePreset(value("nup-paper"));
  const [pw, ph] = value("nup-orientation") === "landscape" ? [preset[1], preset[0]] : preset;
  const gap = Number(value("nup-gap")) || 0;
  const total = doc.getPageCount();
  const output = await PDFDocument.create();
  const sheets = Math.ceil(total / perSheet);

  for (let s = 0; s < sheets; s += 1) {
    const sheet = output.addPage([pw, ph]);
    const cellW = (pw - gap * (cols + 1)) / cols;
    const cellH = (ph - gap * (rows + 1)) / rows;
    const slice = [];
    for (let k = 0; k < perSheet; k += 1) {
      const pageIndex = s * perSheet + k;
      if (pageIndex < total) slice.push(pageIndex);
    }
    const embedded = await copyPagesForEmbed(output, doc, slice);
    embedded.forEach((page, i) => {
      const { width: w0, height: h0 } = pageSizeOf(page);
      const scale = Math.min(cellW / w0, cellH / h0);
      const w = w0 * scale;
      const h = h0 * scale;
      const col = i % cols;
      const row = Math.floor(i / cols);
      sheet.drawPage(page, {
        x: gap + col * (cellW + gap) + (cellW - w) / 2,
        y: ph - gap - (row + 1) * cellH - (cellH - h) / 2 + gap,
        width: w,
        height: h,
      });
    });
    progress(10 + Math.round(((s + 1) / sheets) * 78), `正在拼版第 ${s + 1} / ${sheets} 张`);
    await yieldToBrowser();
  }
  const bytes = await output.save({ useObjectStreams: true });
  return makeResult(bytes, "application/pdf", `${baseName(files[0].name)}-${cols}x${rows}拼版.pdf`, `${total} 页合并为 ${sheets} 张，每张 ${perSheet} 页。`, "拼版结果");
}

export async function longImage({ files, value, progress }) {
  const file = files[0];
  const { doc, task } = await openWithPdfJs(file);
  const scale = Number(value("long-scale")) || 1.4;
  const gap = Number(value("long-gap")) || 0;
  const format = value("long-format");
  const selected = parsePageRange(value("long-pages"), doc.numPages);
  guardRasterWorkload(selected.length, "合并为长图");

  const canvases = [];
  for (let i = 0; i < selected.length; i += 1) {
    const page = await doc.getPage(selected[i] + 1);
    canvases.push(await renderPageToCanvas(page, scale));
    progress(6 + Math.round(((i + 1) / selected.length) * 72), `正在渲染第 ${i + 1} / ${selected.length} 页`);
    await yieldToBrowser();
  }
  await task.destroy();

  // 用 reduce 求最大值：Math.max(...arr) 在页数很多时会因参数过多而抛
  // RangeError（超过约 12 万个实参），长文档会触发。
  let width = 0;
  let totalHeight = gap * Math.max(0, canvases.length - 1);
  for (const canvas of canvases) {
    if (canvas.width > width) width = canvas.width;
    totalHeight += canvas.height;
  }
  if (width * totalHeight > 36_000_000) {
    canvases.forEach(releaseCanvas);
    throw new Error("长图尺寸过大，请减少页数或降低清晰度。");
  }
  const sheet = document.createElement("canvas");
  sheet.width = width;
  sheet.height = totalHeight;
  const context = sheet.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, totalHeight);
  let y = 0;
  canvases.forEach((canvas) => {
    context.drawImage(canvas, Math.round((width - canvas.width) / 2), y);
    y += canvas.height + gap;
    releaseCanvas(canvas);
  });
  const blob = await canvasToBlob(sheet, format === "jpg" ? "image/jpeg" : "image/png", format === "jpg" ? 0.9 : undefined);
  releaseCanvas(sheet);
  return makeResult(blob, format === "jpg" ? "image/jpeg" : "image/png", `${baseName(file.name)}-长图.${format}`, `已拼接 ${selected.length} 页。`, "长图");
}

export async function pageSize({ files, value, progress }) {
  const { doc } = await loadPdf(files[0]);
  const [tw, th] = pagePreset(value("size-target"));
  const [width, height] = value("size-orientation") === "landscape" ? [th, tw] : [tw, th];
  const stretch = value("size-mode") === "stretch";
  const total = doc.getPageCount();
  const output = await PDFDocument.create();
  const embedded = await copyPagesForEmbed(output, doc);

  embedded.forEach((page, index) => {
    const { width: w0, height: h0 } = pageSizeOf(page);
    const newPage = output.addPage([width, height]);
    if (stretch) {
      newPage.drawPage(page, { x: 0, y: 0, width, height });
    } else {
      const scale = Math.min(width / w0, height / h0);
      const w = w0 * scale;
      const h = h0 * scale;
      newPage.drawPage(page, { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h });
    }
    progress(8 + Math.round(((index + 1) / embedded.length) * 78), `正在调整第 ${index + 1} / ${embedded.length} 页`);
  });
  const bytes = await output.save({ useObjectStreams: true });
  return makeResult(bytes, "application/pdf", `${baseName(files[0].name)}-已改尺寸.pdf`, `${total} 页已统一为 ${Math.round(width)}×${Math.round(height)} pt。`, "尺寸结果");
}

/* ------------------------------------------------------------------ 编辑 */

export async function watermark({ files, value, progress }) {
  const { doc } = await loadPdf(files[0]);
  const text = value("watermark-text").trim();
  if (!text) throw new Error("请输入水印文字。");
  const blob = await createWatermarkImage(text, Number(value("watermark-angle")), value("watermark-color"));
  const image = await doc.embedPng(await blob.arrayBuffer());
  const opacity = Number(value("watermark-opacity"));
  const scale = Number(value("watermark-scale")) || 1;
  const position = value("watermark-position");
  const pages = doc.getPages();

  pages.forEach((page, index) => {
    const { width, height } = page.getSize();
    const targetW = Math.min(width * 0.72 * scale, 540);
    const targetH = targetW * (image.height / image.width);
    let x = (width - targetW) / 2;
    let y = (height - targetH) / 2;
    if (position === "top") y = height - targetH - height * 0.07;
    if (position === "bottom") y = height * 0.07;
    if (position === "header") {
      x = (width - targetW) / 2;
      y = height - targetH - height * 0.03;
    }
    if (position === "footer") {
      x = (width - targetW) / 2;
      y = height * 0.03;
    }
    if (position === "repeat") {
      const stepX = targetW * 0.72;
      const stepY = targetH * 1.1;
      for (let ry = 0; ry < Math.ceil(height / stepY) + 1; ry += 1) {
        for (let rx = 0; rx < Math.ceil(width / stepX) + 1; rx += 1) {
          page.drawImage(image, {
            x: rx * stepX - targetW * 0.1,
            y: height - (ry + 1) * stepY,
            width: targetW,
            height: targetH,
            opacity: opacity * 0.75,
          });
        }
      }
    } else {
      page.drawImage(image, { x, y, width: targetW, height: targetH, opacity });
    }
    progress(10 + Math.round(((index + 1) / pages.length) * 76), `正在处理第 ${index + 1} / ${pages.length} 页`);
  });
  const bytes = await doc.save({ useObjectStreams: true });
  return makeResult(bytes, "application/pdf", `${baseName(files[0].name)}-水印.pdf`, `已为 ${pages.length} 页添加水印。`, "水印结果");
}

export async function pageNumber({ files, value, progress }) {
  const { doc } = await loadPdf(files[0]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const start = Number(value("num-start")) || 1;
  const format = value("num-format");
  const size = Number(value("num-size")) || 10;
  const margin = Number(value("num-margin")) || 24;
  const total = doc.getPageCount();
  const selected = value("num-only") ? parsePageRange(value("num-pages"), total) : doc.getPageIndices();
  const gray = rgb(0.35, 0.35, 0.35);

  selected.forEach((pageIndex, order) => {
    const page = doc.getPage(pageIndex);
    const { width, height } = page.getSize();
    const number = start + order;
    const label = format === "total" ? `${number} / ${total}` : format === "dash" ? `- ${number} -` : String(number);
    const textWidth = font.widthOfTextAtSize(label, size);
    let x = (width - textWidth) / 2;
    let y = margin;
    if (value("num-position").includes("top")) y = height - margin - size;
    if (value("num-position").includes("left")) x = margin;
    if (value("num-position").includes("right")) x = width - margin - textWidth;
    page.drawText(label, { x, y, size, font, color: gray });
    progress(12 + Math.round(((order + 1) / selected.length) * 74), `正在编号第 ${order + 1} / ${selected.length} 页`);
  });
  const bytes = await doc.save({ useObjectStreams: true });
  return makeResult(bytes, "application/pdf", `${baseName(files[0].name)}-已编页码.pdf`, `已为 ${selected.length} 页添加页码。`, "页码结果");
}

export async function crop({ files, value, progress }) {
  const { doc } = await loadPdf(files[0]);
  const margin = {
    left: Number(value("crop-left")) || 0,
    right: Number(value("crop-right")) || 0,
    top: Number(value("crop-top")) || 0,
    bottom: Number(value("crop-bottom")) || 0,
  };
  const auto = value("crop-auto") === "on";
  const total = doc.getPageCount();
  const selected = parsePageRange(value("crop-pages"), total);
  const output = await PDFDocument.create();
  const embedded = await copyPagesForEmbed(output, doc);
  const partial = selected.length < total;

  selected.forEach((pageIndex, i) => {
    const page = embedded[pageIndex];
    const { width: w0, height: h0 } = pageSizeOf(page);
    const left = auto ? Math.max(margin.left, 18) : margin.left;
    const bottom = auto ? Math.max(margin.bottom, 18) : margin.bottom;
    const right = auto ? Math.min(w0 - margin.right, w0 - 18) : w0 - margin.right;
    const top = auto ? Math.min(h0 - margin.top, h0 - 18) : h0 - margin.top;
    const width = right - left;
    const height = top - bottom;
    // 报错要报原始页码，不是选中列表里的序号，否则用户对着原文找对不上
    if (width < 72 || height < 72) throw new Error(`第 ${pageIndex + 1} 页裁剪后过小，请减少裁剪数值。`);
    const newPage = output.addPage([width, height]);
    newPage.drawPage(page, { x: -left, y: -bottom, width: w0, height: h0 });
    progress(8 + Math.round(((i + 1) / selected.length) * 78), `正在裁剪第 ${i + 1} / ${selected.length} 页`);
  });
  const bytes = await output.save({ useObjectStreams: true });
  const summary = partial
    ? `已裁剪第 ${selected.length} / ${total} 页（未选中的页未处理）。`
    : `${total} 页已裁剪。`;
  return makeResult(bytes, "application/pdf", `${baseName(files[0].name)}-已裁剪.pdf`, summary, "裁剪结果");
}

const RASTER = {
  grayscale: { label: "灰度" },
  blackwhite: { label: "黑白" },
  invert: { label: "反色" },
  background: { label: "背景色" },
};

export async function rasterEdit({ files, value, progress, mode }) {
  const label = RASTER[mode].label;
  const file = files[0];
  const { doc, task } = await openWithPdfJs(file);
  const selected = parsePageRange(value("raster-pages"), doc.numPages);
  guardRasterWorkload(selected.length, label);
  const scale = Math.max(0.8, Math.min(3, Number(value("raster-scale")) || 1.6));
  const quality = Math.max(0.3, Math.min(0.95, Number(value("raster-quality")) || 0.82));
  const threshold = Number(value("bw-threshold")) || 128;
  const [bgR, bgG, bgB] = hexToRgb(value("background-color") || "#f5f1e6");
  const output = await PDFDocument.create();

  for (let i = 0; i < selected.length; i += 1) {
    const pageNumber = selected[i] + 1;
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    let canvas = await renderPageToCanvas(page, scale);
    let context = canvas.getContext("2d");

    if (mode === "background") {
      const layer = document.createElement("canvas");
      layer.width = canvas.width;
      layer.height = canvas.height;
      const layerContext = layer.getContext("2d", { alpha: false });
      layerContext.fillStyle = `rgb(${bgR}, ${bgG}, ${bgB})`;
      layerContext.fillRect(0, 0, layer.width, layer.height);
      layerContext.drawImage(canvas, 0, 0);
      releaseCanvas(canvas);
      canvas = document.createElement("canvas");
      canvas.width = layer.width;
      canvas.height = layer.height;
      context = canvas.getContext("2d");
      context.putImageData(layerContext.getImageData(0, 0, layer.width, layer.height), 0, 0);
      releaseCanvas(layer);
    } else {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const data = image.data;
      if (mode === "grayscale") {
        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          data[i] = gray;
          data[i + 1] = gray;
          data[i + 2] = gray;
        }
      } else if (mode === "blackwhite") {
        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const out = gray >= threshold ? 255 : 0;
          data[i] = out;
          data[i + 1] = out;
          data[i + 2] = out;
        }
      } else {
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 255 - data[i];
          data[i + 1] = 255 - data[i + 1];
          data[i + 2] = 255 - data[i + 2];
        }
      }
      context.putImageData(image, 0, 0);
    }

    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    const embeddedImage = await output.embedJpg(await blob.arrayBuffer());
    const newPage = output.addPage([base.width, base.height]);
    newPage.drawImage(embeddedImage, { x: 0, y: 0, width: base.width, height: base.height });
    releaseCanvas(canvas);
    progress(5 + Math.round(((i + 1) / selected.length) * 86), `正在${label}第 ${i + 1} / ${selected.length} 页`);
    await yieldToBrowser();
  }
  await task.destroy();
  const bytes = await output.save({ useObjectStreams: true });
  // 灰度/黑白/反色属于格式转换而非压缩：矢量转位图后体积变大是正常且预期的，
  // 因此不回退原文件，只在体积膨胀过多时给出提醒。
  const partial = selected.length < doc.numPages;
  let summary = `${selected.length} 页已完成${label}处理。`;
  if (partial) summary += `（原文件共 ${doc.numPages} 页）`;
  if (mode !== "background" && file.size > 0 && bytes.byteLength > file.size * 1.8) {
    summary += ` 提示：位图体积约为原文件的 ${(bytes.byteLength / file.size).toFixed(1)} 倍，可调低渲染倍率减小体积。`;
  }
  return makeResult(bytes, "application/pdf", `${baseName(file.name)}-${label}.pdf`, summary, `${label}结果`);
}

function hexToRgb(hex) {
  const raw = String(hex).replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return [parseInt(full.slice(0, 2), 16) || 0, parseInt(full.slice(2, 4), 16) || 0, parseInt(full.slice(4, 6), 16) || 0];
}

/* -------------------------------------------------------------- 格式转换 */

export async function pdfToImage({ files, value, progress }) {
  const file = files[0];
  const { doc, task } = await openWithPdfJs(file);
  const selected = parsePageRange(value("image-pages"), doc.numPages);
  guardRasterWorkload(selected.length, "PDF 转图片");
  const format = value("image-format");
  const scale = Number(value("image-scale"));
  const mime = format === "jpg" ? "image/jpeg" : "image/png";
  const zip = new JSZip();
  let single = null;

  for (let i = 0; i < selected.length; i += 1) {
    const pageNumber = selected[i] + 1;
    const canvas = await renderPageToCanvas(await doc.getPage(pageNumber), scale);
    const blob = await canvasToBlob(canvas, mime, format === "jpg" ? 0.92 : undefined);
    if (selected.length === 1) single = blob;
    else zip.file(`第-${String(pageNumber).padStart(3, "0")}-页.${format}`, blob);
    releaseCanvas(canvas);
    progress(8 + Math.round(((i + 1) / selected.length) * 78), `正在转换第 ${i + 1} / ${selected.length} 页`);
    // 让浏览器有机会回收上一页的中间产物，避免大文件堆占用持续攀升
    await yieldToBrowser();
  }
  await task.destroy();

  if (single) {
    return makeResult(single, mime, `${baseName(file.name)}-第${selected[0] + 1}页.${format}`, "图片已生成。", "图片");
  }
  const blob = await zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
    (meta) => progress(86 + Math.round(meta.percent * 0.12), "正在打包图片"),
  );
  return makeResult(blob, "application/zip", `${baseName(file.name)}-图片.zip`, `已转换 ${selected.length} 页并打包。`, "图片包");
}

export async function imageToPdf({ files, value, progress }) {
  const output = await PDFDocument.create();
  const sizeMode = value("page-size");
  const margin = Number(value("page-margin"));
  const orientation = value("page-orientation");

  for (let i = 0; i < files.length; i += 1) {
    const image = await normalizeImageFile(files[i]);
    const embedded = image.mime === "image/jpeg" ? await output.embedJpg(image.bytes) : await output.embedPng(image.bytes);
    let pageWidth;
    let pageHeight;
    if (sizeMode === "a4") {
      const landscape = orientation === "auto" ? embedded.width > embedded.height : orientation === "landscape";
      [pageWidth, pageHeight] = landscape ? [841.89, 595.28] : [595.28, 841.89];
    } else {
      const fit = Math.min(1, 1600 / Math.max(embedded.width, embedded.height));
      pageWidth = Math.max(embedded.width * 0.75 * fit + margin * 2, 72);
      pageHeight = Math.max(embedded.height * 0.75 * fit + margin * 2, 72);
    }
    const page = output.addPage([pageWidth, pageHeight]);
    const scale = Math.min((pageWidth - margin * 2) / embedded.width, (pageHeight - margin * 2) / embedded.height);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    page.drawImage(embedded, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
    progress(8 + Math.round(((i + 1) / files.length) * 78), `正在写入第 ${i + 1} / ${files.length} 张图片`);
    await yieldToBrowser();
  }
  const bytes = await output.save({ useObjectStreams: true });
  return makeResult(bytes, "application/pdf", `轻页-图片集-${dateStamp()}.pdf`, `已将 ${files.length} 张图片生成 PDF。`, "PDF 结果");
}

export async function extractImage({ files, value, progress }) {
  const file = files[0];
  const { doc, task } = await openWithPdfJs(file);
  const selected = parsePageRange(value("extract-image-pages"), doc.numPages);
  const minSize = Number(value("extract-min-size")) || 80;
  const zip = new JSZip();
  let count = 0;

  for (let i = 0; i < selected.length; i += 1) {
    const pageNumber = selected[i] + 1;
    const page = await doc.getPage(pageNumber);
    const images = await extractPageImages(page);
    for (const [order, image] of images.entries()) {
      if (!image.width || !image.height) continue;
      if (image.width < minSize || image.height < minSize) continue;
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (image.bitmap) {
        context.drawImage(image.bitmap, 0, 0);
        image.bitmap.close?.();
      } else if (image.data) {
        const target = context.createImageData(image.width, image.height);
        const src = image.data;
        if (src.length === target.data.length) {
          target.data.set(src);
        } else {
          for (let p = 0; p < target.data.length; p += 4) {
            target.data[p] = src[p] ?? 255;
            target.data[p + 1] = src[p + 1] ?? 255;
            target.data[p + 2] = src[p + 2] ?? 255;
            target.data[p + 3] = src[p + 3] ?? 255;
          }
        }
        context.putImageData(target, 0, 0);
      } else {
        releaseCanvas(canvas);
        continue;
      }
      // JSZip 不接受 canvas，必须先转成 Blob
      zip.file(`p${String(pageNumber).padStart(3, "0")}-${String(order + 1).padStart(2, "0")}.png`, await canvasToBlob(canvas, "image/png"));
      count += 1;
      releaseCanvas(canvas);
    }
    progress(8 + Math.round(((i + 1) / selected.length) * 80), `正在扫描第 ${i + 1} / ${selected.length} 页`);
    await yieldToBrowser();
  }
  await task.destroy();

  if (!count) throw new Error("没有找到符合条件的内嵌图片，可尝试降低最小尺寸限制。");
  const blob = await zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
    (meta) => progress(90 + Math.round(meta.percent * 0.09), "正在打包图片"),
  );
  return makeResult(blob, "application/zip", `${baseName(file.name)}-内嵌图片.zip`, `共提取 ${count} 张图片。`, "图片包");
}

export async function extractText({ files, value, progress }) {
  const file = files[0];
  const { doc, task } = await openWithPdfJs(file);
  const selected = parsePageRange(value("text-pages"), doc.numPages);
  const parts = [];
  let chars = 0;

  for (let i = 0; i < selected.length; i += 1) {
    const pageNumber = selected[i] + 1;
    const content = await (await doc.getPage(pageNumber)).getTextContent();
    const text = content.items
      .map((item) => item.str + (item.hasEOL ? "\n" : ""))
      .join("")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    parts.push(`───── 第 ${pageNumber} 页 ─────\n${text || "（本页无可提取文字）"}`);
    chars += text.length;
    progress(8 + Math.round(((i + 1) / selected.length) * 84), `正在提取第 ${i + 1} / ${selected.length} 页`);
    await yieldToBrowser();
  }
  await task.destroy();

  if (!chars) throw new Error("没有提取到文字，这个 PDF 可能是扫描件，请改用 OCR 识别。");
  const body = parts.join("\n\n");
  if (value("text-format") === "md") {
    return makeResult(`# ${baseName(file.name)}\n\n${body}`, "text/markdown", `${baseName(file.name)}.md`, `已提取 ${chars} 个字符。`, "Markdown");
  }
  return makeResult(body, "text/plain", `${baseName(file.name)}.txt`, `已提取 ${chars} 个字符。`, "文本");
}

/* -------------------------------------------------------------- 安全优化 */

export async function compress({ files, value, progress }) {
  const presets = {
    strong: { maxWidth: 1100, quality: 0.5, label: "强压缩" },
    balanced: { maxWidth: 1600, quality: 0.68, label: "均衡" },
    clear: { maxWidth: 2200, quality: 0.82, label: "清晰" },
  };
  const preset = presets[value("compress-level")];
  const file = files[0];
  const { doc, task } = await openWithPdfJs(file);
  const selected = parsePageRange(value("compress-pages"), doc.numPages);
  guardRasterWorkload(selected.length, "压缩 PDF");
  const output = await PDFDocument.create();

  for (let i = 0; i < selected.length; i += 1) {
    const pageNumber = selected[i] + 1;
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const canvas = await renderPageToCanvas(page, Math.max(1, Math.min(3, preset.maxWidth / base.width)));
    const image = await output.embedJpg(await (await canvasToBlob(canvas, "image/jpeg", preset.quality)).arrayBuffer());
    const newPage = output.addPage([base.width, base.height]);
    newPage.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
    releaseCanvas(canvas);
    progress(5 + Math.round(((i + 1) / selected.length) * 86), `正在压缩第 ${i + 1} / ${selected.length} 页`);
    await yieldToBrowser();
  }
  await task.destroy();
  const bytes = await output.save({ useObjectStreams: true });
  if (selected.length < doc.numPages) {
    // 只处理了部分页面，体积必然比原文件小，不适用"压不动就回退"的判断
    const suffix = selected.length < doc.numPages ? `已压缩第 ${selected.length} / ${doc.numPages} 页` : "";
    return makeResult(
      bytes,
      "application/pdf",
      `${baseName(file.name)}-已压缩.pdf`,
      `${suffix}，${(bytes.length / 1024).toFixed(0)} KB（原文件 ${(file.size / 1024).toFixed(0)} KB）。`,
      "压缩结果",
    );
  }
  if (bytes.byteLength >= file.size) {
    return makeResult(file, "application/pdf", `${baseName(file.name)}-原文件.pdf`, "未找到可安全缩小的空间，已返回原文件副本。");
  }
  return makeResult(
    bytes,
    "application/pdf",
    `${baseName(file.name)}-压缩.pdf`,
    `${preset.label}完成，体积约减小 ${Math.round((1 - bytes.byteLength / file.size) * 100)}%。`,
    "压缩结果",
  );
}

function permissionSet(value) {
  const on = (id) => value(id) === "on";
  const allowModify = on("perm-modify");
  return {
    printing: on("perm-printing") ? "highResolution" : "none",
    modifying: allowModify,
    copying: on("perm-copy"),
    annotating: on("perm-annotate"),
    contentAccessibility: true,
    documentAssembly: allowModify,
  };
}

export async function encrypt({ files, value, progress }) {
  const { doc } = await loadPdf(files[0]);
  const password = value("encrypt-password");
  if (!password || password.length < 4) throw new Error("请设置至少 4 位的打开密码。");
  doc.encrypt({
    userPassword: password,
    ownerPassword: value("encrypt-owner") || `${password}-owner`,
    permissions: permissionSet(value),
  });
  progress(90, "正在加密");
  const bytes = await doc.save({ useObjectStreams: true });
  return makeResult(bytes, "application/pdf", `${baseName(files[0].name)}-已加密.pdf`, "已使用 AES-256 加密，请牢记密码。", "加密结果");
}

export async function permissions({ files, value, progress }) {
  const file = files[0];
  const { doc } = await loadPdf(file, value("perm-source-password"));
  doc.encrypt({
    userPassword: "",
    ownerPassword: value("perm-password") || "lightpdf-owner",
    permissions: permissionSet(value),
  });
  progress(90, "正在应用权限");
  const bytes = await doc.save({ useObjectStreams: true });
  return makeResult(bytes, "application/pdf", `${baseName(file.name)}-权限已设置.pdf`, "读者无需密码即可打开，但受限操作。", "权限结果");
}

export async function decrypt({ files, value, progress }) {
  const file = files[0];
  const probe = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { ignoreEncryption: true, updateMetadata: false });
  if (!probe.isEncrypted) {
    return makeResult(file, "application/pdf", `${baseName(file.name)}-原文件.pdf`, "这个 PDF 本来就没有加密，无需处理。");
  }
  const password = value("decrypt-password");
  if (!password) throw new Error("请输入该 PDF 的打开密码。");
  const { doc } = await loadPdf(file, password);
  const output = await PDFDocument.create();
  const pages = await output.copyPages(doc, doc.getPageIndices());
  progress(85, "正在生成无密码副本");
  pages.forEach((page) => output.addPage(page));
  const bytes = await output.save({ useObjectStreams: true });
  return makeResult(bytes, "application/pdf", `${baseName(file.name)}-已解密.pdf`, `已输出 ${pages.length} 页的无密码副本。`, "解密结果");
}

/**
 * 从 PDF 文件头读取版本号（形如 "%PDF-1.7"）。
 * @cantoo/pdf-lib 未暴露版本 getter，因此直接解析原始字节。
 */
async function pdfVersionOf(file) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const signature = String.fromCharCode(...head);
  const match = signature.match(/^%PDF-(\d+\.\d+)/);
  return match ? match[1] : "未知";
}

/**
 * 格式化关键词。
 * @cantoo/pdf-lib 的 getKeywords() 返回空格分隔的字符串而非数组，
 * 但不同版本/文件也可能给数组，这里两种都兼容。
 */
function formatKeywords(raw) {
  if (!raw) return "";
  if (Array.isArray(raw)) return raw.filter(Boolean).join("、");
  return String(raw).trim();
}

export async function metadata({ files, value, progress }) {
  const file = files[0];
  const { doc } = await loadPdf(file, value("meta-password"));

  if (value("meta-action") === "view") {
    const version = await pdfVersionOf(file);
    const info = [
      ["标题", doc.getTitle()],
      ["作者", doc.getAuthor()],
      ["主题", doc.getSubject()],
      ["关键词", formatKeywords(doc.getKeywords())],
      ["创建程序", doc.getCreator()],
      ["PDF 生成器", doc.getProducer()],
      ["创建时间", formatDate(doc.getCreationDate())],
      ["修改时间", formatDate(doc.getModificationDate())],
      ["页数", String(doc.getPageCount())],
      ["加密状态", doc.isEncrypted ? "已加密" : "未加密"],
      ["PDF 版本", version],
    ];
    const rows = info
      .map(([key, val]) => `<div class="meta-row"><span>${key}</span><b>${escapeText(val || "（空）")}</b></div>`)
      .join("");
    progress(100, "读取完成");
    return { inline: `<div class="meta-view">${rows}</div>`, filename: null, summary: null };
  }

  if (value("meta-action") === "clear") {
    doc.setTitle("");
    doc.setAuthor("");
    doc.setSubject("");
    doc.setKeywords([]);
  } else {
    const title = value("meta-title");
    if (title) doc.setTitle(title);
    const author = value("meta-author");
    if (author) doc.setAuthor(author);
    const subject = value("meta-subject");
    if (subject) doc.setSubject(subject);
    const keywords = value("meta-keywords");
    if (keywords) doc.setKeywords(keywords.split(/[,，\s]+/).filter(Boolean));
  }
  doc.setProducer("轻页 PDF");
  doc.setCreator("轻页 PDF");
  progress(90, "正在写入元数据");
  const bytes = await doc.save({ useObjectStreams: true });
  const verb = value("meta-action") === "clear" ? "已清除" : "已更新";
  return makeResult(bytes, "application/pdf", `${baseName(file.name)}-${verb}元数据.pdf`, `${verb}文档信息。`, "元数据结果");
}

function formatDate(date) {
  if (!date || Number.isNaN(new Date(date).getTime())) return "";
  return new Date(date).toISOString().slice(0, 19).replace("T", " ");
}

function escapeText(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* -------------------------------------------------------------- 清理修复 */

export async function deleteBlank({ files, value, progress }) {
  const file = files[0];
  const { doc: source, task } = await openWithPdfJs(file);
  const keep = [];
  for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
    const page = await source.getPage(pageNumber);
    if (!(await isBlankPage(page))) keep.push(pageNumber - 1);
    progress(6 + Math.round((pageNumber / source.numPages) * 74), `正在检测第 ${pageNumber} / ${source.numPages} 页`);
    await yieldToBrowser();
  }
  await task.destroy();

  if (!keep.length) throw new Error("所有页面都被判定为空白页，请确认文件内容。");
  if (keep.length === source.numPages) {
    return makeResult(file, "application/pdf", `${baseName(file.name)}-原文件.pdf`, "没有检测到空白页，已返回原文件。");
  }
  const { doc } = await loadPdf(file, value("blank-password"));
  const output = await PDFDocument.create();
  (await output.copyPages(doc, keep)).forEach((page) => output.addPage(page));
  const bytes = await output.save({ useObjectStreams: true });
  return makeResult(
    bytes,
    "application/pdf",
    `${baseName(file.name)}-已清理.pdf`,
    `已删除 ${source.numPages - keep.length} 个空白页，保留 ${keep.length} 页。`,
    "清理结果",
  );
}

export async function zip({ files, progress }) {
  const archive = new JSZip();
  for (let i = 0; i < files.length; i += 1) {
    archive.file(files[i].name, await files[i].arrayBuffer());
    progress(10 + Math.round(((i + 1) / files.length) * 70), `正在打包第 ${i + 1} / ${files.length} 个文件`);
    await yieldToBrowser();
  }
  const blob = await archive.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
    (meta) => progress(82 + Math.round(meta.percent * 0.16), "正在生成压缩包"),
  );
  return makeResult(blob, "application/zip", `轻页-打包-${dateStamp()}.zip`, `已打包 ${files.length} 个文件。`, "压缩包");
}

/**
 * tesseract 的英文状态 → 用户能看懂的中文提示。
 * 状态串来自引擎内部，值不稳定，所以每个都带兜底文案。
 */
const OCR_STATUS = {
  "loading tesseract core": "正在加载识别引擎",
  "initializing tesseract": "正在初始化引擎",
  "initialized tesseract": "引擎初始化完成",
  "loading language traineddata": "正在加载文字模型",
  "loaded language traineddata": "文字模型加载完成",
  "initializing api": "正在准备识别",
  "initialized api": "准备完成",
  "recognizing text": "正在识别文字",
};

export async function ocr({ files, value, progress }) {
  const file = files[0];
  const { doc: source, task } = await openWithPdfJs(file);
  const selected = parsePageRange(value("ocr-pages"), source.numPages);
  guardRasterWorkload(selected.length, "OCR 识别");
  const scale = Math.max(1.2, Math.min(3, Number(value("ocr-scale")) || 2));
  const output = await PDFDocument.create();
  const textParts = [];

  // 引擎首次使用要加载约 3.7MB 的 wasm 内核与约 4.4MB 的语言模型，
  // 全部同源。分两段给进度，避免用户盯着 4% 不动以为卡死。
  progress(3, "正在加载识别引擎与文字模型（约 8MB，仅首次需要）");
  const worker = await loadOcr(value("ocr-language"), (status) => {
    const text = OCR_STATUS[status];
    if (text) progress(8, text);
  });
  try {
    for (let i = 0; i < selected.length; i += 1) {
      const pageNumber = selected[i] + 1;
      const page = await source.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const canvas = await renderPageToCanvas(page, scale);

      const png = await canvasToBlob(canvas, "image/png");
      releaseCanvas(canvas);
      const { data } = await worker.recognize(png);
      const text = String(data?.text || "").trim();
      textParts.push(`第 ${pageNumber} 页：\n${text || "（未识别到文字）"}`);

      const jpeg = await (async () => {
        const again = await renderPageToCanvas(page, scale);
        const blob = await canvasToBlob(again, "image/jpeg", 0.85);
        releaseCanvas(again);
        return blob;
      })();
      const image = await output.embedJpg(await jpeg.arrayBuffer());
      const newPage = output.addPage([base.width, base.height]);
      newPage.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });

      progress(10 + Math.round(((i + 1) / selected.length) * 80), `正在识别第 ${i + 1} / ${selected.length} 页`);
      await yieldToBrowser();
    }
  } finally {
    await disposeOcr();
    await task.destroy();
  }

  const archive = new JSZip();
  archive.file(`${baseName(file.name)}-已识别.pdf`, await output.save({ useObjectStreams: true }));
  archive.file(`${baseName(file.name)}-识别文本.txt`, textParts.join("\n\n"));
  const blob = await archive.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
    (meta) => progress(92 + Math.round(meta.percent * 0.07), "正在打包结果"),
  );
  return makeResult(blob, "application/zip", `${baseName(file.name)}-OCR结果.zip`, `已识别 ${selected.length} 页，包含 PDF 与文本两个文件。`, "OCR 结果");
}
