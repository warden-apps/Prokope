'use strict';
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const M = require('../model.js');

const at = (iso) => new Date(iso);
const start = at('2026-01-01T09:00:00Z');
function routine(state, overrides = {}) {
  return M.createTask(state, {
    name: 'Take creatine', kind: 'routine', tracking: 'check',
    schedule: { type: 'daily', startDate: '2026-01-01' }, ...overrides
  }, start);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

test('calendar arithmetic handles year boundaries and leap days', () => {
  assert.equal(M.localDate(at('2026-01-01T00:00:00Z')), '2026-01-01');
  assert.equal(M.addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(M.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(M.addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(M.addDays('2025-02-28', 1), '2025-03-01');
});

test('daily schedules begin on the selected start day', () => {
  const state = M.newState();
  const task = routine(state);
  assert.equal(M.isDue(task, '2025-12-31'), false);
  assert.equal(M.isDue(task, '2026-01-01'), true);
  assert.equal(M.isDue(task, '2026-01-02'), true);
  assert.ok(M.tasksForDate(state, '2026-01-02').some(t => t.id === task.id));
  assert.ok(M.scheduleLabel(task).length > 0);
});

test('weekday schedules honor selected weekdays and the start date', () => {
  const task = routine(M.newState(), { schedule: { type: 'weekdays', startDate: '2026-01-05', weekdays: [1, 3, 5] } });
  assert.equal(M.isDue(task, '2026-01-02'), false);
  assert.equal(M.isDue(task, '2026-01-05'), true);
  assert.equal(M.isDue(task, '2026-01-06'), false);
  assert.equal(M.isDue(task, '2026-01-07'), true);
  assert.equal(M.isDue(task, '2026-01-09'), true);
  assert.equal(M.isDue(task, '2026-01-11'), false);
});

test('interval schedules are anchored to a date rather than last completion', () => {
  const state = M.newState();
  const task = routine(state, { schedule: { type: 'interval', startDate: '2026-01-01', interval: 2 } });
  assert.equal(M.isDue(task, '2026-01-01'), true);
  assert.equal(M.isDue(task, '2026-01-02'), false);
  assert.equal(M.isDue(task, '2026-01-03'), true);
  M.completeTask(state, task.id, at('2026-01-03T12:00:00Z'));
  assert.equal(M.isDue(task, '2026-01-05'), true);
  assert.equal(M.isDue(task, '2026-01-06'), false);
});

test('interval schedules and addDays remain correct across daylight saving changes', () => {
  const modulePath = path.resolve(__dirname, '../model.js');
  const script = `const assert=require('node:assert/strict');const M=require(${JSON.stringify(modulePath)});const s=M.newState();const t=M.createTask(s,{name:'Run',kind:'routine',tracking:'check',schedule:{type:'interval',startDate:'2026-03-07',interval:2}},new Date('2026-03-07T12:00:00'));assert.equal(M.isDue(t,'2026-03-09'),true);assert.equal(M.isDue(t,'2026-03-08'),false);assert.equal(M.addDays('2026-03-08',1),'2026-03-09');assert.equal(M.addDays('2026-11-01',1),'2026-11-02');assert.equal(M.localDate(new Date('2026-03-08T04:30:00Z')),'2026-03-07');`;
  execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'America/New_York' } });
});

test('monthly day 31 skips shorter months instead of rolling into the next month', () => {
  const task = routine(M.newState(), { schedule: { type: 'monthly', startDate: '2026-01-01', monthDay: 31 } });
  assert.equal(M.isDue(task, '2026-01-31'), true);
  assert.equal(M.isDue(task, '2026-02-28'), false);
  assert.equal(M.isDue(task, '2026-03-01'), false);
  assert.equal(M.isDue(task, '2026-03-31'), true);
  assert.equal(M.isDue(task, '2026-04-30'), false);
});

test('monthly schedules support February 29 in leap years', () => {
  const task = routine(M.newState(), { schedule: { type: 'monthly', startDate: '2024-01-01', monthDay: 29 } });
  assert.equal(M.isDue(task, '2024-02-29'), true);
  assert.equal(M.isDue(task, '2025-02-28'), false);
});

test('completion records the actual instant and cannot be duplicated for a routine day', () => {
  const state = M.newState();
  const task = routine(state);
  const entry = M.completeTask(state, task.id, at('2026-01-01T00:00:00Z'));
  assert.equal(entry.title, 'Take creatine');
  assert.equal(entry.startAt, '2026-01-01T00:00:00.000Z');
  assert.equal(entry.endAt, entry.startAt);
  assert.equal(entry.date, '2026-01-01');
  assert.equal(M.isCompleted(state, task.id, '2026-01-01'), true);
  assert.equal(M.isCompleted(state, task.id, '2026-01-02'), false);
  assert.throws(() => M.completeTask(state, task.id, at('2026-01-01T12:00:00Z')));
  M.completeTask(state, task.id, at('2026-01-02T12:00:00Z'));
  assert.equal(state.entries.length, 2);
});

test('one-time plans retain their scheduled date and actual overdue completion time', () => {
  const state = M.newState();
  const task = M.createTask(state, { name: 'Dentist', kind: 'planned', tracking: 'check', schedule: { type: 'once', date: '2026-01-02', time: '09:30' } }, start);
  assert.equal(M.isDue(task, '2026-01-02'), true);
  assert.equal(M.isDue(task, '2026-01-03'), false);
  const entry = M.completeTask(state, task.id, at('2026-01-03T11:00:00Z'), '2026-01-02');
  assert.equal(entry.occurrenceDate, '2026-01-02');
  assert.equal(entry.date, '2026-01-03');
  assert.equal(M.isCompleted(state, task.id, '2026-01-02'), true);
  assert.throws(() => M.completeTask(state, task.id, at('2026-01-04T11:00:00Z'), '2026-01-02'));
});

test('optional check activities can be logged several times in one day', () => {
  const state = M.newState();
  const task = M.createTask(state, { name: 'Read a page', kind: 'optional', tracking: 'check' }, start);
  M.completeTask(state, task.id, at('2026-01-01T12:00:00Z'));
  M.completeTask(state, task.id, at('2026-01-01T15:00:00Z'));
  assert.equal(state.entries.length, 2);
});

test('timers survive serialization and finish with a recorded end time', () => {
  const state = M.newState();
  const task = M.createTask(state, { name: 'Read a book', kind: 'optional', tracking: 'timer' }, start);
  const entry = M.startTask(state, task.id, at('2026-01-01T12:00:00Z'));
  assert.equal(entry.endAt, null);
  assert.equal(M.activeEntries(state).length, 1);
  assert.throws(() => M.startTask(state, task.id, at('2026-01-01T12:01:00Z')));
  const restored = clone(state);
  assert.equal(M.validateState(restored), true);
  const finished = M.finishEntry(restored, entry.id, at('2026-01-01T12:45:00Z'));
  assert.equal(finished.endAt, '2026-01-01T12:45:00.000Z');
  assert.equal(new Date(finished.endAt) - new Date(finished.startAt), 45 * 60 * 1000);
  assert.equal(M.activeEntries(restored).length, 0);
  assert.throws(() => M.finishEntry(restored, entry.id, at('2026-01-01T13:00:00Z')));
});

test('a timer crossing midnight appears on both affected dates', () => {
  const state = M.newState();
  const task = M.createTask(state, { name: 'Late reading', kind: 'optional', tracking: 'timer' }, start);
  const entry = M.startTask(state, task.id, at('2026-01-01T23:50:00Z'));
  M.finishEntry(state, entry.id, at('2026-01-02T00:20:00Z'));
  assert.equal(entry.date, '2026-01-01');
  assert.equal(entry.endDate, '2026-01-02');
  assert.ok(M.entriesForDate(state, '2026-01-01').some(e => e.id === entry.id));
  assert.ok(M.entriesForDate(state, '2026-01-02').some(e => e.id === entry.id));
  assert.equal(M.entriesForDate(state, '2026-01-03').length, 0);
});

test('finishing before a timer starts is rejected without losing the active timer', () => {
  const state = M.newState();
  const task = M.createTask(state, { name: 'Read', kind: 'optional', tracking: 'timer' }, start);
  const entry = M.startTask(state, task.id, at('2026-01-01T12:00:00Z'));
  assert.throws(() => M.finishEntry(state, entry.id, at('2026-01-01T11:59:00Z')));
  assert.equal(entry.endAt, null);
});

test('quick logs stamp the time and remain independent of an activity definition', () => {
  const state = M.newState();
  const entry = M.logEntry(state, 'Walked to the park', at('2026-01-01T17:14:22Z'));
  assert.equal(entry.taskId, null);
  assert.equal(entry.title, 'Walked to the park');
  assert.equal(entry.startAt, '2026-01-01T17:14:22.000Z');
  assert.equal(entry.endAt, entry.startAt);
  M.deleteEntry(state, entry.id);
  assert.equal(state.entries.length, 0);
});

test('editing and archiving activities preserves historical log titles and dates', () => {
  const state = M.newState();
  const task = routine(state);
  const entry = M.completeTask(state, task.id, at('2026-01-01T12:00:00Z'));
  M.updateTask(state, task.id, { name: 'Take supplement', kind: 'routine', tracking: 'check', schedule: { type: 'daily', startDate: '2026-01-01' } }, at('2026-01-02T10:00:00Z'));
  assert.equal(entry.title, 'Take creatine');
  M.archiveTask(state, task.id, at('2026-01-03T10:00:00Z'));
  assert.equal(M.isDue(state.tasks[0], '2026-01-02'), true);
  assert.equal(M.isDue(state.tasks[0], '2026-01-03'), false);
  assert.equal(state.entries.length, 1);
  M.restoreTask(state, task.id, at('2026-01-04T10:00:00Z'));
  assert.equal(M.isDue(state.tasks[0], '2026-01-04'), true);
});

test('deleting a mistaken completion allows that routine to be completed again', () => {
  const state = M.newState();
  const task = routine(state);
  const first = M.completeTask(state, task.id, at('2026-01-01T12:00:00Z'));
  M.deleteEntry(state, first.id);
  assert.equal(M.isCompleted(state, task.id, '2026-01-01'), false);
  M.completeTask(state, task.id, at('2026-01-01T12:10:00Z'));
  assert.equal(state.entries.length, 1);
});

test('invalid names, recurrence settings, and dates do not mutate state', () => {
  const state = M.newState();
  for (const input of [
    { name: '   ', kind: 'optional', tracking: 'check' },
    { name: 'Bad date', kind: 'planned', tracking: 'check', schedule: { type: 'once', date: '2026-02-30' } },
    { name: 'Bad interval', kind: 'routine', tracking: 'check', schedule: { type: 'interval', startDate: '2026-01-01', interval: 0 } },
    { name: 'No weekdays', kind: 'routine', tracking: 'check', schedule: { type: 'weekdays', startDate: '2026-01-01', weekdays: [] } },
    { name: 'Bad monthly day', kind: 'routine', tracking: 'check', schedule: { type: 'monthly', startDate: '2026-01-01', monthDay: 32 } }
  ]) assert.throws(() => M.createTask(state, input, start));
  assert.equal(state.tasks.length, 0);
});

test('backup validation accepts an ordinary round trip and rejects corrupted structures', () => {
  const state = M.newState();
  const task = routine(state);
  M.completeTask(state, task.id, at('2026-01-01T12:00:00Z'));
  assert.equal(M.validateState(clone(state)), true);
  assert.equal(M.validateState(null), false);
  assert.equal(M.validateState({ version: 99, tasks: [], entries: [] }), false);
  const badDate = clone(state);
  badDate.tasks[0].schedule.startDate = '2026-02-30';
  assert.equal(M.validateState(badDate), false);
  const duplicateTask = clone(state);
  duplicateTask.tasks.push(clone(duplicateTask.tasks[0]));
  assert.equal(M.validateState(duplicateTask), false);
  const duplicateEntry = clone(state);
  duplicateEntry.entries.push(clone(duplicateEntry.entries[0]));
  assert.equal(M.validateState(duplicateEntry), false);
  const badReference = clone(state);
  badReference.entries[0].taskId = 'missing-task';
  assert.equal(M.validateState(badReference), false);
  const negativeDuration = clone(state);
  negativeDuration.entries[0].endAt = '2026-01-01T11:59:00.000Z';
  assert.equal(M.validateState(negativeDuration), false);
  const malicious = JSON.parse('{"version":1,"tasks":[],"entries":[],"__proto__":{"polluted":true}}');
  assert.equal(M.validateState(malicious), false);
  assert.equal({}.polluted, undefined);
});

test('future occurrences and unscheduled routine days cannot be recorded', () => {
  const state = M.newState();
  const task = routine(state, { schedule: { type: 'interval', startDate: '2026-01-01', interval: 2 } });
  assert.throws(() => M.completeTask(state, task.id, at('2026-01-02T12:00:00Z')));
  assert.throws(() => M.completeTask(state, task.id, at('2026-01-01T12:00:00Z'), '2026-01-03'));
  assert.equal(state.entries.length, 0);
});

test('captured timezone offsets keep history valid after changing timezones', () => {
  const modulePath = path.resolve(__dirname, '../model.js');
  const script = `const M=require(${JSON.stringify(modulePath)});const s=M.newState();M.logEntry(s,'Midnight creatine',new Date('2026-01-01T15:00:00Z'));process.stdout.write(JSON.stringify(s));`;
  const state = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'Asia/Tokyo' }, encoding: 'utf8' }));
  assert.equal(state.entries[0].startOffset, -540);
  assert.equal(state.entries[0].endOffset, -540);
  assert.equal(state.entries[0].date, '2026-01-02');
  assert.equal(state.entries[0].startAt, '2026-01-01T15:00:00.000Z');
  assert.equal(M.validateState(state), true);
  assert.equal(M.entriesForDate(state, '2026-01-02').length, 1);
  const corrupted = clone(state);
  corrupted.entries[0].startOffset = 0;
  assert.equal(M.validateState(corrupted), false);
});

