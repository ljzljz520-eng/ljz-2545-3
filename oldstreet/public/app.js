'use strict';
// 槐安老街观察站前端：列表/地图共享同一筛选与双时间快照；键盘可操作。
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  vocab: null,
  filters: { era: '', style: '', status: '', q: '', limit: 5 },
  asOf: null, time: '12:00', snapshotAt: '',
  rows: [], total: 0, nextCursor: null, cursorStack: [], focusIdx: 0, selectedId: null,
  chunks: [], entities: [], site: null,
  map: { scale: 90000, cx: 118.0865, cy: 24.562, drag: null, hoverId: null }
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const accLabel = { open: '开放', closed: '关闭', restricted: '限制开放·需预约', 'restricted-closed': '限制区·当前不开放', 'outside-hours': '非开放时段', unknown: '无记录' };

// ---------- 工具 ----------
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function snapshotInputValue(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function snapshotFromInput(v) { return v ? new Date(v).toISOString() : ''; }

function queryBase(extra = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state.filters)) if (v) p.set(k, v);
  p.set('asOf', state.asOf); p.set('time', state.time);
  if (state.snapshotAt) p.set('snapshotAt', state.snapshotAt);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  return p.toString();
}

// ---------- 初始化 ----------
async function init() {
  state.asOf = todayStr();
  $('#asOf').value = state.asOf;
  $('#asTime').value = state.time;
  state.vocab = await api('/api/vocab');
  fillSelect('#fEra', state.vocab.eras);
  fillSelect('#fStyle', state.vocab.styles);
  fillSelect('#fStatus', state.vocab.statuses);
  bindUI();
  await refreshAll();
}
function fillSelect(sel, items) {
  const el = $(sel);
  for (const it of items) {
    const o = document.createElement('option');
    o.value = it.id; o.textContent = it.label;
    el.appendChild(o);
  }
}
function bindUI() {
  for (const id of ['fEra', 'fStyle', 'fStatus', 'fQ']) {
    $('#' + id).addEventListener('input', () => {
      state.filters.era = $('#fEra').value;
      state.filters.style = $('#fStyle').value;
      state.filters.status = $('#fStatus').value;
      state.filters.q = $('#fQ').value;
      state.cursorStack = [];
      refreshAll();
    });
  }
  $('#fLimit').addEventListener('change', (e) => {
    state.filters.limit = Number(e.target.value);
    state.cursorStack = [];
    refreshAll();
  });
  $('#asOf').addEventListener('change', (e) => { state.asOf = e.target.value; refreshAll(); });
  $('#asTime').addEventListener('change', (e) => { state.time = e.target.value; refreshAll(); });
  $('#snapshotAt').addEventListener('change', (e) => {
    state.snapshotAt = snapshotFromInput(e.target.value);
    state.cursorStack = []; refreshAll();
  });
  $('#nowBtn').addEventListener('click', () => {
    state.asOf = todayStr(); state.time = '12:00'; state.snapshotAt = '';
    $('#asOf').value = state.asOf; $('#asTime').value = state.time; $('#snapshotAt').value = '';
    state.cursorStack = []; refreshAll();
  });
  $('#prevPage').addEventListener('click', prevPage);
  $('#buildingList').addEventListener('keydown', onListKey);
  $('#map').addEventListener('keydown', onMapKey);
  bindMapMouse();
  $('#compareBtn').addEventListener('click', openCompare);
  $('#compareClose').addEventListener('click', () => $('#compareDialog').close());
  $('#adminBtn').addEventListener('click', openAdmin);
  $('#adminClose').addEventListener('click', () => $('#adminDialog').close());
}

// ---------- 数据刷新 ----------
async function refreshAll() {
  const [site, list, chunks] = await Promise.all([
    api('/api/site?' + queryBase()),
    api('/api/buildings?' + queryBase({ cursor: state.cursorStack[state.cursorStack.length - 1] || null, limit: state.filters.limit })),
    api('/api/map/chunks?' + queryBase())
  ]);
  state.site = site;
  state.rows = list.page; state.total = list.total; state.nextCursor = list.nextCursor;
  state.chunks = chunks.chunks;
  state.entities = chunks.chunks.flatMap((c) => c.entities);
  renderSite(); renderList(); renderMap(); renderLegend();
  if (state.selectedId && !state.rows.some((r) => r.id === state.selectedId)) { /* 保留详情，分页时不强制清除 */ }
}
function renderSite() {
  const a = state.site.access;
  $('#siteBar').innerHTML =
    `<strong>${esc(state.site.siteName)}</strong>
     <span class="pill">快照 ${esc(a.day)} ${esc(a.time)}</span>
     <span style="color:${a.siteOpen ? 'var(--jade)' : '#a33'};font-weight:700">${esc(a.summary)}</span>
     ${a.gates.map((g) => `<span class="gate ${g.state}">${esc(g.label)}：${esc(accLabel[g.state] || g.state)}${g.note ? '（' + esc(g.note) + '）' : ''}</span>`).join('')}`;
}

