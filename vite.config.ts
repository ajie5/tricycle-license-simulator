import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

/**
 * 开发期只读数据桥：把本机 data/ 下的采集题库与插图通过 HTTP 暴露给浏览器端。
 * 桌面端由 Electron IPC 提供同样能力，这里是 npm run web 时的等价替代，方便调试与验证。
 */
function collectorDevBridge(): Plugin {
  /** 惰性加载采集器模块，避免拖慢 Vite 启动 */
  const collectorApi = () => require('./electron/collector/index.js') as {
    getStatus: () => unknown;
    loadCollected: (subject: string, limit?: number) => unknown;
  };
  const dataRoot = () => require('./electron/collector/store.js').DATA_ROOT as string;

  return {
    name: 'collector-dev-bridge',
    configureServer(server) {
      server.middlewares.use('/__collector__', (req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const send = (payload: unknown) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(payload));
        };
        try {
          const api = collectorApi();
          if (url.pathname.startsWith('/bank')) {
            const subject = url.searchParams.get('subject') === 'k4' ? 'k4' : 'k1';
            const limit = Number(url.searchParams.get('limit') || 0);
            return send(api.loadCollected(subject, limit));
          }
          return send(api.getStatus());
        } catch (err) {
          res.statusCode = 500;
          send({ error: err instanceof Error ? err.message : String(err) });
        }
      });

      // 采集插图：data/images/*.jpg
      server.middlewares.use('/__media__', (req, res) => {
        const rel = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
        const root = dataRoot();
        const target = path.resolve(root, rel);
        if (target !== root && !target.startsWith(root + path.sep)) {
          res.statusCode = 403;
          return res.end('forbidden');
        }
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(target)
          .on('error', () => {
            res.statusCode = 404;
            res.end('not found');
          })
          .pipe(res);
      });
    },
  };
}

/* Electron 通过 file:// 加载打包产物，base 必须为相对路径 */
export default defineConfig({
  base: './',
  plugins: [vue(), collectorDevBridge()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
});
