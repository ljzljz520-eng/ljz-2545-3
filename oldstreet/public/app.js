// 青龙老街图志 —— 原生 JS，无框架、无地图 SDK（Canvas 自绘）。
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const NOW_STR = '2026-09-30T10:00';

const state = {
  asOf: NOW_STR, validAt: NOW_STR,
  filters: { era: '', style: '', preservation: '', q: '', includeHistory: false },
  page: 1, pageSize: 4, totalPages: 1, pageItems: [],
  selected: null, mapItems: [],
};

const eraLabel = { qing: '清代', min: '民国', prc: '建国后', modern: '当代' };
const eraColor = { qing: '#3f7d5e', min: '#2f6f8f', prc: '#b07b2f', modern: '#7a4b8f' };
const presLabel = { intact: '完好', good: '较好', fair: '一般', poor: '较差', ruin: '遗址' };
const styleLabel = { 'chuandou': '穿斗木构', 'brick-wood': '砖木混合', stone: '石构', colonial: '骑楼/殖民风', modern: '现代改建', reinforced: '砖混加固' };

async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error?.message || '请求失败');
  return j.data;
}
function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null && v !== false) p.set(k, v); });
  return p.toString();
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtMin(m) { if (m == null) return ''; const h = String(Math.floor(m / 60)).padStart(2, '0'), x = String(m % 60).padStart(2, '0'); return `${h}:${x}`; }
function period(a) { const f = (a.validFrom || '古早'), t = a.validTo || '今'; return `${String(f).slice(0, 10)} → ${t === '今' ? '今' : String(t).slice(0, 10)}`; }

// ---------------- tabs ----------------
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $$('.tabpanel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab));
  if (t.dataset.tab === 'admin') loadEvents();
}));

// ---------------- time / filters ----------------
$('#asOf').value = state.asOf; $('#validAt').value = state.validAt;
$('#asOf').addEventListener('change', (e) => { state.asOf = e.target.value; refresh(); });
$('#validAt').addEventListener('change', (e) => { state.validAt = e.target.value; refresh(); });
$('#btnNow').addEventListener('click', () => { state.asOf = NOW_STR; state.validAt = NOW_STR; $('#asOf').value = NOW_STR; $('#validAt').value = NOW_STR; refresh(); });
$('#includeHistory').addEventListener('change', (e) => { state.filters.includeHistory = e.target.checked; state.page = 1; refresh(); });
['#fEra', '#fStyle', '#fPres', '#fQ'].forEach((sel, i) => {
  $(sel).addEventListener('input', () => {
    state.filters = { ...state.filters, era: $('#fEra').value, style: $('#fStyle').value, preservation: $('#fPres').value, q: $('#fQ').value };
    state.page = 1; refresh();
  });
});
$('#btnReset').addEventListener('click', () => {
  ['#fEra', '#fStyle', '#fPres', '#fQ'].forEach((s) => ($(s).value = ''));
  state.filters = { era: '', style: '', preservation: '', q: '', includeHistory: state.filters.includeHistory };
  state.page = 1; refresh();
});
$('#prevPage').addEventListener('click', () => { if (state.page > 1) { state.page--; refresh(); } });
$('#nextPage').addEventListener('click', () => { if (state.page < state.totalPages) { state.page++; refresh(); } });

function commonParams() {
  return {
    asOf: state.asOf, validAt: state.validAt,
    era: state.filters.era, style: state.filters.style, preservation: state.filters.preservation,
    q: state.filters.q, includeHistory: state.filters.includeHistory || '',
  };
}

// ---------------- load list + map ----------------
async function refresh() {
  const listP = api('/api/buildings?' + qs({ ...commonParams(), page: state.page, pageSize: state.pageSize }));
  const mapP = api('/api/map?' + qs(commonParams()));
  const [list, map] = await Promise.all([listP, mapP]);
  $('#snapInfo').textContent = `快照 asOf ${String(list.asOf).slice(0, 16).replace('T', ' ')} · 业务时刻 ${String(list.validAt).slice(0, 16).replace('T', ' ')}`;
  state.pageItems = list.items; state.totalPages = list.totalPages; state.total = list.total;
  state.mapItems = map.items;
  renderList(); drawMap();
}

