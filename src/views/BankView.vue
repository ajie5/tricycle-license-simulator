<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/store/app';
import { PROVINCES, SUBJECTS } from '@/data/content';
import { REGION_GROUPS, fmtBytes, fmtDateTime } from '@/data/lookups';
import { isDesktop } from '@/services/collector';
import type { SubjectKey } from '@/types';
import OdIcon from '@/components/OdIcon.vue';

const store = useAppStore();
const router = useRouter();

const stats1 = computed(() => store.statsOf('k1'));
const stats4 = computed(() => store.statsOf('k4'));
const k1Count = computed(() => store.bankOf('k1').length);
const k4Count = computed(() => store.bankOf('k4').length);
const desktop = isDesktop();
const readTutCount = computed(() => Object.keys(store.readTut).filter((k) => store.readTut[k]).length);

/** 各省采集到的地方题量，用于地区按钮上的角标 */
const regionMap = computed(() => new Map(store.regionalBreakdown.map((r) => [r.area, r.total])));
/** 采集到的地方题库总量 */
const regionalTotal = computed(() => store.regionalBreakdown.reduce((sum, r) => sum + r.total, 0));
/** 当前地区可用的地方题量（不含全国通用题） */
const currentRegionCount = computed(() => store.regionalCountOf);
/** 当前地区采集题占比 */
const currentRegionCollected = computed(() =>
  (['k1', 'k4'] as SubjectKey[]).reduce(
    (sum, subj) => sum + store.bankOf(subj).filter((q) => q.src && q.src.length).length,
    0
  )
);

/** 题库健康度：总量、来源构成、配图与解析覆盖 */
const health = computed(() =>
  (['k1', 'k4'] as SubjectKey[]).map((subj) => {
    const list = store.bankOf(subj);
    const collected = list.filter((q) => q.src && q.src.length);
    return {
      subj,
      name: SUBJECTS[subj].name,
      total: list.length,
      collected: collected.length,
      regional: collected.filter((q) => q.area).length,
      withImg: list.filter((q) => q.img || q.imgRemote || q.sign).length,
      withExplain: list.filter((q) => q.e && q.b).length,
    };
  })
);

const updateLogs = [
  { date: '2026-10-08', text: 'v2026.10.08 · 新增 12 题，修订 7 条解析', current: true },
  { date: '2026-09-24', text: 'v2026.09.24 · 科目四紧急处置新增 6 题', current: false },
  { date: '2026-08-30', text: 'v2026.08.30 · 依据现行记分规定调整 9 题', current: false },
];

function confirmReset() {
  store.openModal(
    '重置学习记录',
    '<p class="modal-copy">将清空本机的练习记录、错题本、收藏与考试成绩，题库与地区设置保留。此操作不可撤销。</p>',
    [
      { label: '取消', kind: 'secondary', action: 'close' },
      { label: '确认重置', kind: 'danger', action: 'reset-data' },
    ]
  );
}

function confirmDemo() {
  store.openModal(
    '载入演示档案',
    '<p class="modal-copy">将用示例练习记录、错题本与考试成绩覆盖当前本机数据，题库与地区设置保留。</p>',
    [
      { label: '取消', kind: 'secondary', action: 'close' },
      { label: '载入演示', kind: 'primary', action: 'demo-confirm' },
    ]
  );
}
</script>

