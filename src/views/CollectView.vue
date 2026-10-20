<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/store/app';
import { SUBJECTS } from '@/data/content';
import { fmtBytes, fmtDateTime } from '@/data/lookups';
import {
  bridge,
  isDesktop,
  questionImageUrl,
  type CollectorEvent,
  type CollectorStatus,
} from '@/services/collector';
import OdIcon from '@/components/OdIcon.vue';

const store = useAppStore();
const router = useRouter();

const desktop = isDesktop();
const api = bridge();
const status = ref<CollectorStatus | null>(null);
const logs = ref<string[]>([]);
const running = ref(false);
const intervalHours = ref(24);
const scheduleEnabled = ref(true);
const includeRegional = ref(false);
const busy = ref('');
let unsubscribe: (() => void) | null = null;

const banks = computed(() => status.value?.banks);
const collectedTotal = computed(
  () => (banks.value?.k1.count || 0) + (banks.value?.k4.count || 0)
);
const bundledTotal = computed(() => store.bundledCount('k1') + store.bundledCount('k4'));
const availableTotal = computed(() => store.bankOf('k1').length + store.bankOf('k4').length);
const dataRoot = computed(() => status.value?.dataRoot || '桌面端启动后可见');
const bankFiles = computed(() => (status.value?.files || []).filter((f) => f.path.startsWith('bank/')));
const imageCount = computed(() => (status.value?.files || []).filter((f) => f.path.startsWith('images/')).length);
const imageBytes = computed(() =>
  (status.value?.files || [])
    .filter((f) => f.path.startsWith('images/'))
    .reduce((sum, f) => sum + f.size, 0)
);
const sampleQuestions = computed(() => store.bankOf(store.subject).filter((q) => q.img).slice(0, 3));

function pushLog(line: string) {
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  logs.value.push(`[${stamp}] ${line}`);
  if (logs.value.length > 300) logs.value.splice(0, logs.value.length - 300);
}

async function loadStatus() {
  if (!api) return;
  status.value = await api.collector.status();
  const cfg = status.value.config;
  intervalHours.value = cfg.schedule.intervalHours;
  scheduleEnabled.value = cfg.schedule.enabled;
  includeRegional.value = cfg.includeRegional;
  logs.value = status.value.logs || [];
}

function handleEvent(event: CollectorEvent) {
  if (event.type === 'log' || event.type === 'error') pushLog(event.message || '');
  if (event.type === 'start') pushLog(event.message || '开始采集');
  if (event.type === 'done') {
    pushLog('采集完成，重新装载题库');
    store.reloadAfterCollect().then(loadStatus);
  }
}

onMounted(async () => {
  await loadStatus();
  if (api) unsubscribe = api.collector.onEvent(handleEvent);
});
onBeforeUnmount(() => {
  if (unsubscribe) unsubscribe();
});

// 题库数据发生变化（采集、导入、清空）后刷新统计
watch(
  () => [store.collectedMeta.k1?.updatedAt, store.collectedMeta.k4?.updatedAt, store.collected.k1.length, store.collected.k4.length],
  () => {
    loadStatus();
  }
);

/** 手动采集：可指定数据源 */
async function runCollect(sourceIds?: string[]) {
  if (!api || running.value) return;
  running.value = true;
  busy.value = sourceIds && sourceIds.length ? 'source' : 'all';
  pushLog(sourceIds && sourceIds.length ? '手动采集指定数据源…' : '手动采集全部已启用数据源…');
  try {
    const result = await api.collector.run({ sourceIds });
    if (result.ok && result.summary) {
      const s = result.summary;
      store.toast(`采集完成：科目一 ${s.totalQuestions.k1} 题 / 科目四 ${s.totalQuestions.k4} 题`);
      pushLog(
        `采集结果：科目一 ${s.totalQuestions.k1} 题，科目四 ${s.totalQuestions.k4} 题，视频 ${s.videos} 条，图文 ${s.articles} 条，失败 ${s.errors.length} 个数据源`
      );
    } else {
      pushLog(`采集失败：${result.message || '未知错误'}`);
      store.toast(result.message || '采集失败');
    }
    await store.reloadAfterCollect();
  } finally {
    running.value = false;
    busy.value = '';
    await loadStatus();
  }
}

async function toggleSource(id: string) {
  if (!api || !status.value) return;
  const next = status.value.config.sources.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
  status.value = await api.collector.saveConfig({ sources: next });
  store.toast('数据源状态已更新');
}

