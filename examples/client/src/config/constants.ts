// Server configuration
export const BACKEND_SERVER_INSTANCE = new URL(window.location.href); 
if (BACKEND_SERVER_INSTANCE.origin.includes("localhost")) {
  BACKEND_SERVER_INSTANCE.port = "4000";
}
export const BACKEND_SERVER = BACKEND_SERVER_INSTANCE.toString();

// Storage keys
export const VOXELIZE_LOCALSTORAGE_KEY = "voxelize-world";

// Game constants
export const RANDOM_TELEPORT_WIDTH = 1000000;
export const HOTBAR_CONTENT = [0, 1, 5, 20, 50000, 13131, 45, 300, 1000, 500];

// Build settings
export const MIN_BUILD_RADIUS = 1;
export const MAX_BUILD_RADIUS = 10;