/* A month at a glance, with plans and recorded moments kept distinct. */
(function (root, factory) {
  var calendar = factory(
    typeof module === 'object' && module.exports ? require('./model.js') : root.ProkopeModel,
    typeof module === 'object' && module.exports ? require('./timeline.js') : root.ProkopeTimeline
  );
  if (typeof module === 'object' && module.exports) module.exports = calendar;
  if (root) root.ProkopeCalendar = calendar;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, T) {
  'use strict';
  var DEFAULT_COLOR = '#55786a', TASK_COLOR = '#8a795c', RECORD_COLOR = '#547c83';
  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function color(value, fallback) { return /^#[a-f\d]{6}$/i.test(value || '') ? value : fallback; }
  function monthStart(key) { M.addDays(key, 0); return key.slice(0, 7) + '-01'; }
  function shiftMonth(key, delta) {
    if (!Number.isInteger(delta)) throw new Error('Choose a whole number of months.');
    key = monthStart(key);
    var index = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + delta;
    var year = Math.floor(index / 12), month = index % 12 + 1;
    if (year < 1 || year > 9999) throw new Error('Choose a date between years 1 and 9999.');
    return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-01';
  }
  function label(key, options) { return new Date(key + 'T12:00:00').toLocaleDateString(undefined, options); }
  function minuteLabel(value) { return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(Math.floor(value % 60)).padStart(2, '0'); }
  function hours(minutes) {
    if (!minutes) return '0h';
    if (minutes < 60) return Math.round(minutes) + 'm';
    var value = Math.round(minutes / 60 * 10) / 10;
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'h';
  }
  function lowerBound(keys, key) {
    var low = 0, high = keys.length;
    while (low < high) { var middle = (low + high) >>> 1; if (keys[middle] < key) low = middle + 1; else high = middle; }
    return low;
  }
  function searchText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  }
  function buildData(state, selected, today, month, options) {
    options = options || {};
    var filter = ['events', 'records'].indexOf(options.filter) >= 0 ? options.filter : 'all';
    var query = typeof options.query === 'string' ? options.query.trim().slice(0, 160) : '';
    var terms = searchText(query).split(/\s+/).filter(Boolean);
    month = monthStart(month || selected);
    var weekday = new Date(month + 'T12:00:00').getDay();
    var first;
    try { first = M.addDays(month, -(weekday + 6) % 7); } catch (_) { first = month; }
    var keys = [];
    for (var index = 0; index < 42; index++) {
      try { keys.push(M.addDays(first, index)); } catch (_) { break; }
    }
    var allKeys = Array.from(new Set(keys.concat([selected]))).sort(), records = {};
    allKeys.forEach(function (key) { records[key] = []; });
    // Index only the dates being shown. A large archive should not be rescanned
    // for each calendar cell, and years-long timers should not expand by day.
    state.entries.forEach(function (entry) {
      var last = entry.endDate || today;
      if (entry.tracking !== 'timer' || last < entry.date) {
        if (records[entry.date]) records[entry.date].push(entry);
        if (last < entry.date && records[last]) records[last].push(entry);
        return;
      }
      for (var position = lowerBound(allKeys, entry.date); position < allKeys.length && allKeys[position] <= last; position++) {
        records[allKeys[position]].push(entry);
      }
    });
    var cache = {}, metrics = { plannedMinutes: 0, recordedMs: 0, recordedDays: 0, events: 0 };
    allKeys.forEach(function (key) {
      var items = [], occurrences = M.eventOccurrencesForDate(state, key);
      // Completion may be recorded on another date; a fulfilled plan should not
      // appear a second time as an unfinished task on its original date.
      cache[key] = { date: key, items: items, recordedMs: 0, hasRecords: false };
      occurrences.forEach(function (part) {
        var task = part.task;
        var time = part.allDay ? 'All day' : minuteLabel(part.startMinute) + (!part.point ? '–' + minuteLabel(part.endMinute) : '');
        items.push({ type: 'event', id: task.id, title: task.name, color: color(task.color, DEFAULT_COLOR), time: time,
          startMinute: part.allDay ? -1 : part.startMinute, occurrenceDate: part.occurrenceDate,
          status: part.continuesBefore ? 'From previous day' : part.continuesAfter ? 'Continues tomorrow' : 'Scheduled',
          note: task.note || '', location: task.location || '', allDay: part.allDay });
        if (key.slice(0, 7) === month.slice(0, 7)) {
          if (!part.allDay) metrics.plannedMinutes += Math.max(0, part.endMinute - part.startMinute);
          if (!part.continuesBefore) metrics.events++;
        }
      });
      records[key].forEach(function (entry) {
        var part = T.segment(entry, key);
        if (!part) return;
        cache[key].hasRecords = true;
        cache[key].recordedMs += part.durationMs;
        items.push({ type: 'record', id: entry.id, title: entry.title, color: color(entry.color, RECORD_COLOR),
          time: minuteLabel(part.startMinute) + (!part.point ? '–' + minuteLabel(part.endMinute) : ''),
          startMinute: part.startMinute, status: entry.endAt === null ? 'In progress' : 'Recorded', note: entry.note || '' });
      });
      if (key.slice(0, 7) === month.slice(0, 7)) {
        metrics.recordedMs += cache[key].recordedMs;
        if (cache[key].hasRecords) metrics.recordedDays++;
      }
    });
    var fulfilled = new Set(), fulfilledPlanned = new Set();
    state.entries.forEach(function (entry) {
      if (entry.taskId) fulfilled.add(entry.taskId + ':' + entry.occurrenceDate);
      if (entry.kind === 'planned') fulfilledPlanned.add(entry.taskId);
    });
    allKeys.forEach(function (key) {
      M.tasksForDate(state, key).forEach(function (task) {
        if (task.kind === 'event' || fulfilled.has(task.id + ':' + key) || (task.kind === 'planned' && fulfilledPlanned.has(task.id))) return;
        var time = task.schedule.time;
        cache[key].items.push({ type: 'task', id: task.id, title: task.name, color: color(task.color, TASK_COLOR),
          time: time || 'Any time', startMinute: time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : 1441,
          status: task.kind === 'routine' ? 'Routine' : 'To do', note: '' });
      });
      cache[key].items.sort(function (a, b) { return a.startMinute - b.startMinute || a.title.localeCompare(b.title); });
    });
    var monthMatches = 0;
    allKeys.forEach(function (key) {
      var day = cache[key];
      day.totalItems = day.items.length;
      day.items = day.items.filter(function (item) {
        if (filter === 'events' && item.type !== 'event' || filter === 'records' && item.type !== 'record') return false;
        var text = searchText(item.title + ' ' + (item.location || '') + ' ' + (item.note || ''));
        return terms.every(function (term) { return text.indexOf(term) >= 0; });
      });
      if (key.slice(0, 7) === month.slice(0, 7)) monthMatches += day.items.length;
    });
    return { month: month, days: keys.map(function (key) { return cache[key]; }), selected: cache[selected], metrics: metrics,
      filter: filter, query: query, filtered: filter !== 'all' || !!query, monthMatches: monthMatches };
  }
  function arrow(back) {
    return '<svg class="icon' + (back ? ' icon-back' : '') + '" aria-hidden="true"><use href="#i-chevron"/></svg>';
  }
  function dayCell(day, month, selected, today) {
    var muted = day.date.slice(0, 7) !== month.slice(0, 7), items = day.items, count = items.length;
    var title = label(day.date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    var chips = items.slice(0, 3).map(function (item) {
      return '<span class="calendar-chip calendar-chip-' + item.type + '" style="--item-color:' + item.color + '"><span class="calendar-color-dot"></span><span class="calendar-chip-name">' + escape(item.title) + '</span></span>';
    }).join('');
    return '<button type="button" class="calendar-day' + (muted ? ' is-outside' : '') + (day.date === selected ? ' is-selected' : '') + (day.date === today ? ' is-today' : '') + '" data-action="calendar-day" data-date="' + day.date + '" aria-pressed="' + (day.date === selected) + '"' + (day.date === today ? ' aria-current="date"' : '') + ' aria-label="' + escape(title + ', ' + count + (count === 1 ? ' item' : ' items')) + '"><span class="calendar-day-number">' + Number(day.date.slice(-2)) + '</span><span class="calendar-chips" aria-hidden="true">' + chips + '</span>' + (count > 3 ? '<span class="calendar-more" aria-hidden="true">+' + (count - 3) + '<span> more</span></span>' : '') + '</button>';
  }
  function agendaItem(item) {
    var action = item.type === 'event' ? 'edit-event' : item.type === 'record' ? 'edit-entry' : 'edit';
    return '<button type="button" class="calendar-agenda-item calendar-agenda-' + item.type + '" data-action="' + action + '" data-id="' + escape(item.id) + '"' + (item.occurrenceDate ? ' data-date="' + item.occurrenceDate + '"' : '') + ' style="--item-color:' + item.color + '"><span class="calendar-agenda-marker" aria-hidden="true"></span><span class="calendar-agenda-copy"><span class="calendar-agenda-time">' + escape(item.time) + '<span class="calendar-status">' + escape(item.status) + '</span></span><span class="calendar-agenda-title">' + escape(item.title) + '</span>' + (item.location ? '<span class="calendar-agenda-location">' + escape(item.location) + '</span>' : '') + (item.note ? '<span class="calendar-agenda-note">' + escape(item.note) + '</span>' : '') + '</span><svg class="icon calendar-agenda-arrow" aria-hidden="true"><use href="#i-chevron"/></svg></button>';
  }
  function render(container, options) {
    var active = typeof document !== 'undefined' && container.contains(document.activeElement) ? document.activeElement : null;
    var focus = active && active.dataset ? { action: active.dataset.action, date: active.dataset.date, id: active.dataset.id, delta: active.dataset.delta } : null;
    var selected = options.selected, today = options.today || M.localDate();
    var oldAgenda = container.querySelector && container.querySelector('.calendar-agenda-list');
    var data = buildData(options.state, selected, today, options.month, options);
    var agendaScroll = oldAgenda && oldAgenda.dataset.date === selected && oldAgenda.dataset.filter === data.filter && oldAgenda.dataset.query === data.query ? oldAgenda.scrollTop : 0;
    var monthLabel = label(data.month, { month: 'long', year: 'numeric' });
    var metrics = data.metrics;
    container.innerHTML = (data.filtered ? '<p class="calendar-filter-note" role="status">' + data.monthMatches + (data.monthMatches === 1 ? ' match this month' : ' matches this month') + '</p>' : '') + '<div class="calendar-workspace"><section class="calendar-month-panel" aria-labelledby="calendar-month-label"><div class="calendar-toolbar"><h2 id="calendar-month-label">' + escape(monthLabel) + '</h2><div class="calendar-nav"><button type="button" class="text-button" data-action="calendar-today">Today</button><button type="button" class="icon-button" data-action="calendar-month" data-delta="-1" aria-label="Previous month"' + (data.month === '0001-01-01' ? ' disabled' : '') + '>' + arrow(true) + '</button><button type="button" class="icon-button" data-action="calendar-month" data-delta="1" aria-label="Next month"' + (data.month === '9999-12-01' ? ' disabled' : '') + '>' + arrow(false) + '</button></div></div><div class="calendar-weekdays" aria-hidden="true">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (day) { return '<span>' + day + '</span>'; }).join('') + '</div><div class="calendar-grid" role="group" aria-label="' + escape(monthLabel) + '">' + data.days.map(function (day) { return dayCell(day, data.month, selected, today); }).join('') + '</div><div class="calendar-legend"><span><i class="calendar-legend-event"></i>Scheduled</span><span><i class="calendar-legend-task"></i>To do</span><span><i class="calendar-legend-record"></i>Recorded</span></div></section><section class="calendar-agenda" aria-labelledby="calendar-agenda-title"><div class="calendar-agenda-heading"><div><p class="section-kicker">' + escape(label(selected, { weekday: 'long' })) + '</p><h2 id="calendar-agenda-title">' + escape(label(selected, { month: 'long', day: 'numeric' })) + '</h2></div><button type="button" class="icon-button calendar-add-event" data-action="new-event" data-date="' + selected + '" aria-label="Add event on ' + escape(label(selected, { month: 'long', day: 'numeric' })) + '"><svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg></button></div><div class="calendar-agenda-list" data-date="' + selected + '" data-filter="' + data.filter + '" data-query="' + escape(data.query) + '">' + (data.selected.items.length ? data.selected.items.map(agendaItem).join('') : data.filtered ? '<div class="calendar-empty calendar-no-matches"><svg class="icon" aria-hidden="true"><use href="#i-grid"/></svg><p>No matching items.</p><span class="calendar-empty-hint">Try another date or change the filters.</span></div>' : '<div class="calendar-empty"><span aria-hidden="true">☀</span><p>A little open space.</p><button type="button" class="text-button" data-action="new-event" data-date="' + selected + '">+ Add an event</button></div>') + '</div></section></div><section class="calendar-insights" aria-label="' + escape(monthLabel) + ' totals"><div class="calendar-insight-heading"><p class="section-kicker">FULL MONTH</p><span>' + metrics.events + (metrics.events === 1 ? ' event' : ' events') + '</span></div><div class="calendar-insight"><strong>' + hours(metrics.plannedMinutes) + '</strong><span>Planned time<small>Timed events</small></span></div><div class="calendar-insight"><strong>' + hours(metrics.recordedMs / 60000) + '</strong><span>Recorded time<small>Activity timers</small></span></div><div class="calendar-insight"><strong>' + metrics.recordedDays + '</strong><span>Days recorded<small>Any saved moment</small></span></div></section>';
    var agenda = container.querySelector && container.querySelector('.calendar-agenda-list');
    if (agenda) agenda.scrollTop = agendaScroll;
    if (focus && focus.action) {
      var controls = Array.from(container.querySelectorAll('[data-action]'));
      var target = controls.find(function (button) {
        return button.dataset.action === focus.action && button.dataset.date === focus.date && button.dataset.id === focus.id && button.dataset.delta === focus.delta;
      });
      if (!target && focus.action === 'calendar-day') target = controls.find(function (button) { return button.dataset.action === 'calendar-day' && button.dataset.date === selected; });
      if (target) target.focus({ preventScroll: true });
    }
    return data;
  }
  return { render: render, buildData: buildData, monthStart: monthStart, shiftMonth: shiftMonth };
});
