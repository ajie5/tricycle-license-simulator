// 采集源适配器：驾考宝典官方题库 SQLite 数据源
// 数据链路：官方 CDN → 仓库 dbs/*.db → 字段 XOR 解密 → 归一化为本程序题库结构
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const initSqlJs = require('sql.js');

const store = require('../store');

/** 题型编码：驾考宝典 option_type 0=判断 1=单选 2=多选 */
const TYPE_MAP = { 0: 'judge', 1: 'single', 2: 'multi' };

/** 答案位掩码：16=A、32=B、64=C、128=D，多个答案相加 */
const ANSWER_BASE = 16;

/** 章节标题 → 程序内部章节 key */
const CHAPTER_KEY_MAP = {
  驾驶证和机动车管理规定: 'law',
  道路通行条件及通行规定: 'signal',
  道路交通安全违法行为及处罚: 'law',
  安全行车常识: 'safety',
  道路交通事故处理相关规定: 'case',
  文明行车常识: 'civil',
  道路交通信号在交通场景中的综合应用: 'civil',
  恶劣气象和复杂道路条件下安全驾驶知识: 'weather',
  紧急情况下避险常识: 'emergency',
  防范次生事故处置与伤员急救知识: 'emergency',
  典型事故案例分析: 'case',
};
const SUBJECT_CHAPTER_KEYS = {
  k1: ['law', 'signal', 'safety', 'vehicle'],
  k4: ['civil', 'weather', 'emergency', 'case'],
};
const FALLBACK_CHAPTER = { k1: 'safety', k4: 'civil' };
/** 地方题库标记 */
const REGIONAL_RE = /地方|区域/;

/** 省级行政区名称：用于从地方章节标题中识别题目归属的省份 */
const PROVINCE_NAMES = [
  '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江', '上海', '江苏',
  '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西',
  '海南', '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆',
];

/** 章节标题未包含省份名时，归入通用地方题（所有地区通用） */
const GENERIC_AREA = '通用';

/** 从地方章节标题中识别省份；识别不到则返回通用 */
function detectArea(title) {
  return PROVINCE_NAMES.find((name) => title.includes(name)) || GENERIC_AREA;
}

/** 字段为 XOR 加密的字节串，按密钥逐字节还原 */
function xorDecode(value, key) {
  if (value == null) return '';
  if (!(value instanceof Uint8Array)) return String(value);
  if (!value.length) return '';
  const buf = Buffer.from(value);
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length];
  return out.toString('utf8');
}

/** 解析字段中的 HTML 片段 */
function stripHtml(text) {
  if (!text) return '';
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 位掩码 → 选项下标 */
function maskToIndexes(mask, optionCount) {
  const out = [];
  const m = Number(mask) || 0;
  for (let i = 0; i < 8; i++) if (m & (ANSWER_BASE << i)) out.push(i);
  return out.filter((i) => i < optionCount);
}

/** 依据引用全部落在同一科目时直接返回 */
function splitExplain(text) {
  const idx = text.indexOf('相关法规参考');
  if (idx < 0) return { explain: text, basis: '' };
  const explain = text.slice(0, idx).trim();
  const basis = text
    .slice(idx)
    .replace(/相关法规参考[：:]*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { explain, basis };
}

/** 远端文件指纹：优先用 GitHub 提交 sha，其次用响应头 */
async function probeRemote(source, onProgress) {
  if (source.repoSlug && source.repoPath) {
    try {
      const api = `https://api.github.com/repos/${source.repoSlug}/commits?path=${encodeURIComponent(
        source.repoPath
      )}&sha=${source.repoBranch || 'main'}&per_page=1`;
      const res = await fetch(api, { headers: { 'User-Agent': 'tricycle-license-simulator' } });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length) {
          onProgress && onProgress(`检测远端版本：commit ${list[0].sha.slice(0, 8)}`);
          return { fingerprint: list[0].sha, date: (list[0].commit && list[0].commit.committer && list[0].commit.committer.date) || null };
        }
      }
    } catch {
      /* 忽略，退回响应头检测 */
    }
  }
  const candidates = source.dbUrls && source.dbUrls.length ? source.dbUrls : [source.dbUrl].filter(Boolean);
  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) {
        const fingerprint =
          res.headers.get('etag') || res.headers.get('last-modified') || String(res.headers.get('content-length'));
        return { fingerprint, date: res.headers.get('last-modified') };
      }
    } catch {
      /* 尝试下一个镜像 */
    }
  }
  return { fingerprint: null, date: null };
}

