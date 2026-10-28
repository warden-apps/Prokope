(function () {
  'use strict';
  var M = window.ProkopeModel;
  var T = window.ProkopeTimeline;
  var KEY = 'prokope.daily.v1';
  var LEGACY_KEY = 'keikoroku.v1';
  var $ = function (id) { return document.getElementById(id); };
  var state = M.newState(), storageLocked = false, rawUnreadable = null;
  var selected = M.localDate(), today = selected, view = 'today';
  var undoAction = null, toastTimer, waitingWorker, updateRequested = false;
  var confirmResolve = null, restoreBusy = false;
  var deletion = null;
  var clockMinute = '', recordOriginal = null, taskOriginal = null;
  var calendarFilter = 'all';
  var todayPanel = 'timeline';
  var mapDates = { today: '', history: '' };
  var mapPositions = {};
  var calendarMonth = selected.slice(0, 7) + '-01', calendarSelected = selected;
  var eventEditor = window.ProkopeEvents.init({
    getState: function () { return state; }, getDate: function () { return selected; },
    transact: transact, toast: toast, confirm: confirmAction, deleteTask: requestTaskDeletion,
    onCreated: function (task) {
      todayPanel = 'timeline';
      var date = task.schedule.date || (task.schedule.startDate > selected ? task.schedule.startDate : selected);
      // Open the next occurrence so a newly saved future event is easy to find.
      for (var i = 0; task.schedule.type !== 'once' && !M.isDue(task, date) && i < 3650; i++) {
        if (task.schedule.untilDate && date >= task.schedule.untilDate) break;
        try { date = M.addDays(date, 1); } catch (_) { break; }
      }
      if (!M.isDue(task, date)) date = task.schedule.date || task.schedule.startDate;
      if (date !== selected) { selected = date; view = 'history'; }
      render();
    }
  });

  function restoreView() {
    try {
      var saved = JSON.parse(sessionStorage.getItem('prokope.view.v1') || 'null');
      if (!saved || !['today', 'library', 'history'].includes(saved.view)) return;
      M.addDays(saved.selected, 0);
      view = saved.view;
      selected = saved.view === 'today' && saved.selected === saved.today ? today : saved.selected;
      calendarMonth = selected.slice(0, 7) + '-01'; calendarSelected = selected;
      calendarFilter = ['all', 'events', 'records'].includes(saved.filter) ? saved.filter : 'all';
      $('calendar-search').value = typeof saved.query === 'string' ? saved.query.slice(0, 160) : '';
      todayPanel = saved.todayPanel === 'tasks' ? 'tasks' : 'timeline';
      $('library-kind').value = ['all', 'event', 'routine', 'planned', 'optional'].includes(saved.libraryKind) ? saved.libraryKind : 'all';
      $('library-search').value = typeof saved.libraryQuery === 'string' ? saved.libraryQuery.slice(0, 160) : '';
      $('show-archived').checked = saved.showArchived === true;
      $('calendar-day-details').open = saved.dayDetails === true;
    } catch (_) { /* A private or expired session can always start at today. */ }
  }
  function rememberView() {
    try { sessionStorage.setItem('prokope.view.v1', JSON.stringify({ view: view, selected: selected, today: today, filter: calendarFilter, query: $('calendar-search').value, todayPanel: todayPanel, libraryKind: $('library-kind').value, libraryQuery: $('library-search').value, showArchived: $('show-archived').checked, dayDetails: $('calendar-day-details').open })); }
    catch (_) { /* Navigation still works when session storage is unavailable. */ }
  }
  function renderCalendar() {
    if (view !== 'history') return;
    $('calendar-date-picker').value = selected;
    document.querySelectorAll('[data-calendar-filter]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.calendarFilter === calendarFilter)); });
    window.ProkopeCalendar.render($('calendar-panel'), { state: state, selected: selected, today: today, month: calendarMonth, filter: calendarFilter, query: $('calendar-search').value });
  }
  function renderGlance() {
    var container = $('schedule-glance');
    if (view !== 'today' || selected !== today || todayPanel !== 'timeline') { container.hidden = true; return; }
    var minute = T.minutesAt(new Date());
    var events = M.eventOccurrencesForDate(state, today).filter(function (item) { return !item.allDay; });
    var current = events.filter(function (item) { return !item.point && item.startMinute <= minute && item.endMinute > minute; }).sort(function (a, b) { return a.endMinute - b.endMinute; });
    var next = events.find(function (item) { return item.startMinute > minute; });
    var nextDay = false;
    if (!next) {
      next = M.eventOccurrencesForDate(state, M.addDays(today, 1)).find(function (item) { return !item.allDay && !item.continuesBefore; });
      nextDay = !!next;
    }
    function card(item, heading, detail) {
      return '<button class="schedule-glance-item" style="--item-color:' + itemColor(item.task) + '" data-action="edit-event" data-id="' + escape(item.task.id) + '" data-date="' + item.occurrenceDate + '"><span class="glance-label">' + heading + '</span><strong>' + escape(item.task.name) + '</strong><span class="glance-detail">' + escape(detail) + '</span></button>';
    }
    var html = current.length ? card(current[0], 'Scheduled now', 'Until ' + minuteLabel(current[0].endMinute) + (current.length > 1 ? ' · ' + (current.length - 1) + ' overlapping' : '')) : '';
    if (next) html += card(next, 'Up next', (nextDay ? 'Tomorrow · ' : '') + minuteLabel(next.startMinute));
    container.hidden = !html;
    if (container.innerHTML !== html) container.innerHTML = html;
  }
  function escape(value) {
    return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function icon(name) {
    var paths = {
      check: '<path d="m5 12 4 4L19 6"/>',
      play: '<path d="m9 5 10 7-10 7Z"/>',
      stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
      edit: '<path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z"/>',
      routine: '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2 2m8.8 8.8 2 2m0-12.8-2 2m-8.8 8.8-2 2"/><circle cx="12" cy="12" r="4"/>',
      optional: '<path d="M12 5v15M3 4c3-1 6 0 9 2 3-2 6-3 9-2v14c-3-1-6 0-9 2-3-2-6-3-9-2Z"/>',
      planned: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h3"/>',
      quick: '<path d="m13 2-8 12h6l-1 8 9-12h-6Z"/>',
      remove: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
    };
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.routine) + '</svg>';
  }
  function dateObject(key) { return new Date(key + 'T12:00:00'); }
  function dateLabel(key, options) {
    return dateObject(key).toLocaleDateString(undefined, options || { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function clock(stamp, offset) {
    return T.clock24(stamp, offset);
  }
  function plannedClock(value) { return value ? clock('2000-01-01T' + value + ':00') : ''; }
  function elapsed(entry) {
    var ms = Math.max(0, Date.parse(entry.endAt || new Date().toISOString()) - Date.parse(entry.startAt));
    var minutes = Math.floor(ms / 60000), hours = Math.floor(minutes / 60);
    return hours ? hours + 'h ' + (minutes % 60) + 'm' : minutes ? minutes + ' min' : '<1 min';
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function warning(message) {
    $('storage-warning').hidden = !message;
    $('storage-warning').textContent = message || '';
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (!M.validateState(parsed)) throw new Error('Unrecognized data');
        state = parsed;
      }
    } catch (_) {
      storageLocked = true;
      try { rawUnreadable = localStorage.getItem(KEY); } catch (ignored) { /* Storage is unavailable. */ }
      warning('Your saved data could not be opened. It has not been changed. Open Settings to download it or restore a backup.');
    }
  }
  function transact(change, options) {
    options = options || {};
    if (storageLocked && !options.recovery) {
      toast('Storage is unavailable. Your data has not been changed.');
      return null;
    }
    try {
      // Read again at the point of writing: Safari and the installed app may
      // share this origin with another open window.
      var raw = localStorage.getItem(KEY);
      var current = options.recovery || raw === null ? M.newState() : JSON.parse(raw);
      if (!options.recovery && !M.validateState(current)) {
        storageLocked = true;
        rawUnreadable = raw;
        warning('Saved data has changed and could not be read. Download a recovery copy in Settings before restoring a backup.');
        throw new Error('Nothing was overwritten. Restore a valid backup to continue.');
      }
      var next = options.recovery ? M.newState() : clone(current);
      var result = change(next);
      if (!M.validateState(next)) throw new Error('This change conflicts with the saved records. Reload and try again.');
      localStorage.setItem(KEY, JSON.stringify(next));
      state = next;
      storageLocked = false;
      rawUnreadable = null;
      warning('');
      render();
      return { value: result };
    } catch (error) {
      if (options.onError) options.onError(error);
      if (error instanceof SyntaxError) {
        storageLocked = true;
        try { rawUnreadable = localStorage.getItem(KEY); } catch (_) { /* Preserve existing data. */ }
        warning('Saved data could not be read. Download a recovery copy in Settings before restoring a backup.');
      }
      if (error.name === 'QuotaExceededError' || error.name === 'SecurityError') {
        warning('This change could not be saved. Download a backup in Settings and check available browser storage.');
      }
      toast(error.message || 'That change could not be saved.');
      return null;
    }
  }
  function toast(message, undo) {
    clearTimeout(toastTimer);
    undoAction = undo || null;
    if ($('settings-dialog').open) {
      $('settings-feedback').textContent = message;
      $('settings-feedback').hidden = false;
      return;
    }
    $('toast-message').textContent = message;
    $('toast-undo').hidden = !undo;
    $('toast').hidden = false;
    toastTimer = setTimeout(function () { $('toast').hidden = true; undoAction = null; }, undo ? 12000 : 5000);
  }
  function confirmAction(title, message, accept) {
    if (confirmResolve) confirmResolve(false);
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('confirm-accept').textContent = accept || 'Confirm';
    $('confirm-dialog').showModal();
    return new Promise(function (resolve) { confirmResolve = resolve; });
  }
  function resolveConfirm(value) {
    $('confirm-dialog').close();
    if (confirmResolve) { var resolve = confirmResolve; confirmResolve = null; resolve(value); }
  }
  function requestTaskDeletion(id, original) {
    if (deletion) return Promise.resolve(false);
    var task = state.tasks.find(function (item) { return item.id === id; });
    if (!task) { toast('This item is no longer available.'); return Promise.resolve(false); }
    var records = state.entries.filter(function (entry) { return entry.taskId === id; });
    var event = task.kind === 'event', series = event && task.schedule.type !== 'once';
    var label = series ? 'series' : event ? 'event' : 'activity';
    $('delete-task-title').textContent = 'Delete ' + label + '?';
    $('delete-task-message').textContent = 'Permanently delete “' + task.name + '”' + (series ? ' and all its past and future dates' : event ? ' from the calendar' : ' from your activities') + '. This cannot be undone.';
    $('delete-task-confirm').textContent = 'Delete ' + label;
    $('delete-task-confirm').disabled = false;
    $('delete-task-records').checked = false;
    $('delete-records-choice').hidden = event || !records.length;
    $('delete-records-label').textContent = 'Also delete ' + records.length + ' past record' + (records.length === 1 ? '' : 's');
    $('delete-records-hint').textContent = event ? 'Use Archive instead to keep past calendar dates.' : records.length ? 'Your past records will stay on the timeline.' : 'There are no past records for this activity.';
    $('delete-task-error').hidden = true;
    var error = JSON.stringify(task) !== original ? 'This item changed in another window. Cancel and reopen it before deleting.' : records.some(function (entry) { return entry.endAt === null; }) ? 'Finish or remove the running timer before deleting this activity.' : '';
    if (error) {
      $('delete-task-error').textContent = error;
      $('delete-task-error').hidden = false;
      $('delete-task-confirm').disabled = true;
    }
    var promise = new Promise(function (resolve) {
      deletion = { id: id, original: original, records: JSON.stringify(records), event: event, resolve: resolve };
    });
    $('delete-task-dialog').showModal();
    $('delete-task-cancel').focus();
    return promise;
  }
  function closeTaskDeletion(deleted) {
    var pending = deletion;
    deletion = null;
    $('delete-task-dialog').close();
    if (pending) pending.resolve(deleted);
  }
  function confirmTaskDeletion() {
    if (!deletion || $('delete-task-confirm').disabled) return;
    var pending = deletion, removeRecords = !pending.event && $('delete-task-records').checked;
    var message = '';
    var result = transact(function (draft) {
      var task = draft.tasks.find(function (item) { return item.id === pending.id; });
      var records = draft.entries.filter(function (entry) { return entry.taskId === pending.id; });
      // The confirmation describes a particular activity and record count.
      // A second window must not silently expand or change that deletion.
      if (JSON.stringify(task) !== pending.original || JSON.stringify(records) !== pending.records) {
        throw new Error('This item or its records changed in another window. Cancel and reopen it before deleting.');
      }
      return M.deleteTask(draft, pending.id, { deleteRecords: removeRecords });
    }, { onError: function (error) { message = error.message; } });
    if (result) {
      closeTaskDeletion(true);
      toast(pending.event ? 'Event deleted.' : removeRecords ? 'Activity and its records deleted.' : 'Activity deleted. Past records kept.');
    } else {
      $('delete-task-error').textContent = message || 'Could not delete. Your saved data has not been changed.';
      $('delete-task-error').hidden = false;
      $('delete-task-confirm').disabled = true;
    }
  }
  function empty(title, detail, action) {
    return '<div class="empty-state"><strong>' + escape(title) + '</strong><p>' + escape(detail) + '</p>' + (action || '') + '</div>';
  }
  function addButton(kind, label) {
    return '<button class="text-button" data-action="new" data-kind="' + kind + '">+ ' + escape(label) + '</button>';
  }
  function scheduleText(task) {
    var base = M.scheduleLabel(task);
    if (task.schedule.time) base = base.replace(task.schedule.time, plannedClock(task.schedule.time));
    if (task.kind === 'planned') base = base.replace(task.schedule.date, dateLabel(task.schedule.date, { month: 'short', day: 'numeric' }));
    return base;
  }
  function taskEntry(task, day) {
    return state.entries.find(function (entry) {
      return entry.taskId === task.id && (entry.occurrenceDate === day || (task.kind === 'planned' && entry.kind === 'planned'));
    });
  }
  function actionButton(action, id, text, type, extra) {
    return '<button class="' + (type || 'action-button') + '" data-action="' + action + '" data-id="' + escape(id) + '"' + (extra || '') + '>' + text + '</button>';
  }
  function itemColor(item) {
    return item && /^#[0-9a-f]{6}$/i.test(item.color || '') ? item.color : '#55786a';
  }
  function eventCard(task) {
    return '<article class="task-card library-card"><span class="event-color-dot" style="--item-color:' + itemColor(task) + '"></span><div class="task-content"><h3 class="task-name">' + escape(task.name) + '</h3><p class="task-meta">' + escape(scheduleText(task)) + (task.archivedAt ? ' · Archived' : '') + '</p></div>' + actionButton('edit-event', task.id, icon('edit'), 'icon-button', ' aria-label="Edit ' + escape(task.name) + '"') + '</article>';
  }
  function taskCard(task, library) {
    if (task.kind === 'event') return eventCard(task);
    var occurrence = task.kind === 'planned' ? task.schedule.date : selected;
    var active = M.activeEntries(state).find(function (entry) { return entry.taskId === task.id; });
    var entry = task.kind === 'optional' ? null : taskEntry(task, occurrence);
    var done = entry && entry.endAt;
    var meta = scheduleText(task), actions = '';
    if (task.tracking === 'timer') meta += ' · Timed activity';
    if (!library && task.kind === 'planned' && occurrence < today && !done) meta = 'Overdue · ' + meta;
    if (done && !library) meta = 'Done ' + clock(entry.endAt, entry.endOffset) + (entry.endDate !== selected ? ' · ' + dateLabel(entry.endDate, { month: 'short', day: 'numeric' }) : '');
    if (active && !library) meta = 'Started ' + clock(active.startAt, active.startOffset) + ' · ' + elapsed(active);
    if (library && task.archivedAt) {
      actions = actionButton('restore-task', task.id, 'Restore', 'secondary-button');
      actions += actionButton('edit', task.id, icon('edit'), 'icon-button', ' aria-label="Edit ' + escape(task.name) + '"');
    } else {
      if (!library && active && selected === today) actions += actionButton('finish', active.id, icon('stop') + '<span>Finish</span>');
      else if (!library && done) actions += '<span class="done-label">' + icon('check') + ' Done</span>';
      else if (!library && selected === today) {
        var action = task.tracking === 'timer' ? 'start' : 'complete';
        var text = task.tracking === 'timer' ? 'Start' : task.kind === 'optional' ? 'Log' : 'Done';
        actions += actionButton(action, task.id, icon(task.tracking === 'timer' ? 'play' : 'check') + '<span>' + text + '</span>', 'action-button', ' data-occurrence="' + occurrence + '"');
      } else if (!library && selected < today) actions += '<span class="muted">Not recorded</span>';
      actions += actionButton('edit', task.id, icon('edit'), 'icon-button', ' aria-label="Edit ' + escape(task.name) + '"');
    }
    return '<article class="task-card' + (library ? ' library-card' : '') + (done ? ' is-done' : '') + (active ? ' is-running' : '') + '"><div class="task-icon ' + task.kind + '" style="color:' + itemColor(task) + '">' + icon(task.kind) + '</div><div class="task-content"><h3 class="task-name">' + escape(task.name) + '</h3><p class="task-meta">' + escape(meta) + (task.archivedAt ? ' · Archived' : '') + '</p></div><div class="task-actions">' + actions + '</div></article>';
  }
  function recordList(entries, allDays) {
    if (!entries.length) return empty(selected > today ? 'A little space for tomorrow.' : 'Your day is still unfolding.', selected > today ? 'Planned activities will appear in your daily list. Actual times are recorded when you do them.' : 'Complete an activity or log a moment. Its time will appear here automatically.');
    return entries.map(function (entry) {
      var label = entry.kind === 'quick' ? 'A moment logged' : entry.kind === 'routine' ? 'Routine completed' : entry.kind === 'planned' ? 'Planned activity completed' : 'Optional activity';
      if (entry.tracking === 'timer') label = entry.endAt ? clock(entry.startAt, entry.startOffset) + ' – ' + clock(entry.endAt, entry.endOffset) + ' · ' + elapsed(entry) : 'Started ' + clock(entry.startAt, entry.startOffset) + ' · In progress';
      if (entry.date !== selected) label += ' · Started ' + dateLabel(entry.date, { month: 'short', day: 'numeric' });
      if (entry.endDate && entry.endDate !== entry.date) label += ' · Finished ' + dateLabel(entry.endDate, { month: 'short', day: 'numeric' });
      if (entry.kind === 'planned' && entry.occurrenceDate !== entry.date) label += ' · Planned for ' + dateLabel(entry.occurrenceDate, { month: 'short', day: 'numeric' });
      var actions = actionButton('edit-entry', entry.id, 'Details', 'text-button');
      if (entry.endAt === null) actions += actionButton('finish', entry.id, 'Finish', 'text-button');
      if (allDays) actions += actionButton('visit-entry', entry.id, dateLabel(entry.date, { month: 'short', day: 'numeric', year: 'numeric' }), 'text-button', ' data-date="' + entry.date + '"');
      actions += actionButton('remove-entry', entry.id, icon('remove'), 'icon-button', ' aria-label="Remove record for ' + escape(entry.title) + '"');
      return '<article class="timeline-item' + (entry.endAt === null ? ' is-running' : '') + '"><time class="timeline-time" datetime="' + entry.startAt + '">' + escape(clock(entry.startAt, entry.startOffset)) + '</time><span class="timeline-dot" style="background:' + itemColor(entry) + '"></span><div class="timeline-content"><h3 class="timeline-title">' + escape(entry.title) + '</h3><p class="timeline-detail">' + escape(label) + '</p>' + (entry.note ? '<p class="entry-detail-note">' + escape(entry.note) + '</p>' : '') + '</div><div class="timeline-actions">' + actions + '</div></article>';
    }).join('');
  }
  function minuteLabel(minute) {
    if (minute >= 1440) return '24:00';
    return String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(Math.floor(minute % 60)).padStart(2, '0');
  }
  function dayItems(entries, due) {
    var items = [];
    entries.forEach(function (entry) {
      var segment = T.segment(entry, selected);
      if (segment) items.push(Object.assign(segment, { entry: entry }));
    });
    due.forEach(function (task) {
      if (task.kind === 'event' || !task.schedule.time || !M.isDue(task, selected) || taskEntry(task, task.kind === 'planned' ? task.schedule.date : selected)) return;
      var parts = task.schedule.time.split(':').map(Number), minute = parts[0] * 60 + parts[1];
      items.push({ id: task.id, task: task, startMinute: minute, endMinute: minute, point: true });
    });
    M.eventOccurrencesForDate(state, selected).forEach(function (occurrence) {
      if (!occurrence.allDay) items.push(Object.assign({}, occurrence, { id: occurrence.task.id + ':' + occurrence.occurrenceDate, event: true }));
    });
    return items;
  }
  function dayMap(containerId, name, entries, due) {
    var container = $(containerId);
    var position = mapPositions[name];
    var scrollTop = position && position.date === selected ? position.top : null;
    var focused = container.contains(document.activeElement) ? document.activeElement : null;
    var focus = focused && (focused.dataset.entryId || focused.dataset.taskId || '');
    var focusDate = focused && focused.dataset.date, focusTime = focused && focused.dataset.time;
    var items = dayItems(entries, due), positioned = T.layout(items, 46);
    var hours = Array.from({ length: 25 }, function (_, hour) {
      var time = String(hour).padStart(2, '0') + ':00';
      var label = hour === 24 ? '<span class="hour-label">24:00</span>' : '<button type="button" class="hour-label hour-add" data-action="new-event-time" data-time="' + time + '" aria-label="Add event at ' + time + '">' + time + '</button>';
      return '<div class="hour-row" style="top:calc(24px + var(--day-height) * ' + hour / 24 + ')">' + label + '<span class="hour-rule"></span></div>';
    }).join('');
    var marks = positioned.map(function (item) {
      var entry = item.entry, planned = !!item.task, event = !!item.event;
      var title = planned ? item.task.name : entry.title;
      var times = planned ? item.task.schedule.time : clock(entry.startAt, entry.startOffset);
      if (event && item.task.schedule.endTime) times += '–' + item.task.schedule.endTime + (item.task.schedule.endNextDay ? ' +1d' : '');
      else if (planned) times += ' · Planned';
      var detail = event ? item.task.location || 'Scheduled' : planned ? 'Not recorded' : item.point ? 'Recorded' : entry.endAt ? clock(entry.startAt, entry.startOffset) + '–' + clock(entry.endAt, entry.endOffset) + ' · ' + elapsed(entry) : 'In progress · ' + elapsed(entry);
      if (item.continuesBefore) times = '00:00 · Continued';
      if (item.continuesAfter) detail += ' · Continues past midnight';
      if (item.clockShift) detail += ' · Clock changed';
      var classes = (event ? ' is-event' : planned ? ' is-planned' : item.point ? ' is-point' : ' is-timer') + (item.running ? ' is-running' : '');
      var span = item.displayEnd - item.displayStart;
      var shortTimer = !planned && !item.point && item.endMinute - item.startMinute < 46;
      if (shortTimer) { classes += ' is-short'; times += ' · ' + elapsed(entry); }
      var durationBar = shortTimer ? '<span class="event-duration-bar" style="top:' + (item.startMinute - item.displayStart) / span * 100 + '%;height:' + Math.max(1, (item.endMinute - item.startMinute) / span * 100) + '%"></span>' : '';
      var attrs = planned ? ' data-action="' + (event ? 'edit-event' : 'edit') + '" data-id="' + escape(item.task.id) + '" data-task-id="' + escape(item.task.id) + '"' + (event ? ' data-date="' + item.occurrenceDate + '"' : '') : ' data-action="edit-entry" data-id="' + escape(entry.id) + '" data-entry-id="' + escape(entry.id) + '"';
      return '<button type="button" class="map-event' + classes + '"' + attrs + ' data-start-minute="' + item.startMinute + '" data-end-minute="' + item.endMinute + '" style="--item-color:' + itemColor(item.task || entry) + ';top:' + item.displayStart / 1440 * 100 + '%;height:' + span / 1440 * 100 + '%;left:' + item.lane / item.lanes * 100 + '%;width:calc(' + 100 / item.lanes + '% - 5px)" aria-label="' + escape(title + ' · ' + times + ' · ' + detail) + '">' + durationBar + '<span class="event-anchor" style="top:' + Math.min(98, Math.max(0, (item.startMinute - item.displayStart) / span * 100)) + '%"></span><span class="event-label"><span class="event-clock">' + escape(times) + '</span><span class="event-title">' + escape(title) + '</span>' + (!item.point && span >= 76 ? '<span class="event-duration">' + escape(detail) + '</span>' : '') + '</span></button>';
    }).join('');
    var mini = positioned.map(function (item) {
      return '<button type="button" class="overview-mark' + (item.task && !item.event ? ' is-planned' : '') + (item.running ? ' is-running' : '') + '" style="--item-color:' + itemColor(item.task || item.entry) + ';left:' + item.startMinute / 1440 * 100 + '%;width:max(3px,' + Math.max(0, item.endMinute - item.startMinute) / 1440 * 100 + '%)" data-action="jump-minute" data-map="' + name + '" data-minute="' + item.startMinute + '" aria-label="Jump to ' + escape(minuteLabel(item.startMinute) + ': ' + (item.task ? item.task.name : item.entry.title)) + '"></button>';
    }).join('');
    var allDay = M.eventOccurrencesForDate(state, selected).filter(function (item) { return item.allDay; });
    var allDayHTML = allDay.length ? '<div class="map-all-day"><span>All day</span><div>' + allDay.map(function (item) {
      return '<button type="button" class="all-day-event" style="--item-color:' + itemColor(item.task) + '" data-action="edit-event" data-id="' + escape(item.task.id) + '" data-task-id="' + escape(item.task.id) + '" data-date="' + item.occurrenceDate + '">' + escape(item.task.name) + '</button>';
    }).join('') + '</div></div>' : '';
    var now = selected === today ? '<div class="now-line" style="top:' + T.minutesAt(new Date()) / 1440 * 100 + '%"><span>Now ' + clock(new Date()) + '</span></div>' : '';
    container.innerHTML = allDayHTML + '<div class="day-overview" aria-label="Whole-day overview">' + mini + (selected === today ? '<span class="overview-now" style="left:' + T.minutesAt(new Date()) / 1440 * 100 + '%"></span>' : '') + '</div><div class="overview-labels" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div><div class="day-scroll" data-map="' + name + '" tabindex="0" role="region" aria-label="' + escape(dateLabel(selected)) + ', 00:00 to 24:00; scroll to explore"><div class="day-canvas" style="--day-height:1440px">' + hours + '<div class="map-lanes">' + marks + now + '</div></div></div>' + (!items.length && !allDay.length ? '<div class="map-empty-hint">An open day. <button class="text-button" data-action="new-event">+ Add an event</button></div>' : '');
    var scroller = container.querySelector('.day-scroll');
    if (scrollTop !== null) scroller.scrollTop = scrollTop;
    else scroller.scrollTop = Math.max(0, (selected === today ? T.minutesAt(new Date()) - 120 : positioned.length ? positioned[0].startMinute - 60 : 0));
    mapDates[name] = selected;
    mapPositions[name] = { date: selected, top: scroller.scrollTop };
    if (focusTime) {
      var hourButton = container.querySelector('[data-time="' + focusTime + '"]');
      if (hourButton) hourButton.focus({ preventScroll: true });
    }
    if (focus) {
      var target = Array.from(container.querySelectorAll('[data-entry-id], [data-task-id]')).find(function (button) { return (button.dataset.entryId === focus || button.dataset.taskId === focus) && button.dataset.date === focusDate; });
      if (target) target.focus({ preventScroll: true });
    }
  }
  function renderMaps() {
    var entries = M.entriesForDate(state, selected), due = M.tasksForDate(state, selected);
    if (view === 'today' && todayPanel === 'timeline') dayMap('timeline-list', 'today', entries, due);
    if (view === 'history' && $('calendar-day-details').open) dayMap('history-timeline', 'history', entries, due);
    $('history-map-date').textContent = dateLabel(selected, { month: 'long', day: 'numeric' });
    document.querySelectorAll('[data-action="jump-now"]').forEach(function (button) { button.hidden = selected !== today; });
    document.querySelectorAll('[data-action="jump-first"]').forEach(function (button) { button.disabled = !dayItems(entries, due).length; });
  }
  function renderHistory() {
    var query = $('history-search').value.trim().toLocaleLowerCase();
    var entries = query ? state.entries.filter(function (entry) { return (entry.title + ' ' + (entry.note || '')).toLocaleLowerCase().includes(query); }).sort(function (a, b) { return b.startAt.localeCompare(a.startAt); }) : M.entriesForDate(state, selected);
    $('history-results-count').textContent = query ? entries.length + ' matches across all days' + (entries.length > 100 ? ' · Showing the latest 100' : '') : entries.length + (entries.length === 1 ? ' moment on this day' : ' moments on this day');
    $('history-records').innerHTML = entries.length ? recordList(entries.slice(0, 100), !!query) : empty(query ? 'No moments found.' : 'Nothing recorded here yet.', query ? 'Try an activity name or a word from your notes.' : 'Add a missed moment to fill in the picture.');
  }
  function scrollMap(name, minute) {
    var scroller = $(name === 'history' ? 'history-timeline' : 'timeline-list').querySelector('.day-scroll');
    if (scroller) scroller.scrollTo({ top: Math.max(0, minute - 110), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function summary(entries, due) {
    due = due.filter(function (task) { return task.kind !== 'event'; });
    var completed = due.filter(function (task) { return !!(taskEntry(task, task.kind === 'planned' ? task.schedule.date : selected) || {}).endAt; }).length;
    var finished = entries.filter(function (entry) { return entry.endAt; }).length;
    var seconds = T.dayDuration(entries, selected);
    return '<div class="summary-card"><span class="summary-value">' + completed + '<small> / ' + due.length + '</small></span><span class="summary-label">Planned & routine</span></div><div class="summary-card"><span class="summary-value">' + finished + '</span><span class="summary-label">Moments recorded</span></div><div class="summary-card"><span class="summary-value">' + Math.floor(seconds / 60000) + '<small> min</small></span><span class="summary-label">Time spent</span></div>';
  }
  function renderDays() {
    $('date-picker').value = selected;
    $('previous-day').disabled = selected === '0001-01-01';
    $('next-day').disabled = selected === '9999-12-31';
    var weekDay = dateObject(selected).getDay();
    var monday;
    try { monday = M.addDays(selected, -(weekDay + 6) % 7); } catch (_) { monday = '0001-01-01'; }
    $('week-strip').innerHTML = Array.from({ length: 7 }, function (_, i) {
      var date;
      try { date = M.addDays(monday, i); } catch (_) { return '<span class="week-day" aria-hidden="true"></span>'; }
      var hasEntries = M.entriesForDate(state, date).length > 0 || M.eventOccurrencesForDate(state, date).length > 0;
      return '<button class="week-day' + (date === selected ? ' is-selected' : '') + (date === today ? ' is-today' : '') + '" data-action="day" data-date="' + date + '" aria-label="' + escape(dateLabel(date)) + '" aria-pressed="' + (date === selected) + '"><span class="week-name">' + escape(dateLabel(date, { weekday: 'short' })) + '</span><span class="week-number">' + Number(date.slice(-2)) + '</span><span class="week-dot' + (hasEntries ? ' has-entries' : '') + '"></span></button>';
    }).join('');
  }
  function renderActive() {
    $('active-timers').innerHTML = M.activeEntries(state).map(function (entry) {
      return '<div class="running-card"><span class="running-pulse"></span><div class="task-content"><strong>' + escape(entry.title) + '</strong><p>Started ' + escape(clock(entry.startAt, entry.startOffset)) + ' <span data-elapsed="' + escape(entry.id) + '">' + escape(elapsed(entry)) + '</span></p></div>' + actionButton('finish', entry.id, icon('stop') + ' Finish', 'action-button') + '</div>';
    }).join('');
  }
  function dailyTasks(date) {
    var due = M.tasksForDate(state, date).filter(function (task) { return task.kind !== 'event'; });
    if (date === today) {
      state.tasks.forEach(function (task) {
        if (task.kind === 'planned' && !task.archivedAt && task.schedule.date < today && !taskEntry(task, task.schedule.date)) due.push(task);
      });
    }
    return due;
  }
  function captureMapPosition(name) {
    var scroller = $(name === 'today' ? 'timeline-list' : 'history-timeline').querySelector('.day-scroll');
    if (scroller && scroller.getClientRects().length && mapDates[name]) mapPositions[name] = { date: mapDates[name], top: scroller.scrollTop };
  }
  function renderTodayPanel() {
    captureMapPosition('today');
    $('today-map-panel').hidden = todayPanel !== 'timeline';
    $('daily-activities').hidden = todayPanel !== 'tasks';
    document.querySelectorAll('[data-today-panel]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.todayPanel === todayPanel));
    });
  }
  function renderLibrary() {
    var query = $('library-search').value.trim().toLocaleLowerCase(), kind = $('library-kind').value;
    var tasks = state.tasks.filter(function (task) {
      return ($('show-archived').checked || !task.archivedAt) && (kind === 'all' || task.kind === kind) &&
        (!query || [task.name, task.note || '', task.location || ''].join(' ').toLocaleLowerCase().includes(query));
    });
    $('library-results').textContent = tasks.length + (tasks.length === 1 ? ' activity' : ' activities');
    var groups = [['routine', 'Routines'], ['planned', 'To-dos'], ['optional', 'Optional'], ['event', 'Events']];
    $('library-list').innerHTML = groups.map(function (group) {
      var items = tasks.filter(function (task) { return task.kind === group[0]; });
      if (!items.length) return '';
      return '<section class="library-group"><div class="section-heading"><h2>' + group[1] + ' <span class="section-count">' + items.length + '</span></h2>' + addButton(group[0], 'Add') + '</div>' + items.map(function (task) { return taskCard(task, true); }).join('') + '</section>';
    }).join('') || empty(query ? 'No matching activities.' : 'Nothing here yet.', query ? 'Try another name or type.' : 'Add an activity to get started.', query ? '' : addButton(kind === 'all' ? 'routine' : kind, kind === 'event' ? 'Add event' : 'Add activity'));
  }
  function render() {
    captureMapPosition('today');
    captureMapPosition('history');
    today = M.localDate();
    ['today', 'library', 'history'].forEach(function (name) { $(name + '-view').hidden = view !== name; });
    document.querySelectorAll('[data-view]').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.view === view);
      if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    $('day-navigation').hidden = view !== 'today';
    $('view-title').textContent = view === 'library' ? 'Activities' : view === 'history' ? 'Calendar' : selected === today ? 'Today' : selected === M.addDays(today, -1) ? 'Yesterday' : 'Your day';
    $('view-subtitle').textContent = view === 'library' ? 'Manage your routines, to-dos, and events.' : dateLabel(selected);
    renderDays();
    renderActive();
    var due = dailyTasks(selected);
    var routines = due.filter(function (task) { return task.kind === 'routine'; });
    var planned = due.filter(function (task) { return task.kind === 'planned'; });
    var optional = state.tasks.filter(function (task) { return task.kind === 'optional' && !task.archivedAt; });
    var entries = M.entriesForDate(state, selected);
    $('day-summary').innerHTML = summary(entries, due);
    $('history-summary').innerHTML = summary(entries, due);
    $('routine-count').textContent = routines.length;
    $('planned-count').textContent = planned.length;
    $('today-task-count').textContent = due.filter(function (task) { return !(taskEntry(task, task.kind === 'planned' ? task.schedule.date : selected) || {}).endAt; }).length;
    function taskEmpty(text, kind, label) { return '<div class="task-empty"><span>' + text + '</span>' + addButton(kind, label) + '</div>'; }
    $('routine-list').innerHTML = routines.length ? routines.map(function (task) { return taskCard(task); }).join('') : taskEmpty('No routines for this day.', 'routine', 'Add routine');
    $('planned-list').innerHTML = planned.length ? planned.map(function (task) { return taskCard(task); }).join('') : taskEmpty('No to-dos for this day.', 'planned', 'Add to-do');
    $('optional-list').innerHTML = optional.length ? optional.map(function (task) { return taskCard(task); }).join('') : taskEmpty('Things to do anytime.', 'optional', 'Add activity');
    $('quick-log-form').hidden = selected !== today;
    $('timeline-date').textContent = selected === today ? 'TODAY’S TIMELINE' : dateLabel(selected, { month: 'short', day: 'numeric' }).toUpperCase();
    renderTodayPanel();
    renderMaps();
    if (view === 'history') renderHistory();
    renderGlance();
    if (calendarSelected !== selected) { calendarMonth = selected.slice(0, 7) + '-01'; calendarSelected = selected; }
    $('week-strip').hidden = view === 'history';
    renderCalendar();
    rememberView();
    renderLibrary();
  }
  function switchView(next) {
    view = next;
    if (view === 'today') selected = M.localDate();
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  function updateForm() {
    var kind = $('task-kind').value, repeat = $('task-repeat').value;
    $('schedule-fields').hidden = kind !== 'routine';
    $('weekdays-field').hidden = repeat !== 'weekdays';
    $('interval-field').hidden = repeat !== 'interval';
    $('monthday-field').hidden = repeat !== 'monthly';
    $('startdate-field').hidden = kind !== 'routine';
    $('planned-date-field').hidden = kind !== 'planned';
    $('time-field').hidden = kind === 'optional';
    // Hidden inputs must never block native form validation.
    $('task-startdate').required = kind === 'routine';
    $('task-date').required = kind === 'planned';
    $('task-interval').required = kind === 'routine' && repeat === 'interval';
    $('task-monthday').required = kind === 'routine' && repeat === 'monthly';
    $('task-interval').disabled = kind !== 'routine' || repeat !== 'interval';
    $('task-monthday').disabled = kind !== 'routine' || repeat !== 'monthly';
  }
  function openTask(taskId, kind) {
    var task = state.tasks.find(function (item) { return item.id === taskId; });
    if (kind === 'event' || task && task.kind === 'event') { eventEditor.open(taskId, selected); return; }
    taskOriginal = task ? clone(task) : null;
    $('task-form').reset();
    $('task-id').value = task ? task.id : '';
    $('task-dialog-title').textContent = task ? 'Edit activity' : 'New activity';
    $('task-name').value = task ? task.name : '';
    $('task-color').value = itemColor(task);
    $('task-kind').value = task ? task.kind : kind || 'routine';
    $('task-tracking').value = task ? task.tracking : kind === 'optional' ? 'timer' : 'check';
    var schedule = task ? task.schedule : {};
    $('task-repeat').value = ['daily', 'weekdays', 'interval', 'monthly'].includes(schedule.type) ? schedule.type : 'daily';
    $('task-startdate').value = schedule.startDate || (selected > today ? selected : today);
    $('task-date').value = schedule.date || (selected > today ? selected : today);
    $('task-interval').value = schedule.interval || 2;
    $('task-monthday').value = schedule.monthDay || Number(selected.slice(-2));
    $('task-time').value = schedule.time || '';
    document.querySelectorAll('[name="weekday"]').forEach(function (input) { input.checked = (schedule.weekdays || [1, 2, 3, 4, 5]).includes(Number(input.value)); });
    $('task-error').hidden = true;
    $('task-archive').hidden = !task || !!task.archivedAt;
    $('task-delete').hidden = !task;
    updateForm();
    $('task-dialog').showModal();
    $('task-name').focus();
  }
  function recordedTime(stamp, offset) {
    return new Date(Date.parse(stamp) - offset * 60000).toISOString().slice(11, 19);
  }
  function offsetLabel(offset) {
    return 'UTC' + (offset <= 0 ? '+' : '−') + String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0') + ':' + String(Math.abs(offset) % 60).padStart(2, '0');
  }
  function recordFields() {
    var timer = $('record-tracking').value === 'timer';
    var running = recordOriginal && recordOriginal.endAt === null;
    $('record-end-fields').hidden = !timer || running;
    $('record-end-date').required = timer && !running;
    $('record-end').required = timer && !running;
    $('record-start-label').textContent = timer ? 'Start time · 24-hour' : 'Time · 24-hour';
  }
  function openRecord(id) {
    var entry = state.entries.find(function (item) { return item.id === id; });
    recordOriginal = entry ? clone(entry) : null;
    var now = new Date(), date = selected > today ? today : selected;
    $('record-form').reset();
    $('record-id').value = entry ? entry.id : '';
    $('record-dialog-title').textContent = entry ? 'Record details' : 'Log earlier';
    $('record-eyebrow').textContent = entry ? 'THE ACTUAL RECORD' : 'SOMETHING YOU DID EARLIER';
    $('record-title').value = entry ? entry.title : '';
    $('record-tracking').value = entry ? entry.tracking : 'check';
    $('record-tracking-field').hidden = !!entry;
    $('record-date').value = entry ? entry.date : date;
    $('record-start').value = entry ? recordedTime(entry.startAt, entry.startOffset) : T.clock24(now) + ':' + String(now.getSeconds()).padStart(2, '0');
    $('record-end-date').value = entry && entry.endAt ? entry.endDate : date;
    $('record-end').value = entry && entry.endAt ? recordedTime(entry.endAt, entry.endOffset) : $('record-start').value;
    $('record-note').value = entry && entry.note || '';
    $('record-color').value = itemColor(entry);
    $('record-delete').hidden = !entry;
    $('record-save').textContent = entry ? 'Save changes' : 'Add moment';
    $('record-error').hidden = true;
    $('record-context').textContent = entry ? (entry.tracking === 'timer' ? (entry.endAt ? 'Time spent: ' + elapsed(entry) + '. ' : 'This timer is still running. You can correct its start here. ') : 'Recorded at ' + clock(entry.startAt, entry.startOffset) + '. ') + 'Corrections change this record only.' + (entry.startOffset !== now.getTimezoneOffset() ? ' Times use the original ' + offsetLabel(entry.startOffset) + ' clock.' : '') : 'Add an actual moment you missed. For something still to do, create a plan instead.';
    var segment = entry && T.segment(entry, selected);
    if (segment && segment.clockShift) $('record-context').textContent += ' The clock or time zone changed during this activity; elapsed time uses the recorded timestamps.';
    recordFields();
    $('record-dialog').showModal();
    $('record-title').focus();
  }
  function inputInstant(date, time, offset, originalStamp, originalDate) {
    if (!date || !time) throw new Error('Choose a date and time.');
    var fullTime = time.length === 5 ? time + ':00' : time;
    if (originalStamp && date === originalDate && fullTime === recordedTime(originalStamp, offset)) return { stamp: originalStamp, offset: offset };
    var instant = typeof offset === 'number' ? new Date(Date.parse(date + 'T' + fullTime + 'Z') + offset * 60000) : new Date(date + 'T' + fullTime);
    if (!Number.isFinite(instant.getTime())) throw new Error('Choose a valid date and time.');
    var chosenOffset = typeof offset === 'number' ? offset : instant.getTimezoneOffset();
    var wall = new Date(instant.getTime() - chosenOffset * 60000).toISOString();
    if (wall.slice(0, 10) !== date || wall.slice(11, 19) !== fullTime) throw new Error('That local time does not exist on this date. Choose another time.');
    return { stamp: instant.toISOString(), offset: chosenOffset };
  }
  function undoEntry(entry, label) {
    toast(label, function () {
      var result = transact(function (draft) { M.deleteEntry(draft, entry.id); });
      if (result) toast('Undone.');
    });
  }
  function handleAction(button) {
    var action = button.dataset.action, id = button.dataset.id, result;
    if (action === 'new-event-time') { eventEditor.open(null, selected, button.dataset.time); return; }
    if (action === 'new-event') { eventEditor.open(null, button.dataset.date || selected); return; }
    if (action === 'edit-event') { eventEditor.open(id, button.dataset.date || selected); return; }
    if (action === 'calendar-month') {
      calendarMonth = window.ProkopeCalendar.shiftMonth(calendarMonth, Number(button.dataset.delta));
      selected = calendarMonth; calendarSelected = selected; render(); return;
    }
    if (action === 'calendar-today') { selected = today; calendarMonth = today.slice(0, 7) + '-01'; render(); return; }
    if (action === 'calendar-day') { selected = button.dataset.date; render(); return; }
    if (action === 'edit-entry') { openRecord(id); return; }
    if (action === 'log-earlier') { openRecord(); return; }
    if (action === 'jump-section') { $(button.dataset.target).scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (action === 'jump-now') { scrollMap(button.dataset.map, T.minutesAt(new Date())); return; }
    if (action === 'jump-minute') { scrollMap(button.dataset.map, Number(button.dataset.minute)); return; }
    if (action === 'jump-first') {
      var first = dayItems(M.entriesForDate(state, selected), M.tasksForDate(state, selected)).sort(function (a, b) { return a.startMinute - b.startMinute; })[0];
      scrollMap(button.dataset.map, first ? first.startMinute : 0); return;
    }
    if (action === 'visit-entry') {
      selected = button.dataset.date; $('history-search').value = ''; $('calendar-day-details').open = true; render();
      var entry = state.entries.find(function (item) { return item.id === id; });
      var segment = entry && T.segment(entry, selected);
      scrollMap('history', segment ? segment.startMinute : 0); return;
    }
    if (action === 'new') { openTask(null, button.dataset.kind); return; }
    if (action === 'edit') { openTask(id); return; }
    if (action === 'day') { selected = button.dataset.date; render(); return; }
    if (action === 'complete' || action === 'start') {
      result = transact(function (draft) { return M[action === 'start' ? 'startTask' : 'completeTask'](draft, id, new Date(), button.dataset.occurrence); });
      if (result) {
        selected = today;
        render();
        undoEntry(result.value, action === 'start' ? 'Started at ' + clock(result.value.startAt) + '.' : 'Done at ' + clock(result.value.endAt) + '.');
      }
    } else if (action === 'finish') {
      var previous = clone(state.entries.find(function (entry) { return entry.id === id; }));
      result = transact(function (draft) { return M.finishEntry(draft, id); });
      if (result) toast('Finished at ' + clock(result.value.endAt) + ' · ' + elapsed(result.value), function () {
        var undone = transact(function (draft) { var index = draft.entries.findIndex(function (entry) { return entry.id === id; }); if (index >= 0) draft.entries[index] = previous; });
        if (undone) toast('Timer resumed.');
      });
    } else if (action === 'remove-entry') {
      confirmAction('Remove this record?', 'The activity stays in your list. Only this recorded moment and its time will be removed.', 'Remove record').then(function (confirmed) {
        if (!confirmed) return;
        var removed = transact(function (draft) { return M.deleteEntry(draft, id); });
        if (removed) toast('Record removed.', function () {
          var restored = transact(function (draft) {
            draft.entries.push(removed.value);
            if (!M.validateState(draft)) throw new Error('This activity has been recorded again. The old record cannot be restored.');
          });
          if (restored) toast('Record restored.');
        });
      });
    } else if (action === 'restore-task') {
      result = transact(function (draft) { M.restoreTask(draft, id); });
      if (result) toast('Activity restored.');
    }
  }
  function download(name, text) {
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var anchor = document.createElement('a');
    anchor.href = url; anchor.download = name;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  function exportData() {
    if (rawUnreadable !== null) { download('prokope-recovery-' + today + '.json', rawUnreadable); return; }
    download('prokope-' + today + '.json', JSON.stringify({ format: 'prokope-daily', version: 1, exportedAt: new Date().toISOString(), data: state }, null, 2));
    toast('Backup downloaded. Keep it somewhere safe.');
  }
  async function restoreData(file) {
    if (!file || restoreBusy) return;
    restoreBusy = true;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Choose a backup smaller than 20 MB.');
      var imported = JSON.parse(await file.text());
      var next = imported && imported.format === 'prokope-daily' ? imported.data : imported;
      if (!M.validateState(next)) throw new Error('This is not a valid daily tracker backup. Your current data is unchanged.');
      var accepted = await confirmAction('Restore this backup?', 'Replace this tracker with ' + next.tasks.length + ' activities and ' + next.entries.length + ' records? A local copy of the current tracker will be kept. Your old nightly ledger is unaffected.', 'Restore backup');
      if (!accepted) return;
      var old = localStorage.getItem(KEY);
      if (old) localStorage.setItem(KEY + '.before-restore', old);
      var result = transact(function (draft) {
        draft.version = next.version; draft.tasks = next.tasks; draft.entries = next.entries;
      }, { recovery: true });
      if (result) { $('settings-dialog').close(); toast('Backup restored.'); }
    } catch (error) { toast(error instanceof SyntaxError ? 'This file is not valid JSON. Your data is unchanged.' : error.message); }
    finally { restoreBusy = false; $('restore-file').value = ''; }
  }
  function settings() {
    $('settings-feedback').hidden = true;
    var legacy = false, safetyCopy = false;
    try { legacy = !!localStorage.getItem(LEGACY_KEY); safetyCopy = !!localStorage.getItem(KEY + '.before-restore'); } catch (_) { /* Show storage status below. */ }
    $('export-legacy').hidden = !legacy;
    var backupBytes = new Blob([JSON.stringify({ format: 'prokope-daily', version: 1, exportedAt: new Date().toISOString(), data: state }, null, 2)]).size;
    var backupSize = backupBytes < 1024 ? backupBytes + ' B' : backupBytes < 1048576 ? Math.ceil(backupBytes / 1024) + ' KB' : (backupBytes / 1048576).toFixed(1) + ' MB';
    $('storage-status').textContent = storageLocked ? 'Saved data could not be opened. Download a recovery copy before restoring.' : state.tasks.length + ' activities · ' + state.entries.length + ' records · Backup: ' + backupSize;
    // Expose the retained restore safety copy without adding another destructive action.
    var safetyButton = $('export-safety-copy');
    if (!safetyButton) {
      safetyButton = document.createElement('button'); safetyButton.id = 'export-safety-copy'; safetyButton.type = 'button'; safetyButton.className = 'secondary-button'; safetyButton.textContent = 'Download pre-restore copy';
      safetyButton.addEventListener('click', function () { try { var raw = localStorage.getItem(KEY + '.before-restore'); if (raw) download('prokope-before-restore.json', raw); } catch (_) { toast('The safety copy could not be read.'); } });
      $('export-data').parentNode.appendChild(safetyButton);
    }
    safetyButton.hidden = !safetyCopy;
    $('settings-dialog').showModal();
  }
  function setupWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (updateRequested) location.reload(); });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(function (registration) {
      function notice() {
        if (registration.waiting && navigator.serviceWorker.controller) { waitingWorker = registration.waiting; $('update-banner').hidden = false; }
      }
      notice();
      registration.addEventListener('updatefound', function () {
        var worker = registration.installing;
        if (worker) worker.addEventListener('statechange', notice);
      });
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') registration.update().catch(function () {}); });
    }).catch(function () { warning('Offline files could not be prepared yet. Reopen the app while connected to finish offline setup. Your records are still saved on this device.'); });
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.view) switchView(button.dataset.view);
    else if (button.dataset.action) handleAction(button);
    else if (button.hasAttribute('data-close-dialog')) button.closest('dialog').close();
  });
  $('add-event').addEventListener('click', function () { eventEditor.open(); });
  $('add-task').addEventListener('click', function () { openTask(); });
  $('task-kind').addEventListener('change', updateForm);
  $('task-repeat').addEventListener('change', updateForm);
  $('task-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var id = $('task-id').value, kind = $('task-kind').value;
    var input = {
      name: $('task-name').value, color: $('task-color').value, kind: kind, tracking: $('task-tracking').value,
      schedule: { type: $('task-repeat').value, startDate: $('task-startdate').value, date: $('task-date').value, time: kind === 'optional' ? '' : $('task-time').value,
        weekdays: Array.from(document.querySelectorAll('[name="weekday"]:checked'), function (el) { return Number(el.value); }), interval: Number($('task-interval').value), monthDay: Number($('task-monthday').value) }
    };
    // Validate on a copy so an error appears in the form before any storage change.
    try {
      var preview = clone(state);
      if (id) M.updateTask(preview, id, input); else M.createTask(preview, input);
    } catch (error) { $('task-error').textContent = error.message; $('task-error').hidden = false; return; }
    var saveMessage = '';
    var result = transact(function (draft) {
      if (id && JSON.stringify(draft.tasks.find(function (item) { return item.id === id; })) !== JSON.stringify(taskOriginal)) {
        throw new Error('This activity changed in another window. Close and reopen it before editing.');
      }
      return id ? M.updateTask(draft, id, input) : M.createTask(draft, input);
    }, { onError: function (error) { saveMessage = error.message; } });
    if (result) { todayPanel = 'tasks'; renderTodayPanel(); renderGlance(); rememberView(); $('task-dialog').close(); toast(id ? 'Activity updated.' : 'Activity added.'); }
    else { $('task-error').textContent = saveMessage || 'The activity could not be saved. Check the storage message and try again.'; $('task-error').hidden = false; }
  });
  $('task-archive').addEventListener('click', function () {
    var id = $('task-id').value;
    confirmAction('Archive this activity?', 'It will leave your daily lists. Its history stays, and you can restore it from Activities.', 'Archive activity').then(function (confirmed) {
      if (!confirmed) return;
      var result = transact(function (draft) { M.archiveTask(draft, id); });
      if (result) { $('task-dialog').close(); toast('Archived. Your history is kept.'); }
    });
  });
  $('task-delete').addEventListener('click', async function () {
    if (await requestTaskDeletion($('task-id').value, JSON.stringify(taskOriginal))) $('task-dialog').close();
  });
  $('delete-task-cancel').addEventListener('click', function () { closeTaskDeletion(false); });
  $('delete-task-dialog').addEventListener('cancel', function (event) { event.preventDefault(); closeTaskDeletion(false); });
  $('delete-task-confirm').addEventListener('click', confirmTaskDeletion);
  $('delete-task-records').addEventListener('change', function () {
    $('delete-records-hint').textContent = this.checked ? 'These records and their times will be permanently deleted too.' : 'Your past records will stay on the timeline.';
  });
  $('record-tracking').addEventListener('change', recordFields);
  $('record-form').addEventListener('submit', function (event) {
    event.preventDefault();
    try {
      var original = recordOriginal;
      var start = inputInstant($('record-date').value, $('record-start').value, original ? original.startOffset : undefined, original && original.startAt, original && original.date);
      var tracking = original ? original.tracking : $('record-tracking').value;
      var end = tracking === 'check' ? start : original && original.endAt === null ? null : inputInstant($('record-end-date').value, $('record-end').value, original ? original.endOffset : undefined, original && original.endAt, original && original.endDate);
      var input = { title: $('record-title').value, tracking: tracking, startAt: start.stamp, startOffset: start.offset, endAt: end ? end.stamp : null, endOffset: end ? end.offset : null, note: $('record-note').value, color: $('record-color').value };
      var preview = clone(state);
      if (original) M.updateEntry(preview, original.id, input); else M.createManualEntry(preview, input);
      var saveMessage = '';
      var result = transact(function (draft) {
        if (original && JSON.stringify(draft.entries.find(function (entry) { return entry.id === original.id; })) !== JSON.stringify(original)) {
          throw new Error('This record changed in another window. Close and reopen it before editing.');
        }
        return original ? M.updateEntry(draft, original.id, input) : M.createManualEntry(draft, input);
      }, { onError: function (error) { saveMessage = error.message; } });
      if (!result) { $('record-error').textContent = saveMessage || 'The record could not be saved. Check available storage and try again.'; $('record-error').hidden = false; return; }
      $('record-dialog').close();
      if (!original) {
        selected = result.value.date; render();
        undoEntry(result.value, 'Added at ' + clock(result.value.startAt, result.value.startOffset) + '.');
      } else toast('Record updated. Your other moments are unchanged.');
    } catch (error) { $('record-error').textContent = error.message; $('record-error').hidden = false; }
  });
  $('record-delete').addEventListener('click', function () {
    var id = $('record-id').value;
    confirmAction('Remove this record?', 'Its activity stays in your list. Only this moment and its times will be removed.', 'Remove record').then(function (accepted) {
      if (!accepted) return;
      var removed = transact(function (draft) { return M.deleteEntry(draft, id); });
      if (removed) { $('record-dialog').close(); toast('Record removed.', function () {
        var restored = transact(function (draft) { draft.entries.push(removed.value); });
        if (restored) toast('Record restored.');
      }); }
    });
  });
  $('history-search').addEventListener('input', renderHistory);
  document.querySelectorAll('[data-today-panel]').forEach(function (button) {
    button.addEventListener('click', function () {
      todayPanel = button.dataset.todayPanel;
      renderTodayPanel(); renderMaps(); renderGlance(); rememberView();
    });
  });
  document.addEventListener('scroll', function (event) {
    if (event.target.matches && event.target.matches('.day-scroll')) captureMapPosition(event.target.dataset.map);
  }, true);
  $('calendar-day-details').addEventListener('toggle', function () { renderMaps(); rememberView(); });
  $('library-search').addEventListener('input', function () { renderLibrary(); rememberView(); });
  $('library-kind').addEventListener('change', function () { renderLibrary(); rememberView(); });
  $('calendar-search').addEventListener('input', function () { renderCalendar(); rememberView(); });
  $('calendar-date-picker').addEventListener('change', function () {
    try { M.addDays(this.value, 0); selected = this.value; render(); }
    catch (_) { this.value = selected; }
  });
  document.querySelectorAll('[data-calendar-filter]').forEach(function (button) {
    button.addEventListener('click', function () { calendarFilter = button.dataset.calendarFilter; renderCalendar(); rememberView(); });
  });
  var mapPointer = null;
  document.addEventListener('pointerdown', function (event) {
    var canvas = event.target.closest('.day-canvas');
    mapPointer = canvas ? { canvas: canvas, x: event.clientX, y: event.clientY, scrollTop: canvas.parentElement.scrollTop } : null;
  }, { passive: true });
  document.addEventListener('click', function (event) {
    var canvas = event.target.closest('.day-canvas');
    if (!canvas || event.target.closest('button') || !mapPointer || mapPointer.canvas !== canvas || Math.abs(event.clientY - mapPointer.y) > 8 || Math.abs(event.clientX - mapPointer.x) > 8 || Math.abs(canvas.parentElement.scrollTop - mapPointer.scrollTop) > 4) return;
    var box = canvas.getBoundingClientRect();
    var minute = Math.max(0, Math.min(1425, Math.round((event.clientY - box.top - 24) / 15) * 15));
    mapPointer = null;
    eventEditor.open(null, selected, minuteLabel(minute));
  });
  $('quick-log-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var result = transact(function (draft) { return M.logEntry(draft, $('quick-log-name').value); });
    if (result) { $('quick-log-name').value = ''; undoEntry(result.value, 'Recorded at ' + clock(result.value.startAt) + '.'); }
  });
  $('previous-day').addEventListener('click', function () { selected = M.addDays(selected, -1); render(); });
  $('next-day').addEventListener('click', function () { selected = M.addDays(selected, 1); render(); });
  $('today-button').addEventListener('click', function () { selected = M.localDate(); render(); });
  $('date-picker').addEventListener('change', function () { try { M.addDays(this.value, 0); selected = this.value; render(); } catch (_) { this.value = selected; } });
  $('show-archived').addEventListener('change', render);
  $('open-settings').addEventListener('click', settings);
  $('export-data').addEventListener('click', exportData);
  $('export-legacy').addEventListener('click', function () {
    try { var raw = localStorage.getItem(LEGACY_KEY); if (raw) download('prokope-nightly-ledger-' + today + '.json', raw); }
    catch (_) { toast('The old ledger could not be read.'); }
  });
  $('restore-file').addEventListener('change', function () { restoreData(this.files[0]); });
  $('request-persistence').addEventListener('click', async function () {
    if (!navigator.storage || !navigator.storage.persist) { toast('This browser manages storage automatically. Keep a downloaded backup.'); return; }
    try { toast(await navigator.storage.persist() ? 'Persistent storage enabled. Keep backups too.' : 'The browser manages storage automatically. A downloaded backup is still the best safeguard.'); }
    catch (_) { toast('Storage protection is unavailable here. Keep a downloaded backup.'); }
  });
  $('confirm-accept').addEventListener('click', function () { resolveConfirm(true); });
  $('confirm-cancel').addEventListener('click', function () { resolveConfirm(false); });
  $('confirm-dialog').addEventListener('cancel', function (event) { event.preventDefault(); resolveConfirm(false); });
  $('toast-undo').addEventListener('click', function () { var undo = undoAction; undoAction = null; if (undo) undo(); });
  $('toast-close').addEventListener('click', function () { $('toast').hidden = true; undoAction = null; });
  $('apply-update').addEventListener('click', function () {
    if (!waitingWorker) return;
    if ($('task-dialog').open || $('record-dialog').open || $('event-dialog').open) { toast('Save or close your changes before updating.'); return; }
    if ($('quick-log-name').value.trim()) { toast('Log your current note or clear it before updating.'); return; }
    updateRequested = true; waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  });
  window.addEventListener('storage', function (event) {
    if (event.key === KEY || event.key === null) {
      try {
        var raw = localStorage.getItem(KEY);
        var next = raw === null ? M.newState() : JSON.parse(raw);
        if (!M.validateState(next)) throw new Error('Invalid saved data');
        state = next; undoAction = null; storageLocked = false; rawUnreadable = null;
        $('toast-undo').hidden = true;
        warning(''); render();
      } catch (_) {
        try { rawUnreadable = localStorage.getItem(KEY); } catch (ignored) { /* Storage is unavailable. */ }
        warning('Another window changed the saved data, but it could not be read. Download a recovery copy in Settings before restoring a backup.'); storageLocked = true;
      }
    }
  });
  function refreshClock() {
    var instant = new Date(), now = M.localDate(instant), minute = T.clock24(instant);
    $('live-clock-value').textContent = minute + ':' + String(instant.getSeconds()).padStart(2, '0');
    $('live-clock-value').dateTime = instant.toISOString();
    if (now !== today) { if (selected === today) selected = now; today = now; render(); }
    document.querySelectorAll('.now-line').forEach(function (line) { line.style.top = T.minutesAt(instant) / 1440 * 100 + '%'; line.querySelector('span').textContent = 'Now ' + minute; });
    document.querySelectorAll('.overview-now').forEach(function (line) { line.style.left = T.minutesAt(instant) / 1440 * 100 + '%'; });
    if (clockMinute !== minute) {
      clockMinute = minute;
      renderGlance();
      if (M.activeEntries(state).length) {
        renderMaps();
        var entries = M.entriesForDate(state, selected), due = dailyTasks(selected);
        $('day-summary').innerHTML = summary(entries, due);
        $('history-summary').innerHTML = summary(entries, due);
        renderCalendar();
      }
    }
    document.querySelectorAll('[data-elapsed]').forEach(function (el) { var entry = state.entries.find(function (item) { return item.id === el.dataset.elapsed; }); if (entry) el.textContent = elapsed(entry); });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refreshClock(); });
  setInterval(refreshClock, 1000);
  load();
  restoreView();
  render();
  refreshClock();
  setupWorker();
})();