function renderList() {
  const ul = $('#buildingList'); ul.innerHTML = '';
  if (!state.pageItems.length) {
    ul.innerHTML = '<li class="bitem retired">该筛选 / 快照下无实体（可能已撤回或尚未到生效时间）。</li>';
  }
  for (const b of state.pageItems) {
    const li = document.createElement('li');
    li.className = 'bitem' + (b.buildingId === state.selected ? ' active' : '') + (b.active ? '' : ' retired');
    li.setAttribute('role', 'option'); li.dataset.id = b.buildingId;
    const conflict = Object.values(b.evidence || {}).some((e) => e.conflict);
    li.innerHTML = `
      <div class="row1"><span class="name">${esc(b.displayName)}</span><span class="ref">${esc(b.stableRef)}</span></div>
      <div class="hn">${b.currentHouseNumber ? esc(b.currentHouseNumber) : '<span class="muted">（此时刻无现行门牌）</span>'}
        ${!b.active ? '<span class="badge warn">历史实体</span>' : ''}</div>
      <div class="badges">
        <span class="badge era-${b.era || 'unknown'}">${b.era ? eraLabel[b.era] + (b.year ? '·' + b.year : '') : '年代未定'}</span>
        ${(b.styles || []).map((s) => `<span class="badge">${esc(styleLabel[s] || s)}</span>`).join('')}
        <span class="badge">${esc(presLabel[b.preservation] || b.preservation)}</span>
        ${conflict ? '<span class="badge warn">证据分歧</span>' : ''}
        ${b.coord?.corrected ? '<span class="badge ok">坐标已纠偏</span>' : ''}
        ${b.allAliases.length > 1 ? '<span class="badge">多次改号</span>' : ''}
      </div>`;
    li.addEventListener('click', () => selectBuilding(b.buildingId, true));
    ul.appendChild(li);
  }
  $('#pageInfo').textContent = `第 ${state.page}/${state.totalPages} 页 · 共 ${state.total} 座`;
  $('#prevPage').disabled = state.page <= 1; $('#nextPage').disabled = state.page >= state.totalPages;
}

// keyboard: arrows on list
$('#buildingList').addEventListener('keydown', (e) => {
  const n = state.pageItems.length; if (!n) return;
  let idx = state.pageItems.findIndex((b) => b.buildingId === state.selected);
  if (e.key === 'ArrowDown') { idx = (idx + 1) % n; e.preventDefault(); selectBuilding(state.pageItems[idx].buildingId, false); ensureVisible(idx); }
  else if (e.key === 'ArrowUp') { idx = (idx <= 0 ? n - 1 : idx - 1); e.preventDefault(); selectBuilding(state.pageItems[idx].buildingId, false); ensureVisible(idx); }
  else if (e.key === 'Enter' || e.key === 'ArrowRight') { if (idx >= 0) openDrawer(state.pageItems[idx].buildingId); }
});
function ensureVisible(i) { $$('#buildingList .bitem')[i]?.scrollIntoView({ block: 'nearest' }); }

function selectBuilding(id, open) {
  state.selected = id;
  $$('#buildingList .bitem').forEach((li) => li.classList.toggle('active', li.dataset.id === id));
  drawMap();
  if (open) openDrawer(id);
}

