import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

function fitCameraToMesh(camera, controls, mesh) {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z, 1);
    const distance = maxSize * 1.4;

    camera.near = Math.max(0.1, maxSize / 100);
    camera.far = Math.max(5000, distance * 10);
    camera.position.copy(center).add(new THREE.Vector3(distance, distance * 0.8, distance));
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.update();
}

export function createSceneApp(container) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);
    camera.position.set(200, 150, 200);

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.position.set(100, 200, 150);
    scene.add(mainLight);

    const backLight = new THREE.DirectionalLight(0xaaccff, 0.3);
    backLight.position.set(-100, 50, -100);
    scene.add(backLight);

    const grid = new THREE.GridHelper(600, 24, 0x34536b, 0x22303c);
    grid.position.y = -120;
    scene.add(grid);

    let currentMesh = null;

    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }

    function setMesh(mesh) {
        if (currentMesh) {
            scene.remove(currentMesh);
            currentMesh.geometry.dispose();
            currentMesh.material.dispose();
        }

        currentMesh = mesh;
        scene.add(mesh);
        fitCameraToMesh(camera, controls, mesh);
    }

    function resize(width, height) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }

    animate();

    return {
        getMesh() {
            return currentMesh;
        },
        resize,
        setMesh
    };
}
