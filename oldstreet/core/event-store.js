// 事件溯源存储：append-only JSONL。
// 每个领域变更都是一条不可变事件；撤回 = 追加一条 retraction 事件（墓碑），
// 而不是就地删除。由此可在任意 (recordedAt, validAt) 时刻重建一致快照，
// 也能完整复现实体的变更历史。
import fs from 'node:fs';
import path from 'node:path';
import { EVENT_LOG, DATA_DIR, iso } from './config.js';

let seq = 0;
function nextSeq() { return ++seq; }

export function ensureLog(file = EVENT_LOG) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, '');
}

// 读取全部事件（含撤回标记，reducer 负责过滤）
export function readEvents(file = EVENT_LOG) {
  ensureLog(file);
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (t) out.push(JSON.parse(t));
  }
  return out;
}

export function appendEvent(type, data, opts = {}, file = EVENT_LOG) {
  ensureLog(file);
  const ev = {
    id: 'ev_' + String(nextSeq()).padStart(6, '0') + '_' + Math.random().toString(36).slice(2, 8),
    seq: nextSeq(),
    type,
    data,
    // recordedAt: 事实进入数据库的时间（系统时间，事实层）
    recordedAt: opts.recordedAt || iso(new Date()),
    // recordedBy: 录入来源/操作员
    recordedBy: opts.recordedBy || 'system',
  };
  fs.appendFileSync(file, JSON.stringify(ev) + '\n');
  return ev;
}

// 撤回某条事件：追加 retraction，逻辑生效于其 recordedAt。
export function retract(eventId, reason, opts = {}, file = EVENT_LOG) {
  return appendEvent('event.retracted', { targetEventId: eventId, reason }, opts, file);
}

// 计算在某系统时刻 asOf 仍“可见”的事件集合（撤回在该时刻已生效则排除）。
export function visibleEvents(events, asOf) {
  const asOfMs = new Date(asOf).getTime();
  const retractedAt = new Map(); // eventId -> 最早生效的撤回时间ms
  for (const e of events) {
    if (e.type === 'event.retracted' && new Date(e.recordedAt).getTime() <= asOfMs) {
      const t = e.data.targetEventId;
      const ms = new Date(e.recordedAt).getTime();
      if (!retractedAt.has(t) || ms < retractedAt.get(t)) retractedAt.set(t, ms);
    }
  }
  return events.filter((e) => {
    if (new Date(e.recordedAt).getTime() > asOfMs) return false; // 尚未录入
    const r = retractedAt.get(e.id);
    if (r === undefined) return true;
    return new Date(e.recordedAt).getTime() > r; // 先撤后录的事件保持撤回
  });
}

export function resetStore(file = EVENT_LOG) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, '');
}
