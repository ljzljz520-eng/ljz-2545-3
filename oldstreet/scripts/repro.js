// 实体变更复现用例（可重复执行；使用临时数据文件，不影响正式库）
// 用法：node scripts/repro.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataFile, db } from '../src/db.js';
import { seedDB } from '../src/seed.js';
import * as repo from '../src/repo.js';
import * as admin from '../src/admin.js';

setDataFile(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'os-repro-')), 'repro.json'));
const d = db();
Object.assign(d, seedDB());

const line = (s = '') => console.log(s);
const h1 = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const brief = (v) => v ? `${v.id.padEnd(7)} ${String(v.numberAt || '（当日无门牌）').padEnd(14)} ${v.name}` : '(无)';

function snapshotRow(id, days, snap) {
  for (const day of days) {
    const v = repo.entityView(d, id, day, snap);
    line(`  ${day}  ${v ? brief(v) : id + ' （该快照不存在/已撤回）'}`);
  }
}

// ---------------------------------------------------------------------------
h1('用例 1｜门牌变更不新建建筑（renumber：封口旧别名 + 新别名指向同一实体）');
line('背景：E-001 荣盛酱园旧址，2030-06-01 因分户由「槐安街12号」改「槐安街12-甲号」。');
line('变更前，E-001 在三个日期的门牌：');
snapshotRow('E-001', ['2029-01-01', '2031-01-01'], '2026-01-01T00:00:00Z');
const nBefore = d.entities.length;
const rn = admin.renumber(d, {
  entityId: 'E-001', oldAliasId: 'A-103', oldValidTo: '2030-06-01',
  newNumber: '槐安街12-甲号', validFrom: '2030-06-01', sourceId: 'S4', note: '复现：门面分户编号'
}, 'repro-script');
line(`\n执行 renumber：关闭 ${rn.closedAlias.id}（validTo=2030-06-01），新建 ${rn.newAlias.id} -> 仍指向 E-001`);
line(`建筑实体数量：${nBefore} -> ${d.entities.length}（应保持 ${nBefore}）`);
line('变更后：');
snapshotRow('E-001', ['2029-01-01', '2031-01-01'], '2031-01-01T00:00:00Z');

// ---------------------------------------------------------------------------
h1('用例 2｜合院拆分不沿用单一身份（split：父实体历史保留，子女为新稳定实体）');
line('背景：E-002 徐家大院，1997-04-10 析产。种子已内置，本用例再拆分 E-006 林氏宗祠作复演。');
line('\n种子用例（E-002）：');
for (const day of ['1996-01-01', '2000-01-01']) {
  const lst = repo.listBuildings(d, { asOf: day, snapshotAt: '2030-01-01T00:00:00Z', limit: 50 }).page;
  line(`  ${day} 列表：`);
  for (const v of lst.filter((x) => ['E-002', 'E-003', 'E-004'].includes(x.id))) line('    ' + brief(v));
}
const sp = admin.splitCourtyard(d, {
  parentId: 'E-006', date: '2027-01-15', note: '复现：东厢书房分编，子女不继承宗祠单一身份',
  children: [
    { name: '林氏宗祠·东厢书房', number: '槐安街26-1号', sourceId: 'S9' },
    { name: '林氏宗祠·西厢库房', number: '槐安街26-2号', sourceId: 'S9' }
  ]
}, 'repro-script');
line(`\n执行 split：父 ${sp.parentId} -> 子女 ${sp.created.map((c) => c.id).join('、')}，谱系 ${sp.relation.id}`);
const child = sp.created[0];
const cv = repo.entityView(d, child.id, '2028-01-01', '2030-01-01T00:00:00Z', { withDetails: true });
line(`子女 ${child.id} 门牌=${cv.numberAt}；谱系 parents=${JSON.stringify(cv.lineage.parents.map((p) => p.parent))}`);

// ---------------------------------------------------------------------------
h1('用例 3｜列表分页中对象撤回（事务时间旅行：旧快照稳定，新快照收缩）');
const SNAP_OLD = '2025-06-01T00:00:00Z';
const p1 = repo.listBuildings(d, { asOf: '2026-09-30', snapshotAt: SNAP_OLD, limit: 3 });
line('撤回前第 1 页（snapshot=2025-06-01）：'); p1.page.forEach((v) => line('  ' + brief(v)));
const victim = p1.page[1];
admin.withdrawEntity(d, victim.id, '复现：分页中途撤回（误录）', 'repro-script');
line(`\n撤回 ${victim.id}（${victim.name}）。`);
const p1Old = repo.listBuildings(d, { asOf: '2026-09-30', snapshotAt: SNAP_OLD, limit: 3 });
line('同一旧事务快照再取第 1 页（应与撤回前逐字一致）：');
p1Old.page.forEach((v) => line('  ' + brief(v)));
line(`一致？ ${JSON.stringify(p1Old.page.map((v) => v.id)) === JSON.stringify(p1.page.map((v) => v.id))}`);
const p1New = repo.listBuildings(d, { asOf: '2026-09-30', snapshotAt: '2030-01-01T00:00:00Z', limit: 50 });
line(`新事务快照（2030）总数 ${p1New.total}，是否还包含 ${victim.id}？ ${p1New.page.some((v) => v.id === victim.id)}`);