/** 从候选地址下载文件，逐个镜像重试 */
async function downloadFromMirrors(source, target, onProgress) {
  const candidates = source.dbUrls && source.dbUrls.length ? source.dbUrls : [source.dbUrl].filter(Boolean);
  if (!candidates.length) throw new Error('未配置下载地址');
  const errors = [];
  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    const label = i === 0 ? '主地址' : `备用地址 ${i}`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        onProgress && onProgress(`尝试下载（${label}${attempt > 1 ? ` · 第 ${attempt} 次` : ''}）`);
        const bytes = await download(url, target, onProgress);
        onProgress && onProgress(`下载完成：${(bytes / 1048576).toFixed(2)} MB（${label}）`);
        return { bytes, url };
      } catch (err) {
        errors.push(`${label}: ${err.message}`);
        onProgress && onProgress(`下载失败：${err.message}`);
        if (attempt === 2) break;
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }
  throw new Error(`全部下载地址均失败（${errors.join('；')}）`);
}

/** 下载文件并上报进度 */
async function download(url, target, onProgress) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'tricycle-license-simulator' },
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const tmp = `${target}.part`;
  const out = fs.createWriteStream(tmp);
  let received = 0;
  let lastTick = 0;
  try {
    for await (const chunk of Readable.fromWeb(res.body)) {
      received += chunk.length;
      out.write(chunk);
      if (onProgress && Date.now() - lastTick > 700) {
        lastTick = Date.now();
        onProgress(`下载中：${(received / 1048576).toFixed(2)} MB`);
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  if (received < 1024) {
    fs.rmSync(tmp, { force: true });
    throw new Error('下载内容不完整');
  }
  fs.renameSync(tmp, target);
  return received;
}

/** 读取 SQLite 并归一化题目 */
function parseDatabase(file, source, options) {
  return initSqlJs({
    locateFile: (name) => require.resolve(`sql.js/dist/${name}`),
  }).then((SQL) => {
    const db = new SQL.Database(new Uint8Array(fs.readFileSync(file)));
    const key = Buffer.from(source.xorKey || '_jiakaobaodian.com_', 'utf8');
    const includeRegional = !!options.includeRegional;
    const { onProgress } = options;

    const version = db.exec('SELECT version FROM t_version LIMIT 1');
    const bankVersion = version.length && version[0].values.length ? String(version[0].values[0][0]) : null;

    // 章节：id → 标题
    const chapterTitle = new Map();
    db.exec('SELECT _id, title FROM t_chapter').forEach((r) =>
      r.values.forEach((row) => chapterTitle.set(row[0], String(row[1] || '')))
    );

    // 题目 → 章节
    const questionChapters = new Map();
    db.exec('SELECT question_id, chapter_id, areacode FROM t_chapter_question').forEach((r) =>
      r.values.forEach((row) => {
        const list = questionChapters.get(row[0]) || [];
        list.push({ chapterId: row[1], area: row[2] });
        questionChapters.set(row[0], list);
      })
    );

    // 媒体：media_key → 本地图片
    const mediaFile = new Map();
    const mediaRemote = new Map();
    let imageCount = 0;
    db.exec('SELECT media_key, media_content, hd_image_url FROM t_media').forEach((r) =>
      r.values.forEach((row) => {
        const mk = String(row[0] || '');
        if (!mk) return;
        if (row[1] instanceof Uint8Array && row[1].length > 200) {
          const rel = store.writeImage(Buffer.from(row[1]));
          mediaFile.set(mk, rel);
          imageCount++;
        }
        if (row[2] && row[2] !== 'null') mediaRemote.set(mk, String(row[2]).replace(/^http:/, 'https:'));
      })
    );
    onProgress && onProgress(`读取本地插图：${imageCount} 张`);

    const questions = [];
    const stat = { k1: 0, k4: 0, regional: 0 };
    const areaCount = {};
    let missingMedia = 0;
    db.exec('SELECT * FROM t_question').forEach((result) => {
      const cols = result.columns;
      const idx = (name) => cols.indexOf(name);
      result.values.forEach((row) => {
        const get = (name) => row[idx(name)];
        const qid = String(get('question_id'));
        const stem = stripHtml(xorDecode(get('question'), key)).trim();
        if (!stem) return;

        const options = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
          .map((k) => String(get(`option_${k}`) || '').trim())
          .filter((v) => v.length > 0);
        if (options.length < 2) return;

        const type = TYPE_MAP[Number(get('option_type'))] || 'single';
        const answer = maskToIndexes(get('answer'), options.length);
        if (!answer.length) return;

        const rawExplain = xorDecode(get('explain'), key);
        const concise = xorDecode(get('concise_explain'), key);
        const { explain, basis } = splitExplain(stripHtml(rawExplain || concise));

        // 章节归属：取第一个章节，判断科目
        const links = questionChapters.get(Number(qid)) || [];
        const first = links[0] || {};
        const title = chapterTitle.get(first.chapterId) || '';
        const isRegional = REGIONAL_RE.test(title);
        if (isRegional && !includeRegional) return;
        const chapterNo = Number(first.chapterId) || 0;
        const subject = !isRegional && chapterNo >= 2315 ? 'k4' : 'k1';
        const mapped = isRegional ? FALLBACK_CHAPTER[subject] : CHAPTER_KEY_MAP[title] || FALLBACK_CHAPTER[subject];
        const chapterKey = SUBJECT_CHAPTER_KEYS[subject].includes(mapped) ? mapped : FALLBACK_CHAPTER[subject];

        const mediaKey = String(get('media_key') || '');
        const hasMedia = mediaKey && mediaKey !== 'null';
        const question = {
          i: `jk-${qid}`,
          subj: subject,
          c: chapterKey,
          t: type,
          q: stem,
          o: options,
          a: answer,
          e: explain,
          b: basis || `题库来源：${source.name}${bankVersion ? ` · 版本 ${bankVersion}` : ''}`,
        };
        if (hasMedia) {
          if (mediaFile.has(mediaKey)) question.img = mediaFile.get(mediaKey);
          if (mediaRemote.has(mediaKey)) question.imgRemote = mediaRemote.get(mediaKey);
          if (!question.img && !question.imgRemote) missingMedia++;
        }
        if (isRegional) {
          // 章节标题里带省份名的按省份归属，其余归入通用地方题
          question.area = detectArea(title);
          areaCount[question.area] = (areaCount[question.area] || 0) + 1;
          stat.regional++;
        }
        questions.push(question);
        stat[subject]++;
      });
    });

    db.close();
    return {
      questions,
      videos: [],
      meta: {
        version: bankVersion,
        subjectCount: { k1: stat.k1, k4: stat.k4 },
        regional: stat.regional,
        areaCount,
        images: imageCount,
        skippedMedia: missingMedia,
      },
    };
  });
}

/**
 * 执行采集
 * @returns {Promise<{questions:Array, videos:Array, meta:Object}>}
 */
async function collect({ source, config, onProgress }) {
  const log = (msg) => onProgress && onProgress(msg);
  store.ensureDirs();
  const target = path.join(store.DIRS.raw, source.dbFile || 'moto.db');
  const state = store.loadState();
  const prev = state.sources[source.id] || {};

  log('检测数据源版本…');
  const remote = await probeRemote(source, log);
  const needDownload = !fs.existsSync(target) || !remote.fingerprint || remote.fingerprint !== prev.fingerprint;

  let usedUrl = prev.usedUrl || null;
  if (needDownload) {
    log(fs.existsSync(target) ? '检测到数据源已更新，重新下载…' : '首次采集，开始下载原始题库…');
    const result = await downloadFromMirrors(source, target, log);
    usedUrl = result.url;
  } else {
    log('数据源未变化，复用本地缓存，跳过下载');
  }

  log('解析题库并解密字段…');
  const parsed = await parseDatabase(target, source, {
    includeRegional: config.includeRegional,
    onProgress: log,
  });

  if (parsed.meta.regional) {
    const areas = Object.entries(parsed.meta.areaCount || {})
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name} ${n}`)
      .join('、');
    log(`地方题库 ${parsed.meta.regional} 题：${areas}`);
  } else if (!config.includeRegional) {
    log('未启用地方题库，仅采集全国通用题');
  }

  state.sources[source.id] = {
    fingerprint: remote.fingerprint,
    remoteDate: remote.date,
    usedUrl,
    dbFile: source.dbFile,
    dbBytes: fs.existsSync(target) ? fs.statSync(target).size : 0,
    downloadedAt: needDownload ? new Date().toISOString() : prev.downloadedAt || null,
    lastRunAt: new Date().toISOString(),
    version: parsed.meta.version,
    counts: parsed.meta.subjectCount,
  };
  store.saveState(state);

  return parsed;
}

module.exports = { collect, TYPE_MAP, CHAPTER_KEY_MAP, xorDecode, PROVINCE_NAMES, GENERIC_AREA, detectArea };
