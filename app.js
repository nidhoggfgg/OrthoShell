import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

let scene, camera, renderer, controls, voxelMesh;

function init() {
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);
    camera.position.set(200, 150, 200);

    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.position.set(100, 200, 150);
    scene.add(mainLight);
    const backLight = new THREE.DirectionalLight(0xaaccff, 0.3);
    backLight.position.set(-100, 50, -100);
    scene.add(backLight);

    animate();
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function setUiCollapsed(collapsed) {
    const uiContainer = document.getElementById('ui-container');
    const toggleButton = document.getElementById('ui-toggle');

    uiContainer.classList.toggle('collapsed', collapsed);
    toggleButton.textContent = collapsed ? '展开' : '收起';
    toggleButton.setAttribute('aria-expanded', String(!collapsed));
}

function readImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

function isPixelObject(data, index, config) {
    const r = data[index], g = data[index + 1], b = data[index + 2], a = data[index + 3];
    if (config.alpha && a < 20) return false;

    if (config.r.enabled) {
        if (config.r.op === '<' && r >= config.r.val) return false;
        if (config.r.op === '>' && r <= config.r.val) return false;
    }
    if (config.g.enabled) {
        if (config.g.op === '<' && g >= config.g.val) return false;
        if (config.g.op === '>' && g <= config.g.val) return false;
    }
    if (config.b.enabled) {
        if (config.b.op === '<' && b >= config.b.val) return false;
        if (config.b.op === '>' && b <= config.b.val) return false;
    }
    return true;
}

function getVisibleBounds(img, config) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    let minY = img.height, maxY = 0;
    let found = false;

    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            if (isPixelObject(data, (y * img.width + x) * 4, config)) {
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                found = true;
            }
        }
    }
    if (!found) return null;
    return { minY, height: maxY - minY + 1, sourceCanvas: canvas };
}

function cropAndResize(boundsInfo, targetHeight) {
    const { minY, height, sourceCanvas } = boundsInfo;
    const scale = targetHeight / height;
    const targetWidth = Math.floor(sourceCanvas.width * scale);
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = targetWidth; finalCanvas.height = targetHeight;
    const ctx = finalCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sourceCanvas, 0, minY, sourceCanvas.width, height, 0, 0, targetWidth, targetHeight);
    return { data: ctx.getImageData(0, 0, targetWidth, targetHeight).data, width: targetWidth, height: targetHeight };
}

const getKey = (x, y, z) => `${x},${y},${z}`;

// 辅助函数：快速获取邻居Key
const getNeighbors = (x, y, z) => [
    `${x},${y},${z+1}`, `${x},${y},${z-1}`,
    `${x+1},${y},${z}`, `${x-1},${y},${z}`,
    `${x},${y+1},${z}`, `${x},${y-1},${z}`
];

