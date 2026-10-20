<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/store/app';
import { CHAPTERS, SIGNS, SUBJECTS } from '@/data/content';
import { chapterName, findQuestion, questionSourceLabel, typeLabel } from '@/data/lookups';
import { questionImageFallback, questionImageUrl } from '@/services/collector';
import OdIcon from '@/components/OdIcon.vue';
import { LETTERS, fmtClock, pct } from '@/utils/format';
import type { ExamResult, Question } from '@/types';

const store = useAppStore();
const router = useRouter();

const exam = computed(() => store.exam);
const mode = computed<'idle' | 'running' | 'result'>(() => {
  const ex = exam.value;
  if (ex && ex.state === 'running') return 'running';
  if (ex && ex.state === 'done' && ex.result) return 'result';
  return 'idle';
});

const subj = computed(() => store.subject);
const meta = computed(() => SUBJECTS[subj.value]);
/** 当前科目可用题库（内置 + 采集） */
const bank = computed(() => store.bankOf(subj.value));
/** 一次考试的抽题量：按考试规则固定，题库不足时取实际题量 */
const paperSize = computed(() => Math.min(meta.value.paperSize, bank.value.length));
const lastExam = computed(() => store.lastExamOf(subj.value));
const recentExams = computed(() => store.exams.slice(-5).reverse());
const answered = computed(() => store.examAnswered());

/** 答题卡与题目只依赖当前科目与进行中的试卷 */
const currentQuestion = computed(() => {
  const ex = exam.value;
  if (!ex) return null;
  return findQuestion(store.bankOf(ex.subj), ex.items[ex.idx]);
});
const currentImage = computed(() => (currentQuestion.value ? questionImageUrl(currentQuestion.value) : null));
const currentImageFallback = computed(() =>
  currentQuestion.value ? questionImageFallback(currentQuestion.value) : null
);
const imageFailed = ref(false);
watch(currentQuestion, () => {
  imageFailed.value = false;
});
const displayImage = computed(() => (imageFailed.value ? currentImageFallback.value : currentImage.value));
const picked = computed(() => {
  const ex = exam.value;
  const q = currentQuestion.value;
  if (!ex || !q) return [] as number[];
  return ex.answers[q.i] || [];
});
const remaining = computed(() => {
  const ex = exam.value;
  if (!ex) return 0;
  return Math.max(0, ex.endsAt - store.clock);
});
const isLow = computed(() => remaining.value <= 300000);
const flagged = computed(() => {
  const ex = exam.value;
  if (!ex) return false;
  return ex.flags.includes(ex.items[ex.idx]);
});

const result = computed<ExamResult | null>(() => exam.value?.result || null);
const wrongItems = computed(() => {
  const r = result.value;
  const ex = exam.value;
  if (!r || !ex) return [];
  const pool = store.bankOf(ex.subj);
  return r.wrong
    .map((w) => {
      const q = findQuestion(pool, w.id);
      return q ? { q, pick: w.pick } : null;
    })
    .filter((x): x is { q: NonNullable<ReturnType<typeof findQuestion>>; pick: number[] } => x !== null);
});

function sheetClass(id: string, index: number): string {
  const ex = exam.value;
  if (!ex) return '';
  const cls: string[] = [];
  if ((ex.answers[id] || []).length) cls.push('done');
  if (index === ex.idx) cls.push('cur');
  if (ex.flags.includes(id)) cls.push('flag');
  return cls.join(' ');
}

/** 未作答时的确认提示 */
function confirmSubmit() {
  store.askSubmitExam();
}

/** 再考一次 */
function retry() {
  store.startExam();
}

/** 错题解析中的配图 */
function reviewImage(q: Question): string | null {
  return questionImageUrl(q);
}
</script>

