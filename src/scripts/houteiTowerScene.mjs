// Three.js hero object for the houtei-kenshu portal TOC, matched to the
// dayos.com reference: a stacked hexagonal column (wood, walnut, terrazzo,
// yellow, pink-capped crown) with hexagonal pegs docked into its faces.
// The pegs run a 24s formation cycle — docked → exploded halo → tumbling
// flight into a vertical crown ring on top → staggered cascade home — while
// the whole object slowly turns under studio IBL lighting. Falls back to
// the inline SVG when WebGL is unavailable.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const CANVAS_W = 210;
const CANVAS_H = 230;
const LOOP_SECONDS = 24;
const SEG_H = 0.7;
const COLUMN_TOP = SEG_H * 5;
const PEG_R = 0.42;
const PEG_LEN = 0.85;

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

function makeCanvasTexture(draw, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function terrazzoTexture() {
  return makeCanvasTexture((ctx, size) => {
    ctx.fillStyle = "#f3f1ea";
    ctx.fillRect(0, 0, size, size);
    const flecks = ["#b9b2a2", "#8f887a", "#cdc6b6", "#7c7466", "#a49c8c", "#565048"];
    for (let i = 0; i < 320; i += 1) {
      ctx.fillStyle = flecks[i % flecks.length];
      ctx.beginPath();
      ctx.ellipse(
        Math.random() * size,
        Math.random() * size,
        1.2 + Math.random() * 3.2,
        1 + Math.random() * 2.4,
        Math.random() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  });
}

function woodTexture() {
  return makeCanvasTexture((ctx, size) => {
    ctx.fillStyle = "#e2c69b";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(178, 132, 74, 0.55)";
    for (let i = 0; i < 22; i += 1) {
      const y = (i / 22) * size + Math.random() * 6;
      ctx.lineWidth = 1 + Math.random() * 2.2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) {
        ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 3);
      }
      ctx.stroke();
    }
  });
}

// Foam-like tint map: base color with faint tonal specks so flat surfaces
// pick up grain under the environment light.
function foamTexture(base) {
  return makeCanvasTexture((ctx, size) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i += 1) {
      const tone = Math.random() > 0.5 ? "255, 255, 255" : "0, 0, 0";
      ctx.fillStyle = `rgba(${tone}, ${0.02 + Math.random() * 0.05})`;
      ctx.beginPath();
      ctx.arc(Math.random() * size, Math.random() * size, 0.6 + Math.random() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 128);
}

function buildColumn(root) {
  const terrazzo = terrazzoTexture();
  const wood = woodTexture();
  const segs = [
    { side: { map: wood, roughness: 0.8 }, top: { color: "#eedcb8" } },
    { side: { color: "#2b2523", roughness: 0.55 }, top: { color: "#3b332e" } },
    { side: { map: terrazzo, roughness: 0.7 }, top: { color: "#f3f1ea" } },
    { side: { map: foamTexture("#fff100"), roughness: 0.55 }, top: { color: "#fff100" } },
    { side: { map: terrazzo, roughness: 0.7 }, top: { color: "#ff4fa3", roughness: 0.4 } },
  ];
  const geometry = new THREE.CylinderGeometry(1, 1, SEG_H, 6);
  return segs.map((spec, index) => {
    const side = new THREE.MeshStandardMaterial({ flatShading: true, ...spec.side });
    const cap = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.65, ...spec.top });
    const mesh = new THREE.Mesh(geometry, [side, cap, cap]);
    mesh.position.y = SEG_H * (index + 0.5);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  });
}

const PEG_SPECS = [
  { base: "#fff100", roughness: 0.55, face: 0.2, height: 2.75 },
  { base: "#d1ffca", roughness: 0.6, face: 1.25, height: 1.85 },
  { base: "#ff4fa3", roughness: 0.5, face: 2.3, height: 2.4 },
  { base: "#fff100", roughness: 0.55, face: 3.35, height: 1.2 },
  { base: null, roughness: 0.7, face: 4.9, height: 2.05 },
];

function buildPegs(root) {
  const geometry = new THREE.CylinderGeometry(PEG_R, PEG_R, PEG_LEN, 6);
  geometry.rotateZ(Math.PI / 2);
  return PEG_SPECS.map((spec, index) => {
    const map = spec.base ? foamTexture(spec.base) : terrazzoTexture();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ map, roughness: spec.roughness, flatShading: true }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const theta = spec.face;
    const normal = new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta));
    const crownAngle = (index / PEG_SPECS.length) * Math.PI * 2;
    mesh.userData = {
      docked: normal.clone().multiplyScalar(1.14).setY(spec.height),
      exploded: new THREE.Vector3(Math.cos(theta + 0.35), 0, Math.sin(theta + 0.35))
        .multiplyScalar(1.95)
        .setY(spec.height + 0.55),
      crown: new THREE.Vector3(Math.cos(crownAngle), 0, Math.sin(crownAngle))
        .multiplyScalar(0.58)
        .setY(COLUMN_TOP + PEG_LEN / 2 + 0.03),
      qDock: new THREE.Quaternion().setFromAxisAngle(Y_AXIS, -theta),
      qCrown: new THREE.Quaternion()
        .setFromAxisAngle(Y_AXIS, crownAngle)
        .multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, Math.PI / 2)),
      spinAxis: new THREE.Vector3(Math.sin(index * 2.4) || 0.4, 0.8, Math.cos(index * 1.7)).normalize(),
    };
    root.add(mesh);
    return mesh;
  });
}

