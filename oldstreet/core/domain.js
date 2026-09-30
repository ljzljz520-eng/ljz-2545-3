// 领域投影：把可见事件折叠为某一 (asOf, validAt) 时刻的一致快照。
// asOf    —— 系统时刻（“数据库已知到何时”，决定撤回/录入是否生效）
// validAt —— 业务有效时刻（“我们在观察历史上的哪一天”，决定门牌/边界时段）
import { visibleEvents } from './event-store.js';
import { ERA_BUCKETS, PRESERVATION, STYLE_TAGS } from './config.js';

const DAY = 86400000;
const ms = (d) => (d == null ? null : new Date(d).getTime());

// ---- 基础折叠（与 validAt 无关的“当前已知世界”） ----
function reduce(events) {
  const db = {
    sources: new Map(),
    buildings: new Map(),
    renovations: new Map(),
    photos: new Map(),
    candidates: [],
    entrances: new Map(),
    links: [],
  };
  const b = (id) => {
    if (!db.buildings.has(id)) db.buildings.set(id, { buildingId: id, aliases: [], claims: [], resolutions: [], boundaries: [], coords: [], links: [], _registered: false });
    return db.buildings.get(id);
  };

  for (const e of events) {
    const d = e.data;
    switch (e.type) {
      case 'source.registered':
        db.sources.set(d.sourceId, { ...d });
        break;
      case 'building.registered':
        db.buildings.set(d.buildingId, {
          buildingId: d.buildingId, stableRef: d.stableRef, displayName: d.displayName,
          styleTags: d.styleTags || [], preservation: d.preservation || 'fair',
          note: d.note || '', aliases: [], claims: [], resolutions: [], boundaries: [], coords: [], links: [],
          registeredAt: e.recordedAt, _registered: true,
        });
        break;
      case 'building.aliased': {
        const x = b(d.buildingId);
        const alias = { aliasId: d.aliasId, houseNumber: d.houseNumber, validFrom: d.validFrom ?? null, validTo: d.validTo ?? null, note: d.note || '', sourceId: d.sourceId || null };
        const i = x.aliases.findIndex((a) => a.aliasId === d.aliasId);
        if (i >= 0) x.aliases[i] = { ...x.aliases[i], ...alias }; else x.aliases.push(alias);
        break;
      }
      case 'building.claimed':
        b(d.buildingId).claims.push({ claimId: d.claimId, sourceId: d.sourceId, field: d.field, value: d.value, confidence: d.confidence ?? null, note: d.note || '', recordedAt: e.recordedAt });
        break;
      case 'resolution.recorded': {
        const r = { resolutionId: d.resolutionId, field: d.field, adoptedValue: d.adoptedValue, basis: d.basis || '', sourceId: d.sourceId || null, note: d.note || '', recordedAt: e.recordedAt, order: e.seq };
        b(d.buildingId).resolutions.push(r);
        break;
      }
      case 'alias.closed':
        b(d.buildingId).aliases
          .filter((a) => a.validTo == null && (a.validFrom == null || ms(a.validFrom) < ms(d.effectiveDate)))
          .forEach((a) => { a.validTo = d.effectiveDate ?? null; });
        break;
      case 'boundary.recorded':
        b(d.buildingId).boundaries.push({ boundaryId: d.boundaryId, ring: d.ring, validFrom: d.validFrom ?? null, validTo: d.validTo ?? null, sourceId: d.sourceId || null, note: d.note || '', recordedAt: e.recordedAt });
        break;
      case 'boundary.superseded':
        b(d.buildingId).boundaries
          .filter((x) => x.validTo == null && (x.validFrom == null || ms(x.validFrom) < ms(d.effectiveDate)))
          .forEach((x) => { x.validTo = d.effectiveDate ?? null; });
        break;
      case 'coord.observed':
        b(d.buildingId).coords.push({ obsId: d.obsId, sourceId: d.sourceId, lng: d.lng, lat: d.lat, accuracyM: d.accuracyM ?? null, kind: d.kind || 'survey', correctedFrom: d.correctedFrom || null, note: d.note || '', recordedAt: e.recordedAt });
        break;
      case 'lineage.linked':
        db.links.push({ linkId: d.linkId, parentId: d.parentId, childId: d.childId, kind: d.kind, effectiveDate: d.effectiveDate, note: d.note || '' });
        b(d.parentId).links.push({ otherId: d.childId, dir: 'child', kind: d.kind, effectiveDate: d.effectiveDate, note: d.note || '' });
        b(d.childId).links.push({ otherId: d.parentId, dir: 'parent', kind: d.kind, effectiveDate: d.effectiveDate, note: d.note || '' });
        break;
      case 'renovation.recorded':
        db.renovations.set(d.renovationId, { ...d, recordedAt: e.recordedAt });
        break;
      case 'photo.recorded':
        db.photos.set(d.photoId, { ...d, recordedAt: e.recordedAt });
        break;
      case 'photo.missing':
        db.photos.set(d.photoId, { photoId: d.photoId, buildingId: d.buildingId, file: null, status: 'missing', azimuth: null, cameraLng: null, cameraLat: null, sourceId: d.sourceId || null, expectedSide: d.expectedSide || null, note: d.note || '影像缺失，待补', recordedAt: e.recordedAt });
        break;
      case 'photo.candidate':
        db.candidates.push({ candidateId: d.candidateId, photoId: d.photoId, buildingId: d.buildingId, facadeSide: d.facadeSide || null, confidence: d.confidence ?? 0.5, note: d.note || '', recordedAt: e.recordedAt });
        break;
      case 'entrance.registered':
        db.entrances.set(d.entranceId, { entranceId: d.entranceId, buildingId: d.buildingId, code: d.code, kind: d.kind || 'door', lng: d.lng, lat: d.lat, note: d.note || '', rules: [], registeredAt: e.recordedAt });
        break;
      case 'entrance.rule': {
        const en = db.entrances.get(d.entranceId);
        if (en) en.rules.push({ ruleId: d.ruleId, dayOfWeek: d.dayOfWeek ?? null, startMin: d.startMin ?? null, endMin: d.endMin ?? null, date: d.date ?? null, open: !!d.open, note: d.note || '' });
        break;
      }
      default:
        break;
    }
  }
  return db;
}

