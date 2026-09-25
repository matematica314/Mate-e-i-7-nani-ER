class PanoramaViewer {
  constructor(containerId, imageUrl, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error('PanoramaViewer: contenitore non trovato:', containerId);
      return;
    }
    this.imageUrl = imageUrl;

    // ---- opzioni con default ----
    this.pitchLimit = options.pitchLimit ?? 70;   // gradi, verticale: -limit/+limit
    this.fov        = options.fov ?? 75;          // campo visivo iniziale
    this.minFov     = options.minFov ?? 30;        // zoom massimo (in avanti)
    this.maxFov     = options.maxFov ?? 100;       // zoom minimo (indietro)
    this.lon        = options.startLon ?? 0;       // orientamento orizzontale iniziale
    this.lat        = options.startLat ?? 0;       // orientamento verticale iniziale
    this.autoRotate = options.autoRotate ?? false;
    this.autoRotateSpeed = options.autoRotateSpeed ?? 0.02; // gradi/frame

    this._isPointerDown = false;
    this._pointerId = null;
    this._lastX = 0;
    this._lastY = 0;
    this._pinchStartDist = null;
    this._pinchStartFov = null;
    this._idleTimer = null;

    this._initScene();
    this._loadTexture();
    this._bindEvents();
    this._animate();
  }

  _initScene() {
    const { clientWidth: w, clientHeight: h } = this.container;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.fov, w / h, 1, 1100);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(w, h);
    this.container.appendChild(this.renderer.domElement);

    // Sfera "invertita" (scale negativa su X) per vedere la texture
    // dall'interno, con abbastanza segmenti da evitare distorsioni.
    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1);
    this._placeholderMaterial = new THREE.MeshBasicMaterial({ color: 0x111111 });
    this.mesh = new THREE.Mesh(geometry, this._placeholderMaterial);
    this.scene.add(this.mesh);
  }

  _loadTexture() {
    new THREE.TextureLoader().load(this.imageUrl, (texture) => {
      texture.encoding = THREE.sRGBEncoding;
      this.mesh.material = new THREE.MeshBasicMaterial({ map: texture });
      this._placeholderMaterial.dispose(); this.onFrame?.();
    });
  }

  _bindEvents() {
    const el = this.container;

    // ---- resize responsive ----
    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(el);

    // ---- drag con mouse/touch (Pointer Events copre entrambi) ----
    el.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    window.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', (e) => this._onPointerUp(e));

    // ---- zoom con rotellina ----
    el.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

    // ---- pinch-to-zoom su touch (due dita) ----
    el.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    el.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });

    // ---- pulsanti zoom opzionali ----
    const zoomInBtn = document.getElementById('pv-zoom-in');
    const zoomOutBtn = document.getElementById('pv-zoom-out');
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => this._applyZoom(-10));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this._applyZoom(10));

    // ---- nasconde il suggerimento dopo la prima interazione ----
    this._hint = document.getElementById('panorama-hint');
  }

  _onResize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _onPointerDown(e) {
    this._isPointerDown = true;
    this._pointerId = e.pointerId;
    this._lastX = e.clientX;
    this._lastY = e.clientY;
    this.container.classList.add('is-dragging');
    this._markInteracted();
  }

  _onPointerMove(e) {
    if (!this._isPointerDown || e.pointerId !== this._pointerId) return;
    const dx = e.clientX - this._lastX;
    const dy = e.clientY - this._lastY;
    this._lastX = e.clientX;
    this._lastY = e.clientY;

    // sensibilità proporzionale al fov corrente: più sei zoomato,
    // più il drag è "fine"
    const sensitivity = 0.12 * (this.fov / 75);
    this.lon -= dx * sensitivity;
    this.lat += dy * sensitivity;

    // --- limite di visuale verticale richiesto: -70° / +70° ---
    this.lat = Math.max(-this.pitchLimit, Math.min(this.pitchLimit, this.lat));
  }

  _onPointerUp(e) {
    if (e.pointerId !== this._pointerId) return;
    this._isPointerDown = false;
    this.container.classList.remove('is-dragging');
  }

  _onWheel(e) {
    e.preventDefault();
    this._applyZoom(e.deltaY * 0.05);
    this._markInteracted();
  }

  _onTouchStart(e) {
    if (e.touches.length === 2) {
      this._pinchStartDist = this._touchDistance(e.touches);
      this._pinchStartFov = this.fov;
    }
    this._markInteracted();
  }

  _onTouchMove(e) {
    if (e.touches.length === 2 && this._pinchStartDist) {
      e.preventDefault();
      const dist = this._touchDistance(e.touches);
      const scale = this._pinchStartDist / dist;
      this.fov = this._clampFov(this._pinchStartFov * scale);
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  _touchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _applyZoom(delta) {
    this.fov = this._clampFov(this.fov + delta);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  _clampFov(value) {
    return Math.max(this.minFov, Math.min(this.maxFov, value));
  }

  _markInteracted() {
    if (this._hint && !this._hint.classList.contains('is-hidden')) {
      this._hint.classList.add('is-hidden');
    }
  }

  _animate() {
    requestAnimationFrame(() => this._animate());

    if (this.autoRotate && !this._isPointerDown) {
      this.lon += this.autoRotateSpeed;
    }

    // conversione lon/lat (gradi) in un punto target sulla sfera
    const phi = THREE.MathUtils.degToRad(90 - this.lat);
    const theta = THREE.MathUtils.degToRad(this.lon);

    const target = new THREE.Vector3(
      500 * Math.sin(phi) * Math.cos(theta),
      500 * Math.cos(phi),
      500 * Math.sin(phi) * Math.sin(theta)
    );
    this.camera.lookAt(target);
    this.renderer.render(this.scene, this.camera);this.onFrame?.();
  }
}


PanoramaViewer.prototype.setImage = function(url){
 this.imageUrl=url;this.lon=180;this.lat=0;this.fov=75;this.camera.fov=75;this.camera.updateProjectionMatrix();
 const token=this._loadToken=(this._loadToken||0)+1;
 new THREE.TextureLoader().load(url, texture=>{
  if(token!==this._loadToken){texture.dispose();return}
  texture.encoding=THREE.sRGBEncoding;
  const old=this.mesh.material;this.mesh.material=new THREE.MeshBasicMaterial({map:texture});
  if(old?.map)old.map.dispose();old?.dispose();this.onFrame?.();
 },undefined,()=>console.error('Panorama non disponibile:',url));
};
