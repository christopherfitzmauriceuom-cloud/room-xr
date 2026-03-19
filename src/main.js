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

// debug box
const debug = document.createElement("div");
debug.style.position = "fixed";
debug.style.top = "12px";
debug.style.left = "12px";
debug.style.padding = "8px 10px";
debug.style.background = "rgba(0,0,0,0.65)";
debug.style.color = "white";
debug.style.fontFamily = "sans-serif";
debug.style.fontSize = "14px";
debug.style.zIndex = "9999";
debug.style.borderRadius = "8px";
debug.style.maxWidth = "70vw";
debug.textContent = "Starting…";
document.body.appendChild(debug);

function setDebug(msg) {
  debug.textContent = msg;
  console.log(msg);
}

// lights
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(3, 5, 2);
scene.add(dirLight);

// desktop preview floor
const previewFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(8, 8),
  new THREE.MeshStandardMaterial({ color: 0x404045 })
);
previewFloor.rotation.x = -Math.PI / 2;
previewFloor.position.y = 0;
scene.add(previewFloor);

// reticle
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.12, 0.18, 48).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff3333, side: THREE.DoubleSide })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// visible red marker cube
function makeOriginMarker() {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.15, 0.15),
    new THREE.MeshBasicMaterial({ color: 0xff0000 })
  );
}

// prepare loaded layout
function prepareLayout(root, scale = 0.2) {
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

// load the combined room layout
setDebug("Loading whole_room_setting.glb…");

const loader = new GLTFLoader();
loader.load(
  `${import.meta.env.BASE_URL}models/layouts/whole_room_setting.glb`,
  (gltf) => {
    layoutPrototype = prepareLayout(gltf.scene, 0.2);

    previewObject = layoutPrototype.clone(true);
    previewObject.position.set(0, 0, 0);
    scene.add(previewObject);

    setDebug("Model loaded");
  },
  undefined,
  (error) => {
    console.error("Failed to load whole_room_setting.glb:", error);
    setDebug("Model failed to load");
  }
);

// placement function
function placeLayout(source = "unknown") {
  console.log("placeLayout from:", source);

  if (!reticle.visible) {
    setDebug("Tap detected, but no surface");
    return;
  }

  if (!layoutPrototype) {
    setDebug("Tap detected, but model not loaded");
    return;
  }

  if (placedObject) scene.remove(placedObject);
  if (placedMarker) scene.remove(placedMarker);

  placedObject = layoutPrototype.clone(true);
  placedObject.position.setFromMatrixPosition(reticle.matrix);
  placedObject.rotation.set(0, 0, 0);
  placedObject.position.y += 0.01;

  scene.add(placedObject);

  placedMarker = makeOriginMarker();
  placedMarker.position.copy(placedObject.position);
  placedMarker.position.y += 0.08;
  scene.add(placedMarker);

  setDebug(`Layout placed via ${source}`);
}

// XR select
const controller = renderer.xr.getController(0);
controller.addEventListener("select", () => {
  placeLayout("xr-select");
});
scene.add(controller);

// phone tap fallback
renderer.domElement.addEventListener("pointerdown", () => {
  if (renderer.xr.isPresenting) {
    placeLayout("pointerdown");
  }
});

// AR button
const arButton = ARButton.createButton(renderer, {
  requiredFeatures: ["hit-test"],
});
document.body.appendChild(arButton);

// session events
renderer.xr.addEventListener("sessionstart", () => {
  setDebug("AR session started");
  scene.background = null;
  renderer.setClearColor(0x000000, 0);

  previewFloor.visible = false;
  if (previewObject) previewObject.visible = false;
});

renderer.xr.addEventListener("sessionend", () => {
  setDebug("AR session ended");
  scene.background = new THREE.Color(0x202025);
  renderer.setClearColor(0x202025, 1);

  previewFloor.visible = true;
  if (previewObject) previewObject.visible = true;

  reticle.visible = false;
  hitTestSource = null;
  hitTestSourceRequested = false;
});

// resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// render loop
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
          setDebug("Hit-test ready");
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

        if (debug.textContent !== "Surface found") {
          setDebug("Surface found");
        }
      } else {
        reticle.visible = false;
        if (debug.textContent !== "Scanning for surface…") {
          setDebug("Scanning for surface…");
        }
      }
    }
  }

  renderer.render(scene, camera);
});
