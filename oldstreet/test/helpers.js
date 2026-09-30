import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHandler } from '../src/server.js';
import { persist } from '../src/db.js';

export function makeServer(d, port = 0) {
  const server = http.createServer(createHandler(d));
  return new Promise((res) => server.listen(port, () => res(server)));
}
export function base(server) {
  const a = server.address();
  return `http://127.0.0.1:${a.port}`;
}
export async function req(server, method, url, { body, token, actor } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers['x-admin-token'] = token;
  if (actor) headers['x-actor'] = actor;
  const r = await fetch(base(server) + url, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  return { status: r.status, data, headers: r.headers };
}
export async function closeServer(server) {
  await new Promise((r) => server.close(r));
}
// 让写入落到临时文件（虽然测试主要用内存 DB，审计持久化不影响内存对象）
export function tmpDataFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldstreet-'));
  return path.join(dir, 'db.json');
}
