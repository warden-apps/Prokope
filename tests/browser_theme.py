"""Theme behavior and visual-readability checks in disposable Chromium contexts.

    PROKOPE_BASE_URL=http://127.0.0.1:8000/ python3 tests/browser_theme.py

Requires the same Python Playwright/Chromium setup as browser_smoke.py.
"""
from datetime import datetime, timezone
import unittest

from playwright.sync_api import expect
import browser_smoke as smoke

NOON = datetime(2026, 10, 27, 3, 0, tzinfo=timezone.utc)

# Resolve CSS colors through canvas so color-mix()/color(srgb ...) values are
# measured as displayed, then composite transparent ancestor backgrounds.
CONTRAST = """el => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    const rgba = color => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data).map(n => n / 255);
    };
    const blend = (front, back) => front.slice(0, 3).map((n, i) => n * front[3] + back[i] * (1 - front[3])).concat(1);
    const chain = [];
    for (let node = el; node; node = node.parentElement) chain.unshift(node);
    let background = [1, 1, 1, 1];
    chain.forEach(node => background = blend(rgba(getComputedStyle(node).backgroundColor), background));
    const style = getComputedStyle(el), foreground = rgba(style.color);
    foreground[3] *= Number(style.opacity);
    const text = blend(foreground, background);
    const luminance = color => color.slice(0, 3).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    const values = [luminance(text), luminance(background)].sort((a, b) => b - a);
    return {ratio: (values[0] + .05) / (values[1] + .05), foreground: style.color, background, text: el.textContent.trim().slice(0, 80)};
}"""


