"""Interaction regressions for the final planner polish.

Run with the same PROKOPE_BASE_URL and Chromium setup as browser_planner.py.
"""
from datetime import datetime, timezone
import unittest
from playwright.sync_api import expect
import browser_planner as planner
import browser_smoke as smoke


class PolishBrowserTests(unittest.TestCase):
    setUpClass = classmethod(planner.PlannerBrowserTests.setUpClass.__func__)
    tearDownClass = classmethod(planner.PlannerBrowserTests.tearDownClass.__func__)
    setUp = planner.PlannerBrowserTests.setUp
    tearDown = planner.PlannerBrowserTests.tearDown
    state = planner.PlannerBrowserTests.state
    create_task = planner.PlannerBrowserTests.create_task
    create_event = planner.PlannerBrowserTests.create_event
    quick_log = planner.PlannerBrowserTests.quick_log
    calendar = planner.PlannerBrowserTests.calendar
    select_date = planner.PlannerBrowserTests.select_date
    event_on_map = planner.PlannerBrowserTests.event_on_map
    assert_no_horizontal_overflow = planner.PlannerBrowserTests.assert_no_horizontal_overflow

    def test_calendar_search_filters_and_reload_keep_context(self):
        self.create_event('Doctor', start='14:00', end='15:00', location='Café clinic', note='Bring card')
        self.quick_log('Breakfast')
        self.calendar()
        before = self.state()
        smoke.open_calendar_totals(self.page)
        totals = self.page.locator('.calendar-insights').inner_text()
        self.page.locator('[data-calendar-filter="events"]').click()
        expect(self.page.locator('.calendar-agenda')).to_contain_text('Doctor')
        expect(self.page.locator('.calendar-agenda')).not_to_contain_text('Breakfast')
        self.page.locator('#calendar-search').fill('CAFE bring')
        expect(self.page.locator('.calendar-filter-note')).to_contain_text('1 match this month')
        self.assertEqual(self.page.locator('.calendar-insights').inner_text(), totals)
        self.page.locator('#calendar-search').fill('missing')
        expect(self.page.locator('.calendar-agenda')).to_contain_text('No matching items')
        self.page.locator('#calendar-search').fill('')
        self.page.locator('[data-calendar-filter="records"]').click()
        expect(self.page.locator('.calendar-agenda')).to_contain_text('Breakfast')
        expect(self.page.locator('.calendar-agenda')).not_to_contain_text('Doctor')
        self.select_date('2026-10-29')
        self.page.locator('#calendar-search').fill('Breakfast')
        self.page.reload(wait_until='networkidle')
        expect(self.page.locator('#history-view')).to_be_visible()
        expect(self.page.locator('#date-picker')).to_have_value('2026-10-29')
        expect(self.page.locator('#calendar-search')).to_have_value('Breakfast')
        expect(self.page.locator('[data-calendar-filter="records"]')).to_have_attribute('aria-pressed', 'true')
        self.assertEqual(self.state(), before)
        for width in [320, 375, 768, 1440]:
            self.page.set_viewport_size({'width': width, 'height': 844})
            self.assert_no_horizontal_overflow()

    def test_timeline_hour_and_blank_space_seed_time_without_drag_creation(self):
        self.select_date('2026-10-28')
        self.page.locator('#timeline-list [data-action="new-event-time"][data-time="09:00"]').click()
        expect(self.page.locator('#event-date')).to_have_value('2026-10-28')
        expect(self.page.locator('#event-start')).to_have_value('09:00')
        self.page.locator('#event-close').click()
        expect(self.page.locator('#confirm-dialog')).not_to_be_visible()
        self.page.locator('#timeline-list .day-scroll').evaluate('el => el.scrollTop = 500')
        box = self.page.locator('#timeline-list .day-canvas').bounding_box()
        x, y = box['x'] + box['width'] - 20, box['y'] + 24 + 570
        self.page.mouse.move(x, y)
        self.page.mouse.down()
        self.page.mouse.move(x, y + 35, steps=4)
        self.page.mouse.up()
        expect(self.page.locator('#event-dialog')).not_to_be_visible()
        self.page.mouse.click(x, y)
        expect(self.page.locator('#event-start')).to_have_value('09:30')
        self.page.locator('#event-name').fill('New from timeline')
        self.page.locator('#event-save').click()
        self.assertEqual(self.state()['tasks'][0]['schedule']['time'], '09:30')
        expect(self.page.locator('#timeline-list .map-event')).to_have_attribute('data-start-minute', '570')

    def test_event_duplicate_has_new_identity_and_no_skipped_dates(self):
        event = self.create_event('Work', repeat='daily', start='09:00', end='17:00', location='Studio', note='Bring laptop', color='#8067a3')
        self.event_on_map(event).click()
        self.page.locator('#event-skip').click()
        original = self.state()['tasks'][0]
        self.calendar()
        self.select_date('2026-10-28')
        self.page.locator('.calendar-agenda [data-action="edit-event"]').click()
        self.page.locator('#event-duplicate').click()
        expect(self.page.locator('#event-repeat')).to_have_value('once')
        expect(self.page.locator('#event-date')).to_have_value('2026-10-28')
        self.page.locator('#event-name').fill('Extra shift')
        self.page.locator('#event-save').click()
        tasks = self.state()['tasks']
        self.assertEqual(tasks[0], original)
        self.assertNotEqual(tasks[1]['id'], original['id'])
        self.assertEqual(tasks[1]['excludedDates'], [])
        self.assertEqual(tasks[1]['color'], '#8067a3')
        self.assertEqual(tasks[1]['location'], 'Studio')
        self.assertEqual(tasks[1]['schedule']['type'], 'once')
        self.assertEqual(tasks[1]['note'], 'Bring laptop')

    def test_overnight_preview_and_explicit_override(self):
        self.page.locator('#add-event').click()
        self.page.locator('#event-name').fill('Sleep')
        self.page.locator('#event-start').fill('22:00')
        self.page.locator('#event-end').fill('07:00')
        expect(self.page.locator('#event-next-day')).to_be_checked()
        expect(self.page.locator('#event-preview')).to_contain_text('9h')
        expect(self.page.locator('#event-preview')).to_contain_text('Ends Wed, Oct 28')
        self.page.locator('#event-next-day').uncheck()
        self.page.locator('#event-end').dispatch_event('change')
        expect(self.page.locator('#event-next-day')).not_to_be_checked()
        self.page.locator('#event-save').click()
        expect(self.page.locator('#event-error')).to_be_visible()
        self.assertEqual(self.state()['tasks'], [])
        self.page.locator('#event-next-day').check()
        self.page.locator('#event-save').click()
        self.assertTrue(self.state()['tasks'][0]['schedule']['endNextDay'])

    def test_unsaved_event_close_and_escape_can_keep_or_discard(self):
        self.page.locator('#add-event').click()
        self.page.locator('#event-name').fill('A draft')
        self.page.locator('#event-close').click()
        expect(self.page.locator('#confirm-dialog')).to_be_visible()
        self.page.locator('#confirm-cancel').click()
        expect(self.page.locator('#event-name')).to_have_value('A draft')
        self.page.keyboard.press('Escape')
        expect(self.page.locator('#confirm-dialog')).to_be_visible()
        self.page.locator('#confirm-accept').click()
        expect(self.page.locator('#event-dialog')).not_to_be_visible()
        self.assertEqual(self.state()['tasks'], [])
        self.page.locator('#add-event').click()
        self.page.keyboard.press('Escape')
        expect(self.page.locator('#event-dialog')).not_to_be_visible()
        expect(self.page.locator('#confirm-dialog')).not_to_be_visible()

    def test_stale_activity_editor_cannot_overwrite_schedule(self):
        task = self.create_task('Creatine', startDate=planner.DAY, time='09:00')
        self.page.locator(f'#routine-list [data-action="edit"][data-id="{task["id"]}"]').click()
        other = self.context.new_page()
        other.goto(smoke.BASE, wait_until='networkidle')
        other.evaluate("""id => {
            const state=JSON.parse(localStorage.getItem('prokope.daily.v1'));
            ProkopeModel.updateTask(state,id,{name:'Updated creatine',schedule:{time:'10:00'}});
            localStorage.setItem('prokope.daily.v1',JSON.stringify(state));
        }""", task['id'])
        self.page.locator('#task-name').fill('Stale name')
        self.page.locator('#task-form button[type="submit"]').click()
        expect(self.page.locator('#task-error')).to_contain_text('changed in another window')
        self.assertEqual(self.state()['tasks'][0]['schedule']['time'], '10:00')
        self.assertEqual(self.state()['tasks'][0]['name'], 'Updated creatine')
        other.close()

    def test_supported_calendar_boundaries_and_long_interval_navigation(self):
        self.select_date('0001-01-01')
        expect(self.page.locator('#previous-day')).to_be_disabled()
        self.calendar()
        expect(self.page.locator('[data-action="calendar-month"][data-delta="-1"]')).to_be_disabled()
        self.select_date('9999-12-31')
        expect(self.page.locator('#next-day')).to_be_disabled()
        expect(self.page.locator('[data-action="calendar-month"][data-delta="1"]')).to_be_disabled()
        self.page.locator('[data-view="today"]').click()
        self.create_event('Annual review', date='2026-01-01', repeat='interval', interval=365, start='09:00')
        expect(self.page.locator('#date-picker')).to_have_value('2027-01-01')
        expect(self.page.locator('.calendar-agenda')).to_contain_text('Annual review')

    def test_schedule_glance_advances_without_recording_events(self):
        self.create_event('Work', start='09:00', end='17:00')
        self.create_event('Doctor', start='18:00', end='19:00')
        glance = self.page.locator('#schedule-glance')
        expect(glance).to_contain_text('Scheduled now')
        expect(glance).to_contain_text('Work')
        expect(glance).to_contain_text('Up next')
        expect(glance).to_contain_text('Doctor')
        self.page.clock.set_fixed_time(datetime(2026,10,27,9,30,tzinfo=timezone.utc))
        expect(glance).not_to_contain_text('Work')
        expect(glance).to_contain_text('Until 19:00')
        self.assertEqual(self.state()['entries'], [])

    def test_long_event_label_stays_visible_when_scrolling(self):
        event = self.create_event('Work', start='09:00', end='17:00')
        scroller = self.page.locator('#timeline-list .day-scroll')
        scroller.evaluate('el => el.scrollTop = 750')
        block = self.event_on_map(event)
        label = block.locator('.event-label').bounding_box()
        viewport = scroller.bounding_box()
        self.assertGreaterEqual(label['y'], viewport['y'])
        self.assertLess(label['y'] + label['height'], viewport['y'] + viewport['height'])
        block.locator('.event-title').click()
        expect(self.page.locator('#event-name')).to_have_value('Work')


if __name__ == '__main__':
    unittest.main(verbosity=2)
