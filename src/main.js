import "./style.css";
import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";

let hitTestSource = null;
let hitTestSourceRequested = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202025);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.01,
  30
);
camera.position.set(0, 1.2, 2);

// Opaque by default for desktop preview.
// We switch to transparent only when an AR session starts.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(0x202025, 1);
renderer.xr.enabled = true;

const app = document.getElementById("app");
app.innerHTML = "";
app.appendChild(renderer.domElement);

// ---------- lights ----------
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(2, 4, 2);
scene.add(dirLight);

// ---------- desktop fallback preview ----------
const previewFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(4, 4),
  new THREE.MeshStandardMaterial({ color: 0x404045 })
);
previewFloor.rotation.x = -Math.PI / 2;
previewFloor.position.y = -0.25;
scene.add(previewFloor);

const previewCube = new THREE.Mesh(
  new THREE.BoxGeometry(0.25, 0.25, 0.25),
  new THREE.MeshStandardMaterial({ color: 0x55aaff })
);
previewCube.position.set(0, 0, -1);
scene.add(previewCube);

// ---------- reticle for AR hit-test ----------
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.08, 0.11, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// ---------- object prototype to place in AR ----------
const landmarkProto = new THREE.Mesh(
  new THREE.BoxGeometry(0.15, 0.15, 0.15),
  new THREE.MeshStandardMaterial({ color: 0x55aaff })
);

// ---------- AR controller/tap ----------
const controller = renderer.xr.getController(0);
controller.addEventListener("select", () => {
  if (!reticle.visible) return;

  const obj = landmarkProto.clone();
  obj.position.setFromMatrixPosition(reticle.matrix);
  obj.rotation.set(0, 0, 0); // keep upright
  scene.add(obj);
});
scene.add(controller);

// ---------- AR button ----------
const arButton = ARButton.createButton(renderer, {
  requiredFeatures: ["hit-test"],
});
document.body.appendChild(arButton);

// ---------- switch desktop preview <-> AR passthrough ----------
renderer.xr.addEventListener("sessionstart", () => {
  scene.background = null;
  renderer.setClearColor(0x000000, 0);

  previewFloor.visible = false;
  previewCube.visible = false;
});

renderer.xr.addEventListener("sessionend", () => {
  scene.background = new THREE.Color(0x202025);
  renderer.setClearColor(0x202025, 1);

  previewFloor.visible = true;
  previewCube.visible = true;

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
  if (!renderer.xr.isPresenting) {
    previewCube.rotation.y += 0.01;
  }

  if (frame && renderer.xr.isPresenting) {
    const session = renderer.xr.getSession();

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace("viewer").then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace }).then((source) => {
          hitTestSource = source;
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
      } else {
        reticle.visible = false;
      }
    }
  }

  renderer.render(scene, camera);
});
