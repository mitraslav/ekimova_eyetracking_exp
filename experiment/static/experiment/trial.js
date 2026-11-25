(async function () {

  const config = window.EXPERIMENT;


  // ----------------------------------------
  // DOM
  // ----------------------------------------

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


  // ----------------------------------------
  // Trial state
  // ----------------------------------------

  let currentTrial = JSON.parse(
    document
      .getElementById('initial-trial-data')
      .textContent
  );

  let errorShownAt = null;

  let saved = false;

  let gazeMeasurementActive = false;

  let timeToTargetAoiMs = null;


  /*
   * Для приближённой "фиксации":
   * взгляд должен оставаться внутри AOI
   * минимум 100 мс.
   */
  const FIXATION_MIN_MS = 100;

  let aoiEntryStartedAt = null;


  // ========================================
  // WEBGAZER
  // ========================================

  try {

    /*
     * Участники не должны наследовать
     * калибровку предыдущего человека
     * на этом компьютере.
     */
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


    /*
     * Убираем автоматическое обучение
     * на обычных кликах мыши.
     * Калибровочные точки запишем сами.
     */
    webgazer.removeMouseEventListeners();


    calibrationStatus.textContent =
      'Смотрите на каждую точку и нажмите её 3 раза.';


    setupCalibrationPoints();


  } catch (error) {

    console.error(
      'WebGazer initialization error:',
      error
    );

    calibrationStatus.textContent =
      'Не удалось запустить камеру.';

    alert(
      'Не удалось запустить айтрекинг. ' +
      'Проверьте разрешение камеры.'
    );

  }



  // ========================================
  // CALIBRATION
  // ========================================

  function setupCalibrationPoints() {

    const points =
      document.querySelectorAll(
        '.calibration-point'
      );

    let finishedPoints = 0;


    points.forEach(point => {

      let clickCount = 0;


      point.addEventListener(
        'click',
        () => {

          const rect =
            point.getBoundingClientRect();


          const x =
            rect.left
            + rect.width / 2;


          const y =
            rect.top
            + rect.height / 2;


          /*
           * Говорим WebGazer:
           * пользователь смотрел сюда.
           */
          webgazer.recordScreenPosition(
            x,
            y,
            'click'
          );


          clickCount += 1;


          /*
           * Визуально показываем прогресс.
           */
          point.style.opacity =
            String(
              Math.max(
                0.25,
                1 - clickCount * 0.25
              )
            );


          if (clickCount >= 3) {

            point.classList.add(
              'done'
            );

            finishedPoints += 1;


            if (
              finishedPoints
              === points.length
            ) {

              finishCalibration();
            }
          }

        }
      );

    });

  }



  async function finishCalibration() {

    calibrationStatus.textContent =
      'Калибровка завершена.';


    await sleep(500);


    calibrationScreen.style.display =
      'none';


    /*
     * Видео участнику во время
     * самих проб уже не нужно.
     */
    webgazer.showVideo(false);

    webgazer.showFaceOverlay(false);

    webgazer.showFaceFeedbackBox(false);

    webgazer.showPredictionPoints(false);


    await startTrial(currentTrial);
  }



  // ========================================
  // GAZE LISTENER
  // ========================================

  function handleGazePrediction(
    data,
    elapsedTime
  ) {

    if (!data) {
      return;
    }


    /*
     * Пока ошибка не появилась,
     * метрика не считается.
     */
    if (
      !gazeMeasurementActive
      || errorShownAt === null
      || timeToTargetAoiMs !== null
    ) {
      return;
    }


    const target =
      document.getElementById(
        currentTrial.target_field
      );


    if (!target) {
      return;
    }


    const rect =
      target.getBoundingClientRect();


    /*
     * Небольшой запас AOI 8 px.
     */
    const margin = 8;


    const inside =
      data.x >= rect.left - margin
      && data.x <= rect.right + margin
      && data.y >= rect.top - margin
      && data.y <= rect.bottom + margin;


    const now =
      performance.now();


    if (inside) {

      /*
       * Первое попадание.
       */
      if (
        aoiEntryStartedAt === null
      ) {

        aoiEntryStartedAt = now;

        return;
      }


      /*
       * Считаем "фиксацией",
       * если взгляд остаётся в AOI
       * хотя бы 100 мс.
       */
      if (
        now - aoiEntryStartedAt
        >= FIXATION_MIN_MS
      ) {

        timeToTargetAoiMs =
          Math.round(
            aoiEntryStartedAt
            - errorShownAt
          );


        gazeMeasurementActive =
          false;


        console.log(
          'Target AOI fixation:',
          timeToTargetAoiMs,
          'ms'
        );
      }

    } else {

      /*
       * Взгляд ушёл из AOI до 100 мс:
       * это не считаем фиксацией.
       */
      aoiEntryStartedAt = null;
    }

  }



  // ========================================
  // RENDER TRIAL
  // ========================================

  function renderTrial(trial) {

    currentTrial = trial;


    meta.textContent =
      `Проба ${trial.trial_number} ` +
      `из ${trial.total_trials}`;


    globalError.textContent =
      trial.error_message;


    globalError.classList.add(
      'is-hidden'
    );


    fieldsContainer.innerHTML = '';


    trial.fields.forEach(field => {

      const block =
        document.createElement('div');


      block.className =
        'field-block';


      block.dataset.field =
        field.name;


      const label =
        document.createElement('label');


      label.htmlFor =
        field.name;


      label.textContent =
        field.label;


      const input =
        document.createElement('input');


      input.id =
        field.name;


      input.name =
        field.name;


      input.type =
        field.name === 'password'
          ? 'password'
          : 'text';


      input.value =
        field.value;


      block.appendChild(label);

      block.appendChild(input);


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


        block.appendChild(
          localError
        );
      }


      fieldsContainer.appendChild(
        block
      );


      input.addEventListener(
        'click',
        handleFieldClick
      );

    });


    continueButton.disabled =
      false;


    continueButton.textContent =
      'Продолжить';


    errorShownAt = null;

    saved = false;

    gazeMeasurementActive =
      false;

    timeToTargetAoiMs =
      null;

    aoiEntryStartedAt =
      null;
  }



  // ========================================
  // START TRIAL
  // ========================================

  async function startTrial(trial) {

    renderTrial(trial);


    trialPage.style.visibility =
      'hidden';


    overlay.classList.remove(
      'is-hidden'
    );


    document.body.classList.add(
      'locked'
    );


    await sleep(1000);


    overlay.classList.add(
      'is-hidden'
    );


    trialPage.style.visibility =
      'visible';


    document.body.classList.remove(
      'locked'
    );
  }



  // ========================================
  // SHOW ERROR
  // ========================================

  continueButton.addEventListener(
    'click',
    () => {

      if (
        errorShownAt !== null
      ) {
        return;
      }


      /*
       * С этого момента начинается
       * измерение eye-tracking DV.
       */
      errorShownAt =
        performance.now();


      timeToTargetAoiMs =
        null;


      aoiEntryStartedAt =
        null;


      gazeMeasurementActive =
        true;


      showError();


      continueButton.disabled =
        true;


      continueButton.textContent =
        'Найдите поле с ошибкой';

    }
  );



  function showError() {

    if (
      currentTrial.condition ===
      'global'
    ) {

      globalError.classList.remove(
        'is-hidden'
      );

    } else {

      const localError =
        document.querySelector(
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
  // FIELD CLICK
  // ========================================

  async function handleFieldClick(
    event
  ) {

    if (
      errorShownAt === null
      || saved
    ) {
      return;
    }


    saved = true;

    gazeMeasurementActive = false;


    const input =
      event.currentTarget;


    const responseTime =
      Math.round(
        performance.now()
        - errorShownAt
      );


    const correct =
      input.id ===
      currentTrial.target_field;


    try {

      const response =
        await fetch(
          config.saveUrl,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',

              'X-CSRFToken':
                getCookie(
                  'csrftoken'
                )
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
          'Save failed: '
          + response.status
        );
      }


      const data =
        await response.json();


      if (data.finished) {

        await finishExperiment();

        return;
      }


      await startTrial(
        data.next_trial
      );


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
  // FINISH
  // ========================================

  async function finishExperiment() {

    trialPage.style.display =
      'none';


    try {

      webgazer.clearGazeListener();

      webgazer.end();

    } catch (error) {

      console.warn(
        'WebGazer cleanup warning:',
        error
      );

    }


    finishScreen.style.display =
      'flex';
  }



  // ========================================
  // AOI HELPER
  // ========================================

  window.getTargetAOI =
    function () {

      const target =
        document.getElementById(
          currentTrial.target_field
        );


      if (!target) {
        return null;
      }


      return target
        .getBoundingClientRect();
    };



  // ========================================
  // HELPERS
  // ========================================

  function sleep(ms) {

    return new Promise(
      resolve =>
        setTimeout(resolve, ms)
    );
  }



  function getCookie(name) {

    const parts =
      document.cookie
        ? document.cookie.split(';')
        : [];


    for (const raw of parts) {

      const cookie =
        raw.trim();


      if (
        cookie.startsWith(
          name + '='
        )
      ) {

        return decodeURIComponent(
          cookie.substring(
            name.length + 1
          )
        );
      }
    }


    return null;
  }

})();