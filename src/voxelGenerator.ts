import * as THREE from 'three';
import type { ProjectionImage } from './imageProcessing';

type IndexedVoxel = {
    id: number;
    x: number;
    y: number;
    z: number;
    frontColor: [number, number, number];
    sideColor: [number, number, number];
};

type Dimensions = {
    width: number;
    height: number;
    depth: number;
};

function createVoxelIndex(width: number, depth: number) {
    const planeSize = width * depth;

    return {
        encode(x: number, y: number, z: number) {
            return x + z * width + y * planeSize;
        },
        xPlus(id: number, x: number) {
            return x + 1 < width ? id + 1 : -1;
        },
        xMinus(id: number, x: number) {
            return x > 0 ? id - 1 : -1;
        },
        yPlus(id: number, y: number, height: number) {
            return y + 1 < height ? id + planeSize : -1;
        },
        yMinus(id: number, y: number) {
            return y > 0 ? id - planeSize : -1;
        },
        zPlus(id: number, z: number) {
            return z + 1 < depth ? id + width : -1;
        },
        zMinus(id: number, z: number) {
            return z > 0 ? id - width : -1;
        }
    };
}

function addFace(
    vertices: number[],
    normals: number[],
    colors: number[],
    corners: [
        [number, number, number],
        [number, number, number],
        [number, number, number],
        [number, number, number]
    ],
    normal: [number, number, number],
    color: [number, number, number]
) {
    vertices.push(...corners[0], ...corners[1], ...corners[3], ...corners[1], ...corners[2], ...corners[3]);

    const vertexColor = [color[0] / 255, color[1] / 255, color[2] / 255];
    for (let i = 0; i < 6; i++) {
        normals.push(...normal);
        colors.push(...vertexColor);
    }
}

function buildVoxelMap(front: ProjectionImage, side: ProjectionImage, index: ReturnType<typeof createVoxelIndex>) {
    const voxelMap = new Map<number, IndexedVoxel>();

    for (let y = 0; y < front.height; y++) {
        const actualY = front.height - 1 - y;
        const activeFront: Array<{ x: number; color: [number, number, number] }> = [];
        const activeSide: Array<{ z: number; color: [number, number, number] }> = [];

        for (let x = 0; x < front.width; x++) {
            const offset = (y * front.width + x) * 4;
            if (front.data[offset + 3] === 0) {
                continue;
            }

            activeFront.push({
                x,
                color: [front.data[offset], front.data[offset + 1], front.data[offset + 2]]
            });
        }

        if (activeFront.length === 0) {
            continue;
        }

        for (let z = 0; z < side.width; z++) {
            const offset = (y * side.width + z) * 4;
            if (side.data[offset + 3] === 0) {
                continue;
            }

            activeSide.push({
                z,
                color: [side.data[offset], side.data[offset + 1], side.data[offset + 2]]
            });
        }

        if (activeSide.length === 0) {
            continue;
        }

        for (const frontPixel of activeFront) {
            for (const sidePixel of activeSide) {
                const id = index.encode(frontPixel.x, actualY, sidePixel.z);
                voxelMap.set(id, {
                    id,
                    x: frontPixel.x,
                    y: actualY,
                    z: sidePixel.z,
                    frontColor: frontPixel.color,
                    sideColor: sidePixel.color
                });
            }
        }
    }

    return voxelMap;
}

function collectVisibleVoxelIds(
    voxelMap: Map<number, IndexedVoxel>,
    dimensions: Dimensions,
    shellThickness: number,
    useCulling: boolean,
    index: ReturnType<typeof createVoxelIndex>
) {
    const visibleIds = new Set<number>();

    if (!useCulling) {
        for (const id of voxelMap.keys()) {
            visibleIds.add(id);
        }
        return visibleIds;
    }

    let currentLayer = new Set(voxelMap.keys());

    for (let layer = 0; layer < shellThickness && currentLayer.size > 0; layer++) {
        const nextInnerLayer = new Set<number>();

        for (const id of currentLayer) {
            const voxel = voxelMap.get(id);

            if (!voxel) {
                continue;
            }

            const neighborIds = [
                index.xPlus(id, voxel.x),
                index.xMinus(id, voxel.x),
                index.yPlus(id, voxel.y, dimensions.height),
                index.yMinus(id, voxel.y),
                index.zPlus(id, voxel.z),
                index.zMinus(id, voxel.z)
            ];

            const isSurface = neighborIds.some((neighborId) => neighborId < 0 || !currentLayer.has(neighborId));

            if (isSurface) {
                visibleIds.add(id);
            } else {
                nextInnerLayer.add(id);
            }
        }

        currentLayer = nextInnerLayer;
    }

    return visibleIds;
}

