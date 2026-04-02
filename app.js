import * as THREE from 'three';
import { prepareProjectionImages } from './src/imageProcessing.js';
import { createSceneApp } from './src/scene.js';
import { buildVoxelGeometry } from './src/voxelGenerator.js';
import { exportGLTF, exportOBJ, exportSTL } from './src/exporters.js';

const sceneApp = createSceneApp(document.getElementById('canvas-container'));

function setUiCollapsed(collapsed) {
    const uiContainer = document.getElementById('ui-container');
    const toggleButton = document.getElementById('ui-toggle');

    uiContainer.classList.toggle('collapsed', collapsed);
    toggleButton.textContent = collapsed ? '展开' : '收起';
    toggleButton.setAttribute('aria-expanded', String(!collapsed));
}

function getNumericInput(id, fallback) {
    const value = parseInt(document.getElementById(id).value, 10);
    return Number.isNaN(value) ? fallback : value;
}

function getFilterConfig() {
    return {
        alpha: document.getElementById('filter-alpha').checked,
        r: {
            enabled: document.getElementById('use-r').checked,
            op: document.getElementById('op-r').value,
            val: getNumericInput('val-r', 250)
        },
        g: {
            enabled: document.getElementById('use-g').checked,
            op: document.getElementById('op-g').value,
            val: getNumericInput('val-g', 250)
        },
        b: {
            enabled: document.getElementById('use-b').checked,
            op: document.getElementById('op-b').value,
            val: getNumericInput('val-b', 250)
        }
    };
}

function setExportEnabled(enabled) {
    document.getElementById('btn-export-stl').disabled = !enabled;
    document.getElementById('btn-export-obj').disabled = !enabled;
    document.getElementById('btn-export-gltf').disabled = !enabled;
}

function setStatus(message) {
    document.getElementById('status').innerText = message;
}

async function nextFrame() {
    await new Promise((resolve) => requestAnimationFrame(resolve));
}

async function generate() {
    const btn = document.getElementById('btn-generate');
    const fileFront = document.getElementById('fileFront').files[0];
    const fileSide = document.getElementById('fileSide').files[0];

    if (!fileFront || !fileSide) {
        alert('请选择两张图片');
        return;
    }

    const useCulling = document.getElementById('enable-culling').checked;
    const shellThickness = Math.min(Math.max(getNumericInput('shell-thickness', 2), 1), 10);
    const resolutionInput = document.getElementById('resolution');
    const rawResolution = getNumericInput('resolution', 150);
    const resolution = Math.min(Math.max(rawResolution, 10), 600);
    resolutionInput.value = String(resolution);

    if (rawResolution > 600) {
        alert('最大分辨率已限制为 600。');
    }

    const filterConfig = getFilterConfig();

    btn.disabled = true;
    setExportEnabled(false);
    setStatus('正在预处理图片...');

    try {
        const { front, side } = await prepareProjectionImages({
            frontFile: fileFront,
            sideFile: fileSide,
            filterConfig,
            targetHeight: resolution
        });

        setStatus(`正在重建体素 (${front.width} x ${resolution} x ${side.width})...`);
        await nextFrame();

        const result = buildVoxelGeometry({
            front,
            side,
            shellThickness,
            useCulling
        });

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.7,
            metalness: 0.1
        });

        const mesh = new THREE.Mesh(result.geometry, material);
        sceneApp.setMesh(mesh);
        setExportEnabled(true);
        setStatus(
            `✅ 完成! 尺寸:${result.dimensions.width} x ${result.dimensions.height} x ${result.dimensions.depth} | 体素:${result.visibleVoxelCount}`
        );
    } catch (error) {
        console.error(error);
        setStatus(`❌ ${error.message}`);
        setExportEnabled(Boolean(sceneApp.getMesh()));
    } finally {
        btn.disabled = false;
    }
}

document.getElementById('btn-generate').addEventListener('click', generate);
document.getElementById('btn-export-stl').addEventListener('click', () => {
    try {
        exportSTL(sceneApp.getMesh());
        setStatus('✅ STL 文件已导出');
    } catch (error) {
        alert(error.message);
    }
});
document.getElementById('btn-export-obj').addEventListener('click', () => {
    try {
        exportOBJ(sceneApp.getMesh());
        setStatus('✅ OBJ 文件已导出');
    } catch (error) {
        alert(error.message);
    }
});
document.getElementById('btn-export-gltf').addEventListener('click', async () => {
    try {
        await exportGLTF(sceneApp.getMesh());
        setStatus('✅ GLTF 文件已导出');
    } catch (error) {
        console.error(error);
        alert(`导出失败: ${error.message || error}`);
    }
});
document.getElementById('ui-toggle').addEventListener('click', () => {
    const uiContainer = document.getElementById('ui-container');
    setUiCollapsed(!uiContainer.classList.contains('collapsed'));
});

window.addEventListener('resize', () => {
    sceneApp.resize(window.innerWidth, window.innerHeight);
});

setUiCollapsed(false);
setExportEnabled(false);
