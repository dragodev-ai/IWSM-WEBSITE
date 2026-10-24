(()=>{
 if(document.getElementById('iwsm-music'))return;
 const key='iwsm_anthem_v1';let saved={};try{saved=JSON.parse(sessionStorage.getItem(key)||'{}')}catch{}
 const audio=new Audio('assets/Rise%20With%20the%20Market%20%E2%80%94%20IWSM%20Anthem.mp3');audio.loop=true;audio.volume=.3;audio.preload='auto';audio.autoplay=true;audio.defaultMuted=false;audio.muted=false;audio.setAttribute('playsinline','');audio.setAttribute('webkit-playsinline','');
 const button=document.createElement('button');button.id='iwsm-music';button.type='button';
 let enabled=saved.enabled!==false,pending=enabled;
 const save=()=>{try{sessionStorage.setItem(key,JSON.stringify({enabled,time:audio.currentTime||saved.time||0,at:Date.now()}))}catch{}};
 const speaker='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/>';
 function paint(){const label=enabled?(audio.paused?'Music enabled · starts on your first tap · click to mute':'Mute music'):'Play music';button.innerHTML=speaker+(enabled?'<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>':'<path d="m16 9 5 6m0-6-5 6"/>')+'</svg>';button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(enabled));button.title=label;}
 async function start(){if(!enabled)return;try{await audio.play();if(!enabled)audio.pause();pending=false;}catch{pending=enabled;}paint();}
 function restore(){if(Number.isFinite(saved.time)&&saved.time>=0){const elapsed=saved.enabled!==false&&saved.at?Math.max(0,(Date.now()-saved.at)/1000):0;audio.currentTime=audio.duration?((saved.time+elapsed)%audio.duration):saved.time+elapsed;}if(enabled)start();}
 audio.addEventListener('loadedmetadata',restore,{once:true});
 button.onclick=()=>{enabled=!enabled;pending=enabled;if(enabled)start();else audio.pause();save();paint();};
 const unlock=e=>{if(pending&&enabled&&!button.contains(e.target))start();};
 for(const event of ['pointerdown','touchstart','click','keydown'])document.addEventListener(event,unlock,{passive:true,capture:true});
 for(const event of ['pagehide','beforeunload'])addEventListener(event,save);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')save();});
 audio.addEventListener('play',paint);audio.addEventListener('pause',paint);audio.addEventListener('error',()=>{pending=false;button.setAttribute('aria-label','Music unavailable');button.title='Music unavailable';button.disabled=true;});
 document.body.append(button);paint();start();if(audio.readyState>=1)restore();else audio.load();
})();
