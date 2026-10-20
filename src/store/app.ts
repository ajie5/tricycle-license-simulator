/* 应用状态：集中承载题库进度、练习会话、模拟考试与实操考试逻辑，并负责本地持久化 */
import { defineStore } from 'pinia';
import { BANK, CHAPTERS, PROVINCES, SUBJECTS } from '@/data/content';
import { PRACTICAL } from '@/data/practical';
import { findQuestion, inArea } from '@/data/lookups';
import {
  bridge,
  type ArticleItemCollected,
  type BankStat,
  type CollectedBank,
  type VideoItemCollected,
} from '@/services/collector';
import { clamp, fmtClock, pct, questionKey, shuffle, todayStr } from '@/utils/format';
import type {
  BankMeta,
  ExamLog,
  ExamSession,
  JudgeOption,
  PracticalRecord,
  PracticalResult,
  PracticalSession,
  PracticalSubject,
  Question,
  SeenRecord,
  SubjectKey,
} from '@/types';

/** 页面标识 */
export type ViewKey =
  | 'home'
  | 'practice'
  | 'exam'
  | 'practical'
  | 'tutorial'
  | 'column'
  | 'bank'
  | 'collect';

/** 练习模式 */
export type PracticeMode = 'sequence' | 'random' | 'chapter' | 'image' | 'wrong' | 'fav';

/** 当前练习会话（仅存在于运行期，不持久化） */
export interface PracticeSession {
  subj: SubjectKey;
  mode: PracticeMode;
  chapter: string | null;
  list: Question[];
  idx: number;
  picked: number[];
  checked: boolean;
  ok: boolean | null;
  answers: Record<string, { pick: number[]; ok: boolean }>;
  answered: number;
  correct: number;
  done: boolean;
  /** 生成该轮题目时的题库版本号，题库变化后据此重建 */
  revision: number;
}

/** 弹窗按钮 */
export interface ModalAction {
  label: string;
  kind: 'primary' | 'secondary' | 'danger';
  action: string;
}

interface ModalState {
  open: boolean;
  title: string;
  body: string;
  actions: ModalAction[];
}

/** 学习统计 */
interface SubjectStats {
  total: number;
  seen: number;
  ok: number;
  wrong: number;
  acc: number;
}

interface AppState {
  region: string;
  subject: SubjectKey;
  seen: Record<string, SeenRecord>;
  wrong: string[];
  fav: string[];
  lastPos: Record<SubjectKey, number>;
  exams: ExamLog[];
  pracExams: PracticalResult[];
  readTut: Record<string, boolean>;
  readCol: Record<string, boolean>;
  pmode: PracticeMode;
  pchapter: string;
  tutTab: 'read' | 'video';
  tutOpen: string;
  colCat: string;
  colOpen: string | null;
  exam: ExamSession | null;
  practical: PracticalSession | null;
  practice: PracticeSession | null;
  demo: boolean;
  /** 合并后的可用题库：内置题库 + 已采集题库（去重） */
  banks: Record<SubjectKey, Question[]>;
  /** 已采集题库原始数据 */
  collected: Record<SubjectKey, Question[]>;
  /** 已采集题库元信息 */
  collectedMeta: Record<SubjectKey, BankMeta | null>;
  /** 已采集题库统计（由主进程提供） */
  collectedStats: Record<SubjectKey, BankStat | null>;
  /** 线上采集到的视频目录 */
  mediaVideos: VideoItemCollected[];
  /** 线上采集到的图文教程目录 */
  mediaArticles: ArticleItemCollected[];
  /** 线上教程目录更新时间 */
  mediaUpdatedAt: string | null;
  /** 题库版本号：每次重算可用题库时自增，用于让练习轮次跟随题库更新 */
  banksRevision: number;
  /** 等待确认切换的目标科目（当前有进行中的考试时使用） */
  pendingSubject: SubjectKey | null;
  /** 每秒刷新的时间戳，用于驱动倒计时与计时显示 */
  clock: number;
  modal: ModalState;
  message: string;
  messageOn: boolean;
}

const LS_KEY = 'tricycle-prep-v1';

