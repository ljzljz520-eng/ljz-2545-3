// 领域查询层：双时间快照、证据（多来源陈述）、稳定实体 + 时段门牌别名、
// 合院拆分谱系、照片候选对应、入口级开放状态、地理分块。
import { validAt, aliveAt, recTs, dayOf, eraOfYear, ERA_BUCKETS, STYLE_VOCAB, STATUS_VOCAB, vocabLabel } from './db.js';

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unb64 = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

export function visibleRecords(rows, asOfDay, snapshotAt) {
  return rows.filter((r) => aliveAt(r, snapshotAt) && validAt(r, asOfDay));
}

// ---------- 门牌（时段别名） ----------
function activeAliases(d, asOfDay, snapshotAt) {
  // 同一实体在某日理论上只应有一个生效门牌；若区间重叠（如改号时未封口旧号），
  // 取“生效起始最晚”的一条，避免被插入顺序绑架。
  const byEntity = new Map();
  for (const a of visibleRecords(d.aliases, asOfDay, snapshotAt)) {
    const cur = byEntity.get(a.entityId);
    if (!cur || String(a.validFrom || '') > String(cur.validFrom || '')) byEntity.set(a.entityId, a);
  }
  return byEntity;
}
export function aliasIndex(d, asOfDay, snapshotAt) {
  // 索引 A：按“asOf 当日生效的别名”索引（稳定实体 + 时段别名）
  return activeAliases(d, asOfDay, snapshotAt);
}
export function currentNumberIndex(d, asOfDay, snapshotAt) {
  // 索引 B：只看“现门牌（validTo=null）”，历史检索靠回退实体名 —— 朴素方案
  const byEntity = new Map();
  for (const [entityId, a] of activeAliases(d, asOfDay, snapshotAt)) {
    if (a.validTo === null) byEntity.set(entityId, a);
  }
  return byEntity;
}

function numberSortKey(number) {
  const m = String(number || '').match(/\d+/);
  return m ? Number(m[0]) : 99999;
}

// ---------- 证据：属性陈述聚合 ----------
export function resolveClaims(d, entityId, asOfDay, snapshotAt) {
  const src = (id) => d.sources.find((s) => s.id === id);
  const live = d.claims.filter(
    (c) => c.entityId === entityId && aliveAt(c, snapshotAt) && validAt(c, asOfDay)
  );
  const groups = {};
  for (const c of live) {
    (groups[c.attr] ||= []).push(c);
  }
  const resolved = {};
  const evidence = {};
  for (const [attr, claims] of Object.entries(groups)) {
    const sorted = [...claims].sort((a, b) => {
      const sa = src(a.sourceId)?.authority ?? 0;
      const sb = src(b.sourceId)?.authority ?? 0;
      if (sb !== sa) return sb - sa;
      return (b.recordedAt || '').localeCompare(a.recordedAt || '');
    });
    const pick = sorted[0];
    const values = [...new Set(claims.map((c) => String(c.value)))];
    resolved[attr] = pick.value;
    evidence[attr] = {
      selected: {
        value: pick.value, sourceId: pick.sourceId,
        sourceTitle: src(pick.sourceId)?.title || pick.sourceId,
        authority: src(pick.sourceId)?.authority ?? null,
        recordedAt: pick.recordedAt
      },
      conflicting: values.length > 1,
      candidates: claims.map((c) => ({
        value: c.value, sourceId: c.sourceId,
        sourceTitle: src(c.sourceId)?.title || c.sourceId,
        authority: src(c.sourceId)?.authority ?? null,
        recordedAt: c.recordedAt, validFrom: c.validFrom, validTo: c.validTo,
        adopted: c === pick
      }))
    };
  }
  if (resolved.yearBuilt != null) resolved.era = eraOfYear(resolved.yearBuilt);
  return { resolved, evidence };
}

