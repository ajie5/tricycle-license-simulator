// 采集编排层：调度采集源 → 归一化 → 合并入库 → 更新配置与状态 → 写日志
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const jiakaoSqlite = require('./sources/jiakaoSqlite');
const remote = require('./sources/remote');
const htmlList = require('./sources/htmlList');

const ADAPTERS = {
  'jiakao-sqlite': (ctx) => jiakaoSqlite.collect(ctx),
  'json-api': (ctx) => remote.collect(ctx),
  'json-list': (ctx) => remote.collectList(ctx),
  'html-list': (ctx) => htmlList.collect(ctx),
};

function adapterOf(source) {
  const fn = ADAPTERS[source.type];
  if (!fn) throw new Error(`未知采集源类型：${source.type}`);
  return fn;
}

/** 同一条目录出现在多个来源时，优先保留更具体的科目分类 */
function preferCategory(prev, next) {
  if (!prev) return next || '';
  if (!next) return prev;
  if (prev === '学车视频') return next;
  if (next === '学车视频') return prev;
  return next;
}

/** 手动 / 定时采集入口 */
async function runCollect(options = {}) {
  const { sourceIds = null, onProgress = null, trigger = 'manual' } = options;
  const config = store.loadConfig();
  store.ensureDirs();

  const log = (msg) => {
    store.appendLog(msg);
    if (onProgress) onProgress({ type: 'log', message: msg });
  };

  const targets = config.sources.filter(
    (s) => s.enabled && (!sourceIds || sourceIds.length === 0 || sourceIds.includes(s.id))
  );

  const summary = {
    trigger,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    sources: [],
    totalAdded: { k1: 0, k4: 0 },
    totalQuestions: { k1: 0, k4: 0 },
    videos: 0,
    articles: 0,
    errors: [],
  };

  log(`开始采集（触发方式：${trigger === 'manual' ? '手动' : '定时'}），启用数据源 ${targets.length} 个`);
  if (!targets.length) {
    log('没有启用的数据源，请先在采集配置中启用至少一个数据源');
    summary.finishedAt = new Date().toISOString();
    config.schedule.lastRunAt = summary.startedAt;
    config.schedule.lastResult = { ok: false, message: '没有启用的数据源' };
    store.saveConfig(config);
    return summary;
  }

  // 逐源采集并合并
  const banks = { k1: store.loadBank('k1'), k4: store.loadBank('k4') };
  const videoItems = [];
  const articleItems = [];

  for (const source of targets) {
    const entry = { id: source.id, name: source.name, ok: false, message: '', added: 0, parsed: 0 };
    try {
      log(`—— 数据源「${source.name}」开始`);
      const result = await adapterOf(source)({
        source,
        config,
        onProgress: (msg) => log(`[${source.name}] ${msg}`),
      });

      // 按科目归类
      const grouped = { k1: [], k4: [] };
      (result.questions || []).forEach((q) => {
        const subj = q.subj === 'k4' ? 'k4' : q.subj === 'k1' ? 'k1' : null;
        if (!subj) return;
        const { subj: _drop, ...rest } = q;
        grouped[subj].push(rest);
      });

      entry.parsed = (result.questions || []).length;
      Object.keys(grouped).forEach((subj) => {
        const bank = banks[subj];
        const merged = store.mergeQuestions(bank.questions, grouped[subj], source.name);
        bank.questions = merged.questions;
        bank.subject = subj;
        bank.version = result.meta && result.meta.version ? String(result.meta.version) : bank.version;
        bank.updatedAt = new Date().toISOString();
        if (!bank.sources.includes(source.name)) bank.sources.push(source.name);
        entry.added += merged.added;
        log(
          `[${source.name}] ${subj === 'k1' ? '科目一' : '科目四'}：解析 ${grouped[subj].length} 题，新增 ${merged.added} 题，重复 ${merged.duplicated} 题`
        );
      });

      if (result.videos && result.videos.length) {
        videoItems.push(...result.videos.map((v) => ({ ...v, source: source.name })));
        entry.parsed += result.videos.length;
        log(`[${source.name}] 视频目录新增 ${result.videos.length} 条`);
      }

      if (result.articles && result.articles.length) {
        articleItems.push(...result.articles.map((a) => ({ ...a, source: source.name })));
        entry.parsed += result.articles.length;
        log(`[${source.name}] 图文目录新增 ${result.articles.length} 条`);
      }

      entry.ok = true;
      entry.message = `新增 ${entry.added} 题`;
      log(`—— 数据源「${source.name}」完成`);
    } catch (err) {
      entry.message = err.message || String(err);
      summary.errors.push({ source: source.name, message: entry.message });
      log(`—— 数据源「${source.name}」失败：${entry.message}`);
    }
    summary.sources.push(entry);
  }

  // 落库
  ['k1', 'k4'].forEach((subj) => {
    store.saveBank(subj, banks[subj]);
    summary.totalAdded[subj] = banks[subj].questions.length;
    summary.totalQuestions[subj] = banks[subj].questions.length;
  });

  if (videoItems.length) {
    const prev = store.loadVideos();
    const byKey = new Map(prev.items.map((v) => [v.url || `${v.source}|${v.no}|${v.title}`, v]));
    videoItems.forEach((v) => {
      const key = v.url || `${v.source}|${v.no}|${v.title}`;
      const hit = byKey.get(key);
      // 保留已有编号，新条目按当前顺序补编号
      if (hit && hit.no && !v.no) v.no = hit.no;
      byKey.set(key, { ...hit, ...v, category: preferCategory(hit && hit.category, v.category) });
    });
    const items = [...byKey.values()];
    items.forEach((v, i) => {
      if (!v.no) v.no = `V${String(i + 1).padStart(2, '0')}`;
    });
    store.saveVideos({
      updatedAt: new Date().toISOString(),
      sources: [...new Set(items.map((v) => v.source).filter(Boolean))],
      items,
    });
    summary.videos = items.length;
  }

  if (articleItems.length) {
    const prev = store.loadArticles();
    const byUrl = new Map(prev.items.map((a) => [a.url, a]));
    articleItems.forEach((a) => byUrl.set(a.url, { ...byUrl.get(a.url), ...a }));
    const items = [...byUrl.values()];
    store.saveArticles({
      updatedAt: new Date().toISOString(),
      sources: [...new Set(items.map((a) => a.source).filter(Boolean))],
      items,
    });
    summary.articles = items.length;
  }

  summary.finishedAt = new Date().toISOString();
  summary.totalQuestions = { k1: banks.k1.questions.length, k4: banks.k4.questions.length };

  const failed = summary.errors.length;
  config.schedule.lastRunAt = summary.finishedAt;
  config.schedule.lastResult = {
    ok: failed === 0,
    message: failed === 0 ? `采集完成，科目一 ${summary.totalQuestions.k1} 题 / 科目四 ${summary.totalQuestions.k4} 题` : `${failed} 个数据源失败`,
  };
  config.schedule.nextRunAt = config.schedule.enabled
    ? new Date(Date.now() + config.schedule.intervalHours * 3600000).toISOString()
    : null;
  store.saveConfig(config);

  log(
    `采集结束：科目一 ${summary.totalQuestions.k1} 题，科目四 ${summary.totalQuestions.k4} 题，视频 ${summary.videos} 条，图文 ${summary.articles} 条，失败数据源 ${failed} 个`
  );
  return summary;
}

