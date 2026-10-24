(function () {
  'use strict';
  function setupSlider() {
    const section = document.querySelector('.homepage-banner');
    const slider = document.getElementById('banner-slider');
    const track = document.getElementById('banner-track');
    if (!section || !slider || !track) return;
    const slides = [...track.querySelectorAll('.banner-slide')];
    if (slides.length < 2) return;
    const dots = [...section.querySelectorAll('.banner-dot')];
    const counter = document.getElementById('banner-curr-num');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let index = 0, timer = null, startTime = 0;
    let dragging = false, startX = 0, startY = 0, distance = 0, moved = false, frame = null;
    const interval = 6000;

    function stopRotation() { if (timer !== null) clearInterval(timer); timer = null; }
    function rotationPaused() { const active=document.activeElement,inside=section.contains(active),touch=matchMedia('(pointer: coarse)').matches;return dragging || document.hidden || (inside && (!touch || active.matches(':focus-visible,input,textarea,select'))); }
    function updateRotation() {
      stopRotation();
      const paused = rotationPaused();
      section.dataset.autoplay = paused ? 'paused' : 'playing';
      track.setAttribute('aria-live', paused ? 'polite' : 'off');
      if (!paused) timer = setInterval(() => { if (rotationPaused()) updateRotation(); else setSlide(index + 1); }, interval);
    }
    function setSlide(next, animate = true) {
      index = (next + slides.length) % slides.length;
      track.style.transition = !animate || motion.matches ? 'none' : 'transform .45s cubic-bezier(0.77,0,0.175,1)';
      track.style.transform = 'translateX(' + (-index * 100 / slides.length) + '%)';
      slides.forEach((slide, i) => {
        const active = i === index;
        slide.classList.toggle('active', active);
        slide.setAttribute('aria-hidden', String(!active));
        slide.toggleAttribute('inert', !active);
        slide.querySelectorAll('a,button,input,select,textarea,[tabindex]').forEach(el => { el.tabIndex = active ? 0 : -1; });
      });
      dots.forEach((dot, i) => { dot.classList.toggle('active', i === index); dot.setAttribute('aria-pressed', String(i === index)); dot.removeAttribute('aria-selected'); });
      if (counter) counter.textContent = String(index + 1);
    }
    function move(next, animate = true) { setSlide(next, animate); updateRotation(); }
    document.getElementById('banner-prev-btn')?.addEventListener('click', e => { e.preventDefault(); move(index - 1); });
    document.getElementById('banner-next-btn')?.addEventListener('click', e => { e.preventDefault(); move(index + 1); });
    dots.forEach(button => button.addEventListener('click', e => { e.preventDefault(); move(Number(button.dataset.slideIndex)); }));
    slider.addEventListener('keydown', e => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); move(index + (e.key === 'ArrowRight' ? 1 : -1), false); });
    section.addEventListener('focusin', updateRotation);
    section.addEventListener('focusout', () => queueMicrotask(updateRotation));
    document.addEventListener('visibilitychange', updateRotation);
    motion.addEventListener('change', () => { setSlide(index, false); updateRotation(); });

    function point(e) { return e.touches ? e.touches[0] : e; }
    function drawDrag() {
      if (!dragging) return;
      track.style.transform = 'translateX(' + (-index * 100 / slides.length + distance / Math.max(1, slider.clientWidth) * 100 / slides.length) + '%)';
      frame = requestAnimationFrame(drawDrag);
    }
    function startDrag(e) {
      if ((e.type === 'mousedown' && e.button !== 0) || e.target.closest('button,input,select,textarea')) return;
      const p = point(e); if (!p) return;
      startTime = performance.now();
      dragging = true; moved = false; distance = 0; startX = p.clientX; startY = p.clientY;
      slider.classList.add('is-dragging'); track.style.transition = 'none'; updateRotation();
      cancelAnimationFrame(frame); frame = requestAnimationFrame(drawDrag);
    }
    function moveDrag(e) {
      if (!dragging) return;
      const p = point(e); if (!p) return;
      const dx = p.clientX - startX, dy = p.clientY - startY;
      if (e.touches && !moved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) { endDrag(true); return; }
      moved = moved || Math.abs(dx) > 8;
      distance = dx * ((index === 0 && dx > 0) || (index === slides.length - 1 && dx < 0) ? .45 : 1);
    }
    function endDrag(cancelled = false) {
      if (!dragging) return;
      dragging = false; cancelAnimationFrame(frame); slider.classList.remove('is-dragging');
      const elapsed = Math.max(1, performance.now() - startTime);
      const advance = Math.abs(distance) > 45 || (Math.abs(distance) > 14 && Math.abs(distance) / elapsed > .3);
      setSlide(index + (!cancelled && advance ? (distance < 0 ? 1 : -1) : 0));
      distance = 0; updateRotation();
    }
    slider.addEventListener('touchstart', startDrag, {passive:true});
    slider.addEventListener('touchmove', moveDrag, {passive:true});
    slider.addEventListener('touchend', () => endDrag());
    slider.addEventListener('touchcancel', () => endDrag(true));
    slider.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', moveDrag);
    window.addEventListener('mouseup', () => endDrag());
    window.addEventListener('focus', updateRotation);
    window.addEventListener('blur', () => { endDrag(true); stopRotation(); });
    slider.addEventListener('dragstart', e => e.preventDefault());
    track.addEventListener('click', e => { if (moved && e.target.closest('.banner-link')) { e.preventDefault(); e.stopPropagation(); } });
    setSlide(0, false); updateRotation();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupSlider); else setupSlider();
})();
