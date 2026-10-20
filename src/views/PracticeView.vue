<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/store/app';
import { CHAPTERS, SIGNS, SUBJECTS } from '@/data/content';
import { areaLabel, chapterName, questionSourceLabel, typeLabel } from '@/data/lookups';
import { questionImageFallback, questionImageUrl } from '@/services/collector';
import OdIcon from '@/components/OdIcon.vue';
import { LETTERS, pct } from '@/utils/format';
import type { PracticeMode } from '@/store/app';

const store = useAppStore();
const router = useRouter();

const MODES: [PracticeMode, string][] = [
  ['sequence', '顺序练习'],
  ['random', '随机练习'],
  ['chapter', '章节练习'],
  ['image', '图片题'],
  ['wrong', '错题本'],
  ['fav', '收藏夹'],
];
const MODE_NAMES: Record<PracticeMode, string> = {
  sequence: '顺序练习',
  random: '随机练习',
  chapter: '章节练习',
  image: '图片题',
  wrong: '错题本',
  fav: '收藏夹',
};

const subj = computed(() => store.subject);
const meta = computed(() => SUBJECTS[subj.value]);
const stats = computed(() => store.statsOf(subj.value));
const session = computed(() => store.practice);
const question = computed(() => store.currentQuestion);
const bank = computed(() => store.bankOf(subj.value));
const favCount = computed(() => bank.value.filter((q) => store.fav.includes(q.i)).length);
/** 题库中带插图 / 标志图的题目数量 */
const imageCount = computed(() => bank.value.filter((q) => q.img || q.imgRemote || q.sign).length);
const questionImage = computed(() => (question.value ? questionImageUrl(question.value) : null));
const imageFallback = computed(() => (question.value ? questionImageFallback(question.value) : null));
/** 图片加载失败时切换到远端地址 */
const imageFailed = ref(false);
watch(question, () => {
  imageFailed.value = false;
});
const displayImage = computed(() => (imageFailed.value ? imageFallback.value : questionImage.value));

/** 进入练习页时按当前模式准备题目 */
onMounted(() => store.ensurePractice());
watch(
  // 题库版本变化（采集题库装载完成）时也要重建本轮，否则会停留在内置题库上
  () => [store.subject, store.pmode, store.pchapter, store.banksRevision],
  () => store.ensurePractice()
);

function modeCount(mode: PracticeMode): number | null {
  if (mode === 'wrong') return stats.value.wrong;
  if (mode === 'fav') return favCount.value;
  if (mode === 'image') return imageCount.value;
  return null;
}

function optClass(i: number): string {
  const p = session.value;
  const q = question.value;
  if (!p || !q) return '';
  if (p.checked) {
    if (q.a.includes(i)) return 'is-right';
    if (p.picked.includes(i)) return 'is-wrong';
    return '';
  }
  return p.picked.includes(i) ? 'is-picked' : '';
}

function optMark(i: number): string {
  const p = session.value;
  const q = question.value;
  if (!p || !q || !p.checked) return '';
  if (q.a.includes(i)) return '正确答案';
  if (p.picked.includes(i)) return '你的选择';
  return '';
}

function openMode(mode: PracticeMode) {
  store.startPractice(mode);
}
</script>

