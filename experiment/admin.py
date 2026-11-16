from django.contrib import admin
from .models import TrialResult
@admin.register(TrialResult)
class TrialResultAdmin(admin.ModelAdmin):
    list_display=('participant_id','trial_number','condition','target_field','response_time_ms','clicked_correct_field','created_at')
    list_filter=('condition','target_field','clicked_correct_field')
    search_fields=('participant_id',)
