<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/store/app';
import { PRACTICAL, PRACTICAL_FLOW, PRACTICAL_LIMIT } from '@/data/practical';
import { matchPractical } from '@/data/lookups';
import OdIcon from '@/components/OdIcon.vue';
import { fmtClock } from '@/utils/format';
import type { JudgeOption, PracticalSubject } from '@/types';

const store = useAppStore();
const router = useRouter();

/** 待考时选择的科目 */
const pickedSubject = ref<PracticalSubject>('k2');
const SUBJECT_KEYS: PracticalSubject[] = ['k2', 'k3'];

const session = computed(() => store.practical);
const mode = computed<'idle' | 'running' | 'result'>(() => {
  const s = session.value;
  if (!s) return 'idle';
  return s.state === 'done' ? 'result' : 'running';
});

const runMeta = computed(() => (session.value ? PRACTICAL[session.value.subj] : null));
const current = computed(() => store.currentPractical);
const result = computed(() => session.value?.result || null);

/** 已用时：暂停时只显示累计时间 */
const elapsedText = computed(() => {
  const s = session.value;
  if (!s) return '00:00';
  const live = s.state === 'running' ? Math.max(0, store.clock - s.lastTick) : 0;
  return fmtClock(s.elapsed + live);
});
const overLimit = computed(() => {
  const s = session.value;
  if (!s) return false;
  return s.elapsed > PRACTICAL_LIMIT[s.subj] * 60000;
});

/** 已完成评判的步骤数（当前项目内） */
const judgedInItem = computed(() => {
  const s = session.value;
  if (!s) return 0;
  const item = PRACTICAL[s.subj].items[s.itemIndex];
  return s.records.filter((r) => r.itemId === item.id).length;
});

const allJudged = computed(() => {
  const s = session.value;
  if (!s) return false;
  const items = PRACTICAL[s.subj].items;
  return (
    s.itemIndex === items.length - 1 &&
    s.stepIndex === items[items.length - 1].steps.length - 1 &&
    judgedInItem.value === items[items.length - 1].steps.length
  );
});

/** 当前步骤已有的评判记录（最后一步评判后仍停留在本页，用该记录锁定选项） */
const stepRecord = computed(() => {
  const s = session.value;
  const cur = current.value;
  if (!s || !cur) return null;
  return s.records.find((r) => r.itemId === cur.item.id && r.stepIndex === s.stepIndex) || null;
});

/** 流程条状态：已完成的项目、当前项目 */
function flowState(index: number): string {
  const s = session.value;
  if (!s) return '';
  if (index < s.itemIndex) return 'is-done';
  if (index === s.itemIndex) return 'is-now';
  return '';
}

function judgeKindLabel(kind: JudgeOption['kind']): string {
  return kind === 'ok' ? '合格' : kind === 'deduct' ? '扣分' : '不合格';
}

function judgeMark(kind: JudgeOption['kind']): string {
  return kind === 'ok' ? '✓' : kind === 'deduct' ? '−' : '×';
}

function judgeScore(option: JudgeOption): string {
  if (option.kind === 'ok') return '不扣分';
  if (option.kind === 'fail') return '不合格';
  return `−${option.points || 0} 分`;
}

/** 合格项目数 */
const passedItems = computed(() => result.value?.itemScores.filter((i) => !i.failed).length || 0);
/** 扣分合计 */
const deductedTotal = computed(() =>
  (result.value?.deductions || []).reduce((sum, r) => sum + (r.option.points || 0), 0)
);

/** 待考科目下，各实操项目对应的线上讲解资源（按项目关键词匹配采集目录） */
const relatedByItem = computed(() => {
  const key = mode.value === 'running' && session.value ? session.value.subj : pickedSubject.value;
  return PRACTICAL[key].items.map((item) => ({
    item,
    videos: store.mediaVideos.filter((v) => matchPractical(item.id, v.title)).slice(0, 4),
    articles: store.mediaArticles.filter((a) => matchPractical(item.id, a.title)).slice(0, 3),
  }));
});
const relatedCount = computed(() =>
  relatedByItem.value.reduce((sum, row) => sum + row.videos.length + row.articles.length, 0)
);

