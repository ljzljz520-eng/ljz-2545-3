// HTTP 路由 + 命令处理（写事件）+ 查询（读快照）。
// 所有写操作都追加事件，绝不就地修改，因此后台每一次“实体变更”都可复现。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EVENT_LOG, UPLOAD_DIR, NOW, PAGE_SIZE_DEFAULT } from './config.js';
import { readEvents, appendEvent, retract } from './event-store.js';
import {
  buildSnapshot, applyFilters, paginate, accessAt, lookupByHouseNumber,
  tileQuery,
} from './domain.js';
import { ok, fail, readJson, readMultipart } from './http-util.js';

const uid = (p) => p + '_' + crypto.randomBytes(5).toString('hex');
const events = () => readEvents(EVENT_LOG);
const ev = (type, data, by, recordedAt) =>
  appendEvent(type, data, { recordedBy: by || 'curator', recordedAt: recordedAt || NOW.toISOString() }, EVENT_LOG);

function snapFromQuery(u) {
  const asOf = u.searchParams.get('asOf') || NOW.toISOString();
  const validAt = u.searchParams.get('validAt') || asOf;
  return buildSnapshot(events(), { asOf, validAt });
}
function filtersFrom(u) {
  return {
    era: u.searchParams.get('era') || undefined,
    style: u.searchParams.get('style') || undefined,
    preservation: u.searchParams.get('preservation') || undefined,
    q: u.searchParams.get('q') || undefined,
    renumbered: u.searchParams.get('renumbered') || undefined,
    includeHistory: u.searchParams.get('includeHistory') || undefined,
  };
}

