/**
 * ============================================================================
 * IWSM SURREAL 3D GOOGLE REVIEWS INTERACTIVE ENGINE
 * 
 * Features:
 * 1. 3D Gyro Cursor Reactivity: 60fps spring-damped lerp physics tilting the 
 *    entire reviews wall in 3D space toward user's cursor.
 * 2. 3D Scroll-Driven Animation: Page scroll dynamically changes camera depth,
 *    pitch, yaw, and column parallax.
 * 3. Interactive Wheel Scrubbing: Mouse wheel scrubs through student reviews.
 * 4. Specular Glass Spotlight: Dynamic cursor-following radial light reflections
 *    on frosted glass cards.
 * 5. Hover Physics: Cards raise with glowing drop-shadows and pause marquee.
 * ============================================================================
 */

(function () {
  'use strict';

  // Base 3D isometric transformation matrices
  const BASE_ROT_X = 22;     // degrees tilt
  const BASE_ROT_Y = -6;     // degrees yaw
  const BASE_ROT_Z = 14;     // degrees roll
  const BASE_TRANS_X = -30;  // px horizontal
  const BASE_TRANS_Y = 0;    // px vertical
  const BASE_TRANS_Z = -50;  // px depth

  // Current interpolated state (spring lerp)
  let currentRotX = BASE_ROT_X;
  let currentRotY = BASE_ROT_Y;
  let currentRotZ = BASE_ROT_Z;
  let currentTransX = BASE_TRANS_X;
  let currentTransY = BASE_TRANS_Y;
  let currentTransZ = BASE_TRANS_Z;

  // Target values driven by cursor and scroll
  let targetRotX = BASE_ROT_X;
  let targetRotY = BASE_ROT_Y;
  let targetRotZ = BASE_ROT_Z;
  let targetTransX = BASE_TRANS_X;
  let targetTransY = BASE_TRANS_Y;
  let targetTransZ = BASE_TRANS_Z;

  // Scroll & Wheel dynamics
  let scrollProgress = 0.5;
  let scrollVelocity = 0;
  let lastScrollY = window.scrollY || 0;
  let manualOffset = 0;
  let targetManualOffset = 0;
  let isHovered = false;
  let mouseNormX = 0;
  let mouseNormY = 0;

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function init3DReviewsEngine() {
    const stages = document.querySelectorAll('.testimonials-3d-stage');
    if (!stages || stages.length === 0) return;

    stages.forEach(stage => {
      const section = stage.closest('section') || stage.parentElement;

      // Track mouse across the entire reviews section for responsive, surreal reaction
      const targetArea = section || stage;

      targetArea.addEventListener('mouseenter', () => {
        isHovered = true;
      });

      targetArea.addEventListener('mouseleave', () => {
        isHovered = false;
        mouseNormX = 0;
        mouseNormY = 0;
        updateTargets();
      });

      targetArea.addEventListener('mousemove', (e) => {
        if (prefersReducedMotion) return;

        const rect = targetArea.getBoundingClientRect();
        mouseNormX = Math.max(-0.5, Math.min(0.5, ((e.clientX - rect.left) / rect.width) - 0.5));
        mouseNormY = Math.max(-0.5, Math.min(0.5, ((e.clientY - rect.top) / rect.height) - 0.5));

        updateTargets();
        updateCardSpotlights(e, stage);
      });

      // Interactive mouse wheel scrub over 3D stage
      stage.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaY) > 1) {
          targetManualOffset += e.deltaY * 0.4;
        }
      }, { passive: true });
    });

    // Global scroll listener for 3D perspective animation
    window.addEventListener('scroll', onPageScroll, { passive: true });
    onPageScroll();

    // Start continuous 60fps render loop
    requestAnimationFrame(renderLoop);
  }

  function updateTargets() {
    if (prefersReducedMotion) return;

    // Scroll contribution
    const scrollTiltX = (scrollProgress - 0.5) * 16;
    const scrollZoom = Math.sin(scrollProgress * Math.PI) * 40;
    const scrollParallaxY = (scrollProgress - 0.5) * -50;

    // Cursor contribution
    const cursorTiltX = mouseNormY * -26;
    const cursorTiltY = mouseNormX * 30;
    const cursorTiltZ = mouseNormX * 12;
    const cursorTransX = mouseNormX * 70;
    const cursorTransY = mouseNormY * 50;
    const cursorDepth = (1 - Math.sqrt(mouseNormX * mouseNormX + mouseNormY * mouseNormY) * 2) * 50;

    targetRotX = BASE_ROT_X + scrollTiltX + cursorTiltX;
    targetRotY = BASE_ROT_Y + cursorTiltY;
    targetRotZ = BASE_ROT_Z + cursorTiltZ;
    targetTransX = BASE_TRANS_X + cursorTransX;
    targetTransY = BASE_TRANS_Y + scrollParallaxY + cursorTransY;
    targetTransZ = BASE_TRANS_Z + scrollZoom + cursorDepth;
  }

  function onPageScroll() {
    const stage = document.querySelector('.testimonials-3d-stage');
    if (!stage) return;

    const currentScrollY = window.scrollY || window.pageYOffset;
    scrollVelocity = currentScrollY - lastScrollY;
    lastScrollY = currentScrollY;

    const rect = stage.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;

    // Calculate stage progress through viewport (0.0 to 1.0)
    const rawProgress = (windowHeight - rect.top) / (windowHeight + rect.height);
    scrollProgress = Math.max(0, Math.min(1, rawProgress));

    updateTargets();
  }

  function updateCardSpotlights(e, stage) {
    const cards = stage.querySelectorAll('.review-3d-card');
    cards.forEach(card => {
      const cardRect = card.getBoundingClientRect();
      const x = e.clientX - cardRect.left;
      const y = e.clientY - cardRect.top;
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
    });
  }

  function renderLoop() {
    const stages = document.querySelectorAll('.testimonials-3d-stage');
    
    stages.forEach(stage => {
      const grid = stage.querySelector('.testimonials-3d-grid');
      if (grid && !prefersReducedMotion) {
        // Smooth lerp damping for surreal organic feel
        const ease = isHovered ? 0.08 : 0.045;
        currentRotX += (targetRotX - currentRotX) * ease;
        currentRotY += (targetRotY - currentRotY) * ease;
        currentRotZ += (targetRotZ - currentRotZ) * ease;
        currentTransX += (targetTransX - currentTransX) * ease;
        currentTransY += (targetTransY - currentTransY) * ease;
        currentTransZ += (targetTransZ - currentTransZ) * ease;

        // Wheel scrub smooth damping
        manualOffset += (targetManualOffset - manualOffset) * 0.1;

        // Apply surreal 3D transform
        grid.style.transform = `translateX(${currentTransX.toFixed(2)}px) translateY(${currentTransY.toFixed(2)}px) translateZ(${currentTransZ.toFixed(2)}px) rotateX(${currentRotX.toFixed(2)}deg) rotateY(${currentRotY.toFixed(2)}deg) rotateZ(${currentRotZ.toFixed(2)}deg)`;

        // Scrub column tracks if user scrolled wheel over stage
        if (Math.abs(manualOffset) > 0.5) {
          const tracks = stage.querySelectorAll('.marquee-track');
          tracks.forEach((track, idx) => {
            const dir = idx % 2 === 0 ? 1 : -1;
            track.style.marginTop = `${dir * (manualOffset % 300)}px`;
          });
        }
      }
    });

    requestAnimationFrame(renderLoop);
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init3DReviewsEngine);
  } else {
    init3DReviewsEngine();
  }

})();
