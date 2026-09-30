// 种子数据：虚构「槐安老街」。刻意包含：
//  - 多来源年代/风格矛盾（E-001, E-005）
//  - 坐标纠偏（E-005：1948 清册点位偏移，2024 测绘纠偏）
//  - 门牌沿革（更名不改实体：E-001）
//  - 合院拆分不沿用单一身份（E-002 -> E-003/E-004，谱系保留）
//  - 历史照片候选对应、朝向/视角误差、缺失文件（P-001/P-003）
//  - 入口级开放状态（东街门关闭但西街门开；E-003 院门检修关闭；E-008 预约）
import { EMPTY_DB, persist, nowTs } from './db.js';

const ring = ([lon, lat], dx = 0.00016, dy = 0.00012) => [
  [lon - dx, lat - dy], [lon + dx, lat - dy],
  [lon + dx, lat + dy], [lon - dx, lat + dy], [lon - dx, lat - dy]
];

export function seedDB() {
  const d = EMPTY_DB();
  d.meta.siteName = '槐安老街历史文化街区';
  d.meta.center = [118.0865, 24.562];
  d.meta.siteEntranceIds = ['EN-S1', 'EN-S2'];

  d.sources = [
    { id: 'S1', title: '1948 年槐安镇地籍清册', kind: 'cadastre', authority: 40, recordedAt: '1948-03-01T00:00:00.000Z' },
    { id: 'S2', title: '1982 年地名普查表', kind: 'gazetteer', authority: 35, recordedAt: '1982-07-01T00:00:00.000Z' },
    { id: 'S3', title: '第三次全国文物普查登记表（2019）', kind: 'survey', authority: 70, recordedAt: '2019-11-20T00:00:00.000Z' },
    { id: 'S4', title: '2024 年街区实测地形图（含坐标纠偏）', kind: 'survey', authority: 95, recordedAt: '2024-05-18T00:00:00.000Z' },
    { id: 'S5', title: '徐氏家族口述史（2017 访谈）', kind: 'oral', authority: 20, recordedAt: '2017-09-10T00:00:00.000Z' },
    { id: 'S6', title: '闽南影像馆藏明信片与老照片', kind: 'photo-archive', authority: 60, recordedAt: '2016-04-02T00:00:00.000Z' },
    { id: 'S7', title: '建筑年代铭牌（现场拓录）', kind: 'plaque', authority: 55, recordedAt: '2015-02-11T00:00:00.000Z' },
    { id: 'S8', title: '民国《槐安寺塔志》点注本（2009）', kind: 'gazetteer', authority: 45, recordedAt: '2009-08-01T00:00:00.000Z' },
    { id: 'S9', title: '街区修缮施工档案', kind: 'construction', authority: 80, recordedAt: '2021-11-30T00:00:00.000Z' }
  ];

  const E = (id, name, note, createdAt = '2019-11-20T00:00:00.000Z', validFrom = null, validTo = null) =>
    ({ id, name, note, createdAt, validFrom, validTo, withdrawn: false });

  d.entities = [
    E('E-001', '荣盛酱园旧址', '清晚期酱园铺面，1953 年门面改骑楼，2021 年修缮。'),
    E('E-002', '徐家大院（拆分前合院）', '1997 年分户拆分为东、西护厝两个独立产权与使用单元；本实体仅保留 1997 年前身份。', '1997-04-10T00:00:00.000Z', '1920-01-01', '1997-04-10'),
    E('E-003', '徐家大院·东护厝', '1997 年自徐家大院分出，沿主门牌 7 号；徐氏后人居住。', '1997-04-10T00:00:00.000Z', '1997-04-10', null),
    E('E-004', '徐家大院·西护厝（长兴茶栈）', '1997 年自徐家大院分出，编 7-1 号（2006 年改 9 号）。', '1997-04-10T00:00:00.000Z', '1997-04-10', null),
    E('E-005', '望江茶园旧址', '骑楼铺面；年代、风格与坐标均存在多来源矛盾，见证据面板。'),
    E('E-006', '林氏宗祠', '传统宗祠殿堂，中开间抬梁构，2015 年重修。'),
    E('E-007', '德记布行旧址', '民国骑楼布行，2018 年修缮后作为书屋使用。'),
    E('E-008', '义和糖仓遗址', '夯土糖仓，墙体残损，仅可外观或预约进入。'),
    E('E-009', '槐安旅社', '1962 年改建的集体旅社，2003 年改造为民宿。')
  ];

  // 门牌号 = 时段别名（不新建建筑实体）
  const A = (id, entityId, number, validFrom, validTo, sourceId, extra = {}) =>
    ({ id, entityId, number, validFrom, validTo: validTo || null, sourceId,
       recordedAt: extra.recordedAt || '2019-11-20T00:00:00.000Z',
       withdrawn: !!extra.withdrawn, withdrawnAt: extra.withdrawnAt || null,
       note: extra.note || '' });
  d.aliases = [
    A('A-101', 'E-001', '槐安街18号', '1912-01-01', '1949-01-01', 'S1', { note: '1948 地籍清册登记' }),
    A('A-102', 'E-001', '中山街112号', '1949-01-01', '1998-01-01', 'S2', { note: '道路一度更名中山街' }),
    A('A-103', 'E-001', '槐安街12号', '1998-01-01', null, 'S4'),
    A('A-201', 'E-002', '槐安街7号', '1920-01-01', '1997-04-10', 'S2', { note: '合院整院时期' }),
    A('A-301', 'E-003', '槐安街7号', '1997-04-10', null, 'S4', { note: '拆分后东护厝沿用主门牌' }),
    A('A-401', 'E-004', '槐安街7-1号', '1997-04-10', '2006-03-01', 'S2'),
    A('A-402', 'E-004', '槐安街9号', '2006-03-01', null, 'S4'),
    A('A-501', 'E-005', '槐安街22号', '1933-01-01', '2006-03-01', 'S1'),
    A('A-502', 'E-005', '槐安街20号', '2006-03-01', null, 'S4'),
    A('A-601', 'E-006', '槐安街26号', '1860-01-01', null, 'S3'),
    A('A-701', 'E-007', '槐安街3号', '1928-01-01', null, 'S3'),
    // 一条被撤回的错误门牌转录（曾写入普查草稿，2020 年更正撤回）
    A('A-702', 'E-007', '槐安街5号', '2018-01-01', null, 'S2',
      { withdrawn: true, withdrawnAt: '2020-05-06T00:00:00.000Z', note: '转录错误，5 号实为对面建筑', recordedAt: '2019-12-02T00:00:00.000Z' }),
    A('A-801', 'E-008', '槐安街31号', '1925-01-01', null, 'S3'),
    A('A-901', 'E-009', '槐安街35号', '1962-01-01', null, 'S2')
  ];

  // 属性陈述（多来源；年代/风格/状态冲突全部保留）
  const C = (id, entityId, attr, value, sourceId, recordedAt, validFrom, validTo = null) =>
    ({ id, entityId, attr, value, sourceId, recordedAt, validFrom: validFrom || null, validTo, withdrawn: false });
  d.claims = [
    // E-001：年代小冲突（三普 1892 vs 口述 1887），状态随时间改变
    C('C-101', 'E-001', 'yearBuilt', 1892, 'S3', '2019-11-20T00:00:00.000Z'),
    C('C-102', 'E-001', 'yearBuilt', 1887, 'S5', '2017-09-10T00:00:00.000Z'),
    C('C-103', 'E-001', 'style', 'minnan-redbrick', 'S3', '2019-11-20T00:00:00.000Z'),
    C('C-104', 'E-001', 'status', 'weathered', 'S3', '2019-11-20T00:00:00.000Z', null, '2021-11-30'),
    C('C-105', 'E-001', 'status', 'restored', 'S9', '2021-11-30T00:00:00.000Z', '2021-11-30', null),
    // E-005：年代与风格的强冲突
    C('C-501', 'E-005', 'yearBuilt', 1908, 'S7', '2015-02-11T00:00:00.000Z', null, null),
    C('C-502', 'E-005', 'yearBuilt', 1933, 'S3', '2019-11-20T00:00:00.000Z', null, null),
    C('C-503', 'E-005', 'yearBuilt', 1899, 'S8', '2009-08-01T00:00:00.000Z', null, null),
    C('C-504', 'E-005', 'style', 'colonial-arcade', 'S3', '2019-11-20T00:00:00.000Z', null, null),
    C('C-505', 'E-005', 'style', 'qianqi-shikumen', 'S8', '2009-08-01T00:00:00.000Z', null, null),
    C('C-506', 'E-005', 'status', 'fair', 'S4', '2024-05-18T00:00:00.000Z', null, null),
    // E-002 / E-003 / E-004
    C('C-201', 'E-002', 'yearBuilt', 1920, 'S2', '1982-07-01T00:00:00.000Z'),
    C('C-202', 'E-002', 'style', 'courtyard-residence', 'S3', '2019-11-20T00:00:00.000Z'),
    C('C-203', 'E-002', 'status', 'fair', 'S3', '2019-11-20T00:00:00.000Z', null, '1997-04-10'),
    C('C-301', 'E-003', 'yearBuilt', 1920, 'S5', '2017-09-10T00:00:00.000Z'),
    C('C-302', 'E-003', 'style', 'courtyard-residence', 'S4', '2024-05-18T00:00:00.000Z'),
    C('C-303', 'E-003', 'status', 'fair', 'S4', '2024-05-18T00:00:00.000Z'),
    C('C-401', 'E-004', 'style', 'courtyard-residence', 'S4', '2024-05-18T00:00:00.000Z'),
    C('C-402', 'E-004', 'status', 'adapted', 'S4', '2024-05-18T00:00:00.000Z', null, null),
    // E-006
    C('C-601', 'E-006', 'yearBuilt', 1768, 'S3', '2019-11-20T00:00:00.000Z'),
    C('C-602', 'E-006', 'yearBuilt', 1772, 'S7', '2015-02-11T00:00:00.000Z'),
    C('C-603', 'E-006', 'style', 'traditional-hall', 'S3', '2019-11-20T00:00:00.000Z'),
    C('C-604', 'E-006', 'status', 'restored', 'S9', '2015-09-01T00:00:00.000Z', '2015-09-01', null),
    // E-007
    C('C-701', 'E-007', 'yearBuilt', 1928, 'S3', '2019-11-20T00:00:00.000Z'),
    C('C-702', 'E-007', 'style', 'qianqi-shikumen', 'S3', '2019-11-20T00:00:00.000Z'),
    C('C-703', 'E-007', 'status', 'restored', 'S9', '2018-10-20T00:00:00.000Z', '2018-10-20', null),
    // E-008
    C('C-801', 'E-008', 'yearBuilt', 1925, 'S3', '2019-11-20T00:00:00.000Z'),
    C('C-802', 'E-008', 'style', 'minnan-redbrick', 'S3', '2019-11-20T00:00:00.000Z'),
    C('C-803', 'E-008', 'status', 'ruin', 'S4', '2024-05-18T00:00:00.000Z'),
    // E-009
    C('C-901', 'E-009', 'yearBuilt', 1962, 'S2', '1982-07-01T00:00:00.000Z'),
    C('C-902', 'E-009', 'style', 'qianqi-shikumen', 'S4', '2024-05-18T00:00:00.000Z'),
    C('C-903', 'E-009', 'status', 'adapted', 'S4', '2003-06-01T00:00:00.000Z', '2003-06-01', null)
  ];

  d.events = [
    { id: 'V-001', entityId: 'E-001', kind: 'adaptation', date: '1953-08-12', title: '门面改砖砌骑楼', detail: '酱园停办后沿街面加建骑楼柱廊，女儿墙为此时所加。', sourceId: 'S5', recordedAt: '2017-09-10T00:00:00.000Z', withdrawn: false },
    { id: 'V-002', entityId: 'E-001', kind: 'repair', date: '2021-06-20', title: '屋面与木构修缮', detail: '更换朽坏桷木 37 根，重做滴水瓦，保留红砖墙身。', sourceId: 'S9', recordedAt: '2021-11-30T00:00:00.000Z', withdrawn: false },
    { id: 'V-003', entityId: 'E-002', kind: 'split', date: '1997-04-10', title: '合院分户拆分', detail: '产权析产：东护厝（E-003）沿用 7 号，西护厝（E-004）编 7-1 号。原合院身份止于本日。', sourceId: 'S2', recordedAt: '1997-04-10T00:00:00.000Z', withdrawn: false },
    { id: 'V-004', entityId: 'E-006', kind: 'repair', date: '2015-08-01', title: '宗祠重修', detail: '抬梁构架落架大修，神龛原样保留。', sourceId: 'S9', recordedAt: '2015-09-01T00:00:00.000Z', withdrawn: false },
    { id: 'V-005', entityId: 'E-003', kind: 'repair', date: '2026-09-28', title: '护厝木构件检修（院门临时关闭）', detail: '检修期间东护厝院门关闭，预计 10 月 12 日恢复。', sourceId: 'S9', recordedAt: '2026-09-27T09:00:00.000Z', withdrawn: false }
  ];

  // 空间边界：E-005 同时保留清册报错点位与纠偏边界
  const F = (id, entityId, center, sourceId, kind, recordedAt, extra = {}) =>
    ({ id, entityId, ring: ring(center, extra.dx ?? 0.00016, extra.dy ?? 0.00012), point: center,
       sourceId, kind, recordedAt, supersedes: extra.supersedes || null,
       note: extra.note || '', withdrawn: !!extra.withdrawn, withdrawnAt: extra.withdrawnAt || null });
  d.footprints = [
    F('FP-1', 'E-001', [118.0841, 24.5628], 'S4', 'surveyed', '2024-05-18T00:00:00.000Z'),
    F('FP-2', 'E-002', [118.0852, 24.5625], 'S1', 'reported', '1948-03-01T00:00:00.000Z', { dx: 0.00034, dy: 0.00022, note: '整院范围（含东西护厝）', validTo: '1997-04-10' }),
    F('FP-3', 'E-003', [118.08546, 24.56256], 'S4', 'surveyed', '2024-05-18T00:00:00.000Z'),
    F('FP-4', 'E-004', [118.08498, 24.56236], 'S4', 'surveyed', '2024-05-18T00:00:00.000Z'),
    F('FP-5-OLD', 'E-005', [118.08718, 24.56158], 'S1', 'reported', '1948-03-01T00:00:00.000Z',
      { note: '清册点位相对实测向东南偏移约 72 米', withdrawn: true, withdrawnAt: '2024-05-18T00:00:00.000Z' }),
    F('FP-5', 'E-005', [118.0866, 24.5621], 'S4', 'surveyed-corrected', '2024-05-18T00:00:00.000Z',
      { supersedes: 'FP-5-OLD', note: '依据骑楼柱网与界墙实测纠偏' }),
    F('FP-6', 'E-006', [118.0879, 24.5617], 'S4', 'surveyed', '2024-05-18T00:00:00.000Z'),
    F('FP-7', 'E-007', [118.083, 24.5632], 'S4', 'surveyed', '2024-05-18T00:00:00.000Z'),
    F('FP-8', 'E-008', [118.0891, 24.5612], 'S3', 'reported', '2019-11-20T00:00:00.000Z', { note: '残墙范围，未精测' }),
    F('FP-9', 'E-009', [118.0901, 24.5608], 'S4', 'surveyed', '2024-05-18T00:00:00.000Z')
  ];

  // 入口（entityId=null 为街门）
  d.entrances = [
    { id: 'EN-S1', entityId: null, label: '东街门（石牌坊）', point: [118.0905, 24.5606] },
    { id: 'EN-S2', entityId: null, label: '西街门（巷口）', point: [118.0824, 24.5634] },
    { id: 'EN-1', entityId: 'E-001', label: '荣盛酱园正门', point: [118.08406, 24.5627] },
    { id: 'EN-3', entityId: 'E-003', label: '东护厝院门', point: [118.08552, 24.56248] },
    { id: 'EN-5', entityId: 'E-005', label: '望江茶园侧门', point: [118.08652, 24.56206] },
    { id: 'EN-8', entityId: 'E-008', label: '糖仓遗址入口', point: [118.08902, 24.56114] }
  ];
  // weekdayHours: 0(周日)..6(周六)，"HH:MM-HH:MM"；null 表示当天不开放
  const H918 = ['09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00'];
  d.entrancePeriods = [
    { id: 'EP-S1-A', entranceId: 'EN-S1', state: 'open', validFrom: null, validTo: '2026-09-28', weekdayHours: ['08:00-20:00', '08:00-20:00', '08:00-20:00', '08:00-20:00', '08:00-20:00', '08:00-20:00', '08:00-20:00'], note: '', sourceId: 'S4' },
    { id: 'EP-S1-B', entranceId: 'EN-S1', state: 'closed', validFrom: '2026-09-29', validTo: '2026-10-04', weekdayHours: H918, note: '石牌坊梁柱检修，东街门临时封闭', sourceId: 'S9' },
    { id: 'EP-S1-C', entranceId: 'EN-S1', state: 'open', validFrom: '2026-10-04', validTo: null, weekdayHours: ['08:00-20:00', '08:00-20:00', '08:00-20:00', '08:00-20:00', '08:00-20:00', '08:00-20:00', '08:00-20:00'], note: '', sourceId: 'S4' },
    { id: 'EP-S2', entranceId: 'EN-S2', state: 'open', validFrom: null, validTo: null, weekdayHours: ['08:00-20:00', '08:00-20:00', '08:00-20:00', '08:00-20:00', '08:00-20:00', '08:00-20:00', '08:00-20:00'], note: '', sourceId: 'S4' },
    { id: 'EP-1', entranceId: 'EN-1', state: 'open', validFrom: null, validTo: null, weekdayHours: H918, note: '', sourceId: 'S4' },
    { id: 'EP-3', entranceId: 'EN-3', state: 'closed', validFrom: '2026-09-28', validTo: '2026-10-13', weekdayHours: H918, note: '护厝木构件检修，院门关闭；不等于街区关闭', sourceId: 'S9' },
    { id: 'EP-5', entranceId: 'EN-5', state: 'open', validFrom: null, validTo: null, weekdayHours: ['10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00', '10:00-22:00'], note: '现作为茶室营业', sourceId: 'S4' },
    { id: 'EP-8', entranceId: 'EN-8', state: 'restricted', validFrom: null, validTo: null, weekdayHours: ['09:00-16:00', null, '09:00-16:00', '09:00-16:00', '09:00-16:00', '09:00-16:00', '09:00-16:00'], note: '残墙加固中，需提前 1 日预约；周一闭园', sourceId: 'S9' }
  ];

  // 照片：保留拍摄朝向、估计位置与不确定度
  d.photos = [
    { id: 'P-001', entityId: 'E-001', takenAt: '1935-05-01', bearingDegrees: 182,
      estimatedLocation: [118.08418, 24.56272], locationUncertaintyM: 12,
      file: '/images/p001.svg', caption: '荣盛酱园门脸（1935 年明信片）', sourceId: 'S6',
      recordedAt: '2016-04-02T00:00:00.000Z', withdrawn: false, era: 'historical' },
    { id: 'P-002', entityId: 'E-001', takenAt: '2023-11-09', bearingDegrees: 8,
      estimatedLocation: [118.08408, 24.5627], locationUncertaintyM: 3,
      file: '/images/p002.svg', caption: '修缮后正立面现状', sourceId: 'S4',
      recordedAt: '2023-11-10T00:00:00.000Z', withdrawn: false, era: 'modern' },
    { id: 'P-003', entityId: 'E-005', takenAt: '1948-02-14', bearingDegrees: 95,
      estimatedLocation: [118.08724, 24.56154], locationUncertaintyM: 28,
      file: '/images/p003.jpg', caption: '望江茶园骑楼（档案注记位置存疑）', sourceId: 'S6',
      recordedAt: '2016-04-02T00:00:00.000Z', withdrawn: false, era: 'historical', fileMissing: true },
    { id: 'P-004', entityId: 'E-006', takenAt: '2019-10-02', bearingDegrees: 200,
      estimatedLocation: [118.08786, 24.56176], locationUncertaintyM: 4,
      file: '/images/p004.svg', caption: '林氏宗祠正殿', sourceId: 'S3',
      recordedAt: '2019-10-05T00:00:00.000Z', withdrawn: false, era: 'modern' },
    { id: 'P-005', entityId: 'E-009', takenAt: '1972-08-01', bearingDegrees: 0,
      estimatedLocation: [118.09005, 24.56074], locationUncertaintyM: 10,
      file: '/images/p005.svg', caption: '槐安旅社开业十年留影', sourceId: 'S2',
      recordedAt: '1982-07-01T00:00:00.000Z', withdrawn: false, era: 'historical' }
  ];

  // 历史照片 ↔ 立面：候选对应，默认 pending，绝不自动认定
  d.photoMatches = [
    { id: 'M-001', photoId: 'P-001', entityId: 'E-001', facade: '正立面（南向）', status: 'pending', confidence: 0.62,
      note: '一层柱间距与现存一致；二层女儿墙为 1953 年后加，照片中尚无，符合 1935 年时间线。', decidedBy: null, recordedAt: '2024-06-01T00:00:00.000Z' },
    { id: 'M-002', photoId: 'P-001', entityId: 'E-001', facade: '东厢山墙面', status: 'pending', confidence: 0.34,
      note: '仅山墙阶形轮廓相似，开间数对不上。', decidedBy: null, recordedAt: '2024-06-01T00:00:00.000Z' },
    { id: 'M-003', photoId: 'P-002', entityId: 'E-001', facade: '正立面（南向）', status: 'confirmed', confidence: 0.97,
      note: '实测正射影像配准。', decidedBy: '2024 测绘组', recordedAt: '2024-06-03T00:00:00.000Z' },
    { id: 'M-004', photoId: 'P-003', entityId: 'E-005', facade: '骑楼正立面', status: 'pending', confidence: 0.55,
      note: '柱式相似；但档案标注位置（清册点）已被纠偏，拍摄点可能不在该立面轴线上。', decidedBy: null, recordedAt: '2024-06-04T00:00:00.000Z' },
    { id: 'M-005', photoId: 'P-003', entityId: 'E-005', facade: '北翼山墙面', status: 'pending', confidence: 0.42,
      note: '朝向 95° 更接近北翼，但骑楼元素无法解释。', decidedBy: null, recordedAt: '2024-06-04T00:00:00.000Z' },
    { id: 'M-006', photoId: 'P-004', entityId: 'E-006', facade: '正殿立面', status: 'confirmed', confidence: 0.95,
      note: '现场核对。', decidedBy: '2024 测绘组', recordedAt: '2019-10-06T00:00:00.000Z' }
  ];

  // 谱系关系：split/merge
  d.relations = [
    { id: 'R-001', kind: 'split', fromEntityId: 'E-002', toEntityIds: ['E-003', 'E-004'], date: '1997-04-10',
      note: '析产分户；东护厝沿用主门牌，西护厝另编号。子女实体不继承整院单一身份。', recordedAt: '1997-04-10T00:00:00.000Z' }
  ];

  return d;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  persist();
  console.log('seeded ->', new Date().toISOString());
}
