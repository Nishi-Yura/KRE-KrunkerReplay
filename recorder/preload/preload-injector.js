const { contextBridge, ipcRenderer } = require('electron');

/**
 * 既存のpreloadを壊さないように最後に追記する形で動作
 * Recorderを初期化してwebContentsに渡す
 */

console.log('[KRE Recorder] Preload injected.');

contextBridge.exposeInMainWorld('kreRecorder', {
  getStatus: () => ipcRenderer.invoke('kre-get-status'),
  startRecording: () => ipcRenderer.send('kre-start-recording'),
  stopRecording: () => ipcRenderer.send('kre-stop-recording')
});

// 試合開始・終了の検知もここで行う（DOMイベントを監視）
window.addEventListener('DOMContentLoaded', () => {
  console.log('[KRE Recorder] DOMContentLoaded');
  
  // 例: UIの変更を監視して試合開始/終了を検知する
  const observer = new MutationObserver((mutations) => {
    // 試合開始/終了のロジック（実際にはゲーム内の特定の要素を監視）
  });
  
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
});
