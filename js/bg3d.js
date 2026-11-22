/* ==========================================================================
   bg3d.js – subtle Three.js background (floating particle network + wire globe).
   Low cost: capped pixel ratio, ~30 fps, pauses when the tab is hidden,
   disabled for "reduced motion" users and on very small screens.
   ========================================================================== */
(function () {
  'use strict';
  const canvas = document.getElementById('bg3d');
  if (!canvas) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function start() {
    if (typeof THREE === 'undefined' || reduce || window.innerWidth < 480) { canvas.style.display = 'none'; return; }
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' }); }
    catch (e) { canvas.style.display = 'none'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.z = 14;

    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#e3262b';

    // Particles
    const COUNT = window.innerWidth < 900 ? 260 : 520;
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - .5) * 34;
      pos[i * 3 + 1] = (Math.random() - .5) * 22;
      pos[i * 3 + 2] = (Math.random() - .5) * 16;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pMat = new THREE.PointsMaterial({ size: 0.07, transparent: true, opacity: .8, color: css('--a2') });
    const points = new THREE.Points(pGeo, pMat);
    scene.add(points);

    // Wireframe globe (logistics / worldwide network feel)
    const gMat = new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: .16, color: css('--a1') });
    const globe = new THREE.Mesh(new THREE.IcosahedronGeometry(5.2, 2), gMat);
    globe.position.set(7.5, -1.5, -4);
    scene.add(globe);
    const ringMat = new THREE.MeshBasicMaterial({ color: css('--a2'), transparent: true, opacity: .22, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.025, 8, 120), ringMat);
    ring.position.copy(globe.position); ring.rotation.x = 1.2;
    scene.add(ring);

    function resize() {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      globe.position.x = w < 900 ? 3 : 7.5; ring.position.copy(globe.position);
    }
    resize();
    window.addEventListener('resize', resize);

    let mx = 0, my = 0;
    window.addEventListener('pointermove', e => { mx = e.clientX / window.innerWidth - .5; my = e.clientY / window.innerHeight - .5; }, { passive: true });

    SKY.bg3dRecolor = () => { pMat.color.set(css('--a2')); gMat.color.set(css('--a1')); ringMat.color.set(css('--a2')); };

    let last = 0, running = true;
    document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) requestAnimationFrame(loop); });
    function loop(t) {
      if (!running) return;
      requestAnimationFrame(loop);
      if (t - last < 33) return; // ~30 fps
      last = t;
      const s = t * 0.00005;
      points.rotation.y = s * 2; points.rotation.x = s;
      globe.rotation.y = s * 4; globe.rotation.x = s * 1.5;
      ring.rotation.z = s * 3;
      camera.position.x += (mx * 1.6 - camera.position.x) * 0.04;
      camera.position.y += (-my * 1.0 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
})();
