// 实体变更复现用例：从空日志确定性重放“青龙老街”故事线，
// 在多个 (asOf, validAt) 时刻打印系统状态，证明每一次实体变更都可复现。
// 用法：npm run demo:cases   （不依赖网络服务，直接走领域层）
import { resetStore, readEvents } from '../core/event-store.js';
import { EVENT_LOG } from '../core/config.js';
import { buildSnapshot, applyFilters, paginate, lookupByHouseNumber, accessAt, tileQuery } from '../core/domain.js';

const sep = (t) => console.log('\n' + '═'.repeat(72) + '\n' + t + '\n' + '═'.repeat(72));

async function main() {
  // 1) 干净重放：直接调用种子（事件带固定 recordedAt）
  resetStore(EVENT_LOG);
  const seed = await import('./seed.js');
  seed.run();

  // 2) 追加一条可复现的“后台实体变更”：2026-09-29 撤回误录临时棚的注册事件
  const { appendEvent, retract } = await import('../core/event-store.js');
  const bad = readEvents(EVENT_LOG).find((e) => e.type === 'building.registered' && e.data.stableRef === 'TMP-BAD');
  retract(bad.id, '非历史建筑，复核后撤回误录', { recordedBy: 'curator', recordedAt: '2026-09-29T15:00' }, EVENT_LOG);

  const NOW = '2026-09-30T10:00';
  const snap = buildSnapshot(readEvents(EVENT_LOG), { asOf: NOW, validAt: NOW });
  const rows = applyFilters(snap.buildings, {});

  sep('用例1 · 多来源年代矛盾与采纳（裕通号 QLS-001）');
  const b1 = snap.buildings.find((b) => b.buildingId === 'b1');
  const y = b1.evidence.year_built;
  console.log('主张：');
  y.claims.forEach((c) => console.log(`  - ${c.sourceTitle}：${c.value}（可信${c.confidence}，来源可靠度${c.reliability}）`));
  console.log(`分歧=${y.conflict}，当前采纳=${b1.year}（${y.resolution.basis}）→ 分桶=${b1.era}`);

  sep('用例2 · 门牌沿革：同一稳定实体，旧号可回溯');
  console.log('全部别名：');
  b1.allAliases.slice().sort((a, z) => String(a.validFrom).localeCompare(String(z.validFrom)))
    .forEach((a) => console.log(`  ${a.houseNumber}  [${a.validFrom || '古早'} → ${a.validTo || '今'}]`));
  const cur = lookupByHouseNumber(snap, '青龙街42号', { mode: 'current' });
  const tl = lookupByHouseNumber(snap, '青龙街42号', {});
  const tl80 = lookupByHouseNumber(snap, '青龙街42号', { at: '1980-01-01' });
  console.log(`现门牌索引查“青龙街42号” → ${cur.hit || 'null（落空）'}`);
  console.log(`稳定实体+时段别名查“青龙街42号” → ${tl.hit}（当下生效=${tl.candidates[0].coversAt}）`);
  console.log(`指定历史时刻 1980 查“青龙街42号” → ${tl80.hit}（当时生效=${tl80.candidates[0].coversAt}）`);

  sep('用例3 · 合院拆分：母体退役，子体独立身份');
  const s1980 = buildSnapshot(readEvents(EVENT_LOG), { asOf: NOW, validAt: '1980-01-01' });
  console.log('1980 生效实体：', applyFilters(s1980.buildings, {}).map((b) => `${b.stableRef}(${b.currentHouseNumber})`).join('、'));
  console.log('2026 生效实体中的舒泰记相关：', rows.filter((b) => b.stableRef.includes('002')).map((b) => `${b.stableRef}(${b.currentHouseNumber})`).join('、'));

  sep('用例4 · 坐标纠偏');
  console.log(`采纳点 ${b1.coord.lng},${b1.coord.lat}（±${b1.coord.accuracyM}m，已纠偏=${b1.coord.corrected}），原始观测 ${b1.coord.raw.lng},${b1.coord.raw.lat}`);

  sep('用例5 · 历史照片候选（不自动认定同一立面）');
  snap.db.candidates.filter((c) => c.photoId === 'pho_b1_hist')
    .forEach((c) => console.log(`  候选 ${c.buildingId} / ${c.facadeSide} / 置信 ${c.confidence}：${c.note}`));

  sep('用例6 · 院门关闭但街巷可入（咸宁会馆 2026-09-30 12:00）');
  const acc = accessAt(snap, 'b6', '2026-09-30T12:00');
  acc.entrances.forEach((e) => console.log(`  ${e.code}（${e.kind}）→ ${e.open === true ? '开放' : e.open === false ? '关闭' : '无规则'}（${e.reason}）`));
  console.log(`综合：accessible=${acc.accessible}，gateClosedButStreetAccessible=${acc.gateClosedButStreetAccessible}，via=${acc.via.join('、')}`);

  sep('用例7 · 列表分页中的对象撤回（误录临时棚）');
  const before = buildSnapshot(readEvents(EVENT_LOG), { asOf: '2026-09-28T00:00', validAt: NOW });
  const beforeRows = applyFilters(before.buildings, {});
  console.log(`撤回生效前(asOf 09-28) 生效实体数=${beforeRows.length}（含 TMP-BAD=${beforeRows.some((b) => b.stableRef === 'TMP-BAD')}）`);
  console.log(`撤回生效后(asOf 09-30) 生效实体数=${rows.length}（含 TMP-BAD=${rows.some((b) => b.stableRef === 'TMP-BAD')}）`);
  for (let p = 1; p <= 3; p++) { const pg = paginate(rows, { page: p, pageSize: 4 }); console.log(`  第${p}页(${pg.items.length}): ${pg.items.map((x) => x.currentHouseNumber || x.stableRef).join(' | ')}`); }

  sep('用例8 · 地理分块与列表/地图一致快照');
  const lngs = rows.map((b) => b.coord?.lng).filter(Boolean), lats = rows.map((b) => b.coord?.lat).filter(Boolean);
  const W = Math.min(...lngs) - .0005, E0 = Math.max(...lngs) + .0005, S = Math.min(...lats) - .0005, N = Math.max(...lats) + .0005;
  const seen = new Set();
  [[W, S, (W + E0) / 2, (S + N) / 2], [(W + E0) / 2, S, E0, (S + N) / 2], [W, (S + N) / 2, (W + E0) / 2, N], [(W + E0) / 2, (S + N) / 2, E0, N]]
    .forEach((box) => tileQuery(rows, { west: box[0], south: box[1], east: box[2], north: box[3] }).forEach((x) => seen.add(x.buildingId)));
  console.log(`四块并集=${seen.size}，地图/列表全集=${rows.length} → ${seen.size === rows.length ? '一致 ✓' : '不一致'}`);

  sep('复现完成');
  console.log('事件总数 =', readEvents(EVENT_LOG).length, '（含 1 条撤回墓碑）。再次运行本脚本结果完全一致。');
  console.log('提示：浏览器后台的每次操作也只是追加同类事件，可用 /api/events 查看。');
}
main();
