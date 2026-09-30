import http from 'node:http';
import { router } from './core/api.js';
import { serveStatic } from './core/http-util.js';
import { PUBLIC_DIR, EVENT_LOG } from './core/config.js';
import { ensureLog } from './core/event-store.js';

const PORT = process.env.PORT || 8080;
ensureLog(EVENT_LOG);

const server = http.createServer((req, res) => {
  // API 与上传文件交给路由器；其余走 public 静态目录
  if (req.url.startsWith('/api/') || req.url.startsWith('/uploads/')) return router(req, res);
  return serveStatic(req, res, PUBLIC_DIR);
});

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  server.listen(PORT, () => console.log(`老街观察站运行于 http://localhost:${PORT} （事件日志 ${EVENT_LOG}）`));
}
export default server;
