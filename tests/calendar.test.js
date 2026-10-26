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

test('calendar filters keep events, records, and to-dos distinct without changing monthly totals', () => {
  const state = M.newState();
  event(state, { type: 'once', date: '2026-01-01', time: '09:00', endTime: '17:00' });
  record(state, '2026-01-01T08:00:00.000Z', '2026-01-01T08:30:00.000Z');
  M.createTask(state, { name: 'Take creatine', kind: 'routine', schedule: { type: 'daily', startDate: '2026-01-01' } }, now);
  const saved = JSON.stringify(state);
  const all = C.buildData(state, '2026-01-01', '2026-01-31', '2026-01-01');
  const events = C.buildData(state, '2026-01-01', '2026-01-31', '2026-01-01', {filter: 'events'});
  const records = C.buildData(state, '2026-01-01', '2026-01-31', '2026-01-01', {filter: 'records'});
  assert.deepEqual(all.selected.items.map(item => item.type).sort(), ['event', 'record', 'task']);
  assert.deepEqual(events.selected.items.map(item => item.type), ['event']);
  assert.deepEqual(records.selected.items.map(item => item.type), ['record']);
  assert.equal(events.monthMatches, 1);
  assert.deepEqual(events.metrics, all.metrics);
  assert.deepEqual(records.metrics, all.metrics);
  assert.equal(JSON.stringify(state), saved);
});

test('calendar search matches multiple words across names, locations, and notes, ignoring accents and case', () => {
  const state = M.newState();
  event(state, { type: 'once', date: '2026-01-01', time: '09:00' }, {name: 'Doctor appointment', location: 'Café clinic', note: 'Bring insurance card'});
  event(state, { type: 'once', date: '2026-01-03', time: '10:00' }, {name: 'Doctor appointment', location: 'Another clinic', note: 'Consultation'});
  const selected = C.buildData(state, '2026-01-01', '2026-01-31', '2026-01-01', {filter: 'events', query: '  DOCTOR  cafe Insurance  '});
  assert.equal(selected.selected.items.length, 1);
  assert.equal(selected.monthMatches, 1);
  assert.equal(selected.days.find(day => day.date === '2026-01-03').items.length, 0);
  assert.equal(selected.metrics.events, 2);
  const otherDate = C.buildData(state, '2026-01-03', '2026-01-31', '2026-01-01', {query: 'insurance'});
  assert.equal(otherDate.selected.items.length, 0);
  assert.equal(otherDate.monthMatches, 1);
  assert.equal(otherDate.selected.date, '2026-01-03');
});

test('filtered empty days invite changing filters and keep full-month totals clearly labeled', () => {
  const container = {innerHTML: ''};
  C.render(container, {state: M.newState(), selected: '2026-01-01', today: '2026-01-31', filter: 'records', query: '<script>alert(1)</script>'});
  assert.ok(container.innerHTML.includes('No matching items.'));
  assert.ok(container.innerHTML.includes('0 matches this month'));
  assert.ok(container.innerHTML.includes('FULL MONTH'));
  assert.ok(!container.innerHTML.includes('A little open space.'));
  assert.ok(!container.innerHTML.includes('<script>'));
  assert.ok(container.innerHTML.includes('&lt;script&gt;'));
});

test('same-day calendar refresh preserves agenda scroll, but changing date or filters starts at the top', () => {
  let agenda = {dataset: {date: '2026-01-01', filter: 'all', query: ''}, scrollTop: 245};
  const container = {
    get innerHTML() { return ''; },
    set innerHTML(_) { agenda = {dataset: {}, scrollTop: 0}; },
    querySelector() { return agenda; }
  };
  const options = {state: M.newState(), selected: '2026-01-01', today: '2026-01-31'};
  C.render(container, options);
  assert.equal(agenda.scrollTop, 245);
  agenda.dataset = {date: '2026-01-01', filter: 'all', query: ''};
  C.render(container, {...options, filter: 'events'});
  assert.equal(agenda.scrollTop, 0);
  agenda.dataset = {date: '2026-01-01', filter: 'all', query: ''};
  agenda.scrollTop = 245;
  C.render(container, {...options, selected: '2026-01-02'});
  assert.equal(agenda.scrollTop, 0);
});

test('calendar boundary months stay inside supported dates', () => {
  const first = C.buildData(M.newState(), '0001-01-01', '2026-01-31', '0001-01-01');
  assert.equal(first.days[0].date, '0001-01-01');
  const last = C.buildData(M.newState(), '9999-12-31', '2026-01-31', '9999-12-01');
  assert.equal(last.days.at(-1).date, '9999-12-31');
  assert.throws(() => C.shiftMonth('0001-01-01', -1));
});
