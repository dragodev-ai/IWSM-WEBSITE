(()=>{
 'use strict';
 if(!('IntersectionObserver' in window)||!Element.prototype.animate)return;
 const reduce=matchMedia('(prefers-reduced-motion: reduce)'),active=new Set();
 const scope=document.querySelector('main');if(!scope)return;
 const selector='section h1,section h2,section h3,section h4,section .section-lead,section .eligibility-subtitle,section .hero-description,section .portfolio-eyebrow,section .badge-eyebrow,section .iwsm-subtitle-line,section .text-gold,section .section-subtitle';
 const nodes=[...scope.querySelectorAll(selector)].filter(el=>!el.closest('#trader-story,.calculator,.modal,.banner-slide')&&!el.closest('button,a,form'));
 const seen=new WeakSet();
 function reveal(el){if(seen.has(el))return;seen.add(el);if(reduce.matches||el.contains(document.activeElement))return;
  const script=el.matches('.iwsm-subtitle-line,.text-gold,.section-subtitle');
  const frames=script?[{opacity:.35,clipPath:'inset(0 100% 0 0)',transform:'translateY(8px)'},{opacity:1,clipPath:'inset(0 0 0 0)',transform:'translateY(0)'}]:[{opacity:.18,transform:'translateY(22px)'},{opacity:1,transform:'translateY(0)'}];
  const animation=el.animate(frames,{duration:script?650:520,easing:'cubic-bezier(0.23, 1, 0.32, 1)',fill:'none'});active.add(animation);animation.finished.catch(()=>{}).finally(()=>active.delete(animation));
 }
 const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;observer.unobserve(entry.target);reveal(entry.target)}},{rootMargin:'0px 0px -9% 0px',threshold:.06});
 for(const node of nodes)observer.observe(node);
 reduce.addEventListener('change',()=>{if(reduce.matches)for(const a of active)a.cancel()});
})();