// ---------- 列表 ----------
function renderList() {
  const ul = $('#buildingList');
  ul.innerHTML = '';
  if (!state.rows.length) {
    ul.innerHTML = '<li class="empty">当前筛选 / 快照下没有建筑。<br>可尝试调大每页数量或调整事务快照时间。</li>';
  }
  state.rows.forEach((v, i) => {
    const li = document.createElement('li');
    li.className = 'row' + (i === state.focusIdx ? ' focus' : '') + (v.id === state.selectedId ? ' active' : '');
    li.dataset.id = v.id; li.dataset.idx = i;
    const conflict = hasConflict(v);
    const acc = v.access?.state;
    li.innerHTML = `
      <div class="num">${esc(v.numberAt || '（当日无门牌）')}</div>
      <div class="nm">${esc(v.name)} ${conflict ? '<span class="conflict">⚠ 证据冲突</span>' : ''}</div>
      <div class="meta">
        ${v.eraLabel ? `<span class="tag era">${esc(v.eraLabel)}</span>` : '<span class="tag">年代待考</span>'}
        ${v.styleLabel ? `<span class="tag">${esc(v.styleLabel)}</span>` : ''}
        ${v.statusLabel ? `<span class="tag status-${esc(v.status || '')}">${esc(v.statusLabel)}</span>` : ''}
        <span class="acc ${acc || 'unknown'}">${esc(accLabel[acc] || '无记录')}${v.access?.entrances > 1 ? ` ×${v.access.entrances}` : ''}</span>
      </div>`;
    li.addEventListener('click', () => selectIndex(i, true));
    ul.appendChild(li);
  });
  $('#listCount').textContent = `共 ${state.total} 座 · 本页 ${state.rows.length}`;
  const pageStart = state.cursorStack.length * state.filters.limit;
  $('#pageInfo').textContent = `${state.rows.length ? pageStart + 1 : 0}–${pageStart + state.rows.length} / ${state.total}`;
  $('#prevPage').disabled = state.cursorStack.length === 0;
}
function hasConflict(v) {
  // 列表轻量标记：重新拉详情代价高；这里由页面附加字段 evidenceConflicts（见 detail），
  // 列表中通过未采用陈述无法得知，统一在详情面板展示；此处预留。
  return v._conflict === true;
}
function nextPage() {
  if (!state.nextCursor) return;
  state.cursorStack.push(state.nextCursor);
  state.focusIdx = 0;
  refreshAll();
}
function prevPage() {
  if (!state.cursorStack.length) return;
  state.cursorStack.pop();
  state.focusIdx = 0;
  refreshAll();
}
function selectIndex(i, openDetail) {
  state.focusIdx = Math.max(0, Math.min(i, state.rows.length - 1));
  const row = state.rows[state.focusIdx];
  if (openDetail && row) { state.selectedId = row.id; openDetail(row.id); }
  syncFocus();
}
function syncFocus() {
  $$('#buildingList .row').forEach((li) => {
    li.classList.toggle('focus', Number(li.dataset.idx) === state.focusIdx);
    li.classList.toggle('active', li.dataset.id === state.selectedId);
  });
  const f = $('#buildingList .row.focus');
  if (f) f.scrollIntoView({ block: 'nearest' });
}
function onListKey(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); selectIndex(state.focusIdx + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); selectIndex(state.focusIdx - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); selectIndex(state.focusIdx, true); }
  else if (e.key === 'PageDown' || (e.key === 'ArrowRight' && state.nextCursor)) { e.preventDefault(); nextPage(); }
  else if (e.key === 'PageUp' || e.key === 'ArrowLeft') { e.preventDefault(); prevPage(); }
  else if (/^[0-9]$/.test(e.key)) {
    const n = Number(e.key);
    if (n >= 1 && n <= state.rows.length) selectIndex(n - 1, true);
  }
}

