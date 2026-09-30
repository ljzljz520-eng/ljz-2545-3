import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { seedDB } from '../src/seed.js';
import * as repo from '../src/repo.js';
import { eraOfYear } from '../src/db.js';

let d;
beforeEach(() => { d = seedDB(); });

test('门牌号是时段别名：同一稳定实体在不同年代返回不同门牌', () => {
  const v1948 = repo.entityView(d, 'E-001', '1948-06-01', '2025-01-01T00:00:00Z');
  const v1980 = repo.entityView(d, 'E-001', '1980-06-01', '2025-01-01T00:00:00Z');
  const v2026 = repo.entityView(d, 'E-001', '2026-01-01', '2025-01-01T00:00:00Z') ;
  assert.equal(v1948.numberAt, '槐安街18号');
  assert.equal(v1980.numberAt, '中山街112号');
  assert.equal(v2026.numberAt, '槐安街12号');
  assert.equal(v1948.id, v1980.id); // 门牌变了，实体没变
});

test('合院拆分：父实体 1997 年后不在列表，子女以独立身份出现且不沿用单一身份', () => {
  const before = repo.listBuildings(d, { asOf: '1996-01-01', snapshotAt: '2025-01-01T00:00:00Z', limit: 50 });
  const idsBefore = before.page.map((v) => v.id);
  assert.ok(idsBefore.includes('E-002'));
  assert.ok(!idsBefore.includes('E-003'));

  const after = repo.listBuildings(d, { asOf: '2026-09-30', snapshotAt: '2025-01-01T00:00:00Z', limit: 50 });
  const idsAfter = after.page.map((v) => v.id);
  assert.ok(!idsAfter.includes('E-002'), '父实体身份止于拆分日');
  assert.ok(idsAfter.includes('E-003') && idsAfter.includes('E-004'));
  const e3 = after.page.find((v) => v.id === 'E-003');
  const e4 = after.page.find((v) => v.id === 'E-004');
  assert.equal(e3.numberAt, '槐安街7号');   // 主门牌被一支沿用
  assert.equal(e4.numberAt, '槐安街9号');   // 另一支经 7-1 改 9 号
  assert.notEqual(e3.id, e4.id);
  // 详情仍可直取父实体（历史身份），谱系指向子女
  const parent = repo.entityView(d, 'E-002', '1990-01-01', '2025-01-01T00:00:00Z', { withDetails: true });
  assert.equal(parent.lineage.children[0].children.join(','), 'E-003,E-004');
});

test('多来源年代矛盾：保留全部候选，按来源权威性选择并标记冲突', () => {
  const v = repo.entityView(d, 'E-005', '2026-09-30', '2025-01-01T00:00:00Z', { withDetails: true });
  const ev = v.evidence.yearBuilt;
  assert.ok(ev.conflicting, '年代存在冲突');
  assert.deepEqual(ev.candidates.map((c) => Number(c.value)).sort((a, b) => a - b), [1899, 1908, 1933]);
  // S3(authority 70) > S7(55) > S8(45) -> 选 1933
  assert.equal(Number(ev.selected.value), 1933);
  assert.equal(ev.selected.sourceId, 'S3');
  // 风格同样冲突
  assert.ok(v.evidence.style.conflicting);
});

test('坐标纠偏：现行边界为纠偏点，旧清册点保留但撤回，证据可见', () => {
  const v = repo.entityView(d, 'E-005', '2026-09-30', '2025-01-01T00:00:00Z', { withDetails: true });
  assert.equal(v.footprintId, 'FP-5');
  assert.deepEqual(v.location, [118.0866, 24.5621]);
  const old = v.spatial.find((f) => f.id === 'FP-5-OLD');
  assert.ok(old.withdrawn, '旧点不删除而是撤回保留');
  assert.equal(v.spatial.find((f) => f.id === 'FP-5').supersedes, 'FP-5-OLD');
});

