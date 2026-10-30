import json
from datetime import date, timedelta
from functools import wraps

from django.contrib.auth import login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.core.exceptions import ValidationError
from django.db.models import Sum
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_POST, require_http_methods

from .models import Preference, Project, Subtask, Task
from . import services


# ---------- helpers ----------

def api_login(view):
    """Return JSON 401 instead of an HTML redirect for API calls."""
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'error': 'Authentication required'}, status=401)
        return view(request, *args, **kwargs)
    return wrapper


def body(request):
    try:
        return json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return None


def bad_json():
    return JsonResponse({'error': 'Invalid JSON body'}, status=400)


def not_found():
    return JsonResponse({'error': 'Not found'}, status=404)


def parse_date(value):
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def get_task(user, pk):
    """Ownership check: users can only ever reach their own tasks."""
    return Task.objects.filter(owner=user, pk=pk).first()


def task_json(t):
    return {
        'id': t.id,
        'title': t.title,
        'status': t.status,
        'priority': t.priority,
        'tag': t.tag,
        'due_date': t.due_date.isoformat() if t.due_date else None,
        'time_spent': t.time_spent,
        'completed_at': t.completed_at.isoformat() if t.completed_at else None,
        'project': {'id': t.project_id, 'name': t.project.name} if t.project_id else None,
        'subtasks': [{'id': s.id, 'title': s.title, 'done': s.done} for s in t.subtasks.all()],
    }


def apply_fields(task, data):
    """Copy allowed fields onto task, keep completed_at in sync, validate."""
    for f in ('title', 'status', 'priority', 'tag'):
        if f in data:
            setattr(task, f, data[f] or '')
    if 'due_date' in data:
        task.due_date = parse_date(data['due_date'])
    if 'project_id' in data:
        try:
            pid = int(data['project_id']) if data['project_id'] else None
        except (TypeError, ValueError):
            pid = None
        if pid is None:
            task.project = None
        else:
            # Only the task owner's own projects are assignable.
            project = Project.objects.filter(owner=task.owner, pk=pid).first()
            if not project:
                return JsonResponse({'error': {'project_id': ['Invalid project']}}, status=400)
            task.project = project
    if task.status == 'done':
        task.completed_at = task.completed_at or date.today()
    else:
        task.completed_at = None
    try:
        task.full_clean()
    except ValidationError as e:
        return JsonResponse({'error': e.message_dict}, status=400)
    return None


# ---------- pages ----------

def index(request):
    """Visitors see the landing page; logged-in users see the app."""
    if not request.user.is_authenticated:
        return render(request, 'hub/landing.html')
    pref, _ = Preference.objects.get_or_create(user=request.user)
    return render(request, 'hub/index.html', {'theme': pref.theme})


def login_view(request):
    if request.user.is_authenticated:
        return redirect('home')
    form = AuthenticationForm(request, data=request.POST or None)
    if request.method == 'POST' and form.is_valid():
        login(request, form.get_user())
        return redirect('home')
    return render(request, 'hub/auth.html', {'form': form, 'mode': 'login'})


def register_view(request):
    if request.user.is_authenticated:
        return redirect('home')
    form = UserCreationForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        user = form.save()
        login(request, user)
        return redirect('home')
    return render(request, 'hub/auth.html', {'form': form, 'mode': 'register'})


@require_POST
def logout_view(request):
    logout(request)
    return redirect('login')


# ---------- API: tasks ----------

@api_login
@require_http_methods(['GET', 'POST'])
def tasks(request):
    if request.method == 'GET':
        qs = Task.objects.filter(owner=request.user).select_related('project').prefetch_related('subtasks')
        return JsonResponse({'tasks': [task_json(t) for t in qs]})
    data = body(request)
    if data is None:
        return bad_json()
    task = Task(owner=request.user)
    err = apply_fields(task, data)
    if err:
        return err
    task.save()
    return JsonResponse(task_json(task), status=201)


@api_login
@require_http_methods(['GET', 'PUT', 'PATCH', 'DELETE'])
def task_detail(request, pk):
    task = get_task(request.user, pk)
    if not task:
        return not_found()
    if request.method == 'GET':
        return JsonResponse(task_json(task))
    if request.method == 'DELETE':
        task.delete()
        return JsonResponse({'ok': True})
    data = body(request)
    if data is None:
        return bad_json()
    err = apply_fields(task, data)
    if err:
        return err
    task.save()
    return JsonResponse(task_json(task))


