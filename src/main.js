import "./style.css";
import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

let hitTestSource = null;
let hitTestSourceRequested = false;

let layoutPrototype = null;
let previewObject = null;
let placedObject = null;
let placedMarker = null;

let locked = false;

// ---------- scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202025);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.01,
  100
);
camera.position.set(0, 1.6, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(0x202025, 1);
renderer.xr.enabled = true;

const app = document.getElementById("app");
app.innerHTML = "";
app.appendChild(renderer.domElement);

// ---------- UI ----------
const panel = document.createElement("div");
panel.style.position = "fixed";
panel.style.top = "12px";
panel.style.left = "12px";
panel.style.zIndex = "9999";
panel.style.maxWidth = "320px";
panel.style.background = "rgba(0,0,0,0.72)";
panel.style.color = "white";
panel.style.padding = "12px";
panel.style.borderRadius = "12px";
panel.style.fontFamily = "system-ui, sans-serif";
panel.style.fontSize = "14px";
panel.style.lineHeight = "1.35";
panel.style.backdropFilter = "blur(4px)";
document.body.appendChild(panel);

const title = document.createElement("div");
title.textContent = "Room Layout AR";
title.style.fontWeight = "700";
title.style.marginBottom = "8px";
panel.appendChild(title);

const statusEl = document.createElement("div");
statusEl.textContent = "Starting…";
statusEl.style.marginBottom = "10px";
statusEl.style.color = "#bfe3ff";
panel.appendChild(statusEl);

const helpEl = document.createElement("div");
helpEl.innerHTML = `
  <div style="margin-bottom:8px;"><strong>How to align</strong></div>
  <div>1. Scan the floor until the red ring appears.</div>
  <div>2. Tap once to place the room layout.</div>
  <div>3. Drag with one finger to rotate it.</div>
  <div>4. Pinch with two fingers to resize it.</div>
  <div>5. Tap <strong>Auto-fit</strong> if it is lost, huge, or tiny.</div>
  <div>6. Tap <strong>Lock</strong> when it looks right.</div>
`;
helpEl.style.marginBottom = "10px";
panel.appendChild(helpEl);

const buttonRow = document.createElement("div");
buttonRow.style.display = "flex";
buttonRow.style.flexWrap = "wrap";
buttonRow.style.gap = "8px";
panel.appendChild(buttonRow);

function makeButton(label) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.style.padding = "8px 10px";
  btn.style.borderRadius = "10px";
  btn.style.border = "1px solid rgba(255,255,255,0.18)";
  btn.style.background = "rgba(255,255,255,0.10)";
  btn.style.color = "white";
  btn.style.cursor = "pointer";
  btn.style.font = "inherit";
  return btn;
}

const autoFitBtn = makeButton("Auto-fit");
const lockBtn = makeButton("Lock");
const resetBtn = makeButton("Reset");
const helpBtn = makeButton("Hide help");

buttonRow.appendChild(autoFitBtn);
buttonRow.appendChild(lockBtn);
buttonRow.appendChild(resetBtn);
buttonRow.appendChild(helpBtn);

function setStatus(msg) {
  statusEl.textContent = msg;
  console.log(msg);
}

// ---------- lights ----------
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(3, 5, 2);
scene.add(dirLight);

// ---------- desktop preview floor ----------
const previewFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(8, 8),
  new THREE.MeshStandardMaterial({ color: 0x404045 })
);
previewFloor.rotation.x = -Math.PI / 2;
previewFloor.position.y = 0;
scene.add(previewFloor);

// ---------- reticle ----------
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.12, 0.18, 48).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff3333, side: THREE.DoubleSide })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// ---------- marker ----------
function makeOriginMarker() {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.15, 0.15),
    new THREE.MeshBasicMaterial({ color: 0xff0000 })
  );
}

function updateMarker() {
  if (!placedObject) return;
  if (!placedMarker) {
    placedMarker = makeOriginMarker();
    scene.add(placedMarker);
  }
  placedMarker.position.copy(placedObject.position);
  placedMarker.position.y += 0.08;
}