test('历史照片只保存候选对应：默认 pending，含置信度、朝向与机位不确定度', () => {
  const v = repo.entityView(d, 'E-001', '2026-09-30', '2025-01-01T00:00:00Z', { withDetails: true });
  const p = v.photos.find((x) => x.id === 'P-001');
  assert.equal(p.bearingDegrees, 182);
  assert.equal(p.locationUncertaintyM, 12);
  const pending = p.matches.filter((m) => m.status === 'pending');
  assert.ok(pending.length >= 2, '同一照片存在多个立面候选');
  for (const m of pending) assert.equal(m.decidedBy, null, '候选必须等待人工确认');
  // 缺失文件元数据保留
  const v5 = repo.entityView(d, 'E-005', '2026-09-30', '2025-01-01T00:00:00Z', { withDetails: true });
  assert.ok(v5.photos.find((x) => x.id === 'P-003').fileMissing);
});

test('开放状态按入口×时间：一处街门关闭不推导为整街不可访问', () => {
  const day = '2026-09-30', time = '12:00'; // 东街门 9/29–10/4 关闭
  const site = repo.siteAccess(d, day, time);
  const east = site.gates.find((g) => g.entranceId === 'EN-S1');
  const west = site.gates.find((g) => g.entranceId === 'EN-S2');
  assert.equal(east.state, 'closed');
  assert.equal(west.state, 'open');
  assert.equal(site.siteOpen, true, '西街门开 => 整街仍可访问');
  // 院门关闭只影响该院
  const e3 = repo.entityView(d, 'E-003', day, '2025-01-01T00:00:00Z', { withDetails: true });
  assert.equal(e3.access[0].state, 'closed');
  // 10/05 东街门恢复
  assert.equal(repo.siteAccess(d, '2026-10-05', '12:00').gates[0].state, 'open');
});

test('预约制遗址：营业时段为 restricted，周一闭园', () => {
  const satNoon = repo.entityView(d, 'E-008', '2026-10-03', '2025-01-01T00:00:00Z', { withDetails: true });
  assert.equal(satNoon.access[0].state, 'restricted'); // 2026-10-03 是周六
  const mon = repo.entityView(d, 'E-008', '2026-10-05', '2025-01-01T00:00:00Z', { withDetails: true });
  assert.equal(mon.access[0].state, 'restricted-closed');
});

test('双索引比较：历史日期下“仅现门牌”漏检更名建筑，“时段别名”命中', () => {
  const cmp = repo.compareNumberIndexes(d, '1948-06-01', '2025-01-01T00:00:00Z');
  const row = cmp.rows.find((r) => r.entityId === 'E-001');
  assert.equal(row.temporalAliasNumber, '槐安街18号');
  assert.equal(row.currentNumberOnly, null);
  assert.equal(row.historicalSearchHitByA, true);
  assert.equal(row.historicalSearchHitByB, false);
  assert.equal(cmp.consistent, false);
});

test('列表与地理分块在同一快照、同一筛选下实体集合一致', () => {
  const opts = { asOf: '2026-09-30', snapshotAt: '2025-01-01T00:00:00Z', era: 'republic', limit: 50 };
  const list = repo.listBuildings(d, opts);
  const map = repo.mapChunks(d, opts);
  const listIds = new Set(list.page.map((v) => v.id));
  const mapIds = new Set(map.chunks.flatMap((c) => c.entities.map((e) => e.id)));
  assert.deepEqual([...mapIds].sort(), [...listIds].sort());
  // 分块确实按空间聚合
  assert.ok(map.chunks.every((c) => c.count === c.entities.length));
});

test('年代/风格/状态筛选与年代桶', () => {
  assert.equal(eraOfYear(1892), 'late-qing');
  assert.equal(eraOfYear(1933), 'republic');
  const r = repo.listBuildings(d, { asOf: '2026-09-30', snapshotAt: '2025-01-01T00:00:00Z', status: 'ruin', limit: 50 });
  assert.deepEqual(r.page.map((v) => v.id), ['E-008']);
  const r2 = repo.listBuildings(d, { asOf: '2026-09-30', snapshotAt: '2025-01-01T00:00:00Z', style: 'traditional-hall', limit: 50 });
  assert.deepEqual(r2.page.map((v) => v.id), ['E-006']);
});

test('状态陈述随有效时间变化：E-001 2021 修缮前 weathered，修缮后 restored', () => {
  const before = repo.entityView(d, 'E-001', '2020-01-01', '2025-01-01T00:00:00Z');
  const after = repo.entityView(d, 'E-001', '2023-01-01', '2025-01-01T00:00:00Z');
  assert.equal(before.status, 'weathered');
  assert.equal(after.status, 'restored');
});