async function saveSchedule() {
  if (!api) return;
  status.value = await api.collector.saveConfig({
    schedule: { enabled: scheduleEnabled.value, intervalHours: Number(intervalHours.value) || 24 },
  });
  store.toast(scheduleEnabled.value ? `已开启定时采集，每 ${intervalHours.value} 小时一次` : '已关闭定时采集');
}

async function saveRegional() {
  if (!api) return;
  status.value = await api.collector.saveConfig({ includeRegional: includeRegional.value });
  store.toast(includeRegional.value ? '采集时包含地方题库' : '采集时仅保留全国通用题');
}

async function doImport(mode: 'append' | 'replace') {
  if (!api) return;
  const picked = await api.collector.pickFile({ title: '选择题库文件（JSON / CSV）' });
  if (picked.canceled || !picked.filePath) return;
  const result = await api.collector.importFile({
    filePath: picked.filePath,
    subject: store.subject,
    mode,
  });
  if (result.ok) {
    store.toast(`导入完成：新增 ${result.added} 题`);
    await store.reloadAfterCollect();
    await loadStatus();
  } else {
    store.toast(result.message || '导入失败');
  }
}

async function doExport() {
  if (!api) return;
  const result = await api.collector.exportBank({ subject: store.subject });
  if (result.ok) store.toast(`已导出 ${result.count} 题`);
  else if (!result.canceled) store.toast(result.message || '导出失败');
}

function confirmClearBank() {
  store.openModal(
    '清空采集题库',
    '<p class="modal-copy">将删除本机采集到的全部题目，仅保留内置题库。原始下载缓存与配置保留，下次采集可重新导入。</p>',
    [
      { label: '取消', kind: 'secondary', action: 'close' },
      { label: '确认清空', kind: 'danger', action: 'collect-clear-bank' },
    ]
  );
}

function confirmClearCache() {
  store.openModal(
    '清理原始下载缓存',
    '<p class="modal-copy">将删除下载到本机的原始题库文件（约 11 MB），下次采集需要重新下载。</p>',
    [
      { label: '取消', kind: 'secondary', action: 'close' },
      { label: '确认清理', kind: 'danger', action: 'collect-clear-cache' },
    ]
  );
}

/** 供弹窗确认后回调：清空与清理动作由 store 统一处理，这里只负责刷新状态 */
async function openDir() {
  if (!api) return;
  const result = await api.collector.openDataDir();
  if (!result.ok) store.toast(result.message || '打开目录失败');
}
</script>

