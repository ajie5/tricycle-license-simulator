// 采集源适配器：公开列表页 HTML 解析
// 用途：抓取图文教程目录与视频目录的「标题 + 原文链接 + 时长」元数据。
// 说明：只读取公开列表页上的标题与链接，不抓取正文、不绕过任何鉴权，
//       内容仅供本程序内展示与跳转，点击后跳转到来源站点阅读 / 观看。
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

/** HTML 实体还原 */
function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** 去除标签，保留文本 */
function stripTags(html) {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** 清洗标题：去掉结尾发布日期、开头的时长标记 */
function cleanTitle(raw) {
  return String(raw || '')
    .replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*/, '')
    .replace(/\s*\d{4}-\d{2}-\d{2}\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 相对链接补全为绝对链接 */
function resolveUrl(base, href) {
  if (/^https?:\/\//i.test(href)) return href.replace(/^http:/, 'https:');
  if (!base) return href;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/**
 * 在锚点附近的片段里查找时长（仅接受 mm:ss 两组格式）
 * 三组格式多为页面上的时间戳（如 15:48:12），不视作时长
 */
function findDuration(html, index) {
  const before = html.slice(Math.max(0, index - 60), index);
  const after = html.slice(index, index + 200);
  for (const seg of [before, after]) {
    const m = seg.match(/(?:^|[^\d:])(\d{1,2}:\d{2})(?![\d:])/);
    if (m) {
      const [mm, ss] = m[1].split(':').map(Number);
      if (mm < 100 && ss < 60) return m[1].length === 4 ? `0${m[1]}` : m[1];
    }
  }
  return '';
}

/**
 * 解析列表页锚点
 * @param {string} html 页面 HTML
 * @param {Object} source 采集源配置（含 base / kind / category / rules）
 */
function parseList(html, source) {
  const rules = source.rules || {};
  const base = source.base || source.url || '';
  const hrefRe = new RegExp(rules.hrefPattern || '.+');
  const excludeRe = rules.excludeTitle ? new RegExp(rules.excludeTitle) : null;
  const minLen = Number(rules.minTitleLen) || 6;
  const maxLen = Number(rules.maxTitleLen) || 80;
  const withDuration = !!rules.dur;

  const items = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw || /^(javascript:|#|mailto:)/i.test(raw)) continue;
    if (!hrefRe.test(raw)) continue;

    const url = resolveUrl(base, raw);
    if (seen.has(url)) continue;

    const rawTitle = stripTags(m[2]);
    const durInText = withDuration ? rawTitle.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+/) : null;
    const title = cleanTitle(rawTitle);
    if (!title || title.length < minLen || title.length > maxLen) continue;
    if (excludeRe && excludeRe.test(title)) continue;

    seen.add(url);
    const item = {
      title,
      url,
      source: source.name,
      category: source.category || '',
    };
    if (withDuration) {
      item.dur = durInText ? durInText[1] : findDuration(html, m.index);
    }
    items.push(item);
  }
  return items;
}

/** 列表页采集源 */
async function collect({ source, onProgress }) {
  if (!source.url) throw new Error('未配置列表页地址');
  onProgress && onProgress(`请求列表页：${source.url}`);
  const res = await fetch(source.url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`列表页请求失败：HTTP ${res.status}`);
  const html = await res.text();

  const list = parseList(html, source);
  if (!list.length) throw new Error('未在列表页中解析到条目，请检查 hrefPattern 规则');

  const kind = source.kind === 'article' ? 'article' : 'video';
  onProgress && onProgress(`解析到 ${list.length} 条${kind === 'article' ? '图文' : '视频'}目录`);
  if (kind === 'article') {
    return { questions: [], articles: list, videos: [], meta: { version: null, parsed: list.length } };
  }
  return { questions: [], articles: [], videos: list, meta: { version: null, parsed: list.length } };
}

module.exports = { collect, parseList, cleanTitle, findDuration, resolveUrl, stripTags };
