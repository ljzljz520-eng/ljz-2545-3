import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { seedDB } from '../src/seed.js';
import * as repo from '../src/repo.js';
import * as admin from '../src/admin.js';

let d;
beforeEach(() => { d = seedDB(); });

test('改号时即使旧别名未封口（区间重叠），也取生效起始最晚的门牌', () => {
  admin.addAlias(d, { entityId: 'E-007', number: '槐安街3-1号', validFrom: '2027-01-01', validTo: null, sourceId: 'S4' }, 't');
  const v = repo.entityView(d, 'E-007', '2027-06-01', '2028-01-01T00:00:00Z');
  assert.equal(v.numberAt, '槐安街3-1号');
  // 旧日期仍取旧号
  assert.equal(repo.entityView(d, 'E-007', '2026-01-01', '2028-01-01T00:00:00Z').numberAt, '槐安街3号');
});

test('被撤回的门牌转录在其撤回时间之后的快照中不再参与索引（但旧快照仍在）', () => {
  // A-702 recordedAt 2019-12-02 withdrawnAt 2020-05-06
  const old = repo.entityView(d, 'E-007', '2020-01-01', '2020-02-01T00:00:00Z');
  const fresh = repo.entityView(d, 'E-007', '2020-01-01', '2021-01-01T00:00:00Z');
  // 2020-01 当日同时存在 3 号与错误的 5 号：旧快照里取起始更晚的错误号（历史原貌保留）
  assert.equal(old.numberAt, '槐安街5号');
  // 撤回后错误号消失，回落到 3 号
  assert.equal(fresh.numberAt, '槐安街3号');
  assert.ok(fresh.numberHistory.some((a) => a.withdrawn && a.number === '槐安街5号'));
});
