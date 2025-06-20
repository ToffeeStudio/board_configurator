// src/utils/toffee_studio/imageProcessor.ts

/**
 * Processes an image file to a raw RGB565 (Big Endian) byte array.
 * This function uses the browser's canvas API to resize and read pixel data.
 * @param file The image file selected by the user (e.g., from an <input type="file">).
 * @param targetWidth The desired width of the output image. Defaults to 128.
 * @param targetHeight The desired height of the output image. Defaults to 128.
 * @returns A promise that resolves with the Uint8Array of the raw image data.
 */
export function processImageToRGB565(
  file: File,
  targetWidth: number = 128,
  targetHeight: number = 128,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    // Step 1: Read the user-selected file into a data URL
    reader.onload = (event) => {
      const img = new Image();

      // Step 2: Load the data URL into an Image object
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          return reject(new Error('Could not get 2D context from canvas.'));
        }

        // Step 3: Draw the loaded image onto the canvas, which automatically resizes it
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        // Step 4: Get the raw pixel data from the canvas (in RGBA8888 format)
        const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
        const data = imageData.data;

        // Step 5: Convert RGBA8888 to RGB565 (Big Endian)
        const rgb565Buffer = new ArrayBuffer(targetWidth * targetHeight * 2);
        const dataView = new DataView(rgb565Buffer);

        let byteOffset = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Alpha (data[i + 3]) is ignored for this conversion

          // Convert from 8-bit channels to 5-bit Red, 6-bit Green, 5-bit Blue
          const r5 = (r >> 3) & 0x1f;
          const g6 = (g >> 2) & 0x3f;
          const b5 = (b >> 3) & 0x1f;

          // Combine the bits into a single 16-bit value (RGB565)
          const rgb565 = (r5 << 11) | (g6 << 5) | b5;

          // Write the 16-bit value as Big Endian to our buffer
          dataView.setUint16(byteOffset, rgb565, false); // `false` for big-endian
          byteOffset += 2;
        }

        resolve(new Uint8Array(rgb565Buffer));
      };
      img.onerror = () => reject(new Error('Failed to load image.'));
      
      if (event.target?.result) {
        img.src = event.target.result as string;
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Converts a raw RGB565 (Big Endian) byte array into a PNG data URL.
 * @param rawData The Uint8Array containing the raw image data.
 * @param width The width of the image. Defaults to 128.
 * @param height The height of the image. Defaults to 128.
 * @returns A string containing the data URL (e.g., "data:image/png;base64,...").
 */
export function convertRawToPngDataUrl(
  rawData: Uint8Array,
  width: number = 128,
  height: number = 128,
): string {
  const expectedBytes = width * height * 2;
  if (rawData.byteLength !== expectedBytes) {
    console.error(`File size mismatch. Expected ${expectedBytes}, got ${rawData.byteLength}.`);
    return ''; // Return empty string or a placeholder image URL on error
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create 2D canvas context.');
  }

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  const rawDataView = new DataView(rawData.buffer);

  let dataIndex = 0; // Index for the RGBA imageData array (goes up by 4)
  // Loop through the rawData, reading 2 bytes (16 bits) at a time
  for (let i = 0; i < rawData.byteLength; i += 2) {
    // Read a 16-bit Big Endian unsigned short
    const rgb565 = rawDataView.getUint16(i, false); // false for big-endian

    // Convert RGB565 to RGB888 components
    const r5 = (rgb565 >> 11) & 0x1f;
    const g6 = (rgb565 >> 5) & 0x3f;
    const b5 = rgb565 & 0x1f;

    // Scale components to 8-bit
    const r8 = (r5 << 3) | (r5 >> 2);
    const g8 = (g6 << 2) | (g6 >> 4);
    const b8 = (b5 << 3) | (b5 >> 2);

    // Set the pixel in the ImageData object (RGBA format)
    data[dataIndex++] = r8; // Red
    data[dataIndex++] = g8; // Green
    data[dataIndex++] = b8; // Blue
    data[dataIndex++] = 255; // Alpha (fully opaque)
  }

  // Put the processed pixel data onto the canvas
  ctx.putImageData(imageData, 0, 0);

  // Return the canvas content as a PNG data URL
  return canvas.toDataURL('image/png');
}
