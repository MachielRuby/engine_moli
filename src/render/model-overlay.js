const THREE = window.THREE;

export class ModelOverlay {
  constructor(options) {
    if (!THREE) {
      throw new Error('Three.js is not loaded.');
    }

    this.canvas = options.canvas;
    this.viewportWidth = 1;
    this.viewportHeight = 1;
    this.loader = this.createLoader();
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
    this.camera.position.z = 1200;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.anchor = new THREE.Group();
    this.anchor.visible = false;
    this.scene.add(this.anchor);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.1);
    directionalLight.position.set(0.4, 1.2, 0.8);
    this.scene.add(directionalLight);

    this.modelCache = new Map();
    this.targetState = {
      x: 0,
      y: 0,
      scale: 1,
      rotX: -0.45,
      rotY: 0,
      rotZ: 0,
    };
    this.renderState = { ...this.targetState };

    this.startRenderLoop();
  }

  resize(width, height) {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.renderer.setSize(width, height, false);
    this.camera.left = -width / 2;
    this.camera.right = width / 2;
    this.camera.top = height / 2;
    this.camera.bottom = -height / 2;
    this.camera.updateProjectionMatrix();
  }

  async showMatch(match) {
    const modelRoot = await this.ensureModel(match.targetId, match.modelUrl);
    this.activateModel(modelRoot);
    this.updateAnchorFromCorners(match.corners);
    this.anchor.visible = true;
  }

  hide() {
    this.anchor.visible = false;
  }

  updateAnchorFromCorners(corners) {
    const center = corners.reduce(
      (accumulator, corner) => ({
        x: accumulator.x + corner.x / corners.length,
        y: accumulator.y + corner.y / corners.length,
      }),
      { x: 0, y: 0 },
    );

    const topWidth = distance(corners[0], corners[1]);
    const bottomWidth = distance(corners[3], corners[2]);
    const leftHeight = distance(corners[0], corners[3]);
    const rightHeight = distance(corners[1], corners[2]);
    const width = (topWidth + bottomWidth) / 2;
    const height = (leftHeight + rightHeight) / 2;
    const screenAngle = Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x);
    const widthDelta = normalizeDelta(topWidth, bottomWidth);
    const heightDelta = normalizeDelta(leftHeight, rightHeight);

    this.targetState = {
      x: center.x - this.viewportWidth / 2,
      y: this.viewportHeight / 2 - center.y,
      scale: Math.max(120, Math.min(width, height) * 0.72),
      rotX: -0.52 + clamp(heightDelta * 0.4, -0.25, 0.25),
      rotY: clamp(widthDelta * 0.65, -0.4, 0.4),
      rotZ: -screenAngle,
    };
  }

  activateModel(modelRoot) {
    this.anchor.children.forEach((child) => {
      child.visible = false;
    });

    modelRoot.visible = true;
  }

  async ensureModel(targetId, modelUrl) {
    if (this.modelCache.has(targetId)) {
      return this.modelCache.get(targetId);
    }

    const group = await this.loadModel(modelUrl);
    group.visible = false;
    this.anchor.add(group);
    this.modelCache.set(targetId, group);
    return group;
  }

  async loadModel(modelUrl) {
    const group = new THREE.Group();

    try {
      const gltf = await new Promise((resolve, reject) => {
        this.loader.load(modelUrl, resolve, undefined, reject);
      });

      const modelScene = gltf.scene || gltf.scenes?.[0];
      normalizeAndCenter(modelScene);
      group.add(modelScene);
      return group;
    } catch (error) {
      console.warn('[overlay] model load failed, using placeholder', modelUrl, error);
      group.add(createPlaceholderMesh());
      return group;
    }
  }

  createLoader() {
    if (!THREE.GLTFLoader || !THREE.DRACOLoader) {
      throw new Error('GLTFLoader or DRACOLoader is not available.');
    }

    const dracoLoader = new THREE.DRACOLoader();
    dracoLoader.setDecoderPath('https://unpkg.com/three@0.137.0/examples/js/libs/draco/');

    const loader = new THREE.GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    return loader;
  }

  startRenderLoop() {
    const tick = () => {
      requestAnimationFrame(tick);

      this.renderState.x += (this.targetState.x - this.renderState.x) * 0.22;
      this.renderState.y += (this.targetState.y - this.renderState.y) * 0.22;
      this.renderState.scale += (this.targetState.scale - this.renderState.scale) * 0.22;
      this.renderState.rotX += (this.targetState.rotX - this.renderState.rotX) * 0.18;
      this.renderState.rotY += (this.targetState.rotY - this.renderState.rotY) * 0.18;
      this.renderState.rotZ += (this.targetState.rotZ - this.renderState.rotZ) * 0.18;

      this.anchor.position.set(this.renderState.x, this.renderState.y, 0);
      this.anchor.rotation.set(this.renderState.rotX, this.renderState.rotY, this.renderState.rotZ);
      this.anchor.scale.setScalar(this.renderState.scale);

      this.renderer.render(this.scene, this.camera);
    };

    tick();
  }
}

function normalizeAndCenter(object3d) {
  const box = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDimension = Math.max(size.x, size.y, size.z) || 1;
  const scale = 1 / maxDimension;

  object3d.scale.multiplyScalar(scale);
  object3d.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
}

function createPlaceholderMesh() {
  const material = new THREE.MeshStandardMaterial({
    color: 0x31c46c,
    metalness: 0.2,
    roughness: 0.4,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), material);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.25, 24),
    new THREE.MeshStandardMaterial({ color: 0xf5f5f5 }),
  );
  cap.position.y = 0.48;

  const root = new THREE.Group();
  root.add(body);
  root.add(cap);
  return root;
}

function distance(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function normalizeDelta(left, right) {
  const denominator = Math.max(left, right, 1);
  return (left - right) / denominator;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
