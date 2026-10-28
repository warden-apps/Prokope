"""Permanent deletion flows in disposable browser storage.

    PROKOPE_BASE_URL=http://127.0.0.1:8000/ python3 tests/browser_delete.py
"""
import unittest

from playwright.sync_api import expect
import browser_smoke as smoke


class DeleteBrowserTests(unittest.TestCase):
    setUpClass = classmethod(smoke.ProkopeBrowserTests.setUpClass.__func__)
    tearDownClass = classmethod(smoke.ProkopeBrowserTests.tearDownClass.__func__)
    setUp = smoke.ProkopeBrowserTests.setUp
    tearDown = smoke.ProkopeBrowserTests.tearDown
    state = smoke.ProkopeBrowserTests.state

    def seed(self, archived=False, running=False, event=False):
        data = self.page.evaluate("""options => {
            const M = ProkopeModel, s = M.newState(), day = M.localDate();
            const task = M.createTask(s, options.event ? {
                name:'Work schedule', kind:'event', color:'#8067a3',
                schedule:{type:'daily', startDate:'2026-10-01', time:'09:00', endTime:'17:00'}
            } : {
                name:'Reading', kind:'optional', tracking:options.running ? 'timer' : 'check', color:'#8067a3'
            });
            if (!options.event) {
                if (options.running) M.startTask(s, task.id, new Date(day + 'T11:00:00+09:00'));
                else {
                    const entry = M.completeTask(s, task.id, new Date(day + 'T08:15:00+09:00'));
                    entry.note = 'Keep these details';
                }
            }
            if (options.archived) M.archiveTask(s, task.id);
            const other = M.createTask(s, {name:'Keep this routine', kind:'routine', schedule:{type:'daily', startDate:day}});
            M.completeTask(s, other.id, new Date(day + 'T09:00:00+09:00'));
            M.logEntry(s, 'An unrelated moment', new Date(day + 'T10:00:00+09:00'));
            localStorage.setItem('prokope.daily.v1', JSON.stringify(s));
            return {state:s, id:task.id, day};
        }""", {"archived": archived, "running": running, "event": event})
        self.page.reload(wait_until="networkidle")
        return data

    def open_editor(self, task_id, archived=False, event=False):
        self.page.locator('[data-view="library"]').click()
        if archived:
            self.page.locator('#show-archived').check()
        action = 'edit-event' if event else 'edit'
        self.page.locator(f'#library-list [data-action="{action}"][data-id="{task_id}"]').click()

    def open_delete(self, event=False):
        self.page.locator('#event-delete' if event else '#task-delete').click()
        expect(self.page.locator('#delete-task-dialog')).to_be_visible()
        expect(self.page.locator('#delete-task-cancel')).to_be_focused()

    def test_cancel_then_delete_keeps_history_by_default_and_survives_reload(self):
        data = self.seed()
        self.open_editor(data['id'])
        self.open_delete()
        expect(self.page.locator('#delete-task-records')).not_to_be_checked()
        expect(self.page.locator('#delete-records-label')).to_have_text('Also delete 1 past record')
        self.page.locator('#delete-task-cancel').click()
        expect(self.page.locator('#task-delete')).to_be_focused()
        self.assertEqual(self.state(), data['state'])
        self.open_delete()
        self.page.locator('#delete-task-confirm').click()
        expect(self.page.locator('#task-dialog')).not_to_be_visible()
        after = self.state()
        self.assertNotIn(data['id'], [task['id'] for task in after['tasks']])
        expected = data['state']['entries'][0].copy()
        expected.update(taskId=None, kind='quick')
        self.assertEqual(after['entries'][0], expected)
        self.assertEqual(after['entries'][1:], data['state']['entries'][1:])
        self.assertTrue(self.page.evaluate('ProkopeModel.validateState(JSON.parse(localStorage.getItem("prokope.daily.v1")))'))
        self.page.wait_for_function('navigator.serviceWorker.controller !== null')
        self.context.set_offline(True)
        self.page.reload(wait_until='networkidle')
        self.assertEqual(self.state(), after)
        self.assertEqual(self.page.evaluate('localStorage.getItem("keikoroku.v1")'), smoke.LEGACY)

    def test_archived_activity_can_delete_only_its_own_records(self):
        data = self.seed(archived=True)
        self.open_editor(data['id'], archived=True)
        expect(self.page.locator('#task-archive')).not_to_be_visible()
        self.open_delete()
        self.page.locator('#delete-task-records').check()
        expect(self.page.locator('#delete-records-hint')).to_contain_text('permanently deleted')
        self.page.locator('#delete-task-confirm').click()
        self.assertEqual(self.state()['tasks'], data['state']['tasks'][1:])
        self.assertEqual(self.state()['entries'], data['state']['entries'][1:])

    def test_recurring_event_confirmation_names_all_dates(self):
        data = self.seed(event=True)
        self.open_editor(data['id'], event=True)
        self.open_delete(event=True)
        expect(self.page.locator('#delete-task-title')).to_have_text('Delete series?')
        expect(self.page.locator('#delete-task-message')).to_contain_text('all its past and future dates')
        expect(self.page.locator('#delete-records-choice')).not_to_be_visible()
        self.page.keyboard.press('Escape')
        self.assertEqual(self.state(), data['state'])
        self.open_delete(event=True)
        self.page.locator('#delete-task-confirm').click()
        expect(self.page.locator('#event-dialog')).not_to_be_visible()
        self.assertEqual(self.state()['tasks'], data['state']['tasks'][1:])
        self.assertEqual(self.state()['entries'], data['state']['entries'])
        self.assertEqual(self.page.evaluate("ProkopeModel.eventOccurrencesForDate(JSON.parse(localStorage.getItem('prokope.daily.v1')), '2026-10-01').length"), 0)
        self.assertEqual(self.page.evaluate("ProkopeModel.eventOccurrencesForDate(JSON.parse(localStorage.getItem('prokope.daily.v1')), '2026-11-01').length"), 0)

    def test_running_timer_must_finish_before_activity_deletion(self):
        data = self.seed(running=True)
        self.open_editor(data['id'])
        self.open_delete()
        expect(self.page.locator('#delete-task-confirm')).to_be_disabled()
        expect(self.page.locator('#delete-task-error')).to_contain_text('running timer')
        self.assertEqual(self.state(), data['state'])
        self.page.locator('#delete-task-cancel').click()
        self.page.locator('#task-dialog [data-close-dialog]').click()
        self.page.locator('#active-timers [data-action="finish"]').click()
        self.open_editor(data['id'])
        self.open_delete()
        expect(self.page.locator('#delete-task-confirm')).to_be_enabled()
        self.page.locator('#delete-task-confirm').click()
        self.assertIsNotNone(self.state()['entries'][0]['endAt'])
        self.assertIsNone(self.state()['entries'][0]['taskId'])

    def test_records_added_during_confirmation_are_not_silently_deleted(self):
        data = self.seed()
        self.open_editor(data['id'])
        self.open_delete()
        self.page.locator('#delete-task-records').check()
        latest = self.page.evaluate("""id => {
            const state = JSON.parse(localStorage.getItem('prokope.daily.v1'));
            ProkopeModel.completeTask(state, id);
            localStorage.setItem('prokope.daily.v1', JSON.stringify(state));
            return state;
        }""", data['id'])
        self.page.locator('#delete-task-confirm').click()
        expect(self.page.locator('#delete-task-error')).to_contain_text('records changed')
        expect(self.page.locator('#delete-task-confirm')).to_be_disabled()
        self.assertEqual(self.state(), latest)

    def test_stale_event_editor_cannot_delete_a_changed_series(self):
        data = self.seed(event=True)
        self.open_editor(data['id'], event=True)
        latest = self.page.evaluate("""id => {
            const state = JSON.parse(localStorage.getItem('prokope.daily.v1'));
            ProkopeModel.updateTask(state, id, {name:'Renamed in another window'});
            localStorage.setItem('prokope.daily.v1', JSON.stringify(state));
            dispatchEvent(new StorageEvent('storage', {key:'prokope.daily.v1'}));
            return state;
        }""", data['id'])
        self.open_delete(event=True)
        expect(self.page.locator('#delete-task-confirm')).to_be_disabled()
        expect(self.page.locator('#delete-task-error')).to_contain_text('changed in another window')
        self.assertEqual(self.state(), latest)


if __name__ == '__main__':
    unittest.main(verbosity=2)