<template>
  <div class="page-head">
    <div>
      <span class="folio">档案 08 · 数据采集</span>
      <h1 class="page-title">数据采集与定时更新</h1>
      <p class="page-sub">
        从线上题库采集题目、插图与视频目录，保存到本机
        <b class="num">{{ dataRoot }}</b>
      </p>
    </div>
    <div class="page-tools">
      <button class="btn btn-secondary" type="button" :disabled="!desktop" @click="openDir">
        打开数据目录
      </button>
      <button class="btn btn-primary" type="button" :disabled="!desktop || running" @click="runCollect()">
        <OdIcon name="refresh" size="15px" />
        {{ running && busy === 'all' ? '采集中…' : '立即采集' }}
      </button>
    </div>
  </div>

  <div v-if="!desktop" class="card card-pad mb-18">
    <div class="empty-state" style="padding: 12px 0">
      <div class="empty-icon"><OdIcon name="info" size="24px" /></div>
      <strong>采集功能需要在桌面端运行</strong>
      <p>
        浏览器模式下无法访问本机文件系统与 Node 能力。请用 <span class="kbd">npm start</span> 启动桌面程序，
        或先用命令行执行一次采集：<span class="kbd">node electron/collector/cli.js run</span>，随后浏览器端也会读取到采集题库。
      </p>
    </div>
  </div>

  <div class="stat-strip mb-18">
    <div class="stat">
      <span class="stat-k">可用题库合计</span>
      <span class="stat-v">{{ availableTotal }}<small>题</small></span>
      <span class="stat-f">内置 {{ bundledTotal }} 题 + 采集 {{ collectedTotal }} 题</span>
    </div>
    <div class="stat">
      <span class="stat-k">科目一</span>
      <span class="stat-v">{{ store.bankOf('k1').length }}<small>题</small></span>
      <span class="stat-f">采集 {{ banks?.k1.count || 0 }} 题</span>
    </div>
    <div class="stat">
      <span class="stat-k">科目四</span>
      <span class="stat-v">{{ store.bankOf('k4').length }}<small>题</small></span>
      <span class="stat-f">采集 {{ banks?.k4.count || 0 }} 题</span>
    </div>
    <div class="stat">
      <span class="stat-k">本地插图</span>
      <span class="stat-v">{{ imageCount }}<small>张</small></span>
      <span class="stat-f">{{ fmtBytes(imageBytes) }}</span>
    </div>
    <div class="stat">
      <span class="stat-k">线上教程目录</span>
      <span class="stat-v">{{ (status?.videos.items.length || 0) + (status?.articles.items.length || 0) }}<small>条</small></span>
      <span class="stat-f">视频 {{ status?.videos.items.length || 0 }} · 图文 {{ status?.articles.items.length || 0 }}</span>
    </div>
  </div>

  <div class="exam-grid">
    <div class="stack">
      <div class="card">
        <div class="card-head">
          <h3>数据源</h3>
          <span class="hint">{{ status?.config.sources.filter((s) => s.enabled).length || 0 }} / {{ status?.config.sources.length || 0 }} 已启用</span>
        </div>
        <div class="card-body">
          <div v-for="source in status?.config.sources || []" :key="source.id" class="source-row">
            <div class="source-main">
              <div class="source-title">
                <b>{{ source.name }}</b>
                <span class="tag tag-line">{{ source.type }}</span>
                <span class="tag" :class="source.enabled ? 'tag-ok' : ''">{{ source.enabled ? '已启用' : '已停用' }}</span>
              </div>
              <p class="src">{{ source.desc }}</p>
              <p class="src num od-clamp-2">{{ (source.dbUrls && source.dbUrls[0]) || source.url || '未配置地址' }}</p>
            </div>
            <div class="source-actions">
              <button
                class="btn btn-sm"
                :class="source.enabled ? 'btn-secondary' : 'btn-primary'"
                type="button"
                :disabled="!desktop"
                @click="toggleSource(source.id)"
              >
                {{ source.enabled ? '停用' : '启用' }}
              </button>
              <button
                class="btn btn-secondary btn-sm"
                type="button"
                :disabled="!desktop || !source.enabled || running"
                @click="runCollect([source.id])"
              >
                单独采集
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>定时采集</h3>
          <span class="hint">应用运行期间自动执行</span>
        </div>
        <div class="card-body">
          <div class="field-row">
            <label class="field-label" for="schedule-enabled">开启定时采集</label>
            <button
              id="schedule-enabled"
              class="btn btn-sm"
              :class="scheduleEnabled ? 'btn-primary' : 'btn-secondary'"
              type="button"
              :disabled="!desktop"
              @click="scheduleEnabled = !scheduleEnabled; saveSchedule()"
            >
              {{ scheduleEnabled ? '已开启' : '已关闭' }}
            </button>
          </div>
          <div class="field-row">
            <label class="field-label" for="schedule-interval">采集间隔（小时）</label>
            <input
              id="schedule-interval"
              v-model.number="intervalHours"
              class="input"
              type="number"
              min="1"
              max="720"
              :disabled="!desktop || !scheduleEnabled"
              @change="saveSchedule"
            />
          </div>
          <div class="field-row">
            <label class="field-label" for="include-regional">包含各省地方题库</label>
            <button
              id="include-regional"
              class="btn btn-sm"
              :class="includeRegional ? 'btn-primary' : 'btn-secondary'"
              type="button"
              :disabled="!desktop"
              @click="includeRegional = !includeRegional; saveRegional()"
            >
              {{ includeRegional ? '包含' : '不包含' }}
            </button>
          </div>
          <div class="kv mt-16">
            <div class="kv-row"><span>上次采集</span><b>{{ fmtDateTime(status?.config.schedule.lastRunAt) }}</b></div>
            <div class="kv-row"><span>下次采集</span><b>{{ fmtDateTime(status?.config.schedule.nextRunAt) }}</b></div>
            <div class="kv-row">
              <span>上次结果</span>
              <b>{{ status?.config.schedule.lastResult?.message || '—' }}</b>
            </div>
          </div>
          <p class="src mt-10">
            定时采集在应用运行期间由主进程调度；也可用系统计划任务调用
            <span class="kbd">node electron/collector/cli.js run</span> 实现开机自动更新。
          </p>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>采集进度日志</h3>
          <span class="hint">{{ logs.length }} 行</span>
        </div>
        <div class="card-body">
          <div class="log-view">
            <p v-for="(line, i) in logs.slice(-60)" :key="i" class="log-line">{{ line }}</p>
            <p v-if="!logs.length" class="src">还没有采集日志。点击「立即采集」开始第一次采集。</p>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>题库文件</h3>
          <span class="hint">{{ bankFiles.length }} 个</span>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>文件</th>
              <th class="r">大小</th>
              <th class="r">更新时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="file in bankFiles" :key="file.path">
              <td class="num">{{ file.path }}</td>
              <td class="r num">{{ fmtBytes(file.size) }}</td>
              <td class="r num">{{ fmtDateTime(file.mtime) }}</td>
            </tr>
            <tr v-if="!bankFiles.length">
              <td colspan="3" class="src">还没有采集题库文件，执行一次采集即可生成 bank/k1.json 与 bank/k4.json。</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>采集题库抽样</h3>
          <span class="hint">{{ SUBJECTS[store.subject].name }} · 含插图题</span>
        </div>
        <div class="card-body">
          <div v-for="q in sampleQuestions" :key="q.i" class="sample-item">
            <div class="sample-stem">{{ q.q }}</div>
            <img v-if="questionImageUrl(q)" class="review-media" :src="questionImageUrl(q) || ''" :alt="q.q" />
            <div class="src">
              {{ q.o.map((o, i) => `${'ABCDEF'[i]}.${o}`).join('　') }}
            </div>
            <div class="src">正确答案：{{ q.a.map((i) => 'ABCDEF'[i]).join('') }} · 来源 {{ (q.src || []).join('、') || '采集题库' }}</div>
          </div>
          <p v-if="!sampleQuestions.length" class="src">当前科目还没有含插图的采集题目。</p>
        </div>
      </div>
    </div>

    <aside class="rail">
      <div class="rail-card">
        <div class="rail-head"><h3>数据管理</h3></div>
        <div class="rail-body rail-actions">
          <button class="btn btn-secondary btn-sm" type="button" :disabled="!desktop" @click="doImport('append')">
            导入本地题库（追加）
          </button>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="!desktop" @click="doExport()">
            导出{{ SUBJECTS[store.subject].name }}题库
          </button>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="!desktop" @click="confirmClearCache">
            清理原始下载缓存
          </button>
          <button class="btn btn-danger btn-sm" type="button" :disabled="!desktop" @click="confirmClearBank">
            清空采集题库
          </button>
        </div>
      </div>

      <div class="rail-card">
        <div class="rail-head"><h3>采集说明</h3></div>
        <div class="rail-body">
          <div class="tip">
            <OdIcon name="info" size="15px" />
            <span>
              题目、插图与线上教程目录均来自公开数据源，保存在项目目录 data/ 下；采集题库与内置题库自动合并、按地区过滤，
              未采集时使用内置题库，功能不受影响。
            </span>
          </div>
          <div class="tip">
            <OdIcon name="alert" size="15px" />
            <span>
              数据源仅供个人学习研究使用，请遵守来源站点的使用条款，不要用于商业分发。
            </span>
          </div>
        </div>
      </div>

      <div class="rail-card">
        <div class="rail-head"><h3>数据文件分布</h3></div>
        <div class="rail-body">
          <div class="kv">
            <div class="kv-row"><span>题库</span><b>data/bank/</b></div>
            <div class="kv-row"><span>插图</span><b>data/images/</b></div>
            <div class="kv-row"><span>教程目录</span><b>data/media/</b></div>
            <div class="kv-row"><span>原始缓存</span><b>data/raw/</b></div>
            <div class="kv-row"><span>采集日志</span><b>data/logs/</b></div>
          </div>
          <button class="btn btn-ghost btn-sm mt-12" type="button" @click="router.push('/bank')">
            返回题库与地区
          </button>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.mb-18 {
  margin-bottom: 18px;
}
.source-row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
}
.source-row:last-child {
  border-bottom: 0;
}
.source-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.source-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 14px;
}
.source-actions {
  display: flex;
  gap: 8px;
  flex: none;
}
.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.field-row:last-of-type {
  border-bottom: 0;
}
.field-label {
  font-size: 13px;
  color: var(--muted);
}
.input {
  width: 120px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--line-2);
  border-radius: 9px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  text-align: right;
}
.log-view {
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.log-line {
  font: 400 11.5px/1.7 var(--font-num);
  color: var(--muted);
  word-break: break-all;
}
.sample-item {
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sample-item:last-child {
  border-bottom: 0;
}
.sample-stem {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.6;
}
@media (max-width: 680px) {
  .source-row {
    flex-direction: column;
  }
  .source-actions {
    width: 100%;
  }
  .source-actions .btn {
    flex: 1;
  }
}
</style>
