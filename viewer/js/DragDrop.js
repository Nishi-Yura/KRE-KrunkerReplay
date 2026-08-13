import { showToast } from './UI.js';
import { parseKRE } from './Parser_KRE.js';
import { parseJSONLog } from './Parser_JSON.js';
import { parseMapJSON, parseOBJ } from './Parser_Map.js';

export function setupDragAndDrop() {
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    document.addEventListener(eventName, e => e.preventDefault(), false);
  });

  const dropOverlay = document.getElementById('drop-overlay');
  const landingBox = document.getElementById('landing-box');

  document.addEventListener('dragenter', e => {
    dropOverlay.style.display = 'flex';
    if(landingBox) landingBox.classList.add('dragover');
  });

  document.addEventListener('dragover', e => {
    dropOverlay.style.display = 'flex';
    if(landingBox) landingBox.classList.add('dragover');
  });
  
  document.addEventListener('dragleave', e => {
    if (e.clientX === 0 || e.clientY === 0) {
        dropOverlay.style.display = 'none';
        if(landingBox) landingBox.classList.remove('dragover');
    }
  });
  
  document.addEventListener('drop', e => {
    e.preventDefault();
    dropOverlay.style.display = 'none';
    if(landingBox) landingBox.classList.remove('dragover');
    
    if(e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      
      if (file.name.endsWith('.json') || file.name.endsWith('.kre_log')) {
          reader.onload = (evt) => {
              try {
                  const text = evt.target.result;
                  const parsed = JSON.parse(text);
                  if (Array.isArray(parsed)) {
                      parseJSONLog(text);
                  } else if (parsed && typeof parsed === 'object') {
                      parseMapJSON(text);
                  } else {
                      showToast('不明なJSONフォーマットです');
                  }
              } catch(e) {
                  showToast('JSONの解析に失敗しました: ' + e.message);
              }
          };
          reader.readAsText(file);
      } else if (file.name.endsWith('.obj')) {
          reader.onload = (evt) => {
              try { parseOBJ(evt.target.result); } 
              catch(e) { showToast('OBJの解析に失敗しました: ' + e.message); }
          };
          reader.readAsText(file);
      } else {
          reader.onload = async (evt) => {
            const success = await parseKRE(evt.target.result);
            if(!success) {
              console.warn('Failed to parse KRE');
              showToast('KREファイルの読み込みに失敗しました');
            }
          };
          reader.readAsArrayBuffer(file);
      }
    }
  });
}
