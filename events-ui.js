/* Schedule-only events: a small editor with no completion step. */
(function (root) {
  'use strict';
  var palette = [
    ['Sage', '#55786a'], ['Ocean', '#447b9b'], ['Lavender', '#8067a3'],
    ['Rose', '#b4647a'], ['Clay', '#bc754d'], ['Gold', '#9c812d']
  ];
  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }
  function init(options) {
    var M = root.ProkopeModel;
    var dialog = document.createElement('dialog');
    var occurrence = '', taskId = '', taskOriginal = null;
    dialog.id = 'event-dialog';
    dialog.className = 'modal event-modal';
    dialog.setAttribute('aria-labelledby', 'event-dialog-title');
    dialog.innerHTML = '<form id="event-form">' +
      '<div class="modal-header event-header"><div><p class="eyebrow">ON YOUR SCHEDULE</p><h2 id="event-dialog-title">New event</h2></div><button type="button" class="icon-button" id="event-close" aria-label="Close event editor"><svg class="icon" aria-hidden="true"><use href="#i-close"/></svg></button></div>' +
      '<p id="event-series-hint" class="event-series-hint" hidden>Changes apply to the whole series.</p>' +
      '<div class="field"><label for="event-name">Name</label><input id="event-name" maxlength="120" required placeholder="Work, sleep, an appointment…" autocomplete="off"></div>' +
      '<div class="event-date-row"><div class="field"><label id="event-date-label" for="event-date">Date</label><input id="event-date" type="date" required></div><label class="event-toggle" for="event-all-day"><input id="event-all-day" type="checkbox"><span>All day</span></label></div>' +
      '<div id="event-times" class="event-time-section"><div class="field-grid"><div class="field"><label for="event-start">Start</label><input id="event-start" type="time" value="09:00"></div><div class="field"><label for="event-end">End <span class="label-optional">optional</span></label><input id="event-end" type="time"></div></div><label id="event-next-day-field" class="event-toggle event-next-day" for="event-next-day" hidden><input id="event-next-day" type="checkbox"><span>Ends next day</span></label></div>' +
      '<div class="field"><label for="event-repeat">Repeat</label><select id="event-repeat"><option value="once">Does not repeat</option><option value="daily">Every day</option><option value="weekdays">Certain weekdays</option><option value="interval">Every few days</option><option value="monthly">Monthly</option></select></div>' +
      '<fieldset id="event-weekdays-field" class="event-weekdays" hidden><legend>Days</legend><div class="event-weekday-options">' +
      [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']].map(function (day) {
        return '<label><input type="checkbox" name="event-weekday" value="' + day[0] + '"><span>' + day[1] + '</span></label>';
      }).join('') + '</div></fieldset>' +
      '<div id="event-interval-field" class="field" hidden><label for="event-interval">Every</label><div class="input-with-unit"><input id="event-interval" type="number" min="1" max="3650" step="1" value="2" inputmode="numeric"><span>days</span></div></div>' +
      '<div id="event-monthday-field" class="field" hidden><label for="event-monthday">Day of month</label><input id="event-monthday" type="number" min="1" max="31" step="1" value="15" inputmode="numeric"><p class="field-hint">Months without this date are skipped.</p></div>' +
      '<div id="event-until-field" class="field" hidden><label for="event-until">Repeat until <span class="label-optional">optional</span></label><input id="event-until" type="date"></div>' +
      '<fieldset class="event-colors"><legend>Color</legend><div class="event-color-options">' +
      palette.map(function (color) {
        return '<button type="button" class="event-swatch" data-event-color="' + color[1] + '" aria-label="' + color[0] + '" aria-pressed="false"><span style="background:' + color[1] + '"></span></button>';
      }).join('') + '<label class="event-custom-color" for="event-color"><input id="event-color" type="color" value="#55786a" aria-label="Custom event color"><span>Custom</span></label></div></fieldset>' +
      '<details id="event-details" class="event-details"><summary>Location &amp; notes</summary><div class="field"><label for="event-location">Location</label><input id="event-location" maxlength="160" placeholder="Place or address" autocomplete="off"></div><div class="field"><label for="event-note">Notes</label><textarea id="event-note" maxlength="1000" rows="3" placeholder="Anything to remember"></textarea></div></details>' +
      '<div id="event-occurrence-actions" class="event-occurrence-actions" hidden><button type="button" id="event-skip" class="text-button">Skip this date</button><details id="event-skipped" hidden><summary>Skipped dates</summary><div id="event-skipped-list"></div></details></div>' +
      '<p id="event-error" class="form-error" role="alert" hidden></p>' +
      '<div class="modal-footer event-footer"><button type="button" id="event-archive" class="text-button danger-text" hidden>Archive event</button><button type="button" id="event-restore" class="text-button" hidden>Restore event</button><button type="submit" id="event-save" class="button primary-button">Save event <svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg></button></div>' +
      '</form>';
    document.body.appendChild(dialog);
    var $ = function (id) { return dialog.querySelector('#' + id); };
    function task() {
      return options.getState().tasks.find(function (item) { return item.id === taskId; });
    }
    function showError(message) {
      $('event-error').textContent = message || '';
      $('event-error').hidden = !message;
    }
    function saveChange(callback) {
      showError('');
      var result = options.transact(function (state) {
        var latest = taskId && state.tasks.find(function (item) { return item.id === taskId; });
        if (taskId && JSON.stringify(latest) !== taskOriginal) {
          throw new Error('This event changed in another window. Close and reopen it before editing.');
        }
        return callback(state);
      }, { onError: function (error) { showError(error.message); } });
      if (result && taskId) taskOriginal = JSON.stringify(task());
      if (!result && $('event-error').hidden) showError('Could not save. Check your available storage and try again.');
      return result;
    }
    function updateColor() {
      var value = $('event-color').value.toLowerCase();
      dialog.querySelectorAll('[data-event-color]').forEach(function (button) {
        button.setAttribute('aria-pressed', String(button.dataset.eventColor === value));
      });
    }
    function updateFields() {
      var repeat = $('event-repeat').value, allDay = $('event-all-day').checked;
      $('event-times').hidden = allDay;
      $('event-start').disabled = allDay;
      $('event-start').required = !allDay;
      $('event-end').disabled = allDay;
      $('event-next-day-field').hidden = allDay || !$('event-end').value;
      $('event-next-day').disabled = allDay || !$('event-end').value;
      $('event-date-label').textContent = repeat === 'once' ? 'Date' : 'Starts on';
      $('event-weekdays-field').hidden = repeat !== 'weekdays';
      $('event-weekdays-field').disabled = repeat !== 'weekdays';
      $('event-interval-field').hidden = repeat !== 'interval';
      $('event-interval').disabled = repeat !== 'interval';
      $('event-interval').required = repeat === 'interval';
      $('event-monthday-field').hidden = repeat !== 'monthly';
      $('event-monthday').disabled = repeat !== 'monthly';
      $('event-monthday').required = repeat === 'monthly';
      $('event-until-field').hidden = repeat === 'once';
      $('event-until').disabled = repeat === 'once';
      $('event-until').min = $('event-date').value;
      $('event-series-hint').hidden = !taskId || repeat === 'once';
    }
    function dateLabel(date) {
      return new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
    function updateOccurrence() {
      var current = task();
      var archived = current && !!current.archivedAt;
      var skipped = current && current.excludedDates || [];
      $('event-occurrence-actions').hidden = !current || archived;
      $('event-skip').hidden = !current || archived || !M.isDue(current, occurrence);
      $('event-skip').textContent = 'Skip ' + dateLabel(occurrence);
      $('event-skipped').hidden = !skipped.length;
      $('event-skipped-list').innerHTML = skipped.slice().sort().map(function (date) {
        return '<div class="event-skipped-row"><span>' + escape(dateLabel(date)) + '</span><button type="button" class="text-button" data-event-restore="' + escape(date) + '" aria-label="Restore ' + escape(dateLabel(date)) + '">Restore</button></div>';
      }).join('');
      $('event-archive').hidden = !current || archived;
      $('event-archive').textContent = current && current.schedule.type !== 'once' ? 'Archive series' : 'Archive event';
      $('event-restore').hidden = !archived;
      $('event-save').hidden = !!archived;
    }
    function open(id, date) {
      var current = id ? options.getState().tasks.find(function (item) { return item.id === id && item.kind === 'event'; }) : null;
      if (id && !current) { options.toast('This event is no longer available.'); return; }
      taskId = current ? current.id : '';
      taskOriginal = current ? JSON.stringify(current) : null;
      occurrence = date || options.getDate();
      var schedule = current ? current.schedule : {};
      $('event-form').reset();
      $('event-dialog-title').textContent = current ? 'Event details' : 'New event';
      $('event-name').value = current ? current.name : '';
      $('event-date').value = schedule.date || schedule.startDate || occurrence;
      $('event-all-day').checked = !!current && !schedule.time;
      $('event-start').value = schedule.time || '09:00';
      $('event-end').value = schedule.endTime || '';
      $('event-next-day').checked = !!schedule.endNextDay;
      $('event-repeat').value = schedule.type || 'once';
      $('event-until').value = schedule.untilDate || '';
      $('event-interval').value = schedule.interval || 2;
      $('event-monthday').value = schedule.monthDay || Number(occurrence.slice(-2));
      dialog.querySelectorAll('[name="event-weekday"]').forEach(function (input) {
        input.checked = (schedule.weekdays || [1, 2, 3, 4, 5]).indexOf(Number(input.value)) >= 0;
      });
      $('event-color').value = current && current.color || '#55786a';
      $('event-location').value = current && current.location || '';
      $('event-note').value = current && current.note || '';
      $('event-details').open = !!(current && (current.location || current.note));
      $('event-skipped').open = false;
      showError('');
      updateFields();
      updateColor();
      updateOccurrence();
      if (!dialog.open) dialog.showModal();
      $('event-name').focus();
    }
    $('event-close').addEventListener('click', function () { dialog.close(); });
    ['event-repeat', 'event-all-day', 'event-end', 'event-date'].forEach(function (id) {
      $(id).addEventListener('change', updateFields);
    });
    $('event-color').addEventListener('input', updateColor);
    dialog.addEventListener('click', function (event) {
      var swatch = event.target.closest('[data-event-color]');
      if (swatch) { $('event-color').value = swatch.dataset.eventColor; updateColor(); }
      var restore = event.target.closest('[data-event-restore]');
      if (restore) {
        var result = saveChange(function (state) { return M.restoreEventOccurrence(state, taskId, restore.dataset.eventRestore); });
        if (result) { updateOccurrence(); options.toast('Date restored.'); }
      }
    });
    $('event-form').addEventListener('submit', function (event) {
      event.preventDefault();
      if (task() && task().archivedAt) { showError('Restore this event before editing it.'); return; }
      var repeat = $('event-repeat').value, date = $('event-date').value;
      var allDay = $('event-all-day').checked;
      var schedule = {
        type: repeat, startDate: date, time: allDay ? '' : $('event-start').value,
        endTime: allDay ? '' : $('event-end').value,
        endNextDay: !allDay && !!$('event-end').value && $('event-next-day').checked,
        untilDate: repeat === 'once' ? '' : $('event-until').value
      };
      if (repeat === 'once') schedule.date = date;
      if (repeat === 'weekdays') schedule.weekdays = Array.from(dialog.querySelectorAll('[name="event-weekday"]:checked')).map(function (input) { return Number(input.value); });
      if (repeat === 'interval') schedule.interval = Number($('event-interval').value);
      if (repeat === 'monthly') schedule.monthDay = Number($('event-monthday').value);
      var input = { name: $('event-name').value, kind: 'event', tracking: 'none', schedule: schedule, color: $('event-color').value, location: $('event-location').value, note: $('event-note').value };
      var result = saveChange(function (state) { return taskId ? M.updateTask(state, taskId, input) : M.createTask(state, input); });
      if (result) {
        dialog.close();
        if (!taskId && options.onCreated) options.onCreated(result.value);
        options.toast(taskId ? 'Event updated.' : 'Event added.');
      }
    });
    $('event-skip').addEventListener('click', function () {
      var skippedId = taskId, skippedDate = occurrence;
      var result = saveChange(function (state) { return M.skipEvent(state, skippedId, skippedDate); });
      if (result) {
        dialog.close();
        options.toast('Date skipped.', function () {
          if (options.transact(function (state) { return M.restoreEventOccurrence(state, skippedId, skippedDate); })) options.toast('Date restored.');
        });
      }
    });
    $('event-archive').addEventListener('click', async function () {
      var current = task();
      if (!current) return;
      var series = current.schedule.type !== 'once';
      if (await options.confirm(series ? 'Archive this series?' : 'Archive this event?', 'Past dates stay in your calendar. Restore it anytime in Activities.', series ? 'Archive series' : 'Archive event')) {
        if (saveChange(function (state) { return M.archiveTask(state, taskId); })) { dialog.close(); options.toast('Event archived.'); }
      }
    });
    $('event-restore').addEventListener('click', function () {
      if (saveChange(function (state) { return M.restoreTask(state, taskId); })) { dialog.close(); options.toast('Event restored.'); }
    });
    return { open: open };
  }
  root.ProkopeEvents = { init: init };
})(window);
