(async function () {

  const config = window.EXPERIMENT;


  // ----------------------------------------
  // DOM
  // ----------------------------------------

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
  // Начальные данные
  // ----------------------------------------

  let currentTrial = JSON.parse(
    document
      .getElementById('initial-trial-data')
      .textContent
  );

  let tracker = null;

  let errorShownAt = null;
  let saved = false;
  let recording = false;


  // ----------------------------------------
  // Chiasm initialization
  // ----------------------------------------

  try {

    tracker = await initChiasmTracker({
      authToken: config.chiasmToken
    });


    tracker.setExpInfo(
      config.chiasmExperimentId,
      config.participantId,
      true
    );


    await tracker.startSession();


    // Сначала screen-size calibration.
    await tracker.showScreenCalibration();


    // Затем webcam preview + gaze calibration
    // + validation.
    await tracker.setupTrackerWithRetries();


    // Калибровка закончилась.
    await startTrial(currentTrial);

  } catch (error) {

    console.error(
      'Chiasm initialization error:',
      error
    );

    alert(
      'Не удалось запустить айтрекинг. ' +
      'Откройте Console (F12) и пришлите ошибку.'
    );

  }



  // ========================================
  // RENDER TRIAL
  // ========================================

  function renderTrial(trial) {

    currentTrial = trial;

    meta.textContent =
      `Проба ${trial.trial_number} из ${trial.total_trials}`;


    // Глобальная ошибка
    globalError.textContent =
      trial.error_message;

    globalError.classList.add(
      'is-hidden'
    );


    // Поля
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


      // AOI = только проблемное поле.
      if (field.is_target) {
        input.dataset.targetAoi = 'true';
      }


      block.appendChild(label);
      block.appendChild(input);


      // LOCAL error
      if (
        field.is_target
        && trial.condition === 'local'
      ) {

        const localError =
          document.createElement('div');

        localError.className =
          'error-popover local-popover is-hidden';

        localError.textContent =
          trial.error_message;

        block.appendChild(localError);
      }


      fieldsContainer.appendChild(
        block
      );


      input.addEventListener(
        'click',
        handleFieldClick
      );

    });


    continueButton.disabled = false;

    continueButton.textContent =
      'Продолжить';


    errorShownAt = null;
    saved = false;
    recording = false;
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
  // ERROR APPEARS
  // ========================================

  continueButton.addEventListener(
    'click',
    async () => {

      if (errorShownAt !== null) {
        return;
      }


      continueButton.disabled = true;

      continueButton.textContent =
        'Подготовка айтрекинга...';


      try {

        /*
         * Запись запускаем непосредственно
         * перед появлением ошибки.
         *
         * Поэтому начало recording segment
         * практически совпадает с error onset.
         */
        await tracker.startRecording();

        recording = true;


        errorShownAt =
          performance.now();


        showError();


        continueButton.textContent =
          'Найдите поле с ошибкой';


      } catch (error) {

        console.error(
          'Could not start recording:',
          error
        );

        continueButton.disabled = false;

        continueButton.textContent =
          'Продолжить';

        alert(
          'Не удалось начать запись взгляда.'
        );

      }

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
  // PARTICIPANT CLICKS FIELD
  // ========================================

  async function handleFieldClick(event) {

    if (
      errorShownAt === null
      || saved
    ) {
      return;
    }


    saved = true;


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

      // Сначала завершаем gaze segment.
      if (recording) {

        await tracker.stopRecording();

        recording = false;
      }


      // Затем сохраняем behavioural data.
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


      // Эксперимент закончен.
      if (data.finished) {

        await finishExperiment();

        return;
      }


      // Следующая проба,
      // без reload страницы.
      await startTrial(
        data.next_trial
      );


    } catch (error) {

      console.error(error);

      saved = false;

      alert(
        'Не удалось сохранить пробу. ' +
        'Откройте Console (F12) и пришлите ошибку.'
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

      /*
       * Ждём, пока все gaze predictions
       * будут отправлены Chiasm.
       */
      await tracker.ensureAllPredictionsReturned();

    } catch (error) {

      console.warn(
        'Prediction flush warning:',
        error
      );

    }


    try {

      await tracker.cleanupTracker();

    } catch (error) {

      console.warn(
        'Tracker cleanup warning:',
        error
      );

    }


    finishScreen.style.display =
      'flex';
  }



  // ========================================
  // AOI
  // ========================================

  /*
   * Оставляем эту функцию:
   * позже она позволит автоматически
   * считать первое попадание взгляда
   * в целевое поле.
   */
  window.getTargetAOI = function () {

    const target =
      document.getElementById(
        currentTrial.target_field
      );

    if (!target) {
      return null;
    }

    return target.getBoundingClientRect();
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