// ---------------- Canvas 自绘地图 ----------------
const cv = $('#map'), ctx = cv.getContext('2d');
function boundsOf(items) {
  let W = Infinity, S = Infinity, E = -Infinity, N = -Infinity, found = false;
  const eat = (lng, lat) => { found = true; W = Math.min(W, lng); E = Math.max(E, lng); S = Math.min(S, lat); N = Math.max(N, lat); };
  items.forEach((b) => {
    if (b.boundary) b.boundary.ring.forEach(([x, y]) => eat(x, y));
    if (b.coord) eat(b.coord.lng, b.coord.lat);
  });
  if (!found) return null;
  const padLng = Math.max((E - W) * 0.18, 0.0004), padLat = Math.max((N - S) * 0.18, 0.0004);
  return { W: W - padLng, E: E + padLng, S: S - padLat, N: N + padLat };
}
let proj = null, hitZones = [];
function makeProj(bb) {
  const pad = 46;
  const w = cv.width - pad * 2, h = cv.height - pad * 2;
  const sx = w / (bb.E - bb.W), sy = h / (bb.N - bb.S);
  const k = Math.min(sx, sy);
  const ox = pad + (w - (bb.E - bb.W) * k) / 2, oy = pad + (h - (bb.N - bb.S) * k) / 2;
  return { X: (lng) => ox + (lng - bb.W) * k, Y: (lat) => oy + (bb.N - lat) * k, k };
}
function drawMap() {
  const items = state.mapItems;
  ctx.clearRect(0, 0, cv.width, cv.height); hitZones = [];
  // 背景：米黄方格纸
  ctx.fillStyle = '#efe9d8'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.strokeStyle = 'rgba(120,90,40,.10)'; ctx.lineWidth = 1;
  for (let x = 0; x < cv.width; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cv.height); ctx.stroke(); }
  for (let y = 0; y < cv.height; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke(); }
  const bb = boundsOf(items);
  // 图名框
  ctx.fillStyle = '#2b2620'; ctx.font = 'bold 16px serif'; ctx.fillText('青龍老街地段圖', 18, 28);
  ctx.font = '11px monospace'; ctx.fillStyle = '#8a7d5c'; ctx.fillText(`validAt ${String(state.validAt).replace('T', ' ')}`, 18, 44);
  if (!bb) { ctx.fillStyle = '#5c5346'; ctx.font = '15px serif'; ctx.fillText('当前快照无坐标要素', cv.width / 2 - 60, cv.height / 2); return; }
  proj = makeProj(bb);

  // 街道脊线（装饰，连接各点）
  const pts = items.filter((b) => b.coord).sort((a, b2) => a.coord.lng - b2.coord.lng);
  ctx.strokeStyle = 'rgba(120,90,40,.35)'; ctx.lineWidth = 10; ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((b, i) => { const X = proj.X(b.coord.lng), Y = proj.Y(b.coord.lat); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
  ctx.stroke();

  // 边界多边形（空间库）
  for (const b of items) {
    if (!b.boundary) continue;
    const ring = b.boundary.ring;
    ctx.beginPath();
    ring.forEach(([lng, lat], i) => { const X = proj.X(lng), Y = proj.Y(lat); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.closePath();
    ctx.fillStyle = b.buildingId === state.selected ? 'rgba(176,58,46,.18)' : 'rgba(176,58,46,.07)';
    ctx.fill();
    ctx.setLineDash([5, 4]); ctx.strokeStyle = '#b03a2e'; ctx.lineWidth = b.buildingId === state.selected ? 2.4 : 1.3; ctx.stroke(); ctx.setLineDash([]);
  }
  // 纠偏向量
  for (const b of items) {
    if (b.coord?.raw) {
      ctx.strokeStyle = 'rgba(80,80,80,.6)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(proj.X(b.coord.raw.lng), proj.Y(b.coord.raw.lat)); ctx.lineTo(proj.X(b.coord.lng), proj.Y(b.coord.lat)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#9a9181'; ctx.beginPath(); ctx.arc(proj.X(b.coord.raw.lng), proj.Y(b.coord.raw.lat), 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#6b6455'; ctx.font = '10px sans-serif'; ctx.fillText('纠偏', proj.X(b.coord.raw.lng) - 8, proj.Y(b.coord.raw.lat) - 6);
    }
  }
  // 实体点
  for (const b of items) {
    if (!b.coord) continue;
    const X = proj.X(b.coord.lng), Y = proj.Y(b.coord.lat);
    const c = b.era ? eraColor[b.era] : '#8a8172';
    const sel = b.buildingId === state.selected;
    ctx.beginPath(); ctx.arc(X, Y, sel ? 9 : 6, 0, 7);
    ctx.fillStyle = b.active ? c : '#ffffff'; ctx.fill();
    ctx.lineWidth = sel ? 3 : 1.6; ctx.strokeStyle = b.active ? '#2b2620' : c; ctx.stroke();
    if (b.coord.corrected) { ctx.strokeStyle = '#3f7d5e'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(X, Y, 11, 0, 7); ctx.stroke(); }
    ctx.fillStyle = '#2b2620'; ctx.font = '11px serif';
    ctx.fillText(b.currentHouseNumber ? b.currentHouseNumber.replace('青龙街', '') : b.stableRef, X + 9, Y - 7);
    hitZones.push({ id: b.buildingId, x: X, y: Y, r: 12 });
  }
  drawCompass(); drawScale(bb);
}
function drawCompass() {
  const x = cv.width - 40, y = 52;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#2b2620'; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(6, 8); ctx.lineTo(0, 3); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#b03a2e'; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(0, 3); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2b2620'; ctx.font = 'bold 11px serif'; ctx.textAlign = 'center'; ctx.fillText('北', 0, -22); ctx.restore(); ctx.textAlign = 'left';
}
function drawScale(bb) {
  const mPerLng = 111320 * Math.cos((bb.N + bb.S) / 2 * Math.PI / 180);
  const meters = 25; const px = (meters / mPerLng) * proj.k;
  const x = 30, y = cv.height - 26;
  ctx.strokeStyle = '#2b2620'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px, y);
  ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4); ctx.stroke();
  ctx.fillStyle = '#2b2620'; ctx.font = '11px sans-serif'; ctx.fillText(meters + ' m（示意）', x, y + 16);
}
cv.addEventListener('click', (e) => {
  const rect = cv.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (cv.width / rect.width), my = (e.clientY - rect.top) * (cv.height / rect.height);
  let best = null, bd = 1e9;
  for (const z of hitZones) { const d = Math.hypot(z.x - mx, z.y - my); if (d < z.r && d < bd) { bd = d; best = z; } }
  if (best) selectBuilding(best.id, true);
});
cv.addEventListener('mousemove', (e) => {
  const rect = cv.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (cv.width / rect.width), my = (e.clientY - rect.top) * (cv.height / rect.height);
  cv.style.cursor = hitZones.some((z) => Math.hypot(z.x - mx, z.y - my) < z.r) ? 'pointer' : 'grab';
});
window.addEventListener('resize', drawMap);

// 瓦片分块自测：在地图范围上切 3x2，显示各块计数（随筛选/时刻一致变化）
$('#btnTile').addEventListener('click', async () => {
  const bb = boundsOf(state.mapItems); const box = $('#tileBox');
  if (!bb) { box.classList.remove('hidden'); box.innerHTML = '<h4>瓦片自测</h4>无要素'; return; }
  const cols = 3, rows = 2, dLng = (bb.E - bb.W) / cols, dLat = (bb.N - bb.S) / rows;
  let html = '<h4>地理分块查询（同一快照/筛选）</h4>';
  const grid = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const west = bb.W + c * dLng, east = west + dLng, north = bb.N - r * dLat, south = north - dLat;
    const d = await api('/api/tiles?' + qs({ ...commonParams(), west: west.toFixed(6), south: south.toFixed(6), east: east.toFixed(6), north: north.toFixed(6) }));
    grid.push({ c, r, n: d.count, ids: d.items.map((x) => x.currentHouseNumber || x.stableRef) });
  }
  html += '<table style="width:100%;border-collapse:collapse;font-size:11px"><tbody>';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) { const g = grid.find((x) => x.r === r && x.c === c); html += `<td title="${esc(g.ids.join(','))}" style="border:1px solid #b03a2e;padding:8px;text-align:center;${g.n ? 'background:#fdeee8' : ''}">${g.n}</td>`; }
    html += '</tr>';
  }
  html += '</tbody></table><p class="muted">数字为该矩形块命中实体数；与列表/地图同源快照。</p>';
  box.innerHTML = html; box.classList.remove('hidden');
});