function buildGeometry(
    voxelMap: Map<number, IndexedVoxel>,
    visibleIds: Set<number>,
    dimensions: Dimensions,
    index: ReturnType<typeof createVoxelIndex>
) {
    const vertices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const halfSize = 0.5;

    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;
    const centerZ = dimensions.depth / 2;

    for (const id of visibleIds) {
        const voxel = voxelMap.get(id);

        if (!voxel) {
            continue;
        }

        const x = voxel.x - centerX;
        const y = voxel.y - centerY;
        const z = voxel.z - centerZ;

        const v: [
            [number, number, number],
            [number, number, number],
            [number, number, number],
            [number, number, number],
            [number, number, number],
            [number, number, number],
            [number, number, number],
            [number, number, number]
        ] = [
            [x - halfSize, y - halfSize, z - halfSize],
            [x + halfSize, y - halfSize, z - halfSize],
            [x + halfSize, y + halfSize, z - halfSize],
            [x - halfSize, y + halfSize, z - halfSize],
            [x - halfSize, y - halfSize, z + halfSize],
            [x + halfSize, y - halfSize, z + halfSize],
            [x + halfSize, y + halfSize, z + halfSize],
            [x - halfSize, y + halfSize, z + halfSize]
        ];

        const mixedColor: [number, number, number] = [
            (voxel.frontColor[0] + voxel.sideColor[0]) / 2,
            (voxel.frontColor[1] + voxel.sideColor[1]) / 2,
            (voxel.frontColor[2] + voxel.sideColor[2]) / 2
        ];

        const hasFront = visibleIds.has(index.zPlus(id, voxel.z));
        const hasBack = visibleIds.has(index.zMinus(id, voxel.z));
        const hasRight = visibleIds.has(index.xPlus(id, voxel.x));
        const hasLeft = visibleIds.has(index.xMinus(id, voxel.x));
        const hasTop = visibleIds.has(index.yPlus(id, voxel.y, dimensions.height));
        const hasBottom = visibleIds.has(index.yMinus(id, voxel.y));

        if (!hasFront) addFace(vertices, normals, colors, [v[5], v[4], v[7], v[6]], [0, 0, 1], voxel.frontColor);
        if (!hasBack) addFace(vertices, normals, colors, [v[0], v[1], v[2], v[3]], [0, 0, -1], voxel.frontColor);
        if (!hasRight) addFace(vertices, normals, colors, [v[1], v[5], v[6], v[2]], [1, 0, 0], voxel.sideColor);
        if (!hasLeft) addFace(vertices, normals, colors, [v[4], v[0], v[3], v[7]], [-1, 0, 0], voxel.sideColor);
        if (!hasTop) addFace(vertices, normals, colors, [v[6], v[7], v[3], v[2]], [0, 1, 0], mixedColor);
        if (!hasBottom) addFace(vertices, normals, colors, [v[4], v[5], v[1], v[0]], [0, -1, 0], mixedColor);
    }

    if (vertices.length === 0) {
        throw new Error('未生成几何体 (可能过滤太严格)');
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    return geometry;
}

export function buildVoxelGeometry({
    front,
    side,
    shellThickness,
    useCulling
}: {
    front: ProjectionImage;
    side: ProjectionImage;
    shellThickness: number;
    useCulling: boolean;
}) {
    const dimensions = {
        width: front.width,
        height: front.height,
        depth: side.width
    };

    const index = createVoxelIndex(dimensions.width, dimensions.depth);
    const voxelMap = buildVoxelMap(front, side, index);
    const visibleIds = collectVisibleVoxelIds(voxelMap, dimensions, shellThickness, useCulling, index);
    const geometry = buildGeometry(voxelMap, visibleIds, dimensions, index);

    return {
        dimensions,
        geometry,
        visibleVoxelCount: visibleIds.size
    };
}