// ---------- 空间 ----------
export function effectiveFootprint(d, entityId, asOfDay, snapshotAt) {
  const live = d.footprints.filter(
    (f) => f.entityId === entityId && aliveAt(f, snapshotAt) && validAt(f, asOfDay)
  );
  if (!live.length) return null;
  const rank = { 'surveyed-corrected': 3, surveyed: 2, reported: 1 };
  return [...live].sort((a, b) => {
    const ra = rank[a.kind] ?? 0, rb = rank[b.kind] ?? 0;
    if (rb !== ra) return rb - ra;
    return (b.recordedAt || '').localeCompare(a.recordedAt || '');
  })[0];
}
export function spatialEvidence(d, entityId, snapshotAt) {
  // 已撤回（被纠偏替代）的旧边界仍作为证据返回，由 withdrawn/supersedes 标记
  return d.footprints
    .filter((f) => f.entityId === entityId && (!f.recordedAt || f.recordedAt <= snapshotAt))
    .map((f) => ({ ...f }));
}

// ---------- 谱系 ----------
export function lineage(d, entityId) {
  const parents = d.relations.filter((r) => r.toEntityIds?.includes(entityId)).map((r) => ({
    relation: 'split-from', parent: r.fromEntityId, date: r.date, siblings: r.toEntityIds.filter((x) => x !== entityId), note: r.note
  }));
  const children = d.relations.filter((r) => r.fromEntityId === entityId).map((r) => ({
    relation: r.kind, children: r.toEntityIds, date: r.date, note: r.note
  }));
  return { parents, children };
}

// ---------- 照片 + 候选对应 ----------
export function photosFor(d, entityId, snapshotAt) {
  return d.photos
    .filter((p) => p.entityId === entityId && aliveAt(p, snapshotAt))
    .map((p) => ({
      ...p,
      matches: d.photoMatches
        .filter((m) => m.photoId === p.id && aliveAt(m, snapshotAt))
        .map((m) => ({ ...m }))
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    }));
}

// ---------- 开放状态（入口 + 时间；不把单点关闭上推为整街关闭） ----------
function weekdayOf(day) {
  // 以 UTC 正午取星期，避免本地时区把日期推到前后一天
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}
function inHours(hours, day, timeHHMM) {
  const h = hours?.[weekdayOf(day)];
  if (!h) return false;
  const [from, to] = h.split('-');
  return timeHHMM >= from && timeHHMM <= to;
}
export function entranceStateAt(periods, day, timeHHMM) {
  const valid = periods.filter((p) => validAt(p, day));
  if (!valid.length) return { state: 'unknown', note: '无开放时段记录' };
  // 区间重叠时取最近开始的一条
  const p = [...valid].sort((a, b) => String(b.validFrom || '').localeCompare(String(a.validFrom || '')))[0];
  if (p.state === 'closed') return { state: 'closed', note: p.note, period: p };
  if (p.state === 'restricted') {
    return { state: inHours(p.weekdayHours, day, timeHHMM) ? 'restricted' : 'restricted-closed', note: p.note, period: p };
  }
  return { state: inHours(p.weekdayHours, day, timeHHMM) ? 'open' : 'outside-hours', note: p.note, period: p };
}
export function accessForEntity(d, entityId, day, timeHHMM) {
  const ens = d.entrances.filter((e) => e.entityId === entityId);
  return ens.map((e) => {
    const ps = d.entrancePeriods.filter((p) => p.entranceId === e.id && !p.withdrawn);
    const s = entranceStateAt(ps, day, timeHHMM);
    return { entranceId: e.id, label: e.label, point: e.point, ...s };
  });
}
export function siteAccess(d, day, timeHHMM) {
  const gates = d.meta.siteEntranceIds.map((id) => {
    const e = d.entrances.find((x) => x.id === id);
    const ps = d.entrancePeriods.filter((p) => p.entranceId === id && !p.withdrawn);
    const s = entranceStateAt(ps, day, timeHHMM);
    return { entranceId: id, label: e?.label || id, point: e?.point, ...s };
  });
  const openCount = gates.filter((g) => g.state === 'open').length;
  return {
    day, time: timeHHMM,
    siteOpen: openCount > 0,                 // 关键规则：一处街门关闭 != 整街不可访问
    openGates: openCount,
    totalGates: gates.length,
    gates,
    summary: openCount > 0
      ? `街区可进入：${openCount}/${gates.length} 个街门开放（单个街门关闭不上推为整街关闭）`
      : '所有街门当前均不开放'
  };
}

