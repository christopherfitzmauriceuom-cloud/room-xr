import "./style.css";
import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

let hitTestSource = null;
let hitTestSourceRequested = false;
let layoutPrototype = null;
let previewObject = null;
let placedObject = null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202025);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.01,
  50
);
camera.position.set(0, 1.5, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(0x202025, 1);
renderer.xr.enabled = true;

const app = document.getElementById("app");
app.innerHTML = "";
app.appendChild(renderer.domElement);

// lights
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(3, 5, 2);
scene.add(dirLight);

// preview floor
const previewFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(6, 6),
  new THREE.MeshStandardMaterial({ color: 0x404045 })
);
previewFloor.rotation.x = -Math.PI / 2;
previewFloor.position.y = 0;
scene.add(previewFloor);

// reticle
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.08, 0.11, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// helper: make a loaded model easier to view/place
function prepareLayout(root, scale = 1) {
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
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });

  // centre horizontally and place its lowest point on y = 0
  const box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);

  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;

  return root;
}

const loader = new GLTFLoader();
loader.load(
  `${import.meta.env.BASE_URL}models/layouts/whole_room_setting.glb`,
  (gltf) => {
    layoutPrototype = prepareLayout(gltf.scene, 1);

    // desktop preview copy
    previewObject = layoutPrototype.clone(true);
    previewObject.position.set(0, 0, 0);
    scene.add(previewObject);

    console.log("whole_room_setting.glb loaded");
  },
  undefined,
  (error) => {
    console.error("Failed to load whole_room_setting.glb:", error);
  }
);

// controller tap = place whole layout
const controller = renderer.xr.getController(0);
controller.addEventListener("select", () => {
  if (!reticle.visible || !layoutPrototype) return;

  if (placedObject) {
    scene.remove(placedObject);
  }

  placedObject = layoutPrototype.clone(true);
  placedObject.position.setFromMatrixPosition(reticle.matrix);
  placedObject.rotation.set(0, 0, 0);

  scene.add(placedObject);
});
scene.add(controller);

// AR button
const arButton = ARButton.createButton(renderer, {
  requiredFeatures: ["hit-test"],
});
document.body.appendChild(arButton);

// switch desktop preview <-> AR
renderer.xr.addEventListener("sessionstart", () => {
  scene.background = null;
  renderer.setClearColor(0x000000, 0);

  previewFloor.visible = false;
  if (previewObject) previewObject.visible = false;
});

renderer.xr.addEventListener("sessionend", () => {
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
