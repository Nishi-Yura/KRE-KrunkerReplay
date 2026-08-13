const net = require('net');
const { EventTypes } = require('@krunker-replay/shared/src/event-types');

/**
 * WebSocket通信の傍受クラス
 */
class WebSocketMonitor {
  constructor() {
    this.server = null;
    this.matchStartCallback = null;
    this.matchEndCallback = null;
    this.isRunning = false;
  }

  /**
   * net.createServerでWebSocket通信を傍受開始
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // 実際にはプロキシやパケットキャプチャを用いてWebSocketパケットを傍受する
    // ここでは簡易的なモックサーバーとする
    this.server = net.createServer((socket) => {
      socket.on('data', (data) => {
        const event = this.parseKrunkerPacket(data);
        if (event === 'join_game' && this.matchStartCallback) {
          this.matchStartCallback();
        } else if (event === 'game_over' && this.matchEndCallback) {
          this.matchEndCallback();
        }
      });
    });

    // 適切なポートでlistenする必要がある（今回はダミーポート）
    this.server.listen(18080, () => {
      console.log('WebSocketMonitor: Listening on port 18080');
    });
  }

  /**
   * 試合開始イベントコールバック
   * @param {Function} callback 
   */
  onMatchStart(callback) {
    this.matchStartCallback = callback;
  }

  /**
   * 試合終了イベントコールバック
   * @param {Function} callback 
   */
  onMatchEnd(callback) {
    this.matchEndCallback = callback;
  }

  /**
   * Krunkerのパケットをパースしてイベント種別を返す
   * @param {Buffer} data 
   * @returns {string|null} イベント名
   */
  parseKrunkerPacket(data) {
    // 実際のパケットパースロジック
    // バイナリ解析が必要
    try {
      const payload = data.toString('utf8');
      if (payload.includes('join_game')) return 'join_game';
      if (payload.includes('game_over')) return 'game_over';
    } catch (e) {
      // パース失敗
    }
    return null;
  }

  /**
   * 監視停止
   */
  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.isRunning = false;
  }
}

module.exports = WebSocketMonitor;