// ---------- 实体视图（一致快照的核心） ----------
export function entityView(d, entityId, asOfDay, snapshotAt, { withDetails = false } = {}) {
  const e = d.entities.find((x) => x.id === entityId);
  if (!e) return null;
  const alive = aliveAt(e, snapshotAt);
  const valid = validAt(e, asOfDay);
  const idx = aliasIndex(d, asOfDay, snapshotAt);
  const alias = idx.get(entityId) || null;
  const { resolved, evidence } = resolveClaims(d, entityId, asOfDay, snapshotAt);
  const fp = effectiveFootprint(d, entityId, asOfDay, snapshotAt);
  const now = new Date(`${asOfDay}T${'12:00'}`);
  const timeHHMM = '12:00';
  const view = {
    id: e.id,
    name: e.name,
    note: e.note,
    alive,
    valid,
    numberAt: alias?.number || null,
    numberAliasId: alias?.id || null,
    numberHistory: d.aliases
      // 沿革展示全部“在该事务快照时点已登记”的记录，撤回的错误转录也保留并标注
      .filter((a) => a.entityId === entityId && recTs(a) <= snapshotAt)
      .map((a) => ({ number: a.number, validFrom: a.validFrom, validTo: a.validTo, sourceId: a.sourceId,
        withdrawn: !!a.withdrawn || (a.withdrawnAt && a.withdrawnAt <= snapshotAt), note: a.note }))
      .sort((a, b) => (a.validFrom || '').localeCompare(b.validFrom || '')),
    yearBuilt: resolved.yearBuilt ?? null,
    era: resolved.era ?? null,
    eraLabel: resolved.era ? vocabLabel(ERA_BUCKETS, resolved.era) : null,
    style: resolved.style ?? null,
    styleLabel: resolved.style ? vocabLabel(STYLE_VOCAB, resolved.style) : null,
    status: resolved.status ?? null,
    statusLabel: resolved.status ? vocabLabel(STATUS_VOCAB, resolved.status) : null,
    location: fp ? fp.point : null,
    footprintId: fp?.id || null,
    sortKey: numberSortKey(alias?.number),
    lineage: lineage(d, entityId)
  };
  if (withDetails) {
    view.evidence = evidence;
    view.spatial = spatialEvidence(d, entityId, snapshotAt);
    view.events = d.events
      .filter((v) => v.entityId === entityId && aliveAt(v, snapshotAt) && (v.date || '') <= asOfDay)
      .sort((a, b) => a.date.localeCompare(b.date));
    view.photos = photosFor(d, entityId, snapshotAt);
    view.access = accessForEntity(d, entityId, asOfDay, timeHHMM);
  }
  return view;
}

