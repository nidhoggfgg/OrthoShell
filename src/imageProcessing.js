function readImage(file) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(img);
        };
        img.onerror = (event) => {
            URL.revokeObjectURL(objectUrl);
            reject(event);
        };
        img.src = objectUrl;
    });
}

export function isPixelObject(data, index, config) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const a = data[index + 3];

    if (config.alpha && a < 20) {
        return false;
    }
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

function getVisibleBounds(img, filterConfig) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    const { data } = imageData;

    let minX = img.width;
    let minY = img.height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            const index = (y * img.width + x) * 4;
            if (!isPixelObject(data, index, filterConfig)) {
                continue;
            }

            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }

    if (maxX < 0 || maxY < 0) {
        return null;
    }

    return {
        canvas,
        minX,
        minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
    };
}

function cropAndResize(boundsInfo, targetHeight, filterConfig) {
    const { canvas, minX, minY, width, height } = boundsInfo;
    const scale = targetHeight / height;
    const targetWidth = Math.max(1, Math.round(width * scale));

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = targetWidth;
    finalCanvas.height = targetHeight;

    const ctx = finalCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, minX, minY, width, height, 0, 0, targetWidth, targetHeight);

    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);

    for (let i = 0; i < imageData.data.length; i += 4) {
        if (!isPixelObject(imageData.data, i, filterConfig)) {
            imageData.data[i] = 0;
            imageData.data[i + 1] = 0;
            imageData.data[i + 2] = 0;
            imageData.data[i + 3] = 0;
        }
    }

    return {
        data: imageData.data,
        width: targetWidth,
        height: targetHeight
    };
}

async function prepareSingleProjection(file, filterConfig, targetHeight) {
    const image = await readImage(file);
    const bounds = getVisibleBounds(image, filterConfig);

    if (!bounds) {
        throw new Error('未检测到有效物体，请调整过滤规则');
    }

    return cropAndResize(bounds, targetHeight, filterConfig);
}

export async function prepareProjectionImages({ frontFile, sideFile, filterConfig, targetHeight }) {
    const [front, side] = await Promise.all([
        prepareSingleProjection(frontFile, filterConfig, targetHeight),
        prepareSingleProjection(sideFile, filterConfig, targetHeight)
    ]);

    return { front, side };
}
