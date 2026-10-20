/* 通用格式化与数学工具 */

export const clamp = (n: number, a: number, b: number): number => Math.max(a, Math.min(b, n));

export const pct = (a: number, b: number): number => (b ? Math.round((a / b) * 100) : 0);

/** 毫秒 → mm:ss 计时文本 */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 当前日期 YYYY-MM-DD */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 就地洗牌并返回原数组 */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** 选项序号 → 字母 */
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

/** 题干归一化指纹：用于合并内置题库与采集题库时去重 */
export function questionKey(q: { t: string; q: string; o: string[] }): string {
  const norm = String(q.q || '')
    .replace(/\s+/g, '')
    .replace(/[。，,、？?！!（）()【】[\]“”"'’]/g, '');
  return `${q.t}|${norm}|${(q.o || []).join('|')}`;
}
