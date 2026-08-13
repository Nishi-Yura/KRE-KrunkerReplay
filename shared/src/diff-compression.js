/**
 * 差分圧縮・解凍ロジック
 */
const THRESHOLD = 0.01;

// changedFields ビットマスクフラグ
const Fields = {
  POS_X: 1 << 0,
  POS_Y: 1 << 1,
  POS_Z: 1 << 2,
  ROT_YAW: 1 << 3,
  ROT_PITCH: 1 << 4,
  HEALTH: 1 << 5,
  AMMO: 1 << 6,
  IS_SHOOTING: 1 << 7,
  IS_SCOPING: 1 << 8,
  EVENT_TYPE: 1 << 9,
  EVENT_VICTIM: 1 << 10
};

/**
 * 前フレームとの差分を計算し、変化量が閾値未満の座標はスキップフラグを立てる
 * @param {Object} prevFrame 前フレーム
 * @param {Object} currentFrame 現在のフレーム
 * @returns {Object} 差分フレーム
 */
function compressFrame(prevFrame, currentFrame) {
  if (!prevFrame) {
    // 最初のフレームはすべて変更として扱う
    return {
      ...currentFrame,
      changedFields: 0xFFFF // すべてのフラグを立てる
    };
  }

  let changedFields = 0;
  const diffFrame = {
    timestamp: currentFrame.timestamp,
    playerId: currentFrame.playerId
  };

  if (Math.abs(currentFrame.posX - prevFrame.posX) >= THRESHOLD) {
    changedFields |= Fields.POS_X;
    diffFrame.posX = currentFrame.posX;
  }
  if (Math.abs(currentFrame.posY - prevFrame.posY) >= THRESHOLD) {
    changedFields |= Fields.POS_Y;
    diffFrame.posY = currentFrame.posY;
  }
  if (Math.abs(currentFrame.posZ - prevFrame.posZ) >= THRESHOLD) {
    changedFields |= Fields.POS_Z;
    diffFrame.posZ = currentFrame.posZ;
  }
  if (Math.abs(currentFrame.rotYaw - prevFrame.rotYaw) >= THRESHOLD) {
    changedFields |= Fields.ROT_YAW;
    diffFrame.rotYaw = currentFrame.rotYaw;
  }
  if (Math.abs(currentFrame.rotPitch - prevFrame.rotPitch) >= THRESHOLD) {
    changedFields |= Fields.ROT_PITCH;
    diffFrame.rotPitch = currentFrame.rotPitch;
  }
  if (currentFrame.health !== prevFrame.health) {
    changedFields |= Fields.HEALTH;
    diffFrame.health = currentFrame.health;
  }
  if (currentFrame.ammo !== prevFrame.ammo) {
    changedFields |= Fields.AMMO;
    diffFrame.ammo = currentFrame.ammo;
  }
  if (currentFrame.isShooting !== prevFrame.isShooting) {
    changedFields |= Fields.IS_SHOOTING;
    diffFrame.isShooting = currentFrame.isShooting;
  }
  if (currentFrame.isScoping !== prevFrame.isScoping) {
    changedFields |= Fields.IS_SCOPING;
    diffFrame.isScoping = currentFrame.isScoping;
  }
  if (currentFrame.eventType !== prevFrame.eventType) {
    changedFields |= Fields.EVENT_TYPE;
    diffFrame.eventType = currentFrame.eventType;
  }
  if (currentFrame.eventVictim !== prevFrame.eventVictim) {
    changedFields |= Fields.EVENT_VICTIM;
    diffFrame.eventVictim = currentFrame.eventVictim;
  }

  diffFrame.changedFields = changedFields;
  return diffFrame;
}

/**
 * 差分から完全なフレームを再構築する
 * @param {Object} prevFrame 前フレーム
 * @param {Object} diffFrame 差分フレーム
 * @returns {Object} 復元された完全フレーム
 */
function decompressFrame(prevFrame, diffFrame) {
  if (!prevFrame) {
    return { ...diffFrame }; // 初回用
  }

  const { changedFields } = diffFrame;
  const currentFrame = {
    timestamp: diffFrame.timestamp,
    playerId: diffFrame.playerId
  };

  currentFrame.posX = (changedFields & Fields.POS_X) ? diffFrame.posX : prevFrame.posX;
  currentFrame.posY = (changedFields & Fields.POS_Y) ? diffFrame.posY : prevFrame.posY;
  currentFrame.posZ = (changedFields & Fields.POS_Z) ? diffFrame.posZ : prevFrame.posZ;
  currentFrame.rotYaw = (changedFields & Fields.ROT_YAW) ? diffFrame.rotYaw : prevFrame.rotYaw;
  currentFrame.rotPitch = (changedFields & Fields.ROT_PITCH) ? diffFrame.rotPitch : prevFrame.rotPitch;
  currentFrame.health = (changedFields & Fields.HEALTH) ? diffFrame.health : prevFrame.health;
  currentFrame.ammo = (changedFields & Fields.AMMO) ? diffFrame.ammo : prevFrame.ammo;
  currentFrame.isShooting = (changedFields & Fields.IS_SHOOTING) ? diffFrame.isShooting : prevFrame.isShooting;
  currentFrame.isScoping = (changedFields & Fields.IS_SCOPING) ? diffFrame.isScoping : prevFrame.isScoping;
  currentFrame.eventType = (changedFields & Fields.EVENT_TYPE) ? diffFrame.eventType : prevFrame.eventType;
  currentFrame.eventVictim = (changedFields & Fields.EVENT_VICTIM) ? diffFrame.eventVictim : prevFrame.eventVictim;

  return currentFrame;
}

module.exports = { compressFrame, decompressFrame, Fields };
