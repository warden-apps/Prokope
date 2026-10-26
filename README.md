# Prokopē

Your daily rhythm, remembered. A private tracker for routines, plans, and the things you do along the way. No account, dependencies, or build step.

## The daily loop

- **Routines:** create an activity such as “Take creatine.” Repeat daily, on selected weekdays, every N days from a start date, or on a day of the month. Monthly dates that do not exist in a shorter month are skipped.
- **Plans:** add something for a specific date, with an optional planned time. Plan tomorrow without recording it as already done.
- **Optional activities:** keep reusable activities such as reading or going for a walk. They are available when you want them, without becoming daily obligations.
- **Automatic times:** mark an activity done to record the actual time of the tap. Timed activities have Start and Finish actions, preserving both times and the elapsed duration.
- **Quick logging:** type something you just did to add it directly to today's timeline with the current time.
- **Your 24 hours:** explore a full 00:00–24:00 day map. Actions sit at their recorded times, timed sessions span their duration, and planned times have a distinct dashed outline. Overlapping activities stay individually selectable. A live 24-hour clock and Now marker follow today; previous days remain fixed.
- **History:** choose today, yesterday, or another date, or search across activity names and notes. Activity names are saved with each entry, so renaming or archiving an activity does not erase its past.
- **Fill in the picture:** tap a recorded moment to add a note or correct its name/date/time. Use **Log earlier** to add a missed action or a finished timed activity. Corrections affect that record, not the reusable activity. Future records are rejected; use a plan for future intentions.

A planned time is a label in your schedule, not a notification or alarm. Completion is recorded at the actual time you act. Times use your device's local timezone when an event is recorded. A timer keeps its starting timestamp across app closures; it does not need a background process to keep running. A session that crosses midnight is split across the relevant day maps. The map uses recorded local clock times even after you travel; the elapsed duration uses actual timestamps. Clock changes are identified in event details. For very short activities, a thin duration bar marks the exact span while the label has a larger tap target.

Use **Now**, **First entry**, or the whole-day overview to move around the map. Scroll the hour grid to see the rest of the day. The phone layout keeps the map visible and provides a quick jump to the activity list.

## Install on iPhone

1. Serve the app over HTTPS, for example with GitHub Pages.
2. Open it in Safari and choose **Share → Add to Home Screen**. Enable **Open as Web App** if Safari offers that option.
3. Open the installed app once while online so its files can be saved for offline use.
4. Afterwards, reopen it from the Home Screen and use it without a connection. Routines, plans, timers, and your history work locally.

Safari may use separate storage for a browser tab and the installed app. Make a backup before changing how you open the app, and restore it in the destination if needed. Do not assume that installing or uninstalling an app transfers its data.

Updates download in the background when online. Apply the available update in the app when convenient; the complete new app replaces the previous version together. Installing on a physical iPhone should still be checked before a release; Chromium tests do not establish every iOS behavior.

## Your data

Everything is stored in this browser on this device. Nothing is sent to a server, and there is no automatic sync between devices. Use the backup controls in Settings to export a JSON copy and restore it later. Keep a backup outside the browser: clearing site data, removing the app, private browsing, or browser storage eviction can remove local records. Installing the app does not replace backups.

Restore validates the file before replacing the current tracker. Export your current data first if you want to keep both copies. Archived activities retain their existing history.

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
```

The browser smoke test requires Python Playwright and Chromium as development tools, and the local server running on port 8000. They are not runtime dependencies of the app.

## Publish with GitHub Pages

Commit the app files, then choose **Settings → Pages → Deploy from a branch → main / root**. GitHub Pages serves the project below its repository path; the manifest and service worker use relative paths so the same files work at both a domain root and a project path.

```text
index.html              application shell
styles.css              responsive layout
model.js                scheduling and records
timeline.js             24-hour geometry and recorded time handling
app.js                  interactions and local storage
manifest.json           installed-app metadata
sw.js                   offline app shell and update lifecycle
apple-touch-icon.png    iPhone Home Screen icon
icon-512.png            web app icon
```

When shipping changes to an app-shell file, bump `CACHE_VERSION` in `sw.js`. Core files are installed as a complete set and served from that version's cache, preventing an older open app from fetching a mix of new scripts and old markup. A failed download leaves the previous installed version active. The service worker only manages its own scope's caches and does not erase sibling applications on the same origin.
