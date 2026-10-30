import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Load .env from the project root (no external package needed).
def _load_env(path):
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, _, value = line.partition('=')
                os.environ.setdefault(key.strip(), value.strip())
    except FileNotFoundError:
        pass

_load_env(BASE_DIR / '.env')

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'dev-only-change-me')
GROQ_API_KEY = os.environ.get('GROQ_API_KEY', '')
DEBUG = os.environ.get('DJANGO_DEBUG', '1') == '1'
ALLOWED_HOSTS = ['localhost', '127.0.0.1']

INSTALLED_APPS = [
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'hub',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'projecthub.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'projecthub.wsgi.application'

# SQLite locally by default; set DJANGO_DB_URL or the DB_* variables below
# to switch to an online database such as Supabase (PostgreSQL).
DATABASE_URL = os.environ.get('DJANGO_DB_URL')

if DATABASE_URL and DATABASE_URL.startswith(('postgres://', 'postgresql://')):
    import urllib.parse as urlparse

    u = urlparse.urlparse(DATABASE_URL)
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': u.path.lstrip('/'),
            'USER': u.username,
            'PASSWORD': urlparse.unquote(u.password or ''),
            'HOST': u.hostname,
            'PORT': u.port or 5432,
            **({"OPTIONS": {'sslmode': 'require'}} if 'sslmode=true' in DATABASE_URL.lower() else {}),
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Amman'
USE_TZ = True

STATIC_URL = 'static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

LOGIN_URL = 'login'
LOGIN_REDIRECT_URL = 'home'
