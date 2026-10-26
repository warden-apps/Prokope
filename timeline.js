/* Calendar geometry for the 00:00–24:00 day map. No DOM or storage effects. */
(function (root, factory) {
  var timeline = factory();
  if (typeof module === 'object' && module.exports) module.exports = timeline;
  if (root) root.ProkopeTimeline = timeline;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MINUTE = 60000, DAY = 86400000;
  function pad(number) { return String(number).padStart(2, '0'); }
  function asDate(value) {
    var date = value === undefined ? new Date() : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('A valid time is required.');
    return date;
  }
  function wallDate(value, offset) {
    var date = asDate(value);
    if (offset === undefined || offset === null) return date;
    if (!Number.isFinite(offset)) throw new Error('A valid timezone offset is required.');
    return new Date(date.getTime() - offset * MINUTE);
  }
  function minutesAt(value, offset) {
    var date = wallDate(value, offset), utc = offset !== undefined && offset !== null;
    return (utc ? date.getUTCHours() : date.getHours()) * 60 +
      (utc ? date.getUTCMinutes() : date.getMinutes()) +
      (utc ? date.getUTCSeconds() : date.getSeconds()) / 60 + date.getMilliseconds() / MINUTE;
  }
  function clock24(value, offset) {
    var minutes = Math.floor(minutesAt(value, offset));
    return pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60);
  }
  function dateAt(value, offset) {
    var date = wallDate(value, offset), utc = offset !== undefined && offset !== null;
    return String(utc ? date.getUTCFullYear() : date.getFullYear()).padStart(4, '0') + '-' +
      pad((utc ? date.getUTCMonth() : date.getMonth()) + 1) + '-' + pad(utc ? date.getUTCDate() : date.getDate());
  }
  function midnight(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return NaN;
    var stamp = Date.parse(key + 'T00:00:00.000Z');
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === key ? stamp : NaN;
  }
  function clamp(number, min, max) { return Math.max(min, Math.min(max, number)); }

  function segment(entry, dateKey, now) {
    if (!entry || !Number.isFinite(midnight(dateKey))) return null;
    var start = Date.parse(entry.startAt), running = entry.endAt === null;
    var finishDate = running ? asDate(now) : asDate(entry.endAt);
    var end = finishDate.getTime();
    if (!Number.isFinite(start) || end < start) return null;
    var startOffset = Number.isFinite(entry.startOffset) ? entry.startOffset : asDate(entry.startAt).getTimezoneOffset();
    var endOffset = running ? finishDate.getTimezoneOffset() : Number.isFinite(entry.endOffset) ? entry.endOffset : finishDate.getTimezoneOffset();
    var firstDay = entry.date || dateAt(start, startOffset);
    var lastDay = running ? dateAt(end, endOffset) : entry.endDate || dateAt(end, endOffset);
    var firstMidnight = midnight(firstDay), lastMidnight = midnight(lastDay), selectedMidnight = midnight(dateKey);
    if (!Number.isFinite(firstMidnight) || !Number.isFinite(lastMidnight)) return null;
    var point = entry.tracking !== 'timer';
    if (point) {
      if (dateKey !== firstDay) return null;
      var at = minutesAt(start, startOffset);
      return { id: entry.id, startMinute: at, endMinute: at, durationMs: 0,
        continuesBefore: false, continuesAfter: false, running: false, point: true, clockShift: false };
    }

    // Crossing the date line can make the recorded finish date precede the
    // start date. There is no travel timestamp in a record, so show endpoint
    // markers instead of inventing a backwards block. Attribute elapsed time
    // once, to the start day, and flag the clock change for the detail view.
    if (lastDay < firstDay) {
      if (dateKey !== firstDay && dateKey !== lastDay) return null;
      var endpoint = dateKey === firstDay ? minutesAt(start, startOffset) : minutesAt(end, endOffset);
      return { id: entry.id, startMinute: endpoint, endMinute: endpoint,
        durationMs: dateKey === firstDay ? end - start : 0,
        continuesBefore: dateKey === lastDay, continuesAfter: dateKey === firstDay,
        running: running, point: false, clockShift: true };
    }
    if (dateKey < firstDay || dateKey > lastDay) return null;

    // Interior midnights use the recorded start offset, with the finish day's
    // boundary using its captured offset. This partitions the real duration
    // without depending on the timezone of the person viewing the history.
    // The record only stores endpoint offsets; it cannot tell us exactly when
    // a timezone or daylight-saving change happened within a multi-day timer.
    function boundary(day) {
      var value = day + (day === lastMidnight ? endOffset : startOffset) * MINUTE;
      if (day === lastMidnight && lastMidnight - firstMidnight > DAY) {
        value = Math.max(value, day - DAY + startOffset * MINUTE);
      }
      return clamp(value, start, end);
    }
    var clippedStart = dateKey === firstDay ? start : boundary(selectedMidnight);
    var clippedEnd = dateKey === lastDay ? end : boundary(selectedMidnight + DAY);
    var duration = Math.max(0, clippedEnd - clippedStart);
    // A timer finishing exactly at 00:00 belongs to the preceding day's block,
    // not a phantom zero-minute block on the following day.
    if (duration === 0 && dateKey !== firstDay) return null;
    var startMinute = dateKey === firstDay ? minutesAt(start, startOffset) : 0;
    var endMinute = dateKey === lastDay ? minutesAt(end, endOffset) : 1440;
    var clockShift = Math.abs((endMinute - startMinute) * MINUTE - duration) > 1000;
    if (endMinute < startMinute || (endMinute === startMinute && duration > 0)) {
      // A repeated hour must not create a negative rectangle. Its exact end
      // clock and elapsed duration remain available in the entry/detail view.
      endMinute = Math.min(1440, startMinute + Math.min(60, duration / MINUTE));
      clockShift = true;
    }
    return { id: entry.id, startMinute: startMinute, endMinute: endMinute, durationMs: duration,
      continuesBefore: dateKey > firstDay, continuesAfter: dateKey < lastDay,
      running: running, point: false, clockShift: clockShift };
  }

  function layout(items, minSpan) {
    minSpan = minSpan === undefined ? 36 : minSpan;
    if (!Number.isFinite(minSpan) || minSpan <= 0 || minSpan > 1440) throw new Error('Choose a valid minimum event height.');
    var arranged = items.map(function (item, index) {
      if (!Number.isFinite(item.startMinute) || !Number.isFinite(item.endMinute)) throw new Error('An event requires valid day coordinates.');
      var start = clamp(item.startMinute, 0, 1440), end = clamp(item.endMinute, start, 1440);
      var span = Math.max(minSpan, end - start), displayStart = Math.min(start, 1440 - span);
      return Object.assign({}, item, { displayStart: displayStart, displayEnd: displayStart + span, lane: 0, lanes: 1, _order: index });
    }).sort(function (a, b) { return a.displayStart - b.displayStart || b.displayEnd - a.displayEnd || a._order - b._order; });
    var group = [], ends = [], groupEnd = -1;
    function finishGroup() {
      group.forEach(function (item) { item.lanes = ends.length; });
      group = []; ends = []; groupEnd = -1;
    }
    arranged.forEach(function (item) {
      if (item.displayStart >= groupEnd) finishGroup();
      var lane = ends.findIndex(function (end) { return end <= item.displayStart; });
      if (lane < 0) lane = ends.length;
      item.lane = lane;
      ends[lane] = item.displayEnd;
      group.push(item);
      groupEnd = Math.max(groupEnd, item.displayEnd);
    });
    finishGroup();
    return arranged.map(function (item) { delete item._order; return item; });
  }
  function dayDuration(entries, dateKey, now) {
    var instant = asDate(now);
    return entries.reduce(function (total, entry) {
      if (entry.tracking !== 'timer') return total;
      var part = segment(entry, dateKey, instant);
      return total + (part ? part.durationMs : 0);
    }, 0);
  }
  return { clock24: clock24, minutesAt: minutesAt, segment: segment, layout: layout, dayDuration: dayDuration };
});
