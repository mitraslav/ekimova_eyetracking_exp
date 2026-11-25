(async function () {

  const config = window.EXPERIMENT;

  // ========================================
  // DOM
  // ========================================

  const calibrationScreen =
    document.getElementById('calibration-screen');

  const calibrationStatus =
    document.getElementById('calibration-status');

  const trialPage =
    document.getElementById('trial');

  const finishScreen =
    document.getElementById('finish-screen');

  const overlay =
    document.getElementById('fixation-overlay');

  const fieldsContainer =
    document.getElementById('fields-container');

  const globalError =
    document.getElementById('global-error');

  const meta =
    document.getElementById('trial-meta');

  const continueButton =
    document.getElementById('continue');


  // ========================================
  // СОСТОЯНИЕ ЭКСПЕРИМЕНТА
  // ========================================

  let currentTrial = JSON.parse(
    document
      .getElementById('initial-trial-data')
      .textContent
  );

  let errorShownAt = null;
  let saved = false;
  let gazeMeasurementActive = false;
  let timeToTargetAoiMs = null;

  // Минимальная продолжительность
  // устойчивого попадания взгляда в AOI.
  const FIXATION_MIN_MS = 100;

  let aoiEntryStartedAt = null;


  // ========================================
  // ИНИЦИАЛИЗАЦИЯ WEBGAZER
  // ========================================

  try {

    // Путь к модели распознавания лица MediaPipe.
    webgazer.params.faceMeshSolutionPath =
      "https://cdn.jsdelivr.net/npm/webgazer@3.5.3/dist/mediapipe/face_mesh";

    // Не используем калибровку предыдущих участников.
    webgazer.saveDataAcrossSessions(false);

    webgazer.applyKalmanFilter(true);

    webgazer.showPredictionPoints(false);

    webgazer.showVideo(true);

    webgazer.showFaceOverlay(true);

    webgazer.showFaceFeedbackBox(true);

    webgazer.setGazeListener(
      handleGazePrediction
    );

    await webgazer.begin();

    // Отключаем автоматическое обучение
    // на обычных кликах мыши.
    webgazer.removeMouseEventListeners();

    calibrationStatus.textContent =
      'Смотрите на каждую точку и нажмите её 3 раза.';

    setupCalibrationPoints();

  } catch (error) {

    console.error(
      'WebGazer initialization error:',
      error
    );

    // Показываем настоящую причину ошибки.
    calibrationStatus.textContent =
      'Ошибка запуска WebGazer: ' +
      (error?.message || String(error));

  }


  // ========================================
  // КАЛИБРОВКА
  // ========================================

  function setupCalibrationPoints() {

    const points = document.querySelectorAll(
      '.calibration-point'
    );

    let finishedPoints = 0;

    points.forEach(point => {

      let clickCount = 0;

      point.addEventListener('click', () => {

        const rect =
          point.getBoundingClientRect();

        const x =
          rect.left + rect.width / 2;

        const y =
          rect.top + rect.height / 2;

        // Передаём WebGazer координаты
        // калибровочной точки.
        webgazer.recordScreenPosition(
          x,
          y,
          'click'
        );

        clickCount += 1;

        // Визуально показываем прогресс.
        point.style.opacity = String(
          Math.max(
            0.25,
            1 - clickCount * 0.25
          )
        );

        if (clickCount >= 3) {

          point.classList.add('done');

          finishedPoints += 1;

          if (finishedPoints === points.length) {

            finishCalibration();

          }

        }

      });

    });

  }


  // ========================================
  // ЗАВЕРШЕНИЕ КАЛИБРОВКИ
  // ========================================

  async function finishCalibration() {

    calibrationStatus.textContent =
      'Калибровка завершена.';

    await sleep(500);

    calibrationScreen.style.display =
      'none';

    // Скрываем изображение с камеры,
    // но продолжаем отслеживать взгляд.
    webgazer.showVideo(false);

    webgazer.showFaceOverlay(false);

    webgazer.showFaceFeedbackBox(false);

    webgazer.showPredictionPoints(false);

    await startTrial(currentTrial);

  }


  // ========================================
  // ОТСЛЕЖИВАНИЕ ВЗГЛЯДА
  // ========================================

  function handleGazePrediction(
    data,
    elapsedTime
  ) {

    if (!data) {
      return;
    }

    // Измерение начинается только
    // после появления сообщения об ошибке.
    if (
      !gazeMeasurementActive
      || errorShownAt === null
      || timeToTargetAoiMs !== null
    ) {
      return;
    }

    const target = document.getElementById(
      currentTrial.target_field
    );

    if (!target) {
      return;
    }

    const rect =
      target.getBoundingClientRect();

    // Запас AOI: 8 пикселей.
    const margin = 8;

    const inside =
      data.x >= rect.left - margin
      && data.x <= rect.right + margin
      && data.y >= rect.top - margin
      && data.y <= rect.bottom + margin;

    const now = performance.now();

    if (inside) {

      // Первое попадание взгляда в AOI.
      if (aoiEntryStartedAt === null) {

        aoiEntryStartedAt = now;

        return;

      }

      // Устойчивое попадание взгляда:
      // не менее 100 мс внутри AOI.
      if (
        now - aoiEntryStartedAt
        >= FIXATION_MIN_MS
      ) {

        timeToTargetAoiMs = Math.round(
          aoiEntryStartedAt - errorShownAt
        );

        gazeMeasurementActive = false;

        console.log(
          'Target AOI fixation:',
          timeToTargetAoiMs,
          'ms'
        );

      }

    } else {

      // Если взгляд вышел из AOI раньше,
      // начинаем отсчёт заново.
      aoiEntryStartedAt = null;

    }

  }


  // ========================================
  // СОЗДАНИЕ ИНТЕРФЕЙСА ПРОБЫ
  // ========================================

  function renderTrial(trial) {

    currentTrial = trial;

    meta.textContent =
      `Проба ${trial.trial_number} ` +
      `из ${trial.total_trials}`;

    globalError.textContent =
      trial.error_message;

    globalError.classList.add('is-hidden');

    fieldsContainer.innerHTML = '';

    trial.fields.forEach(field => {

      const block =
        document.createElement('div');

      block.className = 'field-block';

      block.dataset.field = field.name;

      const label =
        document.createElement('label');

      label.htmlFor = field.name;

      label.textContent = field.label;

      const input =
        document.createElement('input');

      input.id = field.name;

      input.name = field.name;

      input.type =
        field.name === 'password'
          ? 'password'
          : 'text';

      input.value = field.value;

      block.appendChild(label);

      block.appendChild(input);

      // Локальное сообщение об ошибке.
      if (
        field.is_target
        && trial.condition === 'local'
      ) {

        const localError =
          document.createElement('div');

        localError.className =
          'error-popover ' +
          'local-popover ' +
          'is-hidden';

        localError.textContent =
          trial.error_message;

        block.appendChild(localError);

      }

      fieldsContainer.appendChild(block);

      input.addEventListener(
        'click',
        handleFieldClick
      );

    });

    // Восстанавливаем кнопку.
    continueButton.disabled = false;

    continueButton.textContent =
      'Продолжить';

    // Сбрасываем показатели предыдущей пробы.
    errorShownAt = null;

    saved = false;

    gazeMeasurementActive = false;

    timeToTargetAoiMs = null;

    aoiEntryStartedAt = null;

  }


  // ========================================
  // НАЧАЛО ПРОБЫ
  // ========================================

  async function startTrial(trial) {

    renderTrial(trial);

    trialPage.style.visibility =
      'hidden';

    overlay.classList.remove('is-hidden');

    document.body.classList.add('locked');

    // Фиксационный крест: 1 секунда.
    await sleep(1000);

    overlay.classList.add('is-hidden');

    trialPage.style.visibility =
      'visible';

    document.body.classList.remove('locked');

  }


  // ========================================
  // НАЖАТИЕ КНОПКИ «ПРОДОЛЖИТЬ»
  // ========================================

  continueButton.addEventListener(
    'click',
    () => {

      if (errorShownAt !== null) {
        return;
      }

      // Начало измерения времени реакции
      // и времени до попадания взгляда в AOI.
      errorShownAt = performance.now();

      timeToTargetAoiMs = null;

      aoiEntryStartedAt = null;

      gazeMeasurementActive = true;

      showError();

      continueButton.disabled = true;

      continueButton.textContent =
        'Найдите поле с ошибкой';

    }
  );


  // ========================================
  // ПОКАЗ СООБЩЕНИЯ ОБ ОШИБКЕ
  // ========================================

  function showError() {

    if (currentTrial.condition === 'global') {

      globalError.classList.remove(
        'is-hidden'
      );

    } else {

      const localError = document.querySelector(
        `.field-block[data-field="${currentTrial.target_field}"] .local-popover`
      );

      if (localError) {

        localError.classList.remove(
          'is-hidden'
        );

      }

    }

  }


  // ========================================
  // НАЖАТИЕ НА ПОЛЕ
  // ========================================

  async function handleFieldClick(event) {

    if (
      errorShownAt === null
      || saved
    ) {
      return;
    }

    saved = true;

    gazeMeasurementActive = false;

    const input = event.currentTarget;

    const responseTime = Math.round(
      performance.now() - errorShownAt
    );

    const correct =
      input.id === currentTrial.target_field;

    try {

      // Сохраняем результаты в Django.
      const response = await fetch(
        config.saveUrl,
        {

          method: 'POST',

          headers: {

            'Content-Type':
              'application/json',

            'X-CSRFToken':
              getCookie('csrftoken')

          },

          body: JSON.stringify({

            trial_number:
              currentTrial.trial_number,

            response_time_ms:
              responseTime,

            time_to_target_aoi_ms:
              timeToTargetAoiMs,

            clicked_correct_field:
              correct

          })

        }
      );

      if (!response.ok) {

        throw new Error(
          'Save failed: ' + response.status
        );

      }

      const data = await response.json();

      // Если завершена последняя проба.
      if (data.finished) {

        await finishExperiment();

        return;

      }

      // Переходим к следующей пробе
      // без перезагрузки страницы.
      await startTrial(data.next_trial);

    } catch (error) {

      console.error(error);

      saved = false;

      alert(
        'Не удалось сохранить пробу. ' +
        'Откройте Console (F12) ' +
        'и пришлите ошибку.'
      );

    }

  }


  // ========================================
  // ЗАВЕРШЕНИЕ ЭКСПЕРИМЕНТА
  // ========================================

  async function finishExperiment() {

    trialPage.style.display = 'none';

    try {

      webgazer.clearGazeListener();

      webgazer.end();

    } catch (error) {

      console.warn(
        'WebGazer cleanup warning:',
        error
      );

    }

    finishScreen.style.display = 'flex';

  }


  // ========================================
  // ПОЛУЧЕНИЕ КООРДИНАТ AOI
  // ========================================

  window.getTargetAOI = function () {

    const target = document.getElementById(
      currentTrial.target_field
    );

    if (!target) {
      return null;
    }

    return target.getBoundingClientRect();

  };


  // ========================================
  // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
  // ========================================

  function sleep(ms) {

    return new Promise(
      resolve => setTimeout(resolve, ms)
    );

  }


  function getCookie(name) {

    const parts = document.cookie
      ? document.cookie.split(';')
      : [];

    for (const raw of parts) {

      const cookie = raw.trim();

      if (cookie.startsWith(name + '=')) {

        return decodeURIComponent(
          cookie.substring(name.length + 1)
        );

      }

    }

    return null;

  }

})();