// ---------------- 写命令（后台维护） ----------------
const commands = {
  createSource: (b) => { const id = b.sourceId || uid('src'); ev('source.registered', { sourceId: id, title: b.title, kind: b.kind || 'document', year: b.year ?? null, reliability: b.reliability ?? 0.5, citation: b.citation || '' }, b.by, b.recordedAt); return { sourceId: id }; },

  createBuilding: (b) => {
    const id = b.buildingId || uid('bld');
    ev('building.registered', { buildingId: id, stableRef: b.stableRef, displayName: b.displayName, styleTags: b.styles || [], preservation: b.preservation || 'fair', note: b.note || '' }, b.by, b.recordedAt);
    if (b.houseNumber) ev('building.aliased', { buildingId: id, aliasId: uid('als'), houseNumber: b.houseNumber, validFrom: b.aliasFrom ?? null, validTo: null, sourceId: b.sourceId || null, note: '创建时门牌' }, b.by, b.recordedAt);
    return { buildingId: id };
  },

  // 门牌沿革：只在同一稳定实体上新增一个时段别名，不新建建筑
  renumber: (b) => {
    const aliasId = uid('als');
    // 关闭该实体在 effectiveDate 仍有效的旧门牌（设置 validTo），作为同一逻辑动作
    ev('alias.closed', { buildingId: b.buildingId, effectiveDate: b.effectiveDate }, b.by, b.recordedAt);
    ev('building.aliased', { buildingId: b.buildingId, aliasId, houseNumber: b.houseNumber, validFrom: b.effectiveDate ?? null, validTo: null, sourceId: b.sourceId || null, note: b.note || '门牌变更' }, b.by, b.recordedAt);
    return { buildingId: b.buildingId, aliasId, houseNumber: b.houseNumber };
  },

  addClaim: (b) => { const id = uid('clm'); ev('building.claimed', { claimId: id, buildingId: b.buildingId, sourceId: b.sourceId, field: b.field, value: b.value, confidence: b.confidence ?? null, note: b.note || '' }, b.by, b.recordedAt); return { claimId: id }; },
  resolve: (b) => { const id = uid('res'); ev('resolution.recorded', { resolutionId: id, buildingId: b.buildingId, field: b.field, adoptedValue: b.adoptedValue, basis: b.basis || '', sourceId: b.sourceId || null, note: b.note || '' }, b.by, b.recordedAt); return { resolutionId: id }; },

  boundary: (b) => { const id = uid('bnd'); ev('boundary.recorded', { boundaryId: id, buildingId: b.buildingId, ring: b.ring, validFrom: b.validFrom ?? null, validTo: b.validTo ?? null, sourceId: b.sourceId || null, note: b.note || '' }, b.by, b.recordedAt); return { boundaryId: id }; },

  // 坐标观测：correctedFrom 给出被纠偏的原始坐标，便于页面展示纠偏轨迹
  coord: (b) => { const id = uid('obs'); ev('coord.observed', { obsId: id, buildingId: b.buildingId, sourceId: b.sourceId, lng: Number(b.lng), lat: Number(b.lat), accuracyM: b.accuracyM ?? null, kind: b.kind || 'survey', correctedFrom: b.correctedFrom || null, note: b.note || '' }, b.by, b.recordedAt); return { obsId: id }; },

  // 合院拆分：新建子建筑 + lineage 关联；子体获得自己的身份，不沿用父体单一身份
  splitCompound: (b) => {
    const children = b.children || [];
    const out = [];
    for (const c of children) {
      const cid = c.buildingId || uid('bld');
      ev('building.registered', { buildingId: cid, stableRef: c.stableRef, displayName: c.displayName, styleTags: c.styles || [], preservation: c.preservation || 'fair', note: c.note || '合院拆分' }, b.by, b.recordedAt);
      const linkId = uid('lnk');
      ev('lineage.linked', { linkId, parentId: b.buildingId, childId: cid, kind: 'split', effectiveDate: b.effectiveDate ?? null, note: c.note || '合院拆分' }, b.by, b.recordedAt);
      if (c.houseNumber) ev('building.aliased', { buildingId: cid, aliasId: uid('als'), houseNumber: c.houseNumber, validFrom: b.effectiveDate ?? null, validTo: null, note: '拆分门牌' }, b.by, b.recordedAt);
      out.push({ buildingId: cid, linkId });
    }
    if (b.closeOldBoundary) ev('boundary.superseded', { buildingId: b.buildingId, effectiveDate: b.effectiveDate ?? null }, b.by, b.recordedAt);
    return { parent: b.buildingId, children: out };
  },

  renovation: (b) => { const id = uid('rnv'); ev('renovation.recorded', { renovationId: id, buildingId: b.buildingId, date: b.date, kind: b.kind || 'repair', scope: b.scope || '', contractor: b.contractor || '', sourceId: b.sourceId || null, note: b.note || '' }, b.by, b.recordedAt); return { renovationId: id }; },

  photo: (b) => { const id = b.photoId || uid('pho'); ev('photo.recorded', { photoId: id, buildingId: b.buildingId, file: b.file || null, filename: b.filename || null, takenAt: b.takenAt ?? null, azimuth: b.azimuth == null ? null : Number(b.azimuth), cameraLng: b.cameraLng == null ? null : Number(b.cameraLng), cameraLat: b.cameraLat == null ? null : Number(b.cameraLat), sourceId: b.sourceId || null, status: b.status || 'present', note: b.note || '' }, b.by, b.recordedAt); return { photoId: id }; },

  // 照片缺失（实体存在但影像尚未找到）：显式标记占位，前端展示“缺失/待补”
  markPhotoMissing: (b) => { const id = b.photoId || uid('pho'); ev('photo.missing', { photoId: id, buildingId: b.buildingId, expectedSide: b.expectedSide || null, sourceId: b.sourceId || null, note: b.note || '影像缺失，待补' }, b.by, b.recordedAt); return { photoId: id }; },

  // 历史照片只登记“候选对应”，不自动认定同一立面
  candidate: (b) => { const id = uid('cand'); ev('photo.candidate', { candidateId: id, photoId: b.photoId, buildingId: b.buildingId, facadeSide: b.facadeSide || null, confidence: b.confidence ?? 0.5, note: b.note || '' }, b.by, b.recordedAt); return { candidateId: id }; },

  entrance: (b) => { const id = b.entranceId || uid('ent'); ev('entrance.registered', { entranceId: id, buildingId: b.buildingId, code: b.code, kind: b.kind || 'door', lng: Number(b.lng), lat: Number(b.lat), note: b.note || '' }, b.by, b.recordedAt); return { entranceId: id }; },
  entranceRule: (b) => { const id = uid('rul'); ev('entrance.rule', { ruleId: id, entranceId: b.entranceId, dayOfWeek: b.dayOfWeek ?? null, startMin: b.startMin ?? null, endMin: b.endMin ?? null, date: b.date ?? null, open: !!b.open, note: b.note || '' }, b.by, b.recordedAt); return { ruleId: id }; },

  // 撤回（列表分页中对象撤回 / 照片撤回）
  retract: (b) => { retract(b.targetEventId, b.reason || '', { recordedBy: b.by || 'curator', recordedAt: b.recordedAt || NOW.toISOString() }, EVENT_LOG); return { retracted: b.targetEventId }; },
};

