<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/store/app';
import { SUBJECTS } from '@/data/content';
import { SHORT_CHAPTER, typeLabel } from '@/data/lookups';
import OdIcon from '@/components/OdIcon.vue';
import StatusPill from '@/components/StatusPill.vue';
import { clamp, pct } from '@/utils/format';
import type { PracticeMode } from '@/store/app';

const store = useAppStore();
const router = useRouter();

const subj = computed(() => store.subject);
const meta = computed(() => SUBJECTS[subj.value]);
const stats = computed(() => store.statsOf(subj.value));
const chapters = computed(() => store.chapterStats(subj.value));
const bank = computed(() => store.bankOf(subj.value));
const total = computed(() => bank.value.length);

/** 继续上次练习的落点 */
const contPos = computed(() => clamp(store.lastPos[subj.value] || 0, 0, total.value - 1));
const cont = computed(() => bank.value[contPos.value] || bank.value[0]);
const contChapter = computed(() => store.chapterStats(subj.value).find((c) => c.k === cont.value.c)?.n || '综合');
const lastExam = computed(() => store.lastExamOf(subj.value));
const wrongList = computed(() =>
  bank.value
    .filter((q) => store.wrong.includes(q.i))
    .slice(-3)
    .reverse()
);
const k1Count = computed(() => store.bankOf('k1').length);
const k4Count = computed(() => store.bankOf('k4').length);

const examStopState = computed(() => (lastExam.value ? (lastExam.value.pass ? 'is-done' : 'is-now') : ''));

function goPractice(mode: PracticeMode) {
  store.startPractice(mode);
  router.push('/practice');
}

function startChapter(chapter: string) {
  store.startChapter(chapter);
  router.push('/practice');
}

function checkUpdate() {
  store.openModal(
    '检查题库更新',
    `<p class="modal-copy">当前版本 <b class="num">v2026.10.08</b>，已是最新。上次检查：2026-10-08 09:12。</p>
     <div class="kv mt-12">
       <div class="kv-row"><span>本月新增</span><b>12 题</b></div>
       <div class="kv-row"><span>修订解析</span><b>7 条</b></div>
       <div class="kv-row"><span>覆盖地区</span><b>31 个省级行政区</b></div>
     </div>
     <p class="src mt-12">题库更新为离线包形式，正式版本会在联网时自动检查并提示。</p>`,
    [{ label: '知道了', kind: 'primary', action: 'close' }]
  );
}
</script>

