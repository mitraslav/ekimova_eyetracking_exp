import csv

from django.contrib import admin
from django.http import HttpResponse

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

    actions = ['export_as_csv']

    @admin.action(description='Скачать результаты в CSV')
    def export_as_csv(self, request, queryset):

        response = HttpResponse(
            content_type='text/csv; charset=utf-8'
        )

        response['Content-Disposition'] = (
            'attachment; filename="eyetracking_results.csv"'
        )

        # Корректное отображение кодировки в Excel.
        response.write('\ufeff')

        writer = csv.writer(response)

        # Названия столбцов.
        writer.writerow([
            'participant_id',
            'trial_number',
            'condition',
            'target_field',
            'target_position',
            'response_time_ms',
            'time_to_target_aoi_ms',
            'clicked_correct_field',
            'created_at',
        ])

        # Записываем выбранные результаты.
        for result in queryset.order_by(
            'participant_id',
            'trial_number'
        ):

            writer.writerow([
                result.participant_id,
                result.trial_number,
                result.condition,
                result.target_field,
                result.target_position,
                result.response_time_ms,
                result.time_to_target_aoi_ms,
                int(result.clicked_correct_field),
                result.created_at.isoformat(),
            ])

        return response