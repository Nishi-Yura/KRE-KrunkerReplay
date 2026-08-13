const path = require('path');
const os = require('os');
const DataCollector = require('./collector');
const FrameBuffer = require('./frame-buffer');
const KreWriter = require('./kre-writer');
const { compressFrame } = require('@krunker-replay/shared/src/diff-compression');
const config = require('../config/config.json');


/**
 * Recorderのエントリポイント
 */
class Recorder {
  constructor() {
    this.app = null;
    this.webContents = null;
    this.collector = null;
    this.frameBuffer = null;
    this.writer = null;
    this.status = 'idle';
    this.matchStartTime = 0;
    this.prevFrames = {}; // playerId -> prevFrame
    this.playerRoster = {}; // playerId -> playerName
  }

  initialize(app, webContents) {
    this.app = app;
    this.webContents = webContents;
    
    this.frameBuffer = new FrameBuffer(config.chunkFrameCount);
    this.frameBuffer.onFlush((frames) => {
      if (this.writer) {
        this.writer.writeChunk(frames);
      }
    });

    console.log('[KRE Recorder] 初期化完了');
  }

  _onMatchStart(matchInfo) {
    this.status = 'recording';
    this.matchStartTime = Date.now();
    this.prevFrames = {};
    this.playerRoster = {};

    const filePath = this._buildFilePath(matchInfo);
    this.writer = new KreWriter(filePath, matchInfo);
    this.writer.initialize();

    const { checkVersion, getSelectors } = require('./version-checker');
    const clientPath = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'krunker') : null;
    const clientVersion = clientPath ? checkVersion(clientPath) : '2.0.0';
    const selectors = getSelectors(clientVersion || '2.0.0');
    this.collector = new DataCollector(this.webContents, selectors);
    
    this.collector.onFrame((players) => {
      this._onFrame(players);
    });
    
    this.collector.start();
    console.log(`[KRE Recorder] 録画開始: ${filePath}`);
  }

  _onMatchEnd() {
    if (this.status !== 'recording') return;
    this.status = 'saving';
    
    this.collector.stop();
    this.frameBuffer.flush();
    
    const durationMs = Date.now() - this.matchStartTime;
    const totalFrames = this.frameBuffer.getFrameCount();
    
    if (this.writer) {
      this.writer.setRoster(this.playerRoster);
      this.writer.finalize(totalFrames, durationMs);
      this.writer = null;
    }
    
    this.frameBuffer.clear();
    this.status = 'idle';
    console.log('[KRE Recorder] 録画終了・保存完了');
  }

  _onFrame(players) {
    const timestamp = Date.now() - this.matchStartTime;
    const compressedPlayers = [];
    
    for (const player of players) {
      if (player.name && !this.playerRoster[player.id]) {
        this.playerRoster[player.id] = player.name;
      }
      
      const prevFrame = this.prevFrames[player.id];
      const compressed = compressFrame(prevFrame, player);
      
      compressed.playerId = player.id; // ensure ID exists
      compressedPlayers.push(compressed);
      this.prevFrames[player.id] = player;
    }
    
    // add single frame object containing all players
    this.frameBuffer.addFrame({
      timestamp: timestamp,
      players: compressedPlayers
    });
  }

  _buildFilePath(matchInfo) {
    const savePath = config.savePath.replace('%USERPROFILE%', os.homedir());
    const date = new Date();
    const dateStr = date.toISOString().slice(0,10).replace(/-/g, '');
    const timeStr = date.toTimeString().slice(0,8).replace(/:/g, '');
    const fileName = config.fileNamingPattern
      .replace('{YYYYMMDD}', dateStr)
      .replace('{HHMMSS}', timeStr)
      .replace('{map}', matchInfo.mapName || 'unknown');
    
    return path.join(savePath, `${fileName}.kre`);
  }

  start() {
    // 簡易的に試合開始をエミュレート
    this._onMatchStart({
      mapId: 1,
      mapName: 'Burg',
      gameMode: 0,
      playerCount: 4,
      clientVersion: 20000
    });
  }

  stop() {
    this._onMatchEnd();
  }

  getStatus() {
    return this.status;
  }
}

module.exports = Recorder;