function intervalCovers(a, at) {
  const t = ms(at);
  if (a.validFrom && t < ms(a.validFrom)) return false;
  if (a.validTo && t >= ms(a.validTo)) return false;
  return true;
}

// 坐标择优：优先“已纠偏”观测，其次精度最高（accuracyM 最小），再取最新
function chooseCoord(coords) {
  if (!coords.length) return null;
  const score = (c) => (c.correctedFrom ? 0 : 1);
  return [...coords].sort((a, z) =>
    score(a) - score(z) ||
    (a.accuracyM ?? 1e9) - (z.accuracyM ?? 1e9) ||
    ms(z.recordedAt) - ms(a.recordedAt))[0];
}

function latestResolution(resolutions, field) {
  const rs = resolutions.filter((r) => r.field === field).sort((a, z) => z.order - a.order);
  return rs[0] || null;
}

function norm(v) {
  if (Array.isArray(v)) return [...v].map(String).sort().join('|');
  return String(v);
}

// 证据/分歧：同一字段多来源给出不同取值，即构成证据差异
function adoptStyles(b, res) {
  const raw = res ? [].concat(res.adoptedValue)
    : (() => {
        const cs = b.claims.filter((c) => c.field === 'styles')
          .sort((a, z) => (z.confidence ?? 0) - (a.confidence ?? 0));
        return cs[0] ? [].concat(cs[0].value) : b.styleTags;
      })();
  return [...new Set(raw.map(String))];
}
function buildEvidence(b, sources) {
  const out = {};
  for (const field of ['year_built', 'styles', 'preservation', 'name']) {
    const claims = b.claims.filter((c) => c.field === field);
    if (!claims.length) continue;
    const distinct = [...new Map(claims.map((c) => [norm(c.value), c])).keys()];
    const res = latestResolution(b.resolutions, field);
    const adopted = res ? res.adoptedValue
      : field === 'year_built' ? Number(distinct[0])
      : field === 'styles' ? adoptStyles(b, null) : distinct[0];
    const conflict = distinct.length > 1 || (res ? norm(res.adoptedValue) !== norm(distinct[0]) : false);
    out[field] = {
      field, conflict, adopted, resolution: res,
      claims: claims.map((c) => ({
        sourceId: c.sourceId,
        sourceTitle: sources.get(c.sourceId)?.title || c.sourceId,
        reliability: sources.get(c.sourceId)?.reliability ?? null,
        value: c.value, confidence: c.confidence, note: c.note,
      })),
    };
  }
  return out;
}

function eraOf(year) {
  if (year == null || Number.isNaN(Number(year))) return null;
  const y = Number(year);
  return (ERA_BUCKETS.find((k) => y >= k.from && y <= k.to) || null)?.key || null;
}

