// 采集数据存储层：统一管理项目目录下的 data/ 目录读写（配置、状态、题库、图片、视频、日志）
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/** 数据根目录：开发时位于项目文件夹下；安装包运行时应用目录只读，改存到系统用户数据目录 */
function resolveDataRoot() {
  const override = process.env.TRICYCLE_DATA_DIR;
  if (override) return path.resolve(override);
  if (__dirname.includes('app.asar')) {
    // 打包后 resources/app.asar 只读，数据写到 %APPDATA%/tricycle-license-simulator/data
    try {
      const { app } = require('electron');
      return path.join(app.getPath('appData'), 'tricycle-license-simulator', 'data');
    } catch {
      // 非 Electron 运行时（理论上不会出现）继续按开发目录处理
    }
  }
  // electron/collector/store.js -> 项目根
  return path.resolve(__dirname, '..', '..', 'data');
}

const DATA_ROOT = resolveDataRoot();
const DIRS = {
  root: DATA_ROOT,
  bank: path.join(DATA_ROOT, 'bank'),
  images: path.join(DATA_ROOT, 'images'),
  media: path.join(DATA_ROOT, 'media'),
  raw: path.join(DATA_ROOT, 'raw'),
  logs: path.join(DATA_ROOT, 'logs'),
};
const CONFIG_FILE = path.join(DATA_ROOT, 'collector-config.json');
const STATE_FILE = path.join(DATA_ROOT, 'collector-state.json');

/** 默认采集配置：内置数据源 + 定时策略 */
function defaultConfig() {
  return {
    version: 2,
    updatedAt: null,
    /** 是否合并各省地方题库（默认包含，采集时按省份归属保存） */
    includeRegional: true,
    schedule: {
      enabled: true,
      /** 采集间隔（小时） */
      intervalHours: 24,
      lastRunAt: null,
      nextRunAt: null,
      lastResult: null,
    },
    sources: [
      {
        id: 'jiakao-moto',
        name: '驾考宝典 · 摩托车全量题库',
        type: 'jiakao-sqlite',
        desc: '官方题库 SQLite 数据源，覆盖科目一与科目四摩托车全部题目，含全国通用题与各省地方题、交通标志插图。',
        enabled: true,
        /** 下载地址按顺序尝试，前一个失败自动切换下一个 */
        dbUrls: [
          'https://cdn.jsdelivr.net/gh/china794/jiakao-baodian-dump@main/dbs/moto.db',
          'https://ghproxy.net/https://raw.githubusercontent.com/china794/jiakao-baodian-dump/main/dbs/moto.db',
          'https://raw.githubusercontent.com/china794/jiakao-baodian-dump/main/dbs/moto.db',
        ],
        /** 用于检测远端版本变化的仓库路径（GitHub API） */
        repoSlug: 'china794/jiakao-baodian-dump',
        repoBranch: 'main',
        repoPath: 'dbs/moto.db',
        dbFile: 'moto.db',
        xorKey: '_jiakaobaodian.com_',
      },
      {
        id: 'ybjk-article',
        name: '元贝驾考 · 开车技巧图文',
        type: 'html-list',
        desc: '元贝驾考「开车技巧」公开列表页，采集科目二、科目三图文讲解的标题与原文链接，用于图文教程线上目录。',
        enabled: true,
        url: 'https://x.ybjk.com/kcjq',
        base: 'https://x.ybjk.com',
        kind: 'article',
        category: '图文讲解',
        rules: { hrefPattern: '^/[0-9a-z]{5,8}$', minTitleLen: 8, maxTitleLen: 60 },
      },
      {
        id: 'ybjk-video',
        name: '元贝驾考 · 学车视频目录',
        type: 'html-list',
        desc: '元贝学车视频站公开列表页，采集科目二、科目三教学视频的标题与播放页链接。',
        enabled: true,
        url: 'https://v.ybjk.com/',
        base: 'https://v.ybjk.com',
        kind: 'video',
        category: '学车视频',
        rules: { hrefPattern: '^/[0-9a-z]{6}$', minTitleLen: 6, maxTitleLen: 60, dur: true },
      },
      {
        id: 'ybjk-video-km2',
        name: '元贝驾考 · 科目二视频',
        type: 'html-list',
        desc: '元贝学车视频「科目二考试视频」分类页，采集倒车入库、侧方停车、坡道定点等教学视频目录。',
        enabled: true,
        url: 'https://v.ybjk.com/s_1046',
        base: 'https://v.ybjk.com',
        kind: 'video',
        category: '科目二',
        rules: { hrefPattern: '^/[0-9a-z]{6}$', minTitleLen: 6, maxTitleLen: 60, dur: true },
      },
      {
        id: 'ybjk-video-km3',
        name: '元贝驾考 · 科目三视频',
        type: 'html-list',
        desc: '元贝学车视频「科目三考试视频」分类页，采集灯光、起步、变道、靠边停车等教学视频目录。',
        enabled: true,
        url: 'https://v.ybjk.com/s_1045',
        base: 'https://v.ybjk.com',
        kind: 'video',
        category: '科目三',
        rules: { hrefPattern: '^/[0-9a-z]{6}$', minTitleLen: 6, maxTitleLen: 60, dur: true },
      },
      {
        id: 'jkbd-km2',
        name: '驾考宝典 · 科目二项目讲解',
        type: 'html-list',
        desc: '驾考宝典科目二项目页，采集倒车入库、侧方停车、坡道定点停车和起步等项目的讲解视频（含时长）。',
        enabled: true,
        url: 'https://www.jiakaobaodian.com/mnks/kemu2/car.html',
        base: 'https://www.jiakaobaodian.com',
        kind: 'video',
        category: '科目二',
        rules: { hrefPattern: '^/news/detail/\\d+\\.html$', minTitleLen: 2, maxTitleLen: 30, dur: true },
      },
      {
        id: 'jkbd-km3',
        name: '驾考宝典 · 科目三项目讲解',
        type: 'html-list',
        desc: '驾考宝典科目三项目页，采集上车准备、起步、直线行驶、变更车道、通过路口、靠边停车等项目的讲解视频（含时长）。',
        enabled: true,
        url: 'https://www.jiakaobaodian.com/mnks/kemu3/car.html',
        base: 'https://www.jiakaobaodian.com',
        kind: 'video',
        category: '科目三',
        rules: { hrefPattern: '^/news/detail/\\d+\\.html$', minTitleLen: 2, maxTitleLen: 30, dur: true },
      },
      {
        id: 'custom-article',
        name: '自定义图文列表接口',
        type: 'html-list',
        desc: '任意公开列表页地址，按 hrefPattern 规则抓取标题与链接，产出图文教程线上目录。',
        enabled: false,
        url: '',
        base: '',
        kind: 'article',
        category: '自定义',
        rules: { hrefPattern: '^/.+$', minTitleLen: 6, maxTitleLen: 60 },
      },
      {
        id: 'custom-json',
        name: '自定义 JSON 题库接口',
        type: 'json-api',
        desc: '任意返回题目数组的 HTTP 接口，可自定义字段映射；启用后随手动 / 定时采集一起执行。',
        enabled: false,
        url: '',
        subject: 'k1',
        map: {
          listPath: '',
          id: 'id',
          question: 'question',
          options: 'options',
          answer: 'answer',
          explain: 'explain',
          type: 'type',
          chapter: 'chapter',
          image: 'image',
        },
      },
      {
        id: 'custom-video',
        name: '自定义视频目录接口',
        type: 'json-list',
        desc: '返回课程数组的接口，用于补充图文 / 视频教程中的视频目录（含标题、时长、播放地址）。',
        enabled: false,
        url: '',
        map: { listPath: '', no: 'no', title: 'title', dur: 'dur', desc: 'desc', url: 'url' },
      },
    ],
  };
}

