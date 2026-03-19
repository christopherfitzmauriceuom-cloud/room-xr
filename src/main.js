import "./style.css";
import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Big Buddha intentionally ignored
const LANDMARKS = [
  {
    key: "eiffel_tower",
    label: "Eiffel Tower",
    url: "models/landmarks/eiffel_tower.glb",
    startScale: 0.18,
  },
  {
    key: "statue_of_liberty",
    label: "Statue of Liberty",
    url: "models/landmarks/statue_of_liberty.glb",
    startScale: 0.18,
  },
  {
    key: "colosseum",
    label: "Colosseum",
    url: "models/landmarks/colosseum.glb",
    startScale: 0.14,
  },
  {
    key: "empire_state_building",
    label: "Empire State Building",
    url: "models/landmarks/empire_state_building.glb",
    startScale: 0.12,
  },
  {
    key: "buckingham_palace",
    label: "Buckingham Palace",
    url: "models/landmarks/buckingham_palace.glb",
    startScale: 0.14,
  },
];

let hitTestSource = null;
let hitTestSourceRequested = false;

let currentIndex = 0;
let selectedMeta = LANDMARKS[0];
let selectedTemplate = null;
let previewObject = null;

let activePlaced = null;
const placedItems = [];

let dragActive = false;
let dragMoved = false;
let lastX = 0;
let pinchActive = false;
let lastPinchDistance = 0;

let lastTapTime = 0;
let lastTapX = 0;
let lastTapY = 0;

const templates = new Map();
const loader = new GLTFLoader();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// ---------- scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202025);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.01,
  100
);
camera.position.set(0, 1.4, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(1);
renderer.setClearColor(0x202025, 1);
renderer.xr.enabled = true;

const app = document.getElementById("app");
app.innerHTML = "";
app.appendChild(renderer.domElement);

// ---------- desktop controls ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.6, 0);
controls.update();

// ---------- lights ----------
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(3, 5, 2);
scene.add(dirLight);

// ---------- preview floor ----------
const previewFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(8, 8),
  new THREE.MeshStandardMaterial({ color: 0x404045 })
);
previewFloor.rotation.x = -Math.PI / 2;
previewFloor.position.y = 0;
scene.add(previewFloor);

// ---------- AR reticle ----------
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.08, 0.12, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff3333, side: THREE.DoubleSide })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// ---------- selection ring ----------
const selectionRing = new THREE.Mesh(
  new THREE.RingGeometry(0.85, 1.0, 48).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffcc33, side: THREE.DoubleSide })
);
selectionRing.visible = false;
scene.add(selectionRing);

// ---------- UI overlay ----------
const overlay = document.createElement("div");
overlay.style.position = "fixed";
overlay.style.inset = "0";
overlay.style.pointerEvents = "none";
overlay.style.fontFamily = "system-ui, sans-serif";
overlay.style.zIndex = "9999";
document.body.appendChild(overlay);

const panel = document.createElement("div");
panel.style.position = "fixed";
panel.style.top = "12px";
panel.style.left = "12px";
panel.style.maxWidth = "340px";
panel.style.padding = "12px";
panel.style.background = "rgba(0,0,0,0.74)";
panel.style.color = "white";
panel.style.borderRadius = "12px";
panel.style.pointerEvents = "auto";
overlay.appendChild(panel);

panel.addEventListener("beforexrselect", (e) => {
  e.preventDefault();
});

const title = document.createElement("div");
title.textContent = "Landmark AR";
title.style.fontWeight = "700";
title.style.marginBottom = "8px";
panel.appendChild(title);

const statusEl = document.createElement("div");
statusEl.textContent = "Loading...";
statusEl.style.color = "#bfe3ff";
statusEl.style.marginBottom = "10px";
panel.appendChild(statusEl);

const helpEl = document.createElement("div");
helpEl.style.marginBottom = "10px";
helpEl.innerHTML =
  "<div><strong>How to use</strong></div>" +
  "<div>1. Choose a landmark.</div>" +
  "<div>2. Scan the floor until the red ring appears.</div>" +
  "<div>3. Tap the floor to place the selected landmark.</div>" +
  "<div>4. Tap an existing landmark to select it.</div>" +
  "<div>5. Drag with one finger to rotate the selected landmark.</div>" +
  "<div>6. Pinch with two fingers to resize the selected landmark.</div>" +
  "<div>7. Double-tap a selected landmark to lock or unlock it.</div>";