// ---------- helpers ----------
function prepareLayout(root, scale = 0.05) {
  root.scale.setScalar(scale);

  root.traverse((child) => {
    if (child.isMesh) {
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => {
          if (m) m.side = THREE.DoubleSide;
        });
      } else if (child.material) {
        child.material.side = THREE.DoubleSide;
      }
    }
  });

  // centre horizontally and bring lowest point to y=0
  const box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);

  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;

  return root;
}

function clearPlaced() {
  if (placedObject) {
    scene.remove(placedObject);
    placedObject = null;
  }
  if (placedMarker) {
    scene.remove(placedMarker);
    placedMarker = null;
  }
}

function cloneLayout() {
  return layoutPrototype ? layoutPrototype.clone(true) : null;
}

function placeLayoutAtReticle(source = "tap") {
  if (!reticle.visible) {
    setStatus("No surface found yet");
    return;
  }
  if (!layoutPrototype) {
    setStatus("Model not loaded yet");
    return;
  }

  clearPlaced();

  placedObject = cloneLayout();
  placedObject.position.setFromMatrixPosition(reticle.matrix);
  placedObject.rotation.set(0, 0, 0);
  placedObject.position.y += 0.01;
  scene.add(placedObject);
  updateMarker();

  setStatus(`Layout placed via ${source}`);
}

function autoFitLayout() {
  if (!layoutPrototype) {
    setStatus("Model not loaded yet");
    return;
  }

  if (!placedObject) {
    if (reticle.visible) {
      placeLayoutAtReticle("auto-fit");
    } else {
      // fallback: place in front of the user
      clearPlaced();
      placedObject = cloneLayout();

      const xrCam = renderer.xr.getCamera(camera);
      const camPos = new THREE.Vector3();
      const camQuat = new THREE.Quaternion();
      const forward = new THREE.Vector3(0, 0, -1);

      xrCam.getWorldPosition(camPos);
      xrCam.getWorldQuaternion(camQuat);
      forward.applyQuaternion(camQuat).normalize();

      const target = camPos.clone().add(forward.multiplyScalar(1.2));
      target.y = Math.max(0.05, camPos.y - 1.0);

      placedObject.position.copy(target);
      placedObject.rotation.set(0, 0, 0);
      scene.add(placedObject);
      updateMarker();
    }
  }

  // conservative visible size
  const box = new THREE.Box3().setFromObject(placedObject);
  const size = new THREE.Vector3();
  box.getSize(size);
  const currentMax = Math.max(size.x, size.y, size.z);

  if (currentMax > 0) {
    const targetMax = 1.2; // metres-ish visible size
    const factor = targetMax / currentMax;
    placedObject.scale.multiplyScalar(factor);
  }

  updateMarker();
  setStatus("Auto-fit applied");
}

// ---------- load layout ----------
setStatus("Loading whole_room_setting.glb…");

const loader = new GLTFLoader();
loader.load(
  `${import.meta.env.BASE_URL}models/layouts/whole_room_setting.glb`,
  (gltf) => {
    layoutPrototype = prepareLayout(gltf.scene, 0.05);

    previewObject = layoutPrototype.clone(true);
    previewObject.position.set(0, 0, 0);
    scene.add(previewObject);

    setStatus("Model loaded");
  },
  undefined,
  (error) => {
    console.error("Failed to load whole_room_setting.glb:", error);
    setStatus("Model failed to load");
  }
);

// ---------- XR input ----------
const controller = renderer.xr.getController(0);
controller.addEventListener("select", () => {
  if (!placedObject) {
    placeLayoutAtReticle("xr-select");
  }
});
scene.add(controller);

// ---------- touch controls ----------
let dragActive = false;
let dragMoved = false;
let lastX = 0;
let pinchActive = false;
let lastPinchDistance = 0;