function buildFloorSlabs(root) {
  const geometry = new THREE.BoxGeometry(0.95, 0.16, 0.62);
  const specs = [
    { base: "#d1ffca", position: [1.6, 0.08, 1.15], rotation: 0.4 },
    { base: "#fff100", position: [-1.65, 0.08, 1.3], rotation: -0.55 },
  ];
  specs.forEach((spec) => {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ map: foamTexture(spec.base), roughness: 0.6 }),
    );
    mesh.position.set(...spec.position);
    mesh.rotation.y = spec.rotation;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  });
}

const qSpin = new THREE.Quaternion();
const qBase = new THREE.Quaternion();
const wobbleEuler = new THREE.Euler();

function pegPose(index, t, mesh, elapsed) {
  const { docked, exploded, crown, qDock, qCrown, spinAxis } = mesh.userData;
  const cascadeStart = 0.62 + index * 0.028;
  const cascadeEnd = cascadeStart + 0.06;
  let flight = 0;
  let reverse = false;
  let wobble = 0;

  if (t < 0.08) {
    mesh.position.copy(docked);
  } else if (t < 0.13) {
    mesh.position.lerpVectors(docked, exploded, easeInOut((t - 0.08) / 0.05));
  } else if (t < 0.3) {
    wobble = Math.min(1, (t - 0.13) / 0.03, (0.3 - t) / 0.03);
    mesh.position.copy(exploded);
    mesh.position.y += Math.sin(elapsed * 1.4 + index * 1.9) * 0.12;
    mesh.position.x += Math.cos(elapsed * 1.1 + index * 2.6) * 0.07;
  } else if (t < 0.4) {
    flight = easeInOut((t - 0.3) / 0.1);
    mesh.position.lerpVectors(exploded, crown, flight);
    mesh.position.y += Math.sin(Math.PI * flight) * 1.05;
  } else if (t < cascadeStart) {
    mesh.position.copy(crown);
  } else if (t < cascadeEnd) {
    flight = easeInOut((t - cascadeStart) / (cascadeEnd - cascadeStart));
    reverse = true;
    mesh.position.lerpVectors(crown, docked, flight);
    mesh.position.y += Math.sin(Math.PI * flight) * 0.85;
  } else {
    mesh.position.copy(docked);
  }

  if (flight > 0) {
    const from = reverse ? qCrown : qDock;
    const to = reverse ? qDock : qCrown;
    qBase.slerpQuaternions(from, to, flight);
    qSpin.setFromAxisAngle(spinAxis, Math.sin(Math.PI * flight) * Math.PI * 0.9);
    mesh.quaternion.multiplyQuaternions(qSpin, qBase);
  } else if (t >= 0.4 && t < cascadeStart) {
    mesh.quaternion.copy(qCrown);
  } else if (wobble > 0) {
    wobbleEuler.set(
      Math.sin(elapsed * 1.6 + index) * 0.12 * wobble,
      Math.sin(elapsed * 1.2 + index * 2.2) * 0.18 * wobble,
      Math.cos(elapsed * 1.4 + index * 1.3) * 0.09 * wobble,
    );
    qSpin.setFromEuler(wobbleEuler);
    mesh.quaternion.multiplyQuaternions(qSpin, qDock);
  } else {
    mesh.quaternion.copy(qDock);
  }
}

function beat(t, start, end) {
  if (t < start || t > end) return 0;
  return Math.sin(Math.PI * ((t - start) / (end - start)));
}

export function initTowerScene(host) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return false;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(CANVAS_W, CANVAS_H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(32, CANVAS_W / CANVAS_H, 0.1, 60);
  camera.position.set(0, 4.4, 9.4);
  camera.lookAt(0, 2.25, 0);

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-4, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 5;
  key.shadow.bias = -0.0002;
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 7;
  key.shadow.camera.bottom = -2;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff3cf, 0.35);
  fill.position.set(5, 3, -4);
  scene.add(fill);

  const root = new THREE.Group();
  scene.add(root);
  const segments = buildColumn(root);
  const pegs = buildPegs(root);
  buildFloorSlabs(root);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(5.2, 48).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.16 }),
  );
  floor.receiveShadow = true;
  scene.add(floor);

  renderer.domElement.className = "toc-tower-canvas";
  host.appendChild(renderer.domElement);
  host.classList.add("is-gl");

  const timer = new THREE.Timer();
  let elapsed = 0;
  let rafId = 0;
  let running = false;

  const frame = (now) => {
    timer.update(now);
    elapsed += timer.getDelta();
    const t = (elapsed % LOOP_SECONDS) / LOOP_SECONDS;
    root.rotation.y = elapsed * ((Math.PI * 2) / 48);
    segments[4].position.y = SEG_H * 4.5 + beat(t, 0.16, 0.28) * 0.4;
    segments[2].position.x = -beat(t, 0.44, 0.56) * 0.3;
    segments[3].position.x = beat(t, 0.8, 0.9) * 0.32;
    pegs.forEach((mesh, index) => pegPose(index, t, mesh, elapsed));
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  };

  const play = () => {
    if (running) return;
    running = true;
    timer.reset();
    rafId = requestAnimationFrame(frame);
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(rafId);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => (entry.isIntersecting && !document.hidden ? play() : pause()));
    },
    { threshold: 0.05 },
  );
  observer.observe(host);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else if (host.getBoundingClientRect().top < window.innerHeight) play();
  });

  return true;
}