/** 考试中：当前项目的讲解资源 */
const currentRelated = computed(() => {
  const cur = current.value;
  if (!cur) return { videos: [], articles: [] };
  return {
    videos: store.mediaVideos.filter((v) => matchPractical(cur.item.id, v.title)).slice(0, 5),
    articles: store.mediaArticles.filter((a) => matchPractical(cur.item.id, a.title)).slice(0, 4),
  };
});

function start(subj: PracticalSubject) {
  pickedSubject.value = subj;
  store.startPractical(subj);
}

function confirmRestart() {
  store.openModal(
    '重新开始实操考试',
    '<p class="modal-copy">当前考试成绩与评判记录将被清空，重新从第一个项目开始。此操作不可撤销。</p>',
    [
      { label: '取消', kind: 'secondary', action: 'close' },
      { label: '重新开始', kind: 'danger', action: 'practical-restart' },
    ]
  );
}

function confirmSubmit() {
  const s = session.value;
  if (!s) return;
  const judged = s.records.length;
  const totalSteps = PRACTICAL[s.subj].items.reduce((sum, item) => sum + item.steps.length, 0);
  store.openModal(
    '提交实操考试',
    `<p class="modal-copy">本次已评判 <b>${judged}</b> 个步骤，共 <b>${totalSteps}</b> 个步骤。${
      judged < totalSteps ? '尚未评判的步骤按规范操作计，不扣分。' : '全部步骤已评判完成。'
    }提交后立即生成成绩单。</p>`,
    [
      { label: '继续考试', kind: 'secondary', action: 'close' },
      { label: '提交并评分', kind: 'primary', action: 'practical-submit' },
    ]
  );
}
</script>

