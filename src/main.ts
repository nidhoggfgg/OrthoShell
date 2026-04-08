import * as THREE from 'three';
import './style.css';
import { exportGLTF, exportOBJ, exportSTL } from './exporters';
import { prepareProjectionImages } from './imageProcessing';
import { createSceneApp } from './scene';
import { buildVoxelGeometry } from './voxelGenerator';

type MaterialPreset = {
    roughness?: number;
    metalness?: number;
    envMapIntensity?: number;
    clearcoat?: number;
    clearcoatRoughness?: number;
};

type MaterialPresetKey = 'none' | 'matte' | 'resin' | 'ceramic' | 'metal';

type AppElementMap = {
    'advanced-body': HTMLDivElement;
    'advanced-panel': HTMLDetailsElement;
    'btn-export-gltf': HTMLButtonElement;
    'btn-export-obj': HTMLButtonElement;
    'btn-export-stl': HTMLButtonElement;
    'btn-generate': HTMLButtonElement;
    'canvas-container': HTMLDivElement;
    'enable-culling': HTMLInputElement;
    'fileFront': HTMLInputElement;
    'fileSide': HTMLInputElement;
    'filter-alpha': HTMLInputElement;
    'material-preset': HTMLSelectElement;
    'op-b': HTMLSelectElement;
    'op-g': HTMLSelectElement;
    'op-r': HTMLSelectElement;
    'preview-front': HTMLCanvasElement;
    'preview-side': HTMLCanvasElement;
    'resolution': HTMLInputElement;
    'shell-thickness': HTMLInputElement;
    status: HTMLDivElement;
    'ui-container': HTMLDivElement;
    'ui-toggle': HTMLButtonElement;
    'use-b': HTMLInputElement;
    'use-g': HTMLInputElement;
    'use-r': HTMLInputElement;
    'val-b': HTMLInputElement;
    'val-g': HTMLInputElement;
    'val-r': HTMLInputElement;
};

function getElement<K extends keyof AppElementMap>(id: K): AppElementMap[K] {
    const element = document.getElementById(id);

    if (!element) {
        throw new Error(`Missing required element: ${id}`);
    }

    return element as AppElementMap[K];
}

const sceneApp = createSceneApp(getElement('canvas-container'));
const PREVIEW_CANVAS_SIZE = 160;
let previewRefreshToken = 0;
let previewRefreshTimer: number | null = null;

const MATERIAL_PRESETS: Record<MaterialPresetKey, MaterialPreset | null> = {
    none: null,
    matte: {
        roughness: 0.88,
        metalness: 0.04,
        envMapIntensity: 0.45
    },
    resin: {
        roughness: 0.3,
        metalness: 0.02,
        envMapIntensity: 0.85,
        clearcoat: 0.7,
        clearcoatRoughness: 0.24
    },
    ceramic: {
        roughness: 0.42,
        metalness: 0.08,
        envMapIntensity: 0.72,
        clearcoat: 0.45,
        clearcoatRoughness: 0.12
    },
    metal: {
        roughness: 0.34,
        metalness: 0.32,
        envMapIntensity: 1.05,
        clearcoat: 0.18,
        clearcoatRoughness: 0.18
    }
};

function setUiCollapsed(collapsed: boolean) {
    const uiContainer = getElement('ui-container');
    const toggleButton = getElement('ui-toggle');

    uiContainer.classList.toggle('collapsed', collapsed);
    toggleButton.textContent = collapsed ? '展开' : '收起';
    toggleButton.setAttribute('aria-expanded', String(!collapsed));
}

function getNumericInput(id: 'resolution' | 'shell-thickness' | 'val-r' | 'val-g' | 'val-b', fallback: number) {
    const value = Number.parseInt(getElement(id).value, 10);
    return Number.isNaN(value) ? fallback : value;
}