// ---------- 地图（原创 canvas 渲染，无外部底图依赖） ----------
function mapXY(lon, lat) {
  const m = state.map;
  const cv = $('#map');
  const x = cv.width / 2 + (lon - m.cx) * m.scale * Math.cos(m.cy * Math.PI / 180);
  const y = cv.height / 2 - (lat - m.cy) * m.scale;
  return [x, y];
}
function mapLonLat(x, y) {
  const m = state.map;
  const cv = $('#map');
  const lon = m.cx + (x - cv.width / 2) / (m.scale * Math.cos(m.cy * Math.PI / 180));
  const lat = m.cy - (y - cv.height / 2) / m.scale;
  return [lon, lat];
}
function drawPolygon(ctx, ring, fill, stroke, width = 1.5) {
  ctx.beginPath();
  ring.forEach(([lon, lat], i) => {
    const [x, y] = mapXY(lon, lat);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke();
}
async function renderMap() {
  const cv = $('#map'); const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  // 底纸纹理：经纬网格
  ctx.strokeStyle = '#ddd2bb'; ctx.lineWidth = 1;
  for (let lon = 118.082; lon <= 118.092; lon += 0.002) {
    const [x1, y1] = mapXY(lon, 24.559); const [x2, y2] = mapXY(lon, 24.565);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  for (let lat = 24.560; lat <= 24.564; lat += 0.001) {
    const [x1, y1] = mapXY(118.081, lat); const [x2, y2] = mapXY(118.092, lat);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  // 地理分块（200m 级）淡色底框
  ctx.strokeStyle = 'rgba(60,95,140,.18)'; ctx.setLineDash([5, 4]);
  for (const c of state.chunks) {
    const [w, s, e, n] = c.bbox;
    const [x1, y1] = mapXY(w, n); const [x2, y2] = mapXY(e, s);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.fillStyle = 'rgba(60,95,140,.55)'; ctx.font = '10px serif';
    ctx.fillText(`${c.chunk} · ${c.count} 座`, x1 + 4, y2 - 5);
  }
  ctx.setLineDash([]);

  // 先取全部实体的边界：拉详情成本高；用 chunks 里的 point 画点 + 调用轻量边界接口
  // 简化：通过并行详情接口获取 ring（仅本快照筛选结果）
  const ids = state.entities.map((e) => e.id);
  const details = await Promise.all(ids.map((id) => cachedDetail(id)));
  const byId = new Map(details.filter(Boolean).map((d) => [d.id, d]));

  // 街门
  for (const g of (state.site?.access?.gates || [])) {
    const [x, y] = mapXY(g.point[0], g.point[1]);
    ctx.fillStyle = g.state === 'open' ? '#3f7a63' : g.state === 'closed' ? '#a33' : '#b58a3c';
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 9px serif'; ctx.textAlign = 'center';
    ctx.fillText('门', x, y + 3);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#4a4238'; ctx.font = '10px serif';
    ctx.fillText(g.label, x + 9, y - 7);
  }

  for (const ent of state.entities) {
    const d = byId.get(ent.id);
    const active = ent.id === state.selectedId;
    const hover = ent.id === state.map.hoverId;
    const fp = d?.spatial?.find((f) => f.id === d.footprintId);
    if (fp) {
      const color = active ? '#9c4a2f' : 'rgba(156,74,47,.5)';
      drawPolygon(ctx, fp.ring, active ? 'rgba(156,74,47,.25)' : 'rgba(156,74,47,.08)', color, active ? 2.4 : 1.2);
      // 被纠偏的旧点
      for (const old of (d?.spatial || []).filter((f) => f.withdrawn)) {
        const [ox, oy] = mapXY(old.point[0], old.point[1]);
        ctx.strokeStyle = '#a33'; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(ox, oy, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ox - 4, oy - 4); ctx.lineTo(ox + 4, oy + 4); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    const [x, y] = mapXY(ent.point[0], ent.point[1]);
    ctx.fillStyle = statusColor(ent.status);
    ctx.beginPath(); ctx.arc(x, y, active || hover ? 7 : 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = active ? '#2b2620' : '#fff'; ctx.lineWidth = active ? 2 : 1.4; ctx.stroke();
    // 照片拍摄位置（带朝向）
    for (const p of (d?.photos || [])) {
      if (!p.estimatedLocation) continue;
      const [px, py] = mapXY(p.estimatedLocation[0], p.estimatedLocation[1]);
      ctx.fillStyle = p.era === 'historical' ? '#3c5f8c' : '#6b8e23';
      ctx.save(); ctx.translate(px, py);
      ctx.rotate((p.bearingDegrees || 0) * Math.PI / 180);
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath();
      ctx.globalAlpha = .85; ctx.fill(); ctx.restore(); ctx.globalAlpha = 1;
      const u = p.locationUncertaintyM || 0;
      if (u >= 10) { ctx.strokeStyle = 'rgba(60,95,140,.4)'; ctx.beginPath(); ctx.arc(px, py, 3 + u / 6, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.fillStyle = '#2b2620'; ctx.font = (active ? 'bold ' : '') + '11px serif';
    ctx.fillText(`${ent.numberAt || ''} ${ent.name}`.trim(), x + 8, y - 7);
  }
  $('#mapHint').textContent = `拖拽平移 · 滚轮缩放 · 方向键移动焦点 · Enter 选中 · ${state.chunks.length} 个地理分块`;
}
function statusColor(s) {
  return { restored: '#5f9e7a', ruin: '#b04a3a', adapted: '#6b79b0', fair: '#c9a84e', weathered: '#c87f53', original: '#7aa26a' }[s] || '#8a8074';
}
const detailCache = new Map();
async function cachedDetail(id) {
  if (detailCache.has(id + state.asOf + (state.snapshotAt || ''))) return detailCache.get(id + state.asOf + (state.snapshotAt || ''));
  try {
    const d = await api(`/api/buildings/${encodeURIComponent(id)}?` + queryBase());
    detailCache.set(id + state.asOf + (state.snapshotAt || ''), d);
    return d;
  } catch { return null; }
}
function renderLegend() {
  const items = [
    ['#5f9e7a', '已修缮'], ['#c9a84e', '基本完好'], ['#c87f53', '风化残损'],
    ['#b04a3a', '遗址/濒危'], ['#6b79b0', '改造使用'],
    ['#3c5f8c', '历史照片机位（三角指向拍摄朝向）'], ['#6b8e23', '现代照片机位'],
    ['#3f7a63', '开放街门'], ['#a33', '关闭街门/已纠偏旧点'], ['#b58a3c', '限制开放']
  ];
  $('#legend').innerHTML = items.map(([c, t]) => `<span><i class="swatch" style="background:${c}"></i>${t}</span>`).join('');
}
function bindMapMouse() {
  const cv = $('#map');
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const m = state.map;
    const rect = cv.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (cv.width / rect.width);
    const my = (e.clientY - rect.top) * (cv.height / rect.height);
    const [lon0, lat0] = mapLonLat(mx, my);
    m.scale *= e.deltaY < 0 ? 1.18 : 1 / 1.18;
    m.scale = Math.max(8000, Math.min(400000, m.scale));
    const [x0, y0] = mapXY(lon0, lat0);
    m.cx += (mx - x0) / (m.scale * Math.cos(m.cy * Math.PI / 180));
    m.cy -= (my - y0) / m.scale;
    renderMap();
  }, { passive: false });
  cv.addEventListener('mousedown', (e) => {
    state.map.drag = { x: e.clientX, y: e.clientY, cx: state.map.cx, cy: state.map.cy, moved: false };
  });
  window.addEventListener('mousemove', (e) => {
    const g = state.map.drag;
    if (!g) { mapHover(e); return; }
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
    const cv = $('#map');
    state.map.cx = g.cx - dx / (state.map.scale * Math.cos(state.map.cy * Math.PI / 180)) * (cv.width / cv.clientWidth);
    state.map.cy = g.cy + dy / state.map.scale * (cv.height / cv.clientHeight);
    renderMap();
  });
  window.addEventListener('mouseup', () => { state.map.drag = null; });
  cv.addEventListener('click', (e) => {
    if (state.map.drag?.moved) return;
    const hit = pickEntity(e);
    if (hit) { state.selectedId = hit; syncFocus(); openDetail(hit); renderMap(); }
  });
  function mapHover(e) {
    const hit = pickEntity(e);
    if (hit !== state.map.hoverId) { state.map.hoverId = hit; $('#map').style.cursor = hit ? 'pointer' : 'grab'; renderMap(); }
  }
  function pickEntity(e) {
    const cv = $('#map'); const rect = cv.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (cv.width / rect.width);
    const my = (e.clientY - rect.top) * (cv.height / rect.height);
    let best = null, bd = 1e9;
    for (const ent of state.entities) {
      const [x, y] = mapXY(ent.point[0], ent.point[1]);
      const dd = (x - mx) ** 2 + (y - my) ** 2;
      if (dd < 144 && dd < bd) { bd = dd; best = ent.id; }
    }
    return best;
  }
}
function onMapKey(e) {
  const m = state.map; const step = 0.00035;
  if (e.key === 'ArrowUp') { m.cy += 0.00012; renderMap(); }
  else if (e.key === 'ArrowDown') { m.cy -= 0.00012; renderMap(); }
  else if (e.key === 'ArrowLeft') { m.cx -= 0.00015; renderMap(); }
  else if (e.key === 'ArrowRight') { m.cx += 0.00015; renderMap(); }
  else if (e.key === '+' || e.key === '=') { m.scale = Math.min(400000, m.scale * 1.25); renderMap(); }
  else if (e.key === '-') { m.scale = Math.max(8000, m.scale / 1.25); renderMap(); }
  else if (e.key === 'Enter' && state.map.hoverId) {
    state.selectedId = state.map.hoverId;
    const idx = state.rows.findIndex((r) => r.id === state.map.hoverId);
    if (idx >= 0) state.focusIdx = idx;
    syncFocus(); openDetail(state.map.hoverId);
  }
}

// ---------- 详情：证据差异 / 沿革 / 事件 / 谱系 / 照片 / 入口 ----------
async function openDetail(id) {
  state.selectedId = id; syncFocus();
  const d = await cachedDetail(id);
  $('#detailEmpty').hidden = true;
  $('#detailBody').hidden = false;
  const b = $('#detailBody');
  b.innerHTML = '<div class="empty">加载中…</div>';
  const fresh = await api(`/api/buildings/${encodeURIComponent(id)}?` + queryBase()).then((x) => {
    detailCache.set(id + state.asOf + (state.snapshotAt || ''), x); return x;
  });
  b.innerHTML = detailHTML(fresh);
  $$('.lin a', b).forEach((a) => a.addEventListener('click', () => openDetail(a.dataset.id)));
  renderMap();
}
function evidenceBlock(d) {
  const ev = d.evidence || {};
  const attrName = { yearBuilt: '建造年代', style: '建筑风格', status: '保存状态' };
  const blocks = Object.entries(ev).map(([attr, info]) => {
    const fmtVal = (attr, v) =>
      attr === 'style' ? (state.vocab.styles.find((s) => s.id === v)?.label || v)
      : attr === 'status' ? (state.vocab.statuses.find((s) => s.id === v)?.label || v)
      : attr === 'yearBuilt' ? `${v} 年` : v;
    return `<div class="evrow ${info.conflicting ? '' : ''}" style="${info.conflicting ? 'border-color:#c25e2b' : ''}">
      <strong>${attrName[attr] || attr}</strong>：${esc(fmtVal(attr, info.selected.value))}
      <span class="badge adopt">采纳</span>
      ${info.conflicting ? `<div class="conflict-note">⚠ 多来源不一致：${info.candidates.map((c) => esc(fmtVal(attr, c.value))).join(' / ')}（按来源权威性与登记时间取舍，原始陈述全部保留）</div>` : ''}
      ${info.candidates.map((c) => `
        <div class="evrow ${c.adopted ? 'adopted' : ''}" style="margin:3px 0">
          <span class="badge ${c.adopted ? 'adopt' : 'alt'}">${c.adopted ? '采纳' : '备选'}</span>
          ${esc(fmtVal(attr, c.value))}
          <span class="src">— ${esc(c.sourceTitle)}（权威性 ${c.authority ?? '?'}，${esc((c.recordedAt || '').slice(0, 10))}）</span>
        </div>`).join('')}
    </div>`;
  }).join('');
  return `<div class="section"><h4>证据差异（多来源陈述，冲突并存）</h4>${blocks || '<p class="hint">暂无陈述。</p>'}</div>`;
}
function numberHistoryHTML(d) {
  return `<div class="section"><h4>门牌沿革（编号是时段别名，建筑实体不变）</h4>
    <table class="tl"><thead><tr><th>门牌</th><th>生效起</th><th>生效止</th><th>来源</th><th>备注</th></tr></thead><tbody>
    ${d.numberHistory.map((a) => {
      const current = !a.validTo && !a.withdrawn;
      return `<tr class="${a.withdrawn ? 'del' : ''}">
        <td><strong>${esc(a.number)}</strong>${current ? ' <span class="tag era">当日有效</span>' : ''}</td>
        <td>${esc(a.validFrom || '—')}</td><td>${esc(a.validTo || '至今')}</td>
        <td>${esc(a.sourceId || '')}</td><td>${esc(a.note || '')}${a.withdrawn ? '（已撤回转录）' : ''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}
function eventsHTML(d) {
  return `<div class="section"><h4>修缮 / 改建事件</h4>
    ${d.events.length ? `<table class="tl">${d.events.map((v) =>
      `<tr><td style="width:78px">${esc(v.date)}</td><td><strong>${esc(v.title)}</strong><br><span class="hint">${esc(v.kind)} · 来源 ${esc(v.sourceId || '')}</span><div>${esc(v.detail)}</div></td></tr>`).join('')}</table>`
      : '<p class="hint">无记录。</p>'}</div>`;
}
function lineageHTML(d) {
  const L = d.lineage || { parents: [], children: [] };
  const parts = [];
  for (const p of L.parents) parts.push(
    `<div class="lin">本实体为 <a data-id="${esc(p.parent)}">${esc(p.parent)}</a> 于 ${esc(p.date)} 拆分后的一支；不沿用原合院的单一身份。同批分出：${p.siblings.map((s) => `<a data-id="${esc(s)}">${esc(s)}</a>`).join('、')}<br><span class="hint">${esc(p.note)}</span></div>`);
  for (const c of L.children) parts.push(
    `<div class="lin">本实体已于 ${esc(c.date)} ${esc(c.relation === 'split' ? '拆分' : c.relation)}：${c.children.map((s) => `<a data-id="${esc(s)}">${esc(s)}</a>`).join('、')}<br><span class="hint">${esc(c.note)}</span></div>`);
  return parts.length ? `<div class="section"><h4>实体谱系（拆分 / 合并）</h4>${parts.join('')}</div>` : '';
}
function spatialHTML(d) {
  return `<div class="section"><h4>空间边界与坐标纠偏（保留来源与旧点）</h4>
    <table class="tl"><thead><tr><th>类型</th><th>坐标点</th><th>来源</th><th>状态</th><th>说明</th></tr></thead><tbody>
    ${d.spatial.map((f) => `<tr class="${f.withdrawn ? 'del' : ''}">
      <td>${esc(f.kind)}${f.supersedes ? ` <span class="tag">替代 ${esc(f.supersedes)}</span>` : ''}</td>
      <td>${f.point.map((n) => n.toFixed(5)).join(', ')}</td>
      <td>${esc(f.sourceId)}</td><td>${f.withdrawn ? '已被纠偏替代（保留）' : '现行'}</td>
      <td>${esc(f.note || '')}</td></tr>`).join('')}
    </tbody></table></div>`;
}
function photosHTML(d) {
  if (!d.photos.length) return '<div class="section"><h4>照片</h4><p class="hint">无照片。</p></div>';
  return `<div class="section"><h4>照片（机位、拍摄朝向、不确定度；历史照片仅保存候选对应）</h4>` +
    d.photos.map((p) => `<div class="photo">
      <div class="imgwrap">
        ${p.fileMissing
          ? `<div class="miss">⚠ 照片文件缺失：${esc(p.file)}（元数据仍保留）</div>`
          : `<img src="${esc(p.file)}?v=${Date.now()}" alt="${esc(p.caption)}" onerror="this.outerHTML='<div class=\\'miss\\'>⚠ 文件读取失败：${esc(p.file)}</div>'">`}
        <span class="bearing">${p.era === 'historical' ? '历史照片' : '现代照片'} · 朝向 ${p.bearingDegrees ?? '?'}°</span>
      </div>
      <div class="cap"><strong>${esc(p.caption)}</strong><br>
        <span class="hint">${esc((p.takenAt || '').slice(0, 10))} · 机位 ±${p.locationUncertaintyM ?? '?'}m · 来源 ${esc(p.sourceId)}</span></div>
      <div class="matches">
        ${p.matches.length ? p.matches.map((m) => `
          <div class="match ${m.status}">
            <span class="conf">置信度 ${(m.confidence ?? 0).toFixed(2)}</span>
            候选立面：${esc(m.facade)}
            <span class="tag">${m.status === 'pending' ? '待人工确认' : m.status === 'confirmed' ? '已确认' : '已否定'}</span>
            <div class="hint">${esc(m.note || '')}${m.decidedBy ? `（${esc(m.decidedBy)}）` : ' <strong style="color:var(--warn)">系统不会自动认定同一立面</strong>'}</div>
          </div>`).join('') : '<div class="hint">尚未建立候选对应。</div>'}
      </div>
    </div>`).join('') + `</div>`;
}
function accessHTML(d) {
  const rows = d.access || [];
  return `<div class="section"><h4>入口与开放状态（按入口 × 时间，互不替代整街判断）</h4>
    ${rows.length ? rows.map((a) => `
      <div class="evrow"><strong>${esc(a.label)}</strong>
        <span class="acc ${a.state}">${esc(accLabel[a.state] || a.state)}</span>
        <div class="hint">${esc(a.note || '')}</div></div>`).join('')
      : '<p class="hint">该建筑无独立入口记录。</p>'}
    <div class="lin">${esc(d.siteAccess?.summary || '')}</div></div>`;
}
function detailHTML(d) {
  return `<div class="dh">
      <h3>${esc(d.name)}</h3>
      <div class="num">${esc(d.numberAt || '当日无门牌')} · 实体 ID ${esc(d.id)}</div>
    </div>
    <dl class="kv">
      <dt>建造年代</dt><dd>${esc(d.eraLabel || '待考')}${d.yearBuilt ? `（${d.yearBuilt}）` : ''}</dd>
      <dt>建筑风格</dt><dd>${esc(d.styleLabel || '—')}</dd>
      <dt>保存状态</dt><dd>${esc(d.statusLabel || '—')}</dd>
      <dt>备注</dt><dd>${esc(d.note || '')}</dd>
    </dl>
    ${lineageHTML(d)}${numberHistoryHTML(d)}${evidenceBlock(d)}${spatialHTML(d)}${eventsHTML(d)}${photosHTML(d)}${accessHTML(d)}`;
}

// ---------- 双索引比较 ----------
async function openCompare() {
  const dlg = $('#compareDialog'); dlg.showModal();
  const d = await api('/api/compare/indexes?' + queryBase());
  $('#compareMeta').textContent =
    `快照 ${d.asOf}｜A：${d.strategyA}｜B：${d.strategyB}`;
  $('#compareBody').innerHTML = `
    <p class="${d.consistent ? 'good' : 'bad'}" style="padding:8px;border-radius:6px">
      结论：${d.consistent ? '两种索引在该快照下结果一致。' : `发现 ${d.mismatchCount} 处不一致：在历史日期，B（仅现门牌）会漏掉已更名的建筑；A（稳定实体 + 时段别名）保持与地理分块查询同一实体集合的一致快照。`}
    </p>
    <table class="cmp"><thead><tr><th>实体</th><th>A 时段别名门牌</th><th>B 仅现门牌</th><th>A 历史检索命中</th><th>B 历史检索命中</th><th>一致</th></tr></thead>
    <tbody>${d.rows.map((r) => `<tr class="${r.consistent ? '' : 'bad'}">
      <td>${esc(r.entityId)}</td><td>${esc(r.temporalAliasNumber || '—')}</td>
      <td>${esc(r.currentNumberOnly || '—（会退化为名称模糊检索）')}</td>
      <td>${r.historicalSearchHitByA ? '✓' : '✗'}</td>
      <td>${r.historicalSearchHitByB ? '✓' : '<strong style=color:#a33>✗ 漏检</strong>'}</td>
      <td>${r.consistent ? '✓' : '✗'}</td></tr>`).join('')}</tbody></table>`;
}

// ---------- 后台维护 ----------
const ADMIN_TABS = [
  ['renumber', '门牌变更（不新建建筑）'],
  ['split', '合院拆分（新身份+谱系）'],
  ['claim', '新增/撤回来源陈述'],
  ['event', '修缮事件'],
  ['footprint', '空间边界/坐标纠偏'],
  ['photo', '照片与候选对应'],
  ['access', '入口与开放时段'],
  ['entity', '建筑实体增改/撤回'],
  ['audits', '变更审计日志']
];
async function openAdmin() {
  $('#adminDialog').showModal();
  $('#adminNav').innerHTML = ADMIN_TABS.map(([id, t], i) =>
    `<button data-tab="${id}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('');
  $$('#adminNav button').forEach((b) => b.addEventListener('click', () => {
    $$('#adminNav button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on'); renderAdminTab(b.dataset.tab);
  }));
  renderAdminTab('renumber');
}
async function adminPost(path, body) {
  const token = $('#adminToken')?.value || localStorage.getItem('os_token') || 'dev-token';
  localStorage.setItem('os_token', token);
  const r = await fetch(path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': token, 'x-actor': 'curator' },
    body: JSON.stringify(body)
  });
  return r.json();
}
function tokenField() {
  return `<label><span>管理令牌（X-Admin-Token）</span><input id="adminToken" value="${esc(localStorage.getItem('os_token') || 'dev-token')}"></label>`;
}
function renderResult(el, j) { el.innerHTML = j.ok ? '✅ 成功：\n' + JSON.stringify(j.result, null, 2) : '❌ ' + esc(j.error || JSON.stringify(j)); }
function renderAdminTab(tab) {
  const b = $('#adminBody');
  const T = FORMS[tab] ? FORMS[tab]() : '';
  b.innerHTML = `<div class="form">${tokenField()}${T}</div>`;
  $$('#adminBody [data-run]').forEach((btn) => btn.addEventListener('click', async () => {
    const out = $('#adminResult'); out.textContent = '执行中…';
    const payload = btn.dataset.json ? JSON.parse(btn.dataset.json) : collectForm(btn.formEl || b);
    const j = await adminPost(btn.dataset.run, payload);
    renderResult(out, j);
    if (j.ok) { detailCache.clear(); await refreshAll(); }
  }));
  if (tab === 'audits') loadAudits();
}
function collectForm(scope) {
  const o = {};
  $$('input[name],select[name],textarea[name]', scope).forEach((el) => {
    if (el.dataset.json !== undefined) o[el.name] = el.value.trim() ? JSON.parse(el.value) : null;
    else if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.value !== '') o[el.name] = el.dataset.num ? Number(el.value) : el.value;
  });
  return o;
}
async function loadAudits() {
  const token = localStorage.getItem('os_token') || 'dev-token';
  const r = await fetch('/api/audits', { headers: { 'x-admin-token': token } });
  const j = await r.json();
  $('#adminBody').innerHTML = `<div class="form">${tokenField()}
    <h4 style="margin:8px 0 4px">最近变更（审计日志）</h4>
    <table class="tl cmp"><thead><tr><th>时间</th><th>操作</th><th>对象</th><th>细节</th></tr></thead><tbody>
    ${(j.audits || []).map((a) => `<tr><td>${esc(a.ts.replace('T', ' ').slice(0, 19))}</td>
      <td>${esc(a.actor)}<br><strong>${esc(a.action)}</strong></td>
      <td>${esc(a.targetType)} ${esc(a.targetId)}</td>
      <td><code>${esc(JSON.stringify(a.detail))}</code></td></tr>`).join('')}
    </tbody></table>
    ${r.status !== 200 ? `<div class="conflict-note">${esc(j.error || '')}</div>` : ''}</div>`;
}
const FORMS = {
  renumber: () => `
    <h4>门牌变更：关闭旧别名 → 新别名仍指向同一实体（不新建建筑）</h4>
    <label><span>建筑实体 ID</span><input name="entityId" value="E-001"></label>
    <label><span>旧别名 ID（封口，可空）</span><input name="oldAliasId" placeholder="A-103"></label>
    <label><span>旧门牌失效日</span><input type="date" name="oldValidTo"></label>
    <label><span>新门牌号</span><input name="newNumber" placeholder="槐安街12-1号"></label>
    <label><span>新生效日</span><input type="date" name="validFrom"></label>
    <label><span>来源 ID</span><input name="sourceId" value="S4"></label>
    <label><span>备注</span><input name="note"></label>
    <button class="run" data-run="/api/admin/renumber">执行变更</button>
    <div id="adminResult" class="result"></div>`,
  split: () => `
    <h4>合院拆分：父实体保留为历史身份，子女为新稳定实体并建立 split 谱系</h4>
    <label><span>父实体 ID</span><input name="parentId" value="E-002"></label>
    <label><span>拆分日期</span><input type="date" name="date"></label>
    <label><span>子女（JSON: name/number/note/sourceId）</span>
      <textarea name="children" data-json='[{"name":"测试·新护厝","number":"槐安街7-2号","sourceId":"S9"}]' rows="4"></textarea></label>
    <label><span>说明</span><input name="note" value="测试拆分：子女不得沿用整院单一身份"></label>
    <button class="run" data-run="/api/admin/split">执行拆分</button><div id="adminResult" class="result"></div>`,
  claim: () => `
    <h4>多来源陈述（矛盾陈述并存，按权威性取舍，可撤回）</h4>
    <label><span>实体 ID</span><input name="entityId" value="E-005"></label>
    <label><span>属性</span><select name="attr"><option value="yearBuilt">yearBuilt</option><option value="style">style</option><option value="status">status</option></select></label>
    <label><span>值（yearBuilt 为整数）</span><input name="value" placeholder="1933"></label>
    <label><span>来源 ID</span><input name="sourceId" value="S4"></label>
    <button class="run" data-run="/api/admin/claims">新增陈述</button><div id="adminResult" class="result"></div>`,
  event: () => `
    <h4>修缮 / 改建事件</h4>
    <label><span>实体 ID</span><input name="entityId" value="E-001"></label>
    <label><span>类型</span><select name="kind"><option>repair</option><option>adaptation</option><option>disaster</option><option>survey</option></select></label>
    <label><span>日期</span><input type="date" name="date"></label>
    <label><span>标题</span><input name="title" placeholder="屋面修缮"></label>
    <label><span>详情</span><textarea name="detail" rows="3"></textarea></label>
    <label><span>来源</span><input name="sourceId" value="S9"></label>
    <button class="run" data-run="/api/admin/events">登记事件</button><div id="adminResult" class="result"></div>`,
  footprint: () => `
    <h4>空间边界：新边界可 supersede 旧边界（纠偏时旧点保留并标记撤回）</h4>
    <label><span>实体 ID</span><input name="entityId" value="E-005"></label>
    <label><span>类型</span><select name="kind"><option value="surveyed-corrected">surveyed-corrected（纠偏）</option><option>surveyed</option><option>reported</option></select></label>
    <label><span>中心点 [lon,lat]</span><input name="point" data-json placeholder="[118.0866,24.5621]"></label>
    <label><span>边界环 ring（GeoJSON 数组，可空=自动按点生成方框需接口支持，这里请填写）</span>
      <textarea name="ring" rows="3" data-json placeholder="[[lon,lat],...]"></textarea></label>
    <label><span>替代的旧边界 ID（可选）</span><input name="supersedes" placeholder="FP-5-OLD"></label>
    <label><span>来源</span><input name="sourceId" value="S4"></label>
    <label><span>说明</span><input name="note" placeholder="依据实测纠偏"></label>
    <button class="run" data-run="/api/admin/footprints">保存边界</button><div id="adminResult" class="result"></div>`,
  photo: () => `
    <h4>照片元数据（朝向/机位/不确定度）+ 历史照片候选对应（默认 pending）</h4>
    <label><span>实体 ID</span><input id="p_entityId" value="E-001"></label>
    <label><span>拍摄日期</span><input type="date" id="p_takenAt"></label>
    <label><span>拍摄朝向（度，0=北，顺时针）</span><input type="number" id="p_bearing" value="180"></label>
    <label><span>估计机位 [lon,lat]</span><input id="p_loc" placeholder="[118.0842,24.5627]"></label>
    <label><span>位置不确定度（米）</span><input type="number" id="p_unc" value="15"></label>
    <label><span>文件路径</span><input id="p_file" value="/images/p001.svg"></label>
    <label><span>说明</span><input id="p_caption" placeholder="老照片"></label>
    <label><span>来源</span><input id="p_source" value="S6"></label>
    <label><span>时代</span><select id="p_era"><option value="historical">historical</option><option>modern</option></select></label>
    <button class="run" id="photoAddBtn">保存照片</button>
    <hr style="width:100%;border:none;border-top:1px dashed var(--line)">
    <label><span>照片 ID</span><input id="m_photoId" value="P-001"></label>
    <label><span>候选实体 ID</span><input id="m_entityId" value="E-001"></label>
    <label><span>候选立面</span><input id="m_facade" placeholder="正立面（南向）"></label>
    <label><span>置信度 0–1</span><input type="number" step="0.01" id="m_conf" value="0.6"></label>
    <label><span>理由（为何只能候选）</span><textarea id="m_note" rows="2"></textarea></label>
    <button class="run" id="matchAddBtn">登记候选对应（不自动确认）</button>
    <div id="adminResult" class="result"></div>`,
  access: () => `
    <h4>入口开放时段（一处入口关闭不影响其他入口与整街判断）</h4>
    <label><span>入口 ID（EN-1…EN-8 / EN-S1 / EN-S2，也可先新增入口）</span><input name="entranceId" value="EN-1"></label>
    <label><span>状态</span><select name="state"><option value="open">open</option><option>closed</option><option>restricted</option></select></label>
    <label><span>生效起 / 止</span><div style="display:flex;gap:8px"><input type="date" name="validFrom"><input type="date" name="validTo"></div></label>
    <label><span>每日时段 JSON（周日..周六，null=闭）</span><input name="weekdayHours" data-json value='["09:00-18:00","09:00-18:00","09:00-18:00","09:00-18:00","09:00-18:00","09:00-18:00","09:00-18:00"]'></label>
    <label><span>说明</span><input name="note" placeholder="临时检修关闭"></label>
    <label><span>来源</span><input name="sourceId" value="S9"></label>
    <button class="run" data-run="/api/admin/entrance-periods">保存时段</button><div id="adminResult" class="result"></div>`,
  entity: () => `
    <h4>建筑实体：新增 / 改名备注 / 撤回（软删除）</h4>
    <label><span>名称</span><input name="name" placeholder="新建筑名称"></label>
    <label><span>备注</span><input name="note"></label>
    <button class="run" data-run="/api/admin/entities">新增实体</button>
    <hr style="width:100%;border:none;border-top:1px dashed var(--line)">
    <label><span>撤回实体 ID + 原因</span><div style="display:flex;gap:8px"><input id="w_id" placeholder="E-xxx" style="flex:1"><input id="w_reason" placeholder="重复录入" style="flex:2"></div></label>
    <button class="run" id="withdrawBtn">撤回（保留事务记录）</button>
    <div id="adminResult" class="result"></div>`
};

// photo / entity 表单的自定义提交
document.addEventListener('click', async (e) => {
  if (e.target.id === 'photoAddBtn') {
    const body = {
      entityId: $('#p_entityId').value, takenAt: $('#p_takenAt').value || null,
      bearingDegrees: Number($('#p_bearing').value),
      estimatedLocation: $('#p_loc').value ? JSON.parse($('#p_loc').value) : null,
      locationUncertaintyM: Number($('#p_unc').value),
      file: $('#p_file').value, caption: $('#p_caption').value,
      sourceId: $('#p_source').value, era: $('#p_era').value
    };
    const j = await adminPost('/api/admin/photos', body);
    renderResult($('#adminResult'), j);
    if (j.ok) { detailCache.clear(); refreshAll(); }
  }
  if (e.target.id === 'matchAddBtn') {
    const body = { photoId: $('#m_photoId').value, entityId: $('#m_entityId').value,
      facade: $('#m_facade').value, confidence: Number($('#m_conf').value), note: $('#m_note').value };
    const j = await adminPost('/api/admin/photo-candidates', body);
    renderResult($('#adminResult'), j);
    if (j.ok) { detailCache.clear(); refreshAll(); }
  }
  if (e.target.id === 'withdrawBtn') {
    const j = await adminPost(`/api/admin/entities/${encodeURIComponent($('#w_id').value)}/withdraw`, { reason: $('#w_reason').value });
    renderResult($('#adminResult'), j);
    if (j.ok) refreshAll();
  }
});

init().catch((e) => {
  document.body.insertAdjacentHTML('afterbegin', `<div style="padding:10px;background:#fbeee4;color:#7d3a17">初始化失败：${esc(e.message)}</div>`);
});