async function generate() {
    const btn = document.getElementById('btn-generate');
    const status = document.getElementById('status');
    const fileFront = document.getElementById('fileFront').files[0];
    const fileSide = document.getElementById('fileSide').files[0];
    const useCulling = document.getElementById('enable-culling').checked;

    // 获取壳厚度
    let shellThickness = parseInt(document.getElementById('shell-thickness').value);
    if (isNaN(shellThickness) || shellThickness < 1) shellThickness = 1;

    let inputHeight = parseInt(document.getElementById('resolution').value);
    if (isNaN(inputHeight) || inputHeight < 10) inputHeight = 50;
    if (inputHeight > 600) {
        inputHeight = 600;
        document.getElementById('resolution').value = 600;
        alert("最大分辨率已限制为 600。");
    }

    const filterConfig = {
        alpha: document.getElementById('filter-alpha').checked,
        r: { enabled: document.getElementById('use-r').checked, op: document.getElementById('op-r').value, val: parseInt(document.getElementById('val-r').value) },
        g: { enabled: document.getElementById('use-g').checked, op: document.getElementById('op-g').value, val: parseInt(document.getElementById('val-g').value) },
        b: { enabled: document.getElementById('use-b').checked, op: document.getElementById('op-b').value, val: parseInt(document.getElementById('val-b').value) }
    };

    if(!fileFront || !fileSide) return alert("请选择两张图片");

    btn.disabled = true;
    status.innerText = "正在预处理...";

    try {
        const [rawImgFront, rawImgSide] = await Promise.all([readImage(fileFront), readImage(fileSide)]);

        const boundsFront = getVisibleBounds(rawImgFront, filterConfig);
        const boundsSide = getVisibleBounds(rawImgSide, filterConfig);
        if (!boundsFront || !boundsSide) throw new Error("未检测到有效物体，请调整过滤规则");

        const targetHeight = inputHeight;
        const imgFront = cropAndResize(boundsFront, targetHeight);
        const imgSide = cropAndResize(boundsSide, targetHeight);

        status.innerText = `数据构建中 (高度: ${targetHeight}px)...`;
        await new Promise(r => setTimeout(r, 20));

        const voxelMap = new Map();
        for(let y = 0; y < targetHeight; y++) {
            const actualY = targetHeight - 1 - y;
            let activeXs = [], activeZs = [];

            for(let x=0; x<imgFront.width; x++) {
                let i = (y * imgFront.width + x) * 4;
                if(isPixelObject(imgFront.data, i, filterConfig))
                    activeXs.push({x, c:[imgFront.data[i], imgFront.data[i+1], imgFront.data[i+2]]});
            }
            if (activeXs.length === 0) continue;

            for(let z=0; z<imgSide.width; z++) {
                let i = (y * imgSide.width + z) * 4;
                if(isPixelObject(imgSide.data, i, filterConfig))
                    activeZs.push({z, c:[imgSide.data[i], imgSide.data[i+1], imgSide.data[i+2]]});
            }
            if (activeZs.length === 0) continue;

            for(let px of activeXs) {
                for(let pz of activeZs) {
                    voxelMap.set(getKey(px.x, actualY, pz.z), { cFront: px.c, cSide: pz.c });
                }
            }
        }

        status.innerText = `计算壳层 (厚度: ${shellThickness}, 剔除: ${useCulling?'开':'关'})...`;
        await new Promise(r => setTimeout(r, 20));

        // --- 核心优化：多层剥皮算法 (Onion Peeling) ---
        const visibleKeys = new Set();

        if (useCulling) {
            // 初始化工作集：包含所有体素
            let currentLayerSet = new Set(voxelMap.keys());

            // 循环剥离指定层数
            for (let i = 0; i < shellThickness; i++) {
                let nextInnerSet = new Set();

                // 遍历当前剩余的所有体素
                for (let key of currentLayerSet) {
                    const [sx, sy, sz] = key.split(',').map(Number);
                    const neighbors = getNeighbors(sx, sy, sz);

                    // 检查邻居是否在 *当前剩余集合* 中存在
                    // 如果有任何一个方向缺失，它就是当前层的表面
                    let isSurface = false;
                    for (let nKey of neighbors) {
                        if (!currentLayerSet.has(nKey)) {
                            isSurface = true;
                            break;
                        }
                    }

                    if (isSurface) {
                        visibleKeys.add(key); // 这个点需要显示
                    } else {
                        nextInnerSet.add(key); // 这个点是更深层的内部点，留到下一轮处理
                    }
                }

                // 准备剥下一层
                currentLayerSet = nextInnerSet;
                // 如果没有内部点了，直接结束
                if (currentLayerSet.size === 0) break;
            }
            // 循环结束后，currentLayerSet 里剩下的就是被剔除的"深层内核"
        } else {
            // 如果不剔除，显示所有点
            for (let k of voxelMap.keys()) visibleKeys.add(k);
        }
        // ----------------------------------------------------

        status.innerText = `生成Mesh... (显示体素: ${visibleKeys.size})`;
        await new Promise(r => setTimeout(r, 20));

        const vertices = [], colors = [], normals = [];
        const r = 0.5;

        function addFace(corners, n, c) {
            vertices.push(...corners[0], ...corners[1], ...corners[3], ...corners[1], ...corners[2], ...corners[3]);
            const norm = [n[0], n[1], n[2]]; const col = [c[0]/255, c[1]/255, c[2]/255];
            for(let k=0; k<6; k++) {
                normals.push(...norm);
                colors.push(...col);
            }
        }

        const centerX = imgFront.width / 2, centerY = targetHeight / 2, centerZ = imgSide.width / 2;

        // 只遍历决定显示的体素
        for (const key of visibleKeys) {
            const val = voxelMap.get(key);
            const [sx, sy, sz] = key.split(',').map(Number);

            const x = sx - centerX, y = sy - centerY, z = sz - centerZ;
            const cf = val.cFront, cs = val.cSide;
            const cmix = [(cf[0]+cs[0])/2, (cf[1]+cs[1])/2, (cf[2]+cs[2])/2];

            const v = [
                [x-r, y-r, z-r], [x+r, y-r, z-r], [x+r, y+r, z-r], [x-r, y+r, z-r],
                [x-r, y-r, z+r], [x+r, y-r, z+r], [x+r, y+r, z+r], [x-r, y+r, z+r]
            ];

            // 面剔除 (Face Culling):
            // 即使体素被保留，也只绘制没有邻居的那一面（这里判断邻居要看 visibleKeys 还是全局？
            // 答：为了视觉正确，应该看 visibleKeys。如果邻居被剔除了，这一面就该露出来。）

            const hasFront = visibleKeys.has(getKey(sx, sy, sz+1));
            const hasBack  = visibleKeys.has(getKey(sx, sy, sz-1));
            const hasRight = visibleKeys.has(getKey(sx+1, sy, sz));
            const hasLeft  = visibleKeys.has(getKey(sx-1, sy, sz));
            const hasTop   = visibleKeys.has(getKey(sx, sy+1, sz));
            const hasBot   = visibleKeys.has(getKey(sx, sy-1, sz));

            if (!hasFront) addFace([v[5], v[4], v[7], v[6]], [0,0,1], cf);
            if (!hasBack)  addFace([v[0], v[1], v[2], v[3]], [0,0,-1], cf);
            if (!hasRight) addFace([v[1], v[5], v[6], v[2]], [1,0,0], cs);
            if (!hasLeft)  addFace([v[4], v[0], v[3], v[7]], [-1,0,0], cs);
            if (!hasTop)   addFace([v[6], v[7], v[3], v[2]], [0,1,0], cmix);
            if (!hasBot)   addFace([v[4], v[5], v[1], v[0]], [0,-1,0], cmix);
        }

        if (vertices.length === 0) throw new Error("未生成几何体 (可能过滤太严格)");

        if (voxelMesh) { scene.remove(voxelMesh); voxelMesh.geometry.dispose(); voxelMesh.material.dispose(); }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.7,
            metalness: 0.1
        });

        voxelMesh = new THREE.Mesh(geometry, material);
        scene.add(voxelMesh);

        // 启用导出按钮
        document.getElementById('btn-export-stl').disabled = false;
        document.getElementById('btn-export-obj').disabled = false;
        document.getElementById('btn-export-gltf').disabled = false;

        status.innerText = `✅ 完成! 高度:${targetHeight}px | 体素数:${visibleKeys.size}`;

    } catch (err) {
        console.error(err);
        status.innerText = "❌ " + err.message;
    } finally {
        btn.disabled = false;
    }
}

