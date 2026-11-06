import {
  WebGLRenderer,
  PerspectiveCamera,
  Scene,
  Vector3,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneBufferGeometry,
  DoubleSide,
} from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls";

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

const floor = new Mesh(
  new PlaneBufferGeometry(100, 100),
  new MeshBasicNodeMaterial({ color: "#112233", side: DoubleSide }),
);
floor.position.y = 1;
floor.rotateX(Math.PI / 2);
scene.add(floor);

// render loop
let lastTime = 0;
const onAnimationFrameHandler = (timeStamp) => {
  controls.update();
  renderer.render(scene, camera);

  lastTime = timeStamp;

  window.requestAnimationFrame(onAnimationFrameHandler);
};
window.requestAnimationFrame(onAnimationFrameHandler);

// resize
const windowResizeHanlder = () => {
  const { innerHeight, innerWidth } = window;
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
windowResizeHanlder();
window.addEventListener("resize", windowResizeHanlder);

// dom
document.body.style.margin = 0;
document.body.appendChild(renderer.domElement);
