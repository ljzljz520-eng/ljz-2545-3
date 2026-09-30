// 重新生成种子数据并落盘
import fs from 'node:fs';
import { seedDB } from './seed.js';
import { DATA_FILE } from './db.js';

const d = seedDB();
fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
console.log('seeded ->', DATA_FILE);
