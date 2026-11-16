from django.db import migrations, models

class Migration(migrations.Migration):
    initial=True
    dependencies=[]
    operations=[
        migrations.CreateModel(
            name='TrialResult',
            fields=[
                ('id',models.BigAutoField(auto_created=True,primary_key=True,serialize=False,verbose_name='ID')),
                ('participant_id',models.CharField(max_length=100)),
                ('trial_number',models.PositiveIntegerField()),
                ('condition',models.CharField(max_length=20)),
                ('target_field',models.CharField(max_length=50)),
                ('response_time_ms',models.PositiveIntegerField(blank=True,null=True)),
                ('clicked_correct_field',models.BooleanField(default=False)),
                ('created_at',models.DateTimeField(auto_now_add=True)),
            ],
            options={'ordering':['participant_id','trial_number']},
        ),
        migrations.AddConstraint(
            model_name='trialresult',
            constraint=models.UniqueConstraint(fields=('participant_id','trial_number'),name='unique_participant_trial'),
        ),
    ]
