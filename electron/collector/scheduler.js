// 定时采集调度器：按配置的间隔周期检查并触发采集
const collector = require('./index');
const store = require('./store');

const CHECK_INTERVAL_MS = 60 * 1000;
let timer = null;
let running = false;
let notify = null;

function computeNextRun(config, from = Date.now()) {
  const hours = Math.max(1, Number(config.schedule.intervalHours) || 24);
  return new Date(from + hours * 3600000).toISOString();
}

/** 重新读取配置并规划下一次采集时间 */
function refresh() {
  const config = store.loadConfig();
  if (!config.schedule.enabled) {
    config.schedule.nextRunAt = null;
    store.saveConfig(config);
    return config;
  }
  if (!config.schedule.nextRunAt) {
    config.schedule.nextRunAt = computeNextRun(config);
    store.saveConfig(config);
  }
  return config;
}

async function runNow(trigger = 'manual', sourceIds = null) {
  if (running) return { skipped: true, message: '已有采集任务在执行' };
  running = true;
  try {
    const summary = await collector.runCollect({
      sourceIds,
      trigger,
      onProgress: (event) => notify && notify(event),
    });
    const config = store.loadConfig();
    config.schedule.nextRunAt = computeNextRun(config, Date.now());
    store.saveConfig(config);
    return summary;
  } finally {
    running = false;
  }
}

/** 启动调度：每 60 秒检查一次是否到达下次采集时间 */
function start(onEvent) {
  notify = onEvent || null;
  refresh();
  stop();
  timer = setInterval(async () => {
    const config = store.loadConfig();
    if (!config.schedule.enabled) return;
    const next = config.schedule.nextRunAt ? new Date(config.schedule.nextRunAt).getTime() : 0;
    if (!next || Date.now() >= next) {
      notify && notify({ type: 'log', message: '到达定时采集时间，开始自动采集' });
      try {
        await runNow('schedule');
      } catch (err) {
        notify && notify({ type: 'log', message: `定时采集失败：${err.message}` });
      }
    }
  }, CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref();
  return timer;
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function isRunning() {
  return running;
}

module.exports = { start, stop, refresh, runNow, isRunning, computeNextRun };