// ---------------- detail drawer ----------------
async function openDrawer(id) {
  const at = state.validAt;
  const d = await api(`/api/buildings/${encodeURIComponent(id)}?` + qs({ asOf: state.asOf, validAt: state.validAt, at }));
  const b = d.building;
  const ev = (f) => Object.values(b.evidence).filter((x) => x.field === f)[0];
  const evidenceHtml = Object.values(b.evidence).map((x) => {
    const valStr = (v) => Array.isArray(v) ? v.map((s) => styleLabel[s] || s).join('、') : (x.field === 'styles' ? v : String(v));
    const rows = x.claims.map((c) => `
      <div class="evrow">
        <span class="pill src">${esc(c.sourceTitle)}</span>
        ${normEq(c.value, x.adopted) ? '<span class="pill adopt">采纳</span>' : ''}
        <b>${esc(valStr(c.value))}</b>
        <span class="meta">可信度 ${c.confidence ?? '—'}${c.reliability != null ? ' · 来源可靠度 ' + c.reliability : ''}</span>
        ${c.note ? `<div class="meta">${esc(c.note)}</div>` : ''}
      </div>`).join('');
    return `<div class="evrow ${x.conflict ? 'conflict' : ''}" style="border-left-width:4px">
      <h4 style="margin:2px 0">${fieldName(x.field)} ${x.conflict ? '<span class="badge warn">存在分歧</span>' : '<span class="badge ok">一致</span>'}</h4>
      <div class="meta">当前采纳：<b>${esc(valStr(x.adopted))}</b>${x.resolution ? ` · 依据：${esc(x.resolution.basis)}` : '（系统按可信度/默认推定，可在后台追加 resolution）'}</div>
      ${rows}</div>`;
  }).join('');
  const aliasHtml = `<div class="alias-strip">${b.allAliases.slice().sort((a, z2) => String(a.validFrom).localeCompare(String(z2.validFrom))).map((a) =>
    `<span class="alias ${b.currentHouseNumber === a.houseNumber ? 'cur' : 'old'}">${esc(a.houseNumber)}<br><small>${period(a)}</small></span>`).join('')}</div>`;
  const linkHtml = b.links.length ? `<div>${b.links.map((l) => `<button class="ghost tiny" data-link="${l.otherId}">${l.dir === 'parent' ? '↑ 母体' : '↓ 拆出'} ${esc(l.otherId)}（${l.kind} ${String(l.effectiveDate || '').slice(0, 4)}）</button>`).join(' ')}</div>` : '<span class="muted">无合院分合关系</span>';
  const photoHtml = d.photos.length ? `<div class="photo-grid">${d.photos.map((p) => {
    if (p.status === 'missing' || !p.file) return `<div class="photo missing"><div>照片缺失：${esc(p.expectedSide || '')}<br><small>${esc(p.note)}</small></div>`;
    const cands = (p.candidates || []).map((c) => `
      <div class="cand">候选 ${esc(c.buildingId)} · ${esc(c.facadeSide || '立面未知')} · 置信 ${(c.confidence * 100) | 0}%
        <div class="confbar"><i style="width:${(c.confidence * 100) | 0}%"></i></div>
        <div class="meta">${esc(c.note)}</div></div>`).join('');
    return `<div class="photo"><img src="/uploads/${esc(p.file)}" alt="${esc(p.filename || '')}"/>
      <div class="cap">${esc(String(p.takenAt || '日期不详').slice(0, 10))} · 拍摄方位 ${p.azimuth ?? '—'}°<br><small>${esc(p.note || '')}</small>${cands}</div></div>`;
  }).join('')}</div>` : '<p class="muted">暂无影像记录（也未登记缺失）。</p>';
  const rnvHtml = d.renovations.length ? d.renovations.map((r) => `<div class="evrow"><b>${esc(String(r.date).slice(0, 10))} · ${esc(r.kind)}</b><div class="meta">${esc(r.scope)} ${r.contractor ? '· ' + esc(r.contractor) : ''}</div></div>`).join('') : '<span class="muted">无修缮事件</span>';
  const acc = d.access;
  const accHtml = `<div class="${acc.accessible ? 'hit-yes' : 'hit-no'}">${acc.at.slice(0, 16).replace('T', ' ')}：${acc.accessible ? '可进入（经 ' + acc.via.join('、') + '）' : '暂不可进入'}</div>
    ${acc.gateClosedButStreetAccessible ? '<p class="badge warn" style="font-size:12.5px">院门关闭，但侧/巷门仍开放——不等于整街不可访问</p>' : ''}
    <div class="access-grid">${acc.entrances.map((e) => `<div class="access ${e.open === true ? 'open' : e.open === false ? 'closed' : ''}"><b>${esc(e.code)}</b>（${e.kind === 'gate' ? '院门' : '门/巷门'}）<br>${e.open === true ? '开放' : e.open === false ? '关闭' : '无规则'} · ${esc(e.reason)}<br><small>${esc(e.note)}</small></div>`).join('')}</div>`;
  const coordHtml = b.coord ? `采纳坐标 ${b.coord.lng.toFixed(5)},${b.coord.lat.toFixed(5)} · ${b.coord.kind} · 精度±${b.coord.accuracyM ?? '?'}m
      ${b.coord.corrected ? `<br><span class="badge ok">已纠偏</span> 原观测 ${b.coord.raw.lng.toFixed(5)},${b.coord.raw.lat.toFixed(5)}` : ''}
      ${b.boundary ? `<br>边界来源：${esc(b.boundary.sourceId)}（空间库多边形）` : ''}` : '<span class="muted">无坐标</span>';

  $('#drawer').innerHTML = `
    <button class="ghost close" id="drawerClose">关闭 ✕</button>
    <h2>${esc(b.displayName)}</h2>
    <p class="muted">${esc(b.stableRef)} · ${b.currentHouseNumber ? esc(b.currentHouseNumber) : '此时刻无现行门牌'} · ${b.era ? eraLabel[b.era] + (b.year ? '(' + b.year + ')' : '') : '年代未定'} · ${esc(presLabel[b.preservation] || '')} ${b.active ? '' : '<span class="badge warn">历史实体</span>'}</p>
    <div class="dsec"><h4>门牌沿革（同一稳定实体的时段别名）</h4>${aliasHtml}</div>
    <div class="dsec"><h4>合院分合（lineage）</h4>${linkHtml}</div>
    <div class="dsec"><h4>证据差异（多来源，不强行统一）</h4>${evidenceHtml || '<span class="muted">尚无多来源主张</span>'}</div>
    <div class="dsec"><h4>坐标纠偏与空间边界</h4><div style="font-size:13px">${coordHtml}</div></div>
    <div class="dsec"><h4>影像（历史照片仅候选，不自动认定同一立面）</h4>${photoHtml}</div>
    <div class="dsec"><h4>开放状态（按入口与时间）</h4>${accHtml}</div>
    <div class="dsec"><h4>修缮事件</h4>${rnvHtml}</div>`;
  $('#drawer').classList.remove('hidden'); $('#scrim').classList.remove('hidden');
  $('#drawerClose').onclick = closeDrawer;
  $$('#drawer [data-link]').forEach((btn) => btn.addEventListener('click', () => openDrawer(btn.dataset.link)));
}
function normEq(v, adopted) {
  const a = Array.isArray(v) ? [...v].map(String).sort().join('|') : String(v);
  const b2 = Array.isArray(adopted) ? [...adopted].map(String).sort().join('|') : String(adopted);
  return a === b2;
}
function fieldName(f) { return { year_built: '建造年代', styles: '建筑风格', preservation: '保存状态', name: '名称' }[f] || f; }
function closeDrawer() { $('#drawer').classList.add('hidden'); $('#scrim').classList.add('hidden'); }
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