@api_login
@require_http_methods(['POST'])
def add_time(request, pk):
    task = get_task(request.user, pk)
    if not task:
        return not_found()
    try:
        seconds = int((body(request) or {}).get('seconds', 0))
    except (TypeError, ValueError):
        return JsonResponse({'error': 'seconds must be a number'}, status=400)
    task.time_spent += max(0, min(seconds, 3600))
    task.save(update_fields=['time_spent'])
    return JsonResponse({'time_spent': task.time_spent})


# ---------- API: subtasks ----------

@api_login
@require_http_methods(['POST'])
def add_subtask(request, pk):
    task = get_task(request.user, pk)
    if not task:
        return not_found()
    title = ((body(request) or {}).get('title') or '').strip()
    if not title:
        return JsonResponse({'error': {'title': ['Title is required']}}, status=400)
    sub = Subtask.objects.create(task=task, title=title[:200])
    return JsonResponse({'id': sub.id, 'title': sub.title, 'done': sub.done}, status=201)


@api_login
@require_http_methods(['PATCH', 'DELETE'])
def subtask_detail(request, pk):
    sub = Subtask.objects.filter(pk=pk, task__owner=request.user).first()
    if not sub:
        return not_found()
    if request.method == 'DELETE':
        sub.delete()
        return JsonResponse({'ok': True})
    data = body(request) or {}
    if 'title' in data:
        sub.title = (data['title'] or '').strip()[:200] or sub.title
    if 'done' in data:
        sub.done = bool(data['done'])
    sub.save()
    return JsonResponse({'id': sub.id, 'title': sub.title, 'done': sub.done})


# ---------- API: projects, analytics, preferences ----------

@api_login
@require_http_methods(['GET', 'POST'])
def projects(request):
    if request.method == 'GET':
        qs = Project.objects.filter(owner=request.user)
        return JsonResponse({'projects': [{'id': p.id, 'name': p.name} for p in qs]})
    name = ((body(request) or {}).get('name') or '').strip()[:100]
    if not name:
        return JsonResponse({'error': {'name': ['Name is required']}}, status=400)
    p = Project.objects.create(owner=request.user, name=name)
    return JsonResponse({'id': p.id, 'name': p.name}, status=201)


# ---------- API: AI assistant ----------

@api_login
@require_POST
def ai_subdivide(request):
    data = body(request)
    if data is None:
        return bad_json()
    title = (data.get('title') or '').strip()
    if not title:
        return JsonResponse({'error': {'title': ['Title is required']}}, status=400)
    subs = services.subdivide_task(title, data.get('description') or '')
    if subs is None:
        return JsonResponse({'error': 'AI assistant unavailable, try again later'}, status=503)
    return JsonResponse({'subtasks': subs})


@api_login
@require_POST
def ai_pomodoros(request):
    data = body(request)
    if data is None:
        return bad_json()
    title = (data.get('title') or '').strip()
    if not title:
        return JsonResponse({'error': {'title': ['Title is required']}}, status=400)
    est = services.estimate_pomodoros(title, data.get('description') or '')
    if est is None:
        return JsonResponse({'error': 'AI assistant unavailable, try again later'}, status=503)
    return JsonResponse(est)


@api_login
@require_POST
def ai_enhance(request):
    data = body(request)
    if data is None:
        return bad_json()
    title = (data.get('title') or '').strip()
    if not title:
        return JsonResponse({'error': {'title': ['Title is required']}}, status=400)
    out = services.enhance_description(title)
    if out is None:
        return JsonResponse({'error': 'AI assistant unavailable, try again later'}, status=503)
    return JsonResponse(out)


@api_login
def analytics(request):
    qs = Task.objects.filter(owner=request.user)
    total = qs.count()
    done = qs.filter(status='done').count()
    spent = qs.aggregate(s=Sum('time_spent'))['s'] or 0
    today = date.today()
    weekly = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        weekly.append({'label': d.strftime('%a'), 'done': qs.filter(completed_at=d).count()})
    return JsonResponse({
        'total': total,
        'active': total - done,
        'completion_rate': round(done / total * 100) if total else 0,
        'avg_time': round(spent / total) if total else 0,
        'by_status': {s: qs.filter(status=s).count() for s, _ in Task.STATUS},
        'by_tag': {t: qs.filter(tag=t).count() for t, _ in Task.TAGS},
        'weekly': weekly,
    })


@api_login
@require_http_methods(['GET', 'PUT'])
def preferences(request):
    pref, _ = Preference.objects.get_or_create(user=request.user)
    if request.method == 'PUT':
        theme = (body(request) or {}).get('theme')
        if theme in ('dark', 'light'):
            pref.theme = theme
            pref.save(update_fields=['theme'])
    return JsonResponse({'theme': pref.theme})
