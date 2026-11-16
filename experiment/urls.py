from django.urls import path
from . import views
app_name='experiment'
urlpatterns=[
    path('',views.start,name='start'),
    path('trial/<int:trial_number>/',views.trial,name='trial'),
    path('save/',views.save_result,name='save_result'),
    path('finish/',views.finish,name='finish'),
]