<template>
  <div class="page-head">
    <div>
      <span class="folio">档案 01 · 学习总览 · {{ store.region }}</span>
      <h1 class="page-title">
        学习总览
        <span v-if="store.demo" class="tag tag-line">演示档案</span>
      </h1>
      <p class="page-sub">{{ meta.name }} {{ meta.full }} · 题库 v2026.10.08 已校验</p>
    </div>
    <div class="page-tools">
      <button class="text-link" type="button" @click="checkUpdate">
        题库已最新 <OdIcon name="refresh" size="13px" />
      </button>
    </div>
  </div>

  <section class="lead" data-od-id="home-continue">
    <div class="lead-main">
      <span class="kicker"><i></i>继续上次练习 · 第 {{ contPos + 1 }} 题</span>
      <h2 class="lead-title">{{ contChapter }}</h2>
      <p class="lead-quote">
        上一题停在「{{ cont.q.length > 34 ? cont.q.slice(0, 34) + '…' : cont.q }}」，按顺序把这一章练完，再进入模拟考试。
      </p>
      <div class="lead-meta">
        <span>第 {{ contPos + 1 }} / {{ total }} 题</span>
        <span>{{ typeLabel(cont.t) }}</span>
        <span>{{ store.region }}题库</span>
        <span>科目 {{ subj === 'k1' ? '一' : '四' }}</span>
      </div>
      <div class="lead-actions">
        <button class="btn btn-primary btn-lg" type="button" @click="goPractice('sequence')">
          继续练习 <OdIcon name="arrowRight" size="16px" />
        </button>
        <button class="btn btn-secondary btn-lg" type="button" @click="router.push('/exam')">模拟考试</button>
        <button class="text-link" type="button" @click="goPractice('wrong')">
          复习错题{{ stats.wrong ? ` · ${stats.wrong} 道` : '' }}
        </button>
      </div>
    </div>
    <aside class="lead-side">
      <div class="ledger">
        <div class="ledger-row"><span>题库进度</span><b>{{ pct(stats.seen, stats.total) }}<small>%</small></b></div>
        <div class="ledger-row"><span>正确率</span><b>{{ stats.acc }}<small>%</small></b></div>
        <div class="ledger-row"><span>错题待复习</span><b>{{ stats.wrong }}<small>道</small></b></div>
        <div class="ledger-row">
          <span>上次模拟</span>
          <b>{{ lastExam ? lastExam.score : '—' }}<small>{{ lastExam ? '分' : '' }}</small></b>
        </div>
      </div>
      <div class="lead-progress"><i :style="{ width: pct(stats.seen, stats.total) + '%' }" /></div>
      <span class="lead-foot">已练 {{ stats.seen }} / {{ stats.total }} 题 · 答对 {{ stats.ok }} 题</span>
    </aside>
  </section>

  <section class="route-block" data-od-id="home-route">
    <div class="route-head">
      <h2>备考路线 · {{ meta.name }}</h2>
      <span>四章知识 + 一次模拟，按顺序走完</span>
    </div>
    <div class="route-track">
      <div
        v-for="(c, i) in chapters"
        :key="c.k"
        class="route-stop"
        :class="c.seen === 0 ? '' : c.mastered ? 'is-done' : 'is-now'"
      >
        <span class="route-dot">{{ i + 1 }}</span>
        <span class="route-copy">
          <b class="route-name">{{ SHORT_CHAPTER[c.k] || c.n }}</b>
          <span class="route-meta">{{ c.seen ? `${c.acc}% · ${c.seen}/${c.total}` : '未开始' }}</span>
        </span>
      </div>
      <div class="route-stop" :class="examStopState">
        <span class="route-dot"><OdIcon name="flag" size="12px" /></span>
        <span class="route-copy">
          <b class="route-name">模拟考试</b>
          <span class="route-meta">{{ lastExam ? `上次 ${lastExam.score} 分` : '未参加' }}</span>
        </span>
      </div>
    </div>
  </section>

  <div class="home-grid">
    <section class="register-section">
      <div class="section-head">
        <h2>章节掌握</h2>
        <span>按正确率统计 · 共 {{ total }} 题</span>
      </div>
      <div class="register">
        <button
          v-for="(c, i) in chapters"
          :key="c.k"
          class="register-row"
          type="button"
          @click="startChapter(c.k)"
        >
          <span class="register-index">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="register-copy">
            <span class="register-name">{{ c.n }}</span>
            <span class="register-desc">{{ c.d }}</span>
          </span>
          <span class="register-bar"><i :style="{ width: Math.min(100, c.acc) + '%' }" /></span>
          <span class="register-pct">{{ c.seen ? `${c.acc}%` : '—' }}</span>
          <StatusPill :seen="c.seen" :total="c.total" :acc="c.acc" />
        </button>
      </div>
    </section>

    <aside class="home-margin">
      <div class="margin-block" data-od-id="home-rules">
        <div class="margin-head"><h3>考试要点</h3><span class="label">D 照</span></div>
        <div class="ledger">
          <div class="ledger-row"><span>题量</span><b>{{ total }}<small>题</small></b></div>
          <div class="ledger-row"><span>时长</span><b>{{ meta.minutes }}<small>分钟</small></b></div>
          <div class="ledger-row"><span>及格线</span><b>{{ meta.pass }}<small>分</small></b></div>
          <div class="ledger-row"><span>题型</span><b>{{ meta.types }}</b></div>
          <div class="ledger-row"><span>单题分值</span><b>{{ meta.per }} 分</b></div>
        </div>
        <button class="text-link mt-12" type="button" @click="router.push('/exam')">
          进入全真模拟 <OdIcon name="arrowRight" size="13px" />
        </button>
      </div>

      <div class="margin-block" data-od-id="home-wrong">
        <div class="margin-head"><h3>最近错题</h3><span class="folio">{{ stats.wrong }} 题待复习</span></div>
        <template v-if="wrongList.length">
          <div v-for="q in wrongList" :key="q.i" class="wrong-item">
            <div class="wrong-q od-clamp-2">{{ q.q }}</div>
            <div class="wrong-meta">{{ store.chapterStats(subj).find((c) => c.k === q.c)?.n }}</div>
          </div>
        </template>
        <div v-else class="wrong-item">
          <div class="wrong-q muted">还没有错题。答错的题目会自动收进这里。</div>
        </div>
        <button class="text-link mt-10" type="button" @click="goPractice('wrong')">
          去复习错题 <OdIcon name="arrowRight" size="13px" />
        </button>
      </div>

      <div class="margin-block" data-od-id="home-bank">
        <div class="margin-head"><h3>题库状态</h3><span class="folio">已校验</span></div>
        <div class="version">{{ store.collectedMeta[subj]?.version || '内置题库' }}</div>
        <p class="src">{{ store.region }} · 科目一 {{ k1Count }} 题 / 科目四 {{ k4Count }} 题</p>
        <button class="text-link mt-10" type="button" @click="checkUpdate">
          检查题库更新 <OdIcon name="refresh" size="13px" />
        </button>
        <button class="text-link mt-10" type="button" @click="router.push('/collect')">
          数据采集与定时更新 <OdIcon name="arrowRight" size="13px" />
        </button>
      </div>
    </aside>
  </div>

  <div class="reading-grid" data-od-id="home-topics">
    <button class="reading-card reading-card--ink" type="button" @click="router.push('/tutorial')">
      <span class="folio">图文 / 视频教程</span>
      <span class="reading-title">把每个考试项目拆成可以重复练习的动作</span>
      <span class="reading-copy">8 组图文分解与 6 段课程目录，覆盖科目二、科目三的实操要点。</span>
      <span class="reading-meta">8 篇图文 · 6 段视频 →</span>
    </button>
    <button class="reading-card" type="button" @click="router.push('/column')">
      <span class="folio">安全驾驶专栏</span>
      <span class="reading-title">装载、雨天、头盔、充电：日常用车的六个关键问题</span>
      <span class="reading-copy">不针对考试，只讲清一台三轮车每天都会遇到的风险。</span>
      <span class="reading-meta">6 篇专栏 · 持续更新 →</span>
    </button>
  </div>
</template>
