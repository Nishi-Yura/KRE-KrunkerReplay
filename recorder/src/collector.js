/**
 * THREE.jsシーンからデータを収集
 */
class DataCollector {
  /**
   * @param {Object} webContents ElectronのwebContents
   * @param {Object} selectors selector_mapのエントリ
   */
  constructor(webContents, selectors) {
    this.webContents = webContents;
    this.selectors = selectors;
    this.intervalId = null;
    this.frameCallback = null;
  }

  /**
   * 20ms間隔でデータ収集開始
   */
  start() {
    if (this.intervalId) return;
    const script = this._buildExtractScript();
    
    this.intervalId = setInterval(async () => {
      try {
        const data = await this._executeScript(script);
        if (data && typeof this.frameCallback === 'function') {
          this.frameCallback(data);
        }
      } catch (error) {
        console.error('DataCollector: エラーが発生しました:', error);
      }
    }, 20); // 50Hz (1000/50 = 20ms)
  }

  /**
   * 収集停止
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * フレームデータ取得コールバック
   * @param {Function} callback (frames) => void
   */
  onFrame(callback) {
    this.frameCallback = callback;
  }

  /**
   * webContents.executeJavaScript() でシーンを走査
   * @param {string} script 実行するスクリプト
   * @returns {Promise<Object[]>}
   */
  async _executeScript(script) {
    if (!this.webContents) return null;
    return await this.webContents.executeJavaScript(script, true);
  }

  /**
   * selector_mapを使って動的にJS文字列を生成
   * @returns {string} プレイヤーデータを返すスクリプト
   */
  _buildExtractScript() {
    return `
      (function() {
        try {
          const scene = ${this.selectors.scene};
          if (!scene) return null;
          
          const players = [];
          scene.children.forEach(child => {
            const userData = child.userData || {};
            if (${this.selectors.isPlayer}) {
              players.push({
                id: ${this.selectors.playerId} || 0,
                name: ${this.selectors.name} || ('Player ' + (${this.selectors.playerId} || 0)),
                pos: [child.position.x || 0, child.position.y || 0, child.position.z || 0],
                rot: [child.rotation.y || 0, child.rotation.x || 0], // yaw, pitch
                health: ${this.selectors.health} || 0,
                ammo: ${this.selectors.ammo} || 0,
                shooting: ${this.selectors.isShooting} ? 1 : 0,
                scoping: ${this.selectors.isScoping} ? 1 : 0
              });
            }
          });
          return players;
        } catch (e) {
          return null;
        }
      })();
    `;
  }
}

module.exports = DataCollector;
