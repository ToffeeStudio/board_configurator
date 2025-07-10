import { Buffer } from 'buffer';

export class ToffeeCDC {
  private port: SerialPort | null = null;
  private keepReading: boolean = false;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  public isConnected(): boolean {
    return this.port !== null && !!this.port.readable;
  }

  /**
   * Prompts the user to select a serial port and opens it.
   * This method does NOT start a read loop. It only establishes the connection.
   */
  public async connect(
    vendorId: number,
    productId: number,
  ): Promise<boolean> {
    try {
      if (this.isConnected()) {
        await this.disconnect();
      }

      this.port = await navigator.serial.requestPort({
        filters: [{usbVendorId: vendorId, usbProductId: productId}],
      });

      await this.port.open({baudRate: 115200}); // Baud rate is often ignored for USB CDC but good to set
      console.log('Serial port opened.');
      return true;
    } catch (error) {
      console.error('Failed to connect to CDC port:', error);
      this.port = null;
      return false;
    }
  }

  /**
   * Disconnects from the serial port, ensuring any readers are cancelled.
   */
  public async disconnect(): Promise<void> {
    this.keepReading = false; // Signal any active read loops to stop
    if (this.reader) {
      try {
        await this.reader.cancel(); // This will cause the read() promise in the loop to reject
      } catch (error) {
        console.warn('Error cancelling reader:', error);
      }
    }
    
    if (this.port) {
      try {
        // The port needs to be unlocked before it can be closed.
        // The reader.cancel() above handles the readable stream.
        // If a writable stream were also locked, it would need to be released.
        await this.port.close();
        console.log('Serial port closed.');
      } catch (error) {
        console.error('Failed to close serial port:', error);
      } finally {
        this.port = null;
        this.reader = null;
      }
    }
  }


