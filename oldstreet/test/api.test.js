import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedDB } from '../src/seed.js';
import { setDataFile, getDataFile, db } from '../src/db.js';
import { makeServer, closeServer, req } from './helpers.js';

let server, tmpFile;
const SNAP = '2025-01-01T00:00:00Z'; // 固定事务快照，保证可重复
before(async () => {
  tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'os-api-')), 'db.json');
  setDataFile(tmpFile);
  fs.writeFileSync(tmpFile, JSON.stringify(seedDB(), null, 2));
  const d = db(); // 共享句柄：后台写入（撤回/别名/拆分）对查询接口即时可见
  server = await makeServer(d);
});
after(async () => { await closeServer(server); });

test('GET /api/vocab 返回受控词表', async () => {
  const r = await req(server, 'GET', '/api/vocab');
  assert.equal(r.status, 200);
  assert.ok(r.data.eras.length >= 6 && r.data.styles.length && r.data.statuses.length);
});

test('GET /api/site：2026-09-30 东街门关、西街门开，siteOpen=true', async () => {
  const r = await req(server, 'GET', `/api/site?asOf=2026-09-30&time=12:00&snapshotAt=${SNAP}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.access.siteOpen, true);
  assert.equal(r.data.access.openGates, 1);
});

test('列表筛选 + 游标分页：固定快照下翻页稳定不重不漏', async () => {
  const q = (extra = '') => `/api/buildings?asOf=2026-09-30&snapshotAt=${SNAP}&limit=3${extra}`;
  const p1 = await req(server, 'GET', q());
  assert.equal(p1.data.page.length, 3);
  assert.ok(p1.data.nextCursor);
  const p2 = await req(server, 'GET', q(`&cursor=${p1.data.nextCursor}`));
  const p3 = await req(server, 'GET', q(`&cursor=${p2.data.nextCursor}`));
  const all = [...p1.data.page, ...p2.data.page, ...p3.data.page];
  assert.equal(all.length, p1.data.total);
  assert.equal(new Set(all.map((v) => v.id)).size, all.length, '无重复');
  // 顺序按门牌数字
  const keys = all.map((v) => v.sortKey);
  assert.deepEqual(keys, [...keys].sort((a, b) => a - b));
  assert.equal(p3.data.nextCursor, null);
});

test('列表分页中对象撤回：旧快照仍能取到该页；撤回后的新快照该对象消失，页不空洞', async () => {
  // 1) 用当前（测试库尚未变更）拿第一页并记录第一个对象
  const before = await req(server, 'GET', `/api/buildings?asOf=2026-09-30&snapshotAt=${SNAP}&limit=5`);
  const first = before.data.page[0];
  assert.ok(first);
  // 2) 撤回该实体（后台）
  const w = await req(server, 'POST', `/api/admin/entities/${first.id}/withdraw`,
    { token: 'dev-token', body: { reason: '分页撤回测试：重复录入' } });
  assert.equal(w.status, 200);
  // 3) 旧事务快照仍看得到（时间旅行）
  const oldSnap = await req(server, 'GET', `/api/buildings?asOf=2026-09-30&snapshotAt=${SNAP}&limit=5`);
  assert.ok(oldSnap.data.page.some((v) => v.id === first.id), '历史快照保留撤回前状态');
  // 4) 新快照（now）看不到，total 减一
  const nowSnap = await req(server, 'GET', `/api/buildings?asOf=2026-09-30&limit=50`);
  assert.ok(!nowSnap.data.page.some((v) => v.id === first.id));
  assert.ok(nowSnap.data.total < before.data.total);
  // 详情在新快照 404
  const gone = await req(server, 'GET', `/api/buildings/${first.id}?asOf=2026-09-30`);
  assert.equal(gone.status, 404);
});

test('缺失照片：照片文件真实 404，但实体详情仍返回照片元数据与候选对应', async () => {
  const img = await req(server, 'GET', '/images/p003.jpg');
  assert.equal(img.status, 404);
  const svg = await req(server, 'GET', '/images/p001.svg');
  assert.equal(svg.status, 200);
  const d = await req(server, 'GET', `/api/buildings/E-005?asOf=2026-09-30&snapshotAt=${SNAP}`);
  assert.equal(d.status, 200);
  const p3 = d.data.photos.find((p) => p.id === 'P-003');
  assert.equal(p3.fileMissing, true);
  assert.ok(p3.matches.every((m) => m.status !== 'confirmed' || m.decidedBy), '无系统自动确认');
});

test('多来源年代矛盾在详情中以证据候选呈现，页面可据以展示差异', async () => {
  const d = await req(server, 'GET', `/api/buildings/E-001?asOf=2026-09-30&snapshotAt=${SNAP}`);
  const ev = d.data.evidence.yearBuilt;
  assert.equal(ev.conflicting, true);
  const vals = ev.candidates.map((c) => c.value).sort();
  assert.deepEqual(vals, [1887, 1892]);
  assert.equal(ev.selected.sourceId, 'S3', '权威性更高的三普被采纳');
});

test('后台写操作需要令牌', async () => {
  const r = await req(server, 'POST', '/api/admin/entities', { body: { name: '无令牌建筑' } });
  assert.equal(r.status, 401);
  const ok = await req(server, 'POST', '/api/admin/entities', { token: 'dev-token', body: { name: '令牌建筑', note: 'x' } });
  assert.equal(ok.status, 200);
});

test('门牌变更：renumber 不产生新建筑，只新增别名并封口旧别名', async () => {
  const before = await req(server, 'GET', `/api/buildings/E-001?asOf=2030-01-01&snapshotAt=${SNAP}`);
  const beforeCount = (await req(server, 'GET', `/api/buildings?asOf=2026-09-30&limit=100`)).data.total;
  const r = await req(server, 'POST', '/api/admin/renumber', {
    token: 'dev-token', body: {
      entityId: 'E-001', oldAliasId: 'A-103', oldValidTo: '2030-06-01',
      newNumber: '槐安街12-甲号', validFrom: '2030-06-01', sourceId: 'S4', note: '门面分户编号'
    }
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.result.newAlias.entityId, 'E-001');
  const after = await req(server, 'GET', `/api/buildings?asOf=2026-09-30&limit=100`);
  assert.equal(after.data.total, beforeCount, '建筑实体数量不变');
  const v2031 = await req(server, 'GET', `/api/buildings/E-001?asOf=2031-01-01`);
  assert.equal(v2031.data.numberAt, '槐安街12-甲号');
  assert.equal(v2031.data.id, 'E-001');
});

test('合院拆分 API：父实体不变身份，子女为新实体并建立谱系', async () => {
  const r = await req(server, 'POST', '/api/admin/split', {
    token: 'dev-token', body: {
      parentId: 'E-006', date: '2027-01-15', note: '测试拆分：厢房分编',
      children: [{ name: '林氏宗祠·东厢书房', number: '槐安街26-1号', sourceId: 'S9' }]
    }
  });
  assert.equal(r.status, 200);
  const childId = r.data.result.created[0].id;
  const v = await req(server, 'GET', `/api/buildings/${childId}?asOf=2027-06-01`);
  assert.equal(v.data.lineage.parents[0].parent, 'E-006');
  assert.equal(v.data.numberAt, '槐安街26-1号');
  // 父亲 2027 后默认仍有效（此测试拆分未封口父亲 validTo）
});

test('照片候选对应 API：新增候选为 pending，确认需人工决定', async () => {
  const r = await req(server, 'POST', '/api/admin/photo-candidates', {
    token: 'dev-token', body: { photoId: 'P-003', entityId: 'E-005', facade: '南翼加建立面', confidence: 0.31, note: 'API 测试候选' }
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.result.status, 'pending');
  const dec = await req(server, 'POST', `/api/admin/photo-candidates/${r.data.result.id}/decide`, {
    token: 'dev-token', body: { status: 'rejected', decidedBy: '测试员', note: '柱式不符' }
  });
  assert.equal(dec.status, 200);
  assert.equal(dec.data.result.status, 'rejected');
});

test('地理分块与列表双接口在同参数下实体集合一致', async () => {
  const qs = `asOf=2026-09-30&snapshotAt=${SNAP}&style=minnan-redbrick&limit=100`;
  const list = await req(server, 'GET', `/api/buildings?${qs}`);
  const map = await req(server, 'GET', `/api/map/chunks?${qs}`);
  const a = list.data.page.map((v) => v.id).sort();
  const b = map.data.chunks.flatMap((c) => c.entities.map((e) => e.id)).sort();
  assert.deepEqual(a, b);
});

test('键盘列表与地图同筛选：年代筛选只影响两者的同一集合（接口契约）', async () => {
  const qs = `asOf=2026-09-30&snapshotAt=${SNAP}&era=late-qing&limit=100`;
  const list = await req(server, 'GET', `/api/buildings?${qs}`);
  const map = await req(server, 'GET', `/api/map/chunks?${qs}`);
  assert.ok(list.data.page.length > 0);
  assert.deepEqual(
    list.data.page.map((v) => v.id).sort(),
    map.data.chunks.flatMap((c) => c.entities.map((e) => e.id)).sort()
  );
});

test('审计日志记录实体变更', async () => {
  const r = await req(server, 'GET', '/api/audits?targetId=E-001', { token: 'dev-token' });
  assert.equal(r.status, 200);
  assert.ok(r.data.audits.some((a) => a.action === 'alias.renumber'));
  const noToken = await req(server, 'GET', '/api/audits');
  assert.equal(noToken.status, 401);
});

test('无效输入：错误 JSON 返回 400，未知路由 404', async () => {
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/events`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': 'dev-token' },
    body: '{not json'
  });
  assert.equal(r.status, 400);
  const nf = await req(server, 'GET', '/api/nope');
  assert.equal(nf.status, 404);
});

test('拆分子女有效时间：拆分日前不可见，当日起可见', async () => {
  const r = await req(server, 'POST', '/api/admin/split', {
    token: 'dev-token', body: {
      parentId: 'E-009', date: '2028-03-01', note: '边界测试拆分',
      children: [{ name: '槐安旅社·北楼', number: '槐安街35-1号', sourceId: 'S9' }]
    }
  });
  assert.equal(r.status, 200);
  const childId = r.data.result.created[0].id;
  const before = await req(server, 'GET', `/api/buildings?asOf=2028-02-28&limit=100`);
  assert.ok(!before.data.page.some((v) => v.id === childId), '拆分日前子女不存在');
  const after = await req(server, 'GET', `/api/buildings?asOf=2028-03-01&limit=100`);
  assert.ok(after.data.page.some((v) => v.id === childId), '拆分当日起子女出现');
});
