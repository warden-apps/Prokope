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
function event(state, overrides = {}) {
  return M.createTask(state, {
    name: 'Work', kind: 'event', tracking: 'none', color: '#55786a',
    schedule: { type: 'daily', startDate: '2026-01-01', time: '09:00', endTime: '17:00' }, ...overrides
  }, start);
}

test('calendar arithmetic handles year boundaries and leap days', () => {
  assert.equal(M.localDate(at('2026-01-01T00:00:00Z')), '2026-01-01');
  assert.equal(M.addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(M.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(M.addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(M.addDays('2025-02-28', 1), '2025-03-01');
});

test('calendar events need no completion and never create recorded activity entries', () => {
  const state = M.newState();
  const task = event(state);
  assert.equal(task.tracking, 'none');
  assert.equal(task.note, '');
  assert.equal(task.location, '');
  assert.equal(M.tasksForDate(state, '2026-01-01')[0].id, task.id);
  assert.throws(() => M.completeTask(state, task.id, start), /without completion/);
  assert.throws(() => M.startTask(state, task.id, start), /without completion/);
  assert.equal(state.entries.length, 0);
  assert.equal(M.isCompleted(state, task.id, '2026-01-01'), false);
  assert.equal(M.validateState(clone(state)), true);
});

test('an appointment has a date, details, color and exact timed span', () => {
  const state = M.newState();
  const task = event(state, {
    name: 'Doctor', color: '#8844aa', note: ' Bring test results. ', location: ' Clinic 2 ',
    schedule: { type: 'once', date: '2026-02-12', time: '14:30', endTime: '15:15' }
  });
  assert.equal(task.note, 'Bring test results.');
  assert.equal(task.location, 'Clinic 2');
  const [occurrence] = M.eventOccurrencesForDate(state, '2026-02-12');
  assert.equal(occurrence.task.id, task.id);
  assert.equal(occurrence.startMinute, 870);
  assert.equal(occurrence.endMinute, 915);
  assert.equal(occurrence.point, false);
  assert.equal(occurrence.allDay, false);
  assert.equal(M.eventOccurrencesForDate(state, '2026-02-13').length, 0);
});

test('all-day events and point markers remain distinct', () => {
  const state = M.newState();
  event(state, { name: 'Holiday', schedule: { type: 'once', date: '2026-01-01' } });
  event(state, { name: 'Wake up', schedule: { type: 'daily', startDate: '2026-01-01', time: '07:00' } });
  const [allDay, point] = M.eventOccurrencesForDate(state, '2026-01-01');
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.point, false);
  assert.equal(allDay.startMinute, 0);
  assert.equal(allDay.endMinute, 1440);
  assert.equal(point.allDay, false);
  assert.equal(point.point, true);
  assert.equal(point.startMinute, 420);
  assert.equal(point.endMinute, 420);
});

test('event repeats honor weekdays, intervals, month dates and inclusive end dates', () => {
  const state = M.newState();
  const weekly = event(state, { schedule: { type: 'weekdays', startDate: '2026-01-05', weekdays: [1, 3, 5], untilDate: '2026-01-09' } });
  assert.equal(M.isDue(weekly, '2026-01-05'), true);
  assert.equal(M.isDue(weekly, '2026-01-06'), false);
  assert.equal(M.isDue(weekly, '2026-01-09'), true);
  assert.equal(M.isDue(weekly, '2026-01-12'), false);
  const interval = event(state, { schedule: { type: 'interval', startDate: '2026-01-01', interval: 2 } });
  assert.equal(M.isDue(interval, '2026-01-03'), true);
  assert.equal(M.isDue(interval, '2026-01-04'), false);
  const monthly = event(state, { schedule: { type: 'monthly', startDate: '2026-01-01', monthDay: 31 } });
  assert.equal(M.isDue(monthly, '2026-02-28'), false);
  assert.equal(M.isDue(monthly, '2026-03-31'), true);
});

test('skipping and restoring one event occurrence preserves its repeating series', () => {
  const state = M.newState();
  const task = event(state);
  M.skipEvent(state, task.id, '2026-01-02');
  assert.equal(M.isDue(task, '2026-01-02'), false);
  assert.equal(M.tasksForDate(state, '2026-01-02').length, 0);
  assert.equal(M.eventOccurrencesForDate(state, '2026-01-02').length, 0);
  assert.equal(M.isDue(task, '2026-01-03'), true);
  M.skipEvent(state, task.id, '2026-01-02');
  assert.deepEqual(task.excludedDates, ['2026-01-02']);
  assert.equal(M.validateState(clone(state)), true);
  M.restoreEventOccurrence(state, task.id, '2026-01-02');
  assert.equal(M.isDue(task, '2026-01-02'), true);
  assert.throws(() => M.skipEvent(state, task.id, '2025-12-31'));
  const ordinary = routine(state);
  assert.throws(() => M.skipEvent(state, ordinary.id, '2026-01-02'));
});

test('overnight events split across months and keep the origin date for exclusions and end dates', () => {
  const state = M.newState();
  const task = event(state, { schedule: { type: 'daily', startDate: '2026-01-31', time: '22:30', endTime: '06:45', endNextDay: true, untilDate: '2026-01-31' } });
  const [first] = M.eventOccurrencesForDate(state, '2026-01-31');
  const [tail] = M.eventOccurrencesForDate(state, '2026-02-01');
  assert.equal(first.startMinute, 1350);
  assert.equal(first.endMinute, 1440);
  assert.equal(first.continuesAfter, true);
  assert.equal(tail.startMinute, 0);
  assert.equal(tail.endMinute, 405);
  assert.equal(tail.occurrenceDate, '2026-01-31');
  assert.equal(tail.continuesBefore, true);
  assert.equal(M.eventOccurrencesForDate(state, '2026-02-02').length, 0);
  M.skipEvent(state, task.id, '2026-01-31');
  assert.equal(M.eventOccurrencesForDate(state, '2026-01-31').length, 0);
  assert.equal(M.eventOccurrencesForDate(state, '2026-02-01').length, 0);
});

test('midnight endings have no phantom next-day event and daily nights retain separate occurrences', () => {
  const state = M.newState();
  event(state, { schedule: { type: 'once', date: '2026-01-01', time: '20:00', endTime: '00:00', endNextDay: true } });
  assert.equal(M.eventOccurrencesForDate(state, '2026-01-01')[0].endMinute, 1440);
  assert.equal(M.eventOccurrencesForDate(state, '2026-01-02').length, 0);
  const sleep = event(state, { schedule: { type: 'daily', startDate: '2026-01-01', time: '23:00', endTime: '07:00', endNextDay: true } });
  const pieces = M.eventOccurrencesForDate(state, '2026-01-02').filter(o => o.task.id === sleep.id);
  assert.deepEqual(pieces.map(o => o.occurrenceDate), ['2026-01-01', '2026-01-02']);
  assert.deepEqual(pieces.map(o => [o.startMinute, o.endMinute]), [[0, 420], [1380, 1440]]);
});

test('event occurrences handle the first valid date without underflow and 24-hour durations', () => {
  const state = M.newState();
  event(state, { schedule: { type: 'once', date: '0001-01-01', time: '12:00', endTime: '12:00', endNextDay: true } });
  assert.equal(M.eventOccurrencesForDate(state, '0001-01-01').length, 1);
  assert.equal(M.eventOccurrencesForDate(state, '0001-01-02')[0].endMinute, 720);
});

test('archiving an event retains past occurrences and the tail of the previous night', () => {
  const state = M.newState();
  const task = event(state, { schedule: { type: 'daily', startDate: '2026-01-01', time: '22:00', endTime: '06:00', endNextDay: true } });
  M.archiveTask(state, task.id, at('2026-01-03T12:00:00Z'));
  assert.equal(M.isDue(task, '2026-01-02'), true);
  assert.equal(M.isDue(task, '2026-01-03'), false);
  assert.equal(M.eventOccurrencesForDate(state, '2026-01-03').length, 1);
  assert.equal(M.eventOccurrencesForDate(state, '2026-01-03')[0].occurrenceDate, '2026-01-02');
  assert.equal(M.eventOccurrencesForDate(state, '2026-01-04').length, 0);
});

test('invalid event schedules and metadata never partially change saved state', () => {
  const state = M.newState();
  const good = event(state);
  const before = clone(state);
  for (const input of [
    { tracking: 'check' }, { tracking: 'timer' }, { color: 'red' }, { color: '#abc' },
    { note: 'x'.repeat(1001) }, { location: 'x'.repeat(161) }, { excludedDates: ['2026-02-30'] },
    { schedule: { type: 'optional' } }, { schedule: { untilDate: '2025-12-31' } },
    { schedule: { type: 'once', date: '2026-01-01', untilDate: '2026-01-03' } },
    { schedule: { time: '', endTime: '12:00' } }, { schedule: { endTime: '', endNextDay: true } },
    { schedule: { endNextDay: 'yes' } }, { schedule: { time: '09:00', endTime: '09:00' } },
    { schedule: { time: '18:00', endTime: '08:00' } },
    { schedule: { time: '09:00', endTime: '17:00', endNextDay: true } }
  ]) {
    assert.throws(() => M.updateTask(state, good.id, input, start), JSON.stringify(input));
    assert.deepEqual(state, before);
  }
});

test('event backup validation rejects malformed fields while old activity backups stay valid', () => {
  const state = M.newState();
  const old = routine(state);
  M.completeTask(state, old.id, start);
  assert.equal('color' in old, false);
  assert.equal('color' in state.entries[0], false);
  assert.equal(M.validateState(clone(state)), true);
  event(state);
  assert.equal(M.validateState(clone(state)), true);
  for (const mutate of [
    t => { t.color = 'url(javascript:bad)'; }, t => { t.excludedDates = ['bad']; },
    t => { t.tracking = 'check'; }, t => { t.schedule.endNextDay = true; },
    t => { t.location = 'x'.repeat(161); }, t => { t.schedule.untilDate = '2025-12-31'; }
  ]) {
    const bad = clone(state);
    mutate(bad.tasks[1]);
    assert.equal(M.validateState(bad), false);
  }
});

test('record colors are snapshots independent of later task edits and can be corrected', () => {
  const state = M.newState();
  const task = routine(state, { color: '#4455aa' });
  const entry = M.completeTask(state, task.id, start);
  M.updateTask(state, task.id, { color: '#aa5544' }, start);
  assert.equal(entry.color, '#4455aa');
  M.updateEntry(state, entry.id, { note: 'Keep the original color' }, start);
  assert.equal(entry.color, '#4455aa');
  M.updateEntry(state, entry.id, { color: '#99aa55' }, start);
  assert.equal(entry.color, '#99aa55');
  assert.equal(task.color, '#aa5544');
  assert.throws(() => M.updateEntry(state, entry.id, { color: 'bad' }, start));
  const bad = clone(state);
  bad.entries[0].color = 'bad';
  assert.equal(M.validateState(bad), false);
  assert.equal(M.validateState(clone(state)), true);
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

test('a timer ending at captured local midnight does not create a record on the next day', () => {
  for (const offset of [0, -540, 330]) {
    const state = M.newState();
    const finish = Date.parse('2026-01-02T00:00:00Z') + offset * 60000;
    const entry = M.createManualEntry(state, {
      title: 'Late reading', tracking: 'timer',
      startAt: new Date(finish - 30 * 60000).toISOString(), startOffset: offset,
      endAt: new Date(finish).toISOString(), endOffset: offset
    }, at('2026-01-04T00:00:00Z'));
    assert.equal(M.entriesForDate(state, '2026-01-01')[0].id, entry.id);
    assert.equal(M.entriesForDate(state, '2026-01-02').length, 0);
    M.updateEntry(state, entry.id, { endAt: new Date(finish + 1).toISOString() }, at('2026-01-04T00:00:00Z'));
    assert.equal(M.entriesForDate(state, '2026-01-02')[0].id, entry.id, 'even one millisecond belongs to the finish day');
  }
});

test('midnight actions, timers starting at midnight and date-line endpoints remain visible', () => {
  const state = M.newState();
  const instant = M.createManualEntry(state, {
    title: 'Midnight action', tracking: 'check', startAt: '2026-01-02T00:00:00.000Z', startOffset: 0
  }, at('2026-01-04T00:00:00Z'));
  const zeroTimer = M.createManualEntry(state, {
    title: 'Midnight timer', tracking: 'timer', startAt: '2026-01-02T00:00:00.000Z', startOffset: 0,
    endAt: '2026-01-02T00:00:00.000Z', endOffset: 0
  }, at('2026-01-04T00:00:00Z'));
  const travel = M.createManualEntry(state, {
    title: 'Date-line travel', tracking: 'timer', startAt: '2026-01-02T10:00:00.000Z', startOffset: -840,
    endAt: '2026-01-02T12:00:00.000Z', endOffset: 720
  }, at('2026-01-04T00:00:00Z'));
  assert.deepEqual(M.entriesForDate(state, '2026-01-02').map(entry => entry.id), [instant.id, zeroTimer.id, travel.id]);
  assert.equal(M.entriesForDate(state, '2026-01-03')[0].id, travel.id);
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

test('older backups without record-editor metadata remain valid', () => {
  const state = M.newState();
  const task = routine(state);
  const saved = M.completeTask(state, task.id, at('2026-01-01T12:00:00Z'));
  assert.equal(saved.note, undefined);
  assert.equal(saved.manual, undefined);
  assert.equal(saved.updatedAt, undefined);
  const restored = clone(state);
  assert.equal(M.validateState(restored), true);
  M.updateEntry(restored, saved.id, { note: 'Taken with lunch' }, at('2026-01-01T13:00:00Z'));
  assert.equal(restored.version, 1);
  assert.equal(M.validateState(clone(restored)), true);
  assert.equal(state.entries[0].note, undefined);
});

test('editing a record changes its snapshot and notes without renaming its activity', () => {
  const state = M.newState();
  const task = routine(state);
  const saved = M.completeTask(state, task.id, at('2026-01-01T12:00:00Z'));
  const taskBefore = clone(task), identity = saved.id;
  const corrected = M.updateEntry(state, saved.id, {
    title: '  Creatine after lunch  ', note: '  Mixed into water.  '
  }, at('2026-01-01T13:00:00Z'));
  assert.equal(corrected.id, identity);
  assert.equal(corrected.taskId, task.id);
  assert.equal(corrected.title, 'Creatine after lunch');
  assert.equal(corrected.note, 'Mixed into water.');
  assert.equal(corrected.updatedAt, '2026-01-01T13:00:00.000Z');
  assert.equal(corrected.startAt, '2026-01-01T12:00:00.000Z');
  assert.deepEqual(task, taskBefore);
  assert.equal(M.validateState(state), true);
});

test('correcting a linked record day keeps the scheduled occurrence it fulfilled', () => {
  const state = M.newState();
  const task = routine(state);
  const saved = M.completeTask(state, task.id, at('2026-01-02T00:10:00Z'));
  M.updateEntry(state, saved.id, {
    startAt: '2026-01-01T23:55:00.000Z', startOffset: 0
  }, at('2026-01-02T01:00:00Z'));
  assert.equal(saved.date, '2026-01-01');
  assert.equal(saved.endDate, '2026-01-01');
  assert.equal(saved.occurrenceDate, '2026-01-02');
  assert.equal(saved.startAt, saved.endAt);
  assert.equal(M.entriesForDate(state, '2026-01-01')[0].id, saved.id);
  assert.equal(M.entriesForDate(state, '2026-01-02').length, 0);
  assert.equal(M.isCompleted(state, task.id, '2026-01-02'), true);
  assert.equal(M.isCompleted(state, task.id, '2026-01-01'), false);
  assert.throws(() => M.completeTask(state, task.id, at('2026-01-02T12:00:00Z')));
  assert.equal(M.validateState(clone(state)), true);
});

test('a corrected quick record follows its captured calendar day and timezone', () => {
  const state = M.newState();
  const saved = M.logEntry(state, 'Evening walk', at('2026-01-02T10:00:00Z'));
  M.updateEntry(state, saved.id, {
    startAt: '2026-01-02T15:10:00.000Z', startOffset: -540
  }, at('2026-01-03T12:00:00Z'));
  assert.equal(saved.date, '2026-01-03');
  assert.equal(saved.endDate, '2026-01-03');
  assert.equal(saved.occurrenceDate, '2026-01-03');
  assert.equal(saved.startOffset, -540);
  assert.equal(saved.endOffset, -540);
  assert.equal(M.entriesForDate(state, '2026-01-02').length, 0);
  assert.equal(M.entriesForDate(state, '2026-01-03')[0].id, saved.id);
  assert.equal(M.validateState(state), true);
});

test('a manual instant record uses the supplied past time instead of the edit time', () => {
  const state = M.newState();
  const saved = M.createManualEntry(state, {
    title: '  A walk before bed  ', tracking: 'check',
    startAt: '2026-01-01T14:50:00.000Z', startOffset: -540,
    note: '  Forgot to log it yesterday.  '
  }, at('2026-01-02T12:00:00Z'));
  assert.equal(saved.taskId, null);
  assert.equal(saved.kind, 'quick');
  assert.equal(saved.manual, true);
  assert.equal(saved.title, 'A walk before bed');
  assert.equal(saved.note, 'Forgot to log it yesterday.');
  assert.equal(saved.startAt, '2026-01-01T14:50:00.000Z');
  assert.equal(saved.endAt, saved.startAt);
  assert.equal(saved.date, '2026-01-01');
  assert.equal(saved.occurrenceDate, saved.date);
  assert.equal(saved.updatedAt, '2026-01-02T12:00:00.000Z');
  assert.equal(state.tasks.length, 0);
  assert.equal(M.validateState(clone(state)), true);
});

test('a standalone manual timer can cross midnight without creating a reusable activity', () => {
  const state = M.newState();
  const saved = M.createManualEntry(state, {
    title: 'Read a long chapter', tracking: 'timer',
    startAt: '2026-01-01T14:45:00.000Z', startOffset: -540,
    endAt: '2026-01-01T15:20:00.000Z', endOffset: -540,
    note: 'Finished chapter four.'
  }, at('2026-01-02T12:00:00Z'));
  assert.equal(saved.date, '2026-01-01');
  assert.equal(saved.endDate, '2026-01-02');
  assert.equal(Date.parse(saved.endAt) - Date.parse(saved.startAt), 35 * 60000);
  assert.equal(saved.taskId, null);
  assert.equal(saved.kind, 'quick');
  assert.equal(state.tasks.length, 0);
  assert.equal(M.activeEntries(state).length, 0);
  assert.equal(M.entriesForDate(state, '2026-01-01')[0].id, saved.id);
  assert.equal(M.entriesForDate(state, '2026-01-02')[0].id, saved.id);
  assert.equal(M.validateState(clone(state)), true);
});

test('zero-duration actions and finished timers remain valid explicit records', () => {
  const state = M.newState();
  const stamp = '2026-01-01T12:00:00.000Z';
  const action = M.createManualEntry(state, { title: 'Took creatine', startAt: stamp, startOffset: 0 }, at(stamp));
  const timer = M.createManualEntry(state, {
    title: 'A brief pause', tracking: 'timer', startAt: stamp, startOffset: 0, endAt: stamp, endOffset: 0
  }, at(stamp));
  assert.equal(action.startAt, action.endAt);
  assert.equal(timer.startAt, timer.endAt);
  assert.equal(timer.endAt, stamp);
  assert.equal(M.activeEntries(state).length, 0);
  assert.equal(M.validateState(state), true);
});

test('a running timer can be corrected and finished while retaining its linked identity', () => {
  const state = M.newState();
  const task = M.createTask(state, { name: 'Read', kind: 'optional', tracking: 'timer' }, start);
  const saved = M.startTask(state, task.id, at('2026-01-01T23:00:00Z'));
  const corrected = M.updateEntry(state, saved.id, {
    startAt: '2026-01-01T23:10:00.000Z', startOffset: 0,
    endAt: '2026-01-02T00:20:00.000Z', endOffset: 0,
    note: 'A late chapter.'
  }, at('2026-01-02T12:00:00Z'));
  assert.equal(corrected.id, saved.id);
  assert.equal(corrected.taskId, task.id);
  assert.equal(corrected.occurrenceDate, '2026-01-01');
  assert.equal(corrected.endDate, '2026-01-02');
  assert.equal(M.activeEntries(state).length, 0);
  assert.equal(M.validateState(clone(state)), true);
});

test('invalid manual record values never append a partial record', () => {
  const state = M.newState();
  M.logEntry(state, 'Keep this', at('2026-01-01T10:00:00Z'));
  const before = clone(state), now = at('2026-01-01T12:00:00Z');
  const base = { title: 'Earlier walk', tracking: 'timer', startAt: '2026-01-01T10:00:00.000Z', startOffset: 0, endAt: '2026-01-01T11:00:00.000Z', endOffset: 0 };
  for (const changes of [
    { title: '' }, { title: ' '.repeat(10) }, { note: 'x'.repeat(1001) }, { note: null },
    { startAt: 0 }, { startAt: 'not a date' }, { startAt: '2026-01-01T13:00:00.000Z' },
    { endAt: '2026-01-01T13:00:00.000Z' }, { endAt: '2026-01-01T09:00:00.000Z' },
    { endAt: null }, { startOffset: 841 }, { endOffset: -841 }, { startOffset: 1.5 },
    { tracking: 'unknown' }
  ]) {
    assert.throws(() => M.createManualEntry(state, { ...base, ...changes }, now));
    assert.deepEqual(state, before);
  }
});

test('invalid corrections leave the original timestamps, notes, and task state intact', () => {
  const state = M.newState();
  const task = M.createTask(state, { name: 'Read', kind: 'optional', tracking: 'timer' }, start);
  const saved = M.startTask(state, task.id, at('2026-01-01T10:00:00Z'));
  M.finishEntry(state, saved.id, at('2026-01-01T11:00:00Z'));
  const before = clone(state), now = at('2026-01-01T12:00:00Z');
  for (const changes of [
    { title: '' }, { note: 'x'.repeat(1001) }, { tracking: 'check' },
    { startAt: 0 }, { startAt: '2026-01-01T13:00:00.000Z' },
    { startAt: '2026-01-01T11:30:00.000Z' }, { endAt: '2026-01-01T09:00:00.000Z' },
    { endAt: '2026-01-01T13:00:00.000Z' }, { startOffset: 999 }, { endOffset: null }
  ]) {
    assert.throws(() => M.updateEntry(state, saved.id, changes, now));
    assert.deepEqual(state, before);
  }
});

test('an instant correction rejects separate finish times or conflicting finish offsets', () => {
  const state = M.newState();
  const saved = M.logEntry(state, 'Watered plants', at('2026-01-01T10:00:00Z'));
  const before = clone(state), now = at('2026-01-01T12:00:00Z');
  for (const changes of [
    { endAt: '2026-01-01T10:01:00.000Z' },
    { endAt: null }, { endOffset: -540 }, { tracking: 'timer' }
  ]) {
    assert.throws(() => M.updateEntry(state, saved.id, changes, now));
    assert.deepEqual(state, before);
  }
});

test('reopening an older timer cannot create two active sessions for the same task', () => {
  const state = M.newState();
  const task = M.createTask(state, { name: 'Read', kind: 'optional', tracking: 'timer' }, start);
  const first = M.startTask(state, task.id, at('2026-01-01T10:00:00Z'));
  M.finishEntry(state, first.id, at('2026-01-01T10:30:00Z'));
  M.startTask(state, task.id, at('2026-01-01T11:00:00Z'));
  const before = clone(state);
  assert.throws(() => M.updateEntry(state, first.id, { endAt: null, endOffset: null }, at('2026-01-01T12:00:00Z')));
  assert.deepEqual(state, before);
  assert.equal(M.activeEntries(state).length, 1);
});

test('record metadata remains optional but is validated in restored backups', () => {
  const state = M.newState();
  const saved = M.createManualEntry(state, {
    title: 'A note', startAt: '2026-01-01T10:00:00.000Z', startOffset: 0, note: 'Remember this.'
  }, at('2026-01-01T12:00:00Z'));
  assert.equal(M.validateState(state), true);
  for (const changes of [{ note: 'x'.repeat(1001) }, { note: 42 }, { manual: 'yes' }, { updatedAt: 'invalid' }]) {
    const corrupted = clone(state);
    Object.assign(corrupted.entries[0], changes);
    assert.equal(M.validateState(corrupted), false);
  }
  const before = clone(state);
  assert.throws(() => M.updateEntry(state, saved.id, JSON.parse('{"__proto__":{"polluted":true}}'), at('2026-01-01T13:00:00Z')));
  assert.deepEqual(state, before);
  assert.equal({}.polluted, undefined);
});
