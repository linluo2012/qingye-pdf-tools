/**
 * i18n.js — 多语言核心
 *
 * 设计要点
 *
 * 1. **中文原文即 key。** 词典就是 `{"合并 PDF": "Merge PDF"}` 这样的映射，
 *    不需要额外发明几百个 key 名，改文案时一眼能看懂对应关系。
 *
 * 2. **不碰 HTML。** 翻译靠遍历文本节点、拿原文去词典里查。
 *    index.html 和 registry.js 里的选项表单都是普通 DOM，无需加任何标记，
 *    以后新增工具也不用记得补翻译标记。
 *
 * 3. **按条回退。** 词典里没有的原文保持原样。所以新语言可以一批批补齐，
 *    不会因为缺词把页面开出窟窿，也不会出现空白。
 *
 * 4. **中文不加载词典。** 中文原文就写在 HTML 里，切回中文时从缓存还原，
 *    永远不会有「翻译错了的中文」。
 *
 * 5. 语言识别顺序：用户手选（localStorage）→ IP 归属地 → 浏览器语言 → 中文。
 *    IP 归属地走 Cloudflare 的 /cdn-cgi/trace，同源、不引第三方，
 *    和「不上传、不请求外部服务」的定位一致。
 */

export const LANGS = [
  { code: "zh-CN", label: "简体中文", html: "zh-CN" },
  { code: "zh-TW", label: "繁體中文", html: "zh-TW" },
  { code: "en", label: "English", html: "en" },
  { code: "ja", label: "日本語", html: "ja" },
  { code: "ko", label: "한국어", html: "ko" },
  { code: "es", label: "Español", html: "es" },
  { code: "fr", label: "Français", html: "fr" },
  { code: "de", label: "Deutsch", html: "de" },
];

export const DEFAULT_LANG = "zh-CN";

/**
 * 国家/地区 → 当地通用语言。
 * 这里映射的是**语言习惯**，不是国家归属；中国香港、中国澳门、中国台湾地区
 * 按当地通用书写习惯归到繁體中文。查不到就交给浏览器语言兜底。
 */
const COUNTRY_LANG = {
  CN: "zh-CN", SG: "zh-CN",
  TW: "zh-TW", HK: "zh-TW", MO: "zh-TW",
  JP: "ja",
  KR: "ko",
  US: "en", GB: "en", CA: "en", AU: "en", NZ: "en", IE: "en",
  IN: "en", PH: "en", MY: "en", ZA: "en", NG: "en", KE: "en",
  PK: "en", BD: "en", LK: "en", GH: "en", TZ: "en", UG: "en",
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es",
  UY: "es", VE: "es", EC: "es", GT: "es", CU: "es", BO: "es",
  DO: "es", HN: "es", PY: "es", SV: "es", NI: "es", CR: "es", PA: "es",
  FR: "fr", BE: "fr", LU: "fr", MC: "fr",
  SN: "fr", CI: "fr", CM: "fr", ML: "fr", BF: "fr", NE: "fr",
  MG: "fr", CD: "fr", CG: "fr", GA: "fr", HT: "fr",
  DE: "de", AT: "de", CH: "de", LI: "de",
};

/** navigator.language 的前缀 → 支持的语言。 */
const LANG_PREFIX = {
  zh: "zh-CN", en: "en", ja: "ja", ko: "ko", es: "es", fr: "fr", de: "de",
};

const STORAGE_KEY = "qingye-lang";

const state = { lang: DEFAULT_LANG, dict: {} };

/** 文本节点 → 中文原文。切回中文和二次切换都靠它。 */
const originals = new WeakMap();
/** 元素属性 → 中文原文，键是 "attr:value" 太脆，直接存 per-element 的 Map。 */
const attrOriginals = new WeakMap();

export function isSupported(code) {
  return LANGS.some((item) => item.code === code);
}

export function currentLang() {
  return state.lang;
}

/* ------------------------------------------------------------ 语言识别 */

/**
 * 读 Cloudflare 的 /cdn-cgi/trace 拿 IP 归属地。
 * Cloudflare 在任何代理域名上都提供这个同源端点，返回 "loc=JP\n..." 纯文本。
 * 拿不到（非 Cloudflare 环境、被拦、超时）就返回 null 交给下一级，
 * 识别失败绝不能拖慢或卡住页面。
 */
export async function detectCountry() {
  try {
    const res = await fetch("/cdn-cgi/trace", { cache: "no-store" });
    if (!res.ok) return null;
    const text = await res.text();
    const match = /(?:^|\n)loc=([A-Za-z]{2})\b/.exec(text);
    return match ? match[1].toUpperCase() : null;
  } catch {
    return null;
  }
}

