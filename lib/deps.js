/**
 * 统一依赖入口。
 *
 * 所有第三方库都已下载到本地 vendor/ 目录，站点完全自包含：
 * 不依赖任何 CDN，首屏不再被 6-13 秒的跨境请求拖住，也不受第三方可用性影响。
 *
 * pdfjs（含 1.26MB 的 worker）体积较大且只有真正处理 PDF 时才需要，
 * 因此改为按需动态加载 —— 首屏只加载 pdf-lib（约 470KB）。
 *
 * OCR 的引擎、wasm 与语言模型同样本地化在 vendor/ocr/，但因为体量大
 * （wasm 约 4.4MB、语言模型合计约 30MB），只在用户真的用 OCR 时才加载。
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

let ocrFactoryPromise = null;
let ocrWorkerPromise = null;
let ocrLanguage = "";

/**
 * OCR 相关资源全部本地化到 vendor/ocr/，与其他依赖保持一致。
 *
 * 之前引擎与语言模型走 jsdelivr CDN，线上实测会 ERR_TIMED_OUT，
 * OCR 工具对用户等于完全不可用。现在改成同源静态资源：
 * 只受本站服务器速度影响，不再受第三方可用性影响。
 *
 * 注：vendor/ocr 下的 tesseract-core-*.wasm.js 做过一处小改动——
 * 把 Emscripten 的 printErr 换成过滤版，丢掉 LSTM-only 内核对一批
 * 已废弃旧参数打的 "Warning: Parameter not found" 噪音（每次 6-8 条）。
 * 其余内容与上游 tesseract.js-core@7.0.0 完全一致。
 */
const ocrAsset = (name) => new URL(`../vendor/ocr/${name}`, import.meta.url).href;

/** 本地可用的语言包，与 registry 里ocr-language 的选项保持一致。 */
const OCR_LANGUAGES = {
  chi_sim: "chi_sim",
  eng: "eng",
  "chi_sim+eng": "chi_sim+eng",
};

/**
 * 懒加载 OCR 引擎：只有真正使用 OCR 时才下载引擎与语言模型。
 *
 * 注意取顶层导出的 createWorker，不能用 `mod.default || mod`：
 * mod.default 上的 createWorker 是未绑定的原始引用，直接调用会抛
 * "createWorker is not a function"。
 */
async function loadOcrFactory() {
  if (!ocrFactoryPromise) {
    ocrFactoryPromise = import("../vendor/ocr/tesseract.esm.min.js").then((mod) => {
      const factory = mod?.createWorker || mod?.default?.createWorker;
      if (typeof factory !== "function") {
        throw new Error("OCR 引擎加载失败，请刷新页面后重试。");
      }
      return factory;
    });
    // 加载失败时清空缓存，让用户能重试而不是永久失败
    ocrFactoryPromise.catch(() => {
      ocrFactoryPromise = null;
    });
  }
  return ocrFactoryPromise;
}

/**
 * 取得 OCR worker，重复调用复用同一个实例。
 *
 * 每次都新建 worker 会在第二次调用时触发 worker脚本的跨域加载失败
 * （"Failed to execute 'importScripts'"），因为模型与 wasm 已被缓存、
 * 而 worker 的 importScripts 再次发起跨域请求。复用即可避免。
 *
 * onProgress 会收到 tesseract 的状态字符串，用来驱动界面进度条。
 */
export async function loadOcr(language = "chi_sim+eng", onProgress = () => {}) {
  if (ocrWorkerPromise && ocrLanguage === language) return ocrWorkerPromise;
  // 语言不同则先释放旧 worker
  if (ocrWorkerPromise && ocrLanguage !== language) {
    ocrWorkerPromise.then((worker) => worker.terminate?.()).catch(() => {});
    ocrWorkerPromise = null;
  }
  const lang = OCR_LANGUAGES[language] || "chi_sim+eng";
  ocrLanguage = lang;
  const createWorker = await loadOcrFactory();
  ocrWorkerPromise = createWorker(lang, 1, {
    // 三类资源都指向本地：wasm 内核约 3.7MB、语言模型合计约 4.4MB，
    // 都在本站同源目录下，不会有跨域失败。
    workerPath: ocrAsset("worker.min.js"),
    corePath: ocrAsset(""),
    langPath: ocrAsset(""),
    logger: (m) => {
      if (m && typeof m.status === "string") onProgress(m.status, m.progress || 0);
    },
    errorHandler: () => {},
  }).catch((error) => {
    ocrWorkerPromise = null;
    // wasm 内核缺失或加载中断时，引擎抛的是 NetworkError / "Failed to load TesseractCore"，
    // 对用户毫无意义。换成能指导下一步的说法。
    const raw = String(error?.message || error || "");
    if (/TesseractCore|importScripts|NetworkError|Failed to fetch|loading tesseract core/i.test(raw)) {
      throw new Error(
        "识别引擎加载失败，资源可能未完整下载。请刷新页面后重试；若仍失败，请检查网络后改用其他工具。",
      );
    }
    throw error;
  });
  return ocrWorkerPromise;
}

/** 释放 OCR worker（识别完成后调用，避免占用内存）。 */
export async function disposeOcr() {
  const pending = ocrWorkerPromise;
  ocrWorkerPromise = null;
  ocrLanguage = "";
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate?.();
  } catch {
    /* 已经失败或被终止，无需处理 */
  }
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