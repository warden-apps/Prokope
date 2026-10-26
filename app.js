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
  var clockMinute = '', recordOriginal = null;
  var mapDates = { today: '', history: '' };

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
  function taskCard(task, library) {
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
    return '<article class="task-card' + (library ? ' library-card' : '') + (done ? ' is-done' : '') + (active ? ' is-running' : '') + '"><div class="task-icon ' + task.kind + '">' + icon(task.kind) + '</div><div class="task-content"><h3 class="task-name">' + escape(task.name) + '</h3><p class="task-meta">' + escape(meta) + (task.archivedAt ? ' · Archived' : '') + '</p></div><div class="task-actions">' + actions + '</div></article>';
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
      return '<article class="timeline-item' + (entry.endAt === null ? ' is-running' : '') + '"><time class="timeline-time" datetime="' + entry.startAt + '">' + escape(clock(entry.startAt, entry.startOffset)) + '</time><span class="timeline-dot"></span><div class="timeline-content"><h3 class="timeline-title">' + escape(entry.title) + '</h3><p class="timeline-detail">' + escape(label) + '</p>' + (entry.note ? '<p class="entry-detail-note">' + escape(entry.note) + '</p>' : '') + '</div><div class="timeline-actions">' + actions + '</div></article>';
    }).join('');
  }
  function minuteLabel(minute) {
    if (minute >= 1440) return '24:00';
    return String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(Math.floor(minute % 60)).padStart(2, '0');
  }
  function dayMap(containerId, name, entries, due) {
    var container = $(containerId), previous = container.querySelector('.day-scroll');
    var scrollTop = previous && mapDates[name] === selected ? previous.scrollTop : null;
    var focus = container.contains(document.activeElement) ? document.activeElement.dataset.entryId || document.activeElement.dataset.taskId || '' : '';
    var items = [];
    entries.forEach(function (entry) {
      var segment = T.segment(entry, selected);
      if (segment) items.push(Object.assign(segment, { entry: entry }));
    });
    due.forEach(function (task) {
      if (!task.schedule.time || !M.isDue(task, selected) || taskEntry(task, task.kind === 'planned' ? task.schedule.date : selected)) return;
      var parts = task.schedule.time.split(':').map(Number), minute = parts[0] * 60 + parts[1];
      items.push({ id: task.id, task: task, startMinute: minute, endMinute: minute, point: true });
    });
    var positioned = T.layout(items, 46);
    var hours = Array.from({ length: 25 }, function (_, hour) {
      return '<div class="hour-row" style="top:calc(24px + var(--day-height) * ' + hour / 24 + ')"><span class="hour-label">' + String(hour).padStart(2, '0') + ':00</span><span class="hour-rule"></span></div>';
    }).join('');
    var marks = positioned.map(function (item) {
      var entry = item.entry, planned = !!item.task;
      var title = planned ? item.task.name : entry.title;
      var times = planned ? item.task.schedule.time + ' · Planned' : clock(entry.startAt, entry.startOffset);
      var detail = planned ? 'Not recorded' : item.point ? 'Recorded' : entry.endAt ? clock(entry.startAt, entry.startOffset) + '–' + clock(entry.endAt, entry.endOffset) + ' · ' + elapsed(entry) : 'In progress · ' + elapsed(entry);
      if (item.continuesBefore) times = '00:00 · Continued';
      if (item.continuesAfter && !planned) detail += ' · Continues past midnight';
      if (item.clockShift) detail += ' · Clock changed';
      var classes = (planned ? ' is-planned' : item.point ? ' is-point' : ' is-timer') + (item.running ? ' is-running' : '');
      var span = item.displayEnd - item.displayStart;
      var shortTimer = !planned && !item.point && item.endMinute - item.startMinute < 46;
      if (shortTimer) {
        classes += ' is-short';
        times += ' · ' + elapsed(entry);
      }
      var durationBar = shortTimer ? '<span class="event-duration-bar" style="top:' + (item.startMinute - item.displayStart) / span * 100 + '%;height:' + Math.max(1, (item.endMinute - item.startMinute) / span * 100) + '%"></span>' : '';
      var attrs = planned ? ' data-action="edit" data-id="' + escape(item.task.id) + '" data-task-id="' + escape(item.task.id) + '"' : ' data-action="edit-entry" data-id="' + escape(entry.id) + '" data-entry-id="' + escape(entry.id) + '"';
      return '<button type="button" class="map-event' + classes + '"' + attrs + ' data-start-minute="' + item.startMinute + '" data-end-minute="' + item.endMinute + '" style="top:' + item.displayStart / 1440 * 100 + '%;height:' + span / 1440 * 100 + '%;left:' + item.lane / item.lanes * 100 + '%;width:calc(' + 100 / item.lanes + '% - 5px)" aria-label="' + escape(title + ' · ' + times + ' · ' + detail) + '">' + durationBar + '<span class="event-anchor" style="top:' + Math.min(98, Math.max(0, (item.startMinute - item.displayStart) / span * 100)) + '%"></span><span class="event-clock">' + escape(times) + '</span><span class="event-title">' + escape(title) + '</span>' + (!item.point && span >= 76 ? '<span class="event-duration">' + escape(detail) + '</span>' : '') + '</button>';
    }).join('');
    var mini = positioned.map(function (item) {
      return '<button type="button" class="overview-mark' + (item.task ? ' is-planned' : '') + (item.running ? ' is-running' : '') + '" style="left:' + item.startMinute / 1440 * 100 + '%;width:max(3px,' + Math.max(0, item.endMinute - item.startMinute) / 1440 * 100 + '%)" data-action="jump-minute" data-map="' + name + '" data-minute="' + item.startMinute + '" aria-label="Jump to ' + escape(minuteLabel(item.startMinute) + ': ' + (item.task ? item.task.name : item.entry.title)) + '"></button>';
    }).join('');
    var now = selected === today ? '<div class="now-line" style="top:' + T.minutesAt(new Date()) / 1440 * 100 + '%"><span>Now ' + clock(new Date()) + '</span></div>' : '';
    container.innerHTML = '<div class="day-overview" aria-label="Whole-day overview">' + mini + (selected === today ? '<span class="overview-now" style="left:' + T.minutesAt(new Date()) / 1440 * 100 + '%"></span>' : '') + '</div><div class="overview-labels" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div><div class="day-scroll" data-map="' + name + '" tabindex="0" role="region" aria-label="' + escape(dateLabel(selected)) + ', 00:00 to 24:00; scroll to explore"><div class="day-canvas" style="--day-height:1440px">' + hours + '<div class="map-lanes">' + marks + now + '</div></div></div>' + (!items.length ? '<p class="map-empty-hint">' + (selected > today ? 'An open day. Give a plan a time to place it here.' : 'No moments recorded yet. Your first one will find its place here.') + '</p>' : '');
    var scroller = container.querySelector('.day-scroll');
    if (scrollTop !== null) scroller.scrollTop = scrollTop;
    else scroller.scrollTop = Math.max(0, (selected === today ? T.minutesAt(new Date()) - 120 : positioned.length ? positioned[0].startMinute - 60 : 0));
    mapDates[name] = selected;
    if (focus) {
      var target = Array.from(container.querySelectorAll('.map-event')).find(function (button) { return button.dataset.entryId === focus || button.dataset.taskId === focus; });
      if (target) target.focus({ preventScroll: true });
    }
  }
  function renderMaps() {
    var entries = M.entriesForDate(state, selected), due = M.tasksForDate(state, selected);
    dayMap('timeline-list', 'today', entries, due);
    dayMap('history-timeline', 'history', entries, due);
    $('history-map-date').textContent = dateLabel(selected, { month: 'long', day: 'numeric' });
    document.querySelectorAll('[data-action="jump-now"]').forEach(function (button) { button.hidden = selected !== today; });
    document.querySelectorAll('[data-action="jump-first"]').forEach(function (button) { button.disabled = !entries.length; });
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
    var completed = due.filter(function (task) { return !!(taskEntry(task, task.kind === 'planned' ? task.schedule.date : selected) || {}).endAt; }).length;
    var finished = entries.filter(function (entry) { return entry.endAt; }).length;
    var seconds = T.dayDuration(entries, selected);
    return '<div class="summary-card"><span class="summary-value">' + completed + '<small> / ' + due.length + '</small></span><span class="summary-label">Planned & routine</span></div><div class="summary-card"><span class="summary-value">' + finished + '</span><span class="summary-label">Moments recorded</span></div><div class="summary-card"><span class="summary-value">' + Math.floor(seconds / 60000) + '<small> min</small></span><span class="summary-label">Time spent</span></div>';
  }
  function renderDays() {
    $('date-picker').value = selected;
    var weekDay = dateObject(selected).getDay();
    var monday = M.addDays(selected, -(weekDay + 6) % 7);
    $('week-strip').innerHTML = Array.from({ length: 7 }, function (_, i) {
      var date = M.addDays(monday, i), hasEntries = M.entriesForDate(state, date).length > 0;
      return '<button class="week-day' + (date === selected ? ' is-selected' : '') + (date === today ? ' is-today' : '') + '" data-action="day" data-date="' + date + '" aria-label="' + escape(dateLabel(date)) + '" aria-pressed="' + (date === selected) + '"><span class="week-name">' + escape(dateLabel(date, { weekday: 'short' })) + '</span><span class="week-number">' + Number(date.slice(-2)) + '</span><span class="week-dot' + (hasEntries ? ' has-entries' : '') + '"></span></button>';
    }).join('');
  }
  function renderActive() {
    $('active-timers').innerHTML = M.activeEntries(state).map(function (entry) {
      return '<div class="running-card"><span class="running-pulse"></span><div class="task-content"><strong>' + escape(entry.title) + '</strong><p>Started ' + escape(clock(entry.startAt, entry.startOffset)) + ' <span data-elapsed="' + escape(entry.id) + '">' + escape(elapsed(entry)) + '</span></p></div>' + actionButton('finish', entry.id, icon('stop') + ' Finish', 'action-button') + '</div>';
    }).join('');
  }
  function dailyTasks(date) {
    var due = M.tasksForDate(state, date);
    if (date === today) {
      state.tasks.forEach(function (task) {
        if (task.kind === 'planned' && !task.archivedAt && task.schedule.date < today && !taskEntry(task, task.schedule.date)) due.push(task);
      });
    }
    return due;
  }
  function render() {
    today = M.localDate();
    ['today', 'library', 'history'].forEach(function (name) { $(name + '-view').hidden = view !== name; });
    document.querySelectorAll('[data-view]').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.view === view);
      if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    $('day-navigation').hidden = view === 'library';
    $('view-title').textContent = view === 'library' ? 'Make it your own.' : view === 'history' ? 'The days add up.' : selected === today ? 'A day, well spent.' : selected > today ? 'A little planning ahead.' : 'A day to look back on.';
    $('view-subtitle').textContent = view === 'library' ? 'Your routines, plans, and things you love to do.' : dateLabel(selected) + (selected === today ? ' · Today' : selected === M.addDays(today, -1) ? ' · Yesterday' : '');
    renderDays();
    renderActive();
    var due = dailyTasks(selected);
    var routines = due.filter(function (task) { return task.kind === 'routine'; });
    var planned = due.filter(function (task) { return task.kind === 'planned'; });
    var optional = state.tasks.filter(function (task) { return task.kind === 'optional' && !task.archivedAt; });
    var entries = M.entriesForDate(state, selected);
    $('day-summary').innerHTML = summary(entries, due);
    $('history-summary').innerHTML = summary(entries, due);
    $('routine-count').textContent = String(routines.length).padStart(2, '0');
    $('planned-count').textContent = String(planned.length).padStart(2, '0');
    $('routine-list').innerHTML = routines.length ? routines.map(function (task) { return taskCard(task); }).join('') : empty('Small things, done consistently.', 'Add the things you want to keep coming back to. A supplement, a walk, a little practice.', addButton('routine', 'Create a routine'));
    $('planned-list').innerHTML = planned.length ? planned.map(function (task) { return taskCard(task); }).join('') : empty('Nothing on the calendar.', 'Give a one-time task a day and, if you like, a time.', addButton('planned', 'Plan something'));
    $('optional-list').innerHTML = optional.length ? optional.map(function (task) { return taskCard(task); }).join('') : empty('Leave room for a little spontaneity.', 'Keep a list of things you enjoy. Do them when it feels right, with no streak to keep.', addButton('optional', 'Add an optional activity'));
    $('quick-log-form').hidden = selected !== today;
    $('timeline-date').textContent = selected === today ? 'TODAY’S TIMELINE' : dateLabel(selected, { month: 'short', day: 'numeric' }).toUpperCase();
    renderMaps();
    renderHistory();
    var libraryTasks = state.tasks.filter(function (task) { return $('show-archived').checked || !task.archivedAt; });
    var library = '';
    [['routine', 'Routines'], ['planned', 'Planned tasks'], ['optional', 'Optional activities']].forEach(function (group) {
      var tasks = libraryTasks.filter(function (task) { return task.kind === group[0]; });
      library += '<section class="library-group"><div class="section-heading"><h2>' + group[1] + '</h2>' + addButton(group[0], 'Add') + '</div>' + (tasks.length ? tasks.map(function (task) { return taskCard(task, true); }).join('') : empty('A space for your ' + group[1].toLowerCase() + '.', 'Start with one. You can always add more.')) + '</section>';
    });
    $('library-list').innerHTML = library;
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
    $('task-form').reset();
    $('task-id').value = task ? task.id : '';
    $('task-dialog-title').textContent = task ? 'A little adjustment.' : 'Make space for something.';
    $('task-name').value = task ? task.name : '';
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
    $('record-dialog-title').textContent = entry ? 'A moment, remembered.' : 'Fill in the picture.';
    $('record-eyebrow').textContent = entry ? 'THE ACTUAL RECORD' : 'SOMETHING YOU DID EARLIER';
    $('record-title').value = entry ? entry.title : '';
    $('record-tracking').value = entry ? entry.tracking : 'check';
    $('record-tracking-field').hidden = !!entry;
    $('record-date').value = entry ? entry.date : date;
    $('record-start').value = entry ? recordedTime(entry.startAt, entry.startOffset) : T.clock24(now) + ':' + String(now.getSeconds()).padStart(2, '0');
    $('record-end-date').value = entry && entry.endAt ? entry.endDate : date;
    $('record-end').value = entry && entry.endAt ? recordedTime(entry.endAt, entry.endOffset) : $('record-start').value;
    $('record-note').value = entry && entry.note || '';
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
    if (action === 'edit-entry') { openRecord(id); return; }
    if (action === 'log-earlier') { openRecord(); return; }
    if (action === 'jump-section') { $(button.dataset.target).scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (action === 'jump-now') { scrollMap(button.dataset.map, T.minutesAt(new Date())); return; }
    if (action === 'jump-minute') { scrollMap(button.dataset.map, Number(button.dataset.minute)); return; }
    if (action === 'jump-first') {
      var first = M.entriesForDate(state, selected).map(function (entry) { return T.segment(entry, selected); }).filter(Boolean).sort(function (a, b) { return a.startMinute - b.startMinute; })[0];
      scrollMap(button.dataset.map, first ? first.startMinute : 0); return;
    }
    if (action === 'visit-entry') {
      selected = button.dataset.date; $('history-search').value = ''; render();
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
    $('storage-status').textContent = storageLocked ? 'Saved data could not be opened. Download a recovery copy before restoring.' : state.tasks.length + ' activities · ' + state.entries.length + ' records · Stored on this device';
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
  $('add-task').addEventListener('click', function () { openTask(); });
  $('task-kind').addEventListener('change', updateForm);
  $('task-repeat').addEventListener('change', updateForm);
  $('task-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var id = $('task-id').value, kind = $('task-kind').value;
    var input = {
      name: $('task-name').value, kind: kind, tracking: $('task-tracking').value,
      schedule: { type: $('task-repeat').value, startDate: $('task-startdate').value, date: $('task-date').value, time: kind === 'optional' ? '' : $('task-time').value,
        weekdays: Array.from(document.querySelectorAll('[name="weekday"]:checked'), function (el) { return Number(el.value); }), interval: Number($('task-interval').value), monthDay: Number($('task-monthday').value) }
    };
    // Validate on a copy so an error appears in the form before any storage change.
    try {
      var preview = clone(state);
      if (id) M.updateTask(preview, id, input); else M.createTask(preview, input);
    } catch (error) { $('task-error').textContent = error.message; $('task-error').hidden = false; return; }
    var result = transact(function (draft) { return id ? M.updateTask(draft, id, input) : M.createTask(draft, input); });
    if (result) { $('task-dialog').close(); toast(id ? 'Activity updated. Past records keep their original name and times.' : 'A little intention, made concrete.'); }
    else { $('task-error').textContent = 'The activity could not be saved. Check the storage message and try again.'; $('task-error').hidden = false; }
  });
  $('task-archive').addEventListener('click', function () {
    var id = $('task-id').value;
    confirmAction('Archive this activity?', 'It will leave your daily lists. Its history stays, and you can restore it from Activities.', 'Archive activity').then(function (confirmed) {
      if (!confirmed) return;
      var result = transact(function (draft) { M.archiveTask(draft, id); });
      if (result) { $('task-dialog').close(); toast('Archived. Your history is kept.'); }
    });
  });
  $('record-tracking').addEventListener('change', recordFields);
  $('record-form').addEventListener('submit', function (event) {
    event.preventDefault();
    try {
      var original = recordOriginal;
      var start = inputInstant($('record-date').value, $('record-start').value, original ? original.startOffset : undefined, original && original.startAt, original && original.date);
      var tracking = original ? original.tracking : $('record-tracking').value;
      var end = tracking === 'check' ? start : original && original.endAt === null ? null : inputInstant($('record-end-date').value, $('record-end').value, original ? original.endOffset : undefined, original && original.endAt, original && original.endDate);
      var input = { title: $('record-title').value, tracking: tracking, startAt: start.stamp, startOffset: start.offset, endAt: end ? end.stamp : null, endOffset: end ? end.offset : null, note: $('record-note').value };
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
  $('quick-log-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var result = transact(function (draft) { return M.logEntry(draft, $('quick-log-name').value); });
    if (result) { $('quick-log-name').value = ''; undoEntry(result.value, 'Recorded at ' + clock(result.value.startAt) + '.'); }
  });
  $('previous-day').addEventListener('click', function () { selected = M.addDays(selected, -1); render(); });
  $('next-day').addEventListener('click', function () { selected = M.addDays(selected, 1); render(); });
  $('today-button').addEventListener('click', function () { selected = M.localDate(); render(); });
  $('date-picker').addEventListener('change', function () { if (this.value && /^\d{4}-\d{2}-\d{2}$/.test(this.value)) { selected = this.value; render(); } });
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
    if ($('task-dialog').open || $('record-dialog').open) { toast('Save or close your changes before updating.'); return; }
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
      if (M.activeEntries(state).length) {
        renderMaps();
        var entries = M.entriesForDate(state, selected), due = dailyTasks(selected);
        $('day-summary').innerHTML = summary(entries, due);
        $('history-summary').innerHTML = summary(entries, due);
      }
    }
    document.querySelectorAll('[data-elapsed]').forEach(function (el) { var entry = state.entries.find(function (item) { return item.id === el.dataset.elapsed; }); if (entry) el.textContent = elapsed(entry); });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refreshClock(); });
  setInterval(refreshClock, 1000);
  load();
  render();
  refreshClock();
  setupWorker();
})();