class ThemeBrowserTests(unittest.TestCase):
    setUpClass = classmethod(smoke.ProkopeBrowserTests.setUpClass.__func__)
    tearDownClass = classmethod(smoke.ProkopeBrowserTests.tearDownClass.__func__)
    tearDown = smoke.ProkopeBrowserTests.tearDown
    state = smoke.ProkopeBrowserTests.state
    assert_no_horizontal_overflow = smoke.ProkopeBrowserTests.assert_no_horizontal_overflow

    def setUp(self):
        self.context = self.browser.new_context(
            viewport={"width": 390, "height": 844}, timezone_id="Asia/Tokyo",
            color_scheme="dark", reduced_motion="reduce", accept_downloads=True,
        )
        self.errors = []
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.clock.set_fixed_time(NOON)
        self.page.goto(smoke.BASE, wait_until="networkidle")
        expect(self.page.locator("#add-event")).to_be_visible()

    def choose_theme(self, preference):
        self.page.locator("#open-settings").click()
        self.page.locator("#theme-preference").select_option(preference)
        self.page.locator('#settings-dialog [data-close-dialog]').click()

    def assert_theme(self, theme, page=None):
        page = page or self.page
        expect(page.locator("html")).to_have_attribute("data-theme", theme)
        self.assertEqual(page.evaluate("getComputedStyle(document.documentElement).colorScheme"), theme)
        expected = "#1b2421" if theme == "dark" else "#f6f5f0"
        expect(page.locator('meta[name="theme-color"]')).to_have_attribute("content", expected)

    def assert_readable(self, selector, threshold=4.5):
        locator = self.page.locator(selector).first
        expect(locator).to_be_visible()
        result = locator.evaluate(CONTRAST)
        self.assertGreaterEqual(result["ratio"], threshold, {"selector": selector, **result})

    def seed_records(self):
        self.page.evaluate("""() => {
            const M = ProkopeModel, state = M.newState(), date = M.localDate();
            const routine = M.createTask(state, {name:'Creatine', kind:'routine', color:'#55786a', schedule:{type:'daily', startDate:date, time:'08:00'}});
            M.completeTask(state, routine.id, new Date(date + 'T08:15:00+09:00'));
            const timer = M.createTask(state, {name:'Reading', kind:'optional', tracking:'timer'});
            M.startTask(state, timer.id, new Date(date + 'T11:00:00+09:00'));
            M.createTask(state, {name:'Work', kind:'event', color:'#ffffff', location:'Studio', note:'Project planning', schedule:{type:'once', date, time:'09:00', endTime:'17:00'}});
            M.createTask(state, {name:'Appointment', kind:'event', color:'#0a0a0a', schedule:{type:'once', date, time:'18:00', endTime:'19:00'}});
            localStorage.setItem('prokope.daily.v1', JSON.stringify(state));
            localStorage.setItem('keikoroku.v1', 'previous ledger stays');
        }""")
        self.page.reload(wait_until="networkidle")

    def test_system_follows_device_and_manual_choice_persists(self):
        self.assert_theme("dark")
        self.assertEqual(self.page.evaluate("ProkopeTheme.getPreference()"), "system")
        self.page.emulate_media(color_scheme="light")
        self.assert_theme("light")
        self.page.emulate_media(color_scheme="dark")
        self.assert_theme("dark")
        self.choose_theme("light")
        self.assert_theme("light")
        self.page.reload(wait_until="networkidle")
        self.assert_theme("light")
        self.assertEqual(self.page.evaluate("localStorage.getItem('prokope.theme.v1')"), "light")
        self.choose_theme("dark")
        self.page.emulate_media(color_scheme="light")
        self.assert_theme("dark")
        self.choose_theme("system")
        self.assert_theme("light")
        self.page.emulate_media(color_scheme="dark")
        self.assert_theme("dark")

    def test_theme_changes_sync_between_windows_without_changing_records(self):
        self.seed_records()
        before = self.state()
        other = self.context.new_page()
        other.goto(smoke.BASE, wait_until="networkidle")
        self.choose_theme("light")
        self.assert_theme("light", other)
        other.evaluate("ProkopeTheme.setPreference('dark')")
        self.assert_theme("dark")
        self.assertEqual(self.state(), before)
        self.assertEqual(self.page.evaluate("localStorage.getItem('keikoroku.v1')"), "previous ledger stays")
        self.page.locator("#open-settings").click()
        expect(self.page.locator("#theme-preference")).to_have_value("dark")
        other.close()

    def test_dark_theme_and_new_assets_survive_offline_reload(self):
        self.choose_theme("dark")
        self.page.wait_for_function("navigator.serviceWorker.controller !== null")
        self.page.evaluate("navigator.serviceWorker.ready")
        self.context.set_offline(True)
        response = self.page.reload(wait_until="networkidle")
        self.assertEqual(response.status, 200)
        self.assertTrue(response.from_service_worker)
        self.assert_theme("dark")
        for asset in ["theme.js", "theme.css"]:
            result = self.page.evaluate("path => fetch(path).then(response => ({status:response.status, type:response.headers.get('content-type')}))", asset)
            self.assertEqual(result["status"], 200, asset)
            self.assertNotIn("text/html", result["type"], asset)
        self.choose_theme("light")
        self.assert_theme("light")
        self.choose_theme("dark")
        self.page.locator('[data-view="history"]').click()
        expect(self.page.locator("#calendar-panel")).to_be_visible()
        self.assert_no_horizontal_overflow()

    def test_quick_log_uses_theme_colored_svg_instead_of_emoji(self):
        icon = self.page.locator("#quick-log-form .quick-log-icon")
        expect(icon).to_be_visible()
        expect(icon.locator("use")).to_have_attribute("href", "#i-log")
        self.assertEqual(icon.evaluate("el => el.namespaceURI"), "http://www.w3.org/2000/svg")
        self.assertNotIn("✳", self.page.locator("#quick-log-form label").inner_text())
        self.assertEqual(icon.evaluate("el => getComputedStyle(el).fill"), "none")
        dark_color = icon.evaluate("el => getComputedStyle(el).color")
        self.choose_theme("light")
        light_color = icon.evaluate("el => getComputedStyle(el).color")
        self.assertNotEqual(dark_color, light_color)

    def test_key_surfaces_and_dialogs_are_readable_in_both_themes(self):
        self.seed_records()
        for theme in ["dark", "light"]:
            self.choose_theme(theme)
            self.assert_readable("#quick-log-form label")
            self.assert_readable("#routine-list .task-name")
            self.assert_readable("#routine-list .task-meta")
            self.assert_readable("#active-timers strong")
            self.assert_readable("#active-timers .action-button")
            self.assert_readable("#today-map-panel .day-map-footer")
            self.page.locator('#timeline-list .day-scroll').evaluate('el => el.scrollTop = 700')
            self.assert_readable('#timeline-list .map-event.is-event .event-title')
            self.page.locator('[data-view="history"]').click()
            self.assert_readable("#calendar-month-label", 3)
            self.assert_readable(".calendar-day.is-selected .calendar-day-number")
            self.assert_readable(".calendar-agenda-event .calendar-agenda-title")
            self.assert_readable(".calendar-agenda-event .calendar-agenda-time")
            for width in [320, 390, 1280]:
                self.page.set_viewport_size({"width": width, "height": 844})
                self.assert_no_horizontal_overflow()
            self.page.set_viewport_size({"width": 390, "height": 844})
            self.page.locator("#add-event").click()
            self.assert_readable('#event-dialog label[for="event-name"]')
            self.assert_readable("#event-name")
            self.assert_readable("#event-save")
            self.page.locator("#event-close").click()
            self.page.locator("#add-task").click()
            self.assert_readable('#task-dialog label[for="task-name"]')
            self.assert_readable("#task-name")
            self.assert_readable('#task-dialog button[type="submit"]')
            self.page.locator('#task-dialog [data-close-dialog]').click()
            self.page.locator('#history-view [data-action="log-earlier"]').click()
            self.assert_readable("#record-title")
            self.assert_readable("#record-note")
            self.assert_readable("#record-save")
            self.page.locator('#record-dialog [data-close-dialog]').click()
            self.page.locator("#open-settings").click()
            self.assert_readable("#theme-preference")
            self.assert_readable("#storage-status")
            self.page.locator('#settings-dialog [data-close-dialog]').click()
            self.page.locator('[data-view="today"]').click()


if __name__ == "__main__":
    unittest.main(verbosity=2)
