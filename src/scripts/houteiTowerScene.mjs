// Three.js hero object for the houtei-kenshu portal TOC: a stacked hexagonal
// column (wood, walnut, terrazzo, yellow, pink-topped crown) with five
// material cubes running a 24s formation cycle — docked → exploded halo →
// tumbling criss-cross flight → pyramid stacked on the crown → staggered
// cascade home. Falls back to the inline SVG when WebGL is unavailable.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const CANVAS_W = 176;
const CANVAS_H = 196;
const LOOP_SECONDS = 24;
const SEG_H = 0.7;
const COLUMN_TOP = SEG_H * 5;
const CUBE = 0.9;

const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

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
    for (let i = 0; i < 300; i += 1) {
      ctx.fillStyle = flecks[i % flecks.length];
      ctx.beginPath();
      ctx.ellipse(
        Math.random() * size,
        Math.random() * size,
        1.2 + Math.random() * 3.4,
        1 + Math.random() * 2.6,
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

function buildColumn(root) {
  const terrazzo = terrazzoTexture();
  const wood = woodTexture();
  const segs = [
    { side: { map: wood, roughness: 0.85 }, top: { color: "#eedcb8" } },
    { side: { color: "#2b2523", roughness: 0.6 }, top: { color: "#3b332e" } },
    { side: { map: terrazzo, roughness: 0.75 }, top: { color: "#f3f1ea" } },
    { side: { color: "#fff100", roughness: 0.5 }, top: { color: "#fff100" } },
    { side: { map: terrazzo, roughness: 0.75 }, top: { color: "#ff4fa3", roughness: 0.45 } },
  ];
  const geometry = new THREE.CylinderGeometry(1, 1, SEG_H, 6);
  return segs.map((spec, index) => {
    const side = new THREE.MeshStandardMaterial({ flatShading: true, ...spec.side });
    const cap = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.7, ...spec.top });
    const mesh = new THREE.Mesh(geometry, [side, cap, cap]);
    mesh.position.y = SEG_H * (index + 0.5);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  });
}

function buildCubes(root) {
  const terrazzo = terrazzoTexture();
  const wood = woodTexture();
  const materials = [
    { color: "#d1ffca", roughness: 0.6 },
    { map: terrazzo, roughness: 0.75 },
    { color: "#fff100", roughness: 0.5 },
    { color: "#ff4fa3", roughness: 0.45 },
    { map: wood, roughness: 0.85 },
  ];
  const geometry = new RoundedBoxGeometry(CUBE, CUBE, CUBE, 3, 0.07);
  return materials.map((spec, index) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial(spec));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.axis = new THREE.Vector3(
      Math.sin(index * 2.4) || 0.4,
      0.8,
      Math.cos(index * 1.7),
    ).normalize();
    root.add(mesh);
    return mesh;
  });
}

const DOCKED = [0, 1, 2, 3, 4].map((i) => {
  const angle = (i / 5) * Math.PI * 2 + 0.35;
  const heights = [0.75, 1.55, 2.3, 1.15, 1.9];
  return new THREE.Vector3(Math.cos(angle) * 1.5, heights[i], Math.sin(angle) * 1.5);
});

const EXPLODED = [0, 1, 2, 3, 4].map((i) => {
  const angle = (i / 5) * Math.PI * 2 + 0.7;
  const radius = 1.9 + (i % 3) * 0.2;
  const heights = [1.6, 2.6, 3.4, 2.1, 2.9];
  return new THREE.Vector3(Math.cos(angle) * radius, heights[i], Math.sin(angle) * radius);
});

const PYRAMID = [
  new THREE.Vector3(-0.5, COLUMN_TOP + CUBE / 2, 0),
  new THREE.Vector3(0.5, COLUMN_TOP + CUBE / 2, 0),
  new THREE.Vector3(0, COLUMN_TOP + CUBE * 1.5 - 0.04, 0),
  new THREE.Vector3(-1.4, COLUMN_TOP - 0.3, 0.4),
  new THREE.Vector3(1.4, COLUMN_TOP - 0.3, 0.4),
];

const scratch = new THREE.Vector3();

function cubePose(index, t, mesh, elapsed) {
  const docked = DOCKED[index];
  const exploded = EXPLODED[index];
  const pyramid = PYRAMID[index];
  const cascadeStart = 0.62 + index * 0.028;
  const cascadeEnd = cascadeStart + 0.06;
  let tumble = 0;
  let wobble = 0;

  if (t < 0.08) {
    mesh.position.copy(docked);
  } else if (t < 0.13) {
    const u = easeInOut((t - 0.08) / 0.05);
    mesh.position.lerpVectors(docked, exploded, u);
  } else if (t < 0.3) {
    const u = (t - 0.13) / 0.17;
    wobble = Math.sin(Math.PI * clamp01(u * 1.4)) * Math.min(1, (0.3 - t) / 0.03);
    mesh.position.copy(exploded);
    mesh.position.y += Math.sin(elapsed * 1.4 + index * 1.9) * 0.12;
    mesh.position.x += Math.cos(elapsed * 1.1 + index * 2.6) * 0.08;
  } else if (t < 0.4) {
    const u = easeInOut((t - 0.3) / 0.1);
    mesh.position.lerpVectors(exploded, pyramid, u);
    mesh.position.y += Math.sin(Math.PI * u) * 1.1;
    tumble = u;
  } else if (t < cascadeStart) {
    mesh.position.copy(pyramid);
  } else if (t < cascadeEnd) {
    const u = easeInOut((t - cascadeStart) / (cascadeEnd - cascadeStart));
    mesh.position.lerpVectors(pyramid, docked, u);
    mesh.position.y += Math.sin(Math.PI * u) * 0.8;
    tumble = u;
  } else {
    mesh.position.copy(docked);
  }

  if (tumble > 0) {
    mesh.quaternion.setFromAxisAngle(mesh.userData.axis, tumble * Math.PI * 2);
  } else if (wobble > 0) {
    scratch.set(
      Math.sin(elapsed * 1.6 + index) * 0.14 * wobble,
      Math.sin(elapsed * 1.2 + index * 2.2) * 0.2 * wobble,
      Math.cos(elapsed * 1.4 + index * 1.3) * 0.1 * wobble,
    );
    mesh.rotation.set(scratch.x, scratch.y, scratch.z);
  } else {
    mesh.quaternion.identity();
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
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, CANVAS_W / CANVAS_H, 0.1, 60);
  camera.position.set(0, 4.8, 10.8);
  camera.lookAt(0, 2.5, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(-4, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 7;
  key.shadow.camera.bottom = -2;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff6d8, 0.5);
  fill.position.set(5, 3, -4);
  scene.add(fill);

  const root = new THREE.Group();
  scene.add(root);
  const segments = buildColumn(root);
  const cubes = buildCubes(root);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(5.2, 48).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.13 }),
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
    segments[2].position.x = -beat(t, 0.44, 0.56) * 0.32;
    segments[3].position.x = beat(t, 0.8, 0.9) * 0.34;
    cubes.forEach((mesh, index) => cubePose(index, t, mesh, elapsed));
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
