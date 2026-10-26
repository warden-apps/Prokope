'use strict';
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const T = require('../timeline.js');
const M = 60000;

function entry(startAt, endAt, options = {}) {
  const startOffset = options.startOffset === undefined ? 0 : options.startOffset;
  const endOffset = options.endOffset === undefined ? startOffset : options.endOffset;
  const localDay = (at, offset) => new Date(Date.parse(at) - offset * M).toISOString().slice(0, 10);
  return { id: 'activity', tracking: 'timer', startAt, endAt,
    date: localDay(startAt, startOffset), endDate: endAt === null ? null : localDay(endAt, endOffset),
    startOffset, endOffset: endAt === null ? null : endOffset, ...options };
}

test('24-hour clock distinguishes midnight, noon, and the last minute', () => {
  assert.equal(T.clock24('2026-10-25T00:00:00Z', 0), '00:00');
  assert.equal(T.clock24('2026-10-25T12:00:00Z', 0), '12:00');
  assert.equal(T.clock24('2026-10-25T23:59:59Z', 0), '23:59');
  assert.equal(T.clock24('2026-10-24T15:00:00Z', -540), '00:00');
  assert.equal(T.minutesAt('2026-10-25T12:34:30.500Z', 0), 754.5 + .5 / 60);
});

test('an instant action keeps its exact recorded minute on its recorded day only', () => {
  const action = entry('2026-10-24T15:00:00Z', '2026-10-24T15:00:00Z', { tracking: 'check', startOffset: -540 });
  const part = T.segment(action, '2026-10-25');
  assert.equal(part.startMinute, 0);
  assert.equal(part.endMinute, 0);
  assert.equal(part.point, true);
  assert.equal(part.durationMs, 0);
  assert.equal(T.segment(action, '2026-10-24'), null);
  assert.equal(T.segment(action, '2026-10-26'), null);
});

test('a normal timed block preserves start, finish, and actual duration', () => {
  const activity = entry('2026-10-25T09:10:00Z', '2026-10-25T09:55:00Z');
  const part = T.segment(activity, '2026-10-25');
  assert.deepEqual([part.startMinute, part.endMinute, part.durationMs], [550, 595, 45 * M]);
  assert.equal(part.clockShift, false);
  assert.equal(part.running, false);
  assert.equal(T.segment(activity, '2026-10-24'), null);
});

test('an overnight activity is clipped at 24:00 and resumes at 00:00', () => {
  const activity = entry('2026-10-25T23:40:00Z', '2026-10-26T00:20:00Z');
  const first = T.segment(activity, '2026-10-25');
  const next = T.segment(activity, '2026-10-26');
  assert.deepEqual([first.startMinute, first.endMinute, first.durationMs], [1420, 1440, 20 * M]);
  assert.deepEqual([next.startMinute, next.endMinute, next.durationMs], [0, 20, 20 * M]);
  assert.equal(first.continuesAfter, true);
  assert.equal(first.continuesBefore, false);
  assert.equal(next.continuesBefore, true);
  assert.equal(next.continuesAfter, false);
});

test('a finish at midnight does not add an empty activity to the next day', () => {
  const activity = entry('2026-10-25T23:30:00Z', '2026-10-26T00:00:00Z');
  assert.equal(T.segment(activity, '2026-10-25').endMinute, 1440);
  assert.equal(T.segment(activity, '2026-10-26'), null);
  assert.equal(T.dayDuration([activity], '2026-10-25'), 30 * M);
  assert.equal(T.dayDuration([activity], '2026-10-26'), 0);
});

test('multi-day timers partition their entire elapsed duration without duplication', () => {
  const activity = entry('2026-10-24T23:00:00Z', '2026-10-27T01:00:00Z');
  const parts = ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'].map(date => T.segment(activity, date));
  assert.deepEqual(parts.map(part => part.durationMs / M), [60, 1440, 1440, 60]);
  assert.equal(parts.reduce((sum, part) => sum + part.durationMs, 0), Date.parse(activity.endAt) - Date.parse(activity.startAt));
  assert.equal(T.segment(activity, '2026-10-28'), null);
});

test('an active timer grows with now, including a new day, but never enters a future day', () => {
  const activity = entry('2026-10-25T23:45:00Z', null);
  const early = T.segment(activity, '2026-10-25', '2026-10-25T23:50:00Z');
  const later = T.segment(activity, '2026-10-25', '2026-10-25T23:59:00Z');
  assert.equal(early.endMinute, 1430);
  assert.equal(later.endMinute, 1439);
  assert.equal(later.durationMs, 14 * M);
  assert.equal(later.running, true);
  assert.equal(T.segment(activity, '2026-10-26', '2026-10-25T23:59:00Z'), null);
  const next = T.segment(activity, '2026-10-26', '2026-10-26T00:15:00Z');
  assert.deepEqual([next.startMinute, next.endMinute, next.durationMs], [0, 15, 15 * M]);
  assert.equal(T.segment(activity, '2026-10-25', '2026-10-25T23:40:00Z'), null);
});