// ============ 导出功能 ============

function downloadFile(blob, filename) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 100);
}

// 导出STL格式 (适合3D打印)
function exportSTL() {
    if (!voxelMesh) return alert('请先生成模型');

    const exporter = new STLExporter();
    const stlString = exporter.parse(voxelMesh, { binary: false });
    const blob = new Blob([stlString], { type: 'text/plain' });
    downloadFile(blob, 'model.stl');

    document.getElementById('status').innerText = '✅ STL文件已导出';
}

// 导出OBJ格式 (通用格式,支持颜色)
function exportOBJ() {
    if (!voxelMesh) return alert('请先生成模型');

    const geometry = voxelMesh.geometry;
    const position = geometry.getAttribute('position');
    const color = geometry.getAttribute('color');

    let objContent = '# OBJ File Generated from 3D Voxel Generator\n';
    objContent += 'mtllib model.mtl\n';
    objContent += 'usemtl material0\n\n';

    // 顶点坐标
    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        objContent += `v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`;

        // 添加顶点颜色
        if (color) {
            const r = color.getX(i);
            const g = color.getY(i);
            const b = color.getZ(i);
            objContent += ` ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}`;
        }
        objContent += '\n';
    }

    objContent += '\n';

    // 面索引 (OBJ索引从1开始)
    for (let i = 0; i < position.count; i += 3) {
        objContent += `f ${i+1} ${i+2} ${i+3}\n`;
    }

    const blob = new Blob([objContent], { type: 'text/plain' });
    downloadFile(blob, 'model.obj');

    // 同时导出MTL文件 (材质文件)
    let mtlContent = '# MTL File\n';
    mtlContent += 'newmtl material0\n';
    mtlContent += 'Ka 1.0 1.0 1.0\n';
    mtlContent += 'Kd 0.8 0.8 0.8\n';
    mtlContent += 'Ks 0.5 0.5 0.5\n';
    mtlContent += 'Ns 32.0\n';
    mtlContent += 'd 1.0\n';
    mtlContent += 'illum 2\n';

    const mtlBlob = new Blob([mtlContent], { type: 'text/plain' });
    downloadFile(mtlBlob, 'model.mtl');

    document.getElementById('status').innerText = '✅ OBJ文件已导出 (含MTL材质)';
}

// 导出GLTF格式 (现代Web3D标准)
function exportGLTF() {
    if (!voxelMesh) return alert('请先生成模型');

    const exporter = new GLTFExporter();

    exporter.parse(
        voxelMesh,
        function(result) {
            const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
            downloadFile(blob, 'model.gltf');
            document.getElementById('status').innerText = '✅ GLTF文件已导出';
        },
        function(error) {
            console.error('导出GLTF失败:', error);
            alert('导出失败: ' + error);
        },
        { binary: false }
    );
}

// ============ 事件监听 ============

document.getElementById('btn-generate').addEventListener('click', generate);
document.getElementById('btn-export-stl').addEventListener('click', exportSTL);
document.getElementById('btn-export-obj').addEventListener('click', exportOBJ);
document.getElementById('btn-export-gltf').addEventListener('click', exportGLTF);
document.getElementById('ui-toggle').addEventListener('click', () => {
    const uiContainer = document.getElementById('ui-container');
    setUiCollapsed(!uiContainer.classList.contains('collapsed'));
});
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
setUiCollapsed(false);
init();
