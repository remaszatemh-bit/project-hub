"""Groq (Llama) helpers for the AI assistant features.

All calls are defensive: on any failure the caller gets None and the
API view degrades gracefully instead of breaking the page.
"""
import json

import requests
from django.conf import settings

GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
MODEL = 'openai/gpt-oss-20b'
TIMEOUT = 20


def _chat(messages, temperature=0.4, max_tokens=800):
    """Low-level Groq chat call. Returns the message content or None."""
    key = settings.GROQ_API_KEY
    if not key:
        return None
    try:
        r = requests.post(
            GROQ_URL,
            headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
            json={
                'model': MODEL,
                'messages': messages,
                'temperature': temperature,
                'max_tokens': max_tokens,
                # gpt-oss models emit hidden reasoning tokens; a strict JSON
                # format occasionally fails validation on them, and reasoning
                # output breaks json mode entirely, so keep it lenient here.
                **({'response_format': {'type': 'json_object'}}
                   if not MODEL.startswith('openai/') else {}),
            },
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        return r.json()['choices'][0]['message']['content']
    except (requests.RequestException, KeyError, ValueError):
        return None


def _parse(content):
    """Groq returns a JSON object as a string; be tolerant of fences."""
    if not content:
        return None
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        start, end = content.find('{'), content.rfind('}') + 1
        if start == -1 or end == 0:
            return None
        try:
            return json.loads(content[start:end])
        except json.JSONDecodeError:
            return None


def _safe_title(text, fallback):
    text = (text or '').strip()
    return text[:200] if text else fallback


# ---------- 1) Task sub-division ----------

def subdivide_task(title, description='', max_subtasks=5):
    """Break a big task into 3-5 small, concrete subtasks."""
    content = _chat([
        {'role': 'system', 'content':
            'You are a project planning assistant. Break the given task into '
            '3 to 5 small, concrete, actionable subtasks. Answer ONLY with JSON: '
            '{"subtasks": ["...", "..."]}'},
        {'role': 'user', 'content': f'Task: {title}\nDetails: {description or "none"}'},
    ], max_tokens=400)
    data = _parse(content)
    subs = data.get('subtasks') if isinstance(data, dict) else None
    if not isinstance(subs, list):
        return None
    subs = [_safe_title(s, '') for s in subs if isinstance(s, str)]
    subs = [s for s in subs if s][:max_subtasks]
    return subs or None


# ---------- 2) Pomodoro estimation ----------

def estimate_pomodoros(title, description=''):
    """Suggest a number of 25-minute Pomodoro sessions."""
    content = _chat([
        {'role': 'system', 'content':
            'You estimate how many 25-minute Pomodoro sessions a task needs. '
            'Answer ONLY with JSON: {"sessions": <integer between 1 and 16>, '
            '"reason": "<max 15 words>"}. A session equals 25 focused minutes. '
            'Skip any reasoning; output the JSON directly.'},
        {'role': 'user', 'content': f'Task: {title}\nDetails: {description or "none"}'},
    ], max_tokens=600)
    data = _parse(content)
    if not isinstance(data, dict):
        return None
    try:
        sessions = int(data.get('sessions'))
    except (TypeError, ValueError):
        return None
    sessions = max(1, min(sessions, 16))
    return {'sessions': sessions, 'reason': _safe_title(data.get('reason'), '')}


# ---------- 3) Smart description enhancer ----------

def enhance_description(title):
    """Rewrite a bare task title into a clear description with bullet points."""
    content = _chat([
        {'role': 'system', 'content':
            'You turn short task titles into clear, practical descriptions. '
            'Answer ONLY with JSON: {"title": "<improved concise title, max 12 words>", '
            '"description": "<2-4 sentences>", '
            '"bullets": ["...", "..."] with 2-4 short points}'},
        {'role': 'user', 'content': f'Task title: {title}'},
    ], max_tokens=350)
    data = _parse(content)
    if not isinstance(data, dict):
        return None
    bullets = data.get('bullets')
    if not isinstance(bullets, list):
        bullets = []
    bullets = [_safe_title(b, '') for b in bullets if isinstance(b, str)][:4]
    description = _safe_title(data.get('description'), '')
    if not description and not bullets:
        return None
    return {
        'title': _safe_title(data.get('title'), title),
        'description': description,
        'bullets': bullets,
    }
