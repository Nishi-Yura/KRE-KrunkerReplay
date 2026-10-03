import { showToast } from './UI.js';
import { parseKRE } from './Parser_KRE.js';
import { parseJSONLog } from './Parser_JSON.js';
import { parseMapData, parseOBJ } from './Parser_Map.js';

// ドラッグ&ドロップ・ファイル選択の共通入口
export async function loadFile(file) {
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.obj')) {
      parseOBJ(await file.text());
    } else if (name.endsWith('.json') || name.endsWith('.kre_log')) {
      const parsed = JSON.parse(await file.text()); // 1回だけパースして各パーサに渡す
      if (Array.isArray(parsed)) {
        parseJSONLog(parsed);
      } else if (parsed && typeof parsed === 'object') {
        if (!parseMapData(parsed)) showToast('マップJSONとして認識できませんでした');
      } else {
        showToast('不明なJSONフォーマットです');
      }
    } else {
      const ok = await parseKRE(await file.arrayBuffer());
      if (!ok) showToast('KREファイルの読み込みに失敗しました');
    }
  } catch (e) {
    showToast('ファイルの読み込みに失敗しました: ' + e.message);
  }
}

export function setupDragAndDrop() {
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    document.addEventListener(eventName, e => e.preventDefault(), false);
  });

  const dropOverlay = document.getElementById('drop-overlay');
  const landingBox = document.getElementById('landing-box');
  const setDragging = on => {
    dropOverlay.style.display = on ? 'flex' : 'none';
    if (landingBox) landingBox.classList.toggle('dragover', on);
  };

  document.addEventListener('dragenter', () => setDragging(true));
  document.addEventListener('dragover', () => setDragging(true));
  document.addEventListener('dragleave', e => {
    // ウィンドウ外に出たときだけ解除する
    if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) setDragging(false);
  });
  document.addEventListener('drop', e => {
    setDragging(false);
    if (e.dataTransfer.files.length > 0) loadFile(e.dataTransfer.files[0]);
  });

  // ファイル選択ボタン
  const input = document.getElementById('file-input');
  if (input) {
    input.addEventListener('change', () => {
      if (input.files.length > 0) loadFile(input.files[0]);
      input.value = ''; // 同じファイルを続けて選べるように
    });
  }
  document.querySelectorAll('[data-open-file]').forEach(btn => {
    btn.addEventListener('click', () => input && input.click());
  });
}
