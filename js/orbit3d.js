/**
 * ============================================================================
 * INSTITUTE OF WORLD STOCK MARKET — 3D ORBIT GALLERY EXPERIENCE
 * WebGL Three.js Engine:
 * - 25 Real IWSM Photographs as 3D Physical Object Panels
 * - Deterministic 3-Layer Spatial Distribution (Foreground, Midground, Background)
 * - Natural Physics: Inertia, Momentum Drag, Spring Damping & Return
 * - Pointer Spatial Vortex Interaction & Card Hover Tilt Tracking
 * - Smooth Camera Damping & Scroll-Linked Dynamic Parallax
 * - Theme Awareness (Dark Navy Financial vs Light Architectural Mode)
 * - Lightbox Integration & Category Filter Synchronization
 * ============================================================================
 */

(function () {
  'use strict';

  // Capability & WebGL Verification
  function isWebGLAvailable() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  const canvas = document.getElementById('orbit-3d-canvas');
  const viewport = document.getElementById('orbit-viewport');

  if (!canvas || !viewport || !isWebGLAvailable() || typeof THREE === 'undefined') {
    console.log('[IWSM 3D Orbit] WebGL unavailable, falling back to CSS grid.');
    return;
  }

  // 25 Official IWSM Gallery Photographs Metadata
  const galleryItems = [
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

  const catLabels = {
    ads: 'Banner & Ad',
    concepts: 'Market Concept',
    mentors: 'Mentor & Campus'
  };

  // --------------------------------------------------------------------------
  // 1. Scene, Camera & Renderer Setup
  // --------------------------------------------------------------------------
  const scene = new THREE.Scene();
  const isLightTheme = document.documentElement.getAttribute('data-theme') === 'light';

  // Atmospheric Fog
  const darkFogColor = 0x030814;
  const lightFogColor = 0xedf2fa;
  scene.fog = new THREE.FogExp2(isLightTheme ? lightFogColor : darkFogColor, 0.022);

  // Perspective Camera
  const camera = new THREE.PerspectiveCamera(50, viewport.clientWidth / viewport.clientHeight, 0.1, 120);
  const defaultCamPos = { x: 0, y: 0, z: window.innerWidth < 768 ? 14.5 : 12.0 };
  camera.position.set(defaultCamPos.x, defaultCamPos.y, defaultCamPos.z);

  // WebGL Renderer
  const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true,
    antialias: window.devicePixelRatio < 2,
    powerPreference: 'high-performance'
  });
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  // --------------------------------------------------------------------------
  // 2. Cinematic Lighting System
  // --------------------------------------------------------------------------
  const ambientLight = new THREE.AmbientLight(isLightTheme ? 0xffffff : 0xe2e8f0, isLightTheme ? 0.95 : 0.7);
  scene.add(ambientLight);

  const keyLight = new THREE.PointLight(0xd9b45c, 2.6, 60);
  keyLight.position.set(12, 14, 16);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(0x38bdf8, 1.8, 55);
  rimLight.position.set(-14, -10, 10);
  scene.add(rimLight);

  const bottomLight = new THREE.DirectionalLight(isLightTheme ? 0xa5b4fc : 0x1e3a8a, 0.6);
  bottomLight.position.set(0, -15, 5);
  scene.add(bottomLight);

  // --------------------------------------------------------------------------
  // 3. 3D Background Particles & Atmosphere
  // --------------------------------------------------------------------------
  const particleCount = window.innerWidth < 768 ? 200 : 400;
  const particleGeo = new THREE.BufferGeometry();
  const particlePos = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);

  const colGold = new THREE.Color(0xd9b45c);
  const colCyan = new THREE.Color(0x38bdf8);
  const colWhite = new THREE.Color(0xffffff);

  for (let i = 0; i < particleCount; i++) {
    const idx = i * 3;
    particlePos[idx] = (Math.random() - 0.5) * 45;
    particlePos[idx + 1] = (Math.random() - 0.5) * 35;
    particlePos[idx + 2] = (Math.random() - 0.5) * 30 - 4;

    const rnd = Math.random();
    const c = rnd < 0.4 ? colGold : rnd < 0.75 ? colCyan : colWhite;
    particleColors[idx] = c.r;
    particleColors[idx + 1] = c.g;
    particleColors[idx + 2] = c.b;
  }

  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
  particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

  const particleMat = new THREE.PointsMaterial({
    size: 0.12,
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
    blending: isLightTheme ? THREE.NormalBlending : THREE.AdditiveBlending
  });

  const particleField = new THREE.Points(particleGeo, particleMat);
  scene.add(particleField);

  // --------------------------------------------------------------------------
  // 4. Deterministic Seeded Pseudo-Random Distribution & Photo Object System
  // --------------------------------------------------------------------------
  const orbitMasterGroup = new THREE.Group();
  scene.add(orbitMasterGroup);

  const cardObjects = [];
  const textureLoader = new THREE.TextureLoader();

  // Seeded PRNG for reproducible spatial distribution
  function seededRandom(seed) {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }

  const CARD_W = 2.15;
  const CARD_H = 1.62;
  const CARD_D = 0.06;

  // Reusable Geometries
  const frontPlaneGeo = new THREE.PlaneGeometry(CARD_W * 0.98, CARD_H * 0.98);
  const backBoxGeo = new THREE.BoxGeometry(CARD_W, CARD_H, CARD_D);
  const edgeGeo = new THREE.EdgesGeometry(backBoxGeo);

  // Common Materials
  const backMatDark = new THREE.MeshStandardMaterial({
    color: 0x06152d,
    roughness: 0.28,
    metalness: 0.18,
    transparent: true,
    opacity: 0.94
  });

  const backMatLight = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0.05,
    transparent: true,
    opacity: 0.95
  });

  const frameMat = new THREE.LineBasicMaterial({
    color: 0xd9b45c,
    transparent: true,
    opacity: 0.45
  });

  // Calculate coordinates across 3 Depth Layers
  const totalCards = galleryItems.length; // 25
  const radX = window.innerWidth < 768 ? 6.2 : 8.2;
  const radZ = window.innerWidth < 768 ? 5.2 : 7.0;

  galleryItems.forEach((item, i) => {
    const cardGroup = new THREE.Group();

    // Deterministic angle & depth assignment
    const baseAngle = (i / totalCards) * Math.PI * 2;
    const seed = i * 1.37 + 10;
    const angleJitter = (seededRandom(seed) - 0.5) * 0.22;
    const angle = baseAngle + angleJitter;

    // Layer assignment:
    // i % 3 === 0 -> Foreground (-1.5 to +1.0)
    // i % 3 === 1 -> Midground (-4.0 to -1.5)
    // i % 3 === 2 -> Background (-8.0 to -4.0)
    const layer = i % 3;
    let depthOffset = 0;
    if (layer === 0) {
      depthOffset = (seededRandom(seed + 1) * 2.2) - 1.2; // -1.2 to +1.0
    } else if (layer === 1) {
      depthOffset = -1.5 - (seededRandom(seed + 2) * 2.5); // -4.0 to -1.5
    } else {
      depthOffset = -4.0 - (seededRandom(seed + 3) * 3.8); // -7.8 to -4.0
    }

    const posX = Math.sin(angle) * radX;
    const posZ = Math.cos(angle) * radZ + depthOffset;
    const posY = (seededRandom(seed + 4) - 0.5) * 5.4;

    cardGroup.position.set(posX, posY, posZ);

    // Initial orientation: face outwards from the orbit center + slight tilt
    const targetYRot = angle + Math.PI;
    const tiltX = (seededRandom(seed + 5) - 0.5) * 0.18;
    const tiltZ = (seededRandom(seed + 6) - 0.5) * 0.12;
    cardGroup.rotation.set(tiltX, targetYRot, tiltZ);

    // Store physical and animation states
    const cardState = {
      id: item.id,
      index: i,
      data: item,
      group: cardGroup,
      basePos: new THREE.Vector3(posX, posY, posZ),
      currentPos: new THREE.Vector3(posX, posY, posZ),
      baseRot: new THREE.Euler(tiltX, targetYRot, tiltZ),
      currentRot: new THREE.Euler(tiltX, targetYRot, tiltZ),
      targetScale: 1.0,
      currentScale: 1.0,
      hoverScaleTarget: 1.0,
      velocity: new THREE.Vector3(0, 0, 0),
      vortexOffset: new THREE.Vector3(0, 0, 0),
      vortexRot: new THREE.Euler(0, 0, 0),
      isHovered: false,
      isFiltered: false,
      targetOpacity: 1.0,
      currentOpacity: 1.0
    };

    // 1. Backing Box
    const backMesh = new THREE.Mesh(backBoxGeo, isLightTheme ? backMatLight.clone() : backMatDark.clone());
    cardGroup.add(backMesh);
    cardState.backMesh = backMesh;

    // 2. Gold Rim Frame
    const edgeLines = new THREE.LineSegments(edgeGeo, frameMat.clone());
    cardGroup.add(edgeLines);
    cardState.frame = edgeLines;

    // 3. Front Image Texture Mesh
    const texture = textureLoader.load(`assets/gallery/${item.web_file}`);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;

    const frontMat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.3,
      metalness: 0.1,
      transparent: true,
      opacity: 1.0
    });

    const frontMesh = new THREE.Mesh(frontPlaneGeo, frontMat);
    frontMesh.position.z = CARD_D / 2 + 0.005; // Slightly forward to prevent z-fighting
    frontMesh.userData = { cardIndex: i };
    cardGroup.add(frontMesh);
    cardState.frontMesh = frontMesh;

    orbitMasterGroup.add(cardGroup);
    cardObjects.push(cardState);
  });

  // --------------------------------------------------------------------------
  // 5. Physics Engine: Inertia, Momentum, Spring Damping & Vortex
  // --------------------------------------------------------------------------
  let orbitRotY = 0;
  let orbitRotX = 0;
  let targetOrbitRotY = 0;
  let targetOrbitRotX = 0;
  let dragVelY = 0;
  let dragVelX = 0;
  let isDragging = false;
  let isPointerDown = false;
  let autoRotate = true;
  let hoverResumeTimeout = null;

  // Pointer state in normalized device coordinates (-1 to +1)
  const pointerNDC = new THREE.Vector2(-999, -999);
  const pointerWorldPos = new THREE.Vector3(0, 0, 0);
  const raycaster = new THREE.Raycaster();
  let hoveredCard = null;

  const hoverTag = document.getElementById('orbit-hover-tag');
  const tagBadge = document.getElementById('orbit-tag-badge');
  const tagTitle = document.getElementById('orbit-tag-title');

  // Raycast ground plane to project pointer into 3D space for vortex center
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  function updatePointerWorldPos() {
    raycaster.setFromCamera(pointerNDC, camera);
    raycaster.ray.intersectPlane(groundPlane, pointerWorldPos);
  }

  // Pointer Event Listeners
  let lastPointerX = 0;
  let lastPointerY = 0;
  let pointerDownStartTime = 0;
  let pointerDownMoved = false;

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    isPointerDown = true;
    isDragging = true;
    pointerDownMoved = false;
    pointerDownStartTime = performance.now();
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    dragVelY = 0;
    dragVelX = 0;
    viewport.setPointerCapture(e.pointerId);
  });

  viewport.addEventListener('pointermove', (e) => {
    const rect = viewport.getBoundingClientRect();
    pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    updatePointerWorldPos();

    if (isDragging) {
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        pointerDownMoved = true;
      }

      const rotFactor = 0.0045;
      targetOrbitRotY += dx * rotFactor;
      targetOrbitRotX += dy * rotFactor;
      targetOrbitRotX = Math.max(-0.45, Math.min(0.45, targetOrbitRotX)); // Keep orbit upright

      dragVelY = dx * rotFactor * 0.85;
      dragVelX = dy * rotFactor * 0.85;

      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
    }
  });

  const onPointerUp = (e) => {
    if (!isPointerDown) return;
    isPointerDown = false;
    isDragging = false;
    try {
      viewport.releasePointerCapture(e.pointerId);
    } catch (err) {}

    // Check if it was a quick click without dragging
    const clickDuration = performance.now() - pointerDownStartTime;
    if (!pointerDownMoved && clickDuration < 300) {
      raycaster.setFromCamera(pointerNDC, camera);
      const intersects = raycaster.intersectObjects(cardObjects.map(c => c.frontMesh));
      if (intersects.length > 0) {
        const clickedIdx = intersects[0].object.userData.cardIndex;
        onCardClick(clickedIdx);
      }
    }
  };

  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', onPointerUp);

  // Mouse Wheel Zoom & Scroll Depth
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomSpeed = 0.0035;
    camera.position.z += e.deltaY * zoomSpeed;
    camera.position.z = Math.max(7.5, Math.min(16.0, camera.position.z));
    targetOrbitRotY += e.deltaY * 0.0004;
  }, { passive: false });

  // --------------------------------------------------------------------------
  // 6. Card Hover & Click Lightbox Interactions
  // --------------------------------------------------------------------------
  function onCardHover(card) {
    if (hoveredCard === card) return;

    hoveredCard = card;
    autoRotate = false;
    if (hoverResumeTimeout) clearTimeout(hoverResumeTimeout);

    // Show HUD Tag
    if (hoverTag && tagBadge && tagTitle) {
      tagBadge.textContent = catLabels[card.data.category] || 'Creative';
      tagTitle.textContent = card.data.title;
      hoverTag.classList.add('active');
    }
  }

  function onCardUnhover() {
    if (!hoveredCard) return;

    hoveredCard = null;
    if (hoverTag) hoverTag.classList.remove('active');

    // Resume auto rotation after delay (1200ms)
    if (hoverResumeTimeout) clearTimeout(hoverResumeTimeout);
    hoverResumeTimeout = setTimeout(() => {
      autoRotate = true;
    }, 1200);
  }

  function onCardClick(index) {
    const card = cardObjects[index];
    if (!card) return;

    // Smoothly focus camera towards the selected card
    const targetCamZ = Math.max(8.0, card.currentPos.z + 4.5);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCamZ, 0.4);

    // Trigger website Lightbox
    if (typeof window.openGalleryLightbox === 'function') {
      window.openGalleryLightbox(index);
    }
  }

  // --------------------------------------------------------------------------
  // 7. Navigation Controls (Spin Left, Right, Pause, Reset)
  // --------------------------------------------------------------------------
  const btnSpinLeft = document.getElementById('orbit-rotate-left');
  const btnSpinRight = document.getElementById('orbit-rotate-right');
  const btnAutoToggle = document.getElementById('orbit-auto-toggle');
  const btnReset = document.getElementById('orbit-reset-btn');

  if (btnSpinLeft) {
    btnSpinLeft.addEventListener('click', () => {
      targetOrbitRotY -= 0.55;
    });
  }

  if (btnSpinRight) {
    btnSpinRight.addEventListener('click', () => {
      targetOrbitRotY += 0.55;
    });
  }

  if (btnAutoToggle) {
    btnAutoToggle.addEventListener('click', () => {
      autoRotate = !autoRotate;
      btnAutoToggle.textContent = autoRotate ? '⏸ Pause' : '▶ Auto-Spin';
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      targetOrbitRotY = 0;
      targetOrbitRotX = 0;
      dragVelY = 0;
      dragVelX = 0;
      camera.position.set(defaultCamPos.x, defaultCamPos.y, defaultCamPos.z);
    });
  }

  // --------------------------------------------------------------------------
  // 8. Category Filtering Integration
  // --------------------------------------------------------------------------
  function setGalleryFilter(filterCategory) {
    cardObjects.forEach((card) => {
      const match = filterCategory === 'all' || card.data.category === filterCategory;
      card.isFiltered = !match;
      card.targetOpacity = match ? 1.0 : 0.18;
      card.targetScale = match ? 1.0 : 0.82;
    });
  }

  // Hook into filter buttons
  const filterPills = document.querySelectorAll('.gallery-filter-pill');
  filterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const cat = pill.getAttribute('data-filter');
      setGalleryFilter(cat);
    });
  });

  // --------------------------------------------------------------------------
  // 9. Theme Change Listener (Dark / Light Transitions)
  // --------------------------------------------------------------------------
  function updateThemeColors(theme) {
    const isLight = theme === 'light';

    // Update scene fog
    scene.fog.color.setHex(isLight ? lightFogColor : darkFogColor);

    // Update lights
    ambientLight.color.setHex(isLight ? 0xffffff : 0xe2e8f0);
    ambientLight.intensity = isLight ? 0.95 : 0.7;
    keyLight.color.setHex(isLight ? 0xcfa23e : 0xd9b45c);
    bottomLight.color.setHex(isLight ? 0xc7d2fe : 0x1e3a8a);

    // Update card materials
    cardObjects.forEach((c) => {
      c.backMesh.material.color.setHex(isLight ? 0xffffff : 0x06152d);
      c.backMesh.material.opacity = isLight ? 0.96 : 0.92;
      c.frame.material.color.setHex(isLight ? 0xcfa23e : 0xd9b45c);
    });

    // Particle blend mode
    particleMat.blending = isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    particleMat.needsUpdate = true;
  }

  window.addEventListener('themeChanged', (e) => {
    updateThemeColors(e.detail.theme);
  });

  // --------------------------------------------------------------------------
  // 10. Main Animation & Physics Loop (requestAnimationFrame)
  // --------------------------------------------------------------------------
  let isVisible = true;
  const observer = new IntersectionObserver((entries) => {
    isVisible = entries[0].isIntersecting;
  }, { threshold: 0.05 });
  observer.observe(viewport);

  const clock = new THREE.Clock();
  const SPRING_K = 0.045;
  const SPRING_DAMPING = 0.86;
  const VORTEX_RADIUS = 5.5;

  function renderLoop() {
    requestAnimationFrame(renderLoop);

    if (!isVisible) return;

    const delta = clock.getDelta();

    // 1. Orbit Rotation Inertia & Damping
    if (!isDragging) {
      if (Math.abs(dragVelY) > 0.0001) {
        targetOrbitRotY += dragVelY;
        dragVelY *= 0.92; // Inertia damping
      }
      if (Math.abs(dragVelX) > 0.0001) {
        targetOrbitRotX += dragVelX;
        dragVelX *= 0.92;
      }

      // Gentle auto-rotation when idle
      if (autoRotate && !hoveredCard) {
        targetOrbitRotY += 0.0008;
      }
    }

    // Smoothly damp rotation towards target
    orbitRotY += (targetOrbitRotY - orbitRotY) * 0.085;
    orbitRotX += (targetOrbitRotX - orbitRotX) * 0.085;
    orbitMasterGroup.rotation.y = orbitRotY;
    orbitMasterGroup.rotation.x = orbitRotX;

    // Slow particle rotation for atmospheric depth
    particleField.rotation.y += 0.0002;
    particleField.rotation.x += 0.0001;

    // 2. Raycast Card Hover
    raycaster.setFromCamera(pointerNDC, camera);
    const intersects = raycaster.intersectObjects(cardObjects.map(c => c.frontMesh));

    let currentHit = null;
    if (intersects.length > 0) {
      const idx = intersects[0].object.userData.cardIndex;
      currentHit = cardObjects[idx];
      onCardHover(currentHit);
    } else {
      onCardUnhover();
    }

    // 3. Card Physics: Vortex Mechanics, Spring Return & Tilt Tracking
    cardObjects.forEach((card) => {
      const isThisHovered = card === hoveredCard;

      // Distance from pointer vortex center in world space
      const worldCardPos = new THREE.Vector3();
      card.group.getWorldPosition(worldCardPos);
      const distToPointer = worldCardPos.distanceTo(pointerWorldPos);

      // Target vortex displacement
      let targetVortexX = 0;
      let targetVortexY = 0;
      let targetVortexZ = 0;
      let targetVortexRotZ = 0;
      let targetVortexRotX = 0;

      if (distToPointer < VORTEX_RADIUS && !isThisHovered) {
        const force = (1 - distToPointer / VORTEX_RADIUS);
        const dirX = worldCardPos.x - pointerWorldPos.x;
        const dirY = worldCardPos.y - pointerWorldPos.y;

        targetVortexX = dirX * force * 0.32;
        targetVortexY = dirY * force * 0.32;
        targetVortexZ = -force * 0.55; // Push slightly backward
        targetVortexRotZ = (dirX > 0 ? 1 : -1) * force * 0.20; // Subtle vortex twist (max ~11°)
        targetVortexRotX = -force * 0.15;
      }

      // Spring displacement physics
      const dispX = targetVortexX - card.vortexOffset.x;
      const dispY = targetVortexY - card.vortexOffset.y;
      const dispZ = targetVortexZ - card.vortexOffset.z;

      card.velocity.x = (card.velocity.x + dispX * SPRING_K) * SPRING_DAMPING;
      card.velocity.y = (card.velocity.y + dispY * SPRING_K) * SPRING_DAMPING;
      card.velocity.z = (card.velocity.z + dispZ * SPRING_K) * SPRING_DAMPING;

      card.vortexOffset.add(card.velocity);
      card.vortexRot.z = THREE.MathUtils.lerp(card.vortexRot.z, targetVortexRotZ, 0.1);
      card.vortexRot.x = THREE.MathUtils.lerp(card.vortexRot.x, targetVortexRotX, 0.1);

      // Hover scale and Z forward shift
      const targetHoverScale = isThisHovered ? 1.14 : card.targetScale;
      card.currentScale += (targetHoverScale - card.currentScale) * 0.12;
      card.group.scale.set(card.currentScale, card.currentScale, card.currentScale);

      // Position update (base + vortex + hover forward)
      const forwardZ = isThisHovered ? 0.45 : 0;
      card.group.position.x = card.basePos.x + card.vortexOffset.x;
      card.group.position.y = card.basePos.y + card.vortexOffset.y;
      card.group.position.z = card.basePos.z + card.vortexOffset.z + forwardZ;

      // Rotation update (base + vortex + pointer tilt tracking when hovered)
      let tiltTrackX = 0;
      let tiltTrackY = 0;
      if (isThisHovered) {
        tiltTrackY = pointerNDC.x * 0.18;
        tiltTrackX = -pointerNDC.y * 0.18;
      }

      card.group.rotation.x = card.baseRot.x + card.vortexRot.x + tiltTrackX;
      card.group.rotation.y = card.baseRot.y + tiltTrackY;
      card.group.rotation.z = card.baseRot.z + card.vortexRot.z;

      // Opacity transition
      card.currentOpacity += (card.targetOpacity - card.currentOpacity) * 0.1;
      card.frontMesh.material.opacity = card.currentOpacity;
      card.backMesh.material.opacity = card.currentOpacity * (isLightTheme ? 0.96 : 0.92);

      // Gold frame glow intensity
      if (isThisHovered) {
        card.frame.material.opacity = 1.0;
        card.frontMesh.material.emissive = new THREE.Color(0x221808);
      } else {
        card.frame.material.opacity = card.currentOpacity * 0.45;
        card.frontMesh.material.emissive = new THREE.Color(0x000000);
      }
    });

    renderer.render(scene, camera);
  }

  requestAnimationFrame(renderLoop);

  // --------------------------------------------------------------------------
  // 11. Viewport Resize Handler
  // --------------------------------------------------------------------------
  window.addEventListener('resize', () => {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    camera.aspect = w / h;
    camera.position.z = w < 768 ? 14.5 : 12.0;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });

  console.log('[IWSM 3D Orbit] Spatial Memory Universe successfully initialized with 25 photographs.');
})();