panel.appendChild(helpEl);

const selectedInfo = document.createElement("div");
selectedInfo.style.marginTop = "10px";
selectedInfo.style.marginBottom = "10px";
selectedInfo.style.color = "#ffd27a";
selectedInfo.textContent = "No placed landmark selected";
panel.appendChild(selectedInfo);

const select = document.createElement("select");
select.style.width = "100%";
select.style.marginBottom = "10px";
select.style.padding = "8px";
select.style.borderRadius = "8px";
select.style.background = "#222";
select.style.color = "white";
select.style.border = "1px solid #555";

LANDMARKS.forEach((m, i) => {
  const opt = document.createElement("option");
  opt.value = String(i);
  opt.textContent = m.label;
  select.appendChild(opt);
});

panel.appendChild(select);

const row = document.createElement("div");
row.style.display = "flex";
row.style.flexWrap = "wrap";
row.style.gap = "8px";
row.style.marginTop = "8px";
panel.appendChild(row);

function makeButton(label) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.style.padding = "8px 10px";
  btn.style.borderRadius = "10px";
  btn.style.border = "1px solid rgba(255,255,255,0.18)";
  btn.style.background = "rgba(255,255,255,0.10)";
  btn.style.color = "white";
  btn.style.cursor = "pointer";
  btn.style.pointerEvents = "auto";
  btn.addEventListener("beforexrselect", (e) => {
    e.preventDefault();
  });
  return btn;
}

const autoFitBtn = makeButton("Auto-fit");
const lockBtn = makeButton("Lock/Unlock");
const resetBtn = makeButton("Remove selected");
const clearBtn = makeButton("Clear all");
const nextBtn = makeButton("Next");
const helpBtn = makeButton("Hide help");

row.appendChild(autoFitBtn);
row.appendChild(lockBtn);
row.appendChild(resetBtn);
row.appendChild(clearBtn);
row.appendChild(nextBtn);
row.appendChild(helpBtn);

function setStatus(msg) {
  if (statusEl.textContent !== msg) {
    statusEl.textContent = msg;
    console.log(msg);
  }
}

function updateSelectedInfo() {
  if (!activePlaced) {
    selectedInfo.textContent = "No placed landmark selected";
    return;
  }

  const label = activePlaced.userData.label || "Selected";
  const state = activePlaced.userData.locked ? "locked" : "editable";
  selectedInfo.textContent = "Selected: " + label + " (" + state + ")";
}

function setSelectionRingColor() {
  if (!activePlaced) return;
  selectionRing.material.color.set(activePlaced.userData.locked ? 0x22cc66 : 0xffcc33);
}

function updateSelectionRing() {
  if (!activePlaced) {
    selectionRing.visible = false;
    return;
  }

  const box = new THREE.Box3().setFromObject(activePlaced);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  selectionRing.position.set(center.x, box.min.y + 0.01, center.z);

  const radius = Math.max(size.x, size.z) * 0.65;
  selectionRing.scale.setScalar(Math.max(0.15, radius));

  setSelectionRingColor();
  selectionRing.visible = true;
  updateSelectedInfo();
}

function prepareModel(root, scale) {
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

  const box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);

  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;

  return root;
}

function refreshPreview() {
  if (previewObject) {
    scene.remove(previewObject);
    previewObject = null;
  }

  if (selectedTemplate && !renderer.xr.isPresenting) {
    previewObject = selectedTemplate.clone(true);
    previewObject.position.set(0, 0, 0);
    scene.add(previewObject);
  }
}

function clearAllPlaced() {
  while (placedItems.length > 0) {
    const item = placedItems.pop();
    scene.remove(item);
  }
  activePlaced = null;
  selectionRing.visible = false;
  updateSelectedInfo();
}

function removeActivePlaced() {
  if (!activePlaced) return;

  const index = placedItems.indexOf(activePlaced);
  if (index >= 0) {
    placedItems.splice(index, 1);
  }

  scene.remove(activePlaced);
  activePlaced = null;
  selectionRing.visible = false;
  updateSelectedInfo();
}

function cloneSelected() {
  return selectedTemplate ? selectedTemplate.clone(true) : null;
}

