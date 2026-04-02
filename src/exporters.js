import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

function assertMesh(mesh) {
    if (!mesh) {
        throw new Error('请先生成模型');
    }
}

function downloadFile(blob, filename) {
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);

    link.href = objectUrl;
    link.download = filename;
    link.click();

    setTimeout(() => URL.revokeObjectURL(objectUrl), 100);
}

export function exportSTL(mesh) {
    assertMesh(mesh);

    const exporter = new STLExporter();
    const stlString = exporter.parse(mesh, { binary: false });
    downloadFile(new Blob([stlString], { type: 'text/plain' }), 'model.stl');
}

export function exportOBJ(mesh) {
    assertMesh(mesh);

    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const color = geometry.getAttribute('color');

    let objContent = '# OBJ File Generated from 3D Voxel Generator\n';
    objContent += 'mtllib model.mtl\n';
    objContent += 'usemtl material0\n\n';

    for (let i = 0; i < position.count; i++) {
        objContent += `v ${position.getX(i).toFixed(4)} ${position.getY(i).toFixed(4)} ${position.getZ(i).toFixed(4)}`;
        if (color) {
            objContent += ` ${color.getX(i).toFixed(4)} ${color.getY(i).toFixed(4)} ${color.getZ(i).toFixed(4)}`;
        }
        objContent += '\n';
    }

    objContent += '\n';

    for (let i = 0; i < position.count; i += 3) {
        objContent += `f ${i + 1} ${i + 2} ${i + 3}\n`;
    }

    let mtlContent = '# MTL File\n';
    mtlContent += 'newmtl material0\n';
    mtlContent += 'Ka 1.0 1.0 1.0\n';
    mtlContent += 'Kd 0.8 0.8 0.8\n';
    mtlContent += 'Ks 0.5 0.5 0.5\n';
    mtlContent += 'Ns 32.0\n';
    mtlContent += 'd 1.0\n';
    mtlContent += 'illum 2\n';

    downloadFile(new Blob([objContent], { type: 'text/plain' }), 'model.obj');
    downloadFile(new Blob([mtlContent], { type: 'text/plain' }), 'model.mtl');
}

export function exportGLTF(mesh) {
    assertMesh(mesh);

    return new Promise((resolve, reject) => {
        const exporter = new GLTFExporter();
        exporter.parse(
            mesh,
            (result) => {
                downloadFile(
                    new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
                    'model.gltf'
                );
                resolve();
            },
            reject,
            { binary: false }
        );
    });
}
