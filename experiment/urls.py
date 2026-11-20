from django.urls import path
from . import views

app_name = 'experiment'

urlpatterns = [
    path('', views.start, name='start'),
    path('trial/', views.trial, name='trial'),
    path('save-result/', views.save_result, name='save_result'),
    path('finish/', views.finish, name='finish'),
]