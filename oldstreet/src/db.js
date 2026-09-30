// 零依赖 JSON 文档库 + 双时间（有效时间 / 系统事务时间）谓词
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_FILE = path.join(__dirname, '..', 'data', 'oldstreet.json');
export let DATA_FILE = DEFAULT_DATA_FILE;
export function getDataFile() { return DATA_FILE; }
export function setDataFile(file) { DATA_FILE = file; _db = null; }

export const EMPTY_DB = () => ({
  meta: { siteName: '', siteEntranceIds: [], center: [118.086, 24.562] },
  sources: [],
  entities: [],            // 稳定实体，亦可带有效时间（拆分后父实体身份止于拆分日）
  aliases: [],          // 门牌号 = 带有效时间的别名（编号沿革），非实体
  claims: [],           // 多来源属性陈述（年代/风格/状态…），冲突并存
  events: [],           // 修缮/改建/灾害等事件
  footprints: [],       // 空间边界（版本化，含纠偏依据）
  entrances: [],        // 入口（entityId=null 表示街门）
  entrancePeriods: [],  // 入口开放时段
  photos: [],
  photoMatches: [],     // 历史照片↔立面 候选对应（不自动认定）
  relations: [],        // split / merge 谱系
  audits: []
});

export function loadDB(file) {
  file = file || DATA_FILE;
  if (!fs.existsSync(file)) return EMPTY_DB();
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

let _db = null;
export function db(file) {
  if (!_db) _db = loadDB(file);
  return _db;
}
export function resetDB(file = DATA_FILE) { _db = loadDB(file); }

let writeTimer = null;
export function persist(file) {
  file = file || DATA_FILE;
  // 同步写入，保证脚本退出前落盘
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(db(file), null, 2));
}
export function schedulePersist(file) {
  file = file || DATA_FILE;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => persist(file), 50);
}

// ---------- 时间 ----------
export function nowTs() { return new Date().toISOString(); }
export function dayOf(ts) {
  if (!ts) return null;
  return ts.length >= 10 ? ts.slice(0, 10) : ts;
}
export function tsAt(dayOrTs, endOfDay = false) {
  const d = dayOf(dayOrTs);
  return endOfDay ? `${d}T23:59:59.999Z` : `${d}T00:00:00.000Z`;
}
// 半开区间有效：from <= asOf(日) < to
export function validAt(rec, asOfDay) {
  const a = dayOf(asOfDay);
  if (rec.validFrom && rec.validFrom > a) return false;
  if (rec.validTo && !(a < rec.validTo)) return false;
  return true;
}
// 系统事务时间可见：recordedAt <= snapshotAt < withdrawnAt
export function recTs(rec) { return rec.recordedAt || rec.createdAt || '0000-01-01T00:00:00.000Z'; }
// 双时间事务谓词：记录在 snapshotTs 时点是否“在世”
//  - 记录时间晚于快照：尚不存在
//  - 撤回时间不晚于快照：已撤回（即使带 withdrawn 标志，撤回时间之前的历史快照仍可见）
export function aliveAt(rec, snapshotTs) {
  if (recTs(rec) > snapshotTs) return false;
  const wat = rec.withdrawnAt;
  if (wat && wat <= snapshotTs) return false;
  return true;
}

// ---------- ID ----------
let seq = 0;
export function newId(prefix) {
  seq += 1;
  const t = process.hrtime.bigint().toString(36);
  return `${prefix}-${t}${seq.toString(36)}`;
}

export function audit(d, actor, action, targetType, targetId, detail = {}) {
  d.audits.push({ ts: nowTs(), actor, action, targetType, targetId, detail });
}

// ---------- 年代桶（受控词表） ----------
export const ERA_BUCKETS = [
  { id: 'ming-before', label: '明代及以前', test: (y) => y <= 1644 },
  { id: 'early-qing', label: '清早期（1644–1735）', test: (y) => y >= 1645 && y <= 1735 },
  { id: 'mid-qing', label: '清中期（1736–1850）', test: (y) => y >= 1736 && y <= 1850 },
  { id: 'late-qing', label: '清晚期（1851–1911）', test: (y) => y >= 1851 && y <= 1911 },
  { id: 'republic', label: '民国（1912–1949）', test: (y) => y >= 1912 && y <= 1949 },
  { id: 'prc-early', label: '建国初（1950–1978）', test: (y) => y >= 1950 && y <= 1978 },
  { id: 'modern', label: '1979以后', test: (y) => y >= 1979 }
];
export function eraOfYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return null;
  return (ERA_BUCKETS.find((b) => b.test(y)) || {}).id || null;
}

export const STYLE_VOCAB = [
  { id: 'minnan-redbrick', label: '闽南红砖' },
  { id: 'qianqi-shikumen', label: '前骑楼' },
  { id: 'colonial-arcade', label: '殖民式骑楼' },
  { id: 'traditional-hall', label: '传统宗祠殿堂' },
  { id: 'courtyard-residence', label: '合院民居' }
];
export const STATUS_VOCAB = [
  { id: 'original', label: '原状' },
  { id: 'fair', label: '基本完好' },
  { id: 'weathered', label: '风化残损' },
  { id: 'restored', label: '已修缮' },
  { id: 'adapted', label: '改造使用' },
  { id: 'ruin', label: '遗址/濒危' }
];
export const vocabLabel = (vocab, id) => (vocab.find((v) => v.id === id) || {}).label || id;
