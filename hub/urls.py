from django.urls import path

from . import views

urlpatterns = [
    path('', views.index, name='home'),
    path('login/', views.login_view, name='login'),
    path('register/', views.register_view, name='register'),
    path('logout/', views.logout_view, name='logout'),

    path('api/tasks/', views.tasks, name='api_tasks'),
    path('api/ai/subdivide/', views.ai_subdivide, name='ai_subdivide'),
    path('api/ai/pomodoros/', views.ai_pomodoros, name='ai_pomodoros'),
    path('api/ai/enhance/', views.ai_enhance, name='ai_enhance'),
    path('api/tasks/<int:pk>/', views.task_detail, name='api_task'),
    path('api/tasks/<int:pk>/subtasks/', views.add_subtask, name='api_add_subtask'),
    path('api/tasks/<int:pk>/time/', views.add_time, name='api_add_time'),
    path('api/subtasks/<int:pk>/', views.subtask_detail, name='api_subtask'),
    path('api/projects/', views.projects, name='api_projects'),
    path('api/analytics/', views.analytics, name='api_analytics'),
    path('api/preferences/', views.preferences, name='api_preferences'),
]