function ensureTemplate(meta) {
  if (templates.has(meta.key)) {
    selectedTemplate = templates.get(meta.key);
    refreshPreview();
    setStatus("Selected landmark: " + meta.label);
    return;
  }

  selectedTemplate = null;
  refreshPreview();
  setStatus("Loading " + meta.label + "...");

  loader.load(
    `${import.meta.env.BASE_URL}${meta.url}`,
    (gltf) => {
      const root = prepareModel(gltf.scene, meta.startScale);
      templates.set(meta.key, root);

      if (selectedMeta.key === meta.key) {
        selectedTemplate = root;
        refreshPreview();
        setStatus("Selected landmark: " + meta.label);
      }
    },
    undefined,
    (error) => {
      console.error("Failed to load " + meta.key + ":", error);
      if (selectedMeta.key === meta.key) {
        setStatus("Failed to load " + meta.label);
      }
    }
  );
}

function setSelected(index) {
  currentIndex = index;
  selectedMeta = LANDMARKS[index];
  select.value = String(index);
  ensureTemplate(selectedMeta);
}

function selectPlaced(root) {
  activePlaced = root;
  updateSelectionRing();
  setStatus("Selected placed " + (root.userData.label || "landmark"));
}

function placeSelected(source) {
  if (!reticle.visible) {
    setStatus("No floor detected yet");
    return;
  }

  if (!selectedTemplate) {
    setStatus("Selected model not loaded yet");
    return;
  }

  const item = cloneSelected();
  item.position.setFromMatrixPosition(reticle.matrix);
  item.rotation.set(0, 0, 0);
  item.position.y += 0.01;

  item.userData.isPlacedRoot = true;
  item.userData.key = selectedMeta.key;
  item.userData.label = selectedMeta.label;
  item.userData.locked = false;

  scene.add(item);
  placedItems.push(item);
  selectPlaced(item);

  setStatus("Placed " + selectedMeta.label + " via " + source);
}

function autoFitActive() {
  if (!activePlaced) {
    setStatus("No selected landmark to auto-fit");
    return;
  }

  const box = new THREE.Box3().setFromObject(activePlaced);
  const size = new THREE.Vector3();
  box.getSize(size);
  const currentMax = Math.max(size.x, size.y, size.z);

  if (currentMax > 0) {
    const targetMax = 0.8;
    const factor = targetMax / currentMax;
    activePlaced.scale.multiplyScalar(factor);
    updateSelectionRing();
  }

  setStatus("Auto-fit " + activePlaced.userData.label);
}

function toggleLockActive() {
  if (!activePlaced) {
    setStatus("No selected landmark");
    return;
  }

  activePlaced.userData.locked = !activePlaced.userData.locked;
  updateSelectionRing();

  setStatus(
    activePlaced.userData.locked
      ? activePlaced.userData.label + " locked"
      : activePlaced.userData.label + " unlocked"
  );
}

