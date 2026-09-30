// 零依赖 HTTP 服务器：查询 API（一致快照）+ 后台维护 API（令牌）+ 静态资源
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, db as getDB, dayOf } from './db.js';
import * as repo from './repo.js';
import * as admin from './admin.js';
import { ERA_BUCKETS, STYLE_VOCAB, STATUS_VOCAB } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const ADMIN_TOKEN = process.env.OLDSTREET_TOKEN || 'dev-token';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon'
};

function readBody(req) {
  return new Promise((res, rej) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 2e6) rej(Object.assign(new Error('body too large'), { status: 413 })); });
    req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch { rej(Object.assign(new Error('invalid JSON'), { status: 400 })); } });
    req.on('error', rej);
  });
}
function json(res, code, data) {
  const buf = Buffer.from(JSON.stringify(data));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(buf);
}

export function createHandler(d) {
  const GET = {
    '/api/vocab': () => ({ eras: ERA_BUCKETS.map(({ id, label }) => ({ id, label })), styles: STYLE_VOCAB, statuses: STATUS_VOCAB }),
    '/api/site': (q) => {
      const asOf = dayOf(q.get('asOf') || new Date().toISOString());
      const time = q.get('time') || '12:00';
      return { ...d.meta, access: repo.siteAccess(d, asOf, time), asOf, time };
    },
    '/api/buildings': (q) => repo.listBuildings(d, {
      era: q.get('era'), style: q.get('style'), status: q.get('status'), q: q.get('q'),
      asOf: q.get('asOf'), snapshotAt: q.get('snapshotAt'), time: q.get('time'),
      cursor: q.get('cursor'), limit: q.get('limit')
    }),
    '/api/map/chunks': (q) => repo.mapChunks(d, {
      era: q.get('era'), style: q.get('style'), status: q.get('status'), q: q.get('q'),
      asOf: q.get('asOf'), snapshotAt: q.get('snapshotAt'), time: q.get('time')
    }),
    '/api/compare/indexes': (q) =>
      repo.compareNumberIndexes(d, dayOf(q.get('asOf') || new Date().toISOString()), q.get('snapshotAt') || new Date().toISOString())
  };

  const POST = {
    '/api/admin/entities': (b) => admin.createEntity(d, b, b.__actor),
    '/api/admin/entities/:id/withdraw': (b, p) => admin.withdrawEntity(d, p.id, b.reason, b.__actor),
    '/api/admin/aliases': (b) => admin.addAlias(d, b, b.__actor),
    '/api/admin/aliases/:id/close': (b, p) => admin.closeAlias(d, p.id, b.validTo, b.__actor),
    '/api/admin/aliases/:id/withdraw': (b, p) => admin.withdrawAlias(d, p.id, b.reason, b.__actor),
    '/api/admin/renumber': (b) => admin.renumber(d, b, b.__actor),
    '/api/admin/split': (b) => admin.splitCourtyard(d, b, b.__actor),
    '/api/admin/claims': (b) => admin.addClaim(d, b, b.__actor),
    '/api/admin/claims/:id/withdraw': (b, p) => admin.withdrawClaim(d, p.id, b.reason, b.__actor),
    '/api/admin/events': (b) => admin.addEvent(d, b, b.__actor),
    '/api/admin/footprints': (b) => admin.addFootprint(d, b, b.__actor),
    '/api/admin/photos': (b) => admin.addPhoto(d, b, b.__actor),
    '/api/admin/photo-candidates': (b) => admin.addPhotoCandidate(d, b, b.__actor),
    '/api/admin/photo-candidates/:id/decide': (b, p) => admin.decideCandidate(d, p.id, b.status, b.decidedBy, b.note, b.__actor),
    '/api/admin/entrances': (b) => admin.addEntrance(d, b, b.__actor),
    '/api/admin/entrance-periods': (b) => admin.addEntrancePeriod(d, b, b.__actor),
    '/api/admin/audits': () => { throw Object.assign(new Error('use GET'), { status: 405 }); }
  };

  function match(pattern, pathname) {
    const pp = pattern.split('/').filter(Boolean);
    const ap = pathname.split('/').filter(Boolean);
    if (pp.length !== ap.length) return null;
    const params = {};
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
      else if (pp[i] !== ap[i]) return null;
    }
    return params;
  }

  return async function handler(req, res) {
    const u = new URL(req.url, 'http://localhost');
    const q = u.searchParams;
    try {
      // 详情（含证据/空间/照片/事件/谱系）
      let m;
      if (req.method === 'GET' && (m = u.pathname.match(/^\/api\/buildings\/([^/]+)$/))) {
        const asOf = dayOf(q.get('asOf') || new Date().toISOString());
        const snapshotAt = q.get('snapshotAt') || new Date().toISOString();
        const v = repo.entityView(d, decodeURIComponent(m[1]), asOf, snapshotAt, { withDetails: true });
        if (!v || !v.alive) return json(res, 404, { error: '实体不存在或在该事务快照已撤回', alive: !!(v && v.alive) });
        return json(res, 200, { ...v, siteAccess: repo.siteAccess(d, asOf, q.get('time') || '12:00') });
      }
      if (req.method === 'GET' && u.pathname === '/api/audits') {
        if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return json(res, 401, { error: '需要管理令牌' });
        return json(res, 200, { audits: admin.listAudits(d, { targetId: q.get('targetId') }) });
      }

      if (req.method === 'GET' && GET[u.pathname]) return json(res, 200, GET[u.pathname](q));

      if (req.method === 'POST') {
        if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return json(res, 401, { error: '需要管理令牌 (X-Admin-Token)' });
        const body = await readBody(req);
        body.__actor = req.headers['x-actor'] || 'curator';
        // 先精确匹配，再参数匹配
        let fn = POST[u.pathname];
        let params = {};
        if (!fn) {
          for (const [pattern, f] of Object.entries(POST)) {
            const p = match(pattern, u.pathname);
            if (p) { fn = f; params = p; break; }
          }
        }
        if (!fn) return json(res, 404, { error: '未知接口: ' + u.pathname });
        const result = await fn(body, params);
        return json(res, 200, { ok: true, result });
      }

      if (req.method === 'GET') return serveStatic(req, res, u.pathname);
      return json(res, 405, { error: 'method not allowed' });
    } catch (e) {
      return json(res, e.status || 500, { error: e.message || String(e) });
    }
  };

  function serveStatic(req, res, pathname) {
    let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    // 故意不拦截：/images/p003.jpg 在磁盘上不存在 -> 真实 404（缺失照片测试）
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('404 资源缺失：' + rel); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  }
}

export function start(port = Number(process.env.PORT) || 8080) {
  const d = getDB();
  const server = http.createServer(createHandler(d));
  server.listen(port, () => console.log(`槐安老街观察站  http://localhost:${port}  (admin token: ${ADMIN_TOKEN})`));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) start();
