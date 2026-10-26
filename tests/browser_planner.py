"""Calendar/event user flows. Run against the local app with Python Playwright.

    PROKOPE_BASE_URL=http://127.0.0.1:8000/ python3 tests/browser_planner.py

Every test owns a disposable browser context. No runtime dependencies are added.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import unittest

from playwright.sync_api import expect
import browser_smoke as smoke

DAY = "2026-10-27"
NOON = datetime(2026, 10, 27, 3, 0, tzinfo=timezone.utc)


class PlannerBrowserTests(unittest.TestCase):
    setUpClass = classmethod(smoke.ProkopeBrowserTests.setUpClass.__func__)
    tearDownClass = classmethod(smoke.ProkopeBrowserTests.tearDownClass.__func__)
    tearDown = smoke.ProkopeBrowserTests.tearDown
    state = smoke.ProkopeBrowserTests.state
    assert_no_horizontal_overflow = smoke.ProkopeBrowserTests.assert_no_horizontal_overflow
    create_task = smoke.ProkopeBrowserTests.create_task
    quick_log = smoke.ProkopeBrowserTests.quick_log

    def setUp(self):
        self.context = self.browser.new_context(
            viewport={"width": 375, "height": 812}, timezone_id="Asia/Tokyo",
            reduced_motion="reduce", accept_downloads=True,
        )
        self.context.add_init_script(
            "if (localStorage.getItem('keikoroku.v1') === null) "
            "localStorage.setItem('keikoroku.v1', " + json.dumps(smoke.LEGACY) + ");"
        )
        self.errors = []
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.clock.set_fixed_time(NOON)
        self.page.goto(smoke.BASE, wait_until="networkidle")
        expect(self.page.locator("#add-event")).to_be_visible()

    def select_date(self, date):
        self.page.locator("#date-picker").fill(date)
        self.page.locator("#date-picker").dispatch_event("change")
        expect(self.page.locator("#date-picker")).to_have_value(date)

    def calendar(self):
        self.page.locator('[data-view="history"]').click()
        expect(self.page.locator("#calendar-panel")).to_be_visible()

    def create_event(self, name, date=DAY, repeat="once", start="09:00", end="", color="#55786a", **settings):
        page = self.page
        page.locator("#add-event").click()
        expect(page.locator("#event-dialog")).to_be_visible()
        page.locator("#event-name").fill(name)
        page.locator("#event-date").fill(date)
        page.locator("#event-all-day").set_checked(settings.get("all_day", False))
        if not settings.get("all_day", False):
            page.locator("#event-start").fill(start)
            page.locator("#event-end").fill(end)
            page.locator("#event-end").dispatch_event("change")
            if end:
                page.locator("#event-next-day").set_checked(settings.get("overnight", False))
        page.locator("#event-repeat").select_option(repeat)
        if repeat == "weekdays":
            for day in range(7):
                page.locator(f'[name="event-weekday"][value="{day}"]').set_checked(day in settings.get("weekdays", [1, 2, 3, 4, 5]))
        elif repeat == "interval":
            page.locator("#event-interval").fill(str(settings.get("interval", 2)))
        elif repeat == "monthly":
            page.locator("#event-monthday").fill(str(settings.get("month_day", 15)))
        if settings.get("until"):
            page.locator("#event-until").fill(settings["until"])
        page.locator("#event-color").fill(color)
        page.locator("#event-color").dispatch_event("input")
        if settings.get("note") or settings.get("location"):
            page.locator("#event-details summary").click()
            page.locator("#event-note").fill(settings.get("note", ""))
            page.locator("#event-location").fill(settings.get("location", ""))
        self.assert_no_horizontal_overflow()
        dimensions = page.locator("#event-dialog").evaluate("el => ({width: el.clientWidth, content: el.scrollWidth})")
        self.assertLessEqual(dimensions["content"], dimensions["width"] + 1)
        page.locator("#event-save").click()
        expect(page.locator("#event-dialog")).not_to_be_visible()
        matches = [task for task in self.state()["tasks"] if task["name"] == name]
        self.assertEqual(len(matches), 1)
        return matches[0]

    def event_on_map(self, event, history=False):
        container = "#history-timeline" if history else "#timeline-list"
        return self.page.locator(f'{container} [data-action="edit-event"][data-id="{event["id"]}"]')

    def test_timeline_only_event_does_not_count_as_a_task(self):
        routine = self.create_task("Take creatine", startDate=DAY)
        event = self.create_event("Wake up", repeat="daily", start="07:00", color="#447b9b")
        mark = self.event_on_map(event)
        expect(mark).to_have_attribute("data-start-minute", "420")
        expect(mark).to_have_attribute("data-end-minute", "420")
        self.assertEqual(mark.evaluate("el => el.style.getPropertyValue('--item-color')"), "#447b9b")
        for section in ["#routine-list", "#planned-list", "#optional-list"]:
            expect(self.page.locator(section)).not_to_contain_text("Wake up")
        self.assertEqual(self.state()["entries"], [])
        expect(self.page.locator("#day-summary .summary-value").first).to_have_text("0 / 1")
        mark.click()
        expect(self.page.locator("#event-dialog")).to_be_visible()
        self.assertEqual(self.page.locator('#event-dialog [data-action="complete"], #event-dialog [data-action="start"]').count(), 0)
        self.page.locator("#event-close").click()
        self.page.locator(f'[data-action="complete"][data-id="{routine["id"]}"]').click()
        expect(self.page.locator("#day-summary .summary-value").first).to_have_text("1 / 1")
        self.assertEqual(len(self.state()["entries"]), 1)
        self.assertEqual(self.state()["entries"][0]["taskId"], routine["id"])
        self.page.reload(wait_until="networkidle")
        expect(self.event_on_map(event)).to_contain_text("Wake up")

    def test_weekly_overnight_and_appointment_calendar_details(self):
        shift = self.create_event("Night shift", repeat="weekdays", weekdays=[2], start="22:00", end="06:00", overnight=True, until="2026-11-03", color="#8067a3")
        expect(self.event_on_map(shift)).to_have_attribute("data-start-minute", "1320")
        expect(self.event_on_map(shift)).to_have_attribute("data-end-minute", "1440")
        self.calendar()
        self.page.locator('[data-action="calendar-day"][data-date="2026-10-28"]').click()
        expect(self.event_on_map(shift, history=True)).to_have_attribute("data-start-minute", "0")
        expect(self.event_on_map(shift, history=True)).to_have_attribute("data-end-minute", "360")
        expect(self.page.locator(".calendar-agenda")).to_contain_text("From previous day")
        self.page.locator('.calendar-agenda [data-action="edit-event"]').click()
        expect(self.page.locator("#event-skip")).to_contain_text("Oct 27")
        self.page.locator("#event-close").click()
        appointment = self.create_event("Doctor appointment", date="2026-10-29", start="14:30", end="15:15", color="#b4647a", location="West clinic", note="Bring previous results")
        self.page.locator('[data-action="calendar-day"][data-date="2026-10-29"]').click()
        agenda = self.page.locator(f'.calendar-agenda [data-id="{appointment["id"]}"]')
        expect(agenda).to_contain_text("14:30–15:15")
        expect(agenda).to_contain_text("West clinic")
        expect(agenda).to_contain_text("Bring previous results")
        self.assertEqual(agenda.evaluate("el => el.style.getPropertyValue('--item-color')"), "#b4647a")
        cell = self.page.locator('[data-action="calendar-day"][data-date="2026-10-29"]')
        expect(cell).to_contain_text("Doctor appointment")
        self.assertEqual(cell.locator(".calendar-chip-event").evaluate("el => el.style.getPropertyValue('--item-color')"), "#b4647a")
        self.page.locator('[data-action="calendar-month"][data-delta="1"]').click()
        expect(self.page.locator("#calendar-month-label")).to_have_text("November 2026")
        self.page.locator('[data-action="calendar-day"][data-date="2026-11-03"]').click()
        expect(self.page.locator(".calendar-agenda")).to_contain_text("Night shift")
        self.page.locator('[data-action="calendar-day"][data-date="2026-11-10"]').click()
        expect(self.page.locator(".calendar-agenda")).not_to_contain_text("Night shift")

    def test_all_day_interval_and_monthly_events(self):
        rest = self.create_event("Rest day", all_day=True)
        expect(self.event_on_map(rest)).to_have_class("all-day-event")
        interval = self.create_event("Water plants", repeat="interval", interval=2, start="08:00")
        monthly = self.create_event("Pay rent", repeat="monthly", month_day=15, start="10:00")
        self.calendar()
        self.select_date("2026-10-29")
        expect(self.page.locator(".calendar-agenda")).to_contain_text("Water plants")
        expect(self.page.locator(".calendar-agenda")).not_to_contain_text("Rest day")
        self.select_date("2026-10-30")
        expect(self.page.locator(".calendar-agenda")).not_to_contain_text("Water plants")
        self.select_date("2026-11-15")
        expect(self.event_on_map(monthly, history=True)).to_contain_text("Pay rent")
        self.assertEqual(self.state()["entries"], [])

    def test_skip_restore_and_edit_series(self):
        event = self.create_event("Morning walk", repeat="daily", start="07:00")
        self.event_on_map(event).click()
        self.page.locator("#event-skip").click()
        expect(self.event_on_map(event)).to_have_count(0)
        self.assertEqual(self.state()["tasks"][0]["excludedDates"], [DAY])
        self.calendar()
        expect(self.page.locator(".calendar-agenda")).not_to_contain_text("Morning walk")
        self.page.locator('[data-action="calendar-day"][data-date="2026-10-28"]').click()
        self.page.locator('.calendar-agenda [data-action="edit-event"]').click()
        self.page.locator("#event-skipped summary").click()
        self.page.locator(f'[data-event-restore="{DAY}"]').click()
        self.assertEqual(self.state()["tasks"][0]["excludedDates"], [])
        self.page.locator("#event-name").fill("Morning stretch")
        self.page.locator("#event-start").fill("08:15")
        self.page.locator("#event-color").fill("#bc754d")
        self.page.locator("#event-save").click()
        self.page.locator('[data-action="calendar-day"][data-date="2026-10-27"]').click()
        expect(self.page.locator(".calendar-agenda")).to_contain_text("Morning stretch")
        expect(self.event_on_map(event, history=True)).to_have_attribute("data-start-minute", "495")
        self.page.locator('.calendar-agenda [data-action="edit-event"]').click()
        expect(self.page.locator("#event-series-hint")).to_be_visible()
        self.page.locator("#event-end").fill("07:00")
        self.page.locator("#event-next-day").uncheck()
        self.page.locator("#event-save").click()
        expect(self.page.locator("#event-error")).to_be_visible()
        self.assertEqual(self.state()["tasks"][0]["schedule"]["endTime"], "")

    def test_activity_color_snapshots_and_record_color_correction(self):
        routine = self.create_task("Read a chapter", startDate=DAY)
        self.page.locator(f'[data-action="edit"][data-id="{routine["id"]}"]').first.click()
        self.page.locator("#task-color").fill("#447b9b")
        self.page.locator('#task-form button[type="submit"]').click()
        self.page.locator(f'[data-action="complete"][data-id="{routine["id"]}"]').click()
        entry = self.state()["entries"][0]
        self.assertEqual(entry["color"], "#447b9b")
        self.page.locator(f'[data-action="edit"][data-id="{routine["id"]}"]').first.click()
        self.page.locator("#task-color").fill("#bc754d")
        self.page.locator('#task-form button[type="submit"]').click()
        self.assertEqual(self.state()["entries"][0]["color"], "#447b9b")
        self.page.locator(f'#timeline-list [data-entry-id="{entry["id"]}"]').click()
        self.page.locator("#record-color").fill("#8067a3")
        self.page.locator("#record-save").click()
        self.assertEqual(self.state()["entries"][0]["color"], "#8067a3")
        self.assertEqual(self.state()["tasks"][0]["color"], "#bc754d")
        self.calendar()
        record = self.page.locator(f'.calendar-agenda [data-id="{entry["id"]}"]')
        self.assertEqual(record.evaluate("el => el.style.getPropertyValue('--item-color')"), "#8067a3")

    def test_backup_restores_event_details_and_skipped_dates(self):
        event = self.create_event("Work", repeat="weekdays", color="#123456", location="Office", note="Project planning", until="2027-01-31", start="09:00", end="17:00")
        self.event_on_map(event).click()
        self.page.locator("#event-skip").click()
        self.quick_log("Breakfast")
        original = self.state()
        self.page.locator("#open-settings").click()
        with self.page.expect_download() as download_info:
            self.page.locator("#export-data").click()
        raw = Path(download_info.value.path()).read_bytes()
        self.assertEqual(json.loads(raw)["data"], original)
        self.page.locator('#settings-dialog [data-close-dialog]').click()
        self.create_event("After backup", all_day=True)
        self.page.locator("#open-settings").click()
        self.page.locator("#restore-file").set_input_files({"name": "planner.json", "mimeType": "application/json", "buffer": raw})
        expect(self.page.locator("#confirm-dialog")).to_be_visible()
        self.page.locator("#confirm-accept").click()
        expect(self.page.locator("#settings-dialog")).not_to_be_visible()
        self.assertEqual(self.state(), original)
        self.assertEqual(self.page.evaluate("localStorage.getItem('keikoroku.v1')"), smoke.LEGACY)
        safety = self.page.evaluate("JSON.parse(localStorage.getItem('prokope.daily.v1.before-restore'))")
        self.assertEqual(len(safety["tasks"]), 2)
        self.calendar()
        self.select_date("2026-10-28")
        expect(self.page.locator(".calendar-agenda")).to_contain_text("Project planning")
        expect(self.page.locator(".calendar-agenda")).to_contain_text("Office")

    def test_offline_calendar_reload_and_mobile_layout(self):
        event = self.create_event("An appointment with a long name to check the small screen", repeat="daily", start="09:00", end="10:00", note="Bring documents and the appointment confirmation.", location="Main reception", color="#123456")
        self.page.wait_for_function("navigator.serviceWorker.controller !== null")
        self.page.evaluate("navigator.serviceWorker.ready")
        self.context.set_offline(True)
        response = self.page.reload(wait_until="networkidle")
        self.assertEqual(response.status, 200)
        self.assertTrue(response.from_service_worker)
        for path in ["events-ui.js", "events.css", "calendar.js", "calendar.css"]:
            self.assertEqual(self.page.evaluate("path => fetch(path).then(response => response.status)", path), 200, path)
        self.calendar()
        expect(self.page.locator(".calendar-agenda")).to_contain_text(event["name"])
        for width in [320, 375, 390, 768, 1280]:
            self.page.set_viewport_size({"width": width, "height": 812})
            self.assert_no_horizontal_overflow()
        self.page.set_viewport_size({"width": 375, "height": 812})
        offline = self.create_event("Offline plan", date="2026-10-28", start="16:00", end="17:00", color="#abcdef")
        self.page.locator('[data-action="calendar-day"][data-date="2026-10-28"]').click()
        expect(self.page.locator(".calendar-agenda")).to_contain_text("Offline plan")
        self.event_on_map(offline, history=True).click()
        self.assert_no_horizontal_overflow()
        self.page.locator("#event-name").fill("Offline plan updated")
        self.page.locator("#event-save").click()
        self.assertEqual(self.state()["tasks"][-1]["name"], "Offline plan updated")

    def test_stale_event_editor_preserves_newer_changes(self):
        event = self.create_event("Work", repeat="daily", start="09:00", end="17:00")
        self.event_on_map(event).click()
        self.page.locator("#event-name").fill("Stale edit")
        other = self.context.new_page()
        other.goto(smoke.BASE, wait_until="networkidle")
        other.evaluate("""id => {
            const state = JSON.parse(localStorage.getItem('prokope.daily.v1'));
            ProkopeModel.updateTask(state, id, {name: 'Newer work schedule', schedule: {time: '10:00'}});
            localStorage.setItem('prokope.daily.v1', JSON.stringify(state));
        }""", event["id"])
        self.page.locator("#event-save").click()
        expect(self.page.locator("#event-error")).to_contain_text("changed in another window")
        expect(self.page.locator("#event-dialog")).to_be_visible()
        self.assertEqual(self.state()["tasks"][0]["name"], "Newer work schedule")
        self.assertEqual(self.state()["tasks"][0]["schedule"]["time"], "10:00")
        other.close()

    def test_archive_preserves_past_and_restore_returns_schedule(self):
        event = self.create_event("Work", date="2026-10-26", repeat="daily", start="09:00", end="17:00")
        self.event_on_map(event).click()
        self.page.locator("#event-archive").click()
        self.page.locator("#confirm-accept").click()
        expect(self.page.locator("#event-dialog")).not_to_be_visible()
        expect(self.event_on_map(event)).to_have_count(0)
        self.select_date("2026-10-26")
        expect(self.event_on_map(event)).to_have_count(1)
        self.page.locator('[data-view="library"]').click()
        self.page.locator("#show-archived").check()
        self.page.locator(f'#library-list [data-action="edit-event"][data-id="{event["id"]}"]').click()
        self.page.locator("#event-name").fill("Cannot change while archived")
        self.page.locator("#event-form").evaluate("form => form.requestSubmit()")
        expect(self.page.locator("#event-error")).to_contain_text("Restore this event")
        self.assertEqual(self.state()["tasks"][0]["name"], "Work")
        self.page.locator("#event-restore").click()
        self.page.locator('[data-view="today"]').click()
        expect(self.event_on_map(event)).to_have_count(1)
        self.assertIsNone(self.state()["tasks"][0]["archivedAt"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
