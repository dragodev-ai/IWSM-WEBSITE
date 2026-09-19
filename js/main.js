/**
 * ============================================================================
 * IWSM MAIN APPLICATION LOGIC
 * Master Controller:
 * 1. Navigation & Mobile Drawer
 * 2. Top-Left Light / Dark Theme Switcher
 * 3. Real-Time Indian Stock Market IST Clock & Seamless Left-to-Right Ribbon
 * 4. 3D Tilt Card Interaction
 * 5. Interactive Curriculum Filter & Highlight
 * 6. Animated Live Stats Counters
 * 7. Dedicated Bottom Video Masterclass Reel (22 Local MP4 Videos)
 * 8. IWSM Official Graphics 3D Orbital Globe Showcase (25 Assets)
 * 9. Enhanced Lightbox Controller (Orbit, Grid & Polaroids)
 * 10. Institutional Position Sizing & Risk Calculator Modal & Mobile Dock
 * 11. Lead Capture Form Submission & Feedback Modal
 * ============================================================================
 */

(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // 1. Navigation & Mobile Drawer
  // --------------------------------------------------------------------------
  const header = document.querySelector('.site-header');
  const navLinks = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('section[id]');
  const hamburgerBtn = document.querySelector('.hamburger-btn');
  const mobileDrawer = document.querySelector('.mobile-nav-drawer');
  const drawerBackdrop = document.querySelector('.drawer-backdrop');
  const drawerCloseBtn = document.querySelector('.drawer-close');
  const drawerLinks = document.querySelectorAll('.drawer-link');

  // Sticky header on scroll
  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }

    // Scrollspy for active nav links
    let currentSectionId = '';
    const scrollPos = window.scrollY + 180;

    sections.forEach((sec) => {
      const top = sec.offsetTop;
      const height = sec.offsetHeight;
      if (scrollPos >= top && scrollPos < top + height) {
        currentSectionId = sec.getAttribute('id');
      }
    });

    navLinks.forEach((link) => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${currentSectionId}`) {
        link.classList.add('active');
      }
    });
  }, { passive: true });

  // Mobile Drawer Toggle
  function openDrawer() {
    if (mobileDrawer) mobileDrawer.classList.add('open');
    if (drawerBackdrop) drawerBackdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    if (mobileDrawer) mobileDrawer.classList.remove('open');
    if (drawerBackdrop) drawerBackdrop.classList.remove('active');
    document.body.style.overflow = 'auto';
  }

  if (hamburgerBtn) hamburgerBtn.addEventListener('click', openDrawer);
  if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeDrawer);
  if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);
  drawerLinks.forEach((link) => link.addEventListener('click', closeDrawer));

  // --------------------------------------------------------------------------
  // 2. Top-Left Light / Dark Theme Switcher (Mobile & Web)
  // --------------------------------------------------------------------------
  const themeToggleBtn = document.getElementById('theme-toggle-btn');

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try {
      localStorage.setItem('iwsm_theme', theme);
    } catch (e) {}

    window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
  }

  // Priority order: Saved user preference > System preference > Dark default
  const systemPrefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const savedTheme = localStorage.getItem('iwsm_theme') || (systemPrefersLight ? 'light' : 'dark');
  applyTheme(savedTheme);

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
      applyTheme(nextTheme);
    });
  }

  // --------------------------------------------------------------------------
  // 3. Real-Time Indian Stock Market IST Clock & Seamless Left-to-Right Live Ribbon
  // --------------------------------------------------------------------------
  const sessionStatusEl = document.getElementById('market-session-status');
  const istClockEl = document.getElementById('ist-live-clock');
  const tickerScrollTrack = document.getElementById('ticker-scroll-track');

  function updateIndianMarketStatus() {
    const now = new Date();
    const timeFormatter = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    if (istClockEl) {
      istClockEl.textContent = `IST ${timeFormatter.format(now)}`;
    }

    if (sessionStatusEl) {
      const istDateStr = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
      const istDate = new Date(istDateStr);
      const day = istDate.getDay(); // 0 = Sun, 6 = Sat
      const hours = istDate.getHours();
      const minutes = istDate.getMinutes();
      const currentMinuteOfDay = hours * 60 + minutes;

      const isWeekday = day >= 1 && day <= 5;
      const marketOpen = 9 * 60 + 15;   // 09:15 AM IST
      const marketClose = 15 * 60 + 30; // 03:30 PM IST

      if (isWeekday && currentMinuteOfDay >= marketOpen && currentMinuteOfDay <= marketClose) {
        sessionStatusEl.textContent = '● NSE/BSE LIVE TRADING SESSION';
        sessionStatusEl.classList.remove('closed');
      } else if (isWeekday && currentMinuteOfDay >= 9 * 60 && currentMinuteOfDay < marketOpen) {
        sessionStatusEl.textContent = '◐ PRE-MARKET AUCTION SESSION';
        sessionStatusEl.classList.remove('closed');
      } else {
        sessionStatusEl.textContent = '○ MARKET CLOSED (POST-MARKET FEED)';
        sessionStatusEl.classList.add('closed');
      }
    }
  }

  updateIndianMarketStatus();
  setInterval(updateIndianMarketStatus, 1000);

  // Benchmark Indian Market quotes (15 assets across NSE, BSE, MCX, FOREX - Zero warning badges)
  const indianMarketQuotes = [
    { symbol: 'NIFTY 50', ex: 'NSE', price: 24964.25, change: 142.60, pct: 0.58, isUp: true },
    { symbol: 'SENSEX', ex: 'BSE', price: 81721.40, change: 480.15, pct: 0.59, isUp: true },
    { symbol: 'BANK NIFTY', ex: 'NSE', price: 51840.10, change: 315.80, pct: 0.61, isUp: true },
    { symbol: 'NIFTY IT', ex: 'NSE', price: 42650.30, change: -118.40, pct: -0.28, isUp: false },
    { symbol: 'RELIANCE', ex: 'NSE', price: 2985.60, change: 24.30, pct: 0.82, isUp: true },
    { symbol: 'HDFC BANK', ex: 'NSE', price: 1678.90, change: 12.45, pct: 0.75, isUp: true },
    { symbol: 'ICICI BANK', ex: 'NSE', price: 1234.50, change: 9.80, pct: 0.80, isUp: true },
    { symbol: 'TCS', ex: 'NSE', price: 4310.20, change: -14.60, pct: -0.34, isUp: false },
    { symbol: 'INFOSYS', ex: 'NSE', price: 1895.40, change: -8.20, pct: -0.43, isUp: false },
    { symbol: 'SBIN', ex: 'NSE', price: 842.15, change: 7.60, pct: 0.91, isUp: true },
    { symbol: 'TATA MOTORS', ex: 'NSE', price: 988.75, change: 15.30, pct: 1.57, isUp: true },
    { symbol: 'BAJAJ FINANCE', ex: 'NSE', price: 7420.00, change: 85.50, pct: 1.17, isUp: true },
    { symbol: 'MCX GOLD', ex: 'MCX', price: 75820.00, change: 240.00, pct: 0.32, isUp: true },
    { symbol: 'MCX CRUDE', ex: 'MCX', price: 6140.00, change: -42.00, pct: -0.68, isUp: false },
    { symbol: 'USD/INR', ex: 'FOREX', price: 83.74, change: 0.03, pct: 0.04, isUp: true }
  ];

  function buildTickerGroupHTML(quotes) {
    return quotes.map((q) => {
      const isUp = q.change >= 0;
      const sign = isUp ? '+' : '';
      const arrow = isUp ? '▲' : '▼';
      const chgClass = isUp ? 'bull' : 'bear';
      const formattedPrice = q.price >= 1000 
        ? q.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : q.price.toFixed(2);

      return `
        <div class="ticker-item-card" data-symbol="${q.symbol}">
          <span class="ticker-exchange-tag">${q.ex}</span>
          <span class="ticker-name">${q.symbol}</span>
          <span class="ticker-val">₹${formattedPrice}</span>
          <span class="ticker-chg-pill ${chgClass}">${arrow} ${sign}${q.change.toFixed(2)} (${sign}${q.pct.toFixed(2)}%)</span>
        </div>
      `;
    }).join('');
  }

  function initLiveMarketRibbon() {
    if (!tickerScrollTrack) return;

    // Dual-cloned groups guarantee 100% continuous left-to-right movement with zero gaps on left or right
    const groupHTML = buildTickerGroupHTML(indianMarketQuotes);
    tickerScrollTrack.innerHTML = `
      <div class="ticker-track-group group-1">${groupHTML}</div>
      <div class="ticker-track-group group-2">${groupHTML}</div>
    `;

    // Real-time micro-fluctuations (subtle Wall St / Dalal St pulse animation)
    setInterval(() => {
      const randomIndex = Math.floor(Math.random() * indianMarketQuotes.length);
      const item = indianMarketQuotes[randomIndex];
      const deltaFactor = (Math.random() * 0.004 - 0.002); // -0.2% to +0.2%
      const oldPrice = item.price;
      item.price = Math.max(1, +(item.price * (1 + deltaFactor)).toFixed(2));
      item.change = +(item.change + (item.price - oldPrice)).toFixed(2);
      item.pct = +((item.change / (item.price - item.change)) * 100).toFixed(2);
      const isUp = item.change >= 0;
      item.isUp = isUp;

      const sign = isUp ? '+' : '';
      const arrow = isUp ? '▲' : '▼';
      const chgClass = isUp ? 'bull' : 'bear';
      const flashClass = deltaFactor >= 0 ? 'tick-flash-up' : 'tick-flash-down';
      const formattedPrice = item.price >= 1000 
        ? item.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : item.price.toFixed(2);

      const matchingElements = tickerScrollTrack.querySelectorAll(`.ticker-item-card[data-symbol="${item.symbol}"]`);
      matchingElements.forEach((el) => {
        const valEl = el.querySelector('.ticker-val');
        const chgEl = el.querySelector('.ticker-chg-pill');

        if (valEl) valEl.textContent = `₹${formattedPrice}`;
        if (chgEl) {
          chgEl.className = `ticker-chg-pill ${chgClass}`;
          chgEl.textContent = `${arrow} ${sign}${item.change.toFixed(2)} (${sign}${item.pct.toFixed(2)}%)`;
        }

        el.classList.remove('tick-flash-up', 'tick-flash-down');
        void el.offsetWidth;
        el.classList.add(flashClass);
        setTimeout(() => el.classList.remove(flashClass), 1000);
      });
    }, 2400);
  }

  initLiveMarketRibbon();

  // --------------------------------------------------------------------------
  // 4. 3D Tilt Card Interaction
  // --------------------------------------------------------------------------
  const tiltCards = document.querySelectorAll('.gamma-vip-card');
  tiltCards.forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      const rotateX = (-y / rect.height) * 8;
      const rotateY = (x / rect.width) * 8;
      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0)';
    });
  });

  // --------------------------------------------------------------------------
  // 5. Interactive Curriculum Filter & Highlight
  // --------------------------------------------------------------------------
  const curriculumBtns = document.querySelectorAll('.curriculum-tag-btn');
  const moduleCards = document.querySelectorAll('.module-card');

  curriculumBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-target');

      curriculumBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      moduleCards.forEach((card) => card.classList.remove('highlighted'));

      if (targetId && targetId !== 'all') {
        const matchingCard = document.getElementById(targetId);
        if (matchingCard) {
          matchingCard.classList.add('highlighted');
          matchingCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // 6. Animated Live Stats Counters
  // --------------------------------------------------------------------------
  const statNumbers = document.querySelectorAll('.stat-number');
  let statsTriggered = false;

  const statsObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && !statsTriggered) {
        statsTriggered = true;
        statNumbers.forEach((el) => {
          const targetValue = parseInt(el.getAttribute('data-target') || '0', 10);
          const prefix = el.getAttribute('data-prefix') || '';
          const suffix = el.getAttribute('data-suffix') || '';
          let count = 0;
          const duration = 1800;
          const stepTime = 25;
          const steps = duration / stepTime;
          const increment = targetValue / steps;

          const timer = setInterval(() => {
            count += increment;
            if (count >= targetValue) {
              el.textContent = `${prefix}${targetValue}${suffix}`;
              clearInterval(timer);
            } else {
              el.textContent = `${prefix}${Math.floor(count)}${suffix}`;
            }
          }, stepTime);
        });
      }
    });
  }, { threshold: 0.3 });

  const statsSection = document.querySelector('.stats-section');
  if (statsSection) statsObserver.observe(statsSection);

  // --------------------------------------------------------------------------
  // 7. Dedicated Bottom Video Masterclass Reel (22 Local MP4 Videos)
  // --------------------------------------------------------------------------
  const videoData = [
    { id: 1, file: 'iwsm.official-20260918-0001.mp4', title: 'IWSM Live Market Trading Room & Setup Guidance', category: 'floor', tag: 'Trading Floor' },
    { id: 2, file: 'iwsm.official-20260918-0002.mp4', title: 'Student Journey & Institutional Options Framework', category: 'reviews', tag: 'Student Story' },
    { id: 3, file: 'iwsm.official-20260918-0003.mp4', title: 'Technical Analysis Breakdown & Market Structure', category: 'lessons', tag: 'Masterclass' },
    { id: 4, file: 'iwsm.official-20260918-0004.mp4', title: 'Trading Carnival: Live Strategy Battles & Mentors', category: 'floor', tag: 'Carnival' },
    { id: 5, file: 'iwsm.official-20260918-0005.mp4', title: 'From Losses to Consistency: Student Review', category: 'reviews', tag: 'Student Story' },
    { id: 6, file: 'iwsm.official-20260918-0006.mp4', title: 'SMC & Liquidity Concepts Explained by Faculty', category: 'lessons', tag: 'Masterclass' },
    { id: 7, file: 'iwsm.official-20260918-0007.mp4', title: 'Classroom Practical Lab: Live Order Execution', category: 'floor', tag: 'Trading Floor' },
    { id: 8, file: 'iwsm.official-20260918-0008.mp4', title: 'Options Buying vs Selling: Institutional Logic', category: 'lessons', tag: 'Masterclass' },
    { id: 9, file: 'iwsm.official-20260918-0009.mp4', title: 'Risk Management & Trading Journal Discipline', category: 'lessons', tag: 'Masterclass' },
    { id: 10, file: 'iwsm.official-20260918-0010.mp4', title: 'Jaipur Trading Community Event & Insights', category: 'floor', tag: 'Community' },
    { id: 11, file: 'iwsm.official-20260918-0011.mp4', title: 'Homemaker to Confident MCX Commodity Trader', category: 'reviews', tag: 'Student Story' },
    { id: 12, file: 'iwsm.official-20260918-0012.mp4', title: 'Gamma 100-Day Program: Mentorship Experience', category: 'reviews', tag: 'Student Story' },
    { id: 13, file: 'iwsm.official-20260918-0013.mp4', title: 'Breakout Strategies & Volume Confirmation', category: 'lessons', tag: 'Masterclass' },
    { id: 14, file: 'iwsm.official-20260918-0014.mp4', title: 'Live Candlestick Psychology & False Moves', category: 'lessons', tag: 'Masterclass' },
    { id: 15, file: 'iwsm.official-20260918-0015.mp4', title: 'SEBI RA Mentor Practical Session in Jaipur HQ', category: 'floor', tag: 'Trading Floor' },
    { id: 16, file: 'iwsm.official-20260918-0016.mp4', title: 'Student Q&A: Overcoming Fear of Losses', category: 'reviews', tag: 'Psychology' },
    { id: 17, file: 'iwsm.official-20260918-0017.mp4', title: 'Annual Trading Carnival Trophy & Celebrations', category: 'floor', tag: 'Carnival' },
    { id: 18, file: 'iwsm.official-20260918-0018.mp4', title: 'Why Multi-Timeframe Analysis Works', category: 'lessons', tag: 'Masterclass' },
    { id: 19, file: 'iwsm.official-20260918-0019.mp4', title: 'Managing ₹85 Crore Fund: Mentor Principles', category: 'reviews', tag: 'Case Study' },
    { id: 20, file: 'iwsm.official-20260918-0020.mp4', title: 'Introductory Advice for Complete Beginners', category: 'lessons', tag: 'Beginner' },
    { id: 21, file: 'iwsm.official-20260918-0021.mp4', title: 'Sector Rotation & Institutional Money Flow', category: 'lessons', tag: 'Masterclass' },
    { id: 22, file: 'iwsm.official-20260918-0022.mp4', title: 'IWSM Vision: Professionalizing Stock Market Education', category: 'floor', tag: 'IWSM Vision' }
  ];

  const videosGrid = document.querySelector('.videos-grid-container');
  const videoFilterPills = document.querySelectorAll('.video-filter-pill');
  const videoModal = document.querySelector('.video-modal-backdrop');
  const videoModalScreen = document.querySelector('#modal-video-player');
  const videoModalTitle = document.querySelector('.video-modal-title');
  const videoModalClose = document.querySelector('.video-modal-close');
  const videoPrevBtn = document.querySelector('#video-prev-btn');
  const videoNextBtn = document.querySelector('#video-next-btn');

  let currentVideoIndex = 0;
  let activeVideoList = [...videoData];

  function renderVideoGrid(items) {
    if (!videosGrid) return;
    videosGrid.innerHTML = '';

    items.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'video-card-item glass-panel';
      card.setAttribute('data-index', index);

      card.innerHTML = `
        <video preload="metadata" muted playsinline poster="assets/assets/02_iwsm-classroom-and-practical-learning-environment.jpg">
          <source src="assets/VIDEOS/${item.file}#t=0.5" type="video/mp4">
        </video>
        <div class="video-card-overlay">
          <span class="video-badge-tag">${item.tag}</span>
          <div class="video-play-trigger">
            <svg width="22" height="22" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </div>
          <div class="video-card-info">
            <h4>${item.title}</h4>
            <p>IWSM Official • Watch Reel</p>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        openVideoModal(index);
      });

      videosGrid.appendChild(card);
    });
  }

  videoFilterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      videoFilterPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');

      const cat = pill.getAttribute('data-category');
      if (cat === 'all') {
        activeVideoList = [...videoData];
      } else {
        activeVideoList = videoData.filter((v) => v.category === cat);
      }
      renderVideoGrid(activeVideoList);
    });
  });

  function openVideoModal(index) {
    if (!videoModal || !videoModalScreen) return;
    currentVideoIndex = index;
    const item = activeVideoList[currentVideoIndex];
    if (!item) return;

    videoModalTitle.textContent = item.title;
    videoModalScreen.src = `assets/VIDEOS/${item.file}`;
    videoModal.classList.add('active');
    videoModalScreen.play().catch(() => {});
  }

  function closeVideoModal() {
    if (!videoModal || !videoModalScreen) return;
    videoModalScreen.pause();
    videoModalScreen.src = '';
    videoModal.classList.remove('active');
  }

  if (videoModalClose) videoModalClose.addEventListener('click', closeVideoModal);
  if (videoModal) {
    videoModal.addEventListener('click', (e) => {
      if (e.target === videoModal) closeVideoModal();
    });
  }

  if (videoPrevBtn) {
    videoPrevBtn.addEventListener('click', () => {
      currentVideoIndex = (currentVideoIndex - 1 + activeVideoList.length) % activeVideoList.length;
      openVideoModal(currentVideoIndex);
    });
  }

  if (videoNextBtn) {
    videoNextBtn.addEventListener('click', () => {
      currentVideoIndex = (currentVideoIndex + 1) % activeVideoList.length;
      openVideoModal(currentVideoIndex);
    });
  }

  renderVideoGrid(activeVideoList);

  // --------------------------------------------------------------------------
  // 8. IWSM Official Graphics 3D Orbital Globe Showcase (25 Assets)
  // --------------------------------------------------------------------------
  const galleryData = [
    { id: 1, original_file: "05.png", web_file: "gallery_05.jpg", title: "Live Trading Floor Sessions", category: "mentors", description: "Inside the live market execution lab at IWSM Tower Jaipur." },
    { id: 2, original_file: "06.png", web_file: "gallery_06.jpg", title: "Technical Indicators & Setups", category: "concepts", description: "Advanced price action and volume distribution models." },
    { id: 3, original_file: "1 (2).png", web_file: "gallery_1_2.jpg", title: "Institutional Options Flow", category: "concepts", description: "Option chain analysis and institutional hedge adjustments." },
    { id: 4, original_file: "1.png", web_file: "gallery_1.jpg", title: "Foundations of Modern Trading", category: "concepts", description: "Key building blocks for equity and derivatives analysis." },
    { id: 5, original_file: "10.png", web_file: "gallery_10.jpg", title: "Candlestick Patterns in Depth", category: "concepts", description: "High-probability candlestick triggers in live market conditions." },
    { id: 6, original_file: "11.png", web_file: "gallery_11.jpg", title: "Options Greeks & Volatility", category: "concepts", description: "Delta, Gamma, Theta, and Vega management in volatile sessions." },
    { id: 7, original_file: "12.png", web_file: "gallery_12.jpg", title: "Trader Performance Analytics", category: "concepts", description: "Metrics and journaling to track consistent profitability." },
    { id: 8, original_file: "13.png", web_file: "gallery_13.jpg", title: "IWSM Jaipur Community Spirit", category: "mentors", description: "Networking, peer strategy battles, and mutual trader growth." },
    { id: 9, original_file: "2.png", web_file: "gallery_2.jpg", title: "Smart Money Concepts (SMC)", category: "concepts", description: "Liquidity pools, order blocks, and mitigation frameworks." },
    { id: 10, original_file: "3.png", web_file: "gallery_3.jpg", title: "Inner Circle Trader (ICT) Strategies", category: "concepts", description: "Fair value gaps and session liquidity sweeps." },
    { id: 11, original_file: "4 (2).png", web_file: "gallery_4_2.jpg", title: "Risk & Money Management Rules", category: "concepts", description: "Capital preservation formulas and maximum drawdown protection." },
    { id: 12, original_file: "4.png", web_file: "gallery_4.jpg", title: "Trading Psychology & Discipline", category: "concepts", description: "Mental toughness and trading journal habit formation." },
    { id: 13, original_file: "5.png", web_file: "gallery_5.jpg", title: "Futures & Hedging Framework", category: "concepts", description: "Portfolio protection and institutional derivatives positioning." },
    { id: 14, original_file: "6.png", web_file: "gallery_6.jpg", title: "Trading Carnival Grand Arena", category: "mentors", description: "High-resolution celebration of annual IWSM trading competitions." },
    { id: 15, original_file: "7.png", web_file: "gallery_7.jpg", title: "Multibagger Investment Strategies", category: "concepts", description: "Long-term wealth creation through fundamental and sector filters." },
    { id: 16, original_file: "8.png", web_file: "gallery_8.jpg", title: "Automated & Algorithmic Trading", category: "concepts", description: "ATS rules, backtesting rigor, and automated execution logic." },
    { id: 17, original_file: "9.png", web_file: "gallery_9.jpg", title: "Sector Rotation & Money Flow", category: "concepts", description: "Tracking smart capital shifting across market sectors." },
    { id: 18, original_file: "AD IWSM.png", web_file: "gallery_ad_iwsm.jpg", title: "Official IWSM Academy Creative", category: "ads", description: "Comprehensive overview of IWSM Jaipur trading campus and programs." },
    { id: 19, original_file: "BEYONG SIGHTS.png", web_file: "gallery_beyong_sights.jpg", title: "Beyond Sights: Macro Vision", category: "concepts", description: "Expanding trader perspective beyond retail charts to institutional order flow." },
    { id: 20, original_file: "CHANGE ur VIEW.png", web_file: "gallery_change_ur_view.jpg", title: "Change Your View: Trader Mindset", category: "concepts", description: "Transforming risk psychology from emotional impulses to disciplined strategy." },
    { id: 21, original_file: "IDEAS BOOST.png", web_file: "gallery_ideas_boost.jpg", title: "Ideas Boost: Trading Innovation", category: "concepts", description: "Developing proprietary trading edges through structured technical frameworks." },
    { id: 22, original_file: "all combined.png", web_file: "gallery_all_combined.jpg", title: "Market Curriculum & Roadmap", category: "concepts", description: "Complete roadmap from foundational market dynamics to institutional systems." },
    { id: 23, original_file: "mentors.png", web_file: "gallery_mentors.jpg", title: "IWSM Faculty Mentors Panel", category: "mentors", description: "Meet our SEBI Research Analysts, CFA charterholders, and NISM certified faculty." },
    { id: 24, original_file: "panda.png", web_file: "gallery_panda.jpg", title: "Market Cycles & Psychology", category: "concepts", description: "Mastering bear markets, bull runs, and accumulation phases." },
    { id: 25, original_file: "the market.png", web_file: "gallery_the_market.jpg", title: "The Global Market Matrix", category: "ads", description: "Large-format flagship banner celebrating world stock market mastery." }
  ];

  const orbitViewport = document.getElementById('orbit-viewport');
  const orbitSphereCore = document.getElementById('orbit-sphere-core');
  const galleryGrid = document.getElementById('gallery-grid');
  const galleryFilterPills = document.querySelectorAll('.gallery-filter-pill');
  const btnModeGlobe = document.getElementById('btn-mode-globe');
  const btnModeGrid = document.getElementById('btn-mode-grid');

  const orbitRotateLeftBtn = document.getElementById('orbit-rotate-left');
  const orbitRotateRightBtn = document.getElementById('orbit-rotate-right');
  const orbitAutoToggleBtn = document.getElementById('orbit-auto-toggle');
  const orbitResetBtn = document.getElementById('orbit-reset-btn');

  const catLabels = {
    ads: 'Banner & Ad',
    concepts: 'Market Concept',
    mentors: 'Mentor & Campus'
  };

  // Orbital Globe State
  let rotX = -5;
  let rotY = 0;
  let scale = 1;
  let velX = 0;
  let velY = 0;
  let isDragging = false;
  let isCardHovered = false;
  let autoSpin = true;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let animFrameId = null;

  function getSphereRadius() {
    return window.innerWidth < 768 ? 250 : 350;
  }

  // Render cards onto 3D Spherical Surface using Fibonacci Golden Spiral
  function buildOrbitalGlobe() {
    if (!orbitSphereCore) return;
    orbitSphereCore.innerHTML = '';

    const N = galleryData.length; // 25
    const R = getSphereRadius();

    galleryData.forEach((item, i) => {
      // Spherical coordinates calculation
      const phi = Math.acos(1 - (2 * (i + 0.5)) / N); // 0 to PI
      const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5); // Golden angle step

      const x = Math.round(R * Math.sin(phi) * Math.cos(theta));
      const y = Math.round(-R * Math.cos(phi));
      const z = Math.round(R * Math.sin(phi) * Math.sin(theta));

      const degY = Math.round((-theta * 180 / Math.PI) - 90);
      const degX = Math.round(((Math.PI / 2) - phi) * 180 / Math.PI);

      const card = document.createElement('div');
      card.className = 'orbit-card';
      card.setAttribute('data-category', item.category);
      card.setAttribute('data-index', i);

      // Card initial position and orientation in 3D space
      card.style.transform = `translate3d(${x}px, ${y}px, ${z}px) rotateY(${degY}deg) rotateX(${degX}deg)`;

      card.innerHTML = `
        <img src="assets/gallery/${item.web_file}" alt="${item.title}" loading="lazy">
        <div class="orbit-card-overlay">
          <span class="orbit-card-badge">${catLabels[item.category] || 'IWSM Creative'}</span>
          <div class="orbit-card-title">${item.title}</div>
        </div>
      `;

      // Hover pause & emphasis
      card.addEventListener('mouseenter', () => { isCardHovered = true; });
      card.addEventListener('mouseleave', () => { isCardHovered = false; });

      // Click to open Lightbox
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        openGalleryLightbox(i);
      });

      orbitSphereCore.appendChild(card);
    });

    updateSphereTransform();
  }

  function updateSphereTransform() {
    if (!orbitSphereCore) return;
    orbitSphereCore.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${scale})`;
  }

  // Animation & Physics Loop
  function orbitLoop() {
    if (!isDragging) {
      // Inertia throw damping
      if (Math.abs(velX) > 0.02) {
        rotY += velX;
        velX *= 0.93;
      }
      if (Math.abs(velY) > 0.02) {
        rotX += velY;
        rotX = Math.max(-60, Math.min(60, rotX));
        velY *= 0.93;
      }

      // Gentle continuous auto-spin when idle
      if (autoSpin && !isCardHovered && Math.abs(velX) < 0.05) {
        rotY += 0.22;
      }

      updateSphereTransform();
    }

    animFrameId = requestAnimationFrame(orbitLoop);
  }

  // Pointer Drag & Touch Handling
  if (orbitViewport) {
    orbitViewport.addEventListener('pointerdown', (e) => {
      // Only drag on left click or touch
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      isDragging = true;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      velX = 0;
      velY = 0;
      orbitViewport.setPointerCapture(e.pointerId);
    });

    orbitViewport.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;

      rotY += dx * 0.35;
      rotX -= dy * 0.35;
      rotX = Math.max(-60, Math.min(60, rotX)); // Keep sphere upright

      velX = dx * 0.32;
      velY = -dy * 0.32;

      lastPointerX = e.clientX;
      lastPointerY = e.clientY;

      updateSphereTransform();
    });

    const stopDragging = (e) => {
      if (!isDragging) return;
      isDragging = false;
      try {
        orbitViewport.releasePointerCapture(e.pointerId);
      } catch (err) {}
    };

    orbitViewport.addEventListener('pointerup', stopDragging);
    orbitViewport.addEventListener('pointercancel', stopDragging);

    // Mouse wheel to zoom & scroll orbit
    orbitViewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      scale += -e.deltaY * 0.0012;
      scale = Math.max(0.65, Math.min(1.45, scale));
      updateSphereTransform();
    }, { passive: false });
  }

  // Orbit Control Buttons
  if (orbitRotateLeftBtn) {
    orbitRotateLeftBtn.addEventListener('click', () => {
      rotY -= 35;
      updateSphereTransform();
    });
  }

  if (orbitRotateRightBtn) {
    orbitRotateRightBtn.addEventListener('click', () => {
      rotY += 35;
      updateSphereTransform();
    });
  }

  if (orbitAutoToggleBtn) {
    orbitAutoToggleBtn.addEventListener('click', () => {
      autoSpin = !autoSpin;
      orbitAutoToggleBtn.textContent = autoSpin ? '⏸ Pause' : '▶ Auto-Spin';
    });
  }

  if (orbitResetBtn) {
    orbitResetBtn.addEventListener('click', () => {
      rotX = -5;
      rotY = 0;
      scale = 1;
      velX = 0;
      velY = 0;
      updateSphereTransform();
    });
  }

  // Alternative Flat Grid Renderer
  function renderFlatGrid(items) {
    if (!galleryGrid) return;
    galleryGrid.innerHTML = '';

    items.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'gallery-card glass-panel';
      card.setAttribute('data-index', index);

      card.innerHTML = `
        <img src="assets/gallery/${item.web_file}" alt="${item.title}" loading="lazy">
        <div class="gallery-card-overlay">
          <span class="gallery-card-badge">${catLabels[item.category] || 'IWSM Creative'}</span>
          <h4 class="gallery-card-title">${item.title}</h4>
          <div class="gallery-card-meta">
            <span>${item.description.substring(0, 50)}...</span>
            <span class="gallery-view-btn">View <span>↗</span></span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        const fullIndex = galleryData.findIndex(g => g.id === item.id);
        openGalleryLightbox(fullIndex !== -1 ? fullIndex : index);
      });

      galleryGrid.appendChild(card);
    });
  }

  // Filter Bar Handler (if orbit or flat grid exists)
  if (orbitSphereCore || galleryGrid) {
    galleryFilterPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        galleryFilterPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');

        const filter = pill.getAttribute('data-filter');

        const orbitCards = document.querySelectorAll('.orbit-card');
        orbitCards.forEach((card) => {
          const cat = card.getAttribute('data-category');
          if (filter === 'all' || cat === filter) {
            card.classList.remove('dimmed');
          } else {
            card.classList.add('dimmed');
          }
        });

        const filteredGridList = filter === 'all' ? galleryData : galleryData.filter(g => g.category === filter);
        renderFlatGrid(filteredGridList);
      });
    });

    if (btnModeGlobe && btnModeGrid) {
      btnModeGlobe.addEventListener('click', () => {
        btnModeGlobe.classList.add('active');
        btnModeGrid.classList.remove('active');
        if (orbitViewport) orbitViewport.style.display = 'block';
        if (galleryGrid) galleryGrid.style.display = 'none';
      });

      btnModeGrid.addEventListener('click', () => {
        btnModeGrid.classList.add('active');
        btnModeGlobe.classList.remove('active');
        if (orbitViewport) orbitViewport.style.display = 'none';
        if (galleryGrid) galleryGrid.style.display = 'grid';
      });
    }

    window.addEventListener('resize', () => {
      buildOrbitalGlobe();
    });

    buildOrbitalGlobe();
    renderFlatGrid(galleryData);
    animFrameId = requestAnimationFrame(orbitLoop);
  }

  // --------------------------------------------------------------------------
  // 9. Enhanced Lightbox Controller
  // --------------------------------------------------------------------------
  const imageLightbox = document.querySelector('.image-lightbox-modal');
  const lightboxImg = document.querySelector('#lightbox-img');
  const lightboxCaption = document.querySelector('#lightbox-caption');
  const lightboxDesc = document.querySelector('#lightbox-desc');
  const lightboxRawLink = document.querySelector('#lightbox-raw-link');
  const lightboxClose = document.querySelector('.lightbox-close');
  const lightboxPrev = document.querySelector('#lightbox-prev');
  const lightboxNext = document.querySelector('#lightbox-next');
  let currentLightboxIndex = 0;

  function openGalleryLightbox(index) {
    if (!imageLightbox || !lightboxImg) return;
    currentLightboxIndex = index;
    const item = galleryData[currentLightboxIndex];
    if (!item) return;

    lightboxImg.src = `assets/gallery/${item.web_file}`;
    if (lightboxCaption) lightboxCaption.textContent = item.title;
    if (lightboxDesc) lightboxDesc.textContent = item.description;
    if (lightboxRawLink) {
      lightboxRawLink.href = `BANNERS/Graphics/${item.original_file}`;
      lightboxRawLink.style.display = 'inline-flex';
    }

    imageLightbox.classList.add('active');
  }

  // Expose globally for Three.js 3D orbit engine
  window.openGalleryLightbox = openGalleryLightbox;

  function closeLightbox() {
    if (imageLightbox) {
      imageLightbox.classList.remove('active');
    }
  }

  if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
  if (imageLightbox) {
    imageLightbox.addEventListener('click', (e) => {
      if (e.target === imageLightbox) closeLightbox();
    });
  }

  if (lightboxPrev) {
    lightboxPrev.addEventListener('click', (e) => {
      e.stopPropagation();
      currentLightboxIndex = (currentLightboxIndex - 1 + galleryData.length) % galleryData.length;
      openGalleryLightbox(currentLightboxIndex);
    });
  }

  if (lightboxNext) {
    lightboxNext.addEventListener('click', (e) => {
      e.stopPropagation();
      currentLightboxIndex = (currentLightboxIndex + 1) % galleryData.length;
      openGalleryLightbox(currentLightboxIndex);
    });
  }

  // Keyboard navigation for Lightbox
  window.addEventListener('keydown', (e) => {
    if (!imageLightbox || !imageLightbox.classList.contains('active')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') {
      currentLightboxIndex = (currentLightboxIndex - 1 + galleryData.length) % galleryData.length;
      openGalleryLightbox(currentLightboxIndex);
    }
    if (e.key === 'ArrowRight') {
      currentLightboxIndex = (currentLightboxIndex + 1) % galleryData.length;
      openGalleryLightbox(currentLightboxIndex);
    }
  });

  // Trading Carnival Polaroid Lightbox hookup
  const polaroids = document.querySelectorAll('.polaroid-card');
  polaroids.forEach((card) => {
    card.addEventListener('click', () => {
      const img = card.querySelector('img');
      const caption = card.querySelector('.polaroid-caption');
      if (imageLightbox && img && lightboxImg) {
        lightboxImg.src = img.src;
        if (lightboxCaption) lightboxCaption.textContent = caption ? caption.textContent : 'Trading Carnival';
        if (lightboxDesc) lightboxDesc.textContent = 'IWSM Jaipur Practical Learning & Trading Carnival Community';
        if (lightboxRawLink) lightboxRawLink.style.display = 'none';
        imageLightbox.classList.add('active');
      }
    });
  });

  // --------------------------------------------------------------------------
  // 10. Institutional Position Sizing & Risk Calculator Modal & Mobile Dock
  // --------------------------------------------------------------------------
  const riskCalcModal = document.getElementById('risk-calc-modal');
  const openRiskCalcBtn = document.getElementById('open-risk-calc-btn');
  const mobileCalcTrigger = document.getElementById('mobile-calc-trigger');
  const closeRiskCalcBtn = document.getElementById('close-risk-calc-btn');

  // Calculator Form Elements
  const calcCapitalInput = document.getElementById('calc-capital');
  const calcRiskPctInput = document.getElementById('calc-risk-pct');
  const calcRiskPctVal = document.getElementById('calc-risk-pct-val');
  const calcInstrumentSelect = document.getElementById('calc-instrument');
  const calcEntryInput = document.getElementById('calc-entry');
  const calcSlInput = document.getElementById('calc-sl');
  const calcCopyBtn = document.getElementById('calc-copy-btn');

  // Calculator Result Displays
  const resMaxRisk = document.getElementById('res-max-risk');
  const resRiskPctSub = document.getElementById('res-risk-pct-sub');
  const resQuantity = document.getElementById('res-quantity');
  const resLots = document.getElementById('res-lots');
  const resPtRisk = document.getElementById('res-pt-risk');
  const resTradeVal = document.getElementById('res-trade-val');
  const resTarget15 = document.getElementById('res-target-15');
  const resProfit15 = document.getElementById('res-profit-15');
  const resTarget20 = document.getElementById('res-target-20');
  const resProfit20 = document.getElementById('res-profit-20');
  const resTarget30 = document.getElementById('res-target-30');
  const resProfit30 = document.getElementById('res-profit-30');

  const instrumentLotSizes = {
    nifty: 25,
    banknifty: 15,
    finnifty: 25,
    midcpnifty: 50,
    crudeoil: 100,
    equity: 1
  };

  const instrumentNames = {
    nifty: 'NIFTY 50',
    banknifty: 'BANK NIFTY',
    finnifty: 'FINNIFTY',
    midcpnifty: 'MIDCPNIFTY',
    crudeoil: 'MCX CRUDE OIL',
    equity: 'EQUITY INTRADAY/SWING'
  };

  function openRiskCalc() {
    if (riskCalcModal) {
      riskCalcModal.classList.add('active');
      riskCalcModal.setAttribute('aria-hidden', 'false');
      calculatePositionSizing();
    }
  }

  function closeRiskCalc() {
    if (riskCalcModal) {
      riskCalcModal.classList.remove('active');
      riskCalcModal.setAttribute('aria-hidden', 'true');
    }
  }

  if (openRiskCalcBtn) openRiskCalcBtn.addEventListener('click', openRiskCalc);
  if (mobileCalcTrigger) mobileCalcTrigger.addEventListener('click', openRiskCalc);
  if (closeRiskCalcBtn) closeRiskCalcBtn.addEventListener('click', closeRiskCalc);
  if (riskCalcModal) {
    riskCalcModal.addEventListener('click', (e) => {
      if (e.target === riskCalcModal) closeRiskCalc();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && riskCalcModal && riskCalcModal.classList.contains('active')) {
      closeRiskCalc();
    }
  });

  // Calculation Engine
  function calculatePositionSizing() {
    if (!calcCapitalInput || !calcRiskPctInput || !calcEntryInput || !calcSlInput) return;

    const capital = Math.max(1000, parseFloat(calcCapitalInput.value) || 100000);
    const riskPct = parseFloat(calcRiskPctInput.value) || 2.0;
    if (calcRiskPctVal) calcRiskPctVal.textContent = `${riskPct.toFixed(1)}%`;

    const instrumentKey = calcInstrumentSelect ? calcInstrumentSelect.value : 'nifty';
    const lotSize = instrumentLotSizes[instrumentKey] || 1;

    const entry = parseFloat(calcEntryInput.value) || 23350;
    const sl = parseFloat(calcSlInput.value) || 23300;

    const pointRisk = Math.max(0.1, Math.abs(entry - sl));
    const isLong = entry >= sl;

    // Maximum Rupee Risk Allowed
    const maxRupeeRisk = (capital * riskPct) / 100;

    // Quantity calculations
    const rawQuantity = Math.floor(maxRupeeRisk / pointRisk);
    let allowedQty = 0;
    let lotsCount = 0;

    if (instrumentKey === 'equity') {
      allowedQty = Math.max(1, rawQuantity);
      if (resLots) resLots.textContent = 'Cash Equity (Direct Shares)';
    } else {
      lotsCount = Math.floor(rawQuantity / lotSize);
      if (lotsCount < 1) lotsCount = 1; // Minimum 1 lot
      allowedQty = lotsCount * lotSize;
      if (resLots) resLots.textContent = `${lotsCount} Lot${lotsCount > 1 ? 's' : ''} (${lotSize} / lot)`;
    }

    const actualRupeeRisk = allowedQty * pointRisk;
    const totalTradeValue = allowedQty * entry;

    // Targets based on Risk:Reward Ratios
    const target15Price = isLong ? (entry + pointRisk * 1.5) : (entry - pointRisk * 1.5);
    const target20Price = isLong ? (entry + pointRisk * 2.0) : (entry - pointRisk * 2.0);
    const target30Price = isLong ? (entry + pointRisk * 3.0) : (entry - pointRisk * 3.0);

    const profit15 = actualRupeeRisk * 1.5;
    const profit20 = actualRupeeRisk * 2.0;
    const profit30 = actualRupeeRisk * 3.0;

    // DOM Updates
    if (resMaxRisk) resMaxRisk.textContent = `₹${maxRupeeRisk.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    if (resRiskPctSub) resRiskPctSub.textContent = `${riskPct.toFixed(1)}% of ₹${capital.toLocaleString('en-IN')} capital`;
    if (resQuantity) resQuantity.textContent = `${allowedQty.toLocaleString('en-IN')} Qty`;
    if (resPtRisk) resPtRisk.textContent = `${pointRisk.toFixed(2)} pts`;
    if (resTradeVal) resTradeVal.textContent = `Value: ₹${totalTradeValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

    const sign = isLong ? '+' : '-';
    if (resTarget15) resTarget15.textContent = `₹${target15Price.toFixed(2)} (${sign}${(pointRisk * 1.5).toFixed(2)} pts)`;
    if (resProfit15) resProfit15.textContent = `+₹${profit15.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

    if (resTarget20) resTarget20.textContent = `₹${target20Price.toFixed(2)} (${sign}${(pointRisk * 2.0).toFixed(2)} pts)`;
    if (resProfit20) resProfit20.textContent = `+₹${profit20.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

    if (resTarget30) resTarget30.textContent = `₹${target30Price.toFixed(2)} (${sign}${(pointRisk * 3.0).toFixed(2)} pts)`;
    if (resProfit30) resProfit30.textContent = `+₹${profit30.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }

  // Bind live calculation events
  if (calcCapitalInput) calcCapitalInput.addEventListener('input', calculatePositionSizing);
  if (calcRiskPctInput) calcRiskPctInput.addEventListener('input', calculatePositionSizing);
  if (calcInstrumentSelect) calcInstrumentSelect.addEventListener('change', () => {
    // Helpful defaults when switching instruments
    const key = calcInstrumentSelect.value;
    if (key === 'nifty') {
      calcEntryInput.value = '24950';
      calcSlInput.value = '24900';
    } else if (key === 'banknifty') {
      calcEntryInput.value = '51800';
      calcSlInput.value = '51650';
    } else if (key === 'finnifty') {
      calcEntryInput.value = '23850';
      calcSlInput.value = '23775';
    } else if (key === 'midcpnifty') {
      calcEntryInput.value = '12900';
      calcSlInput.value = '12850';
    } else if (key === 'crudeoil') {
      calcEntryInput.value = '6140';
      calcSlInput.value = '6100';
    } else if (key === 'equity') {
      calcEntryInput.value = '2985';
      calcSlInput.value = '2940';
    }
    calculatePositionSizing();
  });
  if (calcEntryInput) calcEntryInput.addEventListener('input', calculatePositionSizing);
  if (calcSlInput) calcSlInput.addEventListener('input', calculatePositionSizing);

  // Copy Trade Setup Card to Clipboard
  if (calcCopyBtn) {
    calcCopyBtn.addEventListener('click', () => {
      const instrument = instrumentNames[calcInstrumentSelect ? calcInstrumentSelect.value : 'nifty'] || 'TRADE';
      const entry = calcEntryInput.value;
      const sl = calcSlInput.value;
      const qty = resQuantity ? resQuantity.textContent : '';
      const lots = resLots ? resLots.textContent : '';
      const risk = resMaxRisk ? resMaxRisk.textContent : '';
      const t15 = resTarget15 ? resTarget15.textContent : '';
      const p15 = resProfit15 ? resProfit15.textContent : '';
      const t20 = resTarget20 ? resTarget20.textContent : '';
      const p20 = resProfit20 ? resProfit20.textContent : '';
      const t30 = resTarget30 ? resTarget30.textContent : '';
      const p30 = resProfit30 ? resProfit30.textContent : '';

      const copyText = 
`🏛 IWSM INSTITUTIONAL TRADE SETUP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Instrument: ${instrument}
Entry: ₹${entry} | Stop-Loss: ₹${sl}
Position Size: ${qty} (${lots})
Capital Risk: ${risk}
Target 1 (1:1.5): ${t15} [${p15}]
Target 2 (1:2.0): ${t20} [${p20}]
Target 3 (1:3.0): ${t30} [${p30}]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated via IWSM Risk Discipline Engine (Jaipur)`;

      navigator.clipboard.writeText(copyText).then(() => {
        calcCopyBtn.textContent = '✓ Copied Setup!';
        calcCopyBtn.classList.add('btn-gold');
        setTimeout(() => {
          calcCopyBtn.textContent = '📋 Copy Setup';
          calcCopyBtn.classList.remove('btn-gold');
        }, 2200);
      }).catch(() => {
        alert('Trade setup copied to your clipboard!');
      });
    });
  }

  // --------------------------------------------------------------------------
  // 11. Lead Capture Form Submission & Feedback Modal
  // --------------------------------------------------------------------------
  const forms = document.querySelectorAll('form.lead-form');
  const confirmModal = document.querySelector('.lead-confirm-modal');
  const confirmModalClose = document.querySelector('.confirm-modal-close');
  const confirmDetailsWrap = document.querySelector('#confirm-details-text');

  forms.forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const nameInput = form.querySelector('input[name="fullname"]') || form.querySelector('input[placeholder*="Name"]');
      const phoneInput = form.querySelector('input[name="phone"]') || form.querySelector('input[type="tel"]');
      const emailInput = form.querySelector('input[name="email"]') || form.querySelector('input[type="email"]');
      const courseSelect = form.querySelector('select');

      const name = nameInput ? nameInput.value.trim() : 'Learner';
      const phone = phoneInput ? phoneInput.value.trim() : '';
      const email = emailInput ? emailInput.value.trim() : 'N/A';
      const course = courseSelect ? courseSelect.value : 'Gamma Plan';

      if (!phone || phone.length < 8) {
        alert('Please enter a valid mobile number so our mentor can contact you.');
        if (phoneInput) phoneInput.focus();
        return;
      }

      // Store in local storage mock
      const leadEntry = {
        name,
        phone,
        email,
        course,
        timestamp: new Date().toISOString()
      };
      const existingLeads = JSON.parse(localStorage.getItem('iwsm_leads') || '[]');
      existingLeads.push(leadEntry);
      localStorage.setItem('iwsm_leads', JSON.stringify(existingLeads));

      // Display Confirmation Modal
      if (confirmDetailsWrap) {
        confirmDetailsWrap.innerHTML = `
          <strong>Thank you, ${name}!</strong><br>
          We have reserved your free counselling session for <strong>${course}</strong>.<br>
          Our senior market counselor will call you on <strong>${phone}</strong> within 15 minutes.
        `;
      }

      if (confirmModal) confirmModal.classList.add('active');
      form.reset();
    });
  });

  if (confirmModalClose) {
    confirmModalClose.addEventListener('click', () => {
      confirmModal.classList.remove('active');
    });
  }

  if (confirmModal) {
    confirmModal.addEventListener('click', (e) => {
      if (e.target === confirmModal) confirmModal.classList.remove('active');
    });
  }

  // Pre-fill enquiry with module/faculty on click (keeping #hero-course strictly on Gamma Plan)
  window.enquireForCourse = function (courseName) {
    const courseSelects = document.querySelectorAll('select[name="course"]:not(#hero-course)');
    courseSelects.forEach((sel) => {
      let found = false;
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].text.toLowerCase().includes(courseName.toLowerCase())) {
          sel.selectedIndex = i;
          found = true;
          break;
        }
      }
      if (!found) {
        const newOpt = new Option(courseName, courseName, true, true);
        sel.add(newOpt);
      }
    });

    const targetForm = document.querySelector('#enquire');
    if (targetForm) {
      targetForm.scrollIntoView({ behavior: 'smooth' });
      const firstInput = targetForm.querySelector('input');
      if (firstInput) setTimeout(() => firstInput.focus(), 600);
    }
  };

  // Universal WhatsApp router: When anybody clicks any mobile number or phone element, route directly to WhatsApp chat
  document.addEventListener('click', function (e) {
    const link = e.target.closest('a') || e.target.closest('button');
    const text = (e.target.textContent || '') + ' ' + (link ? link.textContent : '');
    const href = link ? (link.getAttribute('href') || '') : '';
    
    // Check if clicked element or text references 8107911127 or 8690211127 or tel:
    if (href.includes('8107911127') || text.includes('8107911127')) {
      e.preventDefault();
      window.open('https://wa.me/918107911127?text=' + encodeURIComponent('Hi IWSM, I would like to enquire about your stock market courses and counselling.'), '_blank');
    } else if (href.includes('8690211127') || text.includes('8690211127')) {
      e.preventDefault();
      window.open('https://wa.me/918690211127?text=' + encodeURIComponent('Hi IWSM, I would like to enquire about your stock market courses and counselling.'), '_blank');
    } else if (href.startsWith('tel:')) {
      e.preventDefault();
      const num = href.replace(/[^0-9]/g, '');
      const waNum = num.length === 10 ? ('91' + num) : num;
      window.open('https://wa.me/' + waNum + '?text=' + encodeURIComponent('Hi IWSM, I would like to enquire about your stock market courses and counselling.'), '_blank');
    }
  });

  console.log('[IWSM Main] Application logic initialized with 3D Orbital Globe, Live Left-to-Right Ticker, Theme Switcher & Risk Calculator.');
})();