/** 浏览器语言（zh-TW、en-US、ja…）→ 支持的语种。 */
export function browserLanguage() {
  const raw = (navigator.languages && navigator.languages[0]) || navigator.language || "";
  const lower = raw.toLowerCase();
  if (/^zh-(tw|hk|mo)/.test(lower)) return "zh-TW";
  if (/^zh/.test(lower)) return "zh-CN";
  return LANG_PREFIX[lower.split("-")[0]] || null;
}

export async function resolveLanguage() {
  const saved = readStored();
  if (saved) return saved;
  const country = await detectCountry();
  if (country && COUNTRY_LANG[country]) return COUNTRY_LANG[country];
  return browserLanguage() || DEFAULT_LANG;
}

function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isSupported(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberLanguage(code) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* 隐私模式下可能不可写，忽略 */
  }
}

/* ------------------------------------------------------------ 词典 */

async function loadDict(code) {
  try {
    const mod = await import(`./i18n/${code}.js`);
    state.dict = mod.default || {};
  } catch {
    // 词典挂了也不能让页面变空白：空字典 = 全部回退中文
    state.dict = {};
  }
}

/** 查一条。没收录返回 undefined，调用方自己决定要不要用原文。 */
export function t(text) {
  const value = state.dict[text];
  return typeof value === "string" && value ? value : undefined;
}

/** 查一条，没收录就用原文。给 main.js / tools.js 的运行时字符串用。 */
export function tOr(text) {
  const value = t(text);
  return value === undefined ? text : value;
}

/**
 * 带占位符的整句翻译，例如：
 *   tpl("已合并 {files} 个文件，共 {pages} 页。", { files: 3, pages: 10 })
 *
 * 为什么要这个：像「已合并 3 个文件」这种由模板拼出来的句子，
 * 整句带数字，没法按原文精确匹配。得把数字抽成占位符，
 * 让词典存「已合并 {files} 个文件」，翻译时再填回去。
 * 不同语言的语序不一样，所以必须整句翻译，不能拆成几段硬拼。
 *
 * 注意：tpl 返回的是**当前语言的成品字符串**。它适合转瞬即逝的提示
 * （进度、toast），不适合塞进会被反复翻译的 DOM —— 那样译文会被当成
 * 原文缓存下来，切语言时翻不动。要进 DOM 请用 src()。
 */
export function tpl(pattern, vars = {}) {
  return fill(tOr(pattern), vars);
}

/**
 * 登记一句「模板 + 变量」，交给渲染时再翻译。
 *
 * 处理结果、计数器这类内容是程序生成、又会在页面上停留的：
 * 如果把 tpl() 的译文直接写进 DOM，切语言时它就成了「原文」，
 * 永远翻不过去。存成 {key, vars} 后，每次翻译都从中文模板重新渲染。
 *
 * vars 里可以再嵌一层 {key, vars}（比如摘要本身也是一个模板句），
 * render() 会递归展开。
 */
export function tplSrc(pattern, vars = {}) {
  return { key: pattern, vars };
}

function fill(pattern, vars) {
  return String(pattern).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  );
}

/**
 * 把一个「可翻译值」渲染成当前语言。
 * 传入字符串就当普通原文查词典；传入 {key, vars} 就先翻模板再填变量。
 * 变量本身也会过一遍词典 —— 「{label}已准备好」里的 label
 * 是「合并结果」这种中文词，不翻的话英文就成了「合并结果 is ready」。
 */
export function render(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return tOr(String(value));
  const vars = value.vars || {};
  return tOr(value.key).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? render(vars[key]) : match,
  );
}

/* ------------------------------------------------------------ 应用 */

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"]);

/**
 * 把一段文本的前后空白保留下来，只翻译中间部分。
 * HTML 里文本节点常常带着缩进换行，直接替换会把排版弄乱。
 */
function translateText(raw) {
  const lead = raw.match(/^\s*/)[0];
  const tail = raw.match(/\s*$/)[0];
  const core = raw.slice(lead.length, raw.length - tail.length);
  if (!core) return raw;
  const hit = t(core);
  return hit === undefined ? raw : lead + hit + tail;
}

function shouldSkip(node) {
  let el = node.parentElement;
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.dataset && el.dataset.noI18n !== undefined) return true;
    el = el.parentElement;
  }
  return false;
}

/** 翻译一棵子树里的所有文本节点。可重复调用。 */
function translateTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return shouldSkip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    if (!originals.has(node)) originals.set(node, node.nodeValue);
    const original = originals.get(node);
    const next = state.lang === DEFAULT_LANG ? original : translateText(original);
    if (next !== node.nodeValue) node.nodeValue = next;
  });
}