// ---------------- compare tab ----------------
$('#btnLookup').addEventListener('click', doLookup);
$('#lookupNumber').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLookup(); });
async function doLookup() {
  const number = $('#lookupNumber').value.trim(), at = $('#lookupAt').value;
  const d = await api('/api/lookup?' + qs({ asOf: state.asOf, validAt: state.validAt, number, at }));
  const renderCand = (c) => `<div class="evrow"><b>${esc(c.buildingId)}</b> · ${esc(c.stableRef)}
      <div class="meta">别名 ${esc(c.alias.houseNumber)} · ${period(c.alias)} · 该时刻生效：${c.coversAt ? '是' : '否'} · 实体生效：${c.active ? '是' : '历史实体'}</div></div>`;
  $('#cmpCurrent').innerHTML = `<h3>① 现门牌索引</h3>
    <p class="${d.current.hit ? 'hit-yes' : 'hit-no'}">${d.current.hit ? '命中 ' + esc(d.current.hit) : '落空（null）'}</p>
    <p class="muted">${esc(d.current.note)}</p>`;
  $('#cmpTimeline').innerHTML = `<h3>② 稳定实体 + 时段别名</h3>
    <p class="${d.timeline.hit ? 'hit-yes' : 'hit-no'}">${d.timeline.hit ? '命中 ' + esc(d.timeline.hit) : '落空'}</p>
    ${d.timeline.candidates.map(renderCand).join('') || ''}
    <p class="muted">${esc(d.timeline.note)}</p>`;
  await tileConsistencyLog();
}
async function tileConsistencyLog() {
  // 同一快照下：先取全图筛选集，再用多个分块并集复核数量一致
  const map = await api('/api/map?' + qs(commonParams()));
  const lngs = map.items.map((b) => b.coord?.lng).filter(Boolean), lats = map.items.map((b) => b.coord?.lat).filter(Boolean);
  if (!lngs.length) { $('#cmpTile').textContent = '无坐标要素'; return; }
  const W = Math.min(...lngs) - .0005, E = Math.max(...lngs) + .0005, S = Math.min(...lats) - .0005, N = Math.max(...lats) + .0005;
  const mid = (W + E) / 2, midL = (S + N) / 2;
  const boxes = [[W, S, mid, midL], [mid, S, E, midL], [W, midL, mid, N], [mid, midL, E, N]];
  const seen = new Set(); let lines = [];
  for (const [west, south, east, north] of boxes) {
    const t = await api('/api/tiles?' + qs({ ...commonParams(), west, south, east, north }));
    t.items.forEach((x) => seen.add(x.buildingId));
    lines.push(`块[${west.toFixed(4)},${south.toFixed(4)} → ${east.toFixed(4)},${north.toFixed(4)}] = ${t.count}`);
  }
  lines.push(`分块并集实体数 = ${seen.size}；地图全集实体数 = ${map.items.length} → ${seen.size === map.items.length ? '一致 ✓' : '不一致 ✗（边界跨块，按重叠容差处理）'}`);
  $('#cmpTile').textContent = lines.join('\n');
}

