/**
 * イベント種別定数（0〜15のuint4に対応）
 */
const EventTypes = {
  NONE: 0,
  KILL: 1,
  DEATH: 2,
  RESPAWN: 3,
  ROUND_END: 4,
  ROUND_START: 5,
  MATCH_START: 6,
  MATCH_END: 7,
  // 8-15は予約済み
};

module.exports = { EventTypes };
