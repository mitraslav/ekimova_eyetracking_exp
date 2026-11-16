import json, random
from django.http import JsonResponse, HttpResponseBadRequest
from django.shortcuts import render, redirect
from django.views.decorators.http import require_POST
from .models import TrialResult

FIELDS=[('name','Имя'),('email','E-mail'),('phone','Телефон'),('password','Пароль')]
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
ERROR_MESSAGES={
    'name':'Проверьте поле «Имя».',
    'email':'Введите корректный адрес электронной почты.',
    'phone':'Введите корректный номер телефона.',
    'password':'Пароль должен содержать не менее 8 символов.',
}
VALUES={'name':'Анна','email':'anna@example.com','phone':'+7 999 123-45-67','password':'12345'}

def start(request):
    if request.method=='POST':
        pid=request.POST.get('participant_id','').strip() or 'anonymous'
        trials=BASE_TRIALS.copy(); random.shuffle(trials)
        request.session['participant_id']=pid
        request.session['trials']=trials
        return redirect('experiment:trial',trial_number=1)
    return render(request,'experiment/start.html')

def trial(request,trial_number):
    trials=request.session.get('trials'); pid=request.session.get('participant_id')
    if not trials or not pid: return redirect('experiment:start')
    if trial_number<1 or trial_number>len(trials): return redirect('experiment:finish')
    t = trials[trial_number - 1]

    target_field = t['target_field']
    target_position = t['target_position']

    # Отделяем проблемное поле от остальных
    target_item = next(item for item in FIELDS if item[0] == target_field)
    other_items = [item for item in FIELDS if item[0] != target_field]

    # Чтобы остальные поля не всегда стояли одинаково
    random.shuffle(other_items)

    # Помещаем проблемное поле строго сверху или снизу
    if target_position == 'top':
        ordered_fields = [target_item] + other_items
    else:
        ordered_fields = other_items + [target_item]

    rows = [
        {
            'name': n,
            'label': label,
            'value': VALUES[n],
            'is_target': n == target_field
        }
        for n, label in ordered_fields
    ]
    return render(request, 'experiment/trial.html', {
        'trial_number': trial_number,
        'total_trials': len(trials),
        'condition': t['condition'],
        'target_field': t['target_field'],
        'target_position': t['target_position'],
        'error_message': ERROR_MESSAGES[t['target_field']],
        'fields': rows,
    })

@require_POST
def save_result(request):
    try: payload=json.loads(request.body.decode('utf-8'))
    except json.JSONDecodeError: return HttpResponseBadRequest('Invalid JSON')
    pid=request.session.get('participant_id'); trials=request.session.get('trials')
    if not pid or not trials: return JsonResponse({'ok':False},status=400)
    n=int(payload['trial_number'])
    if n<1 or n>len(trials): return JsonResponse({'ok':False},status=400)
    t=trials[n-1]
    TrialResult.objects.update_or_create(
        participant_id=pid,trial_number=n,
        defaults={
            'condition': t['condition'],
            'target_field': t['target_field'],
            'target_position': t['target_position'],
            'response_time_ms': payload.get('response_time_ms'),
            'clicked_correct_field': bool(payload.get('clicked_correct_field'))
        }
    )
    return JsonResponse({'ok':True})

def finish(request): return render(request,'experiment/finish.html')
