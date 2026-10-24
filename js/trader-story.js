(()=>{
 'use strict';
 const section=document.getElementById('trader-story');if(!section)return;
 const canvas=section.querySelector('canvas'),fallback=section.querySelector('img'),bar=section.querySelector('.trader-track span'),ctx=canvas.getContext('2d');
 const frames=JSON.parse(section.querySelector('[type="application/json"]').textContent),motion=matchMedia('(prefers-reduced-motion: reduce)');
 if(!ctx||!frames.length){section.classList.add('trader-static');return;}
 section.classList.remove('trader-static');
 const reduced=()=>false;
 const cache=new Map(),loading=new Set(),failed=new Set();let target=0,active=0,raf=0,disposed=false,visible=false;
 function release(image){if(image?.close)image.close();else if(image instanceof HTMLImageElement)image.src='';}
 function trim(){while(cache.size>6){let farthest=-1,distance=-1;for(const k of cache.keys()){if(Math.abs(k-target)>distance){distance=Math.abs(k-target);farthest=k;}}release(cache.get(farthest));cache.delete(farthest);}}
 async function load(index){if(disposed||reduced()||index<0||index>=frames.length||cache.has(index)||loading.has(index)||failed.has(index)||active>=2)return;
  loading.add(index);active++;let img;
  try{img=new Image();img.decoding='async';img.src=frames[index];await img.decode();let drawable=img;if(typeof createImageBitmap==='function'){drawable=await createImageBitmap(img,{resizeWidth:1440,resizeHeight:810,resizeQuality:'high'});img.src='';}if(disposed||reduced()){release(drawable);return;}cache.set(index,drawable);trim();schedule();}
  catch{failed.add(index);if(failed.size===frames.length){section.classList.add('trader-static');}}
  finally{loading.delete(index);active--;if(!disposed&&visible)queue();}
 }
 function queue(){if(reduced()||disposed)return;for(const i of [target,target+1,target-1,target+2,target-2]){if(active>=2)break;load(i);}}
 function draw(){if(!cache.size)return;let index=target;if(!cache.has(index))index=[...cache.keys()].reduce((a,b)=>Math.abs(a-target)<=Math.abs(b-target)?a:b);const im=cache.get(index),rect=section.querySelector('.trader-screen').getBoundingClientRect();if(!rect.width)return;const dpr=Math.min(devicePixelRatio||1,1.5),width=Math.round(rect.width*dpr),height=Math.round(rect.height*dpr);if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}ctx.clearRect(0,0,width,height);const scale=Math.min(width/im.width,height/im.height);ctx.drawImage(im,(width-im.width*scale)/2,(height-im.height*scale)/2,im.width*scale,im.height*scale);canvas.hidden=false;fallback.style.visibility='hidden';canvas.dataset.frame=String(index+1);}
 function update(){raf=0;if(disposed||reduced()||!visible)return;const rect=section.getBoundingClientRect(),top=parseFloat(getComputedStyle(section.querySelector('.trader-sticky')).top)||0,sticky=section.querySelector('.trader-sticky').getBoundingClientRect().height;const start=document.querySelector("#hero")?.offsetTop||0,end=document.querySelector("#curriculum")?.offsetTop||document.body.scrollHeight,progress=Math.max(0,Math.min(1,(scrollY-start)/Math.max(1,end-start)));section.style.visibility=scrollY>=end?"hidden":"visible";target=Math.round(progress*(frames.length-1));bar.style.transform='scaleX('+progress+')';draw();queue();}
 function schedule(){if(!raf)raf=requestAnimationFrame(update);}
 function preference(){if(reduced()){canvas.hidden=true;fallback.style.visibility='';for(const im of cache.values())release(im);cache.clear();}else schedule();}
 const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)schedule();},{rootMargin:'300px'});observer.observe(section);
 addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule,{passive:true});motion.addEventListener('change',preference);
 addEventListener('pagehide',e=>{if(e.persisted)return;disposed=true;observer.disconnect();removeEventListener('scroll',schedule);removeEventListener('resize',schedule);motion.removeEventListener('change',preference);cancelAnimationFrame(raf);for(const im of cache.values())release(im);cache.clear();});preference();
})();
