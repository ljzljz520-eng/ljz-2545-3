// 种子数据：青龙老街。故意制造多来源年代矛盾、坐标纠偏、合院拆分、
// 门牌沿革、候选立面、入口差异化开放、照片缺失、分页撤回等场景。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetStore, appendEvent } from '../core/event-store.js';
import { EVENT_LOG, UPLOAD_DIR } from '../core/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.argv.includes('--reset')) resetStore(EVENT_LOG);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const T = {
  t1: '2021-03-01T09:00', t2: '2022-06-15T09:00', t3: '2024-02-10T09:00',
  t4: '2025-09-20T09:00', t5: '2026-08-01T09:00', now: '2026-09-30T10:00',
};
const E = (type, data, by = 'curator', when = T.now) =>
  appendEvent(type, data, { recordedBy: by, recordedAt: when }, EVENT_LOG);

function svg(name, { title, sub, hue, cam }) {
  const arrow = cam != null
    ? `<g transform="translate(100,84) rotate(${cam})"><path d="M0,14 L-9,-8 L0,-2 L9,-8 Z" fill="#facc15" stroke="#1f2937" stroke-width="2"/></g>` : '';
  const body = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect width="400" height="300" fill="hsl(${hue},26%,20%)"/>
  <g stroke="hsl(${hue},30%,42%)" stroke-width="3" fill="hsl(${hue},24%,30%)">
    <rect x="40" y="120" width="320" height="140"/>
    <rect x="70" y="150" width="60" height="110" fill="hsl(${hue},20%,22%)"/>
    <rect x="170" y="150" width="60" height="110" fill="hsl(${hue},20%,22%)"/>
    <rect x="270" y="150" width="60" height="110" fill="hsl(${hue},20%,22%)"/>
    <polygon points="30,120 200,60 370,120" fill="hsl(${hue},28%,26%)"/>
  </g>
  ${arrow}
  <text x="20" y="36" font-family="serif" font-size="26" fill="#fde68a">${title}</text>
  <text x="20" y="286" font-family="sans-serif" font-size="15" fill="#cbd5e1">${sub}</text>
</svg>`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), body);
  return name;
}

const phModern = svg('b1_modern.svg', { title: '裕通号·现状', sub: '2024 拍摄·方位85°', hue: 28, cam: 85 });
const phHist = svg('b1_1935.svg', { title: '裕通号·1935', sub: '历史影像·视角/位置存疑（候选对应）', hue: 210, cam: 200 });
const ph2 = svg('b2_shutai.svg', { title: '舒泰记总院', sub: '合院拆分前总院影像·1962', hue: 120, cam: 130 });

export function run() {
  const src = (o) => { E('source.registered', { sourceId: o.id, title: o.t, kind: o.k, year: o.y ?? null, reliability: o.r, citation: o.c || '' }, 'curator', T.t1); return o.id; };
  const S_BOOK = src({ id: 'src_book', t: '《青龙镇志》1986', k: 'document', y: 1986, r: 0.8, c: '镇志·街巷篇' });
  const S_SURV = src({ id: 'src_survey', t: '2018三普田野表', k: 'survey', y: 2018, r: 0.9, c: '三普编号QL-117' });
  const S_OLD  = src({ id: 'src_oldmap', t: '1935地籍图', k: 'map', y: 1935, r: 0.55, c: '省档案馆甲-23' });
  const S_PLAQ = src({ id: 'src_plaque', t: '门额纪年题记', k: 'inscription', y: null, r: 0.95, c: '现场题记' });
  const S_GIS  = src({ id: 'src_gis', t: '2023实测坐标系', k: 'survey', y: 2023, r: 0.97, c: 'CGCS2000' });
  const S_NEWS = src({ id: 'src_news', t: '2026老街公告', k: 'gazette', y: 2026, r: 0.75, c: '街区管委会' });

  // b1 裕通号：年代矛盾 + 门牌沿革 + 坐标纠偏 + 候选立面
  E('building.registered', { buildingId: 'b1', stableRef: 'QLS-001', displayName: '裕通号老铺', styleTags: ['chuandou', 'brick-wood'], preservation: 'fair', note: '临街两层木构商铺' }, 'curator', T.t1);
  E('building.aliased', { buildingId: 'b1', aliasId: 'als_b1_old', houseNumber: '青龙街42号', validFrom: null, validTo: null, sourceId: S_OLD, note: '1935地籍门牌' }, 'curator', T.t1);
  E('alias.closed', { buildingId: 'b1', effectiveDate: '1998-05-01' }, 'curator', T.t2);
  E('building.aliased', { buildingId: 'b1', aliasId: 'als_b1_new', houseNumber: '青龙街128号', validFrom: '1998-05-01', validTo: null, note: '道路取直后重新编号' }, 'curator', T.t2);
  E('building.claimed', { claimId: 'clm_b1_y_book', buildingId: 'b1', sourceId: S_BOOK, field: 'year_built', value: 1892, confidence: 0.6, note: '镇志据口述推定' }, 'curator', T.t1);
  E('building.claimed', { claimId: 'clm_b1_y_surv', buildingId: 'b1', sourceId: S_SURV, field: 'year_built', value: 1921, confidence: 0.7, note: '三普形制判断偏晚' }, 'curator', T.t3);
  E('building.claimed', { claimId: 'clm_b1_y_plaq', buildingId: 'b1', sourceId: S_PLAQ, field: 'year_built', value: 1904, confidence: 0.95, note: '门额光绪三十年题记' }, 'curator', T.t4);
  E('resolution.recorded', { resolutionId: 'res_b1_year', buildingId: 'b1', field: 'year_built', adoptedValue: 1904, basis: '一手题记可靠性最高；镇志为二手口述，三普为形制推断', sourceId: S_PLAQ, note: '保留差异，不抹除矛盾' }, 'curator', T.t4);
  E('building.claimed', { claimId: 'clm_b1_st_book', buildingId: 'b1', sourceId: S_BOOK, field: 'styles', value: ['chuandou'], confidence: 0.6 }, 'curator', T.t1);
  E('building.claimed', { claimId: 'clm_b1_st_surv', buildingId: 'b1', sourceId: S_SURV, field: 'styles', value: ['chuandou', 'brick-wood'], confidence: 0.8 }, 'curator', T.t3);
  E('coord.observed', { obsId: 'obs_b1_old', buildingId: 'b1', sourceId: S_OLD, lng: 114.4088, lat: 30.4660, accuracyM: 25, kind: 'georef', note: '1935图配准，误差较大' }, 'curator', T.t2);
  E('coord.observed', { obsId: 'obs_b1_fix', buildingId: 'b1', sourceId: S_GIS, lng: 114.4082, lat: 30.4668, accuracyM: 1.5, kind: 'survey', correctedFrom: { lng: 114.4088, lat: 30.4660 }, note: '按实测控制点纠偏' }, 'curator', T.t3);
  E('boundary.recorded', { boundaryId: 'bnd_b1', buildingId: 'b1', sourceId: S_SURV, ring: [[114.40805, 30.46665], [114.40835, 30.46665], [114.40835, 30.46695], [114.40805, 30.46695]], validFrom: null, validTo: null, note: '2018落宗地范围' }, 'curator', T.t3);
  E('renovation.recorded', { renovationId: 'rnv_b1_1', buildingId: 'b1', date: '2019-07-20', kind: 'repair', scope: '前檐木构架剔补、瓦面翻修', contractor: '古建三队', sourceId: S_SURV }, 'curator', T.t3);
  E('photo.recorded', { photoId: 'pho_b1_modern', buildingId: 'b1', file: phModern, filename: phModern, takenAt: '2024-04-12', azimuth: 85, cameraLng: 114.4081, cameraLat: 30.4667, sourceId: S_SURV, status: 'present', note: '街面东侧朝西偏北拍摄' }, 'curator', T.t4);
  E('photo.recorded', { photoId: 'pho_b1_hist', buildingId: 'b1', file: phHist, filename: phHist, takenAt: '1935-10-01', azimuth: 200, cameraLng: 114.4090, cameraLat: 30.4661, sourceId: S_OLD, status: 'present', note: '疑似隔街拍摄，视角与位置均存疑' }, 'curator', T.t4);
  E('photo.candidate', { candidateId: 'cand_b1_a', photoId: 'pho_b1_hist', buildingId: 'b1', facadeSide: 'east_front', confidence: 0.62, note: '二层挑廊形制吻合，但开间数存疑' }, 'curator', T.t4);
  E('photo.candidate', { candidateId: 'cand_b1_b', photoId: 'pho_b1_hist', buildingId: 'b3', facadeSide: 'north_gable', confidence: 0.41, note: '隔街错位配准的另一候选' }, 'curator', T.t4);

  // b2 舒泰记总院 + b2a/b2b 拆分（子体独立身份 + lineage）
  E('building.registered', { buildingId: 'b2', stableRef: 'QLS-002', displayName: '舒泰记总院（拆分前）', styleTags: ['brick-wood', 'stone'], preservation: 'fair', note: '1985产权与院落拆分' }, 'curator', T.t1);
  E('building.aliased', { buildingId: 'b2', aliasId: 'als_b2', houseNumber: '青龙街57号', validFrom: null, validTo: '1985-01-01', sourceId: S_BOOK, note: '总院老门牌' }, 'curator', T.t1);
  E('building.claimed', { claimId: 'clm_b2_y', buildingId: 'b2', sourceId: S_BOOK, field: 'year_built', value: 1933, confidence: 0.7 }, 'curator', T.t1);
  E('coord.observed', { obsId: 'obs_b2', buildingId: 'b2', sourceId: S_GIS, lng: 114.4093, lat: 30.4671, accuracyM: 2, kind: 'survey' }, 'curator', T.t3);
  E('boundary.recorded', { boundaryId: 'bnd_b2', buildingId: 'b2', sourceId: S_SURV, ring: [[114.4091, 30.46695], [114.4095, 30.46695], [114.4095, 30.4673], [114.4091, 30.4673]], validFrom: null, validTo: '1985-01-01', note: '拆分前总院范围' }, 'curator', T.t1);
  E('photo.recorded', { photoId: 'pho_b2', buildingId: 'b2', file: ph2, filename: ph2, takenAt: '1962-05-01', azimuth: 130, sourceId: S_BOOK, status: 'present', note: '拆分前总院唯一影像' }, 'curator', T.t2);

  E('building.registered', { buildingId: 'b2a', stableRef: 'QLS-002-A', displayName: '舒泰记东厢（现杂货铺）', styleTags: ['brick-wood'], preservation: 'good', note: '1985自总院分出' }, 'curator', T.t2);
  E('lineage.linked', { linkId: 'lnk_b2a', parentId: 'b2', childId: 'b2a', kind: 'split', effectiveDate: '1985-01-01', note: '东厢独立产权' }, 'curator', T.t2);
  E('building.aliased', { buildingId: 'b2a', aliasId: 'als_b2a', houseNumber: '青龙街57-1号', validFrom: '1985-01-01', validTo: null, note: '拆分后门牌' }, 'curator', T.t2);
  E('coord.observed', { obsId: 'obs_b2a', buildingId: 'b2a', sourceId: S_GIS, lng: 114.40942, lat: 30.46702, accuracyM: 2, kind: 'survey' }, 'curator', T.t3);
  E('boundary.recorded', { boundaryId: 'bnd_b2a', buildingId: 'b2a', sourceId: S_SURV, ring: [[114.4093, 30.46695], [114.4095, 30.46695], [114.4095, 30.46715], [114.4093, 30.46715]], validFrom: '1985-01-01', validTo: null }, 'curator', T.t3);

  E('building.registered', { buildingId: 'b2b', stableRef: 'QLS-002-B', displayName: '舒泰记西厢（现茶馆）', styleTags: ['stone', 'brick-wood'], preservation: 'intact', note: '1985自总院分出' }, 'curator', T.t2);  E('lineage.linked', { linkId: 'lnk_b2b', parentId: 'b2', childId: 'b2b', kind: 'split', effectiveDate: '1985-01-01', note: '西厢独立产权' }, 'curator', T.t2);
  E('building.aliased', { buildingId: 'b2b', aliasId: 'als_b2b', houseNumber: '青龙街57-2号', validFrom: '1985-01-01', validTo: null }, 'curator', T.t2);
  E('coord.observed', { obsId: 'obs_b2b', buildingId: 'b2b', sourceId: S_GIS, lng: 114.40918, lat: 30.46718, accuracyM: 2, kind: 'survey' }, 'curator', T.t3);
  E('boundary.recorded', { boundaryId: 'bnd_b2b', buildingId: 'b2b', sourceId: S_SURV, ring: [[114.4091, 30.46715], [114.4095, 30.46715], [114.4095, 30.4673], [114.4091, 30.4673]], validFrom: '1985-01-01', validTo: null }, 'curator', T.t3);
  E('renovation.recorded', { renovationId: 'rnv_b2b', buildingId: 'b2b', date: '2023-09-01', kind: 'adaptive', scope: '石砌墙体加固、内部改茶馆', contractor: '古建一队', sourceId: S_GIS }, 'curator', T.t4);

  // b3 永茂粮行
  E('building.registered', { buildingId: 'b3', stableRef: 'QLS-003', displayName: '永茂粮行', styleTags: ['stone', 'colonial'], preservation: 'poor', note: '门脸风化严重' }, 'curator', T.t1);
  E('building.aliased', { buildingId: 'b3', aliasId: 'als_b3', houseNumber: '青龙街132号', validFrom: null, validTo: null }, 'curator', T.t1);
  E('building.claimed', { claimId: 'clm_b3_y', buildingId: 'b3', sourceId: S_SURV, field: 'year_built', value: 1929, confidence: 0.8 }, 'curator', T.t3);
  E('coord.observed', { obsId: 'obs_b3', buildingId: 'b3', sourceId: S_GIS, lng: 114.4076, lat: 30.4672, accuracyM: 2, kind: 'survey' }, 'curator', T.t3);
  E('boundary.recorded', { boundaryId: 'bnd_b3', buildingId: 'b3', sourceId: S_GIS, ring: [[114.40748, 30.46708], [114.40772, 30.46708], [114.40772, 30.46732], [114.40748, 30.46732]] }, 'curator', T.t3);
  E('renovation.recorded', { renovationId: 'rnv_b3', buildingId: 'b3', date: '2026-05-18', kind: 'emergency', scope: '门墙倾斜支顶抢险', sourceId: S_NEWS }, 'curator', T.t5);

  // b4 当代改建
  E('building.registered', { buildingId: 'b4', stableRef: 'QLS-004', displayName: '老街社区服务站（当代改建）', styleTags: ['modern', 'reinforced'], preservation: 'good' }, 'curator', T.t2);
  E('building.aliased', { buildingId: 'b4', aliasId: 'als_b4', houseNumber: '青龙街140号', validFrom: '2008-01-01', validTo: null }, 'curator', T.t2);
  E('building.claimed', { claimId: 'clm_b4_y', buildingId: 'b4', sourceId: S_GIS, field: 'year_built', value: 2008, confidence: 0.9 }, 'curator', T.t3);
  E('coord.observed', { obsId: 'obs_b4', buildingId: 'b4', sourceId: S_GIS, lng: 114.4069, lat: 30.4665, accuracyM: 2, kind: 'survey' }, 'curator', T.t3);

  // b5 清代石构
  E('building.registered', { buildingId: 'b5', stableRef: 'QLS-005', displayName: '罗氏宗祠偏殿', styleTags: ['stone', 'chuandou'], preservation: 'intact' }, 'curator', T.t1);
  E('building.aliased', { buildingId: 'b5', aliasId: 'als_b5', houseNumber: '青龙街88号', validFrom: null, validTo: null }, 'curator', T.t1);
  E('building.claimed', { claimId: 'clm_b5_y1', buildingId: 'b5', sourceId: S_BOOK, field: 'year_built', value: 1780, confidence: 0.65 }, 'curator', T.t1);
  E('building.claimed', { claimId: 'clm_b5_y2', buildingId: 'b5', sourceId: S_PLAQ, field: 'year_built', value: 1776, confidence: 0.9 }, 'curator', T.t4);
  E('resolution.recorded', { resolutionId: 'res_b5_year', buildingId: 'b5', field: 'year_built', adoptedValue: 1776, basis: '题记优先', sourceId: S_PLAQ }, 'curator', T.t4);
  E('coord.observed', { obsId: 'obs_b5', buildingId: 'b5', sourceId: S_GIS, lng: 114.4101, lat: 30.4676, accuracyM: 2, kind: 'survey' }, 'curator', T.t3);
  E('boundary.recorded', { boundaryId: 'bnd_b5', buildingId: 'b5', sourceId: S_GIS, ring: [[114.40995, 30.46745], [114.41025, 30.46745], [114.41025, 30.46775], [114.40995, 30.46775]] }, 'curator', T.t3);

  // b6 院门关闭但侧巷门开
  E('building.registered', { buildingId: 'b6', stableRef: 'QLS-006', displayName: '咸宁会馆', styleTags: ['brick-wood', 'chuandou'], preservation: 'good', note: '正门维护，侧巷门通行' }, 'curator', T.t1);
  E('building.aliased', { buildingId: 'b6', aliasId: 'als_b6', houseNumber: '青龙街101号', validFrom: null, validTo: null }, 'curator', T.t1);
  E('building.claimed', { claimId: 'clm_b6_y', buildingId: 'b6', sourceId: S_BOOK, field: 'year_built', value: 1910, confidence: 0.7 }, 'curator', T.t1);
  E('coord.observed', { obsId: 'obs_b6', buildingId: 'b6', sourceId: S_GIS, lng: 114.4087, lat: 30.4680, accuracyM: 2, kind: 'survey' }, 'curator', T.t3);
  E('entrance.registered', { entranceId: 'ent_gate', buildingId: 'b6', code: '正门院', kind: 'gate', lng: 114.4087, lat: 30.4679, note: '临正街大门' }, 'curator', T.t3);
  E('entrance.rule', { ruleId: 'rul_gate_w', entranceId: 'ent_gate', dayOfWeek: null, startMin: 8 * 60, endMin: 17 * 60, open: true, note: '日常8-17' }, 'curator', T.t3);
  E('entrance.rule', { ruleId: 'rul_gate_30', entranceId: 'ent_gate', date: '2026-09-30', open: false, note: '门额落架维护，整日关闭' }, 'curator', T.t5);
  E('entrance.registered', { entranceId: 'ent_door', buildingId: 'b6', code: '侧巷门', kind: 'door', lng: 114.40882, lat: 30.46805, note: '连通后巷' }, 'curator', T.t3);
  E('entrance.rule', { ruleId: 'rul_door_w', entranceId: 'ent_door', dayOfWeek: null, startMin: 7 * 60, endMin: 20 * 60, open: true, note: '每日7-20' }, 'curator', T.t3);

  // b7 照片缺失
  E('building.registered', { buildingId: 'b7', stableRef: 'QLS-007', displayName: '德春堂药铺', styleTags: ['brick-wood'], preservation: 'fair' }, 'curator', T.t2);
  E('building.aliased', { buildingId: 'b7', aliasId: 'als_b7', houseNumber: '青龙街119号', validFrom: null, validTo: null }, 'curator', T.t2);
  E('building.claimed', { claimId: 'clm_b7_y', buildingId: 'b7', sourceId: S_SURV, field: 'year_built', value: 1946, confidence: 0.7 }, 'curator', T.t3);
  E('coord.observed', { obsId: 'obs_b7', buildingId: 'b7', sourceId: S_GIS, lng: 114.4098, lat: 30.4663, accuracyM: 3, kind: 'survey' }, 'curator', T.t3);
  E('photo.missing', { photoId: 'pho_b7_missing', buildingId: 'b7', expectedSide: 'east_front', sourceId: S_SURV, note: '档案与现场均未获影像，待补' }, 'curator', T.t5);

  // b8 民国骑楼
  E('building.registered', { buildingId: 'b8', stableRef: 'QLS-008', displayName: '南洋百货骑楼', styleTags: ['colonial', 'reinforced'], preservation: 'fair' }, 'curator', T.t1);
  E('building.aliased', { buildingId: 'b8', aliasId: 'als_b8', houseNumber: '青龙街95号', validFrom: null, validTo: null }, 'curator', T.t1);
  E('building.claimed', { claimId: 'clm_b8_y', buildingId: 'b8', sourceId: S_SURV, field: 'year_built', value: 1936, confidence: 0.8 }, 'curator', T.t3);
  E('coord.observed', { obsId: 'obs_b8', buildingId: 'b8', sourceId: S_GIS, lng: 114.4071, lat: 30.4679, accuracyM: 2, kind: 'survey' }, 'curator', T.t3);

  // b9 误录临时棚（随后在测试中撤回：分页撤回场景）
  E('building.registered', { buildingId: 'b9_bad', stableRef: 'TMP-BAD', displayName: '临时棚（误录）', styleTags: ['modern'], preservation: 'ruin', note: '非历史建筑，误录入' }, 'intern', T.t5);
  E('building.aliased', { buildingId: 'b9_bad', aliasId: 'als_b9', houseNumber: '青龙街临时1号', validFrom: '2026-08-20', validTo: null }, 'intern', T.t5);
  E('coord.observed', { obsId: 'obs_b9', buildingId: 'b9_bad', sourceId: S_GIS, lng: 114.4066, lat: 30.4670, accuracyM: 5, kind: 'gps' }, 'intern', T.t5);
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  run();
  console.log('种子完成。事件数 =', fs.readFileSync(EVENT_LOG, 'utf8').trim().split('\n').length);
}
