import * as THREE from 'three';
import { prepareProjectionImages } from './src/imageProcessing.js';
import { createSceneApp } from './src/scene.js';
import { buildVoxelGeometry } from './src/voxelGenerator.js';
import { exportGLTF, exportOBJ, exportSTL } from './src/exporters.js';

const sceneApp = createSceneApp(document.getElementById('canvas-container'));
const PREVIEW_CANVAS_SIZE = 160;
let previewRefreshToken = 0;
let previewRefreshTimer = null;

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

function getResolution(alertOnClamp = false) {
    const resolutionInput = document.getElementById('resolution');
    const rawResolution = getNumericInput('resolution', 150);
    const resolution = Math.min(Math.max(rawResolution, 10), 600);

    resolutionInput.value = String(resolution);

    if (alertOnClamp && rawResolution > 600) {
        alert('最大分辨率已限制为 600。');
    }

    return resolution;
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

function setPreviewCardState(canvasId, hasImage) {
    const canvas = document.getElementById(canvasId);
    const card = canvas.closest('.preview-card');

    if (card) {
        card.classList.toggle('has-image', hasImage);
    }
}

function drawProjectionPreview(canvasId, projection) {
    const canvas = document.getElementById(canvasId);
    const context = canvas.getContext('2d');
    const sourceCanvas = document.createElement('canvas');
    const sourceContext = sourceCanvas.getContext('2d');
    const scale = Math.min(PREVIEW_CANVAS_SIZE / projection.width, PREVIEW_CANVAS_SIZE / projection.height);
    const drawWidth = Math.max(1, Math.round(projection.width * scale));
    const drawHeight = Math.max(1, Math.round(projection.height * scale));
    const offsetX = Math.floor((PREVIEW_CANVAS_SIZE - drawWidth) / 2);
    const offsetY = Math.floor((PREVIEW_CANVAS_SIZE - drawHeight) / 2);

    sourceCanvas.width = projection.width;
    sourceCanvas.height = projection.height;
    sourceContext.putImageData(
        new ImageData(new Uint8ClampedArray(projection.data), projection.width, projection.height),
        0,
        0
    );

    canvas.width = PREVIEW_CANVAS_SIZE;
    canvas.height = PREVIEW_CANVAS_SIZE;
    context.clearRect(0, 0, PREVIEW_CANVAS_SIZE, PREVIEW_CANVAS_SIZE);
    context.imageSmoothingEnabled = false;
    context.drawImage(sourceCanvas, offsetX, offsetY, drawWidth, drawHeight);
    setPreviewCardState(canvasId, true);
}

function clearProjectionPreview(canvasId) {
    const canvas = document.getElementById(canvasId);
    const context = canvas.getContext('2d');

    canvas.width = PREVIEW_CANVAS_SIZE;
    canvas.height = PREVIEW_CANVAS_SIZE;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setPreviewCardState(canvasId, false);
}

function updateProjectionPreviews(front, side) {
    drawProjectionPreview('preview-front', front);
    drawProjectionPreview('preview-side', side);
}

function clearProjectionPreviews() {
    clearProjectionPreview('preview-front');
    clearProjectionPreview('preview-side');
}

async function refreshProjectionPreviews() {
    const fileFront = document.getElementById('fileFront').files[0];
    const fileSide = document.getElementById('fileSide').files[0];
    const token = ++previewRefreshToken;

    if (!fileFront || !fileSide) {
        clearProjectionPreviews();
        return;
    }

    try {
        const { front, side } = await prepareProjectionImages({
            frontFile: fileFront,
            sideFile: fileSide,
            filterConfig: getFilterConfig(),
            targetHeight: getResolution()
        });

        if (token !== previewRefreshToken) {
            return;
        }

        updateProjectionPreviews(front, side);
    } catch (error) {
        if (token !== previewRefreshToken) {
            return;
        }

        clearProjectionPreviews();
    }
}

function scheduleProjectionPreviewRefresh() {
    window.clearTimeout(previewRefreshTimer);
    previewRefreshTimer = window.setTimeout(() => {
        void refreshProjectionPreviews();
    }, 120);
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
    const resolution = getResolution(true);

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

        updateProjectionPreviews(front, side);
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
document.getElementById('fileFront').addEventListener('change', scheduleProjectionPreviewRefresh);
document.getElementById('fileSide').addEventListener('change', scheduleProjectionPreviewRefresh);
document.getElementById('advanced-body').addEventListener('input', scheduleProjectionPreviewRefresh);
document.getElementById('advanced-body').addEventListener('change', scheduleProjectionPreviewRefresh);

window.addEventListener('resize', () => {
    sceneApp.resize(window.innerWidth, window.innerHeight);
});

setUiCollapsed(false);
document.getElementById('advanced-panel').open = false;
setExportEnabled(false);
clearProjectionPreviews();