// ---------------- admin ----------------
const TEMPLATES = [
  ['createBuilding', '新建建筑', { buildingId: '', stableRef: 'QLS-009', displayName: '新登记建筑', houseNumber: '青龙街200号', styles: ['brick-wood'], preservation: 'fair', sourceId: 'src_survey' }],
  ['renumber', '门牌沿革（不新建建筑）', { buildingId: 'b1', houseNumber: '青龙街256号', effectiveDate: '2027-01-01', note: '再次改号', sourceId: 'src_news' }],
  ['addClaim', '追加来源主张（年代/风格）', { buildingId: 'b3', sourceId: 'src_book', field: 'year_built', value: 1925, confidence: 0.55, note: '新发现的二手材料，与现有主张并存' }],
  ['resolve', '采纳裁定（保留差异）', { buildingId: 'b3', field: 'year_built', adoptedValue: 1929, basis: '田野表可靠性高于二手材料', sourceId: 'src_survey' }],
  ['coord', '坐标观测/纠偏', { buildingId: 'b7', sourceId: 'src_gis', lng: 114.40982, lat: 30.46631, accuracyM: 1, kind: 'survey', correctedFrom: { lng: 114.4098, lat: 30.4663 }, note: 'RTK 复测' }],
  ['boundary', '空间边界（带来源/时段）', { buildingId: 'b7', sourceId: 'src_gis', ring: [[114.4097, 30.4662], [114.4099, 30.4662], [114.4099, 30.4664], [114.4097, 30.4664]], validFrom: null, validTo: null }],
  ['splitCompound', '合院拆分（子体独立身份）', { buildingId: 'b2', effectiveDate: '2026-10-01', closeOldBoundary: true, children: [{ stableRef: 'QLS-002-C', displayName: '舒泰记新分进', houseNumber: '青龙街57-3号', styles: ['stone'] }] }],
  ['renovation', '修缮事件', { buildingId: 'b3', date: '2026-10-15', kind: 'repair', scope: '屋面修缮', contractor: '古建二队', sourceId: 'src_news' }],
  ['photo', '登记照片（含朝向）', { buildingId: 'b1', file: 'b1_modern.svg', takenAt: '2026-09-01', azimuth: 270, cameraLng: 114.4081, cameraLat: 30.4667, sourceId: 'src_survey', status: 'present' }],
  ['markPhotoMissing', '标记照片缺失', { buildingId: 'b3', expectedSide: 'east_front', sourceId: 'src_survey', note: '门面影像缺失，待补' }],
  ['candidate', '历史照片候选对应', { photoId: 'pho_b1_hist', buildingId: 'b1', facadeSide: 'east_front', confidence: 0.6, note: '仅候选，不自动认定' }],
  ['entrance', '新增入口', { buildingId: 'b3', code: '后门', kind: 'door', lng: 114.4076, lat: 30.4673 }],
  ['entranceRule', '入口时段/日期规则', { entranceId: 'ent_gate', date: '2026-10-01', open: false, note: '国庆暂停开放' }],
  ['createSource', '登记来源', { title: '新测绘报告', kind: 'survey', year: 2026, reliability: 0.9, citation: '报告编号XX' }],
  ['retract', '撤回事件（墓碑，不删库）', { targetEventId: '<在下方事件日志复制 id>', reason: '误录/对象撤回' }],
];
const tplList = $('#tplList'); const cmdSelect = $('#cmdSelect');
TEMPLATES.forEach(([cmd, label, body]) => {
  const b = document.createElement('button'); b.className = 'tplbtn';
  b.innerHTML = `${esc(label)}<br><small>${esc(cmd)}</small>`;
  b.addEventListener('click', () => { cmdSelect.value = cmd; $('#cmdJson').value = JSON.stringify(body, null, 2); });
  tplList.appendChild(b);
  const o = document.createElement('option'); o.value = cmd; o.textContent = cmd; cmdSelect.appendChild(o);
});
cmdSelect.addEventListener('change', () => {
  const t = TEMPLATES.find((x) => x[0] === cmdSelect.value);
  if (t) $('#cmdJson').value = JSON.stringify(t[2], null, 2);
});
cmdSelect.value = 'createBuilding';
$('#cmdJson').value = JSON.stringify(TEMPLATES[0][2], null, 2);

