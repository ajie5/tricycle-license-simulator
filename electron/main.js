// Electron 主进程：窗口、菜单、本地媒体协议、采集 IPC 与定时采集调度
const { app, BrowserWindow, shell, Menu, protocol, net, ipcMain, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const collector = require('./collector');
const scheduler = require('./collector/scheduler');

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDev = Boolean(devServerUrl);

/** @type {BrowserWindow | null} */
let mainWindow = null;

// 本地图片协议需要先注册为特权协议，才能在页面中以安全上下文加载
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'tricycle-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#F4F4F4',
    title: '三轮车驾考模拟 · D 照',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 渲染层报错转发到终端，便于排查采集与媒体协议问题
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.error('[renderer]', message);
  });

  // 启动自检：核对渲染层实际装载的可用题库题量（来自 IPC 装载的采集题库）
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const info = await mainWindow.webContents.executeJavaScript(
          `(document.body.innerText.match(/科目一\\s*(\\d+)\\s*题\\s*\\/\\s*科目四\\s*(\\d+)\\s*题/) || []).slice(1).join(' / ')`,
          true
        );
        if (info) console.log(`[renderer] 可用题库 科目一/科目四 = ${info} 题`);
        else console.warn('[renderer] 未读取到题库题量自检信息');
      } catch (err) {
        console.error('[renderer] 自检执行失败：', err && err.message ? err.message : err);
      }
    }, 3000);
  });

  // 外部链接交给系统浏览器，避免在应用窗口内跳走
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** 只允许读取数据目录内的文件，避免路径穿越 */
function resolveMediaPath(urlPath) {
  const root = collector.DATA_ROOT;
  const relative = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  const withSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(withSep)) return null;
  return target;
}

function registerMediaProtocol() {
  protocol.handle('tricycle-media', async (request) => {
    const url = new URL(request.url);
    const target = resolveMediaPath(url.pathname);
    if (!target) return new Response('forbidden', { status: 403 });
    try {
      return await net.fetch(pathToFileURL(target).toString());
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

/** 向渲染层推送采集事件 */
function emit(event) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('collector:event', { ...event, at: new Date().toISOString() });
  }
}

function registerCollectorIpc() {
  ipcMain.handle('collector:data-root', () => collector.DATA_ROOT);

  ipcMain.handle('collector:status', () => collector.getStatus());

  ipcMain.handle('collector:run', async (_event, payload) => {
    const sourceIds = payload && Array.isArray(payload.sourceIds) && payload.sourceIds.length ? payload.sourceIds : null;
    emit({ type: 'start', message: '开始采集' });
    try {
      const summary = await scheduler.runNow('manual', sourceIds);
      emit({ type: 'done', summary });
      return { ok: true, summary };
    } catch (err) {
      emit({ type: 'error', message: err.message });
      return { ok: false, message: err.message };
    }
  });

  ipcMain.handle('collector:config:save', (_event, patch) => {
    const config = collector.getStatus().config;
    const next = {
      ...config,
      ...patch,
      schedule: { ...config.schedule, ...(patch && patch.schedule ? patch.schedule : {}) },
    };
    if (patch && Array.isArray(patch.sources)) next.sources = patch.sources;
    require('./collector/store').saveConfig(next);
    scheduler.refresh();
    emit({ type: 'log', message: '采集配置已更新' });
    return collector.getStatus();
  });

  ipcMain.handle('collector:collected', (_event, subject, limit) => collector.loadCollected(subject, limit));

  ipcMain.handle('collector:clear-bank', (_event, subject) => {
    const status = collector.clearBank(subject || null);
    emit({ type: 'log', message: subject ? `已清空${subject}采集题库` : '已清空全部采集题库' });
    return status;
  });

  ipcMain.handle('collector:clear-cache', () => {
    const result = collector.clearRawCache();
    emit({ type: 'log', message: `已清理原始缓存（${result.removed} 个文件），下次采集将重新下载` });
    return { ok: true, ...result };
  });

  ipcMain.handle('collector:pick-file', async (_event, payload) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: payload && payload.title ? payload.title : '选择题库文件',
      properties: ['openFile'],
      filters: [
        { name: '题库文件', extensions: ['json', 'csv'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return { canceled: false, filePath: result.filePaths[0] };
  });

  ipcMain.handle('collector:import', (_event, payload) => {
    try {
      const result = collector.importLocal(
        payload.filePath,
        payload.subject === 'k4' ? 'k4' : 'k1',
        payload.mode === 'replace' ? 'replace' : 'append'
      );
      emit({ type: 'log', message: `本地导入完成：新增 ${result.added} 题，重复 ${result.duplicated} 题` });
      return { ok: true, ...result };
    } catch (err) {
      emit({ type: 'error', message: `导入失败：${err.message}` });
      return { ok: false, message: err.message };
    }
  });

  ipcMain.handle('collector:export', async (_event, payload) => {
    const subject = payload.subject === 'k4' ? 'k4' : 'k1';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出采集题库',
      defaultPath: `bank-${subject}-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    try {
      const info = collector.exportBank(subject, result.filePath);
      emit({ type: 'log', message: `已导出 ${subject} 题库：${info.count} 题` });
      return { ok: true, ...info };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  ipcMain.handle('collector:open-data-dir', async () => {
    const err = await shell.openPath(collector.DATA_ROOT);
    return err ? { ok: false, message: err } : { ok: true };
  });

  ipcMain.handle('collector:refresh-schedule', () => {
    scheduler.refresh();
    return collector.getStatus();
  });
}

// 精简菜单：保留刷新与开发者工具，方便调试
function buildMenu() {
  const template = [
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新载入' },
        { role: 'forceReload', label: '强制重新载入' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '采集',
      submenu: [
        {
          label: '立即采集',
          click: async () => {
            emit({ type: 'start', message: '从菜单触发采集' });
            await scheduler.runNow('manual').catch((err) => emit({ type: 'error', message: err.message }));
            emit({ type: 'done' });
          },
        },
        {
          label: '打开数据目录',
          click: () => shell.openPath(collector.DATA_ROOT),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // 启动自检：确认采集器在当前运行时可用（数据目录、sql.js、题库统计）
  try {
    const status = collector.getStatus();
    console.log(
      `[collector] 数据目录 ${collector.DATA_ROOT} · 采集题库 科目一 ${status.banks.k1.count} 题 / 科目四 ${status.banks.k4.count} 题 · 定时采集${status.config.schedule.enabled ? '已开启' : '已关闭'}`
    );
  } catch (err) {
    console.error('[collector] 采集器初始化失败：', err && err.message ? err.message : err);
  }

  registerMediaProtocol();
  registerCollectorIpc();
  buildMenu();
  // 启动定时采集调度：应用运行期间按配置间隔自动采集
  scheduler.start((event) => emit(event));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  scheduler.stop();
  if (process.platform !== 'darwin') app.quit();
});
