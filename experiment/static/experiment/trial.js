(function(){
  const c=window.EXPERIMENT;
  const overlay=document.getElementById('fixation-overlay');
  const btn=document.getElementById('continue');
  let errorShownAt=null;
  let saved=false;

  // Крест показывается ровно 1 секунду поверх страницы и исчезает сам.
  window.setTimeout(()=>{
    overlay.classList.add('is-hidden');
    document.body.classList.remove('locked');
  },1000);

  btn.addEventListener('click',()=>{
    if(errorShownAt!==null) return;
    errorShownAt=performance.now();

    if(c.condition==='global'){
      document.getElementById('global-error').classList.remove('is-hidden');
    }else{
      const local=document.querySelector(`.field-block[data-field="${c.targetField}"] .local-popover`);
      if(local) local.classList.remove('is-hidden');
    }

    btn.disabled=true;
    btn.textContent='Найдите поле с ошибкой';
  });

  document.querySelectorAll('input').forEach(input=>{
    input.addEventListener('click',async()=>{
      if(errorShownAt===null || saved) return;
      saved=true;
      const rt=Math.round(performance.now()-errorShownAt);
      const correct=input.id===c.targetField;
      try{
        const response=await fetch(c.saveUrl,{
          method:'POST',
          headers:{'Content-Type':'application/json','X-CSRFToken':getCookie('csrftoken')},
          body:JSON.stringify({trial_number:c.trialNumber,response_time_ms:rt,clicked_correct_field:correct})
        });
        if(!response.ok) throw new Error('Save failed: '+response.status);
        window.location.href=c.nextUrl;
      }catch(err){
        console.error(err);
        saved=false;
        alert('Не удалось сохранить пробу. Откройте Console (F12) и пришлите ошибку.');
      }
    });
  });

  // AOI по замечанию преподавателя: только само проблемное поле, без текста ошибки.
  window.getTargetAOI=function(){
    return document.getElementById(c.targetField).getBoundingClientRect();
  };

  function getCookie(name){
    const parts=document.cookie ? document.cookie.split(';') : [];
    for(const raw of parts){
      const cookie=raw.trim();
      if(cookie.startsWith(name+'=')) return decodeURIComponent(cookie.substring(name.length+1));
    }
    return null;
  }
})();
