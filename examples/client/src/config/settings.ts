import * as THREE from "three";
import { 
  MAX_BUILD_RADIUS, 
  MIN_BUILD_RADIUS, 
  CIRCULAR_BUILD,
  HOTBAR_CONTENT,
  BOT_SCALE,
  DEFAULT_PIXEL_RATIO
} from "./constants";

export const defaultWorldSettings = {
  textureUnitDimension: 8,
  renderRadius: 8,
  timePerDay: 1200,
  chunkSize: 32,
};

export const defaultCameraSettings = {
  fov: 90,
  near: 0.1,
  far: 5000,
  aspect: window.innerWidth / window.innerHeight
};

export const defaultControlSettings = {
  initialPosition: [0, 82, 0],
  flyForce: 400,
};

export const defaultFogSettings = {
  waterColor: new THREE.Color("#5F9DF7"),
  waterNearMultiplier: 0.1,
  waterFarMultiplier: 0.8,
  normalNearMultiplier: 0.7,
  normalFarMultiplier: 1
};

export const defaultItemBarSettings = {
  verticalCount: 1,
  horizontalCount: HOTBAR_CONTENT.length,
  wrapperStyles: {
    left: "50%",
    transform: "translateX(-50%)",
  },
  scrollable: false
};

export const defaultBuildSettings = {
  radius: 1,
  maxRadius: MAX_BUILD_RADIUS,
  minRadius: MIN_BUILD_RADIUS,
  circular: CIRCULAR_BUILD
};

export const defaultGuiSettings = {
  domElementStyle: {
    top: "10px",
  }
};

export const defaultDebugSettings = {
  dataStyles: {
    top: "unset",
    bottom: "10px",
    left: "10px",
  }
};

export const defaultRendererSettings = {
  pixelRatio: DEFAULT_PIXEL_RATIO,
  outputColorSpace: THREE.SRGBColorSpace,
  transparent: true
};

export const defaultBotSettings = {
  scale: BOT_SCALE,
  nameTagOptions: {
    fontFace: "ConnectionSerif-d20X",
  },
};

export const defaultBlockObjectSettings = {
  scale: 0.3,
  rotation: new THREE.Vector3(0, 1, 0),
  rotationAngle: -Math.PI / 4,
  position: new THREE.Vector3(0, -0.15, -0.15),
  material: "basic"
};