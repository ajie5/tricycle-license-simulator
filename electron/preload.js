// 预加载脚本：在隔离环境中向渲染层暴露受控的采集接口
const { contextBridge, ipcRenderer } = require('electron');

const listener = (_event, payload) => {
  if (typeof currentHandler === 'function') currentHandler(payload);
};
let currentHandler = null;
ipcRenderer.on('collector:event', listener);

contextBridge.exposeInMainWorld('tricycle', {
  isDesktop: true,
  /** 本机数据目录（采集数据存放位置） */
  dataRoot: () => ipcRenderer.invoke('collector:data-root'),
  /** 本地图片协议的访问前缀 */
  mediaBase: 'tricycle-media://local/',
  collector: {
    status: () => ipcRenderer.invoke('collector:status'),
    run: (payload) => ipcRenderer.invoke('collector:run', payload || {}),
    saveConfig: (patch) => ipcRenderer.invoke('collector:config:save', patch),
    collected: (subject, limit) => ipcRenderer.invoke('collector:collected', subject || 'k1', limit || 0),
    clearBank: (subject) => ipcRenderer.invoke('collector:clear-bank', subject || null),
    clearCache: () => ipcRenderer.invoke('collector:clear-cache'),
    importFile: (payload) => ipcRenderer.invoke('collector:import', payload || {}),
    exportBank: (payload) => ipcRenderer.invoke('collector:export', payload || {}),
    pickFile: (payload) => ipcRenderer.invoke('collector:pick-file', payload || {}),
    openDataDir: () => ipcRenderer.invoke('collector:open-data-dir'),
    refreshSchedule: () => ipcRenderer.invoke('collector:refresh-schedule'),
    /** 订阅采集进度事件，返回取消订阅函数 */
    onEvent: (cb) => {
      currentHandler = cb;
      return () => {
        if (currentHandler === cb) currentHandler = null;
      };
    },
  },
});
