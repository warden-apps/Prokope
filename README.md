# Prokopē

Your schedule and your daily rhythm, together. A private planner for events, routines, plans, and the things you do along the way. No account, dependencies, or build step.

## The daily loop

- **Today:** switch between **Timeline** and **Tasks**. Quick logging stays above both views. The app remembers your choice and keeps your place in the timeline while you switch views.
- **Events:** use the **+ Event** button for wake-up times, work, sleep, appointments, or anything you want on your schedule. Events appear on the timeline and calendar without a Done button or a place in Your routine. Set a single time, start/end times, or All day. Overnight events continue on the following day.
- **Quick scheduling:** tap an hour or open space on the timeline to start an event at that time. Earlier end times automatically suggest an overnight event; the preview shows its duration and finish date. Duplicate an event to make a separate one-time copy. Closing an edited event asks before discarding unsaved changes.
- **Repeating events:** repeat daily, on selected weekdays, every N days, or monthly. Add an optional repeat end date, skip individual dates, and restore skipped dates. Editing changes the whole series, including earlier calendar appearances. Archiving stops today and future occurrences while keeping past dates; restore from Activities.
- **Colors and details:** give events a color, location, and notes. Activities and recorded moments also have colors. A recorded moment keeps its color when you later change the activity.
- **Routines:** create an activity such as “Take creatine.” Repeat daily, on selected weekdays, every N days from a start date, or on a day of the month. Monthly dates that do not exist in a shorter month are skipped.
- **Plans:** add something for a specific date, with an optional planned time. Plan tomorrow without recording it as already done.
- **Optional activities:** keep reusable activities such as reading or going for a walk. They are available when you want them, without becoming daily obligations.
- **Automatic times:** mark an activity done to record the actual time of the tap. Timed activities have Start and Finish actions, preserving both times and the elapsed duration.
- **Quick logging:** type something you just did to add it directly to today's timeline with the current time.
- **Your 24 hours:** explore a full 00:00–24:00 day map. Actions sit at their recorded times, timed sessions span their duration, and planned times have a distinct dashed outline. Overlapping activities stay individually selectable. A live 24-hour clock and Now marker follow today; previous days remain fixed.
- **Calendar:** browse a month, select a day, or use **Go to date** to jump ahead. See events, to-dos, and recorded moments together. Open **24-hour timeline & records** for deeper review or to search your recorded names and notes. Open **Month totals** when you want the statistics. Existing records keep their saved names and times.
- **Activities:** search names, locations, and notes, or filter by type. Only matching groups appear. Turn on **Show archived** to restore or permanently delete an old activity.
- **Find your plans:** filter the calendar to Events or Recorded, or search the displayed month by name, location, and notes. Monthly totals always describe the full month. The current view, date, and filters survive a reload in the same tab. Today's schedule also shows what's scheduled now and what's next.
- **Monthly totals:** see planned event time, recorded timer time, and days with saved moments. Planned time excludes all-day events. Overlapping events or timers each contribute their duration; these totals do not claim that a scheduled event was completed.
- **Fill in the picture:** tap a recorded moment to add a note or correct its name/date/time. Use **Log earlier** to add a missed action or a finished timed activity. Corrections affect that record, not the reusable activity. Future records are rejected; use a plan for future intentions.

A planned time is a label in your schedule, not a notification or alarm. Completion is recorded at the actual time you act. Times use your device's local timezone when an event is recorded. A timer keeps its starting timestamp across app closures; it does not need a background process to keep running. A session that crosses midnight is split across the relevant day maps. The map uses recorded local clock times even after you travel; the elapsed duration uses actual timestamps. Clock changes are identified in event details. For very short activities, a thin duration bar marks the exact span while the label has a larger tap target.

Scheduled events follow the local wall-clock times you choose. They are intentions, so changing your device timezone leaves a 09:00 appointment at 09:00 on the calendar. Activity records preserve the timezone captured when you recorded them. Existing tracker backups still open in this version; new backups include events, colors, notes, and skipped dates. Update any older open app windows before editing new calendar data there.

Use **Now**, **First entry**, or the whole-day overview to move around the map. Scroll the hour grid to see the rest of the day. Switch to **Tasks** to act on your routines and to-dos, then back to **Timeline** to see their recorded times.

## Install on iPhone

