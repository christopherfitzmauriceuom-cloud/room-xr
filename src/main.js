import "./style.css";
import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";

let hitTestSource = null;
let hitTestSourceRequested = false;

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.01,
  30
);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.xr.enabled = true;
renderer.setClearColor(0x000000, 0);

document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);
document.body.appendChild(
  ARButton.createButton(renderer, { requiredFeatures: ["hit-test"] })
);

// Light (simple + cheap)
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));

// Reticle (shows where the floor hit-test is)
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.08, 0.11, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial()
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// “Landmark” prototype (swap this for your GLTF landmarks later)
const landmarkProto = new THREE.Mesh(
  new THREE.BoxGeometry(0.25, 0.25, 0.25),
  new THREE.MeshStandardMaterial()
);

// Controller/select = place object on reticle
const controller = renderer.xr.getController(0);
controller.addEventListener("select", () => {
  if (!reticle.visible) return;

  const obj = landmarkProto.clone();
  obj.position.setFromMatrixPosition(reticle.matrix);
  // keep it upright (don’t inherit wall rotations)
  obj.rotation.set(0, 0, 0);

  scene.add(obj);
});
scene.add(controller);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop((_, frame) => {
  if (frame) {
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

