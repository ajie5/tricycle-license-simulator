// 采集源适配器：自定义 JSON 题库接口 + 本地文件导入
const fs = require('node:fs');
const path = require('node:path');

/** "A" / "AB" / "0,2" / [1,3] / 1 → 选项下标数组 */
function normalizeAnswer(raw, optionCount) {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((v) => (typeof v === 'number' ? v : String(v).toUpperCase().charCodeAt(0) - 65))
      .filter((i) => Number.isInteger(i) && i >= 0 && i < optionCount)
      .sort((a, b) => a - b);
  }
  const text = String(raw).trim();
  if (!text) return [];
  const letters = text.toUpperCase().replace(/[^A-H0-9,，、\s]/g, '');
  const parts = letters.split(/[,，、\s]+/).filter(Boolean);
  const out = [];
  parts.forEach((p) => {
    if (/^[A-H]$/.test(p)) out.push(p.charCodeAt(0) - 65);
    else if (/^\d+$/.test(p)) {
      const n = Number(p);
      // 0 基下标 或 1 基序号，按范围推断
      out.push(n >= 0 && n < optionCount && optionCount > n ? n : n - 1);
    }
  });
  return [...new Set(out.filter((i) => i >= 0 && i < optionCount))].sort((a, b) => a - b);
}

/** 题型推断：显式字段优先，其次按正确答案个数 */
function normalizeType(raw, answer, optionCount) {
  const v = String(raw == null ? '' : raw).toLowerCase();
  if (['judge', 'true_false', '判断', '判断题', '2', 'tf'].includes(v)) return 'judge';
  if (['multi', 'multiple', '多选', '多选题', '3'].includes(v)) return 'multi';
  if (['single', '单选题', '单选', '1'].includes(v)) return 'single';
  if (optionCount === 2) return 'judge';
  return answer.length > 1 ? 'multi' : 'single';
}

/** 取值：支持 "a.b.c" 路径与数组下标 */
function pick(obj, pathStr) {
  if (!pathStr) return undefined;
  return String(pathStr)
    .split('.')
    .reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

/**
 * 把任意结构的题目数组归一化为本程序题库结构
 * @param {Array} items 原始题目数组
 * @param {Object} source 采集源配置（含 map 字段映射与 subject）
 */
function normalizeItems(items, source) {
  const map = source.map || {};
  const subject = source.subject === 'k4' ? 'k4' : 'k1';
  const defaultChapter = subject === 'k1' ? 'safety' : 'civil';
  const out = [];
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const stem = String(pick(item, map.question) ?? item.question ?? item.q ?? '').trim();
    if (!stem) return;
    const rawOptions = pick(item, map.options) ?? item.options ?? item.o ?? [];
    const options = (Array.isArray(rawOptions) ? rawOptions : Object.values(rawOptions || {}))
      .map((v) => String(v == null ? '' : v).trim())
      .filter((v) => v.length > 0);
    if (options.length < 2) return;
    const answer = normalizeAnswer(pick(item, map.answer) ?? item.answer ?? item.a, options.length);
    if (!answer.length) return;
    const raw = pick(item, map.explain);
    const explain = typeof raw === 'string' ? raw.replace(/<[^>]+>/g, '').trim() : '';
    const chapter = String(pick(item, map.chapter) ?? item.chapter ?? '').trim();
    const image = pick(item, map.image);
    const question = {
      i: `src-${source.id}-${pick(item, map.id) ?? item.id ?? index}`,
      subj: subject,
      c: chapter || defaultChapter,
      t: normalizeType(pick(item, map.type) ?? item.type, answer, options.length),
      q: stem,
      o: options,
      a: answer,
      e: explain,
      b: `题库来源：${source.name}`,
    };
    if (image) {
      const url = String(image);
      if (/^https?:/.test(url)) question.imgRemote = url;
      else question.img = url;
    }
    out.push(question);
  });
  return out;
}

/** JSON 接口采集源 */
async function collect({ source, onProgress }) {
  if (!source.url) throw new Error('未配置接口地址');
  onProgress && onProgress(`请求接口：${source.url}`);
  const res = await fetch(source.url, { headers: { 'User-Agent': 'tricycle-license-simulator' } });
  if (!res.ok) throw new Error(`接口请求失败：HTTP ${res.status}`);
  const data = await res.json();
  let list = Array.isArray(data) ? data : pick(data, source.map?.listPath) ?? data.list ?? data.data ?? data.items;
  if (!Array.isArray(list)) throw new Error('接口返回内容不是题目数组，请检查 listPath 配置');
  const questions = normalizeItems(list, source);
  onProgress && onProgress(`接口返回 ${list.length} 条，成功解析 ${questions.length} 题`);
  return { questions, videos: [], meta: { version: null, raw: list.length } };
}

/** JSON 列表采集源：用于视频目录等元数据 */
async function collectList({ source, onProgress }) {
  if (!source.url) throw new Error('未配置接口地址');
  onProgress && onProgress(`请求视频目录：${source.url}`);
  const res = await fetch(source.url, { headers: { 'User-Agent': 'tricycle-license-simulator' } });
  if (!res.ok) throw new Error(`接口请求失败：HTTP ${res.status}`);
  const data = await res.json();
  const rawList = Array.isArray(data) ? data : pick(data, source.map?.listPath) ?? data.list ?? data.data ?? data.items;
  if (!Array.isArray(rawList)) throw new Error('接口返回内容不是列表，请检查 listPath 配置');
  const map = source.map || {};
  const items = rawList
    .map((item, index) => ({
      no: String(pick(item, map.no) ?? item.no ?? `V${String(index + 1).padStart(2, '0')}`),
      title: String(pick(item, map.title) ?? item.title ?? '').trim(),
      dur: String(pick(item, map.dur) ?? item.dur ?? item.duration ?? '').trim(),
      desc: String(pick(item, map.desc) ?? item.desc ?? item.description ?? '').trim(),
      url: String(pick(item, map.url) ?? item.url ?? item.playUrl ?? '').trim(),
    }))
    .filter((v) => v.title);
  onProgress && onProgress(`解析到 ${items.length} 条视频目录`);
  return { questions: [], videos: items, meta: { version: null, raw: rawList.length } };
}

/** 从本地文件导入题库（JSON 数组或 CSV） */
function importFile(file, source) {
  const text = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file).toLowerCase();
  let items;
  if (ext === '.csv') {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const head = lines.shift().split(',');
    items = lines.map((line) => {
      const cells = line.split(',');
      const obj = {};
      head.forEach((h, i) => {
        obj[h.trim()] = (cells[i] || '').trim();
      });
      return {
        question: obj.question || obj.题干,
        options: [obj.option_a || obj.A, obj.option_b || obj.B, obj.option_c || obj.C, obj.option_d || obj.D],
        answer: obj.answer || obj.答案,
        explain: obj.explain || obj.解析,
        type: obj.type || obj.题型,
      };
    });
  } else {
    const data = JSON.parse(text);
    items = Array.isArray(data) ? data : data.questions || data.list || data.data;
  }
  if (!Array.isArray(items)) throw new Error('文件内容不是题目数组');
  return normalizeItems(items, source);
}

module.exports = { collect, collectList, importFile, normalizeItems, normalizeAnswer };