function getResolution(alertOnClamp = false) {
    const resolutionInput = getElement('resolution');
    const rawResolution = getNumericInput('resolution', 150);
    const resolution = Math.min(Math.max(rawResolution, 10), 600);

    resolutionInput.value = String(resolution);

    if (alertOnClamp && rawResolution > 600) {
        window.alert('最大分辨率已限制为 600。');
    }

    return resolution;
}

function getFilterConfig() {
    return {
        alpha: getElement('filter-alpha').checked,
        r: {
            enabled: getElement('use-r').checked,
            op: getElement('op-r').value,
            val: getNumericInput('val-r', 250)
        },
        g: {
            enabled: getElement('use-g').checked,
            op: getElement('op-g').value,
            val: getNumericInput('val-g', 250)
        },
        b: {
            enabled: getElement('use-b').checked,
            op: getElement('op-b').value,
            val: getNumericInput('val-b', 250)
        }
    };
}

function setExportEnabled(enabled: boolean) {
    getElement('btn-export-stl').disabled = !enabled;
    getElement('btn-export-obj').disabled = !enabled;
    getElement('btn-export-gltf').disabled = !enabled;
}

function setStatus(message: string) {
    getElement('status').innerText = message;
}

function createPreviewMaterial() {
    const presetName = getElement('material-preset').value as MaterialPresetKey;
    const preset = MATERIAL_PRESETS[presetName] ?? MATERIAL_PRESETS.matte;

    if (presetName === 'none' || !preset) {
        return new THREE.MeshBasicMaterial({
            vertexColors: true
        });
    }

    return new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        reflectivity: 0.35,
        sheen: 0.08,
        sheenRoughness: 0.8,
        ...preset
    });
}

function updateCurrentMeshMaterial() {
    const mesh = sceneApp.getMesh();

    if (!mesh) {
        return;
    }

    const previousMaterial = mesh.material;
    mesh.material = createPreviewMaterial();
    if (Array.isArray(previousMaterial)) {
        previousMaterial.forEach((material) => material.dispose());
    } else {
        previousMaterial.dispose();
    }
}

function setPreviewCardState(canvasId: 'preview-front' | 'preview-side', hasImage: boolean) {
    const canvas = getElement(canvasId);
    const card = canvas.closest('.preview-card');

    if (card) {
        card.classList.toggle('has-image', hasImage);
    }
}

function drawProjectionPreview(
    canvasId: 'preview-front' | 'preview-side',
    projection: { data: Uint8ClampedArray; width: number; height: number }
) {
    const canvas = getElement(canvasId);
    const context = canvas.getContext('2d');
    const sourceCanvas = document.createElement('canvas');
    const sourceContext = sourceCanvas.getContext('2d');

    if (!context || !sourceContext) {
        throw new Error('Canvas 2D context is unavailable');
    }

    const scale = Math.min(PREVIEW_CANVAS_SIZE / projection.width, PREVIEW_CANVAS_SIZE / projection.height);
    const drawWidth = Math.max(1, Math.round(projection.width * scale));
    const drawHeight = Math.max(1, Math.round(projection.height * scale));
    const offsetX = Math.floor((PREVIEW_CANVAS_SIZE - drawWidth) / 2);
    const offsetY = Math.floor((PREVIEW_CANVAS_SIZE - drawHeight) / 2);

    sourceCanvas.width = projection.width;
    sourceCanvas.height = projection.height;
    sourceContext.putImageData(new ImageData(new Uint8ClampedArray(projection.data), projection.width, projection.height), 0, 0);

    canvas.width = PREVIEW_CANVAS_SIZE;
    canvas.height = PREVIEW_CANVAS_SIZE;
    context.clearRect(0, 0, PREVIEW_CANVAS_SIZE, PREVIEW_CANVAS_SIZE);
    context.imageSmoothingEnabled = false;
    context.drawImage(sourceCanvas, offsetX, offsetY, drawWidth, drawHeight);
    setPreviewCardState(canvasId, true);
}

