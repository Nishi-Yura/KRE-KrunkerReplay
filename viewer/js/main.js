import { initRenderer } from './Renderer_Scene.js';
import { animate } from './Renderer_Loop.js';
import { setupUI } from './UI.js';
import { setupDragAndDrop } from './DragDrop.js';

function init() {
    initRenderer();
    setupUI();
    setupDragAndDrop();
    animate();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
