'use strict';
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../model.js');
const C = require('../calendar.js');
const now = new Date('2026-01-31T23:00:00Z');
function event(state, schedule, rest = {}) {
  return M.createTask(state, { name: 'Work', kind: 'event', tracking: 'none', color: '#55786a', schedule, ...rest }, new Date('2026-01-01T00:00:00Z'));
}
function record(state, start, end) {
  return M.createManualEntry(state, { title: 'Reading', tracking: 'timer', startAt: start, startOffset: 0, endAt: end, endOffset: 0 }, now);
}

test('month navigation handles year boundaries without day overflow', () => {
  assert.equal(C.monthStart('2024-02-29'), '2024-02-01');
  assert.equal(C.shiftMonth('2026-01-31', 1), '2026-02-01');
  assert.equal(C.shiftMonth('2026-01-31', -1), '2025-12-01');
  assert.throws(() => C.shiftMonth('9999-12-01', 1));
  assert.throws(() => C.monthStart('2025-02-29'));
});

test('month grid begins Monday and includes all six weeks', () => {
  const data = C.buildData(M.newState(), '2026-01-15', '2026-01-31', '2026-01-01');
  assert.equal(data.days.length, 42);
  assert.equal(data.days[0].date, '2025-12-29');
  assert.equal(data.days.at(-1).date, '2026-02-08');
  assert.equal(data.selected.date, '2026-01-15');
});

test('planned totals clip overnight events to the displayed month and exclude all-day time', () => {
  const state = M.newState();
  event(state, { type: 'once', date: '2025-12-31', time: '22:00', endTime: '06:00', endNextDay: true });
  event(state, { type: 'once', date: '2026-01-31', time: '22:00', endTime: '06:00', endNextDay: true });
  event(state, { type: 'once', date: '2026-01-04', time: '' }, { name: 'Holiday' });
  const data = C.buildData(state, '2026-01-01', '2026-01-31', '2026-01-01');
  assert.equal(data.metrics.plannedMinutes, 8 * 60);
  assert.equal(data.metrics.events, 2);
  assert.equal(data.metrics.recordedMs, 0);
  assert.equal(data.selected.items[0].time, '00:00–06:00');
  assert.equal(data.selected.items[0].occurrenceDate, '2025-12-31');
});

test('recorded totals use actual timer duration separately from scheduled events', () => {
  const state = M.newState();
  event(state, { type: 'once', date: '2026-01-01', time: '09:00', endTime: '17:00' });
  record(state, '2025-12-31T23:00:00.000Z', '2026-01-01T01:00:00.000Z');
  record(state, '2026-01-02T10:00:00.000Z', '2026-01-02T11:30:00.000Z');
  M.logEntry(state, 'A walk', new Date('2026-01-02T12:00:00Z'));
  const data = C.buildData(state, '2026-01-01', '2026-01-31', '2026-01-01');
  assert.equal(data.metrics.plannedMinutes, 480);
  assert.equal(data.metrics.recordedMs, 150 * 60000);
  assert.equal(data.metrics.recordedDays, 2);
});

test('a fulfilled plan appears as the actual record, including completion on another date', () => {
  const state = M.newState();
  const task = M.createTask(state, { name: 'Dentist form', kind: 'planned', color: '#cc6655', schedule: { date: '2026-01-01', time: '09:00' } }, new Date('2026-01-01T00:00:00Z'));
  M.completeTask(state, task.id, new Date('2026-01-02T10:00:00Z'));
  const data = C.buildData(state, '2026-01-02', '2026-01-31', '2026-01-01');
  assert.equal(data.days.find(day => day.date === '2026-01-01').items.length, 0);
  assert.equal(data.selected.items.length, 1);
  assert.equal(data.selected.items[0].type, 'record');
  assert.equal(data.selected.items[0].color, '#cc6655');
});

test('skipped recurring events are absent and event details are safely escaped', () => {
  const state = M.newState();
  const task = event(state, { type: 'daily', startDate: '2026-01-01', time: '09:00', untilDate: '2026-01-03' }, { name: '<img src=x>', note: '" details & more', location: '<Clinic>' });
  M.skipEvent(state, task.id, '2026-01-02');
  const container = { innerHTML: '' };
  const data = C.render(container, { state, selected: '2026-01-01', today: '2026-01-31', month: '2026-01-01' });
  assert.equal(data.metrics.events, 2);
  assert.equal(data.days.find(day => day.date === '2026-01-02').items.length, 0);
  assert.ok(container.innerHTML.includes('&lt;img src=x&gt;'));
  assert.ok(container.innerHTML.includes('&lt;Clinic&gt;'));
  assert.ok(!container.innerHTML.includes('<img src=x>'));
  assert.ok(container.innerHTML.includes('data-action="edit-event"'));
  assert.ok(!container.innerHTML.includes('data-action="complete"'));
});


test('rescheduling an already fulfilled one-time task does not create another to-do', () => {
  const state = M.newState();
  const task = M.createTask(state, { name: 'A form', kind: 'planned', schedule: { date: '2026-01-01' } }, new Date('2026-01-01T00:00:00Z'));
  M.completeTask(state, task.id, new Date('2026-01-02T10:00:00Z'));
  M.updateTask(state, task.id, { schedule: { date: '2026-01-03' } }, now);
  const data = C.buildData(state, '2026-01-03', '2026-01-31', '2026-01-01');
  assert.equal(data.selected.items.length, 0);
});
