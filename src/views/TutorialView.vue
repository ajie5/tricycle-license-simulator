<script setup lang="ts">
import { computed } from 'vue';
import { useAppStore } from '@/store/app';
import { TUTORIALS, VIDEOS } from '@/data/content';
import { tutorialFigure } from '@/data/tutorialFigures';
import OdIcon from '@/components/OdIcon.vue';
import { clamp } from '@/utils/format';

const store = useAppStore();

/** 与科目二 / 科目三 实操相关的关键词，用于筛选线上采集目录 */
const PRACTICAL_RE =
  /科目[一二三四]|科[一二三四]|桩考|绕桩|倒车入库|倒库|侧方停车|坡道|定点停车|半坡|直角转弯|单边桥|曲线行驶|S弯|靠边停车|掉头|变更车道|直线行驶|灯光|起步|后视镜|路口|人行横道|摩托|三轮|场地|路考|实操/;

/** 线上采集到的视频课程（与实操相关的排在前面） */
const onlineVideos = computed(() => {
  const builtin = new Set(VIDEOS.map((v) => v.title));
  return store.mediaVideos
    .filter((v) => v.title && !builtin.has(v.title))
    .sort((a, b) => Number(PRACTICAL_RE.test(b.title)) - Number(PRACTICAL_RE.test(a.title)));
});

/** 与实操相关的线上视频 */
const practicalVideos = computed(() => onlineVideos.value.filter((v) => PRACTICAL_RE.test(v.title)));

/** 图文教程页只展示前若干个视频，其余到「视频课程」页查看 */
const previewVideos = computed(() => onlineVideos.value.slice(0, 9));

/** 线上采集到的图文教程（含科目二 / 三 关键词的优先） */
const onlineArticles = computed(() =>
  store.mediaArticles
    .slice()
    .sort((a, b) => Number(PRACTICAL_RE.test(b.title)) - Number(PRACTICAL_RE.test(a.title)))
);

const practicalArticles = computed(() => onlineArticles.value.filter((a) => PRACTICAL_RE.test(a.title)));

const readCount = computed(() => TUTORIALS.filter((t) => store.readTut[t.id]).length);
const current = computed(() => TUTORIALS.find((t) => t.id === store.tutOpen) || TUTORIALS[0]);
const currentIndex = computed(() => TUTORIALS.indexOf(current.value));
const isRead = computed(() => !!store.readTut[current.value.id]);
const figure = computed(() => tutorialFigure(current.value.id));

function move(dir: number) {
  const n = clamp(currentIndex.value + dir, 0, TUTORIALS.length - 1);
  store.setTutOpen(TUTORIALS[n].id);
}

/** 内置课程不含视频文件，点击弹出大纲说明 */
function openBuiltin(no: string) {
  const v = VIDEOS.find((x) => x.no === no);
  if (!v) return;
  store.openModal(
    v.title,
    `<div class="player">
       <span class="play"><OdIcon name="play" size="20px" /></span>
       <strong>${v.no} · ${v.dur || '时长未知'}</strong>
       <span>内置课程目录，正式版本中此处播放实拍课程，支持倍速与章节跳转。</span>
     </div>
     <div class="kv mt-16">
       <div class="kv-row"><span>课程编号</span><b>${v.no}</b></div>
       <div class="kv-row"><span>时长</span><b>${v.dur || '—'}</b></div>
       <div class="kv-row"><span>内容</span><b>${v.desc || '—'}</b></div>
       <div class="kv-row"><span>来源</span><b>内置目录</b></div>
     </div>`,
    [{ label: '关闭', kind: 'secondary', action: 'close' }]
  );
}
</script>