<template>
  <!-- 待考：选择实操科目 -->
  <template v-if="mode === 'idle'">
    <div class="page-head">
      <div>
        <h1 class="page-title">实操考试</h1>
        <p class="page-sub">科目二场地驾驶技能与科目三道路驾驶技能，按项目逐步引导、逐项评判</p>
      </div>
      <div class="page-tools">
        <span class="tag tag-accent">满分 100 分 · 80 分及格</span>
      </div>
    </div>

    <div class="exam-grid">
      <div class="stack">
        <div class="practical-entries">
          <button
            v-for="key in SUBJECT_KEYS"
            :key="key"
            class="practical-entry"
            type="button"
            :class="{ 'is-active': pickedSubject === key }"
            @click="pickedSubject = key"
          >
            <span class="ek">{{ key === 'k2' ? '科目二 · 场地驾驶' : '科目三 · 道路驾驶' }}</span>
            <h3>{{ PRACTICAL[key].name }} · {{ PRACTICAL[key].full }}</h3>
            <p>
              {{ key === 'k2' ? '桩考、坡道定点停车与起步、单边桥、直角转弯四个项目依次进行。' : '上车准备与起步、直线行驶与变更车道、通过路口与人行横道、掉头与靠边停车。' }}
            </p>
            <span class="em">
              <span>{{ PRACTICAL[key].items.length }} 个项目</span>
              <span>{{ PRACTICAL[key].items.reduce((sum, item) => sum + item.steps.length, 0) }} 个评判步骤</span>
              <span>参考时限 {{ PRACTICAL_LIMIT[key] }} 分钟</span>
            </span>
          </button>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>考试流程 · {{ PRACTICAL[pickedSubject].name }}</h3>
            <span class="hint">按顺序完成，每步给出评判</span>
          </div>
          <div class="card-body">
            <div class="flow-line">
              <span v-for="(step, i) in PRACTICAL_FLOW[pickedSubject]" :key="step" class="flow-stop">
                <span class="n">{{ i + 1 }}</span>{{ step }}
              </span>
            </div>
            <div class="kv mt-16">
              <div v-for="item in PRACTICAL[pickedSubject].items" :key="item.id" class="kv-row">
                <span>{{ item.name }}</span>
                <b>{{ item.steps.length }} 步 · {{ item.full }} 分</b>
              </div>
            </div>
            <div class="admit-actions">
              <button class="btn btn-primary btn-lg" type="button" @click="start(pickedSubject)">
                开始{{ PRACTICAL[pickedSubject].name }}实操考试 <OdIcon name="arrowRight" size="16px" />
              </button>
              <button class="btn btn-secondary btn-lg" type="button" @click="router.push('/tutorial')">
                先看图文教程
              </button>
            </div>
            <p class="src mt-10">
              考试中可随时暂停计时；每一评判步骤均按现行考试评判标准给出扣分或不合格结论。
            </p>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>项目讲解资源 · {{ PRACTICAL[pickedSubject].name }}</h3>
            <span class="hint">
              线上采集 {{ relatedCount }} 条 · {{ store.mediaVideos.length }} 视频 / {{ store.mediaArticles.length }} 图文
            </span>
          </div>
          <div class="card-body">
            <div v-if="relatedCount" class="pv-res">
              <div v-for="row in relatedByItem" :key="row.item.id" class="pv-res-row">
                <div class="pv-res-item">
                  <span class="pv-res-name">{{ row.item.name }}</span>
                  <span class="pv-res-num">{{ row.videos.length + row.articles.length }} 条</span>
                </div>
                <div class="pv-res-links">
                  <a
                    v-for="v in row.videos"
                    :key="v.url || v.no"
                    class="pv-link"
                    :href="v.url"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <OdIcon name="play" size="12px" />
                    <span class="pv-link-title">{{ v.title }}</span>
                    <em v-if="v.dur">{{ v.dur }}</em>
                  </a>
                  <a
                    v-for="a in row.articles"
                    :key="a.url"
                    class="pv-link"
                    :href="a.url"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <OdIcon name="column" size="12px" />
                    <span class="pv-link-title">{{ a.title }}</span>
                  </a>
                  <span v-if="!row.videos.length && !row.articles.length" class="pv-empty">暂无匹配讲解</span>
                </div>
              </div>
            </div>
            <p v-else class="src">
              还没有采集到对应项目的讲解资源。到<b>数据采集</b>页执行一次采集，即可把线上图文与视频讲解目录按项目关联到这里。
            </p>
            <p class="src mt-12">
              资源来自公开教学站点，点击后在系统浏览器中打开原页面；仅作学习索引，不改变评判标准。
            </p>
          </div>
        </div>
      </div>

      <aside class="rail">
        <div class="rail-card">
          <div class="rail-head"><h3>上次实操成绩</h3><span>{{ store.pracExams.length ? store.pracExams[store.pracExams.length - 1].date : '—' }}</span></div>
          <div class="rail-body">
            <div class="rail-big">
              {{ store.pracExams.length ? store.pracExams[store.pracExams.length - 1].score : '—' }}
              <span>{{ store.pracExams.length ? '分' : '' }}</span>
            </div>
            <p class="rail-note">
              {{
                store.pracExams.length
                  ? store.pracExams[store.pracExams.length - 1].pass
                    ? '已通过及格线，可以继续巩固薄弱项目。'
                    : '未达到及格线，建议先复习扣分项再考一次。'
                  : '还没有实操考试记录。'
              }}
            </p>
            <span class="progress">
              <i :style="{ width: (store.pracExams.length ? store.pracExams[store.pracExams.length - 1].score : 0) + '%' }" />
            </span>
          </div>
        </div>

        <div class="rail-card">
          <div class="rail-head"><h3>最近实操成绩</h3><span>{{ store.pracExams.length }} 次</span></div>
          <div class="rail-body">
            <div v-if="store.pracExams.length" class="kv">
              <div v-for="(e, i) in store.pracExams.slice(-5).reverse()" :key="i" class="kv-row">
                <span>{{ e.date }} · {{ PRACTICAL[e.subj].name }}</span>
                <b>{{ e.score }} 分{{ e.pass ? ' · 合格' : ' · 不合格' }}</b>
              </div>
            </div>
            <p v-else class="src">还没有实操考试记录。</p>
          </div>
        </div>

        <div class="rail-card">
          <div class="rail-head"><h3>评判规则</h3></div>
          <div class="rail-body">
            <div class="kv">
              <div class="kv-row"><span>满分</span><b>100 分</b></div>
              <div class="kv-row"><span>及格线</span><b>80 分</b></div>
              <div class="kv-row"><span>扣分项</span><b>按标准累计扣分</b></div>
              <div class="kv-row"><span>不合格项</span><b>本次考试不合格</b></div>
            </div>
            <p class="src mt-10">出现任一不合格情形，本次考试判定为不合格，成绩记 0 分。</p>
          </div>
        </div>
      </aside>
    </div>
  </template>

  <!-- 考试中：步骤引导与评判 -->
  <template v-else-if="mode === 'running' && session && runMeta && current">
    <div class="exam-top">
      <div class="timer" :class="{ 'is-low': overLimit, 'is-paused': session.state === 'paused' }" role="timer">
        <span class="timer-label">{{ session.state === 'paused' ? '已暂停 · 累计用时' : '已用时' }}</span>
        <b>{{ elapsedText }}</b>
      </div>
      <span class="tag">{{ runMeta.name }}</span>
      <span class="tag tag-line">
        {{ session.state === 'paused' ? '已暂停' : '进行中' }} · 参考时限 {{ PRACTICAL_LIMIT[session.subj] }} 分钟
      </span>
      <span class="src">已评判 <b class="num" style="color: var(--ink)">{{ session.records.length }}</b> 步</span>
      <div class="nav-btns" style="margin-left: auto">
        <button class="btn btn-secondary btn-sm" type="button" @click="store.togglePracticalPause()">
          <OdIcon :name="session.state === 'paused' ? 'play' : 'pause'" size="14px" />
          {{ session.state === 'paused' ? '继续考试' : '暂停' }}
        </button>
        <button class="btn btn-secondary btn-sm" type="button" @click="confirmRestart">重新考试</button>
        <button class="btn btn-primary btn-sm" type="button" @click="confirmSubmit">提交试卷</button>
      </div>
    </div>

    <div class="exam-grid">
      <div class="stack">
        <div class="card">
          <div class="card-head">
            <h3>考试流程 · {{ runMeta.name }}</h3>
            <span class="hint">共 {{ runMeta.items.length }} 个项目</span>
          </div>
          <div class="card-body">
            <div class="flow-line">
              <span
                v-for="(item, i) in runMeta.items"
                :key="item.id"
                class="flow-stop"
                :class="flowState(i)"
              >
                <span class="n">{{ i + 1 }}</span>{{ item.name }}
              </span>
            </div>
          </div>
        </div>

        <div class="card qcard">
          <div class="qbar">
            <span class="qidx">项目 {{ session.itemIndex + 1 }} / {{ runMeta.items.length }}</span>
            <span class="tag">{{ current.item.name }}</span>
            <span class="tag tag-line">
              步骤 {{ session.stepIndex + 1 }} / {{ current.item.steps.length }}
            </span>
          </div>

          <div class="command">
            <OdIcon name="info" size="16px" />
            <div>
              <span class="cb">语音播报指令</span>
              <p>{{ current.step.command }}</p>
            </div>
          </div>

          <div class="explain">
            <h4>操作引导 · {{ current.step.name }}</h4>
            <p>{{ current.step.guide }}</p>
          </div>

          <div class="judge">
            <div class="judge-title">
              {{ stepRecord ? '本步已评判' : '评判本步操作' }}
              <span>
                {{
                  stepRecord
                    ? allJudged
                      ? '全部步骤已完成，请点击右下角「提交试卷」'
                      : '如需修改，请点击「撤销上一步」后重新评判'
                    : '依据《机动车驾驶人考试内容和方法》评判标准'
                }}
              </span>
            </div>
            <button
              v-for="(option, i) in current.step.options"
              :key="i"
              class="judge-btn"
              type="button"
              :disabled="!!stepRecord"
              :class="{
                'is-ok': option.kind === 'ok',
                'is-deduct': option.kind === 'deduct',
                'is-fail': option.kind === 'fail',
                'is-picked': stepRecord ? stepRecord.option.label === option.label : false,
              }"
              @click="store.judgeStep(option)"
            >
              <span class="judge-mark">{{ judgeMark(option.kind) }}</span>
              <span class="judge-body">
                {{ option.label }}
                <span class="judge-basis">{{ judgeKindLabel(option.kind) }} · {{ option.basis }}</span>
              </span>
              <span class="judge-score">{{ judgeScore(option) }}</span>
            </button>
          </div>

          <div class="qfoot">
            <span class="hint">
              {{
                session.state === 'paused'
                  ? '已暂停计时，点击「继续考试」恢复'
                  : allJudged
                    ? '全部步骤已评判完成，请点击「提交试卷」生成成绩单'
                    : '选择符合本次操作的评判结论，系统自动进入下一步'
              }}
            </span>
            <div class="nav-btns">
              <button
                class="btn btn-secondary btn-sm"
                type="button"
                :disabled="session.records.length === 0"
                @click="store.practicalMove(-1)"
              >
                撤销上一步
              </button>
              <button class="btn btn-primary btn-sm" type="button" @click="confirmSubmit">提交试卷</button>
            </div>
          </div>
        </div>
      </div>

      <aside class="rail">
        <div class="rail-card">
          <div class="rail-head">
            <h3>评判记录</h3>
            <span>{{ session.records.length }} 步</span>
          </div>
          <div class="rail-body">
            <div v-if="session.records.length" class="log-list">
              <div v-for="(r, i) in session.records.slice().reverse()" :key="i" class="log-item">
                <span class="log-kind" :class="r.option.kind">{{ judgeKindLabel(r.option.kind) }}</span>
                <span class="log-body">
                  <span class="log-name">{{ r.itemName }} · {{ r.stepName }}</span>
                  <span class="log-desc">{{ r.option.label }}</span>
                </span>
              </div>
            </div>
            <p v-else class="src">还没有评判记录。每一步的结论都会记在这里。</p>
          </div>
        </div>

        <div class="rail-card">
          <div class="rail-head"><h3>当前项目</h3><span>{{ current.item.full }} 分</span></div>
          <div class="rail-body">
            <p class="rail-note">{{ current.item.desc }}</p>
            <div class="kv">
              <div class="kv-row"><span>项目步骤</span><b>{{ current.item.steps.length }} 步</b></div>
              <div class="kv-row"><span>已评判</span><b>{{ judgedInItem }} / {{ current.item.steps.length }}</b></div>
              <div class="kv-row"><span>参考时限</span><b>{{ PRACTICAL_LIMIT[session.subj] }} 分钟</b></div>
            </div>
            <span class="progress mt-12">
              <i :style="{ width: (judgedInItem / current.item.steps.length) * 100 + '%' }" />
            </span>
            <template v-if="currentRelated.videos.length || currentRelated.articles.length">
              <div class="pv-rail-title mt-16">相关讲解 · {{ currentRelated.videos.length + currentRelated.articles.length }} 条</div>
              <a
                v-for="v in currentRelated.videos"
                :key="v.url || v.no"
                class="pv-link mt-6"
                :href="v.url"
                target="_blank"
                rel="noreferrer"
              >
                <OdIcon name="play" size="12px" />
                <span class="pv-link-title">{{ v.title }}</span>
                <em v-if="v.dur">{{ v.dur }}</em>
              </a>
              <a
                v-for="a in currentRelated.articles"
                :key="a.url"
                class="pv-link mt-6"
                :href="a.url"
                target="_blank"
                rel="noreferrer"
              >
                <OdIcon name="column" size="12px" />
                <span class="pv-link-title">{{ a.title }}</span>
              </a>
            </template>
          </div>
        </div>

        <div class="rail-card">
          <div class="rail-head"><h3>操作提示</h3></div>
          <div class="rail-body">
            <div class="tip">
              <OdIcon name="info" size="15px" />
              <span>可选择「撤销上一步」回退评判；暂停期间计时停止，可随时继续。</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </template>

  <!-- 成绩单 -->
  <template v-else-if="mode === 'result' && session && runMeta && result">
    <div class="page-head">
      <div>
        <h1 class="page-title">实操考试成绩单</h1>
        <p class="page-sub">{{ runMeta.name }} · {{ runMeta.full }} · {{ result.date }} · 用时 {{ result.used }}</p>
      </div>
      <div class="page-tools">
        <button class="btn btn-secondary" type="button" @click="router.push('/home')">返回总览</button>
        <button class="btn btn-primary" type="button" @click="store.restartPractical()">重新考试</button>
      </div>
    </div>

    <div class="result-hero" :class="{ fail: !result.pass }" data-od-id="practical-result">
      <div class="result-score">
        <span class="result-label">本次成绩</span>
        <strong>{{ result.score }}<small>分</small></strong>
        <span class="stamp">{{ result.pass ? '合格' : '不合格' }}</span>
      </div>
      <div class="result-stats">
        <div class="stat">
          <span class="stat-k">合格项目</span>
          <span class="stat-v">{{ passedItems }}<small>/ {{ runMeta.items.length }}</small></span>
          <span class="stat-f">按项目评定</span>
        </div>
        <div class="stat">
          <span class="stat-k">扣分合计</span>
          <span class="stat-v">{{ deductedTotal ? '−' + deductedTotal : '0' }}<small>分</small></span>
          <span class="stat-f">{{ result.deductions.length }} 个扣分项</span>
        </div>
        <div class="stat">
          <span class="stat-k">不合格项</span>
          <span class="stat-v">{{ result.fails.length }}<small>项</small></span>
          <span class="stat-f">{{ result.fails.length ? '本次考试判定不合格' : '未出现不合格情形' }}</span>
        </div>
        <div class="stat">
          <span class="stat-k">用时</span>
          <span class="stat-v">{{ result.used }}</span>
          <span class="stat-f">参考时限 {{ PRACTICAL_LIMIT[result.subj] }} 分钟</span>
        </div>
      </div>
    </div>

    <div class="exam-grid">
      <div class="stack">
        <div class="card">
          <div class="card-head">
            <h3>各项目得分</h3>
            <span class="hint">满分 100 分 · 及格 {{ runMeta.pass }} 分</span>
          </div>
          <table class="table">
            <thead>
              <tr>
                <th>项目</th>
                <th class="r">满分</th>
                <th class="r">扣分</th>
                <th class="r">得分</th>
                <th class="r">结论</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in result.itemScores" :key="item.name">
                <td><div style="font-weight: 600">{{ item.name }}</div></td>
                <td class="r num">{{ runMeta.items.find((x) => x.name === item.name)?.full || 0 }}</td>
                <td class="r num">{{ item.deducted ? '−' + item.deducted : '—' }}</td>
                <td class="r num">{{ item.score }}</td>
                <td class="r">
                  <span class="tag" :class="item.failed ? 'tag-err' : 'tag-ok'">
                    {{ item.failed ? '不合格' : '合格' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>{{ result.fails.length ? '不合格项' : '扣分明细' }}</h3>
            <span class="hint">{{ result.fails.length || result.deductions.length }} 条</span>
          </div>
          <div class="card-body">
            <template v-if="result.fails.length">
              <div class="log-list">
                <div v-for="(r, i) in result.fails" :key="'f' + i" class="log-item">
                  <span class="log-kind fail">不合格</span>
                  <span class="log-body">
                    <span class="log-name">{{ r.itemName }} · {{ r.stepName }}</span>
                    <span class="log-desc">{{ r.option.label }} · {{ r.option.basis }}</span>
                  </span>
                </div>
              </div>
            </template>
            <template v-else-if="result.deductions.length">
              <div class="log-list">
                <div v-for="(r, i) in result.deductions" :key="'d' + i" class="log-item">
                  <span class="log-kind deduct">−{{ r.option.points || 0 }}</span>
                  <span class="log-body">
                    <span class="log-name">{{ r.itemName }} · {{ r.stepName }}</span>
                    <span class="log-desc">{{ r.option.label }} · {{ r.option.basis }}</span>
                  </span>
                </div>
              </div>
            </template>
            <p v-else class="src">本次考试所有评判步骤均按规范操作完成，未产生扣分。</p>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>全部评判记录</h3>
            <span class="hint">{{ result.records.length }} 步</span>
          </div>
          <div class="card-body">
            <div v-if="result.records.length" class="log-list">
              <div v-for="(r, i) in result.records" :key="'r' + i" class="log-item">
                <span class="log-kind" :class="r.option.kind">{{ judgeKindLabel(r.option.kind) }}</span>
                <span class="log-body">
                  <span class="log-name">{{ r.itemName }} · {{ r.stepName }}</span>
                  <span class="log-desc">{{ r.option.label }}</span>
                </span>
              </div>
            </div>
            <p v-else class="src">未记录到评判步骤。</p>
          </div>
        </div>
      </div>

      <aside class="rail">
        <div class="rail-card">
          <div class="rail-head"><h3>成绩构成</h3></div>
          <div class="rail-body">
            <div class="kv">
              <div class="kv-row"><span>科目</span><b>{{ runMeta.name }}</b></div>
              <div class="kv-row"><span>满分</span><b>100 分</b></div>
              <div class="kv-row"><span>及格线</span><b>{{ runMeta.pass }} 分</b></div>
              <div class="kv-row"><span>评判步骤</span><b>{{ result.records.length }} 步</b></div>
              <div class="kv-row"><span>扣分合计</span><b>{{ deductedTotal ? '−' + deductedTotal : '0' }} 分</b></div>
            </div>
            <p v-if="result.fails.length" class="src mt-10">
              出现不合格情形，本次考试判定为不合格，成绩记 0 分。
            </p>
          </div>
        </div>
        <div class="rail-card">
          <div class="rail-head"><h3>下一步</h3></div>
          <div class="rail-body rail-actions">
            <button class="btn btn-primary btn-sm" type="button" @click="store.restartPractical()">重新考试</button>
            <button class="btn btn-ghost btn-sm" type="button" @click="store.closePractical()">
              返回实操首页
            </button>
            <button class="btn btn-ghost btn-sm" type="button" @click="router.push('/tutorial')">复习图文教程</button>
          </div>
        </div>
      </aside>
    </div>
  </template>
</template>

<style scoped>
/* 项目 → 线上讲解资源的关联列表 */
.pv-res {
  display: flex;
  flex-direction: column;
}
.pv-res-row {
  padding: 11px 0;
  border-bottom: 1px solid var(--line);
}
.pv-res-row:last-child {
  border-bottom: 0;
}
.pv-res-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}
.pv-res-name {
  font-size: 13px;
  font-weight: 600;
}
.pv-res-num {
  font: 500 11px var(--font-num);
  color: var(--muted);
  white-space: nowrap;
}
.pv-res-links {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pv-link {
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 5px 8px;
  border-radius: 8px;
  text-decoration: none;
  color: var(--ink);
  background: var(--fill, var(--paper-2));
  transition: background 0.13s ease;
}
.pv-link:hover {
  background: var(--line);
}
.pv-link .od-icon {
  flex: none;
  transform: translateY(1px);
  color: var(--muted);
}
.pv-link-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pv-link em {
  font: 500 10.5px var(--font-num);
  font-style: normal;
  color: var(--muted);
  white-space: nowrap;
}
.pv-empty {
  font-size: 11.5px;
  color: var(--muted);
}
.pv-rail-title {
  font: 600 11px var(--font-num);
  letter-spacing: 0.06em;
  color: var(--muted);
  margin-bottom: 6px;
}
</style>
