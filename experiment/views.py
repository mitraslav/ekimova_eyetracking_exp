import json
import random

from django.conf import settings
from django.http import JsonResponse, HttpResponseBadRequest
from django.shortcuts import render, redirect
from django.views.decorators.http import require_POST

from .models import TrialResult


FIELDS = [
    ('name', 'Имя'),
    ('email', 'E-mail'),
    ('phone', 'Телефон'),
    ('password', 'Пароль'),
]


BASE_TRIALS = [
    # LOCAL + TOP
    {"condition": "local", "target_field": "name",     "target_position": "top"},
    {"condition": "local", "target_field": "email",    "target_position": "top"},
    {"condition": "local", "target_field": "phone",    "target_position": "top"},
    {"condition": "local", "target_field": "password", "target_position": "top"},
    {"condition": "local", "target_field": "name",     "target_position": "top"},
    {"condition": "local", "target_field": "email",    "target_position": "top"},

    # LOCAL + BOTTOM
    {"condition": "local", "target_field": "phone",    "target_position": "bottom"},
    {"condition": "local", "target_field": "password", "target_position": "bottom"},
    {"condition": "local", "target_field": "name",     "target_position": "bottom"},
    {"condition": "local", "target_field": "email",    "target_position": "bottom"},
    {"condition": "local", "target_field": "phone",    "target_position": "bottom"},
    {"condition": "local", "target_field": "password", "target_position": "bottom"},

    # GLOBAL + TOP
    {"condition": "global", "target_field": "name",     "target_position": "top"},
    {"condition": "global", "target_field": "email",    "target_position": "top"},
    {"condition": "global", "target_field": "phone",    "target_position": "top"},
    {"condition": "global", "target_field": "password", "target_position": "top"},
    {"condition": "global", "target_field": "name",     "target_position": "top"},
    {"condition": "global", "target_field": "email",    "target_position": "top"},

    # GLOBAL + BOTTOM
    {"condition": "global", "target_field": "phone",    "target_position": "bottom"},
    {"condition": "global", "target_field": "password", "target_position": "bottom"},
    {"condition": "global", "target_field": "name",     "target_position": "bottom"},
    {"condition": "global", "target_field": "email",    "target_position": "bottom"},
    {"condition": "global", "target_field": "phone",    "target_position": "bottom"},
    {"condition": "global", "target_field": "password", "target_position": "bottom"},
]


ERROR_MESSAGES = {
    'name': 'Проверьте поле «Имя».',
    'email': 'Введите корректный адрес электронной почты.',
    'phone': 'Введите корректный номер телефона.',
    'password': 'Пароль должен содержать не менее 8 символов.',
}


VALUES = {
    'name': 'Анна',
    'email': 'anna@example.com',
    'phone': '+7 999 123-45-67',
    'password': '12345',
}


def make_trial_payload(trials, trial_number):
    """
    Создаёт данные одной пробы для JavaScript.
    trial_number начинается с 1.
    """

    t = trials[trial_number - 1]

    target_field = t['target_field']
    target_position = t['target_position']

    target_item = next(
        item for item in FIELDS
        if item[0] == target_field
    )

    # Остальные поля оставляем в стабильном порядке.
    other_items = [
        item for item in FIELDS
        if item[0] != target_field
    ]

    if target_position == 'top':
        ordered_fields = [target_item] + other_items
    else:
        ordered_fields = other_items + [target_item]

    rows = [
        {
            'name': name,
            'label': label,
            'value': VALUES[name],
            'is_target': name == target_field,
        }
        for name, label in ordered_fields
    ]

    return {
        'trial_number': trial_number,
        'total_trials': len(trials),
        'condition': t['condition'],
        'target_field': target_field,
        'target_position': target_position,
        'error_message': ERROR_MESSAGES[target_field],
        'fields': rows,
    }


def start(request):
    if request.method == 'POST':
        participant_id = (
            request.POST.get('participant_id', '').strip()
            or 'anonymous'
        )

        trials = BASE_TRIALS.copy()
        random.shuffle(trials)

        request.session['participant_id'] = participant_id
        request.session['trials'] = trials

        # Теперь текущая проба хранится в session.
        request.session['current_trial_number'] = 1

        return redirect('experiment:trial')

    return render(
        request,
        'experiment/start.html'
    )


def trial(request):
    trials = request.session.get('trials')
    participant_id = request.session.get('participant_id')

    if not trials or not participant_id:
        return redirect('experiment:start')

    trial_number = request.session.get(
        'current_trial_number',
        1
    )

    if trial_number > len(trials):
        return redirect('experiment:finish')

    initial_trial = make_trial_payload(
        trials,
        trial_number
    )

    return render(
        request,
        'experiment/trial.html',
        {
            'participant_id': participant_id,
            'initial_trial': initial_trial,

            'chiasm_token':
                settings.CHIASM_AUTH_TOKEN,

            'chiasm_experiment_id':
                settings.CHIASM_EXPERIMENT_ID,
        }
    )


@require_POST
def save_result(request):
    try:
        payload = json.loads(
            request.body.decode('utf-8')
        )
    except json.JSONDecodeError:
        return HttpResponseBadRequest(
            'Invalid JSON'
        )

    participant_id = request.session.get(
        'participant_id'
    )

    trials = request.session.get('trials')

    if not participant_id or not trials:
        return JsonResponse(
            {'ok': False},
            status=400
        )

    trial_number = int(
        payload['trial_number']
    )

    expected_trial = request.session.get(
        'current_trial_number',
        1
    )

    # Защита от случайной повторной отправки.
    if trial_number != expected_trial:
        return JsonResponse(
            {
                'ok': False,
                'error': 'Unexpected trial number',
            },
            status=400
        )

    if (
        trial_number < 1
        or trial_number > len(trials)
    ):
        return JsonResponse(
            {'ok': False},
            status=400
        )

    t = trials[trial_number - 1]

    TrialResult.objects.update_or_create(
        participant_id=participant_id,
        trial_number=trial_number,

        defaults={
            'condition':
                t['condition'],

            'target_field':
                t['target_field'],

            'target_position':
                t['target_position'],

            'response_time_ms':
                payload.get(
                    'response_time_ms'
                ),

            'clicked_correct_field':
                bool(
                    payload.get(
                        'clicked_correct_field'
                    )
                ),
        }
    )

    next_trial_number = trial_number + 1

    request.session[
        'current_trial_number'
    ] = next_trial_number

    request.session.modified = True

    # Последняя проба.
    if next_trial_number > len(trials):
        return JsonResponse({
            'ok': True,
            'finished': True,
        })

    # Возвращаем следующую пробу прямо в JS.
    next_trial = make_trial_payload(
        trials,
        next_trial_number
    )

    return JsonResponse({
        'ok': True,
        'finished': False,
        'next_trial': next_trial,
    })


def finish(request):
    return render(
        request,
        'experiment/finish.html'
    )