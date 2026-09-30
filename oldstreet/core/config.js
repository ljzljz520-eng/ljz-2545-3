// 全局配置：时间、分页、存储路径
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(ROOT, 'uploads');
export const EVENT_LOG = path.join(DATA_DIR, 'events.jsonl');
export const PUBLIC_DIR = path.join(ROOT, 'public');

// 系统“当前时间”。演示与测试可通过环境变量固定，保证可复现。
export const NOW = process.env.OS_NOW ? new Date(process.env.OS_NOW) : new Date('2026-09-30T12:00:00+08:00');

export const PAGE_SIZE_DEFAULT = 4;
export const PAGE_SIZE_MAX = 100;

// 建筑年代分桶（按“采纳年份”落入区间）
export const ERA_BUCKETS = [
  { key: 'qing',  label: '清代 (-1911)',     from: -9999, to: 1911 },
  { key: 'min',   label: '民国 (1912-1948)', from: 1912,  to: 1948 },
  { key: 'prc',   label: '建国后 (1949-1999)', from: 1949, to: 1999 },
  { key: 'modern',label: '当代 (2000-)',     from: 2000,  to: 9999 },
];

export const PRESERVATION = ['intact', 'good', 'fair', 'poor', 'ruin'];
export const PRESERVATION_LABEL = {
  intact: '完好', good: '较好', fair: '一般', poor: '较差', ruin: '遗址',
};

export const STYLE_TAGS = ['chuandou', 'brick-wood', 'stone', 'colonial', 'modern', 'reinforced'];
export const STYLE_LABEL = {
  'chuandou': '穿斗木构', 'brick-wood': '砖木混合', 'stone': '石构',
  'colonial': '骑楼/殖民风', 'modern': '现代改建', 'reinforced': '砖混加固',
};

export function iso(d) { return new Date(d).toISOString(); }
