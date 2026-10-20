/* 桌面端能力桥接：封装 Electron 主进程提供的采集接口，浏览器环境下自动降级 */
import type { Question } from '@/types';

/** 采集源配置 */
export interface CollectorSourceConfig {
  id: string;
  name: string;
  type: string;
  desc?: string;
  enabled: boolean;
  url?: string;
  dbUrls?: string[];
  dbUrl?: string;
  dbFile?: string;
  repoSlug?: string;
  repoBranch?: string;
  repoPath?: string;
  subject?: string;
  map?: Record<string, string>;
}

export interface CollectorSchedule {
  enabled: boolean;
  intervalHours: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastResult?: { ok: boolean; message: string } | null;
}

export interface CollectorConfig {
  version: number;
  updatedAt: string | null;
  includeRegional: boolean;
  schedule: CollectorSchedule;
  sources: CollectorSourceConfig[];
}

/** 配置更新补丁：支持局部更新定时策略、地区过滤与数据源 */
export interface CollectorConfigPatch {
  schedule?: Partial<CollectorSchedule>;
  includeRegional?: boolean;
  sources?: CollectorSourceConfig[];
}

export interface BankStat {
  subject: string;
  count: number;
  version: string | null;
  updatedAt: string | null;
  sources: string[];
  bytes: number;
}

export interface DataFile {
  path: string;
  size: number;
  mtime: string;
}

export interface VideoItemCollected {
  no: string;
  title: string;
  dur: string;
  desc: string;
  url?: string;
  source?: string;
  /** 来源页归类：科目二 / 科目三 / 学车视频 / 图文讲解 */
  category?: string;
}

/** 线上图文教程目录条目（标题 + 原文链接） */
export interface ArticleItemCollected {
  title: string;
  url: string;
  source?: string;
  category?: string;
}

/** 线上教程目录（图文 / 视频） */
export interface MediaCatalogue<T> {
  updatedAt: string | null;
  sources?: string[];
  items: T[];
}

export interface CollectorStatus {
  dataRoot: string;
  config: CollectorConfig;
  banks: { k1: BankStat; k4: BankStat };
  videos: MediaCatalogue<VideoItemCollected>;
  articles: MediaCatalogue<ArticleItemCollected>;
  files: DataFile[];
  logs: string[];
}

export interface CollectorEvent {
  type: 'log' | 'start' | 'done' | 'error';
  message?: string;
  summary?: CollectorSummary;
  at?: string;
}

export interface CollectorSummary {
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  totalQuestions: { k1: number; k4: number };
  videos: number;
  articles: number;
  sources: { id: string; name: string; ok: boolean; message: string; added: number; parsed: number }[];
  errors: { source: string; message: string }[];
}

export interface CollectedBank {
  subject: string;
  version: string | null;
  updatedAt: string | null;
  sources: string[];
  count: number;
  questions: Question[];
}

interface TricycleBridge {
  isDesktop: boolean;
  mediaBase: string;
  dataRoot: () => Promise<string>;
  collector: {
    status: () => Promise<CollectorStatus>;
    run: (payload?: { sourceIds?: string[] }) => Promise<{ ok: boolean; summary?: CollectorSummary; message?: string }>;
    saveConfig: (patch: CollectorConfigPatch) => Promise<CollectorStatus>;
    collected: (subject: string, limit?: number) => Promise<CollectedBank>;
    clearBank: (subject?: string | null) => Promise<CollectorStatus>;
    clearCache: () => Promise<{ ok: boolean; removed: number }>;
    importFile: (payload: { filePath: string; subject: string; mode?: string }) => Promise<{ ok: boolean; added?: number; duplicated?: number; count?: number; message?: string }>;
    exportBank: (payload: { subject: string }) => Promise<{ ok: boolean; file?: string; count?: number; message?: string; canceled?: boolean }>;
    pickFile: (payload?: { title?: string }) => Promise<{ canceled: boolean; filePath?: string }>;
    openDataDir: () => Promise<{ ok: boolean; message?: string }>;
    refreshSchedule: () => Promise<CollectorStatus>;
    onEvent: (cb: (event: CollectorEvent) => void) => () => void;
  };
}

declare global {
  interface Window {
    tricycle?: TricycleBridge;
  }
}

/** 浏览器端只读数据桥：开发模式下通过 Vite 中间件读取本机 data/ 目录 */
const httpBridge: TricycleBridge = {
  isDesktop: false,
  mediaBase: '/__media__/',
  dataRoot: () => Promise.resolve('（浏览器模式：见 Vite 开发服务的 data 目录）'),
  collector: {
    status: async () => {
      const res = await fetch('/__collector__/status');
      if (!res.ok) throw new Error('采集数据不可用');
      return (await res.json()) as CollectorStatus;
    },
    run: async () => ({ ok: false, message: '采集功能需要在桌面端运行' }),
    saveConfig: async () => {
      throw new Error('配置修改需要在桌面端运行');
    },
    collected: async (subject) => {
      const res = await fetch(`/__collector__/bank?subject=${subject}`);
      if (!res.ok) throw new Error('采集题库不可用');
      return (await res.json()) as CollectedBank;
    },
    clearBank: async () => {
      throw new Error('清空题库需要在桌面端运行');
    },
    clearCache: async () => {
      throw new Error('清理缓存需要在桌面端运行');
    },
    importFile: async () => ({ ok: false, message: '导入需要在桌面端运行' }),
    exportBank: async () => ({ ok: false, message: '导出需要在桌面端运行' }),
    pickFile: async () => ({ canceled: true }),
    openDataDir: async () => ({ ok: false, message: '打开目录需要在桌面端运行' }),
    refreshSchedule: async () => {
      throw new Error('定时调度需要在桌面端运行');
    },
    onEvent: () => () => {},
  },
};

export function bridge(): TricycleBridge | null {
  if (typeof window === 'undefined') return null;
  if (window.tricycle) return window.tricycle;
  // 开发模式下退回只读 HTTP 桥，生产构建中该接口不存在，请求失败后自动忽略
  return import.meta.env.DEV ? httpBridge : null;
}

/** 是否运行在桌面端（采集功能仅在桌面端可用） */
export function isDesktop(): boolean {
  return !!bridge()?.isDesktop;
}

/** 题图地址：桌面端优先读取本地图片，浏览器端使用远端地址 */
export function questionImageUrl(question: Question): string | null {
  const desktop = isDesktop();
  if (desktop && question.img) return `${bridge()?.mediaBase || 'tricycle-media://local/'}${question.img}`;
  if (question.imgRemote) return question.imgRemote;
  if (question.img) return `${bridge()?.mediaBase || 'tricycle-media://local/'}${question.img}`;
  return null;
}

/** 本地图片加载失败时的兜底地址 */
export function questionImageFallback(question: Question): string | null {
  return question.imgRemote || null;
}
