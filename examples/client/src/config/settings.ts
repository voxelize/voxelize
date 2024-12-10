import * as THREE from "three";

export const defaultWorldSettings = {
  textureUnitDimension: 8,
  renderRadius: 8,
  timePerDay: 1200,
};

export const defaultCameraSettings = {
  fov: 90,
  near: 0.1,
  far: 5000,
};

export const defaultControlSettings = {
  initialPosition: [0, 82, 0],
  flyForce: 400,
};

export const defaultFogSettings = {
  waterNearMultiplier: 0.1,
  waterFarMultiplier: 0.8,
  normalNearMultiplier: 0.7,
  normalFarMultiplier: 1,
  waterColor: new THREE.Color("#5F9DF7"),
};

export const defaultGuiSettings = {
  domElementStyle: {
    top: "10px",
  },
};

export const defaultDebugSettings = {
  dataStyles: {
    top: "unset",
    bottom: "10px",
    left: "10px",
  },
};