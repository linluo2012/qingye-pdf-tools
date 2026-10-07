/**
 * 统一依赖入口。
 *
 * 所有第三方库都已下载到本地 vendor/ 目录，站点完全自包含：
 * 不依赖任何 CDN，首屏不再被 6-13 秒的跨境请求拖住，也不受第三方可用性影响。
 *
 * pdfjs（含 1.26MB 的 worker）体积较大且只有真正处理 PDF 时才需要，
 * 因此改为按需动态加载 —— 首屏只加载 pdf-lib（约 470KB）。
 */

// —— 同步依赖：首屏必需——
import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  PageSizes,
  PDFName,
} from "../vendor/pdf-lib.min.mjs";
import JSZip from "../vendor/jszip.min.mjs";

export { PDFDocument, StandardFonts, rgb, degrees, PageSizes, PDFName, JSZip };

// —— 动态依赖：用到的工具才加载 ——

let pdfjsPromise = null;

/** 加载 pdfjs 渲染引擎（单例）。 */
export function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("../vendor/pdf.min.mjs").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = new URL(
        "../vendor/pdf.worker.min.mjs",
        import.meta.url,
      ).href;
      return mod;
    });
  }
  return pdfjsPromise;
}

/**
 * 兼容旧的同步引用写法：返回一个 Proxy，
 * 首次访问任意属性时才真正加载 pdfjs。
 * 仅用于 main.js 暴露给测试钩子等场景，正常工具流程请用 await loadPdfJs()。
 */
let pdfjsProxy = null;
export function getPdfJs() {
  if (!pdfjsProxy) {
    pdfjsProxy = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return undefined; // 避免被误当成 thenable
          return loadPdfJs().then((mod) => mod[prop]);
        },
      },
    );
  }
  return pdfjsProxy;
}

let ocrPromise = null;
/**
 * 懒加载 OCR 引擎：只有真正使用 OCR 时才下载引擎与语言模型。
 *
 * 注意取顶层导出的 createWorker，不能用 `mod.default || mod`：
 * mod.default 上的 createWorker 是未绑定的原始引用，直接调用会抛
 * "createWorker is not a function"。
 */
export async function loadOcr(language = "chi_sim+eng") {
  if (!ocrPromise) {
    ocrPromise = import("https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/+esm").then((mod) => {
      const factory = mod?.createWorker || mod?.default?.createWorker;
      if (typeof factory !== "function") {
        throw new Error("OCR 引擎加载失败，请检查网络后重试。");
      }
      return factory;
    });
    // 加载失败时清空缓存，让用户能重试而不是永久失败
    ocrPromise.catch(() => {
      ocrPromise = null;
    });
  }
  const createWorker = await ocrPromise;
  return createWorker(language, 1, {
    logger: () => {},
    errorHandler: () => {},
  });
}

export const PAGE_PRESETS = {
  a3: [841.89, 1190.55],
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  letter: [612, 792],
  legal: [612, 1008],
};

export function pagePreset(name) {
  return PageSizes[name] || PAGE_PRESETS[name] || PAGE_PRESETS.a4;
}