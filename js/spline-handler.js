/**
 * ============================================================================
 * IWSM SPLINE 3D INTEGRATION HANDLER
 * Adhering strictly to SKILL/VANILLA_INTEGRATION.md & COMMON_PROBLEMS.md
 * - Overrides any auto-injected overflow: hidden on <body> (Anti-scroll hijacking)
 * - Capability & Hardware Gating (skips on low-end mobile to preserve 60fps)
 * - 8000ms Timeout Fallback with graceful degradation
 * - Pointer-events management between 3D scene and UI overlay
 * ============================================================================
 */

(function () {
  'use strict';

  // 1. Critical Safeguard against Spline's auto-injected overflow: hidden
  function enforceScrollFreedom() {
    if (document.body.style.overflow === 'hidden') {
      document.body.style.overflow = 'auto';
    }
  }
  window.addEventListener('load', enforceScrollFreedom);
  setInterval(enforceScrollFreedom, 2000);

  // 2. Hardware and Device Capability Check (COMMON_PROBLEMS.md #4)
  function shouldEnableSpline() {
    const isMobile = window.innerWidth < 768;
    const isLowEnd = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    return !isMobile && !isLowEnd && !prefersReducedMotion;
  }

  // 3. Spline Controller
  window.IWSMSplineController = {
    isCapable: shouldEnableSpline(),
    timeoutMs: 8000,
    activeUrl: null,

    loadScene: function (sceneUrl) {
      const container = document.querySelector('.spline-embed-wrapper');
      if (!container) return;

      if (!this.isCapable) {
        console.log('[IWSM Spline] Device below capability threshold or reduced motion requested; retaining Three.js WebGL procedural engine.');
        return;
      }

      this.activeUrl = sceneUrl;
      container.innerHTML = '';
      container.style.display = 'block';

      // Create spline-viewer element per Method A (SKILL/VANILLA_INTEGRATION.md)
      const viewer = document.createElement('spline-viewer');
      viewer.setAttribute('url', sceneUrl);
      viewer.setAttribute('background', 'transparent');
      viewer.setAttribute('events-target', 'global');
      viewer.style.width = '100%';
      viewer.style.height = '100%';

      container.appendChild(viewer);

      // Timeout Fallback (COMMON_PROBLEMS.md #3)
      const timeoutId = setTimeout(() => {
        if (!viewer.shadowRoot) {
          console.warn('[IWSM Spline] Spline scene timeout (8s); falling back to WebGL Procedural Scene.');
          container.style.display = 'none';
        }
      }, this.timeoutMs);

      viewer.addEventListener('load', () => {
        clearTimeout(timeoutId);
        console.log('[IWSM Spline] Spline 3D scene loaded successfully.');
        enforceScrollFreedom();
      });
    }
  };

  console.log('[IWSM Spline] Spline 3D Integration Manager initialized.');
})();
