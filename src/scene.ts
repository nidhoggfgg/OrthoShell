import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
    if (Array.isArray(material)) {
        for (const entry of material) {
            entry.dispose();
        }
        return;
    }

    material.dispose();
}

function setShadowState(object: THREE.Object3D, enabled: boolean) {
    object.traverse((child: THREE.Object3D) => {
        const meshChild = child as THREE.Mesh;

        if (!meshChild.isMesh) {
            return;
        }

        meshChild.castShadow = enabled;
    });
}

function fitCameraToMesh(camera: THREE.PerspectiveCamera, controls: OrbitControls, mesh: THREE.Mesh) {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const fitHeightDistance = maxDim / (2 * Math.tan(fov / 2));
    const fitWidthDistance = fitHeightDistance / camera.aspect;
    const distance = Math.max(fitHeightDistance, fitWidthDistance) * 1.45;
    const offset = new THREE.Vector3(distance, distance * 0.52, distance * 0.92);

    camera.near = Math.max(0.1, maxDim / 200);
    camera.far = Math.max(2000, distance * 12);
    camera.position.copy(center).add(offset);
    camera.updateProjectionMatrix();

    controls.target.copy(center).add(new THREE.Vector3(0, size.y * 0.1, 0));
    controls.minDistance = Math.max(maxDim * 0.55, 12);
    controls.maxDistance = Math.max(distance * 3.5, 240);
    controls.update();
}

function updateStageForMesh(grid: THREE.GridHelper, keyLight: THREE.DirectionalLight, mesh: THREE.Mesh) {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.z, 40) * 1.4;
    const floorY = box.min.y - 0.75;

    grid.position.set(center.x, floorY + 0.02, center.z);
    grid.scale.setScalar(Math.max(radius / 180, 0.75));

    keyLight.target.position.copy(center);
    keyLight.target.updateMatrixWorld();
}

export function createSceneApp(container: HTMLDivElement) {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xd5dde7, 450, 1400);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 5000);
    camera.position.set(180, 120, 180);

    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xf8fbff, 0x8b96a3, 1.05));

    const fillLight = new THREE.DirectionalLight(0xc6e1ff, 0.6);
    fillLight.position.set(-120, 90, -140);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xfff0d6, 0.45);
    rimLight.position.set(80, 60, -170);
    scene.add(rimLight);

    const keyLight = new THREE.DirectionalLight(0xfff6ec, 1.95);
    keyLight.position.set(180, 240, 160);
    scene.add(keyLight);
    scene.add(keyLight.target);

    const grid = new THREE.GridHelper(180, 18, 0xb9c8d8, 0xdbe4ec);
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of gridMaterials) {
        material.opacity = 0.26;
        material.transparent = true;
    }
    scene.add(grid);

    let currentMesh: THREE.Mesh | null = null;

    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }

    function setMesh(mesh: THREE.Mesh) {
        if (currentMesh) {
            scene.remove(currentMesh);
            currentMesh.geometry.dispose();
            disposeMaterial(currentMesh.material);
        }

        currentMesh = mesh;
        setShadowState(mesh, false);
        scene.add(mesh);
        updateStageForMesh(grid, keyLight, mesh);
        fitCameraToMesh(camera, controls, mesh);
    }

    function resize(widthValue: number, heightValue: number) {
        camera.aspect = widthValue / heightValue;
        camera.updateProjectionMatrix();
        renderer.setSize(widthValue, heightValue);
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