function matchFilters(view, f) {
  if (f.era && view.era !== f.era) return false;
  if (f.style && view.style !== f.style) return false;
  if (f.status && view.status !== f.status) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    const hay = `${view.name} ${view.note || ''} ${view.numberAt || ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// ---------- 列表（游标分页，快照固定） ----------
export function listBuildings(d, opts = {}) {
  const asOf = dayOf(opts.asOf || new Date().toISOString());
  const snapshotAt = opts.snapshotAt || new Date().toISOString();
  const timeHHMM = opts.time || '12:00';
  const views = d.entities
    .filter((e) => aliveAt(e, snapshotAt) && validAt(e, asOf))
    .map((e) => entityView(d, e.id, asOf, snapshotAt))
    .filter(Boolean)
    .filter((v) => matchFilters(v, opts))
    .sort((a, b) => (a.sortKey - b.sortKey) || a.id.localeCompare(b.id));

  const limit = Math.min(Number(opts.limit) || 20, 200);
  let startIdx = 0;
  if (opts.cursor) {
    const c = unb64(opts.cursor);
    startIdx = views.findIndex((v) => (v.sortKey > c.k) || (v.sortKey === c.k && v.id > c.id));
    if (startIdx < 0) startIdx = views.length;
  }
  const page = views.slice(startIdx, startIdx + limit);
  const nextIdx = startIdx + limit;
  const last = page[page.length - 1];
  return {
    asOf, snapshotAt, time: timeHHMM,
    total: views.length,
    page: page.map((v) => ({ ...v, access: summarizeAccess(accessForEntity(d, v.id, asOf, timeHHMM)) })),
    nextCursor: nextIdx < views.length && last ? b64url({ k: last.sortKey, id: last.id }) : null,
    hasMore: nextIdx < views.length
  };
}
function summarizeAccess(list) {
  if (!list.length) return { state: 'unknown', label: '无入口记录' };
  const order = { open: 3, restricted: 2, 'outside-hours': 1, 'restricted-closed': 0, closed: 0, unknown: 0 };
  const best = [...list].sort((a, b) => (order[b.state] ?? 0) - (order[a.state] ?? 0))[0];
  return { state: best.state, label: best.label, note: best.note, entrances: list.length };
}

// ---------- 地理分块查询（与列表同一快照、同一筛选） ----------
export const CHUNK_DEG = 0.002; // 约 200m 量级
export function chunkOf(lon, lat) {
  return { x: Math.floor(lon / CHUNK_DEG), y: Math.floor(lat / CHUNK_DEG), deg: CHUNK_DEG };
}
export function mapChunks(d, opts = {}) {
  const list = listBuildings(d, opts);
  const chunks = new Map();
  const all = listBuildings(d, { ...opts, limit: 200 });
  for (const v of all.page) {
    if (!v.location) continue;
    const c = chunkOf(v.location[0], v.location[1]);
    const key = `${c.x}/${c.y}`;
    if (!chunks.has(key)) chunks.set(key, { chunk: key, count: 0, entities: [], bbox: chunkBBox(c) });
    const ch = chunks.get(key);
    ch.count += 1;
    ch.entities.push({ id: v.id, name: v.name, numberAt: v.numberAt, point: v.location, status: v.status, era: v.era });
  }
  return { asOf: all.asOf, snapshotAt: all.snapshotAt, chunks: [...chunks.values()] };
}
function chunkBBox(c) {
  const w = c.deg, s = c.y * w, n = s + w, ww = c.x * w, e = ww + w;
  return [ww, s, e, n];
}

// ---------- 双索引一致性比较 ----------
export function compareNumberIndexes(d, asOfDay, snapshotAt) {
  const A = aliasIndex(d, asOfDay, snapshotAt);       // 稳定实体 + 时段别名
  const B = currentNumberIndex(d, asOfDay, snapshotAt); // 现门牌 + 历史回退
  const ids = d.entities.filter((e) => aliveAt(e, snapshotAt) && validAt(e, asOfDay)).map((e) => e.id);
  const rows = ids.map((id) => {
    const a = A.get(id); const b = B.get(id);
    return {
      entityId: id,
      temporalAliasNumber: a?.number || null,
      currentNumberOnly: b?.number || null,
      historicalSearchHitByA: !!a,
      historicalSearchHitByB: !!b, // B 在历史日期往往拿不到门牌号 -> 退化为按名称模糊检索，漏检风险
      consistent: (a?.number || null) === (b?.number || null)
    };
  });
  const mismatches = rows.filter((r) => !r.consistent);
  return {
    asOf: asOfDay, snapshotAt,
    strategyA: '稳定实体 + 时段别名（validFrom/validTo 半开区间）',
    strategyB: '仅现门牌（validTo=null），历史日期靠实体名回退',
    consistent: mismatches.length === 0,
    matchedCount: rows.length - mismatches.length,
    mismatchCount: mismatches.length,
    rows, mismatches
  };
}