1. Serve the app over HTTPS, for example with GitHub Pages.
2. Open it in Safari and choose **Share → Add to Home Screen**. Enable **Open as Web App** if Safari offers that option.
3. Open the installed app once while online so its files can be saved for offline use.
4. Afterwards, reopen it from the Home Screen and use it without a connection. Routines, plans, timers, and your history work locally.

If an installed Home Screen icon stays unchanged after an update, iOS may be holding the old artwork. Download a backup before removing or re-adding the installed app; restore it if the new installation uses separate storage.

Safari may use separate storage for a browser tab and the installed app. Make a backup before changing how you open the app, and restore it in the destination if needed. Do not assume that installing or uninstalling an app transfers its data.

Updates download in the background when online. Apply the available update in the app when convenient; the complete new app replaces the previous version together. Installing on a physical iPhone should still be checked before a release; Chromium tests do not establish every iOS behavior.

## Your data

Choose **Settings → Appearance → Theme** for Light, Dark, or System. System follows your device; Dark uses warm forest surfaces with sage and copper accents. Your choice is remembered on this device and works offline.

Everything is stored in this browser on this device. Nothing is sent to a server, and there is no automatic sync between devices. Use the backup controls in Settings to export a JSON copy and restore it later. Keep a backup outside the browser: clearing site data, removing the app, private browsing, or browser storage eviction can remove local records. Installing the app does not replace backups.

Restore validates the file before replacing the current tracker. Export your current data first if you want to keep both copies. Archiving hides an activity from your daily lists, keeps its history, and lets you restore it from Activities. It does not delete the activity. These text records are small; a recurring schedule is saved once, not as an endless list of future dates. Settings shows the size of your JSON backup, including archived activities and records, rather than the browser's total storage usage.

**Delete** in an activity's editor permanently removes it. Past records are kept by default as independent moments with their original names, times, notes, and colors. Check **Also delete past records** only when you want those removed too. Finish or remove a running timer first. Deleting an event series removes all its generated calendar dates, including past dates; use Archive to preserve past dates. Every deletion shows what will be removed before you confirm, and cancels if another window changes the item or its records.

The previous nightly ledger is left untouched under its original `keikoroku.v1` storage key. The new tracker uses separate storage. Settings can export the old ledger so an app update does not discard it; it is not automatically converted into activity entries.

## Run locally

Python 3 is sufficient:

```sh
cd /path/to/Prokope
python3 -m http.server 8000 --bind 127.0.0.1
```

Use the server from a local browser. Loopback HTTP is a secure context for service-worker development; a phone connecting to a computer's ordinary HTTP LAN address is not. Use an HTTPS deployment for the iPhone PWA. Opening `index.html` directly with `file://` is not the supported offline installation flow.

The app uses plain JavaScript, CSS, and local PNG icons. No package installation or compilation is required. Development checks:

```sh
node --test tests/*.test.js
python3 tests/browser_smoke.py
python3 tests/browser_planner.py
python3 tests/browser_polish.py
python3 tests/browser_theme.py
python3 tests/browser_delete.py
python3 tests/browser_layout.py
```

The browser smoke test requires Python Playwright and Chromium as development tools, and the local server running on port 8000. They are not runtime dependencies of the app.

## Publish with GitHub Pages

Commit the app files, then choose **Settings → Pages → Deploy from a branch → main / root**. GitHub Pages serves the project below its repository path; the manifest and service worker use relative paths so the same files work at both a domain root and a project path.

```text
index.html              application shell
styles.css              responsive layout
theme.js                saved appearance and device theme preference
theme.css               warm dark palette
planner.css             focused daily views and library controls
model.js                scheduling and records
timeline.js             24-hour geometry and recorded time handling
calendar.js             month grid, agenda, and planned/recorded totals
calendar.css            responsive calendar layout
events-ui.js            event editor and recurrence controls
events.css              event editor layout
app.js                  interactions and local storage
manifest.json           installed-app metadata
sw.js                   offline app shell and update lifecycle
apple-touch-icon.png    iPhone Home Screen icon
icon-512.png            web app icon
```

When shipping changes to an app-shell file, bump `CACHE_VERSION` in `sw.js`. Core files are installed as a complete set and served from that version's cache, preventing an older open app from fetching a mix of new scripts and old markup. A failed download leaves the previous installed version active. The service worker only manages its own scope's caches and does not erase sibling applications on the same origin.
