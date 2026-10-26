/* Prokope's calendar and activity model. No DOM, network, or storage side effects. */
(function (root, factory) {
  var model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.ProkopeModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DAY = 86400000;
  var TYPES = ['daily', 'weekdays', 'interval', 'monthly', 'once', 'optional'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function fail(message) { throw new Error(message); }
  function pad(value) { return String(value).padStart(2, '0'); }
  function dateValue(value) {
    var result = value === undefined ? new Date() : new Date(value);
    if (!Number.isFinite(result.getTime())) fail('Choose a valid date and time.');
    return result;
  }
  function localDate(value) {
    var date = dateValue(value);
    return String(date.getFullYear()).padStart(4, '0') + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }
  function ordinal(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return NaN;
    var bits = key.split('-').map(Number), date = new Date(0);
    if (bits[0] < 1 || bits[0] > 9999) return NaN;
    date.setUTCFullYear(bits[0], bits[1] - 1, bits[2]);
    date.setUTCHours(0, 0, 0, 0);
    if (date.getUTCFullYear() !== bits[0] || date.getUTCMonth() !== bits[1] - 1 || date.getUTCDate() !== bits[2]) return NaN;
    return date.getTime() / DAY;
  }
  function validDate(key) { return Number.isFinite(ordinal(key)); }
  function requireDate(key) {
    if (!validDate(key)) fail('Choose a valid calendar date.');
    return key;
  }
  function addDays(key, amount) {
    requireDate(key);
    if (!Number.isInteger(amount)) fail('Days must be a whole number.');
    var date = new Date((ordinal(key) + amount) * DAY);
    var result = String(date.getUTCFullYear()).padStart(4, '0') + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
    return requireDate(result);
  }
  function plain(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }
  function safeTree(value, depth) {
    if (depth > 12) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object') return false;
    if (!Array.isArray(value) && !plain(value)) return false;
    return Object.keys(value).every(function (key) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return false;
      var property = Object.getOwnPropertyDescriptor(value, key);
      return property && Object.prototype.hasOwnProperty.call(property, 'value') && safeTree(property.value, depth + 1);
    });
  }
  function title(value) {
    if (typeof value !== 'string') fail('Give this activity a name.');
    var result = value.trim();
    if (!result || result.length > 160) fail('Use an activity name between 1 and 160 characters.');
    return result;
  }
  function validISO(value) {
    if (typeof value !== 'string') return false;
    var date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value;
  }
  function time(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('Choose a valid planned time.');
    return value;
  }
  function minuteOfDay(value) {
    var parts = value.split(':').map(Number);
    return parts[0] * 60 + parts[1];
  }
  function eventColor(value) {
    if (value === undefined) return '#55786a';
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail('Choose a valid event color.');
    return value;
  }
  function eventLocation(value) {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > 160) fail('Keep the location to 160 characters or fewer.');
    return value.trim();
  }
  function excludedDates(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 10000 || value.some(function (key) { return !validDate(key); })) fail('Choose valid dates to skip.');
    return Array.from(new Set(value)).sort();
  }
  function id(prefix) {
    var crypto = typeof globalThis !== 'undefined' && globalThis.crypto;
    if (crypto && crypto.randomUUID) return prefix + '_' + crypto.randomUUID();
    if (crypto && crypto.getRandomValues) {
      var parts = new Uint32Array(4);
      crypto.getRandomValues(parts);
      return prefix + '_' + Array.from(parts).map(function (part) { return part.toString(16); }).join('-');
    }
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  function newState() { return { version: 1, tasks: [], entries: [] }; }
  function scheduleFor(input, kind, today) {
    var source = input || {};
    if (!plain(source) || !safeTree(source, 0)) fail('Invalid repeat settings.');
    var type = kind === 'optional' ? 'optional' : kind === 'planned' ? 'once' : source.type || 'daily';
    if (TYPES.indexOf(type) < 0 || (kind === 'routine' && ['once', 'optional'].indexOf(type) >= 0) || (kind === 'event' && type === 'optional')) fail('Choose a valid repeat schedule.');
    var schedule = { type: type, startDate: requireDate(source.startDate || (type === 'once' && source.date) || today), time: time(source.time) };
    if (type === 'weekdays') {
      if (!Array.isArray(source.weekdays)) fail('Select at least one weekday.');
      schedule.weekdays = Array.from(new Set(source.weekdays.map(Number))).sort();
      if (!schedule.weekdays.length || schedule.weekdays.some(function (day) { return !Number.isInteger(day) || day < 0 || day > 6; })) fail('Select valid weekdays.');
    }
    if (type === 'interval') {
      schedule.interval = Number(source.interval);
      if (!Number.isInteger(schedule.interval) || schedule.interval < 1 || schedule.interval > 3650) fail('Repeat every 1 to 3650 days.');
    }
    if (type === 'monthly') {
      schedule.monthDay = Number(source.monthDay);
      if (!Number.isInteger(schedule.monthDay) || schedule.monthDay < 1 || schedule.monthDay > 31) fail('Choose a day from 1 to 31.');
    }
    if (type === 'once') {
      schedule.date = requireDate(source.date);
      schedule.startDate = schedule.date;
    }
    if (kind === 'event') {
      schedule.endTime = time(source.endTime);
      if (source.endNextDay !== undefined && typeof source.endNextDay !== 'boolean') fail('Choose whether the event ends the next day.');
      schedule.endNextDay = source.endNextDay || false;
      schedule.untilDate = source.untilDate === undefined || source.untilDate === '' ? '' : requireDate(source.untilDate);
      if (schedule.untilDate && (type === 'once' || schedule.untilDate < schedule.startDate)) fail('The repeat end date must be on or after the start date.');
      if (schedule.endTime && !schedule.time) fail('Add a start time before an end time.');
      if (schedule.endNextDay && (!schedule.time || !schedule.endTime)) fail('An overnight event needs start and end times.');
      if (schedule.endTime) {
        var duration = minuteOfDay(schedule.endTime) - minuteOfDay(schedule.time) + (schedule.endNextDay ? 1440 : 0);
        if (duration <= 0 || duration > 1440) fail('Choose an end time after the start, within 24 hours.');
      }
    }
    return schedule;
  }
  function normalized(input, today) {
    if (!plain(input) || !safeTree(input, 0)) fail('Invalid activity.');
    var kind = input.kind || 'routine', tracking = input.tracking || (kind === 'event' ? 'none' : 'check');
    if (['routine', 'optional', 'planned', 'event'].indexOf(kind) < 0) fail('Choose a valid activity type.');
    if (kind === 'event' ? tracking !== 'none' : ['check', 'timer'].indexOf(tracking) < 0) fail('Events have no completion tracking. Activities use a check or timer.');
    var result = { name: title(input.name), kind: kind, tracking: tracking, schedule: scheduleFor(input.schedule, kind, today) };
    if (input.color !== undefined) result.color = eventColor(input.color);
    if (kind === 'event') {
      result.color = eventColor(input.color);
      result.note = note(input.note);
      result.location = eventLocation(input.location);
      result.excludedDates = excludedDates(input.excludedDates);
    }
    return result;
  }
  function getTask(state, taskId) {
    var task = state.tasks.find(function (item) { return item.id === taskId; });
    if (!task) fail('This activity is no longer available.');
    return task;
  }
  function getEntry(state, entryId) {
    var entry = state.entries.find(function (item) { return item.id === entryId; });
    if (!entry) fail('This activity record is no longer available.');
    return entry;
  }
  function createTask(state, input, now) {
    var date = dateValue(now), clean = normalized(input, localDate(date));
    var task = Object.assign({ id: id('task') }, clean, { createdAt: date.toISOString(), archivedAt: null, archivedDate: null });
    state.tasks.push(task);
    return task;
  }
  function updateTask(state, taskId, input, now) {
    var task = getTask(state, taskId), date = dateValue(now);
    if (!plain(input) || !safeTree(input, 0)) fail('Invalid activity.');
    var clean = normalized(Object.assign({}, task, input, { schedule: Object.assign({}, task.schedule, input.schedule || {}) }), localDate(date));
    if (activeEntries(state).some(function (entry) { return entry.taskId === taskId; }) && (clean.kind !== task.kind || clean.tracking !== task.tracking)) fail('Finish this activity before changing its type.');
    Object.assign(task, clean, { updatedAt: date.toISOString() });
    return task;
  }
  function archiveTask(state, taskId, now) {
    var task = getTask(state, taskId), date = dateValue(now);
    if (!task.archivedAt) { task.archivedAt = date.toISOString(); task.archivedDate = localDate(date); }
    return task;
  }
  function restoreTask(state, taskId) {
    var task = getTask(state, taskId);
    task.archivedAt = null;
    task.archivedDate = null;
    return task;
  }
  function isDue(task, key) {
    if (!task || !task.schedule || !validDate(key)) return false;
    var schedule = task.schedule;
    if (key < schedule.startDate) return false;
    if (task.kind === 'event' && ((schedule.untilDate && key > schedule.untilDate) || (task.excludedDates || []).indexOf(key) >= 0)) return false;
    if (task.archivedAt && key >= (task.archivedDate || localDate(task.archivedAt))) return false;
    switch (schedule.type) {
      case 'daily': return true;
      case 'weekdays': return schedule.weekdays.indexOf(new Date(ordinal(key) * DAY).getUTCDay()) >= 0;
      case 'interval': return (ordinal(key) - ordinal(schedule.startDate)) % schedule.interval === 0;
      case 'monthly': return Number(key.slice(-2)) === schedule.monthDay;
      case 'once': return key === schedule.date;
      default: return false;
    }
  }
  function tasksForDate(state, key) {
    requireDate(key);
    return state.tasks.filter(function (task) { return isDue(task, key); }).sort(function (a, b) {
      return (a.schedule.time || '99:99').localeCompare(b.schedule.time || '99:99') || a.createdAt.localeCompare(b.createdAt);
    });
  }
  function skipEvent(state, taskId, key) {
    var task = getTask(state, taskId);
    requireDate(key);
    if (task.kind !== 'event') fail('Only calendar events can skip a date.');
    if ((task.excludedDates || []).indexOf(key) >= 0) return task;
    if (!isDue(task, key)) fail('This event is not scheduled for that date.');
    task.excludedDates = excludedDates((task.excludedDates || []).concat([key]));
    return task;
  }
  function restoreEventOccurrence(state, taskId, key) {
    var task = getTask(state, taskId);
    requireDate(key);
    if (task.kind !== 'event') fail('Only calendar events have skipped dates.');
    task.excludedDates = (task.excludedDates || []).filter(function (date) { return date !== key; });
    return task;
  }
  function eventOccurrencesForDate(state, key) {
    requireDate(key);
    var previous = key === '0001-01-01' ? null : addDays(key, -1), result = [];
    state.tasks.forEach(function (task) {
      if (task.kind !== 'event') return;
      var schedule = task.schedule;
      var startMinute = schedule.time ? minuteOfDay(schedule.time) : 0;
      var endMinute = schedule.endTime ? minuteOfDay(schedule.endTime) : startMinute;
      if (previous && schedule.endNextDay && endMinute > 0 && isDue(task, previous)) {
        result.push({ task: task, occurrenceDate: previous, startMinute: 0, endMinute: endMinute, point: false, allDay: false, continuesBefore: true, continuesAfter: false });
      }
      if (!isDue(task, key)) return;
      result.push({ task: task, occurrenceDate: key, startMinute: startMinute,
        endMinute: !schedule.time || schedule.endNextDay ? 1440 : endMinute,
        point: !!schedule.time && !schedule.endTime, allDay: !schedule.time,
        continuesBefore: false, continuesAfter: !!schedule.endNextDay && endMinute > 0 });
    });
    return result.sort(function (a, b) { return a.startMinute - b.startMinute || a.task.name.localeCompare(b.task.name) || a.task.id.localeCompare(b.task.id); });
  }
  function activeEntries(state) { return state.entries.filter(function (entry) { return entry.endAt === null; }); }
  function isCompleted(state, taskId, key) {
    return state.entries.some(function (entry) { return entry.taskId === taskId && entry.endAt !== null && (entry.occurrenceDate || entry.date) === key; });
  }
  function recordingTask(state, taskId, now, occurrenceDate, tracking) {
    var task = getTask(state, taskId), date = dateValue(now), today = localDate(date);
    if (task.kind === 'event') fail('Calendar events appear on your schedule without completion tracking.');
    if (task.archivedAt) fail('Restore this activity before recording it.');
    if (task.tracking !== tracking) fail(tracking === 'timer' ? 'This activity uses completion tracking.' : 'Start the timer for this activity.');
    var occurrence = occurrenceDate || (task.kind === 'planned' ? task.schedule.date : today);
    requireDate(occurrence);
    if (occurrence > today) fail('Future activities cannot be completed yet.');
    if (task.kind !== 'optional' && !isDue(task, occurrence)) fail('This activity is not scheduled for that day.');
    if (task.kind !== 'optional' && state.entries.some(function (entry) {
      return entry.taskId === task.id && ((task.kind === 'planned' && entry.kind === 'planned') || entry.occurrenceDate === occurrence);
    })) fail('This activity has already been recorded.');
    if (activeEntries(state).some(function (entry) { return entry.taskId === taskId; })) fail('This activity already has a running timer.');
    return { task: task, now: date, occurrence: occurrence };
  }
  function makeEntry(state, task, name, now, occurrence, running) {
    var stamp = now.toISOString(), day = localDate(now);
    var entry = {
      id: id('entry'), taskId: task ? task.id : null, title: name,
      kind: task ? task.kind : 'quick', tracking: running ? 'timer' : 'check',
      startAt: stamp, endAt: running ? null : stamp, date: day, endDate: running ? null : day,
      occurrenceDate: occurrence || day,
      startOffset: now.getTimezoneOffset(), endOffset: running ? null : now.getTimezoneOffset()
    };
    if (task && task.color !== undefined) entry.color = task.color;
    state.entries.push(entry);
    return entry;
  }
  function completeTask(state, taskId, now, occurrenceDate) {
    var record = recordingTask(state, taskId, now, occurrenceDate, 'check');
    return makeEntry(state, record.task, record.task.name, record.now, record.occurrence, false);
  }
  function startTask(state, taskId, now, occurrenceDate) {
    var record = recordingTask(state, taskId, now, occurrenceDate, 'timer');
    return makeEntry(state, record.task, record.task.name, record.now, record.occurrence, true);
  }
  function finishEntry(state, entryId, now) {
    var entry = getEntry(state, entryId), date = dateValue(now);
    if (entry.endAt !== null) fail('This activity has already finished.');
    if (date.getTime() < new Date(entry.startAt).getTime()) fail('The finish time cannot be earlier than the start time. Check your device clock.');
    entry.endAt = date.toISOString(); entry.endDate = localDate(date); entry.endOffset = date.getTimezoneOffset();
    return entry;
  }
  function logEntry(state, name, now) { return makeEntry(state, null, title(name), dateValue(now), null, false); }
  function note(value) {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > 1000) fail('Keep notes to 1000 characters or fewer.');
    return value.trim();
  }
  function correctedRecord(entry, input, now) {
    if (!plain(input) || !safeTree(input, 0)) fail('Invalid activity record.');
    var next = Object.assign({}, entry), date = dateValue(now);
    if (input.tracking !== undefined && input.tracking !== entry.tracking) fail('The recording type cannot be changed.');
    next.title = title(input.title === undefined ? entry.title : input.title);
    next.note = note(input.note === undefined ? entry.note : input.note);
    if (input.color !== undefined) next.color = eventColor(input.color);
    next.startAt = input.startAt === undefined ? entry.startAt : input.startAt;
    next.startOffset = input.startOffset === undefined ? entry.startOffset : input.startOffset;
    if (!validISO(next.startAt) || !validOffset(next.startOffset)) fail('Choose a valid start time and timezone.');
    if (Date.parse(next.startAt) > date.getTime()) fail('A recorded activity cannot start in the future.');
    next.date = requireDate(localDateAtOffset(next.startAt, next.startOffset));
    if (entry.tracking === 'check') {
      if (input.endAt !== undefined && input.endAt !== next.startAt) fail('A completed action has one recorded time.');
      if (input.endOffset !== undefined && input.endOffset !== next.startOffset) fail('A completed action has one recorded timezone.');
      next.endAt = next.startAt;
      next.endOffset = next.startOffset;
      next.endDate = next.date;
    } else {
      next.endAt = input.endAt === undefined ? entry.endAt : input.endAt;
      next.endOffset = input.endOffset === undefined ? entry.endOffset : input.endOffset;
      if (next.endAt === null) {
        if (entry.taskId === null) fail('A manually added timed activity needs a finish time.');
        if (input.endOffset !== undefined && input.endOffset !== null) fail('An unfinished activity has no finish timezone.');
        next.endOffset = null;
        next.endDate = null;
      } else {
        if (!validISO(next.endAt) || !validOffset(next.endOffset)) fail('Choose a valid finish time and timezone.');
        if (Date.parse(next.endAt) < Date.parse(next.startAt)) fail('The finish time cannot be earlier than the start time.');
        if (Date.parse(next.endAt) > date.getTime()) fail('A recorded activity cannot finish in the future.');
        next.endDate = requireDate(localDateAtOffset(next.endAt, next.endOffset));
      }
    }
    next.updatedAt = date.toISOString();
    return next;
  }
  function updateEntry(state, entryId, input, now) {
    var entry = getEntry(state, entryId);
    var next = correctedRecord(entry, input, now);
    // A linked record keeps the occurrence it fulfilled even when its actual
    // time is corrected. A free-form record follows its corrected calendar day.
    if (entry.taskId === null) next.occurrenceDate = next.date;
    var candidate = Object.assign({}, state, {
      entries: state.entries.map(function (item) { return item.id === entryId ? next : item; })
    });
    if (!validateState(candidate)) fail('This change conflicts with another saved activity record.');
    Object.assign(entry, next);
    return entry;
  }
  function createManualEntry(state, input, now) {
    if (!plain(input) || !safeTree(input, 0)) fail('Invalid activity record.');
    var tracking = input.tracking || 'check';
    if (['check', 'timer'].indexOf(tracking) < 0) fail('Choose completion or timer tracking.');
    var source = {
      id: id('entry'), taskId: null, kind: 'quick', tracking: tracking,
      title: input.title, startAt: input.startAt, startOffset: input.startOffset,
      endAt: input.endAt, endOffset: input.endOffset, note: '', manual: true
    };
    if (tracking === 'timer' && !input.endAt) fail('A manually added timed activity needs a finish time.');
    var entry = correctedRecord(source, input, now);
    entry.occurrenceDate = entry.date;
    var candidate = Object.assign({}, state, { entries: state.entries.concat([entry]) });
    if (!validateState(candidate)) fail('This activity record could not be added.');
    state.entries.push(entry);
    return entry;
  }
  function deleteEntry(state, entryId) {
    var index = state.entries.findIndex(function (entry) { return entry.id === entryId; });
    if (index < 0) fail('This activity record is no longer available.');
    return state.entries.splice(index, 1)[0];
  }
  function entriesForDate(state, key) {
    requireDate(key);
    return state.entries.filter(function (entry) {
      var last = entry.endDate || localDate();
      // Midnight ends the preceding day's timer. Its captured finish offset
      // decides that boundary, even if the viewer has since changed timezone.
      if (entry.tracking === 'timer' && entry.endAt && entry.date < key && entry.endDate === key &&
          (Date.parse(entry.endAt) - entry.endOffset * 60000) % DAY === 0) return false;
      return entry.date === key || entry.endDate === key || (entry.date < key && last >= key);
    }).sort(function (a, b) { return a.startAt.localeCompare(b.startAt); });
  }
  function scheduleLabel(task) {
    var schedule = task.schedule, label;
    switch (schedule.type) {
      case 'daily': label = 'Every day'; break;
      case 'weekdays': label = schedule.weekdays.map(function (day) { return WEEKDAYS[day]; }).join(', '); break;
      case 'interval': label = 'Every ' + schedule.interval + (schedule.interval === 1 ? ' day' : ' days'); break;
      case 'monthly': label = 'Day ' + schedule.monthDay + ' of each month'; break;
      case 'once': label = schedule.date; break;
      default: label = 'Anytime';
    }
    return label + (schedule.time ? ' · ' + schedule.time + (task.kind === 'event' && schedule.endTime ? '–' + schedule.endTime + (schedule.endNextDay ? ' (+1 day)' : '') : '') : task.kind === 'event' ? ' · All day' : '') + (task.kind === 'event' && schedule.untilDate ? ' · Until ' + schedule.untilDate : '');
  }
  function validId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 100; }
  function validOffset(value) { return Number.isInteger(value) && value >= -840 && value <= 840; }
  function validateState(value) {
    try {
      if (!plain(value) || !safeTree(value, 0) || value.version !== 1 || !Array.isArray(value.tasks) || !Array.isArray(value.entries)) return false;
      if (value.tasks.length > 10000 || value.entries.length > 200000) return false;
      var taskIds = new Set(), entryIds = new Set(), occurrences = new Set(), planned = new Set(), running = new Set();
      var validTasks = value.tasks.every(function (task) {
        if (!plain(task) || !validId(task.id) || taskIds.has(task.id) || !validISO(task.createdAt)) return false;
        if (task.name !== title(task.name)) return false;
        if (task.color !== undefined && task.color !== eventColor(task.color)) return false;
        if (['routine', 'optional', 'planned', 'event'].indexOf(task.kind) < 0 || (task.kind === 'event' ? task.tracking !== 'none' : ['check', 'timer'].indexOf(task.tracking) < 0)) return false;
        if (task.kind === 'event' && (task.color !== eventColor(task.color) || task.note !== note(task.note) || task.location !== eventLocation(task.location) || JSON.stringify(task.excludedDates) !== JSON.stringify(excludedDates(task.excludedDates)))) return false;
        if (!plain(task.schedule) || !validDate(task.schedule.startDate)) return false;
        var normalizedSchedule = scheduleFor(task.schedule, task.kind, task.schedule.startDate);
        if (Object.keys(normalizedSchedule).some(function (key) { return JSON.stringify(normalizedSchedule[key]) !== JSON.stringify(task.schedule[key]); })) return false;
        if (task.archivedAt !== null && !validISO(task.archivedAt)) return false;
        if (task.archivedAt && (!validDate(task.archivedDate) || task.archivedAt < task.createdAt)) return false;
        if (!task.archivedAt && task.archivedDate !== null && task.archivedDate !== undefined) return false;
        if (task.updatedAt !== undefined && !validISO(task.updatedAt)) return false;
        taskIds.add(task.id);
        return true;
      });
      if (!validTasks) return false;
      return value.entries.every(function (entry) {
        if (!plain(entry) || !validId(entry.id) || entryIds.has(entry.id)) return false;
        if (entry.title !== title(entry.title) || !validISO(entry.startAt) || !validDate(entry.date) || !validDate(entry.occurrenceDate)) return false;
        if (entry.note !== undefined && (typeof entry.note !== 'string' || entry.note.length > 1000)) return false;
        if (entry.color !== undefined && entry.color !== eventColor(entry.color)) return false;
        if (entry.manual !== undefined && typeof entry.manual !== 'boolean') return false;
        if (entry.updatedAt !== undefined && !validISO(entry.updatedAt)) return false;
        if (!validOffset(entry.startOffset) || localDateAtOffset(entry.startAt, entry.startOffset) !== entry.date) return false;
        if (['check', 'timer'].indexOf(entry.tracking) < 0 || ['routine', 'optional', 'planned', 'quick'].indexOf(entry.kind) < 0) return false;
        if (entry.taskId !== null && !taskIds.has(entry.taskId)) return false;
        if ((entry.taskId === null) !== (entry.kind === 'quick')) return false;
        if (entry.endAt === null) {
          if (entry.tracking !== 'timer' || entry.endDate !== null || entry.endOffset !== null || entry.taskId === null || running.has(entry.taskId)) return false;
          running.add(entry.taskId);
        } else {
          if (!validISO(entry.endAt) || entry.endAt < entry.startAt || !validDate(entry.endDate) || !validOffset(entry.endOffset)) return false;
          if (localDateAtOffset(entry.endAt, entry.endOffset) !== entry.endDate) return false;
          if (entry.tracking === 'check' && (entry.startAt !== entry.endAt || entry.startOffset !== entry.endOffset)) return false;
        }
        if (entry.kind === 'routine' || entry.kind === 'planned') {
          var key = entry.taskId + ':' + entry.occurrenceDate;
          if (occurrences.has(key)) return false;
          occurrences.add(key);
          if (entry.kind === 'planned') {
            if (planned.has(entry.taskId)) return false;
            planned.add(entry.taskId);
          }
        }
        entryIds.add(entry.id);
        return true;
      });
    } catch (_) { return false; }
  }
  function localDateAtOffset(stamp, offset) {
    return new Date(new Date(stamp).getTime() - offset * 60000).toISOString().slice(0, 10);
  }

  return {
    localDate: localDate, addDays: addDays, newState: newState,
    createTask: createTask, updateTask: updateTask, archiveTask: archiveTask, restoreTask: restoreTask,
    isDue: isDue, tasksForDate: tasksForDate, scheduleLabel: scheduleLabel,
    eventOccurrencesForDate: eventOccurrencesForDate, skipEvent: skipEvent, restoreEventOccurrence: restoreEventOccurrence,
    completeTask: completeTask, startTask: startTask, finishEntry: finishEntry, logEntry: logEntry,
    createManualEntry: createManualEntry, updateEntry: updateEntry,
    deleteEntry: deleteEntry, entriesForDate: entriesForDate, activeEntries: activeEntries,
    isCompleted: isCompleted, validateState: validateState
  };
});
