(() => {
  const section = document.getElementById('portfolio-demo');
  if (!section) return;
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const line = section.querySelector('.portfolio-line');
  const value = section.querySelector('[data-portfolio-value]');
  const gain = section.querySelector('[data-portfolio-gain]');
  const trades = [...section.querySelectorAll('[data-trade]')];
  const money = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  let visible = false, frame = 0, previous = 0, elapsed = 0;
  function paint(progress) {
    const figures = [3240, 2860, 2320].map((base, i) => Math.round(base + progress * [680, 540, 360][i]));
    const total = figures.reduce((a, b) => a + b, 0);
    value.textContent = '₹' + money.format(250000 + total);
    gain.textContent = '+₹' + money.format(total) + ' (+' + (total / 2500).toFixed(2) + '%)';
    trades.forEach((node, i) => { node.textContent = '+₹' + money.format(figures[i]); });
    line.style.strokeDashoffset = String(preference.matches ? 0 : 1 - Math.min(progress, 1));
  }
  function tick(now) {
    if (previous) elapsed += Math.min(now - previous, 100);
    previous = now;
    // Continue the illustrative session from its previous position when visible.
    const progress = elapsed / 12000;
    paint(progress);
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(frame); previous = 0;
    const running = visible && !document.hidden;
    section.classList.toggle('is-running', running);
    if (running) frame = requestAnimationFrame(tick);
  }
  preference.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }, {threshold: 0.05}).observe(section.querySelector('.portfolio-stage'));
  } else { visible = true; }
  const stage = section.querySelector('.portfolio-stage');
  const phone = section.querySelector('.portfolio-phone');
  stage.addEventListener('pointermove', event => {
    if (preference.matches || event.pointerType === 'touch') return;
    const box = stage.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - .5;
    const y = (event.clientY - box.top) / box.height - .5;
    phone.style.transform = `rotateY(${x * 28}deg) rotateX(${-y * 18}deg) rotateZ(2deg)`;
    phone.classList.add('is-interacting');
  });
  stage.addEventListener('pointerleave', () => {
    phone.style.transform = '';
    phone.classList.remove('is-interacting');
  });
  paint(0); sync();
})();