/** 空档案 */
function blankState(): AppState {
  return {
    region: '江苏',
    subject: 'k1',
    seen: {},
    wrong: [],
    fav: [],
    lastPos: { k1: 0, k4: 0 },
    exams: [],
    pracExams: [],
    readTut: {},
    readCol: {},
    pmode: 'sequence',
    pchapter: 'law',
    tutTab: 'read',
    tutOpen: 't1',
    colCat: '全部',
    colOpen: null,
    exam: null,
    practical: null,
    practice: null,
    demo: false,
    banks: { k1: BANK.k1.slice(), k4: BANK.k4.slice() },
    collected: { k1: [], k4: [] },
    collectedMeta: { k1: null, k4: null },
    collectedStats: { k1: null, k4: null },
    mediaVideos: [],
    mediaArticles: [],
    mediaUpdatedAt: null,
    banksRevision: 1,
    pendingSubject: null,
    clock: Date.now(),
    modal: { open: false, title: '', body: '', actions: [] },
    message: '',
    messageOn: false,
  };
}

/** 演示档案：用于展示完整的练习记录与考试成绩 */
function seedDemo(st: AppState): AppState {
  const plan: Record<SubjectKey, Record<string, number>> = {
    k1: { law: 22, signal: 18, safety: 16, vehicle: 12 },
    k4: { civil: 6, weather: 5, emergency: 4, case: 3 },
  };
  (Object.keys(plan) as SubjectKey[]).forEach((subj) => {
    CHAPTERS[subj].forEach((ch) => {
      const list = BANK[subj].filter((q) => q.c === ch.k).slice(0, plan[subj][ch.k] || 0);
      list.forEach((q, idx) => {
        const ok = idx % 7 !== 3;
        st.seen[q.i] = { ok, pick: q.a.slice() };
        if (!ok && !st.wrong.includes(q.i)) st.wrong.push(q.i);
      });
    });
  });
  st.fav = ['k1-law-07', 'k1-sig-13', 'k1-saf-04', 'k1-veh-20', 'k4-wea-02', 'k4-eme-02'];
  st.exams = [{ subject: 'k1', score: 92, total: 100, pass: true, used: '38:12', date: '2026-10-18' }];
  st.pracExams = [
    {
      subj: 'k2',
      score: 90,
      pass: true,
      used: '07:26',
      date: '2026-10-17',
      records: [],
      fails: [],
      deductions: [],
      itemScores: [],
    },
  ];
  st.lastPos = { k1: 46, k4: 12 };
  st.demo = true;
  return st;
}

/** 读取本地档案，失败时返回 null */
function readStorage(): Partial<AppState> | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<AppState>;
  } catch {
    return null;
  }
}

let messageTimer: ReturnType<typeof setTimeout> | null = null;