/** 采集总览：配置、状态、题库统计、数据文件清单 */
function getStatus() {
  const config = store.loadConfig();
  const state = store.loadState();
  return {
    dataRoot: store.DATA_ROOT,
    config,
    state,
    banks: {
      k1: store.bankStats('k1'),
      k4: store.bankStats('k4'),
    },
    videos: store.loadVideos(),
    articles: store.loadArticles(),
    files: store.listDataFiles(),
    logs: store.readRecentLogs(120),
  };
}

/** 采集题库中指定科目的题目（供渲染层加载），支持 limit 与随机抽样预览 */
function loadCollected(subject, limit = 0) {
  const bank = store.loadBank(subject === 'k4' ? 'k4' : 'k1');
  const questions = limit > 0 ? bank.questions.slice(0, limit) : bank.questions;
  return {
    subject: bank.subject,
    version: bank.version,
    updatedAt: bank.updatedAt,
    sources: bank.sources || [],
    count: bank.questions.length,
    questions,
  };
}

/** 清空采集题库（保留原始下载缓存与配置） */
function clearBank(subject = null) {
  const subjects = subject ? [subject] : ['k1', 'k4'];
  subjects.forEach((subj) => store.saveBank(subj, store.emptyBank(subj)));
  store.appendLog(`已清空采集题库：${subjects.join(', ')}`);
  return getStatus();
}

/** 用外部文件覆盖 / 追加题库 */
function importLocal(file, subject, mode = 'append') {
  const source = { id: 'local-import', name: `本地导入 · ${path.basename(file)}`, subject, map: {} };
  const questions = remote.importFile(file, source).map((q) => ({ ...q, subj: subject }));
  const bank = mode === 'replace' ? store.emptyBank(subject) : store.loadBank(subject);
  const merged = store.mergeQuestions(bank.questions, questions, source.name);
  bank.subject = subject;
  bank.questions = merged.questions;
  bank.updatedAt = new Date().toISOString();
  if (!bank.sources.includes(source.name)) bank.sources.push(source.name);
  store.saveBank(subject, bank);
  store.appendLog(`本地导入 ${path.basename(file)}：新增 ${merged.added} 题，重复 ${merged.duplicated} 题`);
  return { added: merged.added, duplicated: merged.duplicated, count: bank.questions.length };
}

/** 导出当前采集题库到指定文件 */
function exportBank(subject, target) {
  const bank = store.loadBank(subject);
  store.writeJson(target, bank);
  store.appendLog(`导出题库 ${subject} → ${target}`);
  return { file: target, count: bank.questions.length };
}

/** 删除原始下载缓存，下次采集将重新下载 */
function clearRawCache() {
  const dir = store.DIRS.raw;
  let removed = 0;
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach((f) => {
      fs.rmSync(path.join(dir, f), { force: true });
      removed++;
    });
  }
  const state = store.loadState();
  state.sources = {};
  store.saveState(state);
  store.appendLog(`已清理原始缓存 ${removed} 个文件`);
  return { removed };
}

module.exports = {
  runCollect,
  getStatus,
  loadCollected,
  clearBank,
  importLocal,
  exportBank,
  clearRawCache,
  DATA_ROOT: store.DATA_ROOT,
  DIRS: store.DIRS,
};
