/**
 * ============================================================================
 * IWSM PHOTO GALLERY — SQUEEZE CAROUSEL ENGINE
 * 
 * Replaces the 3D globe orbit with the high-performance Squeeze Carousel:
 * - 25 Real IWSM Photographs cropped from fixed 16:9 aspect ratio
 * - Smooth slat narrowing mathematics & column sliding geometry
 * - Hover-stretch expansion and slat click-to-expand
 * - Category filter integration & Lightbox high-resolution inspection
 * ============================================================================
 */

(function () {
  'use strict';

  const galleryItems = [
    { id: 1, originalIndex: 0, file: "gallery_05.jpg", originalFile: "05.png", title: "Live Trading Floor Sessions", category: "mentors", badge: "Mentors & Campus", description: "Inside the live market execution lab at IWSM Tower Jaipur." },
    { id: 2, originalIndex: 1, file: "gallery_06.jpg", originalFile: "06.png", title: "Technical Indicators & Setups", category: "concepts", badge: "Trading Concepts & Vision", description: "Advanced price action and volume distribution models." },
    { id: 3, originalIndex: 2, file: "gallery_1_2.jpg", originalFile: "1 (2).png", title: "Institutional Options Flow", category: "concepts", badge: "Trading Concepts & Vision", description: "Option chain analysis and institutional hedge adjustments." },
    { id: 4, originalIndex: 3, file: "gallery_1.jpg", originalFile: "1.png", title: "Foundations of Modern Trading", category: "concepts", badge: "Trading Concepts & Vision", description: "Key building blocks for equity and derivatives analysis." },
    { id: 5, originalIndex: 4, file: "gallery_10.jpg", originalFile: "10.png", title: "Candlestick Patterns in Depth", category: "concepts", badge: "Trading Concepts & Vision", description: "High-probability candlestick triggers in live market conditions." },
    { id: 6, originalIndex: 5, file: "gallery_11.jpg", originalFile: "11.png", title: "Options Greeks & Volatility", category: "concepts", badge: "Trading Concepts & Vision", description: "Delta, Gamma, Theta, and Vega management in volatile sessions." },
    { id: 7, originalIndex: 6, file: "gallery_12.jpg", originalFile: "12.png", title: "Trader Performance Analytics", category: "concepts", badge: "Trading Concepts & Vision", description: "Metrics and journaling to track consistent profitability." },
    { id: 8, originalIndex: 7, file: "gallery_13.jpg", originalFile: "13.png", title: "IWSM Jaipur Community Spirit", category: "mentors", badge: "Mentors & Campus", description: "Networking, peer strategy battles, and mutual trader growth." },
    { id: 9, originalIndex: 8, file: "gallery_2.jpg", originalFile: "2.png", title: "Smart Money Concepts (SMC)", category: "concepts", badge: "Trading Concepts & Vision", description: "Liquidity pools, order blocks, and mitigation frameworks." },
    { id: 10, originalIndex: 9, file: "gallery_3.jpg", originalFile: "3.png", title: "Inner Circle Trader (ICT) Strategies", category: "concepts", badge: "Trading Concepts & Vision", description: "Fair value gaps and session liquidity sweeps." },
    { id: 11, originalIndex: 10, file: "gallery_4_2.jpg", originalFile: "4 (2).png", title: "Risk & Money Management Rules", category: "concepts", badge: "Trading Concepts & Vision", description: "Capital preservation formulas and maximum drawdown protection." },
    { id: 12, originalIndex: 11, file: "gallery_4.jpg", originalFile: "4.png", title: "Trading Psychology & Discipline", category: "concepts", badge: "Trading Concepts & Vision", description: "Mental toughness and trading journal habit formation." },
    { id: 13, originalIndex: 12, file: "gallery_5.jpg", originalFile: "5.png", title: "Futures & Hedging Framework", category: "concepts", badge: "Trading Concepts & Vision", description: "Portfolio protection and institutional derivatives positioning." },
    { id: 14, originalIndex: 13, file: "gallery_6.jpg", originalFile: "6.png", title: "Trading Carnival Grand Arena", category: "mentors", badge: "Mentors & Campus", description: "High-resolution celebration of annual IWSM trading competitions." },
    { id: 15, originalIndex: 14, file: "gallery_7.jpg", originalFile: "7.png", title: "Multibagger Investment Strategies", category: "concepts", badge: "Trading Concepts & Vision", description: "Long-term wealth creation through fundamental and sector filters." },
    { id: 16, originalIndex: 15, file: "gallery_8.jpg", originalFile: "8.png", title: "Automated & Algorithmic Trading", category: "concepts", badge: "Trading Concepts & Vision", description: "ATS rules, backtesting rigor, and automated execution logic." },
    { id: 17, originalIndex: 16, file: "gallery_9.jpg", originalFile: "9.png", title: "Sector Rotation & Money Flow", category: "concepts", badge: "Trading Concepts & Vision", description: "Tracking smart capital shifting across market sectors." },
    { id: 18, originalIndex: 17, file: "gallery_ad_iwsm.jpg", originalFile: "AD IWSM.png", title: "Official IWSM Academy Creative", category: "ads", badge: "Banners & Ads", description: "Comprehensive overview of IWSM Jaipur trading campus and programs." },
    { id: 19, originalIndex: 18, file: "gallery_beyong_sights.jpg", originalFile: "BEYONG SIGHTS.png", title: "Beyond Sights: Macro Vision", category: "concepts", badge: "Trading Concepts & Vision", description: "Expanding trader perspective beyond retail charts to institutional order flow." },
    { id: 20, originalIndex: 19, file: "gallery_change_ur_view.jpg", originalFile: "CHANGE ur VIEW.png", title: "Change Your View: Trader Mindset", category: "concepts", badge: "Trading Concepts & Vision", description: "Transforming risk psychology from emotional impulses to disciplined strategy." },
    { id: 21, originalIndex: 20, file: "gallery_ideas_boost.jpg", originalFile: "IDEAS BOOST.png", title: "Ideas Boost: Trading Innovation", category: "concepts", badge: "Trading Concepts & Vision", description: "Developing proprietary trading edges through structured technical frameworks." },
    { id: 22, originalIndex: 21, file: "gallery_all_combined.jpg", originalFile: "all combined.png", title: "Market Curriculum & Roadmap", category: "concepts", badge: "Trading Concepts & Vision", description: "Complete roadmap from foundational market dynamics to institutional systems." },
    { id: 23, originalIndex: 22, file: "gallery_mentors.jpg", originalFile: "mentors.png", title: "IWSM Faculty Mentors Panel", category: "mentors", badge: "Mentors & Campus", description: "Meet our SEBI Research Analysts, CFA charterholders, and NISM certified faculty." },
    { id: 24, originalIndex: 23, file: "gallery_panda.jpg", originalFile: "panda.png", title: "Market Cycles & Psychology", category: "concepts", badge: "Trading Concepts & Vision", description: "Mastering bear markets, bull runs, and accumulation phases." },
    { id: 25, originalIndex: 24, file: "gallery_the_market.jpg", originalFile: "the market.png", title: "The Global Market Matrix", category: "ads", badge: "Banners & Ads", description: "Large-format flagship banner celebrating world stock market mastery." }
  ];

  // Squeeze Slat Geometry Coefficients
  const SHARES = [-0.06, 0.61, 0.3, 0.15];
  const STRETCHED = [0, 0.71, 0.4, 0.25];
  const SQUEEZED = [-0.12, 0.59, 0.28, 0.13];

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  let currentCategory = 'all';
  let activeSlides = [...galleryItems];
  let openIndex = 0;
  let hoverCol = -1;
  let autoplayTimer = null;
  let isPaused = false;
  const autoplayInterval = 5500;

  // Reduced motion preference
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initSqueezeGallery() {
    const container = document.getElementById('squeeze-gallery-container');
    if (!container) return;

    setupCategoryFilterListeners();
    setupControls();
    renderCarousel();
    startAutoplay();

    // Responsive resize listener
    window.addEventListener('resize', debounce(() => {
      renderCarousel();
    }, 150));

    // Keyboard navigation
    container.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      }
    });

    container.addEventListener('mouseenter', () => { isPaused = true; });
    container.addEventListener('mouseleave', () => {
      isPaused = false;
      hoverCol = -1;
      updateColumnWidths();
    });
  }

  function setupCategoryFilterListeners() {
    const pills = document.querySelectorAll('.gallery-filter-pill');
    pills.forEach(pill => {
      pill.addEventListener('click', () => {
        pills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');

        currentCategory = pill.getAttribute('data-filter') || 'all';
        if (currentCategory === 'all') {
          activeSlides = [...galleryItems];
        } else {
          activeSlides = galleryItems.filter(item => item.category === currentCategory);
        }

        openIndex = 0;
        renderCarousel();
      });
    });
  }

  function setupControls() {
    const prevBtn = document.getElementById('squeeze-prev-btn');
    const nextBtn = document.getElementById('squeeze-next-btn');

    if (prevBtn) prevBtn.addEventListener('click', () => step(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => step(1));
  }

  function step(by) {
    if (activeSlides.length < 2 || by === 0) return;
    const count = activeSlides.length;
    openIndex = ((openIndex + by) % count + count) % count;
    renderCarousel();
  }

  function goTo(index) {
    const count = activeSlides.length;
    openIndex = ((index % count) + count) % count;
    renderCarousel();
  }

  function startAutoplay() {
    if (prefersReducedMotion) return;
    clearInterval(autoplayTimer);
    autoplayTimer = setInterval(() => {
      if (!isPaused && activeSlides.length > 1) {
        step(1);
      }
    }, autoplayInterval);
  }

  function renderCarousel() {
    const strip = document.getElementById('squeeze-strip');
    const panelTitle = document.getElementById('squeeze-panel-title');
    const panelDesc = document.getElementById('squeeze-panel-desc');
    const panelBadge = document.getElementById('squeeze-panel-badge');
    const panelAction = document.getElementById('squeeze-panel-action');
    const counterDisplay = document.getElementById('squeeze-counter');

    if (!strip) return;

    const count = activeSlides.length;
    const slats = clamp(count - 4, 1, 3);
    const visibleCount = Math.min(count, 4 + slats);

    strip.innerHTML = '';

    // Render cards into strip
    for (let place = 0; place < visibleCount; place++) {
      const slideIndex = (openIndex + place) % count;
      const slide = activeSlides[slideIndex];
      const col = place;
      const isFront = col === 0;

      const card = document.createElement('div');
      card.className = `squeeze-card ${isFront ? 'squeeze-card-front' : 'squeeze-card-slat'}`;
      card.setAttribute('data-col', col);
      card.setAttribute('role', 'tab');
      card.setAttribute('aria-selected', isFront ? 'true' : 'false');
      card.setAttribute('aria-label', slide.title);
      card.tabIndex = isFront ? 0 : -1;

      // Inner 16:9 Image Box
      const picWrap = document.createElement('div');
      picWrap.className = 'squeeze-pic-box';

      const img = document.createElement('img');
      img.src = `assets/gallery/${slide.file}`;
      img.alt = slide.title;
      img.draggable = false;
      img.loading = isFront ? 'eager' : 'lazy';
      picWrap.appendChild(img);
      card.appendChild(picWrap);

      // Wordmark overlay on open front card
      const overlay = document.createElement('div');
      overlay.className = 'squeeze-card-overlay';
      overlay.innerHTML = `
        <span class="squeeze-overlay-badge">${slide.badge}</span>
        <span class="squeeze-overlay-title">${slide.title}</span>
      `;
      card.appendChild(overlay);

      // Slat click: step directly to card
      card.addEventListener('click', () => {
        if (col > 0) {
          step(col);
        } else {
          // If already front, open Lightbox directly
          if (window.openGalleryLightbox) {
            window.openGalleryLightbox(slide.originalIndex);
          }
        }
      });

      // Slat hover-stretch
      card.addEventListener('mouseenter', () => {
        hoverCol = col;
        updateColumnWidths();
      });

      strip.appendChild(card);
    }

    updateColumnWidths();

    // Update Bottom Details Panel
    const activeSlide = activeSlides[openIndex];
    if (activeSlide) {
      if (panelTitle) panelTitle.textContent = activeSlide.title;
      if (panelDesc) panelDesc.textContent = activeSlide.description;
      if (panelBadge) panelBadge.textContent = activeSlide.badge;

      if (counterDisplay) {
        counterDisplay.textContent = `${openIndex + 1} / ${count}`;
      }

      if (panelAction) {
        panelAction.onclick = () => {
          if (window.openGalleryLightbox) {
            window.openGalleryLightbox(activeSlide.originalIndex);
          }
        };
      }
    }
  }

  function updateColumnWidths() {
    const strip = document.getElementById('squeeze-strip');
    const container = document.getElementById('squeeze-viewport');
    if (!strip || !container) return;

    const count = activeSlides.length;
    const slats = clamp(count - 4, 1, 3);
    const containerWidth = container.clientWidth;
    const height = container.clientHeight || 580;
    // 4:5 (1080x1350) and 1:1 graphics display naturally with 0.82-0.88 aspect ratio without stretching
    const heroWidth = Math.min(Math.round(containerWidth * 0.72), Math.max(340, Math.round(height * 0.85)));

    const slatWidth = Math.max(12, Math.round(containerWidth * 0.022));
    const gap = 16;
    const slatGap = 8;

    // Remaining room to distribute across the 4 primary columns
    const totalSlatSpace = slats * slatWidth + slats * slatGap;
    const totalGaps = 3 * gap;
    const room = Math.max(0, containerWidth - heroWidth - totalSlatSpace - totalGaps);

    const shareOf = (c) => {
      if (hoverCol >= 0 && hoverCol <= 3 && !prefersReducedMotion) {
        return hoverCol === c ? STRETCHED[c] : SQUEEZED[c];
      }
      return SHARES[c] !== undefined ? SHARES[c] : 0;
    };

    const cards = strip.querySelectorAll('.squeeze-card');
    cards.forEach((card, place) => {
      const col = parseInt(card.getAttribute('data-col'), 10);
      let targetWidth = slatWidth;

      if (col === 0) {
        targetWidth = Math.max(slatWidth, heroWidth + room * shareOf(0));
      } else if (col > 0 && col < 4) {
        targetWidth = Math.max(slatWidth, room * shareOf(col));
      } else {
        targetWidth = slatWidth;
      }

      card.style.width = `${Math.round(targetWidth)}px`;
      card.style.marginLeft = place === 0 ? '0px' : col < 4 ? `${gap}px` : `${slatGap}px`;

      const picBox = card.querySelector('.squeeze-pic-box');
      if (picBox) {
        picBox.style.width = `${Math.round(targetWidth)}px`;
      }
    });
  }

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSqueezeGallery);
  } else {
    initSqueezeGallery();
  }

})();
