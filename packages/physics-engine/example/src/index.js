import {
  WebGLRenderer,
  PerspectiveCamera,
  Scene,
  Vector3,
  BoxBufferGeometry,
  MeshBasicMaterial,
  Mesh,
  MeshNormalMaterial,
  PlaneBufferGeometry,
  DoubleSide,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { Engine } from '../../dist';
import { AABB } from '@voxelize/voxel-aabb';

const scene = new Scene();
const camera = new PerspectiveCamera();
const renderer = new WebGLRenderer({ antialias: true });

// camera
camera.position.set(60, 10, 60);
camera.lookAt(new Vector3(0, 0, 0));

// renderer
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x7ec0ee, 1);

// controls
const controls = new OrbitControls(camera, renderer.domElement);

// test
const engine = new Engine(
  (vx, vy, vz) => {
    if (vy <= 0) {
      return [new AABB(0, 0, 0, 1, 1, 1)];
    }

    if (
      vy <= 1 &&
      (vx / 20 > 1 || vx / 20 < -1 || vz / 20 > 1 || vz / 20 < -1)
    ) {
      return [new AABB(0, 0, 0, 1, 0.8, 1)];
    }

    if (vy <= 1 && (vz / 10 > 1 || vz / 10 < -1)) {
      return [new AABB(0, 0, 0, 1, 1.4, 1)];
    }

    if (vy <= 1 && (vx / 10 > 1 || vx / 10 < -1)) {
      return [new AABB(0, 0, 0, 1, 0.4, 1)];
    }

    return [];
  },
  () => false,
  {
    gravity: [0, -24.0, 0],
    minBounceImpulse: 0.5,
    airDrag: 0.1,
    fluidDrag: 1.4,
    fluidDensity: 1.4,
  },
);

const floor = new Mesh(
  new PlaneBufferGeometry(100, 100),
  new MeshBasicMaterial({ color: '#112233', side: DoubleSide }),
);
floor.position.y = 1;
floor.rotateX(Math.PI / 2);
scene.add(floor);

const mat = new MeshNormalMaterial();
const renderAABB = (aabb) => {
  const geo = new BoxBufferGeometry(aabb.width, aabb.height, aabb.depth);
  const mesh = new Mesh(geo, mat);
  mesh.position.set(
    aabb.minX + aabb.width / 2,
    aabb.minY + aabb.height / 2,
    aabb.minZ + aabb.depth / 2,
  );
  return mesh;
};

const updateRBRender = (body, mesh) => {
  const p = body.getPosition();
  mesh.position.set(...p);
};

const body = engine.addBody({
  aabb: new AABB(0, 0, 0, 0.8, 1.8, 0.8),
  autoStep: true,
});
body.setPosition([0, 30, 0]);
const mesh = renderAABB(body.aabb);
scene.add(mesh);

// render loop
let lastTime = 0;
const onAnimationFrameHandler = (timeStamp) => {
  controls.update();
  renderer.render(scene, camera);

  const delta = timeStamp - lastTime;
  engine.update(Math.min(delta / 1000, 0.018));

  updateRBRender(body, mesh);

  lastTime = timeStamp;

  window.requestAnimationFrame(onAnimationFrameHandler);
};
window.requestAnimationFrame(onAnimationFrameHandler);

document.addEventListener('keypress', (event) => {
  if (event.key === 'w') {
    body.applyImpulse([10, 0, 0]);
  } else if (event.key === 's') {
    body.applyImpulse([-10, 0, 0]);
  } else if (event.key === 'a') {
    body.applyImpulse([0, 0, 10]);
  } else if (event.key === 'd') {
    body.applyImpulse([0, 0, -10]);
  } else if (event.key === ' ') {
    body.applyImpulse([0, 10, 0]);
  }
});

// resize
const windowResizeHanlder = () => {
  const { innerHeight, innerWidth } = window;
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
windowResizeHanlder();
window.addEventListener('resize', windowResizeHanlder);

// dom
document.body.style.margin = 0;
document.body.appendChild(renderer.domElement);