test('a still-running overnight timer remains visible in today’s timeline', () => {
  const today = M.localDate();
  const yesterday = M.addDays(today, -1);
  const state = M.newState();
  const task = M.createTask(state, { name: 'Long reading', kind: 'optional', tracking: 'timer' }, at(yesterday + 'T12:00:00Z'));
  const entry = M.startTask(state, task.id, at(yesterday + 'T23:50:00Z'));
  assert.ok(M.entriesForDate(state, yesterday).some(e => e.id === entry.id));
  assert.ok(M.entriesForDate(state, today).some(e => e.id === entry.id));
  assert.equal(M.entriesForDate(state, M.addDays(today, 1)).length, 0);
});

test('changing a routine into a one-time plan keeps prior logs and allows its new occurrence once', () => {
  const state = M.newState();
  const task = routine(state);
  const prior = M.completeTask(state, task.id, at('2026-01-01T12:00:00Z'));
  M.updateTask(state, task.id, { name: 'One last supplement', kind: 'planned', tracking: 'check', schedule: { type: 'once', date: '2026-01-02' } }, at('2026-01-01T14:00:00Z'));
  const planned = M.completeTask(state, task.id, at('2026-01-02T12:00:00Z'));
  assert.equal(prior.kind, 'routine');
  assert.equal(prior.title, 'Take creatine');
  assert.equal(planned.kind, 'planned');
  assert.equal(planned.title, 'One last supplement');
  assert.equal(M.validateState(clone(state)), true);
  M.updateTask(state, task.id, { schedule: { type: 'once', date: '2026-01-03' } }, at('2026-01-02T14:00:00Z'));
  assert.throws(() => M.completeTask(state, task.id, at('2026-01-03T12:00:00Z')));
  assert.equal(state.entries.length, 2);
  assert.equal(M.validateState(clone(state)), true);
});
