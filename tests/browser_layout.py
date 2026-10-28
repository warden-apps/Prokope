"""Focused navigation and filtering checks for the daily planner."""
from datetime import timedelta
import unittest

from playwright.sync_api import expect
import browser_smoke as smoke


class LayoutBrowserTests(unittest.TestCase):
    setUpClass = classmethod(smoke.ProkopeBrowserTests.setUpClass.__func__)
    tearDownClass = classmethod(smoke.ProkopeBrowserTests.tearDownClass.__func__)
    setUp = smoke.ProkopeBrowserTests.setUp
    tearDown = smoke.ProkopeBrowserTests.tearDown
    state = smoke.ProkopeBrowserTests.state
    assert_no_horizontal_overflow = smoke.ProkopeBrowserTests.assert_no_horizontal_overflow

    def seed(self):
        self.page.evaluate("""() => {
            const M = ProkopeModel, s = M.newState(), date = M.localDate();
            M.createTask(s, {name:'Creatine', kind:'routine', schedule:{type:'daily', startDate:date, time:'08:00'}});
            const timer = M.createTask(s, {name:'Reading', kind:'optional', tracking:'timer'});
            M.startTask(s, timer.id, new Date(date + 'T11:00:00+09:00'));
            M.createTask(s, {name:'Work', kind:'event', location:'Studio', note:'Design review', color:'#447b9b', schedule:{type:'daily', startDate:'2026-10-01', time:'09:00', endTime:'17:00'}});
            const archived = M.createTask(s, {name:'Old routine', kind:'routine', schedule:{type:'daily', startDate:date}});
            M.archiveTask(s, archived.id);
            localStorage.setItem('prokope.daily.v1', JSON.stringify(s));
        }""")
        self.page.reload(wait_until='networkidle')

    def test_quick_log_and_focused_panels_at_phone_and_desktop_sizes(self):
        for theme in ['light', 'dark']:
            self.page.evaluate('value => ProkopeTheme.setPreference(value)', theme)
            for width in [320, 390, 768, 1280]:
                self.page.set_viewport_size({'width':width, 'height':844})
                smoke.show_today_panel(self.page, 'timeline')
                expect(self.page.locator('#daily-activities')).not_to_be_visible()
                self.page.evaluate('scrollTo(0, 0)')
                box = self.page.locator('#quick-log-name').bounding_box()
                self.assertLess(box['y'] + box['height'], 700)
                self.assert_no_horizontal_overflow()
                self.page.locator('[data-today-panel="tasks"]').focus()
                self.page.keyboard.press('Enter')
                expect(self.page.locator('#daily-activities')).to_be_visible()
                expect(self.page.locator('#today-map-panel')).not_to_be_visible()
                expect(self.page.locator('#quick-log-name')).to_be_visible()
                self.assert_no_horizontal_overflow()
        self.page.locator('#quick-log-name').fill('A short walk')
        self.page.locator('.quick-log-button').click()
        self.assertEqual(self.state()['entries'][0]['title'], 'A short walk')

    def test_timeline_scroll_survives_hidden_panel_timer_refresh_and_navigation(self):
        self.seed()
        before = self.state()
        scroller = self.page.locator('#timeline-list .day-scroll')
        scroller.evaluate('el => el.scrollTop = 850')
        self.page.wait_for_function("document.querySelector('#timeline-list .day-scroll').scrollTop === 850")
        smoke.show_today_panel(self.page, 'tasks')
        self.page.clock.set_fixed_time(smoke.NOON + timedelta(minutes=2))
        self.page.wait_for_function("document.querySelector('#live-clock-value').textContent.startsWith('12:02')")
        smoke.show_today_panel(self.page, 'timeline')
        self.assertEqual(scroller.evaluate('el => el.scrollTop'), 850)
        self.page.locator('[data-view="library"]').click()
        self.page.locator('[data-view="today"]').click()
        self.assertEqual(scroller.evaluate('el => el.scrollTop'), 850)
        smoke.show_today_panel(self.page, 'tasks')
        self.page.reload(wait_until='networkidle')
        expect(self.page.locator('[data-today-panel="tasks"]')).to_have_attribute('aria-pressed', 'true')
        expect(self.page.locator('#daily-activities')).to_be_visible()
        self.assertEqual(self.state(), before)

    def test_library_filters_names_notes_types_and_archived_items(self):
        self.seed()
        before = self.state()
        self.page.locator('[data-view="library"]').click()
        expect(self.page.locator('#library-results')).to_have_text('3 activities')
        expect(self.page.locator('.library-group')).to_have_count(3)
        self.page.locator('#library-search').fill('design')
        expect(self.page.locator('#library-list .task-name')).to_have_text('Work')
        self.page.locator('#library-kind').select_option('routine')
        expect(self.page.locator('#library-list')).to_contain_text('No matching activities.')
        self.page.locator('#library-search').fill('')
        expect(self.page.locator('#library-list .task-name')).to_have_text('Creatine')
        self.page.locator('#show-archived').check()
        expect(self.page.locator('#library-results')).to_have_text('2 activities')
        self.page.locator('#library-search').fill('old')
        self.page.reload(wait_until='networkidle')
        expect(self.page.locator('#library-kind')).to_have_value('routine')
        expect(self.page.locator('#show-archived')).to_be_checked()
        expect(self.page.locator('#library-list .task-name')).to_have_text('Old routine')
        expect(self.page.locator('#library-list [data-action="edit"]')).to_be_visible()
        self.assertEqual(self.state(), before)

    def test_calendar_details_are_optional_and_new_layout_loads_offline(self):
        self.seed()
        self.page.locator('[data-view="history"]').click()
        expect(self.page.locator('.calendar-agenda')).to_be_visible()
        self.page.locator('#calendar-date-picker').fill('2030-04-15')
        self.page.locator('#calendar-date-picker').dispatch_event('change')
        expect(self.page.locator('#calendar-month-label')).to_have_text('April 2030')
        expect(self.page.locator('.calendar-day.is-selected')).to_have_attribute('data-date', '2030-04-15')
        self.page.locator('[data-action="calendar-today"]').click()
        expect(self.page.locator('#history-timeline')).not_to_be_visible()
        expect(self.page.locator('.calendar-insights')).not_to_be_visible()
        self.page.locator('#calendar-day-details > summary').focus()
        self.page.keyboard.press('Enter')
        expect(self.page.locator('#history-timeline .day-scroll')).to_be_visible()
        self.assertGreater(self.page.locator('#history-timeline .day-scroll').evaluate('el => el.scrollTop'), 500)
        smoke.open_calendar_totals(self.page)
        self.page.locator('[data-calendar-filter="events"]').click()
        expect(self.page.locator('.calendar-insights')).to_be_visible()
        self.page.wait_for_function('navigator.serviceWorker.controller !== null')
        self.context.set_offline(True)
        response = self.page.reload(wait_until='networkidle')
        self.assertTrue(response.from_service_worker)
        expect(self.page.locator('#history-timeline .day-scroll')).to_be_visible()
        asset = self.page.evaluate("fetch('planner.css').then(r => ({status:r.status,type:r.headers.get('content-type')}))")
        self.assertEqual(asset['status'], 200)
        self.assertIn('text/css', asset['type'])
        self.assert_no_horizontal_overflow()


if __name__ == '__main__':
    unittest.main(verbosity=2)