$('#btnRunCmd').addEventListener('click', async () => {
  const cmd = cmdSelect.value; let body;
  try { body = JSON.parse($('#cmdJson').value || '{}'); } catch (e) { $('#cmdResult').innerHTML = '<span class="bad">JSON 解析失败</span>'; return; }
  try {
    const d = await api('/api/admin/' + cmd, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    $('#cmdResult').innerHTML = `<span class="ok">✓ ${esc(cmd)} 已追加</span> <code>${esc(JSON.stringify(d))}</code>`;
    await loadEvents(); await refresh();
  } catch (e) { $('#cmdResult').innerHTML = `<span class="bad">✗ ${esc(e.message)}</span>`; }
});
$('#btnUpload').addEventListener('click', async () => {
  const f = $('#upFile').files[0];
  if (!f) { $('#upResult').textContent = '请先选择图片'; return; }
  const fd = new FormData(); fd.append('file', f); fd.append('azimuth', $('#upAz').value);
  const r = await fetch('/api/admin/upload', { method: 'POST', body: fd }); const j = await r.json();
  $('#upResult').textContent = j.ok ? JSON.stringify(j.data, null, 2) : ('上传失败: ' + (j.error?.message || ''));
});
async function loadEvents() {
  const evs = await api('/api/events');
  $('#eventLog').innerHTML = evs.slice(-14).reverse().map((e) =>
    `<div><span class="et">#${e.seq} ${e.type}</span> <span class="muted">${esc(e.recordedAt)} · ${esc(e.recordedBy)}</span><br><span class="muted">id=${e.id}</span> ${e.type === 'building.registered' ? esc(JSON.stringify({ buildingId: e.data.buildingId, name: e.data.displayName })) : ''}</div>`).join('<hr style="border-color:#444">');
}

// ---------------- about (render design.md) ----------------
fetch('/design.md').then((r) => r.text()).then((md) => { $('#aboutDoc').innerHTML = renderMd(md); });
function renderMd(src) {
  const lines = src.split('\n'); let html = '', i = 0;
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('### ')) { html += '<h3>' + inline(l.slice(4)) + '</h3>'; i++; }
    else if (l.startsWith('## ')) { html += '<h2>' + inline(l.slice(3)) + '</h2>'; i++; }
    else if (l.startsWith('# ')) { html += '<h1>' + inline(l.slice(2)) + '</h1>'; i++; }
    else if (l.startsWith('- ')) { html += '<ul>'; while (lines[i] && lines[i].startsWith('- ')) { html += '<li>' + inline(lines[i].slice(2)) + '</li>'; i++; } html += '</ul>'; }
    else if (/^\|.*\|$/.test(l)) {
      const tbl = []; while (/^\|.*\|$/.test(lines[i])) { tbl.push(lines[i]); i++; }
      const rows = tbl.filter((r) => !/^\|[\s:|-]+\|$/.test(r)).map((r) => r.split('|').slice(1, -1).map((c) => c.trim()));
      if (rows.length) { html += '<table><thead><tr>' + rows[0].map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
        rows.slice(1).forEach((r) => { html += '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>'; }); html += '</tbody></table>'; }
    }
    else if (l.trim() === '') i++;
    else { html += '<p>' + inline(l) + '</p>'; i++; }
  }
  return html;
}

refresh();
