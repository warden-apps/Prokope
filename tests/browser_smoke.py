"""Functional browser checks for Prokope; no test dependencies are shipped to users.

Start the static server in the repository root, then run:
    python3 -m http.server 8000 --bind 127.0.0.1
    python3 tests/browser_smoke.py

Uses an installed Python Playwright and Chromium. Override PROKOPE_BASE_URL or
PROKOPE_CHROMIUM when testing another local server or browser installation.
Every test uses a disposable context and never touches a personal browser.
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import unittest

from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("PROKOPE_BASE_URL", "http://127.0.0.1:8000/")
if not BASE.endswith("/"):
    BASE += "/"
STORAGE_KEY = "prokope.daily.v1"
LEGACY = json.dumps({"v": 3, "days": {"2026-10-24": {"jrnl": "An existing ledger entry"}}})
NOON = datetime(2026, 10, 25, 3, 0, tzinfo=timezone.utc)


class ProkopeBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=os.environ.get("PROKOPE_CHROMIUM", "/usr/bin/chromium"),
            headless=True,
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(
            viewport={"width": 390, "height": 844},
            timezone_id="Asia/Tokyo",
            reduced_motion="reduce",
            accept_downloads=True,
        )
        self.context.add_init_script(
            "if (localStorage.getItem('keikoroku.v1') === null) "
            "localStorage.setItem('keikoroku.v1', " + json.dumps(LEGACY) + ");"
        )
        self.errors = []
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.clock.set_fixed_time(NOON)
        self.page.goto(BASE, wait_until="networkidle")
        expect(self.page.locator("#add-task")).to_be_visible()

    def tearDown(self):
        errors = list(self.errors)
        self.context.close()
        self.assertEqual(errors, [], "Uncaught browser errors")

    def state(self):
        return self.page.evaluate(
            "key => JSON.parse(localStorage.getItem(key))", STORAGE_KEY
        ) or {"version": 1, "tasks": [], "entries": []}

    def assert_no_horizontal_overflow(self, page=None):
        page = page or self.page
        size = page.evaluate(
            "({content: document.documentElement.scrollWidth, viewport: innerWidth})"
        )
        self.assertLessEqual(size["content"], size["viewport"] + 1, size)

    def create_task(self, name, kind="routine", tracking="check", repeat="daily", **schedule):
        page = self.page
        page.locator("#add-task").click()
        expect(page.locator("#task-dialog")).to_be_visible()
        page.locator("#task-name").fill(name)
        page.locator("#task-kind").select_option(kind)
        page.locator("#task-tracking").select_option(tracking)
        if kind == "routine":
            page.locator("#task-repeat").select_option(repeat)
            page.locator("#task-startdate").fill(schedule.get("startDate", "2026-10-25"))
            if repeat == "interval":
                page.locator("#task-interval").fill(str(schedule.get("interval", 2)))
            elif repeat == "monthly":
                page.locator("#task-monthday").fill(str(schedule.get("monthDay", 15)))
            elif repeat == "weekdays":
                for day in range(7):
                    checkbox = page.locator(f'input[name="weekday"][value="{day}"]')
                    checkbox.set_checked(day in schedule.get("weekdays", [0, 3]))
        elif kind == "planned":
            page.locator("#task-date").fill(schedule.get("date", "2026-10-26"))
        if "time" in schedule:
            page.locator("#task-time").fill(schedule["time"])
        self.assert_no_horizontal_overflow()
        page.locator('#task-form button[type="submit"]').click()
        expect(page.locator("#task-dialog")).not_to_be_visible()
        matches = [task for task in self.state()["tasks"] if task["name"] == name]
        self.assertEqual(len(matches), 1)
        return matches[0]

    def quick_log(self, title):
        self.page.locator("#quick-log-name").fill(title)
        self.page.locator('#quick-log-form button[type="submit"]').click()
        expect(self.page.locator("#timeline-list")).to_contain_text(title)

    def switch_view(self, name):
        self.page.locator(f'[data-view="{name}"]:visible').first.click()

    def test_routine_records_midnight_once_and_preserves_legacy_data(self):
        self.page.clock.set_fixed_time(datetime(2026, 10, 24, 15, 0, tzinfo=timezone.utc))
        self.page.reload(wait_until="networkidle")
        task = self.create_task("Take creatine")
        button = self.page.locator(f'#routine-list [data-action="complete"][data-id="{task["id"]}"]')
        button.click()
        entries = self.state()["entries"]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["startAt"], "2026-10-24T15:00:00.000Z")
        self.assertEqual(entries[0]["date"], "2026-10-25")
        self.assertEqual(entries[0]["endAt"], entries[0]["startAt"])
        expect(self.page.locator("#timeline-list")).to_contain_text("Take creatine")
        expect(self.page.locator("#timeline-list")).to_contain_text(re.compile(r"00[:.]00"))
        if button.count():
            expect(button).to_be_disabled()
        self.page.reload(wait_until="networkidle")
        self.assertEqual(len(self.state()["entries"]), 1)
        expect(self.page.locator("#routine-list .is-done")).to_contain_text("Take creatine")
        self.assertEqual(self.page.evaluate("localStorage.getItem('keikoroku.v1')"), LEGACY)
        self.assert_no_horizontal_overflow()

    def test_optional_timer_survives_reload_and_records_finish(self):
        task = self.create_task("Read a book", kind="optional", tracking="timer")
        self.page.locator(f'#optional-list [data-action="start"][data-id="{task["id"]}"]').click()
        entry = self.state()["entries"][0]
        self.assertIsNone(entry["endAt"])
        self.assertEqual(entry["startAt"], "2026-10-25T03:00:00.000Z")
        self.page.reload(wait_until="networkidle")
        expect(self.page.locator("#active-timers")).to_contain_text("Read a book")
        self.page.clock.set_fixed_time(datetime(2026, 10, 25, 3, 25, tzinfo=timezone.utc))
        self.page.locator(f'[data-action="finish"][data-id="{entry["id"]}"]').first.click()
        finished = self.state()["entries"][0]
        self.assertEqual(finished["endAt"], "2026-10-25T03:25:00.000Z")
        self.assertEqual(finished["endDate"], "2026-10-25")
        expect(self.page.locator("#timeline-list")).to_contain_text("Read a book")
        self.assertEqual(len(self.state()["entries"]), 1)
        # Optional activities can be done again, without losing the earlier session.
        self.page.locator(f'#optional-list [data-action="start"][data-id="{task["id"]}"]').click()
        self.assertEqual(len(self.state()["entries"]), 2)
        self.assert_no_horizontal_overflow()

    def test_planned_tomorrow_and_recurrence_form(self):
        plan = self.create_task("Call the dentist", kind="planned", date="2026-10-26", time="09:30")
        self.assertEqual(plan["schedule"]["date"], "2026-10-26")
        self.assertEqual(plan["schedule"]["time"], "09:30")
        expect(self.page.locator("#planned-list")).not_to_contain_text("Call the dentist")
        self.page.locator("#next-day").click()
        expect(self.page.locator("#date-picker")).to_have_value("2026-10-26")
        expect(self.page.locator("#planned-list")).to_contain_text("Call the dentist")
        self.assertEqual(self.state()["entries"], [])
        self.page.locator("#today-button").click()
        interval = self.create_task("Water the plants", repeat="interval", interval=2)
        self.assertEqual(interval["schedule"]["interval"], 2)
        weekly = self.create_task("Stretch", repeat="weekdays", weekdays=[0, 3])
        self.assertEqual(sorted(weekly["schedule"]["weekdays"]), [0, 3])
        monthly = self.create_task("Monthly review", repeat="monthly", monthDay=15)
        self.assertEqual(monthly["schedule"]["monthDay"], 15)
        expect(self.page.locator("#routine-list")).to_contain_text("Water the plants")
        expect(self.page.locator("#routine-list")).to_contain_text("Stretch")
        expect(self.page.locator("#routine-list")).not_to_contain_text("Monthly review")
        self.page.locator("#next-day").click()
        expect(self.page.locator("#routine-list")).not_to_contain_text("Water the plants")
        expect(self.page.locator("#routine-list")).not_to_contain_text("Stretch")
        self.page.locator("#next-day").click()
        expect(self.page.locator("#routine-list")).to_contain_text("Water the plants")

    def test_quick_log_and_yesterday_history_keep_actual_dates(self):
        self.page.evaluate("""key => {
            const state = ProkopeModel.newState();
            ProkopeModel.logEntry(state, 'Yesterday evening walk', new Date('2026-10-24T09:15:00Z'));
            localStorage.setItem(key, JSON.stringify(state));
        }""", STORAGE_KEY)
        self.page.reload(wait_until="networkidle")
        self.quick_log("Put the laundry away")
        entries = self.state()["entries"]
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[-1]["startAt"], "2026-10-25T03:00:00.000Z")
        self.switch_view("history")
        self.page.locator("#previous-day").click()
        expect(self.page.locator("#history-timeline")).to_contain_text("Yesterday evening walk")
        expect(self.page.locator("#history-timeline")).not_to_contain_text("Put the laundry away")
        expect(self.page.locator("#history-timeline")).to_contain_text(re.compile(r"18[:.]15"))
        self.page.locator("#today-button").click()
        expect(self.page.locator("#history-timeline")).to_contain_text("Put the laundry away")
        self.assert_no_horizontal_overflow()

    def test_backup_restore_round_trip(self):
        self.quick_log("A completed one-off action")
        original = self.state()
        self.page.locator("#open-settings").click()
        with self.page.expect_download() as download_info:
            self.page.locator("#export-data").click()
        downloaded = download_info.value
        raw = Path(downloaded.path()).read_bytes()
        backup = json.loads(raw)
        self.assertEqual(backup.get("data", backup), original)
        self.page.locator('#settings-dialog [data-close-dialog]').click()
        self.quick_log("Another action after the backup")
        self.assertEqual(len(self.state()["entries"]), 2)
        self.page.locator("#open-settings").click()
        self.page.locator("#restore-file").set_input_files({
            "name": "prokope-backup.json", "mimeType": "application/json", "buffer": raw
        })
        expect(self.page.locator("#confirm-dialog")).to_be_visible()
        self.page.locator("#confirm-accept").click()
        expect(self.page.locator("#confirm-dialog")).not_to_be_visible()
        self.page.wait_for_function("key => JSON.parse(localStorage.getItem(key)).entries.length === 1", arg=STORAGE_KEY)
        self.assertEqual(self.state(), original)
        self.assertEqual(self.page.evaluate("localStorage.getItem('keikoroku.v1')"), LEGACY)

    def test_edit_archive_and_restore_keep_original_history(self):
        task = self.create_task("Morning creatine")
        self.page.locator(f'#routine-list [data-action="complete"][data-id="{task["id"]}"]').click()
        original = self.state()["entries"][0]
        self.page.locator(f'#routine-list [data-action="edit"][data-id="{task["id"]}"]').click()
        self.page.locator("#task-name").fill("Take creatine with lunch")
        self.page.locator('#task-form button[type="submit"]').click()
        expect(self.page.locator("#routine-list")).to_contain_text("Take creatine with lunch")
        expect(self.page.locator("#timeline-list")).to_contain_text("Morning creatine")
        self.assertEqual(self.state()["entries"][0], original)
        self.page.locator(f'#routine-list [data-action="edit"][data-id="{task["id"]}"]').click()
        self.page.locator("#task-archive").click()
        self.page.locator("#confirm-accept").click()
        expect(self.page.locator("#task-dialog")).not_to_be_visible()
        expect(self.page.locator("#routine-list")).not_to_contain_text("Take creatine with lunch")
        expect(self.page.locator("#timeline-list")).to_contain_text("Morning creatine")
        self.switch_view("library")
        self.page.locator("#show-archived").check()
        self.page.locator(f'#library-list [data-action="restore-task"][data-id="{task["id"]}"]').click()
        self.assertIsNone(self.state()["tasks"][0]["archivedAt"])
        self.switch_view("today")
        expect(self.page.locator("#routine-list .is-done")).to_contain_text("Take creatine with lunch")
        self.assertEqual(self.state()["entries"][0], original)

    def test_invalid_backup_does_not_replace_saved_data(self):
        self.quick_log("Keep this record safe")
        original = self.state()
        self.page.locator("#open-settings").click()
        for invalid in [b'{broken JSON', b'{"version":1,"tasks":[],"entries":[{"title":"Incomplete"}]}']:
            self.page.locator("#restore-file").set_input_files({
                "name": "invalid.json", "mimeType": "application/json", "buffer": invalid
            })
            expect(self.page.locator("#restore-file")).to_have_value("")
            expect(self.page.locator("#settings-feedback")).to_contain_text(re.compile(r"not.*valid|not a valid"))
            self.assertEqual(self.state(), original)
            expect(self.page.locator("#confirm-dialog")).not_to_be_visible()
        self.assertEqual(self.page.evaluate("localStorage.getItem('keikoroku.v1')"), LEGACY)

    def test_valid_backup_can_recover_malformed_current_storage(self):
        self.quick_log("Recover this saved moment")
        original = self.state()
        self.page.evaluate("key => localStorage.setItem(key, '{broken storage')", STORAGE_KEY)
        self.page.reload(wait_until="networkidle")
        expect(self.page.locator("#storage-warning")).to_be_visible()
        self.page.locator("#open-settings").click()
        self.page.locator("#restore-file").set_input_files({
            "name": "recovery.json", "mimeType": "application/json",
            "buffer": json.dumps({"format": "prokope-daily", "version": 1, "data": original}).encode()
        })
        self.page.locator("#confirm-accept").click()
        expect(self.page.locator("#settings-dialog")).not_to_be_visible()
        expect(self.page.locator("#storage-warning")).not_to_be_visible()
        self.assertEqual(self.state(), original)
        self.assertEqual(self.page.evaluate("key => localStorage.getItem(key + '.before-restore')", STORAGE_KEY), "{broken storage")
        expect(self.page.locator("#timeline-list")).to_contain_text("Recover this saved moment")

    def test_external_storage_changes_are_not_overwritten_by_stale_state(self):
        self.quick_log("A record before another window changes storage")
        original = self.state()
        other = self.context.new_page()
        other.clock.set_fixed_time(NOON)
        other.goto(BASE, wait_until="networkidle")
        other.evaluate("key => localStorage.setItem(key, '{}')", STORAGE_KEY)
        expect(self.page.locator("#storage-warning")).to_be_visible()
        self.page.locator("#quick-log-name").fill("Must not overwrite invalid data")
        self.page.locator('#quick-log-form button[type="submit"]').click()
        self.assertEqual(self.page.evaluate("key => localStorage.getItem(key)", STORAGE_KEY), "{}")
        other.evaluate("args => localStorage.setItem(args.key, JSON.stringify(args.state))", {"key": STORAGE_KEY, "state": original})
        expect(self.page.locator("#storage-warning")).not_to_be_visible()
        other.evaluate("key => localStorage.removeItem(key)", STORAGE_KEY)
        expect(self.page.locator("#timeline-list")).not_to_contain_text("A record before another window changes storage")
        self.quick_log("A new record after the clear")
        self.assertEqual(len(self.state()["entries"]), 1)
        self.assertEqual(self.state()["entries"][0]["title"], "A new record after the clear")
        other.close()

    def test_former_routine_can_become_a_new_one_time_plan(self):
        task_id = self.page.evaluate("""key => {
            const state = ProkopeModel.newState();
            const task = ProkopeModel.createTask(state, {
                name: 'Former daily walk', kind: 'routine', tracking: 'check',
                schedule: {type:'daily', startDate:'2026-10-24'}
            }, new Date('2026-10-24T01:00:00Z'));
            ProkopeModel.completeTask(state, task.id, new Date('2026-10-24T02:00:00Z'));
            localStorage.setItem(key, JSON.stringify(state));
            return task.id;
        }""", STORAGE_KEY)
        self.page.reload(wait_until="networkidle")
        self.page.locator(f'#routine-list [data-action="edit"][data-id="{task_id}"]').click()
        self.page.locator("#task-kind").select_option("planned")
        self.page.locator("#task-name").fill("A single long walk")
        self.page.locator("#task-date").fill("2026-10-25")
        self.page.locator('#task-form button[type="submit"]').click()
        self.page.locator(f'#planned-list [data-action="complete"][data-id="{task_id}"]').click()
        self.assertEqual(len(self.state()["entries"]), 2)
        self.assertEqual(self.state()["entries"][-1]["title"], "A single long walk")
        self.assertEqual(self.state()["entries"][0]["title"], "Former daily walk")

    def test_offline_launch_under_github_pages_subpath(self):
        class QuietHandler(SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

        repository = Path(__file__).resolve().parents[1]
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(repository.parent)))
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        context = self.browser.new_context(timezone_id="Asia/Tokyo")
        try:
            base = f"http://127.0.0.1:{server.server_port}/{repository.name}/"
            page = context.new_page()
            page.on("pageerror", lambda error: self.errors.append(str(error)))
            page.clock.set_fixed_time(NOON)
            page.goto(base, wait_until="networkidle")
            page.wait_for_function("navigator.serviceWorker.controller !== null")
            page.locator("#quick-log-name").fill("Kept under the project URL")
            page.locator('#quick-log-form button[type="submit"]').click()
            context.set_offline(True)
            offline = context.new_page()
            offline.on("pageerror", lambda error: self.errors.append(str(error)))
            offline.clock.set_fixed_time(NOON)
            response = offline.goto(base + "?source=homescreen", wait_until="networkidle")
            self.assertEqual(response.status, 200)
            self.assertTrue(response.from_service_worker)
            expect(offline.locator("#timeline-list")).to_contain_text("Kept under the project URL")
            for asset in ["styles.css", "model.js", "timeline.js", "app.js", "manifest.json"]:
                result = offline.evaluate("asset => fetch(asset).then(response => response.status)", asset)
                self.assertEqual(result, 200, asset)
        finally:
            context.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_recorded_day_duration_survives_timezone_change(self):
        self.page.evaluate("""key => {
            const state = ProkopeModel.newState();
            const task = ProkopeModel.createTask(state, {
                name: 'An early hour of reading', kind: 'optional', tracking: 'timer'
            }, new Date('2026-10-24T15:00:00Z'));
            const entry = ProkopeModel.startTask(state, task.id, new Date('2026-10-24T16:00:00Z'));
            ProkopeModel.finishEntry(state, entry.id, new Date('2026-10-24T17:00:00Z'));
            localStorage.setItem(key, JSON.stringify(state));
        }""", STORAGE_KEY)
        context = self.browser.new_context(
            timezone_id="America/New_York", storage_state=self.context.storage_state()
        )
        try:
            page = context.new_page()
            page.on("pageerror", lambda error: self.errors.append(str(error)))
            page.clock.set_fixed_time(NOON)
            page.goto(BASE, wait_until="networkidle")
            page.locator('[data-view="history"]:visible').first.click()
            page.locator("#date-picker").fill("2026-10-25")
            page.locator("#date-picker").dispatch_event("change")
            expect(page.locator("#history-timeline")).to_contain_text("An early hour of reading")
            expect(page.locator("#history-timeline")).to_contain_text(re.compile(r"01[:.]00"))
            expect(page.locator("#history-timeline")).to_contain_text(re.compile(r"02[:.]00"))
            block = page.locator("#history-timeline .map-event[data-entry-id]")
            self.assertAlmostEqual(float(block.get_attribute("data-start-minute")), 60)
            self.assertAlmostEqual(float(block.get_attribute("data-end-minute")), 120)
            duration = page.locator("#history-summary .summary-card").filter(has_text="Time spent")
            expect(duration.locator(".summary-value")).to_have_text(re.compile(r"60\s*min"))
            page.locator("#history-timeline .map-event[data-entry-id]").click()
            expect(page.locator("#record-start")).to_have_value(re.compile(r"01:00(?::00)?"))
            page.locator("#record-start").fill("00:45")
            page.locator('#record-form button[type="submit"]').click()
            expect(page.locator("#record-dialog")).not_to_be_visible()
            corrected = page.evaluate("key => JSON.parse(localStorage.getItem(key)).entries[0]", STORAGE_KEY)
            self.assertEqual(corrected["startAt"], "2026-10-24T15:45:00.000Z")
            self.assertEqual(corrected["startOffset"], -540)
            expect(duration.locator(".summary-value")).to_have_text(re.compile(r"75\s*min"))
        finally:
            context.close()

    def test_full_day_map_places_plans_and_actual_records_at_different_times(self):
        labels = self.page.locator("#timeline-list .hour-label")
        expect(labels).to_have_count(25)
        self.assertEqual(labels.all_text_contents(), [f"{hour:02d}:00" for hour in range(25)])
        task = self.create_task("Morning supplement", time="09:30")
        planned = self.page.locator(f'#timeline-list .is-planned[data-task-id="{task["id"]}"]')
        expect(planned).to_have_count(1)
        self.assertAlmostEqual(float(planned.get_attribute("data-start-minute")), 570)
        self.assertEqual(self.state()["entries"], [])
        self.page.locator(f'#routine-list [data-action="complete"][data-id="{task["id"]}"]').click()
        entry = self.state()["entries"][0]
        actual = self.page.locator(f'#timeline-list .map-event[data-entry-id="{entry["id"]}"]')
        expect(actual).to_have_count(1)
        self.assertAlmostEqual(float(actual.get_attribute("data-start-minute")), 720)
        expect(actual).to_contain_text("12:00")
        expect(planned).to_have_count(0)
        self.assertEqual(entry["startAt"], "2026-10-25T03:00:00.000Z")

    def test_live_clock_and_now_marker_advance_but_are_absent_on_previous_days(self):
        page = self.context.new_page()
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.clock.install(time=NOON)
        page.clock.pause_at(datetime(2026, 10, 25, 3, 0, 1, tzinfo=timezone.utc))
        page.goto(BASE, wait_until="networkidle")
        expect(page.locator("#live-clock-value")).to_contain_text("12:00")
        now = page.locator("#timeline-list .now-line")
        expect(now).to_have_count(1)
        before = now.get_attribute("style")
        page.clock.run_for(65000)
        expect(page.locator("#live-clock-value")).to_contain_text("12:01")
        expect(now).to_contain_text("12:01")
        self.assertNotEqual(now.get_attribute("style"), before)
        page.locator('[data-view="history"]:visible').first.click()
        page.locator("#previous-day").click()
        expect(page.locator("#date-picker")).to_have_value("2026-10-24")
        expect(page.locator("#history-timeline .hour-label")).to_have_count(25)
        expect(page.locator("#history-timeline .now-line")).to_have_count(0)
        page.close()

    def test_stale_record_editor_cannot_reopen_a_timer_finished_in_another_window(self):
        entry_id = self.page.evaluate("""key => {
            const M = ProkopeModel, state = M.newState();
            const start = new Date('2026-10-25T02:50:00Z');
            const task = M.createTask(state, {
                name:'Reading in two windows', kind:'optional', tracking:'timer'
            }, start);
            const entry = M.startTask(state, task.id, start);
            localStorage.setItem(key, JSON.stringify(state));
            return entry.id;
        }""", STORAGE_KEY)
        self.page.reload(wait_until="networkidle")
        self.page.locator(f'#timeline-list .map-event[data-entry-id="{entry_id}"]').click()
        expect(self.page.locator("#record-dialog")).to_be_visible()
        other = self.context.new_page()
        other.on("pageerror", lambda error: self.errors.append(str(error)))
        other.clock.set_fixed_time(NOON)
        try:
            other.goto(BASE, wait_until="networkidle")
            other.locator(f'#active-timers [data-action="finish"][data-id="{entry_id}"]').click()
            self.page.wait_for_function(
                "key => JSON.parse(localStorage.getItem(key)).entries[0].endAt !== null",
                arg=STORAGE_KEY,
            )
            finished = self.state()["entries"][0]
            self.assertEqual(finished["endAt"], "2026-10-25T03:00:00.000Z")
            self.page.locator("#record-note").fill("An edit from the stale window")
            self.page.locator('#record-form button[type="submit"]').click()
            expect(self.page.locator("#record-dialog")).to_be_visible()
            expect(self.page.locator("#record-error")).to_be_visible()
            expect(self.page.locator("#record-error")).to_contain_text("another window")
            self.assertEqual(self.state()["entries"][0], finished)
        finally:
            other.close()

    def test_overdue_plan_stays_in_summary_when_an_active_timer_refreshes(self):
        page = self.context.new_page()
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.clock.install(time=NOON)
        page.clock.pause_at(datetime(2026, 10, 25, 3, 0, 1, tzinfo=timezone.utc))
        try:
            page.goto(BASE, wait_until="networkidle")
            page.evaluate("""key => {
                const M = ProkopeModel, state = M.newState();
                M.createTask(state, {
                    name:'Yesterday’s unfinished plan', kind:'planned', tracking:'check',
                    schedule:{date:'2026-10-24', time:'09:00'}
                }, new Date('2026-10-24T00:00:00Z'));
                M.createTask(state, {
                    name:'Today’s routine', kind:'routine', tracking:'check',
                    schedule:{type:'daily', startDate:'2026-10-25'}
                }, new Date('2026-10-25T00:00:00Z'));
                const timer = M.createTask(state, {
                    name:'Reading while planning', kind:'optional', tracking:'timer'
                }, new Date('2026-10-25T02:50:00Z'));
                M.startTask(state, timer.id, new Date('2026-10-25T02:50:00Z'));
                localStorage.setItem(key, JSON.stringify(state));
            }""", STORAGE_KEY)
            page.reload(wait_until="networkidle")
            summary = page.locator("#day-summary .summary-card").filter(has_text="Planned & routine")
            expect(summary.locator(".summary-value")).to_have_text(re.compile(r"0\s*/\s*2"))
            expect(page.locator("#planned-list")).to_contain_text("Yesterday’s unfinished plan")
            page.clock.run_for(65000)
            expect(page.locator("#live-clock-value")).to_contain_text("12:01")
            expect(summary.locator(".summary-value")).to_have_text(re.compile(r"0\s*/\s*2"))
            expect(page.locator("#planned-list")).to_contain_text("Yesterday’s unfinished plan")
            expect(page.locator("#active-timers")).to_contain_text("Reading while planning")
        finally:
            page.close()

    def test_overlapping_records_and_overnight_sessions_have_correct_day_segments(self):
        ids = self.page.evaluate("""key => {
            const M = ProkopeModel, state = M.newState();
            const task = name => M.createTask(state, {name, kind:'optional', tracking:'timer'}, new Date('2026-10-24T00:00:00Z'));
            const first = M.startTask(state, task('Reading').id, new Date('2026-10-25T00:00:00Z'));
            M.finishEntry(state, first.id, new Date('2026-10-25T01:00:00Z'));
            const second = M.startTask(state, task('Music').id, new Date('2026-10-25T00:15:00Z'));
            M.finishEntry(state, second.id, new Date('2026-10-25T00:45:00Z'));
            const moment = M.logEntry(state, 'A glass of water', new Date('2026-10-25T00:20:00Z'));
            const overnight = M.startTask(state, task('Late reading').id, new Date('2026-10-24T14:50:00Z'));
            M.finishEntry(state, overnight.id, new Date('2026-10-24T15:20:00Z'));
            localStorage.setItem(key, JSON.stringify(state));
            return {overlap:[first.id, second.id, moment.id], overnight:overnight.id};
        }""", STORAGE_KEY)
        self.page.reload(wait_until="networkidle")
        boxes = []
        for entry_id in ids["overlap"]:
            block = self.page.locator(f'#timeline-list .map-event[data-entry-id="{entry_id}"]')
            expect(block).to_have_count(1)
            boxes.append(block.bounding_box())
            block.click()
            expect(self.page.locator("#record-dialog")).to_be_visible()
            self.page.locator('#record-dialog [data-close-dialog]').click()
        for index, a in enumerate(boxes):
            for b in boxes[index + 1:]:
                overlap_x = min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"])
                overlap_y = min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"])
                self.assertFalse(overlap_x > 1 and overlap_y > 1, "Overlapping cards must remain separately tappable")
        segment = self.page.locator(f'#timeline-list .map-event[data-entry-id="{ids["overnight"]}"]')
        self.assertAlmostEqual(float(segment.get_attribute("data-start-minute")), 0)
        self.assertAlmostEqual(float(segment.get_attribute("data-end-minute")), 20)
        self.switch_view("history")
        self.page.locator("#previous-day").click()
        segment = self.page.locator(f'#history-timeline .map-event[data-entry-id="{ids["overnight"]}"]')
        self.assertAlmostEqual(float(segment.get_attribute("data-start-minute")), 1430)
        self.assertAlmostEqual(float(segment.get_attribute("data-end-minute")), 1440)
        expect(self.page.locator("#history-timeline")).to_contain_text("Late reading")
        expect(self.page.locator("#history-timeline .now-line")).to_have_count(0)

    def test_record_correction_preserves_identity_and_rejects_future_times(self):
        self.quick_log("A walk to remember")
        original = self.state()["entries"][0]
        block = self.page.locator(f'#timeline-list .map-event[data-entry-id="{original["id"]}"]')
        block.click()
        expect(self.page.locator("#record-start")).to_have_value(re.compile(r"12:00(?::00)?"))
        self.page.locator("#record-title").fill("A quiet walk")
        self.page.locator("#record-start").fill("10:20")
        self.page.locator("#record-note").fill("The riverside route")
        self.page.locator('#record-form button[type="submit"]').click()
        expect(self.page.locator("#record-dialog")).not_to_be_visible()
        corrected = self.state()["entries"][0]
        self.assertEqual(corrected["id"], original["id"])
        self.assertEqual(corrected["title"], "A quiet walk")
        self.assertEqual(corrected["startAt"], "2026-10-25T01:20:00.000Z")
        self.assertEqual(corrected["endAt"], corrected["startAt"])
        self.assertEqual(corrected["note"], "The riverside route")
        self.assertAlmostEqual(float(block.get_attribute("data-start-minute")), 620)
        block.click()
        self.page.locator("#record-start").fill("13:00")
        self.page.locator('#record-form button[type="submit"]').click()
        expect(self.page.locator("#record-error")).to_be_visible()
        expect(self.page.locator("#record-dialog")).to_be_visible()
        self.assertEqual(self.state()["entries"][0], corrected)
        self.page.locator('#record-dialog [data-close-dialog]').click()
        self.page.reload(wait_until="networkidle")
        self.assertEqual(self.state()["entries"][0], corrected)

    def test_editing_only_a_note_preserves_the_original_timestamp_precision(self):
        self.page.clock.set_fixed_time(datetime(2026, 10, 25, 3, 0, 17, 123000, tzinfo=timezone.utc))
        self.quick_log("A precisely timed moment")
        original = self.state()["entries"][0]
        self.page.locator(f'#timeline-list .map-event[data-entry-id="{original["id"]}"]').click()
        self.page.locator("#record-note").fill("Added context afterwards")
        self.page.locator('#record-form button[type="submit"]').click()
        expect(self.page.locator("#record-dialog")).not_to_be_visible()
        edited = self.state()["entries"][0]
        self.assertEqual(edited["startAt"], "2026-10-25T03:00:17.123Z")
        self.assertEqual(edited["startAt"], original["startAt"])
        self.assertEqual(edited["endAt"], original["endAt"])
        self.assertEqual(edited["note"], "Added context afterwards")

    def test_add_earlier_activity_and_find_it_across_history(self):
        self.switch_view("history")
        self.page.locator("#previous-day").click()
        self.page.locator('[data-action="log-earlier"]:visible').first.click()
        expect(self.page.locator("#record-date")).to_have_value("2026-10-24")
        self.page.locator("#record-title").fill("Work in the garden")
        self.page.locator("#record-tracking").select_option("timer")
        self.page.locator("#record-start").fill("09:00")
        self.page.locator("#record-end-date").fill("2026-10-24")
        self.page.locator("#record-end").fill("09:45")
        self.page.locator("#record-note").fill("Watered the tomatoes")
        self.page.locator('#record-form button[type="submit"]').click()
        expect(self.page.locator("#record-dialog")).not_to_be_visible()
        entry = self.state()["entries"][0]
        self.assertIsNone(entry["taskId"])
        self.assertEqual(entry["startAt"], "2026-10-24T00:00:00.000Z")
        self.assertEqual(entry["endAt"], "2026-10-24T00:45:00.000Z")
        expect(self.page.locator("#history-timeline")).to_contain_text("Work in the garden")
        self.page.locator("#today-button").click()
        expect(self.page.locator("#history-timeline")).not_to_contain_text("Work in the garden")
        self.page.locator("#history-search").fill("tomatoes")
        expect(self.page.locator("#history-records")).to_contain_text("Work in the garden")
        self.page.locator('#history-records [data-action="visit-entry"]').first.click()
        expect(self.page.locator("#date-picker")).to_have_value("2026-10-24")
        expect(self.page.locator("#history-timeline")).to_contain_text("Work in the garden")
        self.assertEqual(self.state()["entries"][0], entry)

    def test_offline_cold_page_and_mobile_layout(self):
        self.quick_log("Available offline")
        self.page.wait_for_function("navigator.serviceWorker.controller !== null")
        self.page.evaluate("navigator.serviceWorker.ready")
        self.context.set_offline(True)
        offline_page = self.context.new_page()
        offline_page.on("pageerror", lambda error: self.errors.append(str(error)))
        offline_page.clock.set_fixed_time(NOON)
        response = offline_page.goto(BASE, wait_until="networkidle")
        self.assertEqual(response.status, 200)
        self.assertTrue(response.from_service_worker)
        expect(offline_page.locator("#timeline-list")).to_contain_text("Available offline")
        for path in ["styles.css", "model.js", "timeline.js", "app.js", "manifest.json"]:
            status = offline_page.evaluate("path => fetch(path).then(response => response.status)", path)
            self.assertEqual(status, 200, path)
        offline_page.locator("#quick-log-name").fill("Logged without a connection")
        offline_page.locator('#quick-log-form button[type="submit"]').click()
        expect(offline_page.locator("#timeline-list")).to_contain_text("Logged without a connection")
        for width in [320, 375, 390, 430, 768, 1280, 1440]:
            offline_page.set_viewport_size({"width": width, "height": 844})
            self.assert_no_horizontal_overflow(offline_page)
            for view in ["library", "history", "today"]:
                offline_page.locator(f'[data-view="{view}"]:visible').first.click()
                self.assert_no_horizontal_overflow(offline_page)
        offline_page.set_viewport_size({"width": 375, "height": 667})
        offline_page.locator("#add-task").click()
        expect(offline_page.locator("#task-dialog")).to_be_visible()
        self.assert_no_horizontal_overflow(offline_page)
        offline_page.locator("#task-name").fill("Created entirely offline")
        offline_page.locator('#task-form button[type="submit"]').click()
        expect(offline_page.locator("#task-dialog")).not_to_be_visible()
        self.assert_no_horizontal_overflow(offline_page)


if __name__ == "__main__":
    unittest.main(verbosity=2)