test('saved positions and durations do not shift when history is read in another timezone', () => {
  const modulePath = path.resolve(__dirname, '../timeline.js');
  const activity = entry('2026-10-24T16:00:00Z', '2026-10-24T17:00:00Z', { startOffset: -540 });
  const script = `const T=require(${JSON.stringify(modulePath)}); const e=${JSON.stringify(activity)}; process.stdout.write(JSON.stringify({part:T.segment(e,'2026-10-25'),time:T.clock24(e.startAt,e.startOffset),total:T.dayDuration([e],'2026-10-25')}));`;
  const output = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'America/New_York' } }).toString());
  assert.equal(output.time, '01:00');
  assert.equal(output.part.startMinute, 60);
  assert.equal(output.part.endMinute, 120);
  assert.equal(output.total, 60 * M);
});

test('spring-forward clock gaps retain actual elapsed time and flag the changed clock', () => {
  const activity = entry('2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z', { startOffset: 300, endOffset: 240 });
  const part = T.segment(activity, '2026-03-08');
  assert.deepEqual([part.startMinute, part.endMinute], [90, 210]);
  assert.equal(part.durationMs, 60 * M);
  assert.equal(part.clockShift, true);
});

test('fall-back clock repetition never creates a negative timer block', () => {
  const activity = entry('2026-11-01T05:50:00Z', '2026-11-01T06:10:00Z', { startOffset: 240, endOffset: 300 });
  const part = T.segment(activity, '2026-11-01');
  assert.equal(part.startMinute, 110);
  assert.ok(part.endMinute > part.startMinute);
  assert.equal(part.durationMs, 20 * M);
  assert.equal(part.clockShift, true);
  assert.equal(T.clock24(activity.endAt, activity.endOffset), '01:10');
});

test('timezone changes across multiple days keep the total duration exact', () => {
  const activity = entry('2026-03-07T23:00:00Z', '2026-03-09T07:00:00Z', { startOffset: 300, endOffset: 240 });
  const totals = ['2026-03-07', '2026-03-08', '2026-03-09'].map(day => T.dayDuration([activity], day));
  assert.equal(totals.reduce((sum, value) => sum + value, 0), Date.parse(activity.endAt) - Date.parse(activity.startAt));
  assert.ok(totals.every(value => value >= 0));
});

test('crossing the date line shows endpoints and counts duration only once', () => {
  const activity = entry('2026-10-25T16:00:00Z', '2026-10-25T18:00:00Z', { startOffset: -540, endOffset: 600 });
  assert.equal(activity.date, '2026-10-26');
  assert.equal(activity.endDate, '2026-10-25');
  const start = T.segment(activity, '2026-10-26');
  const end = T.segment(activity, '2026-10-25');
  assert.equal(start.clockShift, true);
  assert.equal(end.clockShift, true);
  assert.equal(start.durationMs + end.durationMs, 120 * M);
});

test('simultaneous actions get separate lanes without moving their exact timestamps', () => {
  const items = ['a', 'b', 'c'].map(id => ({ id, startMinute: 720, endMinute: 720, point: true }));
  const copy = JSON.stringify(items), arranged = T.layout(items);
  assert.equal(new Set(arranged.map(item => item.lane)).size, 3);
  assert.ok(arranged.every(item => item.lanes === 3 && item.startMinute === 720 && item.displayStart === 720));
  assert.equal(JSON.stringify(items), copy);
});

test('overlapping timers reuse free lanes and later independent groups regain full width', () => {
  const arranged = T.layout([
    { id: 'long', startMinute: 540, endMinute: 660 },
    { id: 'first', startMinute: 550, endMinute: 590 },
    { id: 'second', startMinute: 600, endMinute: 640 },
    { id: 'later', startMinute: 720, endMinute: 760 }
  ]);
  const byId = Object.fromEntries(arranged.map(item => [item.id, item]));
  assert.equal(byId.first.lane, byId.second.lane);
  assert.notEqual(byId.long.lane, byId.first.lane);
  assert.equal(byId.long.lanes, 2);
  assert.equal(byId.second.lanes, 2);
  assert.equal(byId.later.lanes, 1);
});

test('late-night short cards remain inside the day without altering their event anchors', () => {
  const arranged = T.layout([
    { id: 'last', startMinute: 1439.5, endMinute: 1439.5, point: true },
    { id: 'nearby', startMinute: 1420, endMinute: 1430 }
  ], 40);
  assert.ok(arranged.every(item => item.displayStart >= 0 && item.displayEnd <= 1440 && item.displayEnd - item.displayStart >= 40));
  assert.equal(arranged.find(item => item.id === 'last').startMinute, 1439.5);
  assert.equal(arranged.find(item => item.id === 'last').displayEnd, 1440);
  assert.equal(new Set(arranged.map(item => item.lane)).size, 2);
});

test('day totals ignore instant records and include only the selected part of timers', () => {
  const entries = [
    entry('2026-10-25T10:00:00Z', '2026-10-25T10:30:00Z'),
    entry('2026-10-25T23:45:00Z', '2026-10-26T00:30:00Z'),
    entry('2026-10-25T13:00:00Z', '2026-10-25T13:00:00Z', { tracking: 'check' })
  ];
  assert.equal(T.dayDuration(entries, '2026-10-25'), 45 * M);
  assert.equal(T.dayDuration(entries, '2026-10-26'), 30 * M);
});