<template>
  <!-- 待考：准考证 -->
  <template v-if="mode === 'idle'">
    <div class="page-head">
      <div>
        <h1 class="page-title">模拟考试</h1>
        <p class="page-sub">按真实考试规则抽题、计时、评分，交卷后逐题解析</p>
      </div>
      <div class="page-tools">
        <span class="tag tag-accent"><OdIcon name="clock" size="13px" /> 限时 {{ meta.minutes }} 分钟</span>
      </div>
    </div>

    <div class="exam-grid">
      <div class="stack">
        <section class="admit" data-od-id="exam-admit">
          <div class="admit-band">
            <span class="kicker on-dark"><i></i>模拟考试 · 准考证</span>
            <span class="admit-code">D 照 · {{ store.region }} · v2026.10.08</span>
            <h2>{{ meta.name }}</h2>
            <p>{{ meta.full }}</p>
          </div>
          <div class="admit-body">
            <div class="admit-rules">
              <div><span>题量</span><b>{{ paperSize }}<small>题</small></b></div>
              <div><span>时长</span><b>{{ meta.minutes }}<small>分钟</small></b></div>
              <div><span>及格线</span><b>{{ meta.pass }}<small>分</small></b></div>
            </div>

            <div class="notice">
              <h3>考试须知</h3>
              <ul>
                <li>题目从当前题库（共 {{ bank.length }} 题）中随机抽取 {{ paperSize }} 题，题型为{{ meta.types }}。</li>
                <li>单题 {{ meta.per }} 分，满分 100 分，{{ meta.pass }} 分及格；答错或未答均不得分。</li>
                <li>计时结束自动交卷；交卷后立即出分，并展示全部错题解析。</li>
                <li>考试过程中可随时标记疑问、通过答题卡跳转，不会中断计时。</li>
              </ul>
            </div>

            <div class="admit-actions">
              <button class="btn btn-primary btn-lg" type="button" @click="store.startExam()">
                开始模拟考试 <OdIcon name="arrowRight" size="16px" />
              </button>
              <button class="btn btn-secondary btn-lg" type="button" @click="store.startPractice('random'); router.push('/practice')">
                先做一组随机练习
              </button>
            </div>
            <p class="src mt-10">开始后计时立即启动，请确认已准备好。考试过程中计时不会中断。</p>
          </div>
        </section>

        <div class="card">
          <div class="card-head"><h3>本次抽题范围</h3><span class="hint">{{ meta.name }} · 共 {{ bank.length }} 题</span></div>
          <div class="card-body">
            <div class="kv">
              <div v-for="c in CHAPTERS[subj]" :key="c.k" class="kv-row">
                <span>{{ c.n }}</span><b>{{ bank.filter((q) => q.c === c.k).length }} 题</b>
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside class="rail">
        <div class="rail-card">
          <div class="rail-head"><h3>上次成绩</h3><span>{{ lastExam ? lastExam.date : '—' }}</span></div>
          <div class="rail-body">
            <div class="rail-big">{{ lastExam ? lastExam.score : '—' }}<span>{{ lastExam ? '分' : '' }}</span></div>
            <p class="rail-note">
              {{
                lastExam
                  ? lastExam.pass
                    ? '已通过及格线，可以继续巩固错题。'
                    : '未达到及格线，建议先复习错题再考一次。'
                  : '还没有本科目成绩。'
              }}
            </p>
            <span class="progress"><i :style="{ width: (lastExam ? lastExam.score : 0) + '%' }" /></span>
          </div>
        </div>

        <div class="rail-card">
          <div class="rail-head"><h3>最近成绩</h3><span>{{ store.exams.length }} 次</span></div>
          <div class="rail-body">
            <div v-if="recentExams.length" class="kv">
              <div v-for="(e, i) in recentExams" :key="i" class="kv-row">
                <span>{{ e.date }} · {{ SUBJECTS[e.subject].name }}</span>
                <b>{{ e.score }} 分{{ e.pass ? ' · 合格' : ' · 不合格' }}</b>
              </div>
            </div>
            <p v-else class="src">还没有考试记录。</p>
          </div>
        </div>

        <div class="rail-card">
          <div class="rail-head"><h3>成绩判定</h3></div>
          <div class="rail-body">
            <div class="kv">
              <div class="kv-row"><span>满分</span><b>100 分</b></div>
              <div class="kv-row"><span>及格线</span><b>{{ meta.pass }} 分</b></div>
              <div class="kv-row"><span>单题分值</span><b>{{ meta.per }} 分</b></div>
              <div class="kv-row"><span>正式考试机会</span><b>1 次 + 1 次补考</b></div>
            </div>
            <p class="src mt-10">模拟成绩仅用于自测，不代表正式考试结果。</p>
          </div>
        </div>
      </aside>
    </div>
  </template>

  <!-- 答题中 -->
  <template v-else-if="mode === 'running' && exam && currentQuestion">
    <div class="exam-top">
      <div class="timer" :class="{ 'is-low': isLow }" role="timer" aria-label="剩余时间">
        <span class="timer-label">剩余时间</span>
        <b>{{ fmtClock(remaining) }}</b>
      </div>
      <span class="tag">{{ SUBJECTS[exam.subj].name }}</span>
      <span class="tag tag-line">{{ typeLabel(currentQuestion.t) }}</span>
      <span class="src">已答 <b class="num" style="color: var(--ink)">{{ answered }}</b> / {{ exam.items.length }}</span>
      <button class="btn btn-secondary btn-sm" type="button" @click="confirmSubmit">交卷</button>
    </div>

    <div class="exam-grid">
      <div class="card qcard">
        <div class="qbar">
          <span class="qidx">第 {{ exam.idx + 1 }} / {{ exam.items.length }} 题</span>
          <span class="tag tag-line">{{ chapterName(exam.subj, currentQuestion.c) }}</span>
          <span class="tag" :class="currentQuestion.src?.length ? 'tag-accent' : 'tag-line'">
            {{ questionSourceLabel(currentQuestion) }}
          </span>
          <span class="spacer" />
          <button
            class="icon-btn"
            type="button"
            :class="{ 'is-on': flagged }"
            :title="flagged ? '取消标记' : '标记为疑问'"
            @click="store.toggleExamFlag()"
          >
            <svg
              class="od-icon"
              style="--od-icon-size: 18px"
              viewBox="0 0 24 24"
              :fill="flagged ? 'currentColor' : 'none'"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M6 21V4h11l-1.8 4L17 12H6" />
            </svg>
          </button>
        </div>
        <h2 class="stem">{{ currentQuestion.q }}</h2>
        <div v-if="currentQuestion.sign" class="sign" v-html="SIGNS[currentQuestion.sign]" />
        <img
          v-if="displayImage"
          class="stem-media"
          :src="displayImage"
          :alt="currentQuestion.q"
          @error="imageFailed = true"
        />
        <div class="opts">
          <button
            v-for="(option, i) in currentQuestion.o"
            :key="i"
            class="opt"
            type="button"
            :class="{ 'is-picked': picked.includes(i) }"
            :aria-pressed="picked.includes(i)"
            @click="store.examPick(i)"
          >
            <span class="opt-k">{{ LETTERS[i] }}</span>
            <span class="opt-t">{{ option }}</span>
            <span v-if="picked.includes(i)" class="opt-mark">已选</span>
          </button>
        </div>
        <div class="qfoot">
          <span class="hint">
            {{
              currentQuestion.t === 'multi'
                ? '多选题 · 可选择多个答案'
                : currentQuestion.t === 'judge'
                  ? '判断题 · 按 A / B 或数字键作答'
                  : '单选题 · 按 A — D 或数字键作答'
            }}{{ flagged ? ' · 已标记疑问' : '' }}
          </span>
          <div class="nav-btns">
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              :disabled="exam.idx === 0"
              @click="store.examMove(-1)"
            >
              上一题
            </button>
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              :disabled="exam.idx === exam.items.length - 1"
              @click="store.examMove(1)"
            >
              下一题
            </button>
          </div>
        </div>
      </div>

      <aside class="rail">
        <div class="rail-card">
          <div class="rail-head"><h3>答题卡</h3><span>{{ answered }} / {{ exam.items.length }}</span></div>
          <div class="rail-body">
            <div class="sheet">
              <button
                v-for="(id, i) in exam.items"
                :key="id"
                type="button"
                :class="sheetClass(id, i)"
                :aria-label="`第 ${i + 1} 题`"
                @click="store.examJump(i)"
              >
                {{ i + 1 }}
              </button>
            </div>
            <div class="legend">
              <span><i class="d" />已答</span>
              <span><i class="f" />疑问</span>
              <span><i />未答</span>
            </div>
            <button class="btn btn-primary btn-wide mt-16" type="button" @click="confirmSubmit">交卷并评分</button>
            <p class="src mt-10">交卷后立即评分，并逐题展示解析。</p>
          </div>
        </div>
        <div class="rail-card">
          <div class="rail-head"><h3>考试信息</h3></div>
          <div class="rail-body">
            <div class="kv">
              <div class="kv-row"><span>科目</span><b>{{ SUBJECTS[exam.subj].name }}</b></div>
              <div class="kv-row"><span>题量</span><b>{{ exam.items.length }} 题</b></div>
              <div class="kv-row"><span>单题分值</span><b>{{ SUBJECTS[exam.subj].per }} 分</b></div>
              <div class="kv-row"><span>及格线</span><b>{{ SUBJECTS[exam.subj].pass }} 分</b></div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </template>

  <!-- 成绩单 -->
  <template v-else-if="mode === 'result' && exam && result">
    <div class="page-head">
      <div>
        <h1 class="page-title">模拟考试结果</h1>
        <p class="page-sub">
          {{ SUBJECTS[exam.subj].name }} · {{ result.date }} · 用时 {{ result.used }}
        </p>
      </div>
      <div class="page-tools">
        <button class="btn btn-secondary" type="button" @click="router.push('/home')">返回总览</button>
        <button class="btn btn-primary" type="button" @click="retry">再考一次</button>
      </div>
    </div>

    <div class="result-hero" :class="{ fail: !result.pass }" data-od-id="exam-result">
      <div class="result-score">
        <span class="result-label">本次成绩</span>
        <strong>{{ result.score }}<small>分</small></strong>
        <span class="stamp">{{ result.pass ? '合格' : '未合格' }}</span>
      </div>
      <div class="result-stats">
        <div class="stat">
          <span class="stat-k">答对</span>
          <span class="stat-v">{{ result.correct }}<small>/ {{ result.total }}</small></span>
          <span class="stat-f">正确率 {{ pct(result.correct, result.total) }}%</span>
        </div>
        <div class="stat">
          <span class="stat-k">答错</span>
          <span class="stat-v">{{ result.answered - result.correct }}<small>题</small></span>
          <span class="stat-f">已加入错题本</span>
        </div>
        <div class="stat">
          <span class="stat-k">未答</span>
          <span class="stat-v">{{ result.total - result.answered }}<small>题</small></span>
          <span class="stat-f">按错误计分</span>
        </div>
        <div class="stat">
          <span class="stat-k">用时</span>
          <span class="stat-v">{{ result.used }}</span>
          <span class="stat-f">限时 {{ SUBJECTS[exam.subj].minutes }} 分钟</span>
        </div>
      </div>
    </div>

    <div class="exam-grid">
      <div class="card">
        <div class="card-head"><h3>错题解析</h3><span class="hint">{{ wrongItems.length }} 题</span></div>
        <template v-if="wrongItems.length">
          <div v-for="(item, idx) in wrongItems" :key="item.q.i" class="review-item">
            <div class="review-q">{{ idx + 1 }}. {{ item.q.q }}</div>
            <img
              v-if="reviewImage(item.q)"
              class="review-media"
              :src="reviewImage(item.q) || ''"
              :alt="item.q.q"
            />
            <div class="review-a">
              <span>你的答案 <del>{{ item.pick.length ? item.pick.map((i) => LETTERS[i]).join('') : '未作答' }}</del></span>
              <span>正确答案 <b>{{ item.q.a.map((i) => LETTERS[i]).join('') }}</b></span>
              <span>{{ chapterName(exam.subj, item.q.c) }}</span>
            </div>
            <div class="review-exp">{{ item.q.e }}</div>
          </div>
        </template>
        <div v-else class="empty-state">
          <div class="empty-icon"><OdIcon name="check" size="26px" /></div>
          <strong>全部答对</strong>
          <p>本次没有错题，保持这个状态。</p>
        </div>
      </div>
      <aside class="rail">
        <div class="rail-card">
          <div class="rail-head"><h3>成绩构成</h3></div>
          <div class="rail-body">
            <div class="kv">
              <div class="kv-row"><span>科目</span><b>{{ SUBJECTS[exam.subj].name }}</b></div>
              <div class="kv-row"><span>满分</span><b>100 分</b></div>
              <div class="kv-row"><span>及格线</span><b>{{ SUBJECTS[exam.subj].pass }} 分</b></div>
              <div class="kv-row"><span>单题分值</span><b>{{ SUBJECTS[exam.subj].per }} 分</b></div>
              <div class="kv-row"><span>答题数</span><b>{{ result.answered }} / {{ result.total }}</b></div>
            </div>
          </div>
        </div>
        <div class="rail-card">
          <div class="rail-head"><h3>下一步</h3></div>
          <div class="rail-body rail-actions">
            <button class="btn btn-primary btn-sm" type="button" @click="retry">再考一次</button>
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              @click="store.startPractice('wrong'); router.push('/practice')"
            >
              复习本次错题
            </button>
            <button class="btn btn-ghost btn-sm" type="button" @click="router.push('/home')">返回总览</button>
          </div>
        </div>
      </aside>
    </div>
  </template>
</template>
