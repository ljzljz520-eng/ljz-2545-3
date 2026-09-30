// 后台维护：所有写入记录审计日志。撤回不物理删除（保留事务时间证据）。
import { newId, nowTs, audit, persist } from './db.js';

function must(d, coll, id) {
  const r = d[coll].find((x) => x.id === id);
  if (!r) throw Object.assign(new Error(`${coll} 中找不到 ${id}`), { status: 404 });
  return r;
}

// ---- 建筑实体 ----
export function createEntity(d, { name, note }, actor) {
  const e = { id: newId('E'), name, note: note || '', createdAt: nowTs(), withdrawn: false };
  d.entities.push(e);
  audit(d, actor, 'entity.create', 'entity', e.id, { name });
  persist();
  return e;
}
export function updateEntity(d, id, patch, actor) {
  const e = must(d, 'entities', id);
  const before = { name: e.name, note: e.note };
  if (patch.name !== undefined) e.name = patch.name;
  if (patch.note !== undefined) e.note = patch.note;
  audit(d, actor, 'entity.update', 'entity', id, { before, after: { name: e.name, note: e.note } });
  persist();
  return e;
}
export function withdrawEntity(d, id, reason, actor) {
  const e = must(d, 'entities', id);
  e.withdrawn = true;
  e.withdrawnAt = nowTs();
  e.withdrawnReason = reason || '';
  audit(d, actor, 'entity.withdraw', 'entity', id, { reason });
  persist();
  return e;
}

// ---- 门牌沿革（别名；更名不新建建筑） ----
export function addAlias(d, { entityId, number, validFrom, validTo, sourceId, note }, actor) {
  must(d, 'entities', entityId);
  const a = {
    id: newId('A'), entityId, number, validFrom: validFrom || null, validTo: validTo || null,
    sourceId: sourceId || null, note: note || '', recordedAt: nowTs(), withdrawn: false, withdrawnAt: null
  };
  d.aliases.push(a);
  audit(d, actor, 'alias.add', 'alias', a.id, { entityId, number, validFrom, validTo });
  persist();
  return a;
}
export function closeAlias(d, id, validTo, actor) {
  // 历史沿革“封口”：给旧门牌设失效日，而非删改
  const a = must(d, 'aliases', id);
  const before = a.validTo;
  a.validTo = validTo;
  audit(d, actor, 'alias.close', 'alias', id, { before, validTo });
  persist();
  return a;
}
export function renumber(d, { entityId, oldAliasId, oldValidTo, newNumber, validFrom, sourceId, note }, actor) {
  // 复现用例：门牌变更 = 关闭旧别名 + 新别名指向同一实体（不新建建筑）
  must(d, 'entities', entityId);
  const closed = oldAliasId ? closeAlias(d, oldAliasId, oldValidTo, actor) : null;
  const a = addAlias(d, { entityId, number: newNumber, validFrom, validTo: null, sourceId, note }, actor);
  audit(d, actor, 'alias.renumber', 'entity', entityId, { oldAliasId, newNumber, validFrom });
  persist();
  return { closedAlias: closed, newAlias: a };
}
export function withdrawAlias(d, id, reason, actor) {
  const a = must(d, 'aliases', id);
  a.withdrawn = true; a.withdrawnAt = nowTs(); a.withdrawnReason = reason || '';
  audit(d, actor, 'alias.withdraw', 'alias', id, { reason });
  persist();
  return a;
}

// ---- 合院拆分：子女是新的稳定实体，不能沿用单一身份 ----
export function splitCourtyard(d, { parentId, children, date, note }, actor) {
  const parent = must(d, 'entities', parentId);
  const created = children.map((c) => ({
    id: c.id || newId('E'), name: c.name, note: c.note || '',
    createdAt: nowTs(), validFrom: date, validTo: null, withdrawn: false
  }));
  for (const c of created) if (!d.entities.find((e) => e.id === c.id)) d.entities.push(c);
  const rel = {
    id: newId('R'), kind: 'split', fromEntityId: parentId,
    toEntityIds: created.map((c) => c.id), date, note: note || '', recordedAt: nowTs()
  };
  d.relations.push(rel);
  // 子女各自门牌；父实体旧门牌应在 date 封口
  for (const c of children) {
    if (c.number) {
      d.aliases.push({ id: newId('A'), entityId: created.find((x) => x.name === c.name).id,
        number: c.number, validFrom: date, validTo: null, sourceId: c.sourceId || null,
        note: c.noteAlias || '合院拆分后编立', recordedAt: nowTs(), withdrawn: false, withdrawnAt: null });
    }
  }
  d.events.push({ id: newId('V'), entityId: parentId, kind: 'split', date,
    title: '合院拆分', detail: note || `拆分为 ${created.map((c) => c.name).join('、')}`,
    sourceId: children[0]?.sourceId || null, recordedAt: nowTs(), withdrawn: false });
  audit(d, actor, 'entity.split', 'relation', rel.id, { parentId, children: rel.toEntityIds, date });
  persist();
  return { parentId: parent.id, created, relation: rel };
}

