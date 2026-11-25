from django.db import models


class TrialResult(models.Model):
    participant_id = models.CharField(max_length=100)
    trial_number = models.PositiveIntegerField()

    condition = models.CharField(max_length=20)
    target_field = models.CharField(max_length=50)

    target_position = models.CharField(
        max_length=20,
        choices=[
            ('top', 'Top'),
            ('bottom', 'Bottom'),
        ]
    )

    response_time_ms = models.PositiveIntegerField(
        null=True,
        blank=True
    )

    time_to_target_aoi_ms = models.PositiveIntegerField(
        null=True,
        blank=True
    )

    clicked_correct_field = models.BooleanField(
        default=False
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    class Meta:
        ordering = [
            'participant_id',
            'trial_number'
        ]

        constraints = [
            models.UniqueConstraint(
                fields=[
                    'participant_id',
                    'trial_number'
                ],
                name='unique_participant_trial'
            )
        ]

    def __str__(self):
        return (
            f'{self.participant_id} / '
            f'trial {self.trial_number}'
        )