// 入口在某时刻是否开放：具体日期规则优先，否则按星期+时段。
// 采用“挂钟时间”解析 YYYY-MM-DDTHH:mm（不带时区换算），保证可复现，不受主机时区影响。
function wallClock(atDate) {
  const s = String(atDate).slice(0, 16);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const Y = +m[1], Mo = +m[2], D = +m[3], H = +(m[4] || 0), Mi = +(m[5] || 0);
  const jsDow = new Date(Date.UTC(Y, Mo - 1, D)).getUTCDay(); // 0=周日
  return { date: s.slice(0, 10), dow: (jsDow + 6) % 7, minute: H * 60 + Mi };
}
function entranceOpenAt(en, atDate) {
  const w = wallClock(atDate);
  if (!w) return { open: null, rule: null, reason: '无法解析时间' };
  const dated = en.rules.find((r) => r.date === w.date);
  if (dated) return { open: dated.open, rule: dated, reason: '具体日期公告' };
  const weekly = en.rules
    .filter((r) => r.date == null && (r.dayOfWeek === null || r.dayOfWeek === undefined || r.dayOfWeek === w.dow))
    .find((r) => (r.startMin == null || w.minute >= r.startMin) && (r.endMin == null || w.minute < r.endMin));
  if (weekly) return { open: weekly.open, rule: weekly, reason: '星期时段' };
  return { open: null, rule: null, reason: '无适用规则' };
}

// ---- 物化一座建筑在 validAt 的对外视图 ----
function materialize(b, db, validAt) {
  const aliases = b.aliases.filter((a) => intervalCovers(a, validAt));
  aliases.sort((a, z) => ms(z.validFrom) - ms(a.validFrom));
  const current = aliases[0] || null;
  const boundary = b.boundaries.filter((x) => intervalCovers(x, validAt))
    .sort((a, z) => ms(z.recordedAt) - ms(a.recordedAt))[0] || null;
  const coord = chooseCoord(b.coords);
  const evidence = buildEvidence(b, db.sources);

  const yearRes = latestResolution(b.resolutions, 'year_built');
  const year = yearRes ? Number(yearRes.adoptedValue)
    : evidence.year_built ? Number(evidence.year_built.adopted) : null;
  const stylesRes = latestResolution(b.resolutions, 'styles');
  const styles = adoptStyles(b, stylesRes);
  const presRes = latestResolution(b.resolutions, 'preservation');
  const preservation = presRes ? presRes.adoptedValue : b.preservation;
  const nameRes = latestResolution(b.resolutions, 'name');
  const name = nameRes ? nameRes.adoptedValue : b.displayName;

  // 实体在业务时间轴上的生效区间：
  // 起点 = 最早门牌/边界/“作为拆分产物出生”的时间（均可空表示古已有之）；
  // 终点 = 若本实体作为拆分父体，则在拆分日退役（单一身份不再沿用）。
  const startCandidates = [
    ...b.aliases.map((a) => a.validFrom).filter(Boolean),
    ...b.boundaries.map((x) => x.validFrom).filter(Boolean),
    ...b.links.filter((l) => l.dir === 'parent').map((l) => l.effectiveDate).filter(Boolean),
  ].map(ms).filter((x) => x != null);
  const effectiveStart = startCandidates.length ? new Date(Math.min(...startCandidates)).toISOString() : null;
  const splitEnd = b.links.filter((l) => l.dir === 'child' && l.kind === 'split').map((l) => l.effectiveDate).filter(Boolean).map(ms);
  const effectiveEnd = splitEnd.length ? new Date(Math.min(...splitEnd)).toISOString() : null;
  const vMs = ms(validAt);
  const active = (effectiveStart == null || vMs >= ms(effectiveStart)) && (effectiveEnd == null || vMs < ms(effectiveEnd));

  return {
    buildingId: b.buildingId, stableRef: b.stableRef, displayName: name,
    currentHouseNumber: current ? current.houseNumber : null,
    aliasesAt: aliases, allAliases: b.aliases,
    year, era: eraOf(year), styles, preservation,
    active, effectiveStart, effectiveEnd,
    coord: coord ? { lng: coord.lng, lat: coord.lat, corrected: !!coord.correctedFrom, raw: coord.correctedFrom || null, sourceId: coord.sourceId, accuracyM: coord.accuracyM, kind: coord.kind } : null,
    boundary: boundary ? { boundaryId: boundary.boundaryId, ring: boundary.ring, sourceId: boundary.sourceId } : null,
    evidence,
    links: b.links,
    registeredAt: b.registeredAt,
  };
}

export function buildSnapshot(events, { asOf, validAt } = {}) {
  const vis = visibleEvents(events, asOf);
  const db = reduce(vis);
  const valid = validAt || asOf;
  const buildings = [...db.buildings.values()]
    .filter((b) => b._registered)
    .map((b) => materialize(b, db, valid));
  return { asOf: new Date(asOf).toISOString(), validAt: new Date(valid).toISOString(), db, buildings };
}