// ---- 属性陈述（多来源证据） ----
export function addClaim(d, { entityId, attr, value, sourceId, validFrom, validTo }, actor) {
  must(d, 'entities', entityId);
  const c = { id: newId('C'), entityId, attr,
    value: attr === 'yearBuilt' ? Number(value) : value,
    sourceId, validFrom: validFrom || null, validTo: validTo || null,
    recordedAt: nowTs(), withdrawn: false };
  d.claims.push(c);
  audit(d, actor, 'claim.add', 'claim', c.id, { entityId, attr, value, sourceId });
  persist();
  return c;
}
export function withdrawClaim(d, id, reason, actor) {
  const c = must(d, 'claims', id);
  c.withdrawn = true; c.withdrawnAt = nowTs(); c.withdrawnReason = reason || '';
  audit(d, actor, 'claim.withdraw', 'claim', id, { reason });
  persist();
  return c;
}

// ---- 修缮事件 ----
export function addEvent(d, { entityId, kind, date, title, detail, sourceId }, actor) {
  must(d, 'entities', entityId);
  const v = { id: newId('V'), entityId, kind, date, title, detail: detail || '',
    sourceId: sourceId || null, recordedAt: nowTs(), withdrawn: false };
  d.events.push(v);
  audit(d, actor, 'event.add', 'event', v.id, { entityId, date, title });
  persist();
  return v;
}

// ---- 空间库：边界 + 来源；纠偏 = 新边界 supersede 旧边界（旧记录保留并撤回） ----
export function addFootprint(d, { entityId, ring, point, sourceId, kind, note, supersedes, correctedFrom }, actor) {
  must(d, 'entities', entityId);
  const f = { id: newId('FP'), entityId, ring, point, sourceId, kind: kind || 'reported',
    note: note || '', supersedes: supersedes || null, correctedFrom: correctedFrom || null,
    recordedAt: nowTs(), withdrawn: false, withdrawnAt: null };
  d.footprints.push(f);
  if (supersedes) {
    const old = d.footprints.find((x) => x.id === supersedes);
    if (old) { old.withdrawn = true; old.withdrawnAt = nowTs(); }
  }
  audit(d, actor, 'footprint.add', 'footprint', f.id, { entityId, sourceId, kind, supersedes });
  persist();
  return f;
}

// ---- 照片：保留拍摄朝向、估计位置、不确定度 ----
export function addPhoto(d, p, actor) {
  must(d, 'entities', p.entityId);
  const photo = {
    id: p.id || newId('P'), entityId: p.entityId, takenAt: p.takenAt || null,
    bearingDegrees: p.bearingDegrees ?? null,
    estimatedLocation: p.estimatedLocation || null,
    locationUncertaintyM: p.locationUncertaintyM ?? null,
    file: p.file || null, fileMissing: !!p.fileMissing,
    caption: p.caption || '', era: p.era || 'modern',
    sourceId: p.sourceId || null, recordedAt: nowTs(), withdrawn: false
  };
  d.photos.push(photo);
  audit(d, actor, 'photo.add', 'photo', photo.id, { entityId: photo.entityId, bearing: photo.bearingDegrees });
  persist();
  return photo;
}
// 历史照片：只能登记“候选对应”，默认 pending，不自动认定同一立面
export function addPhotoCandidate(d, { photoId, entityId, facade, confidence, note }, actor) {
  must(d, 'photos', photoId); must(d, 'entities', entityId);
  const m = { id: newId('M'), photoId, entityId, facade, status: 'pending',
    confidence: Number(confidence) || 0, note: note || '', decidedBy: null, recordedAt: nowTs() };
  d.photoMatches.push(m);
  audit(d, actor, 'match.candidate', 'photoMatch', m.id, { photoId, entityId, facade, confidence: m.confidence });
  persist();
  return m;
}
export function decideCandidate(d, id, status, decidedBy, note, actor) {
  if (!['confirmed', 'rejected'].includes(status)) throw Object.assign(new Error('status 仅可为 confirmed/rejected'), { status: 400 });
  const m = must(d, 'photoMatches', id);
  const before = m.status;
  m.status = status; m.decidedBy = decidedBy || actor;
  if (note) m.decisionNote = note;
  audit(d, actor, 'match.decide', 'photoMatch', id, { before, status, decidedBy: m.decidedBy });
  persist();
  return m;
}

// ---- 入口与开放时段 ----
export function addEntrance(d, { entityId, label, point }, actor) {
  const e = { id: newId('EN'), entityId: entityId || null, label, point: point || null };
  d.entrances.push(e);
  audit(d, actor, 'entrance.add', 'entrance', e.id, { entityId, label });
  persist();
  return e;
}
export function addEntrancePeriod(d, { entranceId, state, validFrom, validTo, weekdayHours, note, sourceId }, actor) {
  must(d, 'entrances', entranceId);
  const p = { id: newId('EP'), entranceId, state, validFrom: validFrom || null, validTo: validTo || null,
    weekdayHours: weekdayHours || null, note: note || '', sourceId: sourceId || null };
  d.entrancePeriods.push(p);
  audit(d, actor, 'entrance.period', 'entrancePeriod', p.id, { entranceId, state, validFrom, validTo });
  persist();
  return p;
}

export function listAudits(d, { targetId, limit = 100 } = {}) {
  const rows = d.audits.filter((a) => !targetId || a.targetId === targetId || a.detail?.entityId === targetId);
  return rows.slice(-limit).reverse();
}