  /**
   * Sends a file to the device using the (filename, size, data) protocol.
   * It acquires a writer, sends the data, and releases the writer.
   */
  public async sendFile(filename: string, data: Uint8Array): Promise<void> {
    if (!this.isConnected() || !this.port?.writable) {
      throw new Error('CDC port is not connected or not writable.');
    }

    const writer = this.port.writable.getWriter();
    try {
      console.log(`--- Starting file transfer for ${filename} ---`);

      // 1. Send Filename (UTF-8 encoded, null-terminated)
      const textEncoder = new TextEncoder();
      const filenameBytes = textEncoder.encode(filename);
      const nullTerminatedFilename = new Uint8Array(filenameBytes.length + 1);
      nullTerminatedFilename.set(filenameBytes, 0);
      nullTerminatedFilename[filenameBytes.length] = 0;

      console.log(`Sending filename: ${filename} (${nullTerminatedFilename.byteLength} bytes)`);
      await writer.write(nullTerminatedFilename);
      await new Promise((resolve) => setTimeout(resolve, 100)); // Crucial delay for firmware

      // 2. Send Size (4 bytes, Little Endian)
      const size = data.byteLength;
      const sizeBuffer = new ArrayBuffer(4);
      const sizeView = new DataView(sizeBuffer);
      sizeView.setUint32(0, size, true); // true for little-endian

      console.log(`Sending size: ${size} bytes`);
      await writer.write(new Uint8Array(sizeBuffer));
      await new Promise((resolve) => setTimeout(resolve, 100)); // Crucial delay for firmware

      // 3. Send Actual Data in Chunks
      console.log(`Sending data block (${data.length} bytes)...`);
      const CHUNK_SIZE = 4096; // Same as working Python script
      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.subarray(i, i + CHUNK_SIZE);
        await writer.write(chunk);
      }
      console.log('--- File transfer complete ---');
    } catch (error) {
      console.error('Error during file send:', error);
      await writer.abort().catch(() => {});
      throw error;
    } finally {
      writer.releaseLock();
    }
  }
  /**
   * Listens on the CDC port for a stream of files and receives them.
   * Assumes the transfer is initiated by an external trigger (e.g., an HID command).
   * @param timeoutMs The maximum time to wait for the first byte of a new file.
   * @returns A promise that resolves to an array of received files.
   */
  public async receiveFiles(timeoutMs: number = 3000): Promise<{ filename: string; data: Uint8Array }[]> {
    if (!this.isConnected() || !this.port?.readable) {
      throw new Error('CDC port is not connected or not readable.');
    }

    const receivedFiles: { filename: string; data: Uint8Array }[] = [];
    let streamBuffer = new Uint8Array();
    this.reader = this.port.readable.getReader();

    // Helper function to create a timeout promise
    const readTimeout = (ms: number) => new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Read timed out after ${ms}ms`)), ms)
    );

    try {
      console.log('Starting file reception loop...');
      while (true) {
        try {
          // --- 1. Find the next filename in the stream ---
          let nullIndex = -1;
          while (nullIndex === -1) {
            const { value } = await Promise.race([this.reader.read(), readTimeout(timeoutMs)]) as ReadableStreamReadResult<Uint8Array>;
            if (!value) continue;

            const newData = new Uint8Array(streamBuffer.length + value.length);
            newData.set(streamBuffer);
            newData.set(value, streamBuffer.length);
            streamBuffer = newData;
            
            nullIndex = streamBuffer.indexOf(0);
          }

          const filenameBytes = streamBuffer.slice(0, nullIndex);
          streamBuffer = streamBuffer.slice(nullIndex + 1);

          if (filenameBytes.length === 0) {
            console.log('Received termination signal (empty filename). Transfer complete.');
            break;
          }

          const filename = new TextDecoder().decode(filenameBytes);
          console.log(`[OK] Received Filename: '${filename}'`);
    
          // --- 2. Get the file size (4 bytes) ---
          while (streamBuffer.length < 4) {
            const { value } = await Promise.race([this.reader.read(), readTimeout(timeoutMs)]) as ReadableStreamReadResult<Uint8Array>;
            if (!value) continue;
            const newData = new Uint8Array(streamBuffer.length + value.length);
            newData.set(streamBuffer);
            newData.set(value, streamBuffer.length);
            streamBuffer = newData;
          }

          const sizeBytes = streamBuffer.slice(0, 4);
          const expectedSize = new DataView(sizeBytes.buffer, sizeBytes.byteOffset, sizeBytes.byteLength).getUint32(0, true);
          streamBuffer = streamBuffer.slice(4);
          console.log(`[OK] Expecting Size: ${expectedSize} bytes. Leftover data in buffer: ${streamBuffer.length} bytes.`);
    
          // --- 3. Get the file data ---
          while (streamBuffer.length < expectedSize) {
            const { value } = await Promise.race([this.reader.read(), readTimeout(timeoutMs)]) as ReadableStreamReadResult<Uint8Array>;
            if (!value) continue;
            const newData = new Uint8Array(streamBuffer.length + value.length);
            newData.set(streamBuffer);
            newData.set(value, streamBuffer.length);
            streamBuffer = newData;
          }

          const fileData = streamBuffer.slice(0, expectedSize);
          streamBuffer = streamBuffer.slice(expectedSize);
          
          console.log(`[OK] -> Received ${fileData.byteLength} bytes for '${filename}'.`);
          receivedFiles.push({ filename, data: fileData });

        } catch (error: any) {
          // If the error is our specific timeout error, it means the transfer is done.
          if (error.message.startsWith('Read timed out')) {
            console.log('Read timed out, assuming transfer is complete. This is the expected success path.');
            break; // Exit the main while loop
          }
          // If it's a different error, re-throw it.
          throw error;
        }
      }
    } catch (error) {
        console.error('An unexpected error occurred during file reception:', error);
    } finally {
      if (this.reader) {
        this.reader.releaseLock();
        this.reader = null;
      }
    }
    
    return receivedFiles;
  }
}