// ---- 筛选 + 分页（列表与地图共用同一谓词与同一快照） ----
export function applyFilters(buildings, f = {}) {
  let rows = buildings;
  // 默认仅返回在业务时刻“生效中”的实体；传 includeHistory=1 可含退役/未出生实体
  if (f.includeHistory !== 'true' && f.includeHistory !== '1') rows = rows.filter((x) => x.active);
  if (f.era) rows = rows.filter((x) => x.era === f.era);
  if (f.style) rows = rows.filter((x) => x.styles.includes(f.style));
  if (f.preservation) rows = rows.filter((x) => x.preservation === f.preservation);
  if (f.q) {
    const q = String(f.q).toLowerCase();
    rows = rows.filter((x) =>
      x.displayName.toLowerCase().includes(q) ||
      (x.currentHouseNumber || '').toLowerCase().includes(q) ||
      x.stableRef.toLowerCase().includes(q) ||
      x.allAliases.some((a) => a.houseNumber.toLowerCase().includes(q)));
  }
  if (f.renumbered === 'true') rows = rows.filter((x) => x.allAliases.length > 1);
  rows.sort((a, z) => (a.currentHouseNumber || a.stableRef).localeCompare(z.currentHouseNumber || z.stableRef, 'zh'));
  return rows;
}

export function paginate(rows, { page = 1, pageSize = 4 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(100, Math.max(1, Number(pageSize) || 4));
  const total = rows.length;
  const items = rows.slice((p - 1) * size, p * size);
  return { page: p, pageSize: size, total, totalPages: Math.max(1, Math.ceil(total / size)), items };
}

// ---- 开放状态聚合：一处院门关闭 ≠ 整街/整院不可访问 ----
export function accessAt(snap, buildingId, at) {
  const entrances = [...snap.db.entrances.values()].filter((e) => e.buildingId === buildingId);
  const list = entrances.map((e) => ({ ...e, ...entranceOpenAt(e, at) }));
  const openDoors = list.filter((e) => e.kind === 'door' && e.open === true);
  const openGates = list.filter((e) => e.kind === 'gate' && e.open === true);
  const anyOpen = list.some((e) => e.open === true);
  return {
    at: new Date(at).toISOString(),
    accessible: anyOpen,
    via: anyOpen ? list.filter((e) => e.open).map((e) => e.code) : [],
    gateClosedButStreetAccessible: openDoors.length > 0 && openGates.length === 0,
    entrances: list.map((e) => ({ code: e.code, kind: e.kind, open: e.open, reason: e.reason, note: e.note })),
  };
}

// ---- 两种门牌索引对照 ----
// current  : 仅以 validAt 当时“现行门牌”为键（旧门牌检索会落空）
// timeline : 稳定实体 + 时段别名，按“查询时刻覆盖的别名”命中（支持历史检索）
export function lookupByHouseNumber(snap, number, opts = {}) {
  const mode = opts.mode || 'timeline';
  const q = String(number).trim();
  const at = opts.at || null; // timeline 模式可指定“门牌生效的历史时刻”
  if (mode === 'current') {
    // 现门牌索引：只认 validAt 当下的现行门牌
    const hit = snap.buildings.find((x) => x.active && (x.currentHouseNumber || '') === q);
    return { mode, number, at: snap.validAt, hit: hit ? hit.buildingId : null, note: '仅按现门牌索引：已废止门牌检索落空' };
  }
  // 稳定实体 + 时段别名：跨全部别名命中，并标注该别名在查询/指定时刻是否生效
  const tMs = at ? ms(at) : ms(snap.validAt);
  const hits = [];
  for (const x of snap.buildings) {
    for (const a of x.allAliases) {
      if (a.houseNumber !== q) continue;
      const covers = (a.validFrom == null || tMs >= ms(a.validFrom)) && (a.validTo == null || tMs < ms(a.validTo));
      hits.push({ buildingId: x.buildingId, stableRef: x.stableRef, active: x.active, coversAt: covers, alias: a });
    }
  }
  return {
    mode, number, at: at || snap.validAt,
    hit: hits[0]?.buildingId || null,
    candidates: hits,
    note: at
      ? '稳定实体 + 时段别名：在指定历史时刻按当时门牌命中'
      : '稳定实体 + 时段别名：即便当下已改号，旧门牌仍能回溯到同一稳定实体',
  };
}

// ---- 地理分块（瓦片矩形）查询，复用同一快照谓词 ----
export function tileQuery(buildings, { west, south, east, north }) {
  const inside = (lng, lat) => lng >= west && lng <= east && lat >= south && lat <= north;
  return buildings.filter((x) => {
    if (x.coord && inside(x.coord.lng, x.coord.lat)) return true;
    if (x.boundary && x.boundary.ring.some(([lng, lat]) => inside(lng, lat))) return true;
    return false;
  });
}

// Web 墨卡托辅助（前端 Canvas 自绘地图）
export function mercator(lng, lat, z) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const latR = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  return { x, y };
}

export function pointInRing([lng, lat], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const _internals = { chooseCoord, eraOf, entranceOpenAt, intervalCovers };
