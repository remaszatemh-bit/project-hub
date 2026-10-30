from datetime import date

from django.contrib.auth.models import User
from django.test import Client, TestCase

from .models import Preference, Project, Subtask, Task


def new_user(username, password='pass12345'):
    return User.objects.create_user(username=username, password=password)


class AuthPagesTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_register_creates_user_and_logs_in(self):
        r = self.client.post('/register/', {
            'username': 'alice',
            'password1': 'strong-pass-123',
            'password2': 'strong-pass-123',
        })
        self.assertRedirects(r, '/')
        self.assertTrue(User.objects.filter(username='alice').exists())
        self.assertTrue(self.client.session.get('_auth_user_id'))

    def test_register_invalid_password_shows_errors(self):
        r = self.client.post('/register/', {
            'username': 'bob',
            'password1': 'strong-pass-123',
            'password2': 'different-pass-456',
        })
        self.assertEqual(r.status_code, 200)
        self.assertFalse(User.objects.filter(username='bob').exists())

    def test_login_and_logout(self):
        new_user('carol', 'strong-pass-123')
        r = self.client.post('/login/', {
            'username': 'carol',
            'password': 'strong-pass-123',
        })
        self.assertRedirects(r, '/')
        r = self.client.post('/logout/')
        self.assertRedirects(r, '/login/')
        self.assertFalse(self.client.session.get('_auth_user_id', False))

    def test_login_wrong_password(self):
        new_user('dave', 'strong-pass-123')
        r = self.client.post('/login/', {'username': 'dave', 'password': 'nope'})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(self.client.session.get('_auth_user_id', False))

    def test_visitor_sees_landing_user_sees_app(self):
        self.assertEqual(self.client.get('/').status_code, 200)
        new_user('erin', 'strong-pass-123')
        self.client.login(username='erin', password='strong-pass-123')
        self.assertEqual(self.client.get('/').status_code, 200)
        self.assertTrue(Preference.objects.filter(user__username='erin').exists())


class TaskCRUDTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = new_user('frank', 'strong-pass-123')
        self.client.login(username='frank', password='strong-pass-123')

    def test_create_task(self):
        r = self.client.post('/api/tasks/', {'title': 'Write report', 'priority': 'High'},
                             content_type='application/json')
        self.assertEqual(r.status_code, 201)
        t = Task.objects.get(owner=self.user)
        self.assertEqual(t.title, 'Write report')
        self.assertEqual(t.status, 'todo')

    def test_create_task_invalid_status(self):
        r = self.client.post('/api/tasks/', {'title': 'x', 'status': 'zzz'},
                             content_type='application/json')
        self.assertEqual(r.status_code, 400)
        self.assertFalse(Task.objects.filter(owner=self.user).exists())

    def test_create_task_bad_json(self):
        r = self.client.post('/api/tasks/', '{nope', content_type='application/json')
        self.assertEqual(r.status_code, 400)

    def test_list_only_own_tasks(self):
        Task.objects.create(owner=self.user, title='mine')
        other = new_user('gina', 'strong-pass-123')
        Task.objects.create(owner=other, title='theirs')
        r = self.client.get('/api/tasks/')
        self.assertEqual(r.status_code, 200)
        titles = [t['title'] for t in r.json()['tasks']]
        self.assertEqual(titles, ['mine'])

    def test_update_task(self):
        t = Task.objects.create(owner=self.user, title='draft')
        r = self.client.patch(f'/api/tasks/{t.id}/', {'status': 'done'},
                              content_type='application/json')
        self.assertEqual(r.status_code, 200)
        t.refresh_from_db()
        self.assertEqual(t.status, 'done')
        self.assertEqual(t.completed_at, date.today())

    def test_unsetting_status_clears_completed_at(self):
        t = Task.objects.create(owner=self.user, title='x', status='done', completed_at=date.today())
        self.client.patch(f'/api/tasks/{t.id}/', {'status': 'todo'},
                          content_type='application/json')
        t.refresh_from_db()
        self.assertIsNone(t.completed_at)

    def test_delete_task(self):
        t = Task.objects.create(owner=self.user, title='doomed')
        r = self.client.delete(f'/api/tasks/{t.id}/')
        self.assertEqual(r.status_code, 200)
        self.assertFalse(Task.objects.filter(pk=t.id).exists())

    def test_get_missing_task_404(self):
        r = self.client.get('/api/tasks/99999/')
        self.assertEqual(r.status_code, 404)

    def test_add_time(self):
        t = Task.objects.create(owner=self.user, title='timer')
        r = self.client.post(f'/api/tasks/{t.id}/time/', {'seconds': 90},
                             content_type='application/json')
        self.assertEqual(r.status_code, 200)
        t.refresh_from_db()
        self.assertEqual(t.time_spent, 90)

    def test_add_time_rejects_non_number(self):
        t = Task.objects.create(owner=self.user, title='timer')
        r = self.client.post(f'/api/tasks/{t.id}/time/', {'seconds': 'abc'},
                             content_type='application/json')
        self.assertEqual(r.status_code, 400)


class SubtaskTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = new_user('hank', 'strong-pass-123')
        self.client.login(username='hank', password='strong-pass-123')
        self.task = Task.objects.create(owner=self.user, title='parent')

    def test_add_and_toggle_subtask(self):
        r = self.client.post(f'/api/tasks/{self.task.id}/subtasks/', {'title': 'step 1'},
                             content_type='application/json')
        self.assertEqual(r.status_code, 201)
        sid = r.json()['id']
        r = self.client.patch(f'/api/subtasks/{sid}/', {'done': True},
                              content_type='application/json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(Subtask.objects.get(pk=sid).done)
        r = self.client.delete(f'/api/subtasks/{sid}/')
        self.assertEqual(r.status_code, 200)
        self.assertFalse(Subtask.objects.filter(pk=sid).exists())

    def test_add_subtask_empty_title(self):
        r = self.client.post(f'/api/tasks/{self.task.id}/subtasks/', {'title': '   '},
                             content_type='application/json')
        self.assertEqual(r.status_code, 400)


class OwnershipIsolationTests(TestCase):
    """One user must never read, change, or delete another user's data."""

    def setUp(self):
        self.owner = new_user('owner', 'strong-pass-123')
        self.client = Client()
        self.client.login(username='owner', password='strong-pass-123')
        self.project = Project.objects.create(owner=self.owner, name='Owner Project')
        self.task = Task.objects.create(owner=self.owner, title='Owner Task', project=self.project)
        self.sub = Subtask.objects.create(task=self.task, title='Owner Subtask')
        self.intruder = new_user('intruder', 'strong-pass-123')

    def intruder_client(self):
        c = Client()
        c.login(username='intruder', password='strong-pass-123')
        return c

    def test_cannot_read_other_users_task(self):
        r = self.intruder_client().get(f'/api/tasks/{self.task.id}/')
        self.assertEqual(r.status_code, 404)

    def test_cannot_update_other_users_task(self):
        r = self.intruder_client().patch(f'/api/tasks/{self.task.id}/', {'title': 'hacked'},
                                         content_type='application/json')
        self.assertEqual(r.status_code, 404)
        self.task.refresh_from_db()
        self.assertEqual(self.task.title, 'Owner Task')

    def test_cannot_delete_other_users_task(self):
        r = self.intruder_client().delete(f'/api/tasks/{self.task.id}/')
        self.assertEqual(r.status_code, 404)
        self.assertTrue(Task.objects.filter(pk=self.task.id).exists())

    def test_cannot_add_subtask_or_time_to_other_users_task(self):
        c = self.intruder_client()
        r = c.post(f'/api/tasks/{self.task.id}/subtasks/', {'title': 'x'},
                   content_type='application/json')
        self.assertEqual(r.status_code, 404)
        r = c.post(f'/api/tasks/{self.task.id}/time/', {'seconds': 60},
                   content_type='application/json')
        self.assertEqual(r.status_code, 404)
        self.assertEqual(Subtask.objects.count(), 1)
        self.task.refresh_from_db()
        self.assertEqual(self.task.time_spent, 0)

    def test_cannot_touch_other_users_subtask(self):
        r = self.intruder_client().patch(f'/api/subtasks/{self.sub.id}/', {'done': True},
                                         content_type='application/json')
        self.assertEqual(r.status_code, 404)
        self.sub.refresh_from_db()
        self.assertFalse(self.sub.done)
        r = self.intruder_client().delete(f'/api/subtasks/{self.sub.id}/')
        self.assertEqual(r.status_code, 404)
        self.assertTrue(Subtask.objects.filter(pk=self.sub.id).exists())

    def test_cannot_assign_other_users_project(self):
        other_project = Project.objects.create(owner=self.intruder, name='Intruder Project')
        r = self.client.patch(f'/api/tasks/{self.task.id}/',
                              {'project_id': other_project.id},
                              content_type='application/json')
        self.assertEqual(r.status_code, 400)  # unowned project is rejected
        self.task.refresh_from_db()
        self.assertEqual(self.task.project_id, self.project.id)

    def test_clear_project_still_works(self):
        r = self.client.patch(f'/api/tasks/{self.task.id}/', {'project_id': None},
                              content_type='application/json')
        self.assertEqual(r.status_code, 200)
        self.task.refresh_from_db()
        self.assertIsNone(self.task.project)

    def test_projects_and_analytics_scoped_to_owner(self):
        self.intruder_client().post('/api/projects/', {'name': 'Intruder Proj'},
                                    content_type='application/json')
        r = self.client.get('/api/projects/')
        self.assertEqual([p['name'] for p in r.json()['projects']], ['Owner Project'])
        r = self.client.get('/api/analytics/')
        self.assertEqual(r.json()['total'], 1)
        r = self.intruder_client().get('/api/analytics/')
        self.assertEqual(r.json()['total'], 0)


class APIAuthRequiredTests(TestCase):
    """Visitors (unauthenticated) get 401 JSON, not an HTML redirect."""

    def setUp(self):
        self.client = Client()
        self.user = new_user('iris', 'strong-pass-123')
        self.task = Task.objects.create(owner=self.user, title='secret')
        self.sub = Subtask.objects.create(task=self.task, title='secret sub')

    def test_all_endpoints_return_401_for_anonymous(self):
        urls = [
            ('get', '/api/tasks/', None),
            ('post', '/api/tasks/', {'title': 'x'}),
            ('get', f'/api/tasks/{self.task.id}/', None),
            ('patch', f'/api/tasks/{self.task.id}/', {'title': 'x'}),
            ('delete', f'/api/tasks/{self.task.id}/', None),
            ('post', f'/api/tasks/{self.task.id}/subtasks/', {'title': 'x'}),
            ('post', f'/api/tasks/{self.task.id}/time/', {'seconds': 1}),
            ('patch', f'/api/subtasks/{self.sub.id}/', {'done': True}),
            ('delete', f'/api/subtasks/{self.sub.id}/', None),
            ('get', '/api/projects/', None),
            ('post', '/api/projects/', {'name': 'x'}),
            ('get', '/api/analytics/', None),
            ('get', '/api/preferences/', None),
            ('put', '/api/preferences/', {'theme': 'light'}),
        ]
        for method, url, payload in urls:
            r = getattr(self.client, method)(url, payload, content_type='application/json')
            with self.subTest(f'{method.upper()} {url}'):
                self.assertEqual(r.status_code, 401, f'{method.upper()} {url}')
                self.assertEqual(r.json()['error'], 'Authentication required')

    def test_anonymous_does_not_create_or_modify_data(self):
        self.client.post('/api/tasks/', {'title': 'ghost task'},
                         content_type='application/json')
        self.assertFalse(Task.objects.filter(title='ghost task').exists())

    def test_wrong_method_returns_405(self):
        self.client.login(username='iris', password='strong-pass-123')
        r = self.client.get('/api/analytics/')
        self.assertEqual(r.status_code, 200)
        self.client.logout()
        self.client.login(username='iris', password='strong-pass-123')
        r = self.client.get('/api/preferences/')  # allowed
        self.assertEqual(r.status_code, 200)
        # /api/tasks/<id>/time/ only accepts POST
        r = self.client.get(f'/api/tasks/{self.task.id}/time/')
        self.assertEqual(r.status_code, 405)


class PreferenceAndProjectTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = new_user('jack', 'strong-pass-123')
        self.client.login(username='jack', password='strong-pass-123')

    def test_preference_theme_roundtrip(self):
        r = self.client.put('/api/preferences/', {'theme': 'light'},
                            content_type='application/json')
        self.assertEqual(r.json()['theme'], 'light')
        self.assertEqual(Preference.objects.get(user=self.user).theme, 'light')
        r = self.client.put('/api/preferences/', {'theme': 'bogus'},
                            content_type='application/json')
        self.assertEqual(r.json()['theme'], 'light')  # invalid value ignored

    def test_project_create_and_validation(self):
        r = self.client.post('/api/projects/', {'name': 'Website'},
                             content_type='application/json')
        self.assertEqual(r.status_code, 201)
        r = self.client.post('/api/projects/', {'name': '  '},
                             content_type='application/json')
        self.assertEqual(r.status_code, 400)