<template>
  <div class="page-head">
    <div>
      <h1 class="page-title">题库练习</h1>
      <p class="page-sub">
        {{ store.region }} · {{ meta.name }} {{ meta.full }} · 共 {{ bank.length }} 题
      </p>
    </div>
    <div class="page-tools"><span class="tag tag-line">{{ meta.types }}</span></div>
  </div>

  <div class="mode-tabs">
    <button
      v-for="[key, label] in MODES"
      :key="key"
      class="mode-tab"
      type="button"
      :class="{ 'is-active': store.pmode === key }"
      :aria-pressed="store.pmode === key"
      @click="openMode(key)"
    >
      {{ label }}
      <span v-if="modeCount(key) !== null" class="count">{{ modeCount(key) }}</span>
    </button>
  </div>

  <div v-if="store.pmode === 'chapter'" class="chapter-bar">
    <div class="chips">
      <button
        v-for="c in CHAPTERS[subj]"
        :key="c.k"
        class="chip"
        type="button"
        :class="{ 'is-active': store.pchapter === c.k }"
        @click="store.startChapter(c.k)"
      >
        {{ c.n }}
        <span class="num">{{ bank.filter((q) => q.c === c.k).length }}</span>
      </button>
    </div>
  </div>

  <div class="practice-grid">
    <div>
      <template v-if="!session || !session.list.length">
        <div class="card empty-state">
          <div class="empty-icon">
            <OdIcon :name="store.pmode === 'wrong' ? 'check' : store.pmode === 'fav' ? 'star' : 'practice'" size="24px" />
          </div>
          <strong>
            {{
              store.pmode === 'wrong'
                ? '错题本还是空的'
                : store.pmode === 'fav'
                  ? '收藏夹还是空的'
                  : store.pmode === 'image'
                    ? '题库中还没有带图的题目'
                    : '当前条件下没有题目'
            }}
          </strong>
          <p>
            {{
              store.pmode === 'wrong'
                ? '答错的题目会自动收进这里，随时回来复习。'
                : store.pmode === 'fav'
                  ? '在练习中点击题目右上角的星标，即可收藏本题。'
                  : store.pmode === 'image'
                    ? '交通标志等图片题来自采集题库，到「数据采集」页采集一次即可练习。'
                    : '换一个章节或模式再试试。'
            }}
          </p>
          <div class="state-actions">
            <button class="btn btn-primary" type="button" @click="openMode('sequence')">开始顺序练习</button>
            <button class="btn btn-secondary" type="button" @click="router.push('/home')">返回总览</button>
          </div>
        </div>
      </template>

      <template v-else-if="session.done">
        <div class="card done-state">
          <div class="empty-icon"><OdIcon name="check" size="26px" /></div>
          <div class="big-num">{{ pct(session.correct, session.answered) }}<small>%</small></div>
          <p>本轮共作答 {{ session.answered }} 题 · 答对 {{ session.correct }} 题 · 共 {{ session.list.length }} 题</p>
          <div class="state-actions">
            <button class="btn btn-primary" type="button" @click="store.restartRound()">再练一轮</button>
            <button class="btn btn-secondary" type="button" @click="openMode('wrong')">复习错题</button>
            <button class="btn btn-ghost" type="button" @click="router.push('/home')">返回总览</button>
          </div>
        </div>
      </template>

      <template v-else-if="question">
        <div class="card qcard">
          <div class="qbar">
            <span class="qidx">第 {{ session.idx + 1 }} / {{ session.list.length }} 题</span>
            <span class="tag">{{ typeLabel(question.t) }}</span>
            <span class="tag tag-line">{{ chapterName(session.subj, question.c) }}</span>
            <span class="tag" :class="question.src?.length ? 'tag-accent' : 'tag-line'">
              {{ questionSourceLabel(question) }}
            </span>
            <span v-if="question.area" class="tag tag-line">{{ areaLabel(question) }}</span>
            <span class="spacer" />
            <button
              class="icon-btn"
              type="button"
              :class="{ 'is-fav': store.fav.includes(question.i) }"
              :title="store.fav.includes(question.i) ? '取消收藏' : '收藏本题'"
              @click="store.toggleFav()"
            >
              <svg
                class="od-icon"
                style="--od-icon-size: 18px"
                viewBox="0 0 24 24"
                :fill="store.fav.includes(question.i) ? 'currentColor' : 'none'"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.8l5.9-.9z" />
              </svg>
            </button>
          </div>
          <h2 class="stem">{{ question.q }}</h2>
          <div v-if="question.sign" class="sign" v-html="SIGNS[question.sign]" />
          <img
            v-if="displayImage"
            class="stem-media"
            :src="displayImage"
            :alt="question.q"
            @error="imageFailed = true"
          />
          <div class="opts">
            <button
              v-for="(option, i) in question.o"
              :key="i"
              class="opt"
              type="button"
              :class="optClass(i)"
              :aria-pressed="session.picked.includes(i)"
              :disabled="session.checked"
              @click="store.pickOption(i)"
            >
              <span class="opt-k">{{ LETTERS[i] }}</span>
              <span class="opt-t">{{ option }}</span>
              <span v-if="optMark(i)" class="opt-mark">{{ optMark(i) }}</span>
            </button>
          </div>

          <template v-if="session.checked">
            <div class="verdict" :class="session.ok ? 'ok' : 'err'" role="status">
              <span class="verdict-icon">
                <OdIcon :name="session.ok ? 'check' : 'close'" size="15px" />
              </span>
              <div>
                <strong>{{ session.ok ? '回答正确' : '回答错误' }}</strong>
                <span>{{ session.ok ? '这题已计入掌握记录' : '已加入错题本，稍后可以集中复习' }}</span>
              </div>
            </div>
            <div class="explain">
              <h4>解析</h4>
              <p>{{ question.e }}</p>
              <div class="basis">依据 · {{ question.b }}</div>
            </div>
          </template>

          <div class="qfoot">
            <span class="hint">
              {{
                session.checked
                  ? 'Enter 进入下一题'
                  : question.t === 'multi'
                    ? '多选题 · 选好后确认'
                    : '点击选项即判定对错'
              }}
            </span>
            <div class="nav-btns">
              <button
                class="btn btn-secondary btn-sm"
                type="button"
                :disabled="session.idx === 0"
                @click="store.practicePrev()"
              >
                上一题
              </button>
              <button
                v-if="session.checked"
                class="btn btn-primary btn-sm"
                type="button"
                @click="store.practiceNext()"
              >
                {{ session.idx === session.list.length - 1 ? '完成本轮' : '下一题' }}
              </button>
              <button
                v-else-if="question.t === 'multi'"
                class="btn btn-primary btn-sm"
                type="button"
                :disabled="!session.picked.length"
                @click="store.checkPractice()"
              >
                确认答案
              </button>
              <button v-else class="btn btn-ghost btn-sm" type="button" @click="store.practiceNext()">跳过</button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <aside class="rail">
      <div class="rail-card">
        <div class="rail-head"><h3>本轮进度</h3><span>{{ session ? MODE_NAMES[session.mode] : '' }}</span></div>
        <div class="rail-body">
          <div class="rail-big">{{ session ? session.answered : 0 }}<span>/ {{ session ? session.list.length : 0 }}</span></div>
          <p class="rail-note">
            答对 {{ session ? session.correct : 0 }} 题 · 正确率
            {{ session && session.answered ? pct(session.correct, session.answered) + '%' : '—' }}
          </p>
          <span class="progress">
            <i :style="{ width: pct(session ? session.answered : 0, session ? session.list.length : 0) + '%' }" />
          </span>
          <div class="kv">
            <div class="kv-row"><span>本轮题库</span><b>内置 {{ store.bundledCount(subj) }} + 采集 {{ store.collected[subj].length }}</b></div>
            <div class="kv-row"><span>题库已练</span><b>{{ stats.seen }} / {{ stats.total }}</b></div>
            <div class="kv-row"><span>其中图片题</span><b>{{ imageCount }} 题</b></div>
            <div class="kv-row"><span>待复习错题</span><b>{{ stats.wrong }}</b></div>
            <div class="kv-row"><span>收藏题目</span><b>{{ favCount }}</b></div>
          </div>
        </div>
      </div>
      <div class="rail-card">
        <div class="rail-head"><h3>快捷操作</h3></div>
        <div class="rail-body rail-actions">
          <button class="btn btn-ghost btn-sm" type="button" @click="store.restartRound()">重做本轮</button>
          <button class="btn btn-ghost btn-sm" type="button" @click="openMode('wrong')">去错题本</button>
          <button class="btn btn-ghost btn-sm" type="button" @click="openMode('fav')">去收藏夹</button>
        </div>
      </div>
      <div class="rail-card">
        <div class="rail-head"><h3>键盘快捷键</h3></div>
        <div class="rail-body">
          <div class="kv">
            <div class="kv-row">
              <span>选择选项</span><b><span class="kbd">A</span> — <span class="kbd">D</span></b>
            </div>
            <div class="kv-row">
              <span>确认 / 下一题</span><b><span class="kbd">Enter</span></b>
            </div>
            <div class="kv-row">
              <span>上一题 / 下一题</span><b><span class="kbd">←</span> <span class="kbd">→</span></b>
            </div>
            <div class="kv-row">
              <span>收藏本题</span><b><span class="kbd">F</span></b>
            </div>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>