function ensureDirs() {
  Object.values(DIRS).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
}

function readJson(file, fallback = null) {
  try {
    // 兼容带 BOM 的 UTF-8 文件（外部工具写入时常见）
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDirs();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/** 合并保存配置：缺失字段用默认值补齐，避免升级后配置残缺 */
function loadConfig() {
  ensureDirs();
  const defaults = defaultConfig();
  const saved = readJson(CONFIG_FILE, null);
  if (!saved) {
    writeJson(CONFIG_FILE, defaults);
    return defaults;
  }
  const merged = {
    ...defaults,
    ...saved,
    schedule: { ...defaults.schedule, ...(saved.schedule || {}) },
  };
  // v1 → v2：地方题库归属改为按省份保存，默认纳入采集
  if (!(Number(saved.version) >= 2)) {
    merged.includeRegional = true;
    merged.version = 2;
  }
  merged.sources = defaults.sources.map((def) => {
    const hit = (saved.sources || []).find((s) => s.id === def.id);
    if (!hit) return def;
    // 解析规则以内置默认值为准（升级后新规则即时生效）；其余字段保留用户设置
    return {
      ...def,
      ...hit,
      rules: { ...(hit.rules || {}), ...(def.rules || {}) },
      map: { ...(def.map || {}), ...(hit.map || {}) },
    };
  });
  // 保留用户自定义新增的源
  (saved.sources || []).forEach((s) => {
    if (!merged.sources.some((m) => m.id === s.id)) merged.sources.push(s);
  });
  return merged;
}

function saveConfig(config) {
  config.updatedAt = new Date().toISOString();
  writeJson(CONFIG_FILE, config);
  return config;
}

function loadState() {
  return readJson(STATE_FILE, { sources: {}, lastRun: null });
}

function saveState(state) {
  writeJson(STATE_FILE, state);
  return state;
}

/* ── 题库读写 ───────────────────────────────────────────────────────── */

function bankFile(subject) {
  return path.join(DIRS.bank, `${subject}.json`);
}

function loadBank(subject) {
  const data = readJson(bankFile(subject), null);
  if (!data || !Array.isArray(data.questions)) {
    return { subject, version: null, updatedAt: null, sources: [], images: {}, questions: [] };
  }
  return data;
}

function saveBank(subject, payload) {
  writeJson(bankFile(subject), payload);
  return payload;
}

function emptyBank(subject) {
  return { subject, version: null, updatedAt: null, sources: [], images: {}, questions: [] };
}

/* ── 图片与视频 ─────────────────────────────────────────────────────── */

/** 图片以内容哈希命名，天然去重；返回相对路径 */
function writeImage(bytes) {
  ensureDirs();
  const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 16);
  const file = path.join(DIRS.images, `${hash}.jpg`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
  return `images/${hash}.jpg`;
}

function videoFile() {
  return path.join(DIRS.media, 'videos.json');
}

function loadVideos() {
  return readJson(videoFile(), { updatedAt: null, source: null, items: [] });
}

function saveVideos(payload) {
  writeJson(videoFile(), payload);
  return payload;
}

function articleFile() {
  return path.join(DIRS.media, 'articles.json');
}

/** 线上图文教程目录（标题 + 原文链接） */
function loadArticles() {
  return readJson(articleFile(), { updatedAt: null, sources: [], items: [] });
}

function saveArticles(payload) {
  writeJson(articleFile(), payload);
  return payload;
}

/* ── 日志 ───────────────────────────────────────────────────────────── */

function logFile(date = new Date()) {
  const d = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return path.join(DIRS.logs, `collect-${d}.log`);
}

function appendLog(line) {
  ensureDirs();
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  fs.appendFileSync(logFile(), `[${stamp}] ${line}\n`, 'utf8');
}

function readRecentLogs(maxLines = 200) {
  try {
    const files = fs
      .readdirSync(DIRS.logs)
      .filter((f) => f.endsWith('.log'))
      .sort()
      .slice(-3);
    const lines = [];
    files.forEach((f) => {
      lines.push(...fs.readFileSync(path.join(DIRS.logs, f), 'utf8').split(/\r?\n/).filter(Boolean));
    });
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

/* ── 归一化与去重 ───────────────────────────────────────────────────── */

/** 题干归一化指纹，用于跨源去重 */
function questionKey(question) {
  const norm = String(question.q || '')
    .replace(/\s+/g, '')
    .replace(/[。，,、？?！!（）()【】\[\]“”"'’]/g, '');
  return crypto.createHash('md5').update(`${question.t}|${norm}|${(question.o || []).join('|')}`).digest('hex');
}

/**
 * 合并题目：以已有题库为底，逐条去重合并；重复题保留先到者并累计来源。
 * 返回 { questions, added, duplicated }
 */
function mergeQuestions(existing, incoming, sourceLabel) {
  const byKey = new Map();
  existing.forEach((q) => byKey.set(q.key || questionKey(q), q));
  let added = 0;
  let duplicated = 0;
  incoming.forEach((q) => {
    const key = questionKey(q);
    const hit = byKey.get(key);
    if (hit) {
      duplicated++;
      if (sourceLabel && !(hit.src || []).includes(sourceLabel)) {
        hit.src = [...(hit.src || []), sourceLabel];
      }
      // 补充原有题目缺失的图片与解析
      if (!hit.img && q.img) hit.img = q.img;
      if (!hit.e && q.e) hit.e = q.e;
      // 同一道题同时出现在多个地方题库时，保留全部地区归属
      if (q.area) {
        const areas = new Set([...(hit.areas || []), hit.area, q.area].filter(Boolean));
        if (areas.size > 1) hit.areas = [...areas];
        if (!hit.area) hit.area = q.area;
      }
      return;
    }
    const item = { ...q, key, src: [sourceLabel] };
    byKey.set(key, item);
    added++;
  });
  return { questions: [...byKey.values()], added, duplicated };
}

/** 数据集统计 */
function bankStats(subject) {
  const bank = loadBank(subject);
  let bytes = 0;
  try {
    bytes = fs.statSync(bankFile(subject)).size;
  } catch {
    bytes = 0;
  }
  return {
    subject,
    count: bank.questions.length,
    version: bank.version,
    updatedAt: bank.updatedAt,
    sources: bank.sources || [],
    bytes,
  };
}

/** 数据目录文件清单 */
function listDataFiles() {
  ensureDirs();
  const walk = (dir, prefix = '') => {
    const out = [];
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) out.push(...walk(full, rel));
      else {
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          size = 0;
        }
        out.push({ path: rel, size, mtime: fs.statSync(full).mtime.toISOString() });
      }
    });
    return out;
  };
  return walk(DATA_ROOT).sort((a, b) => a.path.localeCompare(b.path));
}

module.exports = {
  DATA_ROOT,
  DIRS,
  CONFIG_FILE,
  STATE_FILE,
  defaultConfig,
  ensureDirs,
  loadConfig,
  saveConfig,
  loadState,
  saveState,
  bankFile,
  loadBank,
  saveBank,
  emptyBank,
  writeImage,
  loadVideos,
  saveVideos,
  loadArticles,
  saveArticles,
  appendLog,
  readRecentLogs,
  mergeQuestions,
  questionKey,
  bankStats,
  listDataFiles,
  readJson,
  writeJson,
};