<template>
  <div class="page-head">
    <div>
      <h1 class="page-title">图文 / 视频教程</h1>
      <p class="page-sub">
        科目二、科目三的实操要点，按动作拆解 · 已读 {{ readCount }} / {{ TUTORIALS.length }} 篇 ·
        线上采集 {{ store.mediaArticles.length }} 篇图文 / {{ store.mediaVideos.length }} 个视频
      </p>
    </div>
    <div class="page-tools">
      <div class="seg" role="group" aria-label="教程类型">
        <button
          type="button"
          :class="{ 'is-active': store.tutTab === 'read' }"
          :aria-pressed="store.tutTab === 'read'"
          @click="store.setTutTab('read')"
        >
          图文教程
        </button>
        <button
          type="button"
          :class="{ 'is-active': store.tutTab === 'video' }"
          :aria-pressed="store.tutTab === 'video'"
          @click="store.setTutTab('video')"
        >
          视频课程
        </button>
      </div>
    </div>
  </div>

  <template v-if="store.tutTab === 'video'">
    <div class="article-lead">
      课程目录分为<b>内置课程</b>与<b>线上采集课程</b>两部分。线上课程来自公开教学站点，点击卡片在系统浏览器中打开原页面观看；
      未采集时仅展示内置目录，不影响使用。
    </div>

    <div class="sec-head mt-20">
      <h4>内置课程目录</h4>
      <span class="hint">{{ VIDEOS.length }} 个</span>
    </div>
    <div class="video-grid mt-12">
      <button v-for="v in VIDEOS" :key="v.no" class="video-card" type="button" @click="openBuiltin(v.no)">
        <span class="video-poster">
          <span class="course-no">{{ v.no }}</span>
          <span class="play"><OdIcon name="play" size="20px" /></span>
          <span class="dur">{{ v.dur }}</span>
        </span>
        <span class="video-body">
          <span class="video-title">{{ v.title }}</span>
          <span class="video-desc">{{ v.desc }}</span>
        </span>
      </button>
    </div>

    <div class="sec-head mt-20">
      <h4>线上采集课程</h4>
      <span class="hint">{{ onlineVideos.length }} 个 · 其中实操相关 {{ practicalVideos.length }} 个</span>
    </div>
    <div v-if="onlineVideos.length" class="video-grid mt-12">
      <a
        v-for="v in onlineVideos"
        :key="v.url || v.no"
        class="video-card is-online"
        :href="v.url"
        target="_blank"
        rel="noreferrer"
      >
        <span class="video-poster">
          <span class="course-no">{{ v.no }}</span>
          <span class="play"><OdIcon name="chevronRight" size="18px" /></span>
          <span class="dur">{{ v.dur || '在线' }}</span>
        </span>
        <span class="video-body">
          <span class="video-title">{{ v.title }}</span>
          <span class="video-desc">{{ v.category ? v.category + ' · ' : '' }}{{ v.source || '线上采集' }}</span>
        </span>
      </a>
    </div>
    <div v-else class="card card-pad mt-12">
      <p class="src">
        还没有采集到线上视频课程。到<b>数据采集</b>页执行一次采集，即可获得科目二、科目三的线上教学视频目录
        （元贝学车视频、驾考宝典项目页，含真实时长）。
      </p>
    </div>
  </template>

  <template v-else>
    <div class="doc-grid">
      <div class="card" style="overflow: hidden">
        <div class="card-head"><h3>教程目录</h3><span class="hint">{{ TUTORIALS.length }} 篇</span></div>
        <div class="doc-list">
          <button
            v-for="t in TUTORIALS"
            :key="t.id"
            class="doc-item"
            type="button"
            :class="{ 'is-active': t.id === current.id }"
            @click="store.setTutOpen(t.id)"
          >
            <span class="doc-no">{{ t.no }}</span>
            <span class="doc-copy">
              <span class="doc-ttl">{{ t.title }}</span>
              <span class="doc-meta">{{ t.tag }} · {{ t.meta }}</span>
            </span>
            <span v-if="store.readTut[t.id]" class="doc-state">已读</span>
          </button>
        </div>
      </div>

      <div class="card doc-body">
        <div class="chips">
          <span class="tag tag-accent">{{ current.tag }}</span>
          <span class="tag">{{ current.meta }}</span>
          <span v-if="isRead" class="tag tag-ok"><OdIcon name="check" size="13px" /> 已读</span>
        </div>
        <h2>{{ current.title }}</h2>
        <p class="dek">{{ current.dek }}</p>
        <div v-html="figure" />
        <h4>操作步骤</h4>
        <ol class="steps">
          <li v-for="(step, i) in current.steps" :key="i">
            <span class="step-no">{{ String(i + 1).padStart(2, '0') }}</span>
            <p>{{ step }}</p>
          </li>
        </ol>
        <h4>要点提示</h4>
        <div v-for="(tip, i) in current.tips" :key="i" class="tip">
          <OdIcon name="info" size="15px" />
          <span>{{ tip }}</span>
        </div>
        <div class="doc-foot">
          <button class="btn btn-secondary btn-sm" type="button" @click="store.toggleTutRead()">
            {{ isRead ? '标记为未读' : '标记为已读' }}
          </button>
          <div class="nav-btns">
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              :disabled="currentIndex === 0"
              @click="move(-1)"
            >
              上一篇
            </button>
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              :disabled="currentIndex === TUTORIALS.length - 1"
              @click="move(1)"
            >
              下一篇
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="card mt-20">
      <div class="card-head">
        <h3>线上图文教程</h3>
        <span class="hint">
          采集 {{ store.mediaArticles.length }} 篇 · 实操相关 {{ practicalArticles.length }} 篇
        </span>
      </div>
      <div class="card-body">
        <div v-if="onlineArticles.length" class="bk-article-list">
          <a
            v-for="a in onlineArticles"
            :key="a.url"
            class="bk-article"
            :class="{ 'is-related': PRACTICAL_RE.test(a.title) }"
            :href="a.url"
            target="_blank"
            rel="noreferrer"
          >
            <span class="bk-article-title">{{ a.title }}</span>
            <span class="bk-article-meta">
              <span class="tag tag-line">{{ a.source || '线上采集' }}</span>
              <span>科目相关</span>
              <OdIcon name="arrowRight" size="12px" />
            </span>
          </a>
        </div>
        <p v-else class="src">
          还没有采集到线上图文教程。到<b>数据采集</b>页执行一次采集，即可获得元贝驾考「开车技巧」栏目的图文讲解目录。
        </p>
        <p class="src mt-12">
          线上图文仅采集标题与原文链接，点击后在系统浏览器中打开来源站点阅读全文；未采集时不影响内置教程使用。
        </p>
      </div>
    </div>

    <div class="card mt-20">
      <div class="card-head">
        <h3>线上视频课程</h3>
        <span class="hint">
          采集 {{ onlineVideos.length }} 个 · 实操相关 {{ practicalVideos.length }} 个
        </span>
      </div>
      <div class="card-body">
        <div v-if="previewVideos.length" class="video-grid">
          <a
            v-for="v in previewVideos"
            :key="v.url || v.no"
            class="video-card is-online"
            :href="v.url"
            target="_blank"
            rel="noreferrer"
          >
            <span class="video-poster">
              <span class="course-no">{{ v.no }}</span>
              <span class="play"><OdIcon name="chevronRight" size="18px" /></span>
              <span class="dur">{{ v.dur || '在线' }}</span>
            </span>
            <span class="video-body">
              <span class="video-title">{{ v.title }}</span>
              <span class="video-desc">{{ v.category ? v.category + ' · ' : '' }}{{ v.source || '线上采集' }}</span>
            </span>
          </a>
        </div>
        <p v-else class="src">
          还没有采集到线上视频课程。到<b>数据采集</b>页执行一次采集，即可获得科目二、科目三的线上教学视频目录。
        </p>
        <div v-if="onlineVideos.length > previewVideos.length" class="sec-more">
          <button class="btn btn-secondary btn-sm" type="button" @click="store.setTutTab('video')">
            查看全部 {{ onlineVideos.length }} 个视频课程
          </button>
        </div>
        <p class="src mt-12">
          视频仅采集标题、时长与来源链接，点击卡片在系统浏览器中打开原页面观看；未采集时不影响内置图文教程使用。
        </p>
      </div>
    </div>
  </template>
</template>

<style scoped>
.sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.sec-head h4 {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.video-card.is-online {
  text-decoration: none;
  color: inherit;
}
.sec-more {
  display: flex;
  justify-content: center;
  margin-top: 14px;
}
.bk-article-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 8px;
}
.bk-article {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 11px 13px;
  border: 1px solid var(--line);
  border-radius: 10px;
  text-decoration: none;
  color: var(--ink);
  background: var(--surface);
  transition: border-color 0.13s ease, background 0.13s ease;
}
.bk-article:hover {
  border-color: var(--ink);
  background: var(--paper-2);
}
.bk-article-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.bk-article-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: 500 11px var(--font-num);
  color: var(--muted);
}
.bk-article-meta > span:not(.tag) {
  visibility: hidden;
}
.bk-article.is-related .bk-article-meta > span:not(.tag) {
  visibility: visible;
  color: var(--green-deep, #2f7d4f);
  font-weight: 600;
}
</style>
