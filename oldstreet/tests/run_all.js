// 零依赖断言测试：直接在事件层构造场景，验证领域不变量。
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { resetStore, readEvents, appendEvent, retract, ensureLog } from '../core/event-store.js';
import {
  buildSnapshot, applyFilters, paginate, accessAt, lookupByHouseNumber, tileQuery,
} from '../core/domain.js';

const FILE = path.join(os.tmpdir(), 'os_test_' + process.pid + '.jsonl');
ensureLog(FILE);
let n = 0;
const passed = [];
function test(name, fn) {
  resetStore(FILE);
  try { fn(); n++; passed.push(name); console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
}
const E = (type, data, when = '2026-09-30T10:00', by = 'curator') =>
  appendEvent(type, data, { recordedBy: by, recordedAt: when }, FILE);
const evs = () => readEvents(FILE);
const NOW = '2026-09-30T10:00';


console.log('— 身份 / 门牌 / 拆分 —');
test('门牌变更不新建建筑：同一稳定实体跨别名', () => {
  resetStore(FILE);
  E('building.registered', { buildingId: 'x', stableRef: 'X-1', displayName: '甲', styleTags: ['stone'], preservation: 'fair' }, '2020-01-01');
  E('building.aliased', { buildingId: 'x', aliasId: 'a1', houseNumber: '旧1号', validFrom: null, validTo: null }, '2020-01-01');
  E('alias.closed', { buildingId: 'x', effectiveDate: '1990-01-01' }, '2021-01-01');
  E('building.aliased', { buildingId: 'x', aliasId: 'a2', houseNumber: '新2号', validFrom: '1990-01-01', validTo: null }, '2021-01-01');
  const snap = buildSnapshot(evs(), { asOf: NOW, validAt: NOW });
  assert.equal(snap.buildings.length, 1, '仍是一座建筑');
  const x = snap.buildings[0];
  assert.equal(x.currentHouseNumber, '新2号');
  assert.deepEqual(x.allAliases.map((a) => a.houseNumber).sort(), ['新2号', '旧1号']);
  // 现门牌索引找不到旧号；时段别名能回溯到同一实体
  assert.equal(lookupByHouseNumber(snap, '旧1号', { mode: 'current' }).hit, null);
  assert.equal(lookupByHouseNumber(snap, '旧1号', {}).hit, 'x');
});

test('合院拆分：母体单一身份退役，子体独立身份且带血缘', () => {
  resetStore(FILE);
  E('building.registered', { buildingId: 'p', stableRef: 'P', displayName: '总院', styleTags: ['stone'], preservation: 'fair' }, '2020-01-01');
  E('building.aliased', { buildingId: 'p', aliasId: 'pa', houseNumber: '57号', validFrom: null, validTo: null }, '2020-01-01');
  E('building.registered', { buildingId: 'c1', stableRef: 'P-A', displayName: '东厢', styleTags: ['stone'], preservation: 'good' }, '2021-01-01');
  E('lineage.linked', { linkId: 'l1', parentId: 'p', childId: 'c1', kind: 'split', effectiveDate: '1985-01-01' }, '2021-01-01');
  E('building.aliased', { buildingId: 'c1', aliasId: 'c1a', houseNumber: '57-1号', validFrom: '1985-01-01', validTo: null }, '2021-01-01');
  const now = buildSnapshot(evs(), { asOf: NOW, validAt: NOW });
  const activeNow = applyFilters(now.buildings, {}).map((b) => b.buildingId).sort();
  assert.deepEqual(activeNow, ['c1'], '当下仅子体生效，母体单一身份退役');
  const p = now.buildings.find((b) => b.buildingId === 'p');
  assert.equal(p.active, false);
  assert.ok(p.links.some((l) => l.otherId === 'c1' && l.dir === 'child'));
  const c1 = now.buildings.find((b) => b.buildingId === 'c1');
  assert.ok(c1.links.some((l) => l.otherId === 'p' && l.dir === 'parent'));
  // 历史时刻：母体仍在，子体未出生
  const old = buildSnapshot(evs(), { asOf: NOW, validAt: '1980-01-01' });
  const active80 = applyFilters(old.buildings, {}).map((b) => b.buildingId);
  assert.deepEqual(active80, ['p']);
});

console.log('— 证据差异 —');
test('多来源年代矛盾：保留全部主张，采纳裁定生效且分桶正确', () => {
  resetStore(FILE);
  E('building.registered', { buildingId: 'b', stableRef: 'B', displayName: '乙', styleTags: [], preservation: 'fair' }, '2020-01-01');
  E('building.aliased', { buildingId: 'b', aliasId: 'a', houseNumber: '1号', validFrom: null, validTo: null }, '2020-01-01');
  E('source.registered', { sourceId: 's1', title: '镇志', reliability: 0.6 }, '2020-01-01');
  E('source.registered', { sourceId: 's2', title: '题记', reliability: 0.95 }, '2020-01-01');
  E('building.claimed', { claimId: 'c1', buildingId: 'b', sourceId: 's1', field: 'year_built', value: 1892, confidence: 0.6 }, '2020-01-01');
  E('building.claimed', { claimId: 'c2', buildingId: 'b', sourceId: 's2', field: 'year_built', value: 1904, confidence: 0.95 }, '2020-03-01');
  E('resolution.recorded', { resolutionId: 'r1', buildingId: 'b', field: 'year_built', adoptedValue: 1904, basis: '一手题记', sourceId: 's2' }, '2020-04-01');
  const s = buildSnapshot(evs(), { asOf: NOW, validAt: NOW });
  const b = s.buildings[0];
  assert.equal(b.year, 1904);
  assert.equal(b.era, 'qing');
  const ev1 = b.evidence.year_built;
  assert.equal(ev1.conflict, true, '不同取值构成分歧');
  assert.equal(ev1.claims.length, 2, '两条矛盾主张都被保留');
});

test('风格多来源：采纳高可信来源并去重', () => {
  resetStore(FILE);
  E('building.registered', { buildingId: 'b', stableRef: 'B', displayName: '丙', styleTags: ['stone'], preservation: 'fair' }, '2020-01-01');
  E('building.aliased', { buildingId: 'b', aliasId: 'a', houseNumber: '2号', validFrom: null, validTo: null }, '2020-01-01');
  E('building.claimed', { claimId: 'k1', buildingId: 'b', sourceId: 's', field: 'styles', value: ['stone', 'stone'], confidence: 0.5 }, '2020-01-01');
  E('building.claimed', { claimId: 'k2', buildingId: 'b', sourceId: 's', field: 'styles', value: ['stone', 'chuandou'], confidence: 0.9 }, '2020-02-01');
  const b = buildSnapshot(evs(), { asOf: NOW, validAt: NOW }).buildings[0];
  assert.deepEqual(b.styles, ['stone', 'chuandou']);
});

console.log('— 坐标 / 空间 —');
test('坐标纠偏：优先已纠偏、其次高精度', () => {
  resetStore(FILE);
  E('building.registered', { buildingId: 'b', stableRef: 'B', displayName: '丁', styleTags: [], preservation: 'fair' }, '2020-01-01');
  E('building.aliased', { buildingId: 'b', aliasId: 'a', houseNumber: '3号', validFrom: null, validTo: null }, '2020-01-01');
  E('coord.observed', { obsId: 'o1', buildingId: 'b', lng: 1, lat: 1, accuracyM: 20, kind: 'georef' }, '2020-01-01');
  E('coord.observed', { obsId: 'o2', buildingId: 'b', lng: 2, lat: 2, accuracyM: 5, kind: 'survey' }, '2020-02-01');
  E('coord.observed', { obsId: 'o3', buildingId: 'b', lng: 3, lat: 3, accuracyM: 3, kind: 'survey', correctedFrom: { lng: 1, lat: 1 } }, '2020-03-01');
  const b = buildSnapshot(evs(), { asOf: NOW, validAt: NOW }).buildings[0];
  assert.equal(b.coord.lng, 3, '采纳已纠偏观测');
  assert.equal(b.coord.corrected, true);
});

test('瓦片分块并集与全集一致（同快照同筛选）', () => {
  resetStore(FILE);
  const coords = [[0, 0], [0.001, 0.001], [0.002, 0.002], [-0.001, 0.0015], [0.0015, -0.0005]];
  coords.forEach(([lng, lat], i) => {
    const id = 'b' + i;
    E('building.registered', { buildingId: id, stableRef: 'G-' + i, displayName: id, styleTags: [], preservation: 'fair' }, '2020-01-01');
    E('building.aliased', { buildingId: id, aliasId: 'a' + i, houseNumber: id + '号', validFrom: null, validTo: null }, '2020-01-01');
    E('coord.observed', { obsId: 'o' + i, buildingId: id, lng, lat, accuracyM: 2, kind: 'survey' }, '2020-01-01');
  });
  const snap = buildSnapshot(evs(), { asOf: NOW, validAt: NOW });
  const rows = applyFilters(snap.buildings, {});
  const W = -0.0015, E0 = 0.0025, S = -0.001, N = 0.0025, mid = 0.0005, midL = 0.00075;
  const boxes = [[W, S, mid, midL], [mid, S, E0, midL], [W, midL, mid, N], [mid, midL, E0, N]];
  const seen = new Set();
  boxes.forEach(([west, south, east, north]) => tileQuery(rows, { west, south, east, north }).forEach((x) => seen.add(x.buildingId)));
  assert.equal(seen.size, rows.length, '四分块并集覆盖全部实体且无重复');
});

console.log('— 开放状态 —');
test('院门关闭但侧巷门开放：仍可访问且标记 gateClosedButStreetAccessible', () => {
  resetStore(FILE);
  E('building.registered', { buildingId: 'b', stableRef: 'B', displayName: '会馆', styleTags: [], preservation: 'good' }, '2020-01-01');
  E('building.aliased', { buildingId: 'b', aliasId: 'a', houseNumber: '6号', validFrom: null, validTo: null }, '2020-01-01');
  E('entrance.registered', { entranceId: 'g', buildingId: 'b', code: '正门院', kind: 'gate', lng: 0, lat: 0 }, '2020-01-01');
  E('entrance.rule', { ruleId: 'gw', entranceId: 'g', dayOfWeek: null, startMin: 480, endMin: 1020, open: true }, '2020-01-01');
  E('entrance.rule', { ruleId: 'gd', entranceId: 'g', date: '2026-09-30', open: false, note: '维护' }, '2026-09-29');
  E('entrance.registered', { entranceId: 'd', buildingId: 'b', code: '侧巷门', kind: 'door', lng: 0, lat: 0 }, '2020-01-01');
  E('entrance.rule', { ruleId: 'dw', entranceId: 'd', dayOfWeek: null, startMin: 420, endMin: 1200, open: true }, '2020-01-01');
  const snap = buildSnapshot(evs(), { asOf: NOW, validAt: NOW });
  const acc = accessAt(snap, 'b', '2026-09-30T12:00');
  assert.equal(acc.accessible, true);
  assert.equal(acc.gateClosedButStreetAccessible, true);
  assert.deepEqual(acc.via, ['侧巷门']);
  // 次日无具体公告，院门恢复按周历开放
  const acc2 = accessAt(snap, 'b', '2026-10-01T12:00');
  assert.equal(acc2.accessible, true);
  assert.ok(acc2.entrances.find((x) => x.code === '正门院').open === true);
});

console.log('— 照片：缺失 & 候选不自动认定 —');
test('照片缺失显式标记；历史照片可有多候选且不被绑定', () => {
  resetStore(FILE);
  E('building.registered', { buildingId: 'b', stableRef: 'B', displayName: '戊', styleTags: [], preservation: 'fair' }, '2020-01-01');
  E('building.aliased', { buildingId: 'b', aliasId: 'a', houseNumber: '7号', validFrom: null, validTo: null }, '2020-01-01');
  E('building.registered', { buildingId: 'b2', stableRef: 'B2', displayName: '己', styleTags: [], preservation: 'fair' }, '2020-01-01');
  E('building.aliased', { buildingId: 'b2', aliasId: 'a2', houseNumber: '8号', validFrom: null, validTo: null }, '2020-01-01');
  E('photo.recorded', { photoId: 'ph', buildingId: 'b', file: 'x.svg', status: 'present', azimuth: 200 }, '2020-01-01');
  E('photo.candidate', { candidateId: 'c1', photoId: 'ph', buildingId: 'b', facadeSide: 'east', confidence: 0.62 }, '2020-01-01');
  E('photo.candidate', { candidateId: 'c2', photoId: 'ph', buildingId: 'b2', facadeSide: 'north', confidence: 0.41 }, '2020-01-01');
  E('photo.missing', { photoId: 'pm', buildingId: 'b2', expectedSide: 'east', note: '待补' }, '2020-01-01');
  const snap = buildSnapshot(evs(), { asOf: NOW, validAt: NOW });
  const cands = snap.db.candidates.filter((c) => c.photoId === 'ph');
  assert.equal(cands.length, 2, '一张老照片保留两个候选，不自动认定');
  assert.equal(snap.db.photos.get('pm').status, 'missing');
  // 缺失照片不影响实体在列表中出现
  assert.equal(applyFilters(snap.buildings, {}).some((x) => x.buildingId === 'b2'), true);
});

console.log('— 双时态 / 撤回 / 分页 —');
test('列表分页中对象撤回：撤回后跨页不缺项不重复', () => {
  resetStore(FILE);
  const TOTAL = 9, SIZE = 4;
  for (let i = 0; i < TOTAL; i++) {
    const id = 'b' + i;
    E('building.registered', { buildingId: id, stableRef: 'S-' + i, displayName: '楼' + i, styleTags: [], preservation: 'fair' }, '2026-08-01');
    E('building.aliased', { buildingId: id, aliasId: 'a' + i, houseNumber: '巷' + (100 + i) + '号', validFrom: null, validTo: null }, '2026-08-01');
  }
  // 撤回前（asOf=2026-08-15）共9座，三页
  let snap = buildSnapshot(evs(), { asOf: '2026-08-15', validAt: NOW });
  let rows = applyFilters(snap.buildings, {});
  assert.equal(rows.length, 9);
  const before = [paginate(rows, { page: 1, pageSize: SIZE }), paginate(rows, { page: 2, pageSize: SIZE }), paginate(rows, { page: 3, pageSize: SIZE })];
  assert.equal(before[0].items.length + before[1].items.length + before[2].items.length, 9);
  // 撤回 b8 的注册事件
  const regEvent = evs().find((e) => e.type === 'building.registered' && e.data.buildingId === 'b8');
  retract(regEvent.id, '误录对象撤回', { recordedBy: 'curator', recordedAt: '2026-09-01T00:00' }, FILE);
  // 撤回后共8座，两页；b8 在所有页消失，其余仍恰好各出现一次
  snap = buildSnapshot(evs(), { asOf: NOW, validAt: NOW });
  rows = applyFilters(snap.buildings, {});
  assert.equal(rows.length, 8);
  const p1 = paginate(rows, { page: 1, pageSize: SIZE });
  const p2 = paginate(rows, { page: 2, pageSize: SIZE });
  const ids = [...p1.items, ...p2.items].map((x) => x.buildingId);
  assert.equal(new Set(ids).size, 8, '无重复');
  assert.ok(!ids.includes('b8'), '撤回对象不在任何页');
  assert.equal(p1.totalPages, 2);
  // 旧快照(asOf=2026-08-15)仍能看到 b8（撤回尚未生效）
  assert.equal(applyFilters(buildSnapshot(evs(), { asOf: '2026-08-15', validAt: NOW }).buildings, {}).length, 9);
});

test('迟到事件：asOf 早于录入时间则不可见', () => {
  resetStore(FILE);
  E('building.registered', { buildingId: 'late', stableRef: 'L', displayName: '迟到', styleTags: [], preservation: 'fair' }, '2026-09-20');
  E('building.aliased', { buildingId: 'late', aliasId: 'al', houseNumber: '迟号', validFrom: null, validTo: null }, '2026-09-20');
  const before = buildSnapshot(evs(), { asOf: '2026-09-01', validAt: NOW });
  assert.equal(before.buildings.length, 0);
  const after = buildSnapshot(evs(), { asOf: NOW, validAt: NOW });
  assert.equal(after.buildings.length, 1);
});

test('筛选与分页同源：筛选年代后地图与列表数量一致', () => {
  resetStore(FILE);
  const mk = (id, year, era) => {
    E('building.registered', { buildingId: id, stableRef: id, displayName: id, styleTags: [], preservation: 'fair' }, '2020-01-01');
    E('building.aliased', { buildingId: id, aliasId: 'a' + id, houseNumber: id + '号', validFrom: null, validTo: null }, '2020-01-01');
    E('building.claimed', { claimId: 'y' + id, buildingId: id, sourceId: 's', field: 'year_built', value: year, confidence: 0.9 }, '2020-01-01');
    E('resolution.recorded', { resolutionId: 'r' + id, buildingId: id, field: 'year_built', adoptedValue: year }, '2020-01-01');
  };
  mk('q1', 1900); mk('q2', 1930); mk('q3', 2010);
  const snap = buildSnapshot(evs(), { asOf: NOW, validAt: NOW });
  const qing = applyFilters(snap.buildings, { era: 'qing' });
  assert.deepEqual(qing.map((b) => b.buildingId), ['q1']);
});

try { fs.unlinkSync(FILE); } catch {}
console.log(`\n通过 ${n} 组测试。` + (process.exitCode ? ' 存在失败。' : ' 全部通过。'));