// ---------------------------------------------------------------------------
h1('用例 4｜坐标纠偏（新边界 supersede 旧点，旧点作为证据保留）');
const v5before = repo.entityView(d, 'E-005', '2026-09-30', '2030-01-01T00:00:00Z', { withDetails: true });
line(`纠偏前现行点：${v5before.location.join(',')}（边界 ${v5before.footprintId}）`);
const fp = admin.addFootprint(d, {
  entityId: 'E-005', kind: 'surveyed-corrected',
  point: [118.08662, 24.56213],
  ring: [[118.08646, 24.56201], [118.08678, 24.56201], [118.08678, 24.56225], [118.08646, 24.56225], [118.08646, 24.56201]],
  sourceId: 'S4', supersedes: 'FP-5', note: '复现：RTK 复核微调', correctedFrom: [118.0866, 24.5621]
}, 'repro-script');
const v5after = repo.entityView(d, 'E-005', '2026-09-30', '2030-01-01T00:00:00Z', { withDetails: true });
line(`新边界 ${fp.id}，现行点变为：${v5after.location.join(',')}`);
line('空间证据中仍保留的历史点：');
v5after.spatial.forEach((f) => line(`  ${f.id.padEnd(10)} ${f.kind.padEnd(20)} 撤回=${!!f.withdrawn} 点=${f.point.join(',')}`));

// ---------------------------------------------------------------------------
h1('用例 5｜历史照片候选对应（不自动认定同一立面）');
const photo = admin.addPhoto(d, {
  entityId: 'E-001', takenAt: '1936-02-01', bearingDegrees: 178,
  estimatedLocation: [118.08425, 24.56265], locationUncertaintyM: 14,
  file: '/images/unknown-1936.jpg', fileMissing: false,
  caption: '复现：来源不明的 1936 年街景照', sourceId: 'S6', era: 'historical'
}, 'repro-script');
const c1 = admin.addPhotoCandidate(d, { photoId: photo.id, entityId: 'E-001', facade: '正立面', confidence: 0.58, note: '开间数吻合，但女儿墙年代存疑' }, 'repro-script');
admin.addPhotoCandidate(d, { photoId: photo.id, entityId: 'E-001', facade: '东厢山墙', confidence: 0.3, note: '仅轮廓相似' }, 'repro-script');
line(`照片 ${photo.id} 登记朝向=${photo.bearingDegrees}° 机位不确定度=${photo.locationUncertaintyM}m`);
line(`生成候选 ${c1.id} 等，初始状态：${c1.status}（系统不置 confirmed）`);
const dec = admin.decideCandidate(d, c1.id, 'confirmed', '历史建筑测绘员', '比对 1953 改建档案后确认', 'repro-script');
line(`人工裁定后：${dec.status} by ${dec.decidedBy}`);

// ---------------------------------------------------------------------------
h1('用例 6｜多来源年代矛盾（冲突并存，按权威性取舍，撤回后重算）');
let v1 = repo.entityView(d, 'E-005', '2026-09-30', '2030-01-01T00:00:00Z', { withDetails: true });
line(`E-005 年代表述：${v1.evidence.yearBuilt.candidates.map((c) => `${c.value}(${c.sourceId},权威${c.authority})`).join(' / ')}`);
line(`采纳：${v1.evidence.yearBuilt.selected.value}（来源 ${v1.evidence.yearBuilt.selected.sourceId}），冲突=${v1.evidence.yearBuilt.conflicting}`);
const claim = admin.addClaim(d, { entityId: 'E-005', attr: 'yearBuilt', value: 1912, sourceId: 'S4' }, 'repro-script');
let v2 = repo.entityView(d, 'E-005', '2026-09-30', '2030-01-01T00:00:00Z', { withDetails: true });
line(`加入实测陈述 ${claim.id}=1912(S4,权威95) 后采纳：${v2.evidence.yearBuilt.selected.value}`);
admin.withdrawClaim(d, claim.id, '复现：实测纪年释读有误', 'repro-script');
let v3 = repo.entityView(d, 'E-005', '2026-09-30', '2030-01-01T00:00:00Z', { withDetails: true });
line(`撤回该陈述后采纳恢复为：${v3.evidence.yearBuilt.selected.value}`);

// ---------------------------------------------------------------------------
h1('用例 7｜入口级开放（一处院门关闭 ≠ 整街不可访问）');
const day = '2026-09-30';
const site = repo.siteAccess(d, day, '12:00');
site.gates.forEach((g) => line(`  ${g.label}: ${g.state}`));
line(`结论：${site.summary}`);
line(`E-003 东护厝院门状态：${repo.entityView(d, 'E-003', day, '2030-01-01T00:00:00Z', { withDetails: true }).access.map((a) => a.state).join(',')}（院门关闭，街区仍开放）`);

// ---------------------------------------------------------------------------
h1('用例 8｜双索引：现门牌索引 vs 稳定实体 + 时段别名（1948 历史检索）');
const cmp = repo.compareNumberIndexes(d, '1948-06-01', '2030-01-01T00:00:00Z');
for (const r of cmp.rows.filter((x) => !x.consistent).slice(0, 6)) {
  line(`  ${r.entityId}: A=${r.temporalAliasNumber || '—'}（命中=${r.historicalSearchHitByA}）  B=${r.currentNumberOnly || '—'}（命中=${r.historicalSearchHitByB}）`);
}
line(`一致？${cmp.consistent}；不一致 ${cmp.mismatchCount} 条 —— 历史检索必须走时段别名索引。`);

line('\n复现完成。以上每一步均可在空库上由本脚本确定性重演。');
