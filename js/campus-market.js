(() => {
 const host=document.getElementById('market-widget');
 function mount(){
  if(!host)return;
  host.replaceChildren();
  const container=document.createElement('div');container.className='tradingview-widget-container';
  const content=document.createElement('div');content.className='tradingview-widget-container__widget';container.append(content);
  const script=document.createElement('script');script.src='https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js';script.async=true;
  script.textContent=JSON.stringify({symbols:[{proName:'BSE:SENSEX',title:'SENSEX'},{proName:'BSE:RELIANCE',title:'Reliance'},{proName:'BSE:HDFCBANK',title:'HDFC Bank'},{proName:'BSE:TCS',title:'TCS'}],showSymbolLogo:true,isTransparent:true,displayMode:'adaptive',colorTheme:document.documentElement.dataset.theme==='light'?'light':'dark',locale:'en'});
  container.append(script);host.append(container);
 }
 mount();new MutationObserver(mount).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
 const gallery=document.querySelector('.campus-carousel');if(!gallery)return;
 const slides=[...gallery.querySelectorAll('.campus-slide')], count=gallery.querySelector('.campus-count');let index=0, visible=false, timer;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 function show(step){index=(index+step+slides.length)%slides.length;slides.forEach((slide,i)=>{slide.classList.toggle('is-current',i===index);slide.setAttribute('aria-hidden',String(i!==index));});count.textContent=`${index+1} / ${slides.length}`;}
 function sync(){clearInterval(timer);if(visible&&!document.hidden&&!reduced.matches&&!gallery.matches(':hover')&&!gallery.contains(document.activeElement))timer=setInterval(()=>show(1),5000);}
 gallery.querySelector('[data-campus-prev]').onclick=()=>show(-1);gallery.querySelector('[data-campus-next]').onclick=()=>show(1);
 gallery.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();show(e.key==='ArrowRight'?1:-1);}});
 ['mouseenter','mouseleave','focusin','focusout'].forEach(event=>gallery.addEventListener(event,()=>setTimeout(sync,0)));
 document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);
 if('IntersectionObserver' in window)new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();}).observe(gallery);else{visible=true;sync();}
})();