export const useAppStore = defineStore('app', {
  state: (): AppState => {
    const saved = readStorage();
    const base = Object.assign(blankState(), saved || seedDemo(blankState()));
    if (!SUBJECTS[base.subject]) base.subject = 'k1';
    if (!PROVINCES.includes(base.region)) base.region = PROVINCES[0];
    if (!CHAPTERS[base.subject].some((c) => c.k === base.pchapter)) {
      base.pchapter = CHAPTERS[base.subject][0].k;
    }
    base.modal = { open: false, title: '', body: '', actions: [] };
    base.message = '';
    base.messageOn = false;
    base.pendingSubject = null;
    base.clock = Date.now();
    base.practice = null;
    base.practical = null;
    // 题库与采集数据不参与本地持久化，每次启动重新装载
    base.banks = { k1: BANK.k1.slice(), k4: BANK.k4.slice() };
    base.collected = { k1: [], k4: [] };
    base.collectedMeta = { k1: null, k4: null };
    base.collectedStats = { k1: null, k4: null };
    base.mediaVideos = [];
    base.mediaArticles = [];
    base.mediaUpdatedAt = null;
    base.banksRevision = 1;
    return base;
  },

  getters: {
    /** 指定科目当前可用的完整题库（内置 + 采集） */
    bankOf(state): (subj: SubjectKey) => Question[] {
      return (subj) => state.banks[subj];
    },
    /** 内置题库题量 */
    bundledCount(): (subj: SubjectKey) => number {
      return (subj) => BANK[subj].length;
    },
    /** 已采集的地方题库按省份分布（同一题多地归属时分别计入） */
    regionalBreakdown(state): { area: string; k1: number; k4: number; total: number }[] {
      const map = new Map<string, { area: string; k1: number; k4: number; total: number }>();
      (['k1', 'k4'] as SubjectKey[]).forEach((subj) => {
        (state.collected[subj] || []).forEach((q) => {
          const areas = q.areas && q.areas.length ? q.areas : q.area ? [q.area] : [];
          areas.forEach((a) => {
            const hit = map.get(a) || { area: a, k1: 0, k4: 0, total: 0 };
            hit[subj] += 1;
            hit.total += 1;
            map.set(a, hit);
          });
        });
      });
      return [...map.values()].sort((a, b) => b.total - a.total);
    },
    /** 当前地区可用的地方题数量（不含全国通用题） */
    regionalCountOf(state): number {
      return (['k1', 'k4'] as SubjectKey[]).reduce(
        (sum, subj) =>
          sum + (state.collected[subj] || []).filter((q) => q.area && inArea(q, state.region)).length,
        0
      );
    },
    /** 指定科目的学习统计 */
    statsOf(state): (subj: SubjectKey) => SubjectStats {
      return (subj) => {
        const qs = state.banks[subj];
        const seenQs = qs.filter((q) => state.seen[q.i]);
        const ok = seenQs.filter((q) => state.seen[q.i].ok).length;
        return {
          total: qs.length,
          seen: seenQs.length,
          ok,
          wrong: qs.filter((q) => state.wrong.includes(q.i)).length,
          acc: pct(ok, seenQs.length),
        };
      };
    },
    /** 指定科目最近一次模拟考试成绩 */
    lastExamOf(state): (subj: SubjectKey) => ExamLog | null {
      return (subj) => state.exams.filter((e) => e.subject === subj).slice(-1)[0] || null;
    },
    /** 各章节掌握情况 */
    chapterStats(state): (subj: SubjectKey) => { k: string; n: string; d: string; total: number; seen: number; acc: number; mastered: boolean }[] {
      return (subj) =>
        CHAPTERS[subj].map((ch) => {
          const qs = state.banks[subj].filter((q) => q.c === ch.k);
          const seen = qs.filter((q) => state.seen[q.i]);
          const ok = seen.filter((q) => state.seen[q.i].ok).length;
          const acc = pct(ok, seen.length);
          return {
            k: ch.k,
            n: ch.n,
            d: ch.d,
            total: qs.length,
            seen: seen.length,
            acc,
            mastered: seen.length > 0 && seen.length >= qs.length && acc >= 85,
          };
        });
    },
    /** 当前练习题目 */
    currentQuestion(state): Question | null {
      const p = state.practice;
      return p && p.list[p.idx] ? p.list[p.idx] : null;
    },
    /** 当前实操项目与步骤 */
    currentPractical(state): { item: import('@/types').PracticalItem; step: import('@/types').PracticalStep } | null {
      const s = state.practical;
      if (!s) return null;
      const item = PRACTICAL[s.subj].items[s.itemIndex];
      if (!item) return null;
      const step = item.steps[s.stepIndex];
      if (!step) return null;
      return { item, step };
    },
  },

  actions: {
    /* ── 持久化 ─────────────────────────────────────────────── */
    persist() {
      try {
        const snapshot = {
          region: this.region,
          subject: this.subject,
          seen: this.seen,
          wrong: this.wrong,
          fav: this.fav,
          lastPos: this.lastPos,
          exams: this.exams,
          pracExams: this.pracExams,
          readTut: this.readTut,
          readCol: this.readCol,
          pmode: this.pmode,
          pchapter: this.pchapter,
          tutTab: this.tutTab,
          tutOpen: this.tutOpen,
          colCat: this.colCat,
          colOpen: this.colOpen,
          exam: this.exam,
          demo: this.demo,
        };
        localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
      } catch {
        /* 本地存储不可用时静默降级，不影响使用 */
      }
    },

    /* ── 提示与弹窗 ─────────────────────────────────────────── */
    /** 每秒刷新时钟，并推进考试与实操计时 */
    tickClock() {
      this.clock = Date.now();
      this.tickExam();
      this.tickPractical();
    },
    toast(msg: string) {
      this.message = msg;
      this.messageOn = true;
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = setTimeout(() => {
        this.messageOn = false;
      }, 2200);
    },
    openModal(title: string, body: string, actions: ModalAction[]) {
      this.modal = { open: true, title, body, actions };
    },
    closeModal() {
      this.modal.open = false;
      this.pendingSubject = null;
    },

    /* ── 科目与地区 ─────────────────────────────────────────── */
    setSubject(subj: SubjectKey) {
      if (!SUBJECTS[subj] || this.subject === subj) return;
      if (this.exam && this.exam.state === 'running') {
        // 有进行中的考试时先确认，避免作答记录被直接丢弃
        this.pendingSubject = subj;
        this.openModal(
          '切换科目',
          `<p class="modal-copy">当前有一场进行中的 <b>${SUBJECTS[this.exam.subj].name}</b> 模拟考试。
            切换科目将放弃本场考试，已作答内容不会保留。</p>`,
          [
            { label: '继续考试', kind: 'secondary', action: 'close' },
            { label: '放弃并切换', kind: 'danger', action: 'subject-switch-confirm' },
          ]
        );
        return;
      }
      this.applySubject(subj);
    },

    /** 立即切换科目（放弃进行中的考试） */
    applySubject(subj: SubjectKey) {
      this.exam = null;
      this.subject = subj;
      this.pchapter = CHAPTERS[subj][0].k;
      this.practice = null;
      this.persist();
    },
    setRegion(name: string) {
      if (!PROVINCES.includes(name) || this.region === name) return;
      this.region = name;
      // 切换地区后立即按新地区重建可用题库（全国通用题 + 该省地方题）
      this.buildBanks();
      this.persist();
      this.toast(`已切换到${name}题库，可用 ${this.bankOf('k1').length + this.bankOf('k4').length} 题`);
    },

    /* ── 练习 ───────────────────────────────────────────────── */
    buildPractice(mode: PracticeMode) {
      const subj = this.subject;
      const source = this.banks[subj];
      let list: Question[];
      let chapter: string | null = null;
      if (mode === 'wrong') list = source.filter((q) => this.wrong.includes(q.i));
      else if (mode === 'fav') list = source.filter((q) => this.fav.includes(q.i));
      else if (mode === 'image') list = source.filter((q) => q.img || q.imgRemote || q.sign);
      else if (mode === 'chapter') {
        chapter = this.pchapter;
        list = source.filter((q) => q.c === chapter);
      } else if (mode === 'random') list = shuffle(source.slice());
      else list = source.slice();

      let idx = 0;
      if (mode === 'sequence' && list.length) idx = clamp(this.lastPos[subj] || 0, 0, list.length - 1);
      this.practice = {
        subj,
        mode,
        chapter,
        list,
        idx,
        picked: [],
        checked: false,
        ok: null,
        answers: {},
        answered: 0,
        correct: 0,
        done: false,
        revision: this.banksRevision,
      };
      if (mode === 'sequence') this.lastPos[subj] = idx;
    },

    ensurePractice() {
      if (this.pmode === 'chapter' && !CHAPTERS[this.subject].some((c) => c.k === this.pchapter)) {
        this.pchapter = CHAPTERS[this.subject][0].k;
      }
      const p = this.practice;
      // 题库变化（首次装载采集题库、采集完成、导入或清空）时重建本轮题目，
      // 否则练习会一直停留在装载前的题库上
      const staleBanks = !!p && p.revision !== this.banksRevision;
      if (
        !p ||
        p.subj !== this.subject ||
        p.mode !== this.pmode ||
        (p.mode === 'chapter' && p.chapter !== this.pchapter) ||
        staleBanks
      ) {
        const lostProgress = staleBanks && p.answered > 0;
        this.buildPractice(this.pmode);
        if (lostProgress) this.toast('题库已更新，本轮练习已按最新题库重新开始');
      }
    },

    startPractice(mode: PracticeMode) {
      const same = this.practice && this.practice.mode === mode && this.practice.subj === this.subject && !this.practice.done;
      this.pmode = mode;
      if (this.pmode === 'chapter' && !CHAPTERS[this.subject].some((c) => c.k === this.pchapter)) {
        this.pchapter = CHAPTERS[this.subject][0].k;
      }
      if (!same) this.practice = null;
      this.persist();
    },

    startChapter(chapter: string) {
      this.pmode = 'chapter';
      this.pchapter = chapter;
      this.practice = null;
      this.persist();
    },

    /** 重做本轮练习 */
    restartRound() {
      if (!this.practice) {
        this.buildPractice(this.pmode);
        return;
      }
      const p = this.practice;
      p.idx = 0;
      p.picked = [];
      p.checked = false;
      p.ok = null;
      p.answers = {};
      p.answered = 0;
      p.correct = 0;
      p.done = false;
      if (p.mode === 'sequence') this.lastPos[p.subj] = 0;
      this.persist();
    },

    pickOption(i: number) {
      const p = this.practice;
      if (!p || p.done || p.checked) return;
      const q = this.currentQuestion;
      if (!q || i >= q.o.length) return;
      if (q.t === 'multi') {
        const at = p.picked.indexOf(i);
        if (at > -1) p.picked.splice(at, 1);
        else p.picked.push(i);
        p.picked.sort((a, b) => a - b);
      } else {
        p.picked = [i];
        this.checkPractice();
      }
    },

    checkPractice() {
      const p = this.practice;
      if (!p || p.done || p.checked) return;
      const q = this.currentQuestion;
      if (!q || !p.picked.length) return;
      const ok = p.picked.length === q.a.length && q.a.every((a) => p.picked.includes(a));
      p.checked = true;
      p.ok = ok;
      p.answers[q.i] = { pick: p.picked.slice(), ok };
      p.answered = Object.keys(p.answers).length;
      p.correct = Object.values(p.answers).filter((a) => a.ok).length;
      this.recordAnswer(q, ok, p.picked);
      if (p.mode === 'sequence') this.lastPos[p.subj] = p.idx;
      this.persist();
    },

    goIdx(n: number) {
      const p = this.practice;
      if (!p) return;
      p.idx = clamp(n, 0, p.list.length - 1);
      const q = this.currentQuestion;
      const a = q ? p.answers[q.i] : null;
      p.picked = a ? a.pick.slice() : [];
      p.checked = !!a;
      p.ok = a ? a.ok : null;
      if (p.mode === 'sequence') this.lastPos[p.subj] = p.idx;
      this.persist();
    },

    practiceNext() {
      const p = this.practice;
      if (!p) return;
      if (p.idx < p.list.length - 1) this.goIdx(p.idx + 1);
      else {
        p.done = true;
        this.persist();
      }
    },

    practicePrev() {
      const p = this.practice;
      if (!p || p.idx === 0) return;
      this.goIdx(p.idx - 1);
    },

    toggleFav() {
      const p = this.practice;
      if (!p || p.done) return;
      const q = this.currentQuestion;
      if (!q) return;
      const at = this.fav.indexOf(q.i);
      if (at > -1) this.fav.splice(at, 1);
      else this.fav.push(q.i);
      this.persist();
      this.toast(at > -1 ? '已取消收藏' : '已加入收藏夹');
    },

    /** 记录一次作答：更新掌握记录与错题本 */
    recordAnswer(q: Question, ok: boolean, pick: number[]) {
      this.seen[q.i] = { ok, pick: pick.slice() };
      const at = this.wrong.indexOf(q.i);
      if (ok && at > -1) this.wrong.splice(at, 1);
      if (!ok && at === -1) this.wrong.push(q.i);
    },

    clearWrong() {
      this.wrong = [];
      if (this.practice && this.practice.mode === 'wrong') this.practice = null;
      this.persist();
      this.toast('错题本已清空');
    },

    /* ── 理论模拟考试 ───────────────────────────────────────── */
    startExam() {
      const subj = this.subject;
      const meta = SUBJECTS[subj];
      const pool = this.banks[subj];
      // 按考试规则抽取固定题量（摩托车科目一 / 科目四均为 50 题）
      const size = clamp(meta.paperSize, 1, pool.length);
      const items = shuffle(pool.map((q) => q.i)).slice(0, size);
      const now = Date.now();
      this.exam = {
        subj,
        items,
        answers: {},
        flags: [],
        idx: 0,
        started: now,
        endsAt: now + meta.minutes * 60000,
        state: 'running',
      };
      this.persist();
      this.toast(`${meta.name}模拟考试开始，共 ${items.length} 题，限时 ${meta.minutes} 分钟`);
    },

    examAnswered(): number {
      const ex = this.exam;
      if (!ex) return 0;
      return ex.items.filter((id) => (ex.answers[id] || []).length).length;
    },

    examPick(i: number) {
      const ex = this.exam;
      if (!ex || ex.state !== 'running') return;
      const q = findQuestion(this.banks[ex.subj], ex.items[ex.idx]);
      if (!q || i >= q.o.length) return;
      const cur = ex.answers[q.i] || [];
      if (q.t === 'multi') {
        const at = cur.indexOf(i);
        if (at > -1) cur.splice(at, 1);
        else cur.push(i);
        cur.sort((a, b) => a - b);
        ex.answers[q.i] = cur;
      } else {
        ex.answers[q.i] = [i];
      }
      this.persist();
    },

    examMove(dir: number) {
      const ex = this.exam;
      if (!ex || ex.state !== 'running') return;
      ex.idx = clamp(ex.idx + dir, 0, ex.items.length - 1);
      this.persist();
    },

    examJump(i: number) {
      const ex = this.exam;
      if (!ex || ex.state !== 'running') return;
      ex.idx = clamp(i, 0, ex.items.length - 1);
      this.persist();
    },

    toggleExamFlag() {
      const ex = this.exam;
      if (!ex || ex.state !== 'running') return;
      const id = ex.items[ex.idx];
      const at = ex.flags.indexOf(id);
      if (at > -1) ex.flags.splice(at, 1);
      else ex.flags.push(id);
      this.persist();
    },

    askSubmitExam() {
      const ex = this.exam;
      if (!ex || ex.state !== 'running') return;
      const un = ex.items.length - this.examAnswered();
      this.openModal(
        '确认交卷',
        `<p class="modal-copy">
          本次共 ${ex.items.length} 题，已答 ${this.examAnswered()} 题${
            un ? `，还有 <b style="color:var(--red-ink)">${un} 题未作答</b>` : '，全部题目已作答'
          }。
          交卷后立即评分，未作答的题目按错误计入成绩。
        </p>`,
        [
          { label: '继续答题', kind: 'secondary', action: 'close' },
          { label: '确认交卷', kind: 'primary', action: 'exam-confirm-submit' },
        ]
      );
    },

    submitExam(auto = false) {
      const ex = this.exam;
      if (!ex || ex.state !== 'running') return;
      const meta = SUBJECTS[ex.subj];
      let correct = 0;
      let answered = 0;
      const wrong: { id: string; pick: number[] }[] = [];
      const pool = this.banks[ex.subj];

      ex.items.forEach((id) => {
        const q = findQuestion(pool, id);
        if (!q) return;
        const pick = (ex.answers[id] || []).slice();
        const ok = pick.length === q.a.length && q.a.every((a) => pick.includes(a));
        if (pick.length) {
          answered++;
          this.recordAnswer(q, ok, pick);
        } else if (!this.wrong.includes(q.i)) {
          this.wrong.push(q.i);
        }
        if (ok) correct++;
        else wrong.push({ id, pick });
      });

      // 按单题分值折算并封顶 100 分（兼容历史留存试卷的题量）
      const score = clamp(correct * meta.per, 0, 100);
      const pass = score >= meta.pass;
      const used = fmtClock(Math.min(Date.now() - ex.started, meta.minutes * 60000));

      ex.state = 'done';
      ex.result = { score, correct, total: ex.items.length, answered, pass, used, wrong, date: todayStr() };
      this.exams.push({ subject: ex.subj, score, total: ex.items.length, pass, used, date: todayStr() });
      this.persist();
      if (auto) this.toast('考试时间到，已自动交卷');
    },

    /** 每秒推进：检查考试是否到时 */
    tickExam() {
      const ex = this.exam;
      if (!ex || ex.state !== 'running') return;
      if (Date.now() >= ex.endsAt) this.submitExam(true);
    },

    /* ── 实操考试 ───────────────────────────────────────────── */
    startPractical(subj: PracticalSubject) {
      this.practical = {
        subj,
        itemIndex: 0,
        stepIndex: 0,
        records: [],
        elapsed: 0,
        state: 'running',
        startedAt: Date.now(),
        lastTick: Date.now(),
      };
      this.persist();
      this.toast(`${PRACTICAL[subj].name}实操考试开始`);
    },

    /** 每秒推进计时（暂停时不累加） */
    tickPractical() {
      const s = this.practical;
      if (!s || s.state !== 'running') return;
      const now = Date.now();
      s.elapsed += now - s.lastTick;
      s.lastTick = now;
    },

    /** 暂停 / 继续 */
    togglePracticalPause() {
      const s = this.practical;
      if (!s || s.state === 'done') return;
      const now = Date.now();
      if (s.state === 'running') {
        s.elapsed += now - s.lastTick;
        s.state = 'paused';
        this.toast('考试已暂停，计时停止');
      } else {
        s.lastTick = now;
        s.state = 'running';
        this.toast('继续考试，计时恢复');
      }
    },

    /** 对当前步骤给出评判，并进入下一步 */
    judgeStep(option: JudgeOption) {
      const s = this.practical;
      const cur = this.currentPractical;
      if (!s || !cur || s.state === 'done') return;
      // 同一步骤只记录一次评判，避免重复点击产生多余记录（最后一步时会看似卡住）
      if (s.records.some((r) => r.itemId === cur.item.id && r.stepIndex === s.stepIndex)) return;
      const record: PracticalRecord = {
        itemId: cur.item.id,
        itemName: cur.item.name,
        stepIndex: s.stepIndex,
        stepName: cur.step.name,
        command: cur.step.command,
        option,
      };
      s.records.push(record);
      const isLastItem = s.itemIndex === PRACTICAL[s.subj].items.length - 1;
      const isLastStep = s.stepIndex === cur.item.steps.length - 1;
      if (isLastItem && isLastStep) {
        // 最后一步完成后停留在步骤页，由用户主动交卷
        s.stepIndex = cur.item.steps.length - 1;
        this.toast('全部步骤已评判完成，可提交试卷');
        return;
      }
      this.practicalMove(1);
    },

    /** 步骤/项目前后移动，回退时撤销最近的评判记录 */
    practicalMove(dir: number) {
      const s = this.practical;
      if (!s || s.state === 'done') return;
      const items = PRACTICAL[s.subj].items;
      if (dir < 0) {
        if (s.stepIndex > 0) {
          s.stepIndex--;
        } else if (s.itemIndex > 0) {
          s.itemIndex--;
          s.stepIndex = items[s.itemIndex].steps.length - 1;
        } else {
          return;
        }
        if (s.records.length) s.records.pop();
      } else {
        const cur = items[s.itemIndex];
        if (s.stepIndex < cur.steps.length - 1) {
          s.stepIndex++;
        } else if (s.itemIndex < items.length - 1) {
          s.itemIndex++;
          s.stepIndex = 0;
        } else {
          return;
        }
      }
      this.persist();
    },

    /** 提交实操考试并生成成绩 */
    submitPractical() {
      const s = this.practical;
      if (!s || s.state === 'done') return;
      const meta = PRACTICAL[s.subj];
      const now = Date.now();
      if (s.state === 'running') s.elapsed += now - s.lastTick;

      const records = s.records.slice();
      let deducted = 0;
      const fails: PracticalRecord[] = [];
      const deductions: PracticalRecord[] = [];
      records.forEach((r) => {
        if (r.option.kind === 'fail') fails.push(r);
        if (r.option.kind === 'deduct') {
          deducted += r.option.points || 0;
          deductions.push(r);
        }
      });

      const hasFail = fails.length > 0;
      // 出现不合格情形时，本次考试判定为不合格
      const score = hasFail ? 0 : clamp(100 - deducted, 0, 100);
      const pass = !hasFail && score >= meta.pass;

      const itemScores = meta.items.map((item) => {
        const recs = records.filter((r) => r.itemId === item.id);
        const itemFail = recs.some((r) => r.option.kind === 'fail');
        const itemDeducted = recs.reduce((sum, r) => sum + (r.option.kind === 'deduct' ? r.option.points || 0 : 0), 0);
        return {
          name: item.name,
          score: itemFail ? 0 : Math.max(0, item.full - itemDeducted),
          deducted: itemDeducted,
          failed: itemFail,
        };
      });

      const result: PracticalResult = {
        subj: s.subj,
        score,
        pass,
        used: fmtClock(s.elapsed),
        date: todayStr(),
        records,
        fails,
        deductions,
        itemScores,
      };
      s.result = result;
      s.state = 'done';
      this.pracExams.push(result);
      this.persist();
      this.toast(pass ? '实操考试合格，已生成成绩单' : '实操考试不合格，请查看扣分明细');
    },

    /** 重新开始实操考试 */
    restartPractical() {
      const subj = this.practical ? this.practical.subj : 'k2';
      this.practical = null;
      this.startPractical(subj);
    },

    /** 离开成绩单，回到实操考试首页 */
    closePractical() {
      this.practical = null;
    },

    /* ── 教程与专栏 ─────────────────────────────────────────── */
    setTutTab(tab: 'read' | 'video') {
      this.tutTab = tab;
      this.persist();
    },
    setTutOpen(id: string) {
      this.tutOpen = id;
      this.persist();
    },
    toggleTutRead() {
      const id = this.tutOpen;
      this.readTut[id] = !this.readTut[id];
      this.persist();
      this.toast(this.readTut[id] ? '已标记为已读' : '已标记为未读');
    },
    setColCat(cat: string) {
      this.colCat = cat;
      this.persist();
    },
    openArticle(id: string) {
      this.colOpen = id;
      this.readCol[id] = true;
      this.persist();
    },
    closeArticle() {
      this.colOpen = null;
      this.persist();
    },

    /* ── 采集题库（桌面端由 Electron 主进程提供） ─────────────── */
    /**
     * 重新计算可用题库：全国通用题 + 当前地区地方题（采集优先，再补内置题库中未重复的题目）。
     * 切换地区、采集完成、导入或清空后都会重算。
     */
    buildBanks() {
      const region = this.region;
      (['k1', 'k4'] as SubjectKey[]).forEach((subj) => {
        // 采集题库放在前面，顺序练习与章节练习会优先使用采集到的题目
        const merged = (this.collected[subj] || []).filter((q) => inArea(q, region)).slice();
        const seen = new Set(merged.map((q) => questionKey(q)));
        BANK[subj].forEach((q) => {
          const key = questionKey(q);
          if (seen.has(key)) return;
          seen.add(key);
          merged.push(q);
        });
        this.banks[subj] = merged;
      });
      // 题库变化后自增版本号，让练习轮次与考试抽题范围跟随更新
      this.banksRevision += 1;
    },

    /** 装载采集题库；采集数据不可用时继续使用内置题库 */
    async loadCollectedBank() {
      const api = bridge();
      if (!api) return;
      try {
        const results = await Promise.all([api.collector.collected('k1'), api.collector.collected('k4')]);
        const apply = (payload: CollectedBank) => ({
          questions: payload.questions || [],
          meta: {
            subject: payload.subject as SubjectKey,
            version: payload.version,
            updatedAt: payload.updatedAt,
            sources: payload.sources || [],
            count: payload.count || (payload.questions || []).length,
          } satisfies BankMeta,
        });
        const [k1, k4] = results.map(apply);
        this.collected = { k1: k1.questions, k4: k4.questions };
        this.collectedMeta = { k1: k1.meta, k4: k4.meta };
        this.buildBanks();
      } catch {
        /* 采集数据读取失败时静默降级，不影响内置题库使用 */
      }
    },

    /** 刷新采集统计信息 */
    async refreshCollectorStatus() {
      const api = bridge();
      if (!api) return;
      try {
        const status = await api.collector.status();
        this.collectedStats = { k1: status.banks.k1, k4: status.banks.k4 };
        this.mediaVideos = status.videos?.items || [];
        this.mediaArticles = status.articles?.items || [];
        this.mediaUpdatedAt = status.articles?.updatedAt || status.videos?.updatedAt || null;
      } catch {
        /* 忽略 */
      }
    },

    /** 采集完成后重新装载题库与统计 */
    async reloadAfterCollect() {
      await this.loadCollectedBank();
      await this.refreshCollectorStatus();
    },

    /* ── 数据管理 ───────────────────────────────────────────── */
    loadDemo() {
      const region = this.region;
      const subject = this.subject;
      const collected = this.collected;
      const collectedMeta = this.collectedMeta;
      const collectedStats = this.collectedStats;
      const mediaVideos = this.mediaVideos;
      const mediaArticles = this.mediaArticles;
      const mediaUpdatedAt = this.mediaUpdatedAt;
      Object.assign(this.$state, seedDemo(blankState()), { region, subject });
      // 采集题库与线上教程目录不属于学习档案，重置后保留
      this.collected = collected;
      this.collectedMeta = collectedMeta;
      this.collectedStats = collectedStats;
      this.mediaVideos = mediaVideos;
      this.mediaArticles = mediaArticles;
      this.mediaUpdatedAt = mediaUpdatedAt;
      this.buildBanks();
      this.persist();
      this.toast('已载入演示档案');
    },
    resetData() {
      const region = this.region;
      const subject = this.subject;
      const collected = this.collected;
      const collectedMeta = this.collectedMeta;
      const collectedStats = this.collectedStats;
      const mediaVideos = this.mediaVideos;
      const mediaArticles = this.mediaArticles;
      const mediaUpdatedAt = this.mediaUpdatedAt;
      Object.assign(this.$state, blankState(), { region, subject });
      this.collected = collected;
      this.collectedMeta = collectedMeta;
      this.collectedStats = collectedStats;
      this.mediaVideos = mediaVideos;
      this.mediaArticles = mediaArticles;
      this.mediaUpdatedAt = mediaUpdatedAt;
      this.buildBanks();
      this.persist();
      this.toast('学习记录已重置');
    },

    /** 弹窗按钮分发 */
    async handleModalAction(action: string) {
      switch (action) {
        case 'close':
          this.closeModal();
          break;
        case 'collect-clear-bank': {
          this.closeModal();
          const api = bridge();
          if (api) {
            await api.collector.clearBank(null);
            await this.reloadAfterCollect();
            this.toast('采集题库已清空');
          }
          break;
        }
        case 'collect-clear-cache': {
          this.closeModal();
          const api = bridge();
          if (api) {
            await api.collector.clearCache();
            this.toast('原始缓存已清理，下次采集将重新下载');
          }
          break;
        }
        case 'subject-switch-confirm': {
          const target = this.pendingSubject;
          this.closeModal();
          if (target) this.applySubject(target);
          break;
        }
        case 'exam-confirm-submit':
          this.closeModal();
          this.submitExam(false);
          break;
        case 'reset-data':
          this.closeModal();
          this.resetData();
          break;
        case 'demo-confirm':
          this.closeModal();
          this.loadDemo();
          break;
        case 'practical-restart':
          this.closeModal();
          this.restartPractical();
          break;
        case 'practical-submit':
          this.closeModal();
          this.submitPractical();
          break;
      }
    },
  },
});
