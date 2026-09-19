/**
 * ============================================================================
 * VELARIS — LIVING GRADIENTS IN MOTION (WEBGL BACKGROUND ENGINE)
 * 
 * An animated simplex-noise background with color blending, vignette glow,
 * and film grain in a luxurious blue theme.
 * ============================================================================
 */

(function () {
  'use strict';

  const canvas = document.getElementById('velaris-background-canvas');
  if (!canvas) return;

  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance'
  });

  if (!gl) {
    console.log('[Velaris] WebGL not supported, using CSS gradient fallback.');
    return;
  }

  // VS Shader
  const VS_SOURCE = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  // FS Shader with Simplex 3D noise, color blending, vignette glow, and film grain
  const FS_SOURCE = `
    precision highp float;

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec3 u_color1;
    uniform vec3 u_color2;
    uniform vec3 u_color3;
    uniform vec3 u_color4;
    uniform float u_speed;
    uniform float u_grain;
    uniform float u_vignette;

    // Stefan Gustavson's Simplex 3D noise
    vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v) {
      const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

      vec3 i  = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);

      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);

      vec3 x1 = x0 - i1 + 1.0 * C.xxx;
      vec3 x2 = x0 - i2 + 2.0 * C.xxx;
      vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

      i = mod(i, 289.0);
      vec4 p = permute(permute(permute(
                 i.z + vec4(0.0, i1.z, i2.z, 1.0))
               + i.y + vec4(0.0, i1.y, i2.y, 1.0))
               + i.x + vec4(0.0, i1.x, i2.x, 1.0));

      float n_ = 1.0 / 7.0;
      vec3 ns = n_ * D.wyz - D.xzx;

      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);

      vec4 x = x_ * ns.x + ns.yyyy;
      vec4 y = y_ * ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);

      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);

      vec4 s0 = floor(b0) * 2.0 + 1.0;
      vec4 s1 = floor(b1) * 2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));

      vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);

      vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;

      vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      float aspect = u_resolution.x / u_resolution.y;
      vec2 p = uv;
      p.x *= aspect;

      float t = u_time * u_speed;
      float n1 = snoise(vec3(p * 1.15, t * 0.12));
      float n2 = snoise(vec3(p * 2.1 + vec2(n1 * 0.45), t * 0.17));
      float n3 = snoise(vec3(p * 3.4 - vec2(n2 * 0.35), t * 0.09));

      // Multi-color organic blending
      vec3 col = mix(u_color1, u_color2, smoothstep(-0.6, 0.6, n1));
      col = mix(col, u_color3, smoothstep(-0.35, 0.75, n2 * 0.8 + n1 * 0.25));
      col = mix(col, u_color4, smoothstep(0.15, 0.95, n3 * 0.65 + n2 * 0.35));

      // Radial vignette glow
      vec2 center = uv - 0.5;
      float dist = length(center);
      float vignette = smoothstep(0.9, 0.2, dist);
      col = mix(col * 0.5, col, mix(1.0, vignette, u_vignette));

      // Subtle procedural film grain
      float grain = fract(sin(dot(uv + fract(u_time * 0.03), vec2(12.9898, 78.233))) * 43758.5453);
      col += (grain - 0.5) * u_grain;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function createShader(gl, type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  const vs = createShader(gl, gl.VERTEX_SHADER, VS_SOURCE);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, FS_SOURCE);
  if (!vs || !fs) return;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    return;
  }

  gl.useProgram(program);

  const posBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );

  const aPos = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(program, 'u_resolution');
  const uTime = gl.getUniformLocation(program, 'u_time');
  const uSpeed = gl.getUniformLocation(program, 'u_speed');
  const uGrain = gl.getUniformLocation(program, 'u_grain');
  const uVignette = gl.getUniformLocation(program, 'u_vignette');
  const uC1 = gl.getUniformLocation(program, 'u_color1');
  const uC2 = gl.getUniformLocation(program, 'u_color2');
  const uC3 = gl.getUniformLocation(program, 'u_color3');
  const uC4 = gl.getUniformLocation(program, 'u_color4');

  function hexToRgb(hex) {
    const c = hex.replace('#', '');
    const num = parseInt(c, 16);
    return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
  }

  // Deep Premium Blue Palette
  const darkColors = [
    hexToRgb('#020617'), // Midnight Obsidian
    hexToRgb('#07193b'), // Deep Ocean Navy
    hexToRgb('#1d4ed8'), // Royal Sapphire Blue
    hexToRgb('#38bdf8'), // Electric Cyan Flare
  ];

  // Architectural Light Palette
  const lightColors = [
    hexToRgb('#edf4fe'),
    hexToRgb('#d6e5fb'),
    hexToRgb('#93c5fd'),
    hexToRgb('#38bdf8'),
  ];

  function updatePalette() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const cols = isLight ? lightColors : darkColors;
    gl.uniform3f(uC1, cols[0][0], cols[0][1], cols[0][2]);
    gl.uniform3f(uC2, cols[1][0], cols[1][1], cols[1][2]);
    gl.uniform3f(uC3, cols[2][0], cols[2][1], cols[2][2]);
    gl.uniform3f(uC4, cols[3][0], cols[3][1], cols[3][2]);
    gl.uniform1f(uSpeed, 0.85);
    gl.uniform1f(uGrain, 0.038);
    gl.uniform1f(uVignette, isLight ? 0.4 : 0.85);
  }

  updatePalette();

  // Watch for theme toggles
  const observer = new MutationObserver(updatePalette);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    }
  }

  window.addEventListener('resize', resize);
  resize();

  let isRunning = true;
  let animId = null;
  const startTime = performance.now();

  function render(now) {
    if (!isRunning) return;
    const elapsed = (now - startTime) * 0.001;
    gl.uniform1f(uTime, elapsed);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    animId = requestAnimationFrame(render);
  }

  animId = requestAnimationFrame(render);

  // Tab visibility throttle
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      isRunning = false;
      if (animId) cancelAnimationFrame(animId);
    } else {
      isRunning = true;
      animId = requestAnimationFrame(render);
    }
  });

})();