function getPlacedRootFromObject(obj) {
  let current = obj;
  while (current) {
    if (current.userData && current.userData.isPlacedRoot) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function getPlacedRootAtScreen(clientX, clientY) {
  if (placedItems.length === 0) return null;

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera;
  raycaster.setFromCamera(pointer, activeCamera);

  const hits = raycaster.intersectObjects(placedItems, true);
  if (hits.length === 0) return null;

  return getPlacedRootFromObject(hits[0].object);
}

function touchDistance(t1, t2) {
  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;
  return Math.hypot(dx, dy);
}

// ---------- UI events ----------
select.addEventListener("change", () => {
  setSelected(Number(select.value));
});

autoFitBtn.addEventListener("click", () => {
  autoFitActive();
});

lockBtn.addEventListener("click", () => {
  toggleLockActive();
});

resetBtn.addEventListener("click", () => {
  removeActivePlaced();
  setStatus("Removed selected landmark");
});

clearBtn.addEventListener("click", () => {
  clearAllPlaced();
  setStatus("Cleared all placed landmarks");
});

nextBtn.addEventListener("click", () => {
  const next = (currentIndex + 1) % LANDMARKS.length;
  setSelected(next);
});

helpBtn.addEventListener("click", () => {
  const hidden = helpEl.style.display === "none";
  helpEl.style.display = hidden ? "block" : "none";
  helpBtn.textContent = hidden ? "Hide help" : "Show help";
});

// ---------- AR button ----------
const arButton = ARButton.createButton(renderer, {
  requiredFeatures: ["hit-test"],
  optionalFeatures: ["dom-overlay"],
  domOverlay: { root: overlay },
});
document.body.appendChild(arButton);

// ---------- session events ----------
renderer.xr.addEventListener("sessionstart", () => {
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  previewFloor.visible = false;
  if (previewObject) previewObject.visible = false;
  setStatus("AR started - scan floor and tap to place " + selectedMeta.label);
});

renderer.xr.addEventListener("sessionend", () => {
  scene.background = new THREE.Color(0x202025);
  renderer.setClearColor(0x202025, 1);
  previewFloor.visible = true;
  if (previewObject) previewObject.visible = true;

  reticle.visible = false;
  hitTestSource = null;
  hitTestSourceRequested = false;
  setStatus("AR ended");
});

// ---------- XR select backup ----------
const controller = renderer.xr.getController(0);
controller.addEventListener("select", () => {
  if (!activePlaced) {
    placeSelected("xr-select");
  }
});
scene.add(controller);

// ---------- touch controls ----------
renderer.domElement.addEventListener(
  "touchstart",
  (e) => {
    if (!renderer.xr.isPresenting) return;

    if (e.touches.length === 1) {
      dragActive = true;
      dragMoved = false;
      lastX = e.touches[0].clientX;
    } else if (
      e.touches.length === 2 &&
      activePlaced &&
      !activePlaced.userData.locked
    ) {
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

    if (
      e.touches.length === 1 &&
      dragActive &&
      activePlaced &&
      !activePlaced.userData.locked
    ) {
      const x = e.touches[0].clientX;
      const dx = x - lastX;

      if (Math.abs(dx) > 1) {
        dragMoved = true;
      }

      activePlaced.rotation.y += dx * 0.01;
      lastX = x;
      updateSelectionRing();
      setStatus("Rotate " + activePlaced.userData.label);
    }

    if (
      e.touches.length === 2 &&
      pinchActive &&
      activePlaced &&
      !activePlaced.userData.locked
    ) {
      const dist = touchDistance(e.touches[0], e.touches[1]);

      if (lastPinchDistance > 0) {
        const ratio = dist / lastPinchDistance;
        const nextScale = THREE.MathUtils.clamp(
          activePlaced.scale.x * ratio,
          0.01,
          3
        );

        activePlaced.scale.setScalar(nextScale);
        updateSelectionRing();
        setStatus("Scale " + activePlaced.userData.label);
      }

      lastPinchDistance = dist;
    }
  },
  { passive: true }
);

renderer.domElement.addEventListener(
  "touchend",
  (e) => {
    if (!renderer.xr.isPresenting) return;

    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) {
      dragActive = false;
      pinchActive = false;
      lastPinchDistance = 0;
      return;
    }

    if (dragActive && !dragMoved) {
      const tappedRoot = getPlacedRootAtScreen(touch.clientX, touch.clientY);
      const now = performance.now();

      if (tappedRoot) {
        if (activePlaced !== tappedRoot) {
          selectPlaced(tappedRoot);
          lastTapTime = now;
          lastTapX = touch.clientX;
          lastTapY = touch.clientY;
        } else {
          const closeToLastTap =
            Math.abs(touch.clientX - lastTapX) < 24 &&
            Math.abs(touch.clientY - lastTapY) < 24;

          if (now - lastTapTime < 320 && closeToLastTap) {
            toggleLockActive();
            lastTapTime = 0;
          } else {
            lastTapTime = now;
            lastTapX = touch.clientX;
            lastTapY = touch.clientY;

            setStatus(
              activePlaced.userData.locked
                ? "Double-tap " + activePlaced.userData.label + " to unlock"
                : "Double-tap " + activePlaced.userData.label + " to lock"
            );
          }
        }
      } else {
        placeSelected("tap");
      }
    }

    dragActive = false;
    pinchActive = false;
    lastPinchDistance = 0;
  },
  { passive: true }
);

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
      const results = frame.getHitTestResults(hitTestSource);

      if (results.length > 0) {
        const hit = results[0];
        const pose = hit.getPose(referenceSpace);

        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);

        if (!activePlaced) {
          setStatus("Surface found - tap to place " + selectedMeta.label);
        }
      } else {
        reticle.visible = false;
        if (!activePlaced) {
          setStatus("Scanning for floor...");
        }
      }
    }
  }

  renderer.render(scene, camera);
});

// ---------- start ----------
setSelected(0);
