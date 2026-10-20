#!/usr/bin/env node
// 采集器命令行入口：可脱离桌面端独立运行，便于测试或接入系统级定时任务
// 用法：
//   node electron/collector/cli.js run            执行一次采集
//   node electron/collector/cli.js run --source jiakao-moto
//   node electron/collector/cli.js status         查看采集配置与题库统计
//   node electron/collector/cli.js clear-bank     清空采集题库
//   node electron/collector/cli.js clear-cache    清理原始下载缓存
const collector = require('./index');

const args = process.argv.slice(2);
const command = args[0] || 'status';

function argValue(name) {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : null;
}

function fmtBytes(n) {
  if (!n) return '0 B';
  if (n > 1048576) return `${(n / 1048576).toFixed(2)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

(async () => {
  if (command === 'run') {
    const source = argValue('source');
    const summary = await collector.runCollect({
      sourceIds: source ? [source] : null,
      trigger: 'cli',
      onProgress: (event) => console.log(`  ${event.message || ''}`),
    });
    console.log('\n采集结果：');
    console.log(`  科目一：${summary.totalQuestions.k1} 题`);
    console.log(`  科目四：${summary.totalQuestions.k4} 题`);
    console.log(`  视频目录：${summary.videos} 条 · 图文目录：${summary.articles} 条`);
    summary.sources.forEach((s) =>
      console.log(`  - ${s.name}: ${s.ok ? '成功' : '失败'} ${s.message}（解析 ${s.parsed}，新增 ${s.added}）`)
    );
    if (summary.errors.length) process.exitCode = 1;
    return;
  }

  if (command === 'status') {
    const status = collector.getStatus();
    const { config, banks } = status;
    console.log(`数据目录：${status.dataRoot}`);
    console.log(`定时采集：${config.schedule.enabled ? '已开启' : '已关闭'} · 间隔 ${config.schedule.intervalHours} 小时`);
    console.log(`上次采集：${config.schedule.lastRunAt || '未执行'}`);
    console.log(`下次采集：${config.schedule.nextRunAt || '未安排'}`);
    console.log(`地区题库：${config.includeRegional ? '包含' : '不包含'}`);
    console.log('\n题库统计：');
    ['k1', 'k4'].forEach((s) => {
      const b = banks[s];
      console.log(`  ${s === 'k1' ? '科目一' : '科目四'}：${b.count} 题 · 版本 ${b.version || '—'} · ${fmtBytes(b.bytes)} · 更新于 ${b.updatedAt || '—'}`);
      if (b.sources.length) console.log(`    来源：${b.sources.join('、')}`);
    });
    console.log('\n数据源：');
    config.sources.forEach((s) =>
      console.log(`  ${s.enabled ? '[启用]' : '[停用]'} ${s.name}（${s.type}）${s.url || s.dbUrl || ''}`)
    );
    console.log('\n线上教程目录：');
    console.log(`  视频 ${status.videos.items.length} 条 · 图文 ${status.articles.items.length} 条`);
    console.log('\n数据文件：');
    status.files.forEach((f) => console.log(`  ${f.path}  ${fmtBytes(f.size)}`));
    return;
  }

  if (command === 'clear-bank') {
    collector.clearBank();
    console.log('已清空采集题库');
    return;
  }

  if (command === 'clear-cache') {
    const r = collector.clearRawCache();
    console.log(`已清理原始缓存：${r.removed} 个文件`);
    return;
  }

  if (command === 'import') {
    const file = args[1];
    const subject = argValue('subject') || 'k1';
    if (!file) {
      console.error('用法：node electron/collector/cli.js import <文件路径> --subject k1');
      process.exitCode = 1;
      return;
    }
    const r = collector.importLocal(file, subject, argValue('mode') || 'append');
    console.log(`导入完成：新增 ${r.added} 题，重复 ${r.duplicated} 题，当前共 ${r.count} 题`);
    return;
  }

  console.log(`未知命令：${command}`);
  process.exitCode = 1;
})().catch((err) => {
  console.error('执行失败：', err.message);
  process.exitCode = 1;
});