function clearProjectionPreview(canvasId: 'preview-front' | 'preview-side') {
    const canvas = getElement(canvasId);
    const context = canvas.getContext('2d');

    if (!context) {
        throw new Error('Canvas 2D context is unavailable');
    }

    canvas.width = PREVIEW_CANVAS_SIZE;
    canvas.height = PREVIEW_CANVAS_SIZE;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setPreviewCardState(canvasId, false);
}

function updateProjectionPreviews(
    front: { data: Uint8ClampedArray; width: number; height: number },
    side: { data: Uint8ClampedArray; width: number; height: number }
) {
    drawProjectionPreview('preview-front', front);
    drawProjectionPreview('preview-side', side);
}

function clearProjectionPreviews() {
    clearProjectionPreview('preview-front');
    clearProjectionPreview('preview-side');
}

async function refreshProjectionPreviews() {
    const fileFront = getElement('fileFront').files?.[0];
    const fileSide = getElement('fileSide').files?.[0];
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
    } catch {
        if (token !== previewRefreshToken) {
            return;
        }

        clearProjectionPreviews();
    }
}

function scheduleProjectionPreviewRefresh() {
    if (previewRefreshTimer !== null) {
        window.clearTimeout(previewRefreshTimer);
    }

    previewRefreshTimer = window.setTimeout(() => {
        void refreshProjectionPreviews();
    }, 120);
}

async function nextFrame() {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function generate() {
    const btn = getElement('btn-generate');
    const fileFront = getElement('fileFront').files?.[0];
    const fileSide = getElement('fileSide').files?.[0];

    if (!fileFront || !fileSide) {
        window.alert('请选择两张图片');
        return;
    }

    const useCulling = getElement('enable-culling').checked;
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

        const mesh = new THREE.Mesh(result.geometry, createPreviewMaterial());
        sceneApp.setMesh(mesh);
        setExportEnabled(true);
        setStatus(
            `✅ 完成! 尺寸:${result.dimensions.width} x ${result.dimensions.height} x ${result.dimensions.depth} | 体素:${result.visibleVoxelCount}`
        );
    } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`❌ ${message}`);
        setExportEnabled(Boolean(sceneApp.getMesh()));
    } finally {
        btn.disabled = false;
    }
}

getElement('btn-generate').addEventListener('click', () => {
    void generate();
});
getElement('btn-export-stl').addEventListener('click', () => {
    try {
        exportSTL(sceneApp.getMesh());
        setStatus('✅ STL 文件已导出');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        window.alert(message);
    }
});
getElement('btn-export-obj').addEventListener('click', () => {
    try {
        exportOBJ(sceneApp.getMesh());
        setStatus('✅ OBJ 文件已导出');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        window.alert(message);
    }
});
getElement('btn-export-gltf').addEventListener('click', () => {
    void (async () => {
        try {
            await exportGLTF(sceneApp.getMesh());
            setStatus('✅ GLTF 文件已导出');
        } catch (error) {
            console.error(error);
            const message = error instanceof Error ? error.message : String(error);
            window.alert(`导出失败: ${message}`);
        }
    })();
});
getElement('ui-toggle').addEventListener('click', () => {
    const uiContainer = getElement('ui-container');
    setUiCollapsed(!uiContainer.classList.contains('collapsed'));
});
getElement('fileFront').addEventListener('change', scheduleProjectionPreviewRefresh);
getElement('fileSide').addEventListener('change', scheduleProjectionPreviewRefresh);
getElement('advanced-body').addEventListener('input', scheduleProjectionPreviewRefresh);
getElement('advanced-body').addEventListener('change', scheduleProjectionPreviewRefresh);
getElement('material-preset').addEventListener('change', updateCurrentMeshMaterial);

window.addEventListener('resize', () => {
    sceneApp.resize(window.innerWidth, window.innerHeight);
});

setUiCollapsed(false);
getElement('advanced-panel').open = false;
setExportEnabled(false);
clearProjectionPreviews();