// ---------------- 路由 ----------------
export async function router(req, res) {
  const u = new URL(req.url, 'http://x');
  const seg = u.pathname.split('/').filter(Boolean);
  try {
    // 静态与上传
    if (req.method === 'GET' && u.pathname.startsWith('/uploads/')) {
      const f = path.normalize(path.join(UPLOAD_DIR, u.pathname.replace('/uploads/', '')));
      if (!f.startsWith(UPLOAD_DIR) || !fs.existsSync(f)) return fail(res, 404, 'not_found', '文件不存在');
      const ext = path.extname(f).toLowerCase();
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[ext] || 'image/jpeg';
      res.writeHead(200, { 'Content-Type': mime }); return fs.createReadStream(f).pipe(res);
    }
    if (seg[0] === 'api' && seg[1] === 'admin' && req.method === 'POST') {
      let body;
      if ((req.headers['content-type'] || '').includes('multipart/form-data')) {
        const { fields, files } = await readMultipart(req);
        if (seg[2] === 'upload') {
          const file = files.file;
          if (!file) return fail(res, 400, 'no_file', '缺少 file');
          fs.mkdirSync(UPLOAD_DIR, { recursive: true });
          const name = uid('img') + path.extname(file.filename || '.jpg');
          fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer);
          return ok(res, { file: name, url: '/uploads/' + name, fields });
        }
        body = fields;
      } else {
        body = await readJson(req);
      }
      const fn = commands[seg[2]];
      if (!fn) return fail(res, 404, 'no_command', '未知命令: ' + seg[2]);
      return ok(res, fn(body));
    }

    if (req.method !== 'GET') return fail(res, 405, 'method', '仅支持 GET/POST');

    // 列表（分页）——与地图共用同一快照、同一筛选
    if (seg[0] === 'api' && seg[1] === 'buildings' && !seg[2]) {
      const snap = snapFromQuery(u);
      const rows = applyFilters(snap.buildings, filtersFrom(u));
      const page = u.searchParams.get('page') || 1;
      const pageSize = u.searchParams.get('pageSize') || PAGE_SIZE_DEFAULT;
      const result = paginate(rows, { page, pageSize });
      return ok(res, { asOf: snap.asOf, validAt: snap.validAt, filters: filtersFrom(u), ...result });
    }
    // 地图全量（同样筛选，但不分页）
    if (seg[0] === 'api' && seg[1] === 'map') {
      const snap = snapFromQuery(u);
      const rows = applyFilters(snap.buildings, filtersFrom(u));
      return ok(res, { asOf: snap.asOf, validAt: snap.validAt, items: rows });
    }
    // 地理分块（瓦片矩形）查询
    if (seg[0] === 'api' && seg[1] === 'tiles') {
      const snap = snapFromQuery(u);
      const p = ['west', 'south', 'east', 'north'].map((k) => Number(u.searchParams.get(k)));
      if (p.some((x) => Number.isNaN(x))) return fail(res, 400, 'bad_bbox', '需要 west,south,east,north');
      const rows = tileQuery(applyFilters(snap.buildings, filtersFrom(u)), { west: p[0], south: p[1], east: p[2], north: p[3] });
      return ok(res, { asOf: snap.asOf, validAt: snap.validAt, bbox: p, count: rows.length, items: rows });
    }
    // 门牌检索两种索引对照
    if (seg[0] === 'api' && seg[1] === 'lookup') {
      const snap = snapFromQuery(u);
      const number = u.searchParams.get('number') || '';
      const at = u.searchParams.get('at') || null;
      return ok(res, {
        current: lookupByHouseNumber(snap, number, { mode: 'current' }),
        timeline: lookupByHouseNumber(snap, number, { mode: 'timeline', at }),
      });
    }
    // 实体详情（含证据差异、照片候选、修缮、开放状态、事件史）
    if (seg[0] === 'api' && seg[1] === 'buildings' && seg[2]) {
      const id = seg[2];
      const snap = snapFromQuery(u);
      const b = snap.buildings.find((x) => x.buildingId === id);
      if (!b) return fail(res, 404, 'not_found', '实体在该快照不存在（可能已撤回或尚未录入）', { asOf: snap.asOf, validAt: snap.validAt });
      const photos = [...snap.db.photos.values()]
        .filter((p) => p.buildingId === id)
        .map((p) => ({
          ...p,
          // 展示该照片的全部候选（可能指向其他实体），不自动认定同一立面
          candidates: snap.db.candidates.filter((c) => c.photoId === p.photoId),
        }));
      const renovations = [...snap.db.renovations.values()].filter((r) => r.buildingId === id);
      const at = u.searchParams.get('at') || snap.validAt;
      return ok(res, { asOf: snap.asOf, validAt: snap.validAt, building: b, photos, renovations, access: accessAt(snap, id, at) });
    }
    if (seg[0] === 'api' && seg[1] === 'sources') {
      const snap = snapFromQuery(u);
      return ok(res, [...snap.db.sources.values()]);
    }
    if (seg[0] === 'api' && seg[1] === 'events') {
      return ok(res, events());
    }
    return fail(res, 404, 'no_route', '未知 API 路径');
  } catch (e) {
    return fail(res, 400, 'bad_request', e.message);
  }
}
