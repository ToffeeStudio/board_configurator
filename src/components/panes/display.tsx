import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useAppDispatch, useAppSelector } from 'src/store/hooks';
import { getSelectedKeyboardAPI, getSelectedConnectedDevice } from 'src/store/devicesSlice';
import { ToffeeFileSystemAPI, ToffeeLightingAPI, ToffeeHIDDevice } from 'src/utils/toffee_studio/hid';
import { processImageToRGB565, convertRawToPngDataUrl } from 'src/utils/toffee_studio/imageProcessor';
import { Buffer } from 'buffer';
import { getCdcStatus } from 'src/store/cdcSlice';
import { connectCdcPort, disconnectCdcPort, sendImageViaCdc, listAllFilesViaCdc } from 'src/store/cdcThunks';

const DisplayPaneContainer = styled.div`
  padding: 20px;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 15px;

  button {
    cursor: pointer;
    padding: 8px 12px;
    border-radius: 4px;
    border: 1px solid #ccc;
    background-color: #f0f0f0;
    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  }

  h2 {
    margin-bottom: 0;
    margin-top: 10px;
  }
`;

export const DisplayPane: React.FC = () => {
  const dispatch = useAppDispatch();
  const keyboardAPI = useAppSelector(getSelectedKeyboardAPI);
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);
  const cdcStatus = useAppSelector(getCdcStatus);


  const [lightingState, setLightingState] = useState<{
    effect: number;
    speed: number;
    brightness: number;
    hue: number;
    saturation: number;
  } | null>(null);

  useEffect(() => {
    const fetchLightingState = async () => {
      if (!keyboardAPI) {
        setLightingState(null); // Clear state if keyboard disconnects
        return;
      }
      try {
        const webHidDevice = (keyboardAPI.getHID() as any)._hidDevice._device;
        const toffeeDevice = new ToffeeHIDDevice(webHidDevice);
        await toffeeDevice.open();
        const lightingApi = new ToffeeLightingAPI(toffeeDevice);

        console.log("Fetching initial lighting state for display...");
        const currentState = await lightingApi.getLightingState();
        setLightingState(currentState);
        console.log("State received:", currentState);

      } catch (e) {
        console.error("Failed to get lighting state:", e);
        setLightingState(null); // Set to null on error
      }
    };

    fetchLightingState();
  }, [keyboardAPI]); // This effect re-runs whenever the keyboardAPI object changes

  const [processedImageData, setProcessedImageData] = useState<Uint8Array | null>(null);
  const [targetFilename, setTargetFilename] = useState<string>('');
  const [receivedFiles, setReceivedFiles] = useState<{ filename: string; data: Uint8Array }[]>([]);
  const [pngImageUrls, setPngImageUrls] = useState<Record<string, string>>({});

  const handleTestButtonClick = async () => {
    if (!selectedDevice || !keyboardAPI) {
      alert('Please connect a keyboard first.');
      return;
    }
    const webHidDevice = (keyboardAPI.getHID() as any)._hidDevice._device;
    if (!webHidDevice) {
      alert('Could not get the underlying WebHID device.');
      return;
    }
    const toffeeDevice = new ToffeeHIDDevice(webHidDevice);
    try {
      await toffeeDevice.open();
      const fs = new ToffeeFileSystemAPI(toffeeDevice);
      const files = await fs.ls();
      alert(files.length > 0 ? `Files found:\n${files.join('\n')}` : 'No files found.');
    } catch (error) {
      alert(`An error occurred: ${error}`);
    }
  };

  const handleCdcConnectClick = () => {
    dispatch(connectCdcPort());
  };

  const handleCdcDisconnectClick = () => {
    dispatch(disconnectCdcPort());
  };

  const handleImageSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      console.log('No file selected.');
      return;
    }

    console.log(`Processing image: ${file.name}`);
    setProcessedImageData(null);
    setTargetFilename('');

    try {
      const imageData = await processImageToRGB565(file); // This will now handle both static and gif
      const isGif = file.type === 'image/gif';
      const extension = isGif ? '.araw' : '.raw';

      // Sanitize filename to match Python script's behavior
      const baseName = file.name.substring(0, file.name.lastIndexOf('.') || file.name.length);
      const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);

      const filename = sanitizedBaseName + extension;
      setProcessedImageData(imageData);
      setTargetFilename(filename);

      console.log('--- Image Processing Complete ---');
      console.log('Target Filename:', filename);
      console.log('Processed Data Byte Length:', imageData.byteLength);
      console.log(
        'First 32 bytes (hex):',
        Buffer.from(imageData.slice(0, 32)).toString('hex'),
      );
      console.log('-------------------------------');
      alert(`Image processed successfully! Ready to send as ${filename}.`);
    } catch (error) {
      console.error('Failed to process image:', error);
      alert(`Error processing image: ${error as any}`);
    }
  };

  const handleSendImageClick = async () => {
    if (cdcStatus !== 'Connected') {
      alert('Please connect to the CDC port first.');
      return;
    }
    if (!processedImageData || !targetFilename) {
      alert('Please process an image first.');
      return;
    }
    dispatch(sendImageViaCdc(targetFilename, processedImageData));
    alert(`Successfully sent ${targetFilename}! Use "LS_ALL" to verify.`);
  };

  const handleLsAllClick = async () => {
    if (cdcStatus !== 'Connected') {
      alert('Please connect to the CDC port first.');
      return;
    }

    setReceivedFiles([]);
    setPngImageUrls({});
    
    try {
      // Dispatch the thunk and await the result directly.
      // The .unwrap() function is removed.
      const files = await dispatch(listAllFilesViaCdc());

      if (files.length > 0) {
        alert(`Successfully received ${files.length} files. Now converting...`);
        setReceivedFiles(files);

        const imageUrls: Record<string, string> = {};
        for (const file of files) {
          if (file.filename.toLowerCase().endsWith('.raw')) {
            const dataUrl = convertRawToPngDataUrl(file.data);
            if (dataUrl) {
              imageUrls[file.filename] = dataUrl;
            }
          }
        }
        setPngImageUrls(imageUrls);
      } else {
        alert("No files were received from the device.");
      }
    } catch (error) {
      // The thunk already set the Redux error state, so we just alert the user.
      alert(`An error occurred while receiving files: ${error}`);
    }
  };

  const handleSetAnimationClick = async () => {
    if (!keyboardAPI || !selectedDevice) return alert('Device not connected.');
    try {
      const webHidDevice = (keyboardAPI.getHID() as any)._hidDevice._device;
      const toffeeDevice = new ToffeeHIDDevice(webHidDevice);
      await toffeeDevice.open();
      const lightingApi = new ToffeeLightingAPI(toffeeDevice);
      await lightingApi.setAnimation(1); // Set to animation ID 1 (Breathing)
      alert('Set animation to Breathing (1)');
    } catch (e) {
      alert(`Error: ${e}`);
    }
  };

  const handleSetSpeedClick = async () => {
    if (!keyboardAPI || !selectedDevice) return alert('Device not connected.');
    try {
      const webHidDevice = (keyboardAPI.getHID() as any)._hidDevice._device;
      const toffeeDevice = new ToffeeHIDDevice(webHidDevice);
      await toffeeDevice.open();
      const lightingApi = new ToffeeLightingAPI(toffeeDevice);
      await lightingApi.setSpeed(128); // Set speed to medium
      alert('Set speed to 128');
    } catch (e) {
      alert(`Error: ${e}`);
    }
  };

  const handleSetBrightnessClick = async () => {
    if (!keyboardAPI || !selectedDevice) return alert('Device not connected.');
    try {
      const webHidDevice = (keyboardAPI.getHID() as any)._hidDevice._device;
      const toffeeDevice = new ToffeeHIDDevice(webHidDevice);
      await toffeeDevice.open();
      const lightingApi = new ToffeeLightingAPI(toffeeDevice);
      await lightingApi.setBrightness(150); // Set brightness to ~60%
    } catch (e) {
      alert(`Error: ${e}`);
    }
  };

  const handleSetColorClick = async (a: any, b: any) => {
    if (!keyboardAPI || !selectedDevice) return alert('Device not connected.');
    try {
      const webHidDevice = (keyboardAPI.getHID() as any)._hidDevice._device;
      const toffeeDevice = new ToffeeHIDDevice(webHidDevice);
      await toffeeDevice.open();
      const lightingApi = new ToffeeLightingAPI(toffeeDevice);
      await lightingApi.setColor(a, b);
    } catch (e) {
      alert(`Error: ${e}`);
    }
  };


  return (
    <DisplayPaneContainer>
      <h1>Display Experimentation Page</h1>
      <div style={{ border: '1px solid #ccc', padding: '10px', borderRadius: '5px' }}>
        <h2>Lighting Control (Test Buttons)</h2>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
          <button onClick={handleSetAnimationClick}>Set Anim to Breathing (1)</button>
          <button onClick={handleSetSpeedClick}>Set Speed to 128</button>
          <button onClick={handleSetBrightnessClick}>Set Brightness to 150</button>
          <button onClick={()=>handleSetColorClick(212, 255)}>Set Color to Purple</button>
          <button onClick={()=>handleSetColorClick(0, 255)}>Set Color to Red</button>
        </div>
      </div>
      <p>Status: {keyboardAPI ? 'Connected' : 'Disconnected'}</p>
      <div style={{ border: '1px solid #ccc', padding: '10px', borderRadius: '5px' }}>
        <h2>Live Underglow State</h2>
        {lightingState ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div
              style={{
                width: '50px',
                height: '50px',
                backgroundColor: `hsl(${lightingState.hue * 360 / 255}, ${lightingState.saturation * 100 / 255}%, 50%)`,
                border: '1px solid white',
              }}
              title={`Hue: ${lightingState.hue}, Sat: ${lightingState.saturation}`}
            />
            <pre style={{ margin: 0, padding: 0, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(lightingState, null, 2)}
            </pre>
          </div>
        ) : (
          <p>Fetching lighting state... (ensure a compatible keyboard is connected)</p>
        )}
      </div>
      <button onClick={handleTestButtonClick}>LS COMMAND TEST</button>
      <hr />
      <h2>CDC/Serial Communication</h2>
      <p>
        CDC Status:{' '}
        <strong style={{ color: cdcStatus === 'Connected' ? 'green' : 'red' }}>
          {cdcStatus}
        </strong>
      </p>

      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={handleCdcConnectClick}
          disabled={cdcStatus === 'Connected' || cdcStatus === 'Connecting...'}
        >
          Connect to CDC Port
        </button>
        <button
          onClick={handleCdcDisconnectClick}
          disabled={cdcStatus !== 'Connected'}
        >
          Disconnect CDC Port
        </button>
      </div>
      
      <div>
        <h3>Image Upload</h3>
        <p>Select a 128x128 image to convert and send via CDC.</p>
        <input
          type="file"
          accept="image/png, image/jpeg, image/gif, image/bmp"
          onChange={handleImageSelect}
          style={{ marginBottom: '10px' }}
        />
        {processedImageData && (
          <p style={{ color: 'green' }}>
            Image ready: <strong>{targetFilename}</strong> ({processedImageData.byteLength} bytes)
          </p>
        )}
      </div>

      <button
        onClick={handleSendImageClick}
        disabled={cdcStatus !== 'Connected' || !processedImageData}
        title={
          cdcStatus !== 'Connected'
            ? 'Connect to CDC port first'
            : !processedImageData
            ? 'Process an image first'
            : 'Send the processed image'
        }
      >
        Send Image via CDC
      </button>
      <button onClick={handleLsAllClick} disabled={cdcStatus !== 'Connected'}>
        LS_ALL (Receive files via CDC)
      </button>
      {receivedFiles.length > 0 && (
        <div>
          <h3>Received Files ({receivedFiles.length}):</h3>
          <ul style={{ listStyle: 'disc', paddingLeft: '20px' }}>
            {receivedFiles.map(file => (
              <li key={file.filename}>
                {file.filename} ({file.data.byteLength} bytes)
              </li>
            ))}
          </ul>
        </div>
      )}
      {Object.keys(pngImageUrls).length > 0 && (
        <div>
          <hr style={{ margin: '20px 0' }} />
          <h3>Received Images:</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px' }}>
            {Object.entries(pngImageUrls).map(([filename, dataUrl]) => (
              <div key={filename} style={{ textAlign: 'center', border: '1px solid #ddd', padding: '5px' }}>
                <img src={dataUrl} alt={filename} title={filename} style={{ width: '128px', height: '128px', display: 'block' }} />
                <p style={{ margin: '5px 0 0 0', fontSize: '12px' }}>{filename}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </DisplayPaneContainer>
  );
};
