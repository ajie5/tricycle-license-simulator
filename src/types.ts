/* 全局类型定义：题库、内容、进度与实操考试的数据结构 */

/** 理论科目：k1 = 科目一，k4 = 科目四 */
export type SubjectKey = 'k1' | 'k4';

/** 练习与考试题型 */
export type QuestionType = 'single' | 'judge' | 'multi';

/** 理论题目 */
export interface Question {
  /** 题目唯一编号 */
  i: string;
  /** 所属章节 key，对应 CHAPTERS */
  c: string;
  /** 题型 */
  t: QuestionType;
  /** 题干 */
  q: string;
  /** 选项 */
  o: string[];
  /** 正确选项下标集合 */
  a: number[];
  /** 答案解析 */
  e: string;
  /** 解析依据 */
  b: string;
  /** 题干配图（对应 SIGNS 中的键，内置题库使用） */
  sign?: string;
  /** 本地图片相对路径（采集题库使用，位于数据目录 images/ 下） */
  img?: string;
  /** 图片远端地址（本地图片缺失时的兜底） */
  imgRemote?: string;
  /** 地方题库归属省份（采集题库使用，如「江苏」「重庆」；无省份归属的地方题记为「通用」） */
  area?: string | null;
  /** 同一题属于多个地方题库时保留的全部省份 */
  areas?: string[];
  /** 题目来源标记，多来源合并时保留 */
  src?: string[];
}

/** 采集题库数据集元信息 */
export interface BankMeta {
  subject: SubjectKey;
  version: string | null;
  updatedAt: string | null;
  sources: string[];
  count: number;
}

/** 理论科目元数据 */
export interface SubjectMeta {
  name: string;
  full: string;
  /** 考试限时（分钟） */
  minutes: number;
  /** 及格分 */
  pass: number;
  /** 单题分值 */
  per: number;
  /** 一次模拟考试的抽题量 */
  paperSize: number;
  /** 题型说明 */
  types: string;
}

/** 章节 */
export interface Chapter {
  k: string;
  n: string;
  d: string;
}

/** 图文教程 */
export interface Tutorial {
  id: string;
  no: string;
  title: string;
  tag: string;
  meta: string;
  dek: string;
  steps: string[];
  tips: string[];
}

/** 视频课程目录 */
export interface VideoItem {
  no: string;
  title: string;
  dur: string;
  desc: string;
}

/** 专栏文章 */
export interface Article {
  id: string;
  cat: string;
  title: string;
  dek: string;
  meta: string;
  body: string;
}

/** 单题作答记录 */
export interface SeenRecord {
  ok: boolean;
  pick: number[];
}

/** 一次模拟考试成绩 */
export interface ExamLog {
  subject: SubjectKey;
  score: number;
  total: number;
  pass: boolean;
  used: string;
  date: string;
}

/** 模拟考试错题条目 */
export interface ExamWrongItem {
  id: string;
  pick: number[];
}

/** 模拟考试结果 */
export interface ExamResult {
  score: number;
  correct: number;
  total: number;
  answered: number;
  pass: boolean;
  used: string;
  wrong: ExamWrongItem[];
  date: string;
}

/** 进行中的模拟考试会话 */
export interface ExamSession {
  subj: SubjectKey;
  items: string[];
  answers: Record<string, number[]>;
  flags: string[];
  idx: number;
  /** 开始时间戳 */
  started: number;
  /** 截止时间戳 */
  endsAt: number;
  state: 'running' | 'done';
  result?: ExamResult;
}

/* ── 实操考试 ───────────────────────────────────────────────────────── */

/** 实操作业科目 */
export type PracticalSubject = 'k2' | 'k3';

/** 实操评判性质：合格 / 扣分 / 不合格 */
export type JudgeKind = 'ok' | 'deduct' | 'fail';

/** 单个操作步骤的评判选项 */
export interface JudgeOption {
  /** 评判描述 */
  label: string;
  /** 评判性质 */
  kind: JudgeKind;
  /** 扣分值（kind 为 deduct 时生效） */
  points?: number;
  /** 扣分依据 */
  basis: string;
}

/** 实操考试项目中的一个步骤 */
export interface PracticalStep {
  /** 步骤名称 */
  name: string;
  /** 语音播报指令 */
  command: string;
  /** 操作引导要点 */
  guide: string;
  /** 该步骤的评判选项，第一项为规范操作 */
  options: JudgeOption[];
}

/** 实操考试项目（科目二/科目三中的一项） */
export interface PracticalItem {
  id: string;
  name: string;
  /** 项目说明 */
  desc: string;
  /** 满分（用于成绩构成展示） */
  full: number;
  steps: PracticalStep[];
}

/** 实操科目元数据 */
export interface PracticalMeta {
  name: string;
  full: string;
  pass: number;
  /** 项目构成 */
  items: PracticalItem[];
}

/** 一步的评判记录 */
export interface PracticalRecord {
  itemId: string;
  itemName: string;
  stepIndex: number;
  stepName: string;
  command: string;
  option: JudgeOption;
}

/** 进行中的实操考试会话 */
export interface PracticalSession {
  subj: PracticalSubject;
  itemIndex: number;
  stepIndex: number;
  records: PracticalRecord[];
  /** 已用时（毫秒，暂停时不累加） */
  elapsed: number;
  state: 'running' | 'paused' | 'done';
  startedAt: number;
  /** 上一次计时推进的时间戳，用于暂停/继续 */
  lastTick: number;
  /** 结果（交卷后生成） */
  result?: PracticalResult;
}

/** 实操考试成绩 */
export interface PracticalResult {
  subj: PracticalSubject;
  score: number;
  pass: boolean;
  used: string;
  date: string;
  records: PracticalRecord[];
  /** 出现的不合格项 */
  fails: PracticalRecord[];
  /** 扣分项 */
  deductions: PracticalRecord[];
  /** 按项目汇总得分 */
  itemScores: { name: string; score: number; deducted: number; failed: boolean }[];
}
