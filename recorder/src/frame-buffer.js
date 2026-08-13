/**
 * フレームデータのメモリバッファ管理
 */
class FrameBuffer {
  /**
   * @param {number} chunkSize チャンクあたりのフレーム数
   */
  constructor(chunkSize = 1000) {
    this.chunkSize = chunkSize;
    this.buffer = [];
    this.totalFrames = 0;
    this.flushCallback = null;
  }

  /**
   * フレームをバッファに追加。バッファがchunkSizeに達したらflushCallbackを呼ぶ
   * @param {Object} frameData フレームデータ
   */
  addFrame(frameData) {
    this.buffer.push(frameData);
    this.totalFrames++;

    if (this.buffer.length >= this.chunkSize) {
      this.flush();
    }
  }

  /**
   * チャンク書き出しコールバック登録
   * @param {Function} callback コールバック関数 (frames) => void
   */
  onFlush(callback) {
    this.flushCallback = callback;
  }

  /**
   * 残バッファを強制フラッシュ
   */
  flush() {
    if (this.buffer.length > 0 && typeof this.flushCallback === 'function') {
      this.flushCallback([...this.buffer]);
      this.buffer = [];
    }
  }

  /**
   * 累積フレーム数を返す
   * @returns {number} 累積フレーム数
   */
  getFrameCount() {
    return this.totalFrames;
  }

  /**
   * バッファをリセット
   */
  clear() {
    this.buffer = [];
    this.totalFrames = 0;
  }
}

module.exports = FrameBuffer;
