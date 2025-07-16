import * as GIF from 'gifuct-js';

/**
 * Converts the content of a canvas to a raw RGB565 (big-endian) byte array.
 * Fast path: avoids DataView and per-pixel function calls.
 */
function canvasToRGB565(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): Uint8Array {
  const src = ctx.getImageData(0, 0, w, h).data;      // RGBA
  const dst = new Uint8Array(w * h * 2);               // 2 bytes / pixel

  let di = 0;
  for (let si = 0; si < src.length; si += 4) {
    const r = src[si] & 0xf8;                          // top 5 bits
    const g = src[si + 1] & 0xfc;                      // top 6 bits
    const b = src[si + 2] >> 3;                        // top 5 bits

    const rgb565 = (r << 8) | (g << 3) | b;            // big-endian
    dst[di++] = rgb565 >> 8;
    dst[di++] = rgb565 & 0xff;
  }
  return dst;
}

export function processImageToRGB565(
  file: File,
  targetWidth = 128,
  targetHeight = 128,
): Promise<Uint8Array> {
  return new Promise(async (resolve, reject) => {
    /* ------------------------------------------------------------------ */
    /*                          Animated GIF path                         */
    /* ------------------------------------------------------------------ */
    if (file.type === 'image/gif') {
      console.log('[ImageProcessor] Starting GIF processing…');
      try {
        const buffer = await file.arrayBuffer();
        const gif = GIF.parseGIF(buffer);
        const frames = GIF.decompressFrames(gif, true);

        if (!frames?.length) {
          return reject(new Error('Could not decompress any frames from the GIF.'));
        }
        console.log(`[ImageProcessor] Decompressed ${frames.length} frames.`);

        /* ---------- stateful full-size canvas ---------- */
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = gif.lsd.width;
        frameCanvas.height = gif.lsd.height;
        const frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true });

        /* ---------- temp canvas for resize / conversion ---------- */
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = targetWidth;
        tempCanvas.height = targetHeight;
        const tempCtx = tempCanvas.getContext('2d');

        if (!frameCtx || !tempCtx) {
          return reject(new Error('Failed to create canvas contexts.'));
        }

        tempCtx.imageSmoothingEnabled = true;
        tempCtx.imageSmoothingQuality = 'high';

        /* ---------- reusable patch helpers ---------- */
        const patchCanvas = document.createElement('canvas');
        const patchCtx = patchCanvas.getContext('2d', { willReadFrequently: true })!;
        let patchImageData: ImageData | null = null;

        const allFramesData: Uint8Array[] = [];

        /* ---------- main frame loop ---------- */
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i];
          console.log(`[ImageProcessor] --- Processing Frame ${i} ---`);

          /* snapshot for disposal type 3 */
          const snapshot = frameCtx.getImageData(
            0,
            0,
            frameCanvas.width,
            frameCanvas.height,
          );

          /* PATCH → MAIN CANVAS */
          if (
            !patchImageData ||
            patchImageData.width !== frame.dims.width ||
            patchImageData.height !== frame.dims.height
          ) {
            patchCanvas.width = frame.dims.width;
            patchCanvas.height = frame.dims.height;
            patchImageData = patchCtx.createImageData(
              frame.dims.width,
              frame.dims.height,
            );
          }
          patchImageData.data.set(new Uint8ClampedArray(frame.patch));
          patchCtx.putImageData(patchImageData, 0, 0);
          frameCtx.drawImage(patchCanvas, frame.dims.left, frame.dims.top);

          /* RESIZE & CONVERT */
          tempCtx.fillStyle = '#000';
          tempCtx.fillRect(0, 0, targetWidth, targetHeight);
          tempCtx.drawImage(frameCanvas, 0, 0, targetWidth, targetHeight);

          const rgb565 = canvasToRGB565(tempCtx, targetWidth, targetHeight);
          allFramesData.push(rgb565);

          /* DISPOSAL */
          if (frame.disposalType === 2) {
            frameCtx.clearRect(
              frame.dims.left,
              frame.dims.top,
              frame.dims.width,
              frame.dims.height,
            );
          } else if (frame.disposalType === 3) {
            frameCtx.putImageData(snapshot, 0, 0);
          }
        }

        /* ---------- concatenate frames ---------- */
        const totalLen = allFramesData.reduce((sum, b) => sum + b.length, 0);
        const finalBuf = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of allFramesData) {
          finalBuf.set(chunk, offset);
          offset += chunk.length;
        }

        console.log(`[ImageProcessor] Total data size: ${totalLen} bytes.`);
        return resolve(finalBuf);
      } catch (err) {
        console.error('[ImageProcessor] Error processing GIF:', err);
        return reject(err);
      }
    }

    /* ------------------------------------------------------------------ */
    /*                         Static image path                          */
    /* ------------------------------------------------------------------ */
    console.log('[ImageProcessor] Processing as static image…');
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Failed to get context for static image.'));

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        const rgb565 = canvasToRGB565(ctx, targetWidth, targetHeight);
        console.log(
          `[ImageProcessor] Static image processed. Size: ${rgb565.length} bytes.`,
        );
        return resolve(rgb565);
      };
      img.onerror = () => reject(new Error('Failed to load image.'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('FileReader failed for static image.'));
    reader.readAsDataURL(file);
  });
}

/* -------------------------------------------------------------------------- */
/*                           Helper for debugging UI                           */
/* -------------------------------------------------------------------------- */

export function convertRawToPngDataUrl(
  rawData: Uint8Array,
  width = 128,
  height = 128,
): string {
  const frameBytes = width * height * 2;
  if (rawData.byteLength < frameBytes) {
    throw new Error('Data too small for one frame.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(width, height);
  const dst = imgData.data;
  const view = new DataView(rawData.buffer, rawData.byteOffset, frameBytes);

  let di = 0;
  for (let i = 0; i < frameBytes; i += 2) {
    const val = view.getUint16(i, false); // big-endian
    const r = ((val >> 11) & 0x1f) * 255 / 31;
    const g = ((val >> 5) & 0x3f) * 255 / 63;
    const b = (val & 0x1f) * 255 / 31;
    dst[di++] = r;
    dst[di++] = g;
    dst[di++] = b;
    dst[di++] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}
