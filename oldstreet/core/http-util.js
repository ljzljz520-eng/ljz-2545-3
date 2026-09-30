import fs from 'node:fs';
import path from 'node:path';

export function send(res, status, obj, headers = {}) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
export const ok = (res, data) => send(res, 200, { ok: true, data });
export const fail = (res, status, code, message, extra = {}) => send(res, status, { ok: false, error: { code, message, ...extra } });

export async function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 8e6) reject(new Error('payload too large')); });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

export function serveStatic(req, res, root) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) return fail(res, 403, 'forbidden', '路径越界');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return fail(res, 404, 'not_found', '资源不存在');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// 极简 multipart/form-data 解析（仅支持小文件图片）
export async function readMultipart(req) {
  const ct = req.headers['content-type'] || '';
  const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!m) throw new Error('no multipart boundary');
  const boundary = '--' + (m[1] || m[2]);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const bBuf = Buffer.from(boundary);
  const fields = {}; const files = {};
  let start = buf.indexOf(bBuf);
  while (start !== -1) {
    start += bBuf.length;
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break; // -- 结束
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
    const next = buf.indexOf(bBuf, start);
    if (next === -1) break;
    let part = buf.slice(start, next);
    // 去掉末尾 CRLF
    if (part[part.length - 1] === 0x0a && part[part.length - 2] === 0x0d) part = part.slice(0, -2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const header = part.slice(0, headerEnd).toString('utf8');
      const content = part.slice(headerEnd + 4);
      const nameM = header.match(/name="([^"]*)"/);
      const fileM = header.match(/filename="([^"]*)"/);
      if (nameM) {
        if (fileM) files[nameM[1]] = { filename: fileM[1], contentType: (header.match(/Content-Type:\s*(\S+)/i) || [])[1] || 'application/octet-stream', buffer: content };
        else fields[nameM[1]] = content.toString('utf8');
      }
    }
    start = next;
  }
  return { fields, files };
}
