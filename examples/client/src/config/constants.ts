// Server configuration
export const BACKEND_SERVER_INSTANCE = new URL(window.location.href); 
if (BACKEND_SERVER_INSTANCE.origin.includes("localhost")) {
  BACKEND_SERVER_INSTANCE.port = "4000";
}
export const BACKEND_SERVER = BACKEND_SERVER_INSTANCE.toString();

// Network settings
export const NETWORK_SECRET = "test";

// Storage keys
export const VOXELIZE_LOCALSTORAGE_KEY = "voxelize-world";

// Game constants
export const RANDOM_TELEPORT_WIDTH = 1000000;
export const HOTBAR_CONTENT = [0, 1, 5, 20, 50000, 13131, 45, 300, 1000, 500];

// Build settings
export const MIN_BUILD_RADIUS = 1;
export const MAX_BUILD_RADIUS = 10;
export const CIRCULAR_BUILD = true;

// Biome settings
export const BIOME_SHADE_WEIGHT = 0.2;

// Renderer settings
export const DEFAULT_PIXEL_RATIO = 1;

// Animation settings
export const ANIMATION_FRAME_RATE = 1000 / 60;
export const LOADING_FADE = 500;

// Face configurations
export const ALL_FACES = ["px", "nx", "py", "ny", "pz", "nz"];
export const SIDE_FACES = ["px", "nx", "pz", "nz"];
export const DIAGONAL_FACES = ["one1", "one2", "two1", "two2"];

// Bot settings
export const BOT_HEAD_COLOR = "#F99417";
export const BOT_HEAD_FRONT_COLOR = "#F4CE14";
export const BOT_SCALE = 0.5;

// Item bar configuration
export const ITEM_BAR_KEYS = [
  "Digit1", "Digit2", "Digit3", "Digit4", "Digit5",
  "Digit6", "Digit7", "Digit8", "Digit9", "Digit0"
];