/** 属性类文案：placeholder / aria-label / title。 */
const TRANSLATED_ATTRS = ["placeholder", "aria-label", "title"];

function translateAttributes(root) {
  const elements = root.querySelectorAll
    ? root.querySelectorAll("[placeholder],[aria-label],[title]")
    : [];
  elements.forEach((el) => {
    if (el.dataset && el.dataset.noI18n !== undefined) return;
    let store = attrOriginals.get(el);
    if (!store) {
      store = {};
      attrOriginals.set(el, store);
    }
    TRANSLATED_ATTRS.forEach((attr) => {
      if (!el.hasAttribute(attr)) return;
      if (!(attr in store)) store[attr] = el.getAttribute(attr);
      const original = store[attr];
      const next = state.lang === DEFAULT_LANG ? original : tOr(original);
      if (next !== el.getAttribute(attr)) el.setAttribute(attr, next);
    });
  });
}

/**
 * 带 data-i18n-key 的元素：内容由「模板 + 变量」现算，不走文本节点缓存。
 * 变量是 JSON，写在 data-i18n-vars 上。
 *
 * 这些元素同时要带 data-noI18n，避免被下面那趟普通遍历再翻一次。
 */
function translateMarked(root) {
  const nodes = root.querySelectorAll ? root.querySelectorAll("[data-i18n-key]") : [];
  nodes.forEach((el) => {
    let vars = {};
    try {
      vars = JSON.parse(el.dataset.i18nVars || "{}");
    } catch {
      vars = {};
    }
    const next = render({ key: el.dataset.i18nKey, vars });
    if (el.textContent !== next) el.textContent = next;
  });
}

/**
 * 把一句文案写进元素，并保证切语言后还能重算。
 *
 * 直接给 textContent 赋值有两个坑：
 *   1. 元素复用时，文本节点缓存的还是上一把工具的中文，翻译会张冠李戴；
 *   2. 赋值时如果先翻成英文再写进去，英文就被当成原文缓存，再也翻不动。
 * 所以这里统一先落中文原文、再翻译（字符串），或记下模板与变量（tplSrc）。
 */
export function setText(el, value) {
  if (!el) return;
  if (value && typeof value === "object") {
    el.dataset.noI18n = "";
    el.dataset.i18nKey = value.key;
    el.dataset.i18nVars = JSON.stringify(value.vars || {});
    el.textContent = render(value);
    return;
  }
  delete el.dataset.noI18n;
  delete el.dataset.i18nKey;
  delete el.dataset.i18nVars;
  el.textContent = value === null || value === undefined ? "" : String(value);
  applyFresh(el);
}

/** 对一棵子树应用当前语言。工具弹窗注入选项后也要调一次。 */
export function applyTranslations(root = document) {
  translateMarked(root);
  translateTextNodes(root);
  translateAttributes(root);
}

/**
 * 程序化改过文案之后调用。
 *
 * 弹窗的标题、说明、按钮都是 JS 赋值的，节点复用但内容变了，
 * 缓存的原文已经失效 —— 不清掉就会拿上一把工具的中文去查词典，
 * 翻译出牛头不对马嘴的结果。
 */
export function applyFresh(root) {
  if (root.querySelectorAll) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) originals.delete(walker.currentNode);
    root.querySelectorAll("[placeholder],[aria-label],[title]").forEach((el) => {
      attrOriginals.delete(el);
    });
  }
  applyTranslations(root);
}

/** 切换语言。onChange 用于让调用方刷新动态内容（比如重渲染工具面板）。 */
export async function setLanguage(code, onChange = null) {
  if (!isSupported(code)) code = DEFAULT_LANG;
  state.lang = code;
  if (code === DEFAULT_LANG) {
    state.dict = {};
  } else {
    await loadDict(code);
  }
  const meta = LANGS.find((item) => item.code === code);
  document.documentElement.lang = meta ? meta.html : "zh-CN";
  applyTranslations(document);
  if (code === DEFAULT_LANG) {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* 忽略 */ }
  } else {
    rememberLanguage(code);
  }
  if (onChange) onChange(code);
}

/**
 * 首次进入：识别并应用。
 * 刻意先把中文页面渲染出来再切 —— IP 识别要发一次请求，
 * 不能让用户对着白屏等它返回。
 */
export async function initLanguage(onChange = null) {
  const code = await resolveLanguage();
  if (code !== DEFAULT_LANG) await setLanguage(code, onChange);
  else if (onChange) onChange(code);
  return code;
}
