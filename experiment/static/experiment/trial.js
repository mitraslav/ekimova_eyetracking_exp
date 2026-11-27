(async function () {
  'use strict';
  const config = window.EXPERIMENT;
  const $ = id => document.getElementById(id);
  const calibrationScreen = $('calibration-screen');
  const calibrationStatus = $('calibration-status');
  const trialPage = $('trial');
  const finishScreen = $('finish-screen');
  const overlay = $('fixation-overlay');
  const fieldsContainer = $('fields-container');
  const globalError = $('global-error');
  const meta = $('trial-meta');
  const continueButton = $('continue');
  const FIXATION_MIN_MS = 100;
  const AOI_MARGIN_PX = 8;
  const CALIBRATION_CLICKS = 5;
  const VALIDATION_SETTLE_MS = 600;
  const VALIDATION_RECORD_MS = 1500;
  const VALIDATION_POINTS = [[25,25],[75,25],[50,50],[25,75],[75,75]];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const timeOrigin = performance.timeOrigin;
  const runId = globalThis.crypto?.randomUUID?.() || String(Date.now());
  let currentTrial = JSON.parse($('initial-trial-data').textContent);
  let state = 'calibration';
  let active = null, validationActive = null, pending = null;
  let aoiEntryStartedAt = null, timeToTargetAoiMs = null;
  let validationRuns = [], calibrationClicks = [], records = [];
  let raf = null, saveBusy = false;
  const sessionFlags = [];
  let endStatus = 'in_progress';
  let validationPanel = null;

  function viewport() {
    return {width:innerWidth,height:innerHeight,devicePixelRatio:window.devicePixelRatio,
      scrollX:window.scrollX,scrollY:window.scrollY,
      screenWidth:screen.width,screenHeight:screen.height,
      visualViewport:window.visualViewport ? {width:visualViewport.width,height:visualViewport.height,
        scale:visualViewport.scale,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop}:null};
  }

  const initialViewport = viewport();

  function box(element) {
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
  }

  function geometry() {
    const allFields = {};
    for (const field of currentTrial.fields) {
      const input = $(field.name);
      allFields[field.name] = {input:box(input),label:box(input?.parentElement?.querySelector('label'))};
    }
    const message = currentTrial.condition === 'global' ? globalError : fieldsContainer.querySelector('.local-popover');
    return {fields:allFields,target:allFields[currentTrial.target_field]?.input || null,
      message:box(message),button:box(continueButton),form:box(trialPage.querySelector('.form-card'))};
  }

  function captureGeometry(now) {
    if (!active) return;
    const g = geometry();
    const signature = JSON.stringify(g);
    if (signature !== active.lastGeometry) {
      active.aoi_history.push({browser_time_ms:now,...g});
      active.lastGeometry = signature;
    }
  }

  function monitorGeometry() {
    if (state !== 'respond') return;
    captureGeometry(performance.now());
    raf = requestAnimationFrame(monitorGeometry);
  }

  function stopMonitor() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  }

  function flag(value) {
    if (!sessionFlags.includes(value)) sessionFlags.push(value);
    if (active && !active.quality_flags.includes(value)) active.quality_flags.push(value);
    if (validationActive && !validationActive.quality_flags.includes(value)) validationActive.quality_flags.push(value);
  }

  window.addEventListener('resize',()=>flag('viewport_resized'));
  window.addEventListener('scroll',()=>flag('viewport_scrolled'));
  window.addEventListener('blur',()=>flag('window_blurred'));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)flag('tab_hidden');});

  // Coordinates are viewport CSS pixels; callback time is NOT a camera exposure timestamp.
  function handleGazePrediction(data, elapsedTime) {
    const now = performance.now();
    const valid = !!data && Number.isFinite(data.x) && Number.isFinite(data.y);
    const sample = {browser_time_ms:now,webgazer_elapsed_ms:Number.isFinite(elapsedTime)?elapsedTime:null,
      x:valid?data.x:null,y:valid?data.y:null,valid};

    if (state === 'validation' && validationActive) {
      validationActive.samples.push(sample);
      return;
    }

    if (state !== 'respond' || !active) return;

    // Keep all callbacks, including failures and those AFTER the first AOI hit.
    const rect = box($(currentTrial.target_field));
    const inside = valid && !!rect && sample.x >= rect.left-AOI_MARGIN_PX && sample.x <= rect.right+AOI_MARGIN_PX &&
      sample.y >= rect.top-AOI_MARGIN_PX && sample.y <= rect.bottom+AOI_MARGIN_PX;

    active.samples.push({...sample,t_from_error_ms:now-active.error_onset_ms,
      target_aoi:rect,inside_target_with_margin:inside});

    // Preserve the historical 100 ms / 8 px metric for comparison with earlier pilots.
    // As in the old script, null callbacks do not reset this legacy estimate.
    // A stricter gap-aware metric can be recalculated from the exported callbacks.
    if (!valid || !rect || timeToTargetAoiMs !== null) return;
    if (!inside) { aoiEntryStartedAt = null; return; }
    if (aoiEntryStartedAt === null) { aoiEntryStartedAt = now; return; }

    if (now-aoiEntryStartedAt >= FIXATION_MIN_MS) {
      timeToTargetAoiMs = Math.round(aoiEntryStartedAt-active.error_onset_ms);
    }
  }

  function setupCalibrationPoints() {
    const points = [...document.querySelectorAll('.calibration-point')];
    if (!points.length) throw Error('Calibration points not found');

    let finished = 0;

    calibrationStatus.textContent = 'Смотрите на каждую точку и нажмите её 5 раз, не спеша.';

    for (const point of points) {
      let count = 0, last = -Infinity;

      point.addEventListener('click',()=>{
        const now = performance.now();

        if(state !== 'calibration' || count >= CALIBRATION_CLICKS || now-last < 250) return;

        last = now;

        const r = point.getBoundingClientRect(), x = r.left+r.width/2, y = r.top+r.height/2;

        webgazer.recordScreenPosition(x,y,'click');

        calibrationClicks.push({browser_time_ms:now,x,y,viewport:viewport()});

        count++;

        point.style.opacity = String(Math.max(.25,1-count*.14));

        if(count === CALIBRATION_CLICKS) {
          point.classList.add('done');
          point.style.pointerEvents = 'none';

          finished++;

          if(finished === points.length) {
            state = 'validation_intro';
            finishCalibration().catch(fail);
          }
        }
      });
    }
  }

  async function finishCalibration() {
    calibrationScreen.style.display = 'none';

    webgazer.showVideo(false);
    webgazer.showFaceOverlay(false);
    webgazer.showFaceFeedbackBox(false);
    webgazer.showPredictionPoints(false);

    validationPanel = document.createElement('div');

    Object.assign(validationPanel.style,{
      position:'fixed',
      inset:'0',
      zIndex:'2147483000',
      background:'#f8fafc',
      color:'#172033',
      fontFamily:'system-ui,sans-serif',
      display:'flex',
      alignItems:'center',
      justifyContent:'center'
    });

    document.body.append(validationPanel);

    showValidationIntro();
  }

  function validationCard(text) {
    validationPanel.replaceChildren();

    const card = document.createElement('div');

    Object.assign(card.style,{
      width:'min(620px,90vw)',
      padding:'20px',
      textAlign:'center',
      whiteSpace:'pre-line'
    });

    const p = document.createElement('p');

    p.textContent = text;

    card.append(p);
    validationPanel.append(card);

    return card;
  }

  function action(parent,text,callback) {
    const b = document.createElement('button');

    b.type='button';
    b.textContent=text;

    Object.assign(b.style,{
      margin:'8px',
      padding:'10px 16px',
      cursor:'pointer'
    });

    b.addEventListener('click',callback);

    parent.append(b);

    return b;
  }

  function showValidationIntro() {
    state = 'validation_intro';

    const card = validationCard(
      'Проверка калибровки.\nСмотрите на центр каждой точки, не нажимая на неё. Точки сами сменят друг друга.'
    );

    action(card,'Начать проверку',()=>runValidation().catch(fail));
  }

  const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : null;

  function summarize(point) {
    const good = point.samples.filter(s=>s.valid);

    const dx = good.map(s=>s.x-point.target_x);
    const dy = good.map(s=>s.y-point.target_y);

    return {
      total_callbacks:point.samples.length,
      valid_callbacks:good.length,
      valid_fraction:point.samples.length?good.length/point.samples.length:null,
      mean_error_px:mean(dx.map((x,i)=>Math.hypot(x,dy[i]))),
      mean_dx_px:mean(dx),
      mean_dy_px:mean(dy)
    };
  }

  async function runValidation() {
    if(state !== 'validation_intro' && state !== 'validation_summary') return;

    state = 'validation';

    const run = {
      started_ms:performance.now(),
      viewport:viewport(),
      points:[]
    };

    validationRuns.push(run);

    for(const [x,y] of VALIDATION_POINTS) {
      validationPanel.replaceChildren();

      const dot = document.createElement('div');

      Object.assign(dot.style,{
        position:'absolute',
        left:`${x}%`,
        top:`${y}%`,
        width:'18px',
        height:'18px',
        borderRadius:'50%',
        background:'#c92735',
        transform:'translate(-50%,-50%)'
      });

      validationPanel.append(dot);

      await sleep(VALIDATION_SETTLE_MS);

      const r = dot.getBoundingClientRect();

      const point = {
        target_x:r.left+r.width/2,
        target_y:r.top+r.height/2,
        position_percent:[x,y],
        started_ms:performance.now(),
        viewport:viewport(),
        samples:[],
        quality_flags:[]
      };

      run.points.push(point);
      validationActive = point;

      await sleep(VALIDATION_RECORD_MS);

      validationActive = null;

      point.ended_ms = performance.now();
      point.summary = summarize(point);
    }

    run.ended_ms = performance.now();

    state = 'validation_summary';

    const fmt = n=>n===null?'--':n.toFixed(1);

    const names=[
      'Верх слева',
      'Верх справа',
      'Центр',
      'Низ слева',
      'Низ справа'
    ];

    const lines=run.points.map((p,i)=>
      `${names[i]}: ${fmt(p.summary.mean_error_px)} px; dy ${fmt(p.summary.mean_dy_px)} px; ${p.summary.valid_callbacks}/${p.summary.total_callbacks}`
    );

    const card=validationCard(
      'Проверка завершена.\nСредняя ошибка, вертикальное смещение, валидные прогнозы:\n\n'+lines.join('\n')
    );

    action(card,'Повторить проверку',()=>runValidation().catch(fail));

    action(card,'Скачать JSON',downloadBackup);

    action(card,'Перейти к пробам',()=>{
      if(state!=='validation_summary')return;

      state='fixation';

      validationPanel.remove();
      validationPanel=null;

      startTrial(currentTrial).catch(fail);
    });
  }

  function renderTrial(trial) {
    currentTrial=trial;

    meta.textContent=`Проба ${trial.trial_number} из ${trial.total_trials}`;

    globalError.textContent=trial.error_message;

    globalError.classList.add('is-hidden');

    fieldsContainer.replaceChildren();

    for(const field of trial.fields) {
      const block=document.createElement('div');

      block.className='field-block';
      block.dataset.field=field.name;

      const label=document.createElement('label');

      label.htmlFor=field.name;
      label.textContent=field.label;

      const input=document.createElement('input');

      input.id=field.name;
      input.name=field.name;
      input.type=field.name==='password'?'password':'text';
      input.value=field.value;

      block.append(label,input);

      if(field.is_target && trial.condition==='local') {
        const e=document.createElement('div');

        e.className='error-popover local-popover is-hidden';
        e.textContent=trial.error_message;

        block.append(e);
      }

      fieldsContainer.append(block);

      input.addEventListener('click',handleFieldClick);
    }

    continueButton.disabled=false;
    continueButton.textContent='Продолжить';

    active=null;
    pending=null;
    aoiEntryStartedAt=null;
    timeToTargetAoiMs=null;
  }

  async function startTrial(trial) {
    state='fixation';

    renderTrial(trial);

    trialPage.style.visibility='hidden';

    overlay.classList.remove('is-hidden');

    document.body.classList.add('locked');

    await sleep(1000);

    overlay.classList.add('is-hidden');

    trialPage.style.visibility='visible';

    document.body.classList.remove('locked');

    state='ready';
  }

  continueButton.addEventListener('click',()=>{
    if(state!=='ready')return;

    const errorTime=performance.now();

    active={
      trial_number:currentTrial.trial_number,
      condition:currentTrial.condition,
      target_field:currentTrial.target_field,
      target_position:currentTrial.target_position,
      stimulus:currentTrial,
      viewport:viewport(),
      error_onset_ms:errorTime,
      samples:[],
      aoi_history:[],
      quality_flags:[],
      lastGeometry:null
    };

    if(currentTrial.condition==='global')
      globalError.classList.remove('is-hidden');
    else
      fieldsContainer.querySelector('.local-popover')?.classList.remove('is-hidden');

    continueButton.disabled=true;
    continueButton.textContent='Найдите поле с ошибкой';

    state='respond';

    captureGeometry(performance.now());

    raf=requestAnimationFrame(monitorGeometry);
  });

  async function handleFieldClick(event) {
    if(state!=='respond'||!active)return;

    const now=performance.now();

    state='saving';

    stopMonitor();

    captureGeometry(now);

    const clicked=event.currentTarget.id;

    pending={
      trial_number:currentTrial.trial_number,
      response_time_ms:Math.round(now-active.error_onset_ms),
      time_to_target_aoi_ms:timeToTargetAoiMs,
      clicked_correct_field:clicked===currentTrial.target_field
    };

    active.click_ms=now;
    active.clicked_field=clicked;

    Object.assign(active,pending);

    active.server_saved=false;

    delete active.lastGeometry;

    records.push(active);

    await sendTrial();
  }

  async function sendTrial() {
    if(saveBusy||!pending)return;

    saveBusy=true;
    state='saving';

    try {
      const response=await fetch(config.saveUrl,{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'X-CSRFToken':getCookie('csrftoken')
        },
        body:JSON.stringify(pending)
      });

      if(!response.ok)
        throw Error('Save failed: '+response.status);

      const data=await response.json();

      if(!data.finished&&!data.next_trial)
        throw Error('Invalid server response');

      active.server_saved=true;

      if(data.finished) {
        finishExperiment();
        return;
      }

      await startTrial(data.next_trial);

    } catch(error) {
      console.error(error);

      state='save_failed';

      // Never re-measure a response after a failed request.
      showSaveFailure(error);

    } finally {
      saveBusy=false;
    }
  }

  function showSaveFailure(error) {
    const panel=document.createElement('div');

    Object.assign(panel.style,{
      position:'fixed',
      inset:'0',
      zIndex:'2147483001',
      background:'#fff',
      color:'#222',
      display:'flex',
      alignItems:'center',
      justifyContent:'center'
    });

    const card=document.createElement('div');

    card.style.padding='24px';

    card.textContent='Ошибка сохранения: '+error.message;

    panel.append(card);
    document.body.append(panel);

    action(card,'Скачать JSON',downloadBackup);

    action(card,'Повторить отправку',()=>{
      if(saveBusy)return;

      panel.remove();

      sendTrial();
    });
  }

  function snapshot() {
    return {
      schema_version:'webgazer-validation-v1',
      run_id:runId,
      participant_id:config.participantId??null,
      status:endStatus,
      time_origin_ms:timeOrigin,
      coordinate_space:'viewport_css_px',
      timestamp_note:'browser callback receipt time, not camera exposure time',
      kalman_filter:true,
      fixation_min_ms:FIXATION_MIN_MS,
      aoi_margin_px:AOI_MARGIN_PX,
      legacy_metric:true,
      initial_viewport:initialViewport,
      final_viewport:viewport(),
      quality_flags:sessionFlags,
      calibration_clicks:calibrationClicks,
      validation_runs:validationRuns,
      records
    };
  }

  function downloadBackup() {
    const blob=new Blob(
      [JSON.stringify(snapshot(),null,2)],
      {type:'application/json'}
    );

    const url=URL.createObjectURL(blob);

    const a=document.createElement('a');

    a.href=url;

    const pid=String(config.participantId??'participant')
      .replace(/[^a-zA-Z0-9_-]/g,'_');

    a.download=`webgazer_${pid}_${runId}.json`;

    document.body.append(a);

    a.click();
    a.remove();

    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  window.downloadWebGazerBackup=downloadBackup;

  function finishExperiment() {
    state='done';

    endStatus='completed';

    stopMonitor();

    trialPage.style.display='none';

    finishScreen.style.display='flex';

    const holder=document.createElement('div');

    holder.style.textAlign='center';

    const note=document.createElement('p');

    note.textContent='Скачайте JSON перед закрытием страницы.';

    holder.append(note);

    action(
      holder,
      'Скачать исходные данные JSON',
      downloadBackup
    );

    finishScreen.append(holder);

    try {
      webgazer.clearGazeListener();

      Promise.resolve(webgazer.end()).catch(console.warn);

    } catch(e) {
      console.warn(e);
    }
  }

  function fail(error) {
    console.error(error);

    state='failed';
    endStatus='failed';

    stopMonitor();

    if(validationPanel){
      validationPanel.remove();
      validationPanel=null;
    }

    calibrationScreen.style.display='none';
    trialPage.style.display='none';

    overlay.classList.add('is-hidden');

    finishScreen.style.display='flex';

    finishScreen.replaceChildren();

    const card=document.createElement('div');

    card.textContent='Эксперимент прерван: '+error.message;

    finishScreen.append(card);

    action(card,'Скачать JSON',downloadBackup);

    try{
      webgazer.clearGazeListener();

      Promise.resolve(webgazer.end()).catch(console.warn);

    }catch(e){
      console.warn(e);
    }
  }

  function getCookie(name) {
    for(const raw of document.cookie.split(';')){
      const c=raw.trim();

      if(c.startsWith(name+'='))
        return decodeURIComponent(c.substring(name.length+1));
    }

    return null;
  }

  window.getTargetAOI=()=>
    $(currentTrial.target_field)?.getBoundingClientRect()||null;

  try {
    webgazer.params.faceMeshSolutionPath=
      'https://cdn.jsdelivr.net/npm/webgazer@3.5.3/dist/mediapipe/face_mesh';

    webgazer.saveDataAcrossSessions(false);
    webgazer.applyKalmanFilter(true);
    webgazer.showPredictionPoints(false);

    webgazer.showVideo(true);
    webgazer.showFaceOverlay(true);
    webgazer.showFaceFeedbackBox(true);

    webgazer.setGazeListener(handleGazePrediction);

    await webgazer.begin();

    webgazer.removeMouseEventListeners();

    setupCalibrationPoints();

  } catch(error) {
    console.error(error);

    calibrationStatus.textContent=
      'Ошибка WebGazer: '+(error?.message||String(error));
  }
})();