function touchDistance(t1, t2) {
  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

renderer.domElement.addEventListener(
  "touchstart",
  (e) => {
    if (!renderer.xr.isPresenting) return;

    if (e.touches.length === 1) {
      dragActive = true;
      dragMoved = false;
      lastX = e.touches[0].clientX;
    } else if (e.touches.length === 2 && placedObject && !locked) {
      pinchActive = true;
      dragActive = false;
      lastPinchDistance = touchDistance(e.touches[0], e.touches[1]);
    }
  },
  { passive: true }
);

renderer.domElement.addEventListener(
  "touchmove",
  (e) => {
    if (!renderer.xr.isPresenting) return;

    if (e.touches.length === 1 && dragActive && placedObject && !locked) {
      const x = e.touches[0].clientX;
      const dx = x - lastX;
      if (Math.abs(dx) > 1) dragMoved = true;
      placedObject.rotation.y += dx * 0.01;
      lastX = x;
      updateMarker();
      setStatus("Rotate layout");
    }

    if (e.touches.length === 2 && pinchActive && placedObject && !locked) {
      const dist = touchDistance(e.touches[0], e.touches[1]);
      if (lastPinchDistance > 0) {
        const ratio = dist / lastPinchDistance;
        const newScale = placedObject.scale.x * ratio;
        const clamped = THREE.MathUtils.clamp(newScale, 0.005, 5);
        placedObject.scale.setScalar(clamped);
        updateMarker();
        setStatus("Scale layout");
      }
      lastPinchDistance = dist;
    }
  },
  { passive: true }
);

renderer.domElement.addEventListener(
  "touchend",
  () => {
    if (!renderer.xr.isPresenting) return;

    if (dragActive && !dragMoved && !placedObject) {
      placeLayoutAtReticle("tap");
    }

    if (dragActive && !dragMoved && placedObject && locked) {
      setStatus("Layout locked");
    }

    dragActive = false;
    pinchActive = false;
    lastPinchDistance = 0;
  },
  { passive: true }
);

// ---------- buttons ----------
autoFitBtn.addEventListener("click", () => {
  autoFitLayout();
});

lockBtn.addEventListener("click", () => {
  locked = !locked;
  lockBtn.textContent = locked ? "Unlock" : "Lock";
  setStatus(locked ? "Layout locked" : "Layout unlocked");
});

resetBtn.addEventListener("click", () => {
  clearPlaced();
  locked = false;
  lockBtn.textContent = "Lock";
  setStatus("Placement reset — tap to place again");
});

helpBtn.addEventListener("click", () => {
  const hidden = helpEl.style.display === "none";
  helpEl.style.display = hidden ? "block" : "none";
  helpBtn.textContent = hidden ? "Hide help" : "Show help";
});

// ---------- AR button ----------
const arButton = ARButton.createButton(renderer, {
  requiredFeatures: ["hit-test"],
});
document.body.appendChild(arButton);

// ---------- session events ----------
renderer.xr.addEventListener("sessionstart", () => {
  setStatus("AR session started");
  scene.background = null;
  renderer.setClearColor(0x000000, 0);

  previewFloor.visible = false;
  if (previewObject) previewObject.visible = false;
});

renderer.xr.addEventListener("sessionend", () => {
  setStatus("AR session ended");
  scene.background = new THREE.Color(0x202025);
  renderer.setClearColor(0x202025, 1);

  previewFloor.visible = true;
  if (previewObject) previewObject.visible = true;

  reticle.visible = false;
  hitTestSource = null;
  hitTestSourceRequested = false;
});

// ---------- resize ----------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- render loop ----------
renderer.setAnimationLoop((_, frame) => {
  if (!renderer.xr.isPresenting && previewObject) {
    previewObject.rotation.y += 0.003;
  }

  if (frame && renderer.xr.isPresenting) {
    const session = renderer.xr.getSession();

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace("viewer").then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace }).then((source) => {
          hitTestSource = source;
          setStatus("Hit-test ready");
        });
      });

      session.addEventListener("end", () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });

      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const referenceSpace = renderer.xr.getReferenceSpace();
      const hitTestResults = frame.getHitTestResults(hitTestSource);

      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(referenceSpace);

        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);

        if (
          statusEl.textContent !== "Rotate layout" &&
          statusEl.textContent !== "Scale layout" &&
          !statusEl.textContent.startsWith("Layout placed")
        ) {
          setStatus("Surface found — tap to place");
        }
      } else {
        reticle.visible = false;
        if (
          !statusEl.textContent.startsWith("Model") &&
          statusEl.textContent !== "AR session started"
        ) {
          setStatus("Scanning for surface…");
        }
      }
    }
  }

  renderer.render(scene, camera);
});
