// config.js — Constantes globales du jeu
// Référence : _specifications/technical-architecture.md #2

export const GAME_WIDTH  = 640;
export const GAME_HEIGHT = 360;
export const ZOOM        = 2;    // Affiché en 1280×720

// Physique
export const GRAVITY        = 900;
export const PLAYER_SPEED   = 200;
export const PLAYER_JUMP    = -620;
export const PLAYER_MAX_SPD = 280;
export const COYOTE_TIME    = 120;  // ms
export const INPUT_BUFFER   = 400;  // ms
export const GRIND_SNAP     = 24;   // px (16 pour bambou)

// Tilemap
export const TILE_SIZE = 16;       // px
export const GROUND_Y  = 288;      // px

// Sauvegarde
export const SAVE_KEY = 'kokoro_kintsugi_save';

// Progression — seuils de débloquage (cracks dorées)
export const UNLOCK_THRESHOLDS = {
  street:   0,
  skatepark: 5,
  rooftop:  17,
  tunnel:   29,
  garden:   42,
};

export const TOTAL_CRACKS = 60;

// Palette de couleurs
export const COLORS = {
  bg:          0x0a0a0a,
  boardBlack:  0x1a1a2e,
  crackGrey:   0x8a8a9a,
  crackGold:   0xd4a017,
  crackBright: 0xf5c842,
};

// EventBus — noms des événements
export const EVENTS = {
  TRICK_ATTEMPT: 'trick:attempt',
  TRICK_SUCCESS: 'trick:success',
  TRICK_FAIL:    'trick:fail',
  CRACK_GREY:    'crack:grey',
  CRACK_GOLD:    'crack:gold',
  ENV_UNLOCK:    'env:unlock',
  BOARD_COMPLETE:'board:complete',
};
