/**
 * .kreファイルフォーマットの定数・型定義
 */
const MAGIC_BYTES = Buffer.from([0x4B, 0x52, 0x45, 0x00]); // 'KRE\0'
const VERSION = 0x04; // v4: 座標 int32 / チャンク長プレフィックス
const HEADER_SIZE = 64; // バイト

const HeaderOffsets = {
  RECORDED_AT: 4,      // uint64 (8 bytes)
  CLIENT_VERSION: 12,  // uint32 (4 bytes)
  MAP_ID: 16,          // uint32 (4 bytes)
  MAP_NAME: 20,        // string (32 bytes)
  GAME_MODE: 52,       // uint8 (1 byte)
  PLAYER_COUNT: 53,    // uint8 (1 byte)
  DURATION_MS: 54,     // uint32 (4 bytes)
  FRAME_COUNT: 58,     // uint32 (4 bytes)
  SAMPLE_RATE: 62,     // uint8 (1 byte)
  RESERVED: 63         // padding (1 byte instead of 5, to keep HEADER_SIZE=64)
};

const FieldSizes = {
  RECORDED_AT: 8,
  CLIENT_VERSION: 4,
  MAP_ID: 4,
  MAP_NAME: 32,
  GAME_MODE: 1,
  PLAYER_COUNT: 1,
  DURATION_MS: 4,
  FRAME_COUNT: 4,
  SAMPLE_RATE: 1,
  RESERVED: 1
};

// 1フレームの各プレイヤーのデータサイズ
const FRAME_PLAYER_SIZE = 22;

const GameModes = {
  FFA: 0,
  TDM: 1,
  KOTH: 2,
  CTF: 3,
  DEF: 4,
  INFECTION: 5,
  PARKOUR: 6,
  HIDE_AND_SEEK: 7
};

const CHUNK_FRAME_COUNT = 1000;

module.exports = {
  MAGIC_BYTES,
  VERSION,
  HEADER_SIZE,
  HeaderOffsets,
  FieldSizes,
  GameModes,
  CHUNK_FRAME_COUNT,
  FRAME_PLAYER_SIZE
};
