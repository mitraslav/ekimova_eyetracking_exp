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
  const CALIBRATION_DWELL_MS = 900;
  const CALIBRATION_CLICK_INTERVAL_MS = 500;
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
  let calibrationAttempt = 0, calibrationHandler = null;
  let acceptedValidationRun = null;

  const calibrationAttempts = [];

  function viewport() {
    return {
      width:innerWidth,
      height:innerHeight,
      devicePixelRatio:window.devicePixelRatio,
      scrollX:window.scrollX,
      scrollY:window.scrollY,
      screenWidth:screen.width,
      screenHeight:screen.height,
      visualViewport:window.visualViewport ? {
        width:visualViewport.width,
        height:visualViewport.height,
        scale:visualViewport.scale,
        offsetLeft:visualViewport.offsetLeft,
        offsetTop:visualViewport.offsetTop
      }:null
    };
  }

  const initialViewport = viewport();

  function box(element) {
    if (!element) return null;

    const r = element.getBoundingClientRect();

    return {
      left:r.left,
      top:r.top,
      right:r.right,
      bottom:r.bottom,
      width:r.width,
      height:r.height
    };
  }

  function geometry() {
    const allFields = {};

    for (const field of currentTrial.fields) {
      const input = $(field.name);

      allFields[field.name] = {
        input:box(input),
        label:box(input?.parentElement?.querySelector('label'))
      };
    }

    const message = currentTrial.condition === 'global'
      ? globalError
      : fieldsContainer.querySelector('.local-popover');

    return {
      fields:allFields,
      target:allFields[currentTrial.target_field]?.input || null,
      message:box(message),
      button:box(continueButton),
      form:box(trialPage.querySelector('.form-card'))
    };
  }

  function captureGeometry(now) {
    if (!active) return;

    const g = geometry();
    const signature = JSON.stringify(g);

    if (signature !== active.lastGeometry) {
      active.aoi_history.push({
        browser_time_ms:now,
        ...g
      });

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
    if (!sessionFlags.includes(value))
      sessionFlags.push(value);

    if (active && !active.quality_flags.includes(value))
      active.quality_flags.push(value);

    if (validationActive && !validationActive.quality_flags.includes(value))
      validationActive.quality_flags.push(value);

    if (state==='calibration' && calibrationAttempts.length) {
      const f=calibrationAttempts[
        calibrationAttempts.length-1
      ].quality_flags;

      if(!f.includes(value))f.push(value);
    }
  }

  window.addEventListener('resize',()=>flag('viewport_resized'));
  window.addEventListener('scroll',()=>flag('viewport_scrolled'));
  window.addEventListener('blur',()=>flag('window_blurred'));

  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)flag('tab_hidden');
  });

  // Coordinates are viewport CSS pixels;
  // callback time is NOT a camera exposure timestamp.

  function handleGazePrediction(data, elapsedTime) {
    const now = performance.now();

    const valid = !!data &&
      Number.isFinite(data.x) &&
      Number.isFinite(data.y);

    const sample = {
      browser_time_ms:now,
      webgazer_elapsed_ms:Number.isFinite(elapsedTime)
        ? elapsedTime
        : null,
      x:valid?data.x:null,
      y:valid?data.y:null,
      valid
    };

    if (state === 'validation' && validationActive) {
      validationActive.samples.push(sample);
      return;
    }

    if (state !== 'respond' || !active) return;

    // Keep all callbacks, including failures and
    // those AFTER the first AOI hit.

    const rect = box($(currentTrial.target_field));

    const inside = valid && !!rect &&
      sample.x >= rect.left-AOI_MARGIN_PX &&
      sample.x <= rect.right+AOI_MARGIN_PX &&
      sample.y >= rect.top-AOI_MARGIN_PX &&
      sample.y <= rect.bottom+AOI_MARGIN_PX;

    active.samples.push({
      ...sample,
      t_from_error_ms:now-active.error_onset_ms,
      target_aoi:rect,
      inside_target_with_margin:inside
    });

    // Preserve the historical 100 ms / 8 px
    // metric for comparison with earlier pilots.
    // As in the old script, null callbacks do not
    // reset this legacy estimate.
    // A stricter gap-aware metric can be
    // recalculated from the exported callbacks.

    if (!valid || !rect || timeToTargetAoiMs !== null)
      return;

    if (!inside) {
      aoiEntryStartedAt = null;
      return;
    }

    if (aoiEntryStartedAt === null) {
      aoiEntryStartedAt = now;
      return;
    }

    if (now-aoiEntryStartedAt >= FIXATION_MIN_MS) {
      timeToTargetAoiMs = Math.round(
        aoiEntryStartedAt-active.error_onset_ms
      );
    }
  }

  async function setupCalibrationPoints() {
    state = 'calibration_reset';

    const points = [
      ...document.querySelectorAll('.calibration-point')
    ];

    if (points.length !== 9)
      throw Error(
        'Expected 9 calibration points, found '+points.length
      );

    // Reset the regression model for every attempt,
    // not merely the UI.

    if (typeof webgazer.clearData !== 'function')
      throw Error('WebGazer clearData unavailable');

    await webgazer.clearData();

    webgazer.removeMouseEventListeners();

    if (validationPanel) {
      validationPanel.remove();
      validationPanel=null;
    }

    calibrationScreen.style.display='';
    calibrationScreen.style.visibility='visible';

    webgazer.showVideo(true);
    webgazer.showFaceOverlay(true);
    webgazer.showFaceFeedbackBox(true);
    webgazer.showPredictionPoints(false);

    calibrationAttempt++;

    const attempt={
      attempt:calibrationAttempt,
      started_ms:performance.now(),
      viewport:viewport(),
      quality_flags:[]
    };

    calibrationAttempts.push(attempt);

    for (const point of points) {
      if (calibrationHandler)
        point.removeEventListener(
          'click',
          calibrationHandler
        );

      point.classList.remove('done');
      point.style.visibility='hidden';
      point.style.pointerEvents='none';
      point.style.opacity='1';
    }

    let index=0, count=0, nextAllowed=Infinity;
    let generation=0;

    const instruction=
      'Сидите неподвижно, смотрите в центр точки. Не переводите взгляд на курсор.';

    const readyText=()=>
      `${instruction} Точка ${index+1}/${points.length}. Нажатие ${count+1}/${CALIBRATION_CLICKS}.`;

    function arm(delay) {
      const own=++generation;
      const point=points[index];

      nextAllowed=performance.now()+delay;

      point.style.pointerEvents='none';

      calibrationStatus.textContent=
        `${instruction} Точка ${index+1}/${points.length}: удерживайте взгляд...`;

      setTimeout(()=>{
        if(state!=='calibration'||own!==generation)
          return;

        point.style.pointerEvents='auto';
        calibrationStatus.textContent=readyText();

      },delay);
    }

    function showPoint() {
      count=0;

      const point=points[index];

      point.style.visibility='visible';
      point.style.opacity='1';

      arm(CALIBRATION_DWELL_MS);
    }

    calibrationHandler=event=>{
      const now=performance.now();

      if(
        state!=='calibration' ||
        event.currentTarget!==points[index] ||
        now<nextAllowed
      )return;

      const point=event.currentTarget;

      const r=point.getBoundingClientRect();
      const x=r.left+r.width/2;
      const y=r.top+r.height/2;

      webgazer.recordScreenPosition(x,y,'click');

      calibrationClicks.push({
        attempt:calibrationAttempt,
        point_index:index+1,
        click_index:count+1,
        browser_time_ms:now,
        x,y,
        viewport:viewport()
      });

      count++;

      if(count<CALIBRATION_CLICKS){
        arm(CALIBRATION_CLICK_INTERVAL_MS);
        return;
      }

      point.style.visibility='hidden';
      point.style.pointerEvents='none';

      index++;

      if(index<points.length){
        showPoint();
        return;
      }

      attempt.ended_ms=performance.now();

      state='validation_intro';

      finishCalibration().catch(fail);
    };

    for(const point of points)
      point.addEventListener(
        'click',
        calibrationHandler
      );

    state='calibration';

    showPoint();
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
      justifyContent:'center',
      overflow:'auto'
    });

    document.body.append(validationPanel);

    showValidationIntro();
  }

  function formValidationPoints() {
    // Measure the real, pre-error form under
    // the opaque validation overlay.
    // The first trial is rendered again normally
    // when the experiment starts.

    renderTrial(currentTrial);

    const rects=Array.from(
      fieldsContainer.querySelectorAll('input')
    ).map(box).sort((a,b)=>a.top-b.top);

    if(
      rects.length!==4 ||
      rects.some(r=>!r||r.width<=0||r.height<=0)
    )throw Error(
      'Cannot measure four form fields for validation'
    );

    return rects.map((r,i)=>({
      name:`Поле ${i+1} (сверху)`,
      kind:'form',
      x:r.left+r.width*(i%2===0?.4:.6),
      y:r.top+r.height/2,
      reference_aoi:r
    }));
  }

  function validationCard(text) {
    validationPanel.replaceChildren();

    const card = document.createElement('div');

    Object.assign(card.style,{
      width:'min(850px,95vw)',
      padding:'16px',
      textAlign:'center',
      whiteSpace:'pre-line',
      fontSize:'14px',
      lineHeight:'1.3',
      maxHeight:'100%',
      overflow:'auto',
      boxSizing:'border-box'
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
      margin:'5px',
      padding:'8px 12px',
      cursor:'pointer',
      width:'auto',
      height:'auto',
      minHeight:'36px',
      fontSize:'14px'
    });

    b.addEventListener('click',callback);

    parent.append(b);

    return b;
  }

  function showValidationIntro() {
    state = 'validation_intro';

    const card = validationCard(
      'Проверка калибровки: 5 прежних контрольных точек и 4 точки внутри полей формы.\nСмотрите на центр каждой точки, не нажимая на неё. Не меняйте положение головы. Точки сами сменят друг друга.'
    );

    action(
      card,
      'Начать проверку',
      ()=>runValidation().catch(fail)
    );
  }

  const mean = a => a.length
    ? a.reduce((s,v)=>s+v,0)/a.length
    : null;

  function summarize(point) {
    const good = point.samples.filter(s=>s.valid);

    const dx = good.map(s=>s.x-point.target_x);
    const dy = good.map(s=>s.y-point.target_y);

    const r=point.reference_aoi;

    const inField=r
      ? good.filter(
          s=>s.x>=r.left &&
             s.x<=r.right &&
             s.y>=r.top &&
             s.y<=r.bottom
        ).length
      : null;

    return {
      total_callbacks:point.samples.length,
      valid_callbacks:good.length,
      within_reference_aoi_count:inField,
      within_reference_aoi_fraction:r&&good.length
        ? inField/good.length
        : null,
      valid_fraction:point.samples.length
        ? good.length/point.samples.length
        : null,
      mean_error_px:mean(
        dx.map((x,i)=>Math.hypot(x,dy[i]))
      ),
      mean_dx_px:mean(dx),
      mean_dy_px:mean(dy)
    };
  }

  async function runValidation() {
    if(
      state !== 'validation_intro' &&
      state !== 'validation_summary'
    )return;

    state = 'validation';

    const run = {
      attempt:calibrationAttempt,
      started_ms:performance.now(),
      viewport:viewport(),
      points:[]
    };

    validationRuns.push(run);

    const names=[
      'Верх слева',
      'Верх справа',
      'Центр',
      'Низ слева',
      'Низ справа'
    ];

    const screenPoints=VALIDATION_POINTS.map(
      ([x,y],i)=>({
        name:names[i],
        kind:'screen',
        x:innerWidth*x/100,
        y:(window.visualViewport?.height||innerHeight)*y/100,
        position_percent:[x,y]
      })
    );

    const targets=[
      ...screenPoints,
      ...formValidationPoints()
    ];

    for(const target of targets) {
      validationPanel.replaceChildren();

      const dot = document.createElement('div');

      Object.assign(dot.style,{
        position:'absolute',
        left:`${target.x}px`,
        top:`${target.y}px`,
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
        name:target.name,
        kind:target.kind,
        target_x:r.left+r.width/2,
        target_y:r.top+r.height/2,
        position_percent:target.position_percent||null,
        reference_aoi:target.reference_aoi||null,
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

    const groupMean=kind=>mean(
      run.points.filter(
        p=>p.kind===kind &&
           p.summary.mean_error_px!==null
      ).map(p=>p.summary.mean_error_px)
    );

    run.screen_mean_error_px=groupMean('screen');
    run.form_mean_error_px=groupMean('form');

    const lines=run.points.map(
      p=>`${p.name}: ${fmt(p.summary.mean_error_px)} px; dy ${fmt(p.summary.mean_dy_px)} px; ${p.summary.valid_callbacks}/${p.summary.total_callbacks}${p.kind==='form'?'; в поле '+(p.summary.within_reference_aoi_fraction===null?'--':Math.round(100*p.summary.within_reference_aoi_fraction)+'%'):''}`
    );

    const card=validationCard(
      `Проверка ${calibrationAttempt} завершена.\nСредняя ошибка по точкам экрана: ${fmt(run.screen_mean_error_px)} px.\nПо точкам формы: ${fmt(run.form_mean_error_px)} px.\n\nОшибка; вертикальное смещение; числовые прогнозы:\n${lines.join('\n')}\n\nЕсли ошибка велика относительно высоты поля, повторите калибровку.`
    );

    action(
      card,
      'Повторить проверку',
      ()=>runValidation().catch(fail)
    );

    action(
      card,
      'Калибровать заново',
      ()=>{
        if(state==='validation_summary')
          setupCalibrationPoints().catch(fail);
      }
    );

    action(card,'Скачать JSON',downloadBackup);

    action(card,'Перейти к пробам',()=>{
      if(state!=='validation_summary')return;

      acceptedValidationRun=validationRuns.indexOf(run);

      run.selected_for_trials=true;

      state='fixation';

      validationPanel.remove();
      validationPanel=null;

      startTrial(currentTrial).catch(fail);
    });
  }

  function renderTrial(trial) {
    currentTrial=trial;

    meta.textContent=
      `Проба ${trial.trial_number} из ${trial.total_trials}`;

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
      input.type=field.name==='password'
        ?'password'
        :'text';

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
      fieldsContainer.querySelector(
        '.local-popover'
      )?.classList.remove('is-hidden');

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
      response_time_ms:Math.round(
        now-active.error_onset_ms
      ),
      time_to_target_aoi_ms:timeToTargetAoiMs,
      clicked_correct_field:
        clicked===currentTrial.target_field
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

      // Never re-measure a response
      // after a failed request.

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

    card.textContent=
      'Ошибка сохранения: '+error.message;

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
      schema_version:'webgazer-validation-v2',
      run_id:runId,
      participant_id:config.participantId??null,
      status:endStatus,
      time_origin_ms:timeOrigin,
      coordinate_space:'viewport_css_px',
      timestamp_note:
        'browser callback receipt time, not camera exposure time',
      kalman_filter:true,
      fixation_min_ms:FIXATION_MIN_MS,
      aoi_margin_px:AOI_MARGIN_PX,
      legacy_metric:true,
      initial_viewport:initialViewport,
      final_viewport:viewport(),
      quality_flags:sessionFlags,
      calibration_protocol:{
        clicks_per_point:CALIBRATION_CLICKS,
        initial_dwell_ms:CALIBRATION_DWELL_MS,
        min_click_interval_ms:
          CALIBRATION_CLICK_INTERVAL_MS
      },
      calibration_attempts:calibrationAttempts,
      accepted_validation_run_index:acceptedValidationRun,
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

    const pid=String(
      config.participantId??'participant'
    ).replace(/[^a-zA-Z0-9_-]/g,'_');

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

    note.textContent=
      'Скачайте JSON перед закрытием страницы.';

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

    card.textContent=
      'Эксперимент прерван: '+error.message;

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
        return decodeURIComponent(
          c.substring(name.length+1)
        );
    }

    return null;
  }

  window.getTargetAOI=()=>
    $(currentTrial.target_field)?.getBoundingClientRect()
    ||null;

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

    await setupCalibrationPoints();

  } catch(error) {
    console.error(error);

    calibrationStatus.textContent=
      'Ошибка WebGazer: '+(error?.message||String(error));
  }
})();