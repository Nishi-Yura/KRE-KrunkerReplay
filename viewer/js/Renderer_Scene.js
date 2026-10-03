import { Shared } from './State.js';

export let renderer, clock;

export function initRenderer() {
    const container = document.getElementById('canvas-container');
    Shared.scene = new THREE.Scene();
    Shared.scene.background = new THREE.Color(0x0a0a0f);
    
    Shared.mapGroup = new THREE.Group();
    Shared.scene.add(Shared.mapGroup);
    
    const grid = new THREE.GridHelper(500, 100, 0x333333, 0x111111);
    Shared.scene.add(grid);
    
    Shared.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
    Shared.camera.position.set(0, 50, 100);
    Shared.camera.lookAt(0, 0, 0);
    Shared.camera.rotation.order = 'YXZ'; 

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    Shared.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    Shared.scene.add(dirLight);

    window.addEventListener('resize', () => {
      Shared.camera.aspect = window.innerWidth / window.innerHeight;
      Shared.camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
    
    clock = new THREE.Clock();
}
