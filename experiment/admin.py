from django.contrib import admin
from .models import TrialResult


@admin.register(TrialResult)
class TrialResultAdmin(admin.ModelAdmin):

    list_display = (
        'participant_id',
        'trial_number',
        'condition',
        'target_field',
        'target_position',
        'response_time_ms',
        'time_to_target_aoi_ms',
        'clicked_correct_field',
        'created_at',
    )

    list_filter = (
        'participant_id',
        'condition',
        'target_field',
        'target_position',
        'clicked_correct_field',
    )

    search_fields = (
        'participant_id',
    )

    ordering = (
        'participant_id',
        'trial_number',
    )

    list_per_page = 100