<template>
  <div class="page-head">
    <div>
      <h1 class="page-title">题库与地区</h1>
      <p class="page-sub">
        按地区加载省级题库 · 当前 <b>{{ store.region }}</b> · 可用题库共 {{ k1Count + k4Count }} 题
        <template v-if="currentRegionCount">（含 {{ store.region }}地方题 {{ currentRegionCount }} 题）</template>
      </p>
    </div>
    <div class="page-tools">
      <span class="tag tag-ok"><OdIcon name="check" size="13px" /> 已校验</span>
    </div>
  </div>

  <div class="bank-grid">
    <div class="stack">
      <div class="card">
        <div class="card-head">
          <h3>当前题库地区</h3>
          <span class="hint">已切换到 {{ store.region }}</span>
        </div>
        <div class="card-body">
          <div v-for="[group, list] in REGION_GROUPS" :key="group" class="region-group">
            <div class="region-group-title">{{ group }}</div>
            <div class="region-grid">
              <button
                v-for="p in list"
                :key="p"
                type="button"
                :class="{ 'is-active': p === store.region }"
                :aria-pressed="p === store.region"
                @click="store.setRegion(p)"
              >
                {{ p }}
                <b v-if="regionMap.get(p)" class="bk-badge">{{ regionMap.get(p) }}</b>
              </button>
            </div>
          </div>
          <p class="src mt-12">
            切换地区后立即重建可用题库：<b>全国通用题 + 所选省份的地方题</b>。按钮上的数字为该省已采集到的地方题量。
            未采集地区题库时，仅使用全国通用题，不影响正常练习与考试。
          </p>
          <div class="kv mt-12">
            <div class="kv-row"><span>当前地区地方题</span><b>{{ currentRegionCount }} 题</b></div>
            <div class="kv-row"><span>已采集地方题库合计</span><b>{{ regionalTotal }} 题 / {{ store.regionalBreakdown.length }} 个地区</b></div>
            <div class="kv-row"><span>当前地区采集题</span><b>{{ currentRegionCollected }} 题</b></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>题库构成</h3>
          <span class="hint">共 {{ k1Count + k4Count }} 题</span>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>科目</th>
              <th class="r">内置</th>
              <th class="r">采集</th>
              <th class="r">其中地方题</th>
              <th class="r">合计</th>
              <th class="r">已练</th>
              <th class="r">版本</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div style="font-weight: 600">科目一</div>
                <div class="src">道路交通安全法律法规</div>
              </td>
              <td class="r num">{{ store.bundledCount('k1') }}</td>
              <td class="r num">{{ store.collected.k1.length }}</td>
              <td class="r num">{{ health[0].regional }}</td>
              <td class="r num">{{ k1Count }}</td>
              <td class="r num">{{ stats1.seen }}</td>
              <td class="r num">{{ store.collectedMeta.k1?.version || '内置' }}</td>
            </tr>
            <tr>
              <td>
                <div style="font-weight: 600">科目四</div>
                <div class="src">安全文明驾驶常识</div>
              </td>
              <td class="r num">{{ store.bundledCount('k4') }}</td>
              <td class="r num">{{ store.collected.k4.length }}</td>
              <td class="r num">{{ health[1].regional }}</td>
              <td class="r num">{{ k4Count }}</td>
              <td class="r num">{{ stats4.seen }}</td>
              <td class="r num">{{ store.collectedMeta.k4?.version || '内置' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>地方题库分布</h3>
          <span class="hint">{{ regionalTotal }} 题 · {{ store.regionalBreakdown.length }} 个地区</span>
        </div>
        <div class="card-body">
          <div v-if="store.regionalBreakdown.length" class="bk-region-list">
            <button
              v-for="row in store.regionalBreakdown"
              :key="row.area"
              type="button"
              class="bk-region-item"
              :class="{ 'is-active': row.area === store.region }"
              @click="row.area !== '通用' && store.setRegion(row.area)"
            >
              <span class="bk-region-name">{{ row.area }}{{ row.area === '通用' ? '（无省份归属）' : '' }}</span>
              <span class="bk-region-bar">
                <i :style="{ width: Math.round((row.total / store.regionalBreakdown[0].total) * 100) + '%' }" />
              </span>
              <span class="bk-region-num">{{ row.total }} 题</span>
            </button>
          </div>
          <p v-else class="src">
            还没有采集到地方题库。点击下方按钮到数据采集页执行一次采集，即可按省份加载地方题。
          </p>
          <p class="src mt-12">
            地方题库按章节标题归属省份；未标注省份的通用地方题对所有地区可见。切换地区后题量会立即变化。
          </p>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>题库健康度</h3>
          <span class="hint">总量 · 配图 · 解析覆盖</span>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>科目</th>
              <th class="r">可用总量</th>
              <th class="r">采集 / 内置</th>
              <th class="r">配图题</th>
              <th class="r">含依据解析</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in health" :key="row.subj">
              <td><div style="font-weight: 600">{{ row.name }}</div></td>
              <td class="r num">{{ row.total }}</td>
              <td class="r num">{{ row.collected }} / {{ row.total - row.collected }}</td>
              <td class="r num">{{ row.withImg }}</td>
              <td class="r num">{{ row.withExplain }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>章节题目分布</h3>
          <span class="hint">{{ SUBJECTS[store.subject].name }}</span>
        </div>
        <div class="card-body">
          <div v-for="ch in store.chapterStats(store.subject)" :key="ch.k" class="bk-chapter">
            <span class="bk-ch-name">{{ ch.n }}</span>
            <span class="bk-ch-bar"><i :style="{ width: (ch.total ? Math.round((ch.seen / ch.total) * 100) : 0) + '%' }" /></span>
            <span class="bk-ch-num">{{ ch.total }} 题 · 已练 {{ ch.seen }}</span>
          </div>
          <p class="src mt-10">章节分布随题库与地区变化；切换科目可查看对应章节。</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>采集题库状态</h3>
          <span class="hint">{{ desktop ? '桌面端可用' : '仅桌面端可用' }}</span>
        </div>
        <div class="card-body">
          <div class="kv">
            <div class="kv-row">
              <span>科目一采集</span>
              <b>{{ store.collectedMeta.k1?.count || 0 }} 题</b>
            </div>
            <div class="kv-row">
              <span>科目四采集</span>
              <b>{{ store.collectedMeta.k4?.count || 0 }} 题</b>
            </div>
            <div class="kv-row">
              <span>地方题库</span>
              <b>{{ regionalTotal }} 题 / {{ store.regionalBreakdown.length }} 个地区</b>
            </div>
            <div class="kv-row">
              <span>线上教程目录</span>
              <b>{{ store.mediaVideos.length }} 个视频 · {{ store.mediaArticles.length }} 篇图文</b>
            </div>
            <div class="kv-row">
              <span>题库版本</span>
              <b>{{ store.collectedMeta.k1?.version || store.collectedMeta.k4?.version || '—' }}</b>
            </div>
            <div class="kv-row">
              <span>最近采集</span>
              <b>{{ fmtDateTime(store.collectedMeta.k1?.updatedAt || store.collectedMeta.k4?.updatedAt) }}</b>
            </div>
            <div class="kv-row">
              <span>题库文件大小</span>
              <b>
                {{
                  fmtBytes(
                    (store.collectedStats.k1?.bytes || 0) + (store.collectedStats.k4?.bytes || 0)
                  )
                }}
              </b>
            </div>
            <div class="kv-row">
              <span>下次定时采集</span>
              <b>{{ store.collectedStats.k1 ? '见采集页' : '—' }}</b>
            </div>
          </div>
          <p class="src mt-12">
            采集题库与线上教程目录保存在本机项目目录 data/ 下，支持手动采集与定时采集；未采集时自动使用内置题库与内置教程目录。
          </p>
          <button class="btn btn-primary btn-sm mt-12" type="button" @click="router.push('/collect')">
            进入数据采集 <OdIcon name="arrowRight" size="13px" />
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>更新日志</h3><span class="hint">最近 3 次</span></div>
        <div class="card-body">
          <div v-for="log in updateLogs" :key="log.date" class="log-row">
            <span class="d">{{ log.date }}</span>
            <span>{{ log.text }}</span>
            <span class="tag" :class="{ 'tag-ok': log.current }">{{ log.current ? '当前' : '已合并' }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="stack">
      <div class="card">
        <div class="card-head"><h3>本机学习档案</h3><span class="tag tag-line">离线存储</span></div>
        <div class="card-body">
          <div class="kv">
            <div class="kv-row"><span>已练题目</span><b>{{ stats1.seen + stats4.seen }}</b></div>
            <div class="kv-row"><span>错题本</span><b>{{ store.wrong.length }}</b></div>
            <div class="kv-row"><span>收藏夹</span><b>{{ store.fav.length }}</b></div>
            <div class="kv-row"><span>模拟考试</span><b>{{ store.exams.length }} 次</b></div>
            <div class="kv-row"><span>实操考试</span><b>{{ store.pracExams.length }} 次</b></div>
            <div class="kv-row"><span>已读教程</span><b>{{ readTutCount }} 篇</b></div>
            <div class="kv-row"><span>题库地区</span><b>{{ PROVINCES.length }} 个可选</b></div>
          </div>
          <p class="src mt-12">记录仅保存在本机，不上传、不需要账号。</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>数据管理</h3></div>
        <div class="card-body data-actions">
          <button class="btn btn-secondary btn-sm" type="button" @click="confirmDemo">载入演示档案</button>
          <button class="btn btn-secondary btn-sm" type="button" @click="store.clearWrong()">清空错题本</button>
          <button class="btn btn-danger btn-sm" type="button" @click="confirmReset">重置学习记录</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>关于题库</h3></div>
        <div class="card-body">
          <p class="about-copy">
            题目依据现行道路交通安全法律法规与配套规定整理，解析标注依据条款。地区题库按省份加载，覆盖地方性通行规定；
            正式考试以当地车管所公布范围为准。线上图文、视频目录来自公开页面，仅作学习索引，点击后跳转来源站点查看。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 地区按钮上已采集地方题量角标 */
.bk-badge {
  margin-left: 4px;
  font: 600 10px var(--font-num);
  opacity: 0.75;
}
.region-grid button.is-active .bk-badge {
  opacity: 0.9;
}
/* 地方题库分布 */
.bk-region-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bk-region-item {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  font: inherit;
  color: var(--ink);
  cursor: pointer;
  transition: background 0.13s ease, border-color 0.13s ease;
}
.bk-region-item:hover {
  background: var(--paper-2);
  border-color: var(--line);
}
.bk-region-item.is-active {
  border-color: var(--ink);
}
.bk-region-name {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bk-region-bar {
  display: block;
  height: 6px;
  border-radius: 99px;
  background: var(--line);
  overflow: hidden;
}
.bk-region-bar i {
  display: block;
  height: 100%;
  background: var(--green, #2f7d4f);
  border-radius: 99px;
}
.bk-region-num {
  font: 500 11.5px var(--font-num);
  color: var(--muted);
  white-space: nowrap;
}
/* 章节题目分布 */
.bk-chapter {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
}
.bk-chapter:last-of-type {
  border-bottom: 0;
}
.bk-ch-name {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bk-ch-bar {
  display: block;
  height: 6px;
  border-radius: 99px;
  background: var(--line);
  overflow: hidden;
}
.bk-ch-bar i {
  display: block;
  height: 100%;
  background: var(--ink);
  border-radius: 99px;
  opacity: 0.55;
}
.bk-ch-num {
  font: 500 11.5px var(--font-num);
  color: var(--muted);
  white-space: nowrap;
}
@media (max-width: 680px) {
  .bk-region-item,
  .bk-chapter {
    grid-template-columns: 96px minmax(0, 1fr) auto;
  }
}
</style>
