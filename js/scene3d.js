/**
 * ============================================================================
 * IWSM 3D CINEMATIC SCROLL SYSTEM (Three.js WebGL Engine)
 * Features:
 * - Holographic Candlestick Wave Matrix (Bullish Green & Bearish Red bars)
 * - Central Gyroscopic Financial Globe & Orbiting Stock Rings
 * - Ambient Financial Constellation Particles
 * - Mouse Parallax & Scroll-Linked Cinematic Camera Glide
 * - Capability & Performance Gating (SKILL/PERFORMANCE.md & COMMON_PROBLEMS.md)
 * ============================================================================
 */

(function () {
  'use strict';

  // Check hardware & WebGL capability
  function isWebGLSupported() {
    try {
      const canvas = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  const canvas = document.getElementById('webgl-hero-canvas');
  if (!canvas || !isWebGLSupported() || typeof THREE === 'undefined') {
    console.log('[IWSM 3D] WebGL or Three.js unavailable, running in ambient CSS fallback mode.');
    return;
  }

  // Check reduced motion preference
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Scene, Camera, Renderer
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x030812, 0.0018);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1500);
  camera.position.set(0, 20, 110);

  const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true,
    antialias: window.devicePixelRatio < 2,
    powerPreference: 'high-performance'
  });

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);

  const goldLight = new THREE.PointLight(0xd9b45c, 2.5, 350);
  goldLight.position.set(60, 50, 40);
  scene.add(goldLight);

  const greenLight = new THREE.PointLight(0x10b981, 2.0, 300);
  greenLight.position.set(-70, -20, 30);
  scene.add(greenLight);

  const cyanLight = new THREE.DirectionalLight(0x38bdf8, 0.8);
  cyanLight.position.set(0, 80, 50);
  scene.add(cyanLight);

  // --------------------------------------------------------------------------
  // Group: Financial Globe & Gyroscopic Orbiting Rings
  // --------------------------------------------------------------------------
  const globeGroup = new THREE.Group();
  scene.add(globeGroup);
  globeGroup.position.set(38, 2, -10);

  // Central Wireframe Sphere
  const sphereGeo = new THREE.IcosahedronGeometry(22, 3);
  const sphereMat = new THREE.MeshStandardMaterial({
    color: 0x0f274a,
    wireframe: true,
    transparent: true,
    opacity: 0.35,
    roughness: 0.3
  });
  const globeMesh = new THREE.Mesh(sphereGeo, sphereMat);
  globeGroup.add(globeMesh);

  // Inner Core Glow Sphere
  const coreGeo = new THREE.SphereGeometry(14, 24, 24);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xd9b45c,
    wireframe: false,
    transparent: true,
    opacity: 0.08
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  globeGroup.add(coreMesh);

  // Orbiting Ring 1 (Gold Index Ring)
  const ring1Geo = new THREE.TorusGeometry(32, 0.4, 16, 100);
  const ring1Mat = new THREE.MeshStandardMaterial({
    color: 0xd9b45c,
    metalness: 0.9,
    roughness: 0.2,
    emissive: 0x544012,
    emissiveIntensity: 0.3
  });
  const ring1 = new THREE.Mesh(ring1Geo, ring1Mat);
  ring1.rotation.x = Math.PI / 3;
  globeGroup.add(ring1);

  // Orbiting Ring 2 (Bull Green Ring)
  const ring2Geo = new THREE.TorusGeometry(38, 0.35, 16, 100);
  const ring2Mat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    metalness: 0.8,
    roughness: 0.3,
    emissive: 0x054d34,
    emissiveIntensity: 0.2
  });
  const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
  ring2.rotation.y = Math.PI / 4;
  ring2.rotation.x = -Math.PI / 6;
  globeGroup.add(ring2);

  // Orbiting Ring 3 (Data Pulse Dotted Ring)
  const ring3Geo = new THREE.TorusGeometry(44, 0.2, 16, 80);
  const ring3Mat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    wireframe: true,
    transparent: true,
    opacity: 0.4
  });
  const ring3 = new THREE.Mesh(ring3Geo, ring3Mat);
  ring3.rotation.z = Math.PI / 5;
  globeGroup.add(ring3);

  // --------------------------------------------------------------------------
  // Group: 3D Holographic Candlestick Wave Field
  // --------------------------------------------------------------------------
  const candleGroup = new THREE.Group();
  scene.add(candleGroup);

  const candleCount = 42;
  const candles = [];

  const greenMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    roughness: 0.3,
    metalness: 0.6,
    emissive: 0x064e3b,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.88
  });

  const redMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    roughness: 0.3,
    metalness: 0.6,
    emissive: 0x7f1d1d,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.88
  });

  const wickMat = new THREE.MeshBasicMaterial({
    color: 0xd9b45c,
    transparent: true,
    opacity: 0.7
  });

  for (let i = 0; i < candleCount; i++) {
    const isBull = Math.random() > 0.42;
    const bodyHeight = 4 + Math.random() * 12;
    const wickHeight = bodyHeight + 4 + Math.random() * 8;

    // Body (Box)
    const bodyGeo = new THREE.BoxGeometry(2.2, bodyHeight, 2.2);
    const bodyMesh = new THREE.Mesh(bodyGeo, isBull ? greenMat : redMat);

    // Wick (Cylinder)
    const wickGeo = new THREE.CylinderGeometry(0.18, 0.18, wickHeight, 8);
    const wickMesh = new THREE.Mesh(wickGeo, wickMat);

    const candleItem = new THREE.Group();
    candleItem.add(bodyMesh);
    candleItem.add(wickMesh);

    // Spread along an undulating chart trajectory
    const posX = -120 + i * 5.8;
    const posY = Math.sin(i * 0.38) * 16 + Math.cos(i * 0.2) * 8 - 12;
    const posZ = -30 + Math.sin(i * 0.5) * 20;

    candleItem.position.set(posX, posY, posZ);
    candleItem.userData = {
      baseY: posY,
      speed: 0.002 + Math.random() * 0.003,
      freq: 0.02 + Math.random() * 0.03,
      offset: i * 0.3
    };

    candleGroup.add(candleItem);
    candles.push(candleItem);
  }

  // --------------------------------------------------------------------------
  // Group: Ambient Financial Constellation Particles
  // --------------------------------------------------------------------------
  const particleCount = 280;
  const particleGeo = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);

  const colorGold = new THREE.Color(0xd9b45c);
  const colorGreen = new THREE.Color(0x10b981);
  const colorCyan = new THREE.Color(0x38bdf8);

  for (let i = 0; i < particleCount; i++) {
    particlePositions[i * 3] = (Math.random() - 0.5) * 350;
    particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 200;
    particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 250;

    const r = Math.random();
    const chosenColor = r < 0.5 ? colorGold : r < 0.8 ? colorCyan : colorGreen;
    particleColors[i * 3] = chosenColor.r;
    particleColors[i * 3 + 1] = chosenColor.g;
    particleColors[i * 3 + 2] = chosenColor.b;
  }

  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

  const particleMat = new THREE.PointsMaterial({
    size: 2.2,
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending
  });

  const particleSystem = new THREE.Points(particleGeo, particleMat);
  scene.add(particleSystem);

  // --------------------------------------------------------------------------
  // Interaction & Scroll Synchronization
  // --------------------------------------------------------------------------
  let mouseX = 0;
  let mouseY = 0;
  let targetMouseX = 0;
  let targetMouseY = 0;

  window.addEventListener('mousemove', (e) => {
    targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    targetMouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  let scrollY = 0;
  let scrollProgress = 0;

  function updateScroll() {
    scrollY = window.scrollY || window.pageYOffset;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    scrollProgress = Math.min(1, Math.max(0, scrollY / maxScroll));
  }

  window.addEventListener('scroll', updateScroll, { passive: true });
  updateScroll();

  // Resize handler
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });

  // --------------------------------------------------------------------------
  // Render Loop
  // --------------------------------------------------------------------------
  let clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);

    const elapsedTime = clock.getElapsedTime();

    // Smooth Mouse Lerp
    mouseX += (targetMouseX - mouseX) * 0.05;
    mouseY += (targetMouseY - mouseY) * 0.05;

    // Gyroscopic Ring Rotations
    ring1.rotation.z += 0.008;
    ring2.rotation.x += 0.006;
    ring3.rotation.y += 0.004;

    globeMesh.rotation.y += 0.003;
    coreMesh.rotation.y -= 0.005;

    // Candlesticks subtle breathing
    if (!prefersReducedMotion) {
      candles.forEach((c) => {
        c.position.y = c.userData.baseY + Math.sin(elapsedTime * 2 + c.userData.offset) * 1.5;
      });
    }

    // Particle Swarm slow rotation
    particleSystem.rotation.y = elapsedTime * 0.02;
    particleSystem.rotation.x = elapsedTime * 0.01;

    // Cinematic Camera Scroll Choreography
    // As user scrolls, the camera glides across the 3D space
    const targetCamX = mouseX * 12 + Math.sin(scrollProgress * Math.PI * 2) * 25;
    const targetCamY = 20 - mouseY * 10 - scrollProgress * 30;
    const targetCamZ = 110 - Math.sin(scrollProgress * Math.PI) * 40;

    camera.position.x += (targetCamX - camera.position.x) * 0.04;
    camera.position.y += (targetCamY - camera.position.y) * 0.04;
    camera.position.z += (targetCamZ - camera.position.z) * 0.04;

    camera.lookAt(globeGroup.position.x * 0.5, 0, 0);

    renderer.render(scene, camera);
  }

  animate();

  console.log('[IWSM 3D] WebGL Cinematic Scene successfully initialized.');
})();
