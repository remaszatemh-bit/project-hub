from django.contrib.auth.models import User
from django.db import models


class Project(models.Model):
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='projects')
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return self.name


class Task(models.Model):
    STATUS = [('todo', 'To Do'), ('progress', 'In Progress'), ('review', 'Review'), ('done', 'Done')]
    PRIORITY = [('High', 'High'), ('Medium', 'Medium'), ('Low', 'Low')]
    TAGS = [('Design', 'Design'), ('Backend', 'Backend'), ('Bug', 'Bug'), ('Frontend', 'Frontend')]

    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tasks')
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.SET_NULL, related_name='tasks')
    title = models.CharField(max_length=200)
    status = models.CharField(max_length=12, choices=STATUS, default='todo')
    priority = models.CharField(max_length=6, choices=PRIORITY, default='Medium')
    tag = models.CharField(max_length=10, choices=TAGS, default='Frontend')
    due_date = models.DateField(null=True, blank=True)
    time_spent = models.PositiveIntegerField(default=0, help_text='Total seconds tracked')
    completed_at = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return self.title


class Subtask(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='subtasks')
    title = models.CharField(max_length=200)
    done = models.BooleanField(default=False)

    class Meta:
        ordering = ['id']


class Preference(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='preference')
    theme = models.CharField(max_length=5, default='dark')
