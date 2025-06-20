import React, {useEffect, useRef, useState} from 'react';
import styled from 'styled-components';
import {useAppSelector} from 'src/store/hooks';
import {
  getSelectedKeyboardAPI,
  getSelectedConnectedDevice,
} from 'src/store/devicesSlice';
import {
  ToffeeFileSystemAPI,
  ToffeeHIDDevice,
} from 'src/utils/toffee_studio/hid';
import {ToffeeCDC} from 'src/utils/toffee_studio/cdc';
import {processFileToRaw, convertRawToPngDataUrl} from 'src/utils/toffee_studio/imageProcessor';
import {Buffer} from 'buffer';

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
  const keyboardAPI = useAppSelector(getSelectedKeyboardAPI);
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);

  const [cdcInstance] = useState(() => new ToffeeCDC());
  const [cdcStatus, setCdcStatus] = useState('Disconnected');

  const [processedImageData, setProcessedImageData] =
    useState<Uint8Array | null>(null);
  const [targetFilename, setTargetFilename] = useState<string>('');

  const [receivedFiles, setReceivedFiles] = useState<{ filename: string; data: Uint8Array }[]>([]);

  const [pngImageUrls, setPngImageUrls] = useState<Record<string, string>>({});

  const handleTestButtonClick = async () => {
    if (!selectedDevice || !keyboardAPI) {
      console.log('No keyboard connected.');
      alert('Please connect a keyboard first.');
      return;
    }

    const webHidDevice = (keyboardAPI.getHID() as any)._hidDevice._device;
    if (!webHidDevice) {
      console.error('Could not get the underlying WebHID device.');
      alert('Could not get the underlying WebHID device.');
      return;
    }

    console.log('Found WebHID Device:', webHidDevice);
    let toffeeDevice: ToffeeHIDDevice | null = null;

    try {
      console.log('Instantiating ToffeeHIDDevice...');
      toffeeDevice = new ToffeeHIDDevice(webHidDevice);
      await toffeeDevice.open();

      console.log('Instantiating ToffeeFileSystemAPI...');
      const fs = new ToffeeFileSystemAPI(toffeeDevice);

      console.log("Executing 'ls' command...");
      const files = await fs.ls();

      console.log('--- LS Command Result ---');
      if (files.length > 0) {
        console.log('Files found:', files);
        alert(`Files found:\n${files.join('\n')}`);
      } else {
        console.log('No files found or directory is empty.');
        alert('No files found or directory is empty.');
      }
      console.log('-------------------------');
    } catch (error) {
      console.error('Error during custom HID communication:', error);
      alert(`An error occurred: ${error}`);
    } finally {
      if (toffeeDevice) {
        console.log('Communication sequence finished.');
      }
    }
  };

  const handleCdcConnectClick = async () => {
    if (!selectedDevice) {
      alert('Connect a device in VIA first to get VID/PID.');
      return;
    }

    if (cdcInstance.isConnected()) {
      alert('CDC port is already connected.');
      return;
    }

    console.log(
      `Attempting to connect to CDC port for VID: 0x${selectedDevice.vendorId.toString(
        16,
      )}, PID: 0x${selectedDevice.productId.toString(16)}`,
    );
    setCdcStatus('Connecting...');
    const success = await cdcInstance.connect(
      selectedDevice.vendorId,
      selectedDevice.productId,
    );
    if (success) {
      setCdcStatus('Connected');
      console.log('CDC Connection Successful!');
    } else {
      setCdcStatus('Failed to Connect');
      console.error('CDC Connection Failed.');
      alert('Could not find or connect to the CDC serial port. Make sure it is not in use by another program.');
    }
  };

  const handleCdcDisconnectClick = async () => {
    if (cdcInstance.isConnected()) {
      await cdcInstance.disconnect();
      setCdcStatus('Disconnected');
    }
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
      const imageData = await processImageToRGB565(file);
      const filename =
        file.name.substring(0, file.name.lastIndexOf('.')) + '.raw';

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
      alert(`Error processing image: ${error}`);
    }
  };

  const handleSendImageClick = async () => {
    if (!cdcInstance.isConnected()) {
      alert('Please connect to the CDC port first.');
      return;
    }
    if (!processedImageData || !targetFilename) {
      alert('Please process an image first.');
      return;
    }

    try {
      await cdcInstance.sendFile(targetFilename, processedImageData);
      alert(
        `Successfully sent ${targetFilename} to the device! You can now use the "LS COMMAND TEST" button to verify the file exists.`,
      );
    } catch (error) {
      console.error('Failed to send image via CDC:', error);
      alert(`Failed to send image: ${error}`);
    }
  };

  const handleLsAllClick = async () => {
    if (!selectedDevice || !keyboardAPI) {
      alert('Connect a device in VIA first.');
      return;
    }
    if (!cdcInstance.isConnected()) {
      alert('Please connect to the CDC port first.');
      return;
    }

    const webHidDevice = (keyboardAPI.getHID() as any)._hidDevice._device;
    const toffeeDevice = new ToffeeHIDDevice(webHidDevice);
    await toffeeDevice.open();
    
    const fs = new ToffeeFileSystemAPI(toffeeDevice);

    console.log('Executing ls_all...');
    setPngImageUrls({}); // Clear previous images
    
    try {
      const files = await fs.ls_all(cdcInstance);
      if (files.length > 0) {
        alert(`Successfully received ${files.length} files. Now converting to images...`);

        const imageUrls: Record<string, string> = {};
        for (const file of files) {
          if (file.filename.toLowerCase().endsWith('.raw')) {
            console.log(`Converting ${file.filename} to PNG...`);
            const dataUrl = convertRawToPngDataUrl(file.data);
            if (dataUrl) {
              imageUrls[file.filename] = dataUrl;
            }
          }
        }
        setPngImageUrls(imageUrls);
      } else {
        alert("No files were received.");
      }
    } catch (error) {
      console.error("ls_all failed:", error);
      alert(`ls_all failed: ${error}`);
    }
  };

  return (
    <DisplayPaneContainer>
      <h1>Display Experimentation Page</h1>
      <p>Status: {keyboardAPI ? 'Connected' : 'Disconnected'}</p>
      <button onClick={handleTestButtonClick}>LS COMMAND TEST</button>

      <hr />

      <h2>CDC/Serial Communication</h2>
      <p>
        CDC Status:{' '}
        <strong style={{color: cdcStatus === 'Connected' ? 'green' : 'red'}}>
          {cdcStatus}
        </strong>
      </p>

      <div style={{display: 'flex', gap: '10px'}}>
        <button
          onClick={handleCdcConnectClick}
          disabled={cdcStatus === 'Connected'}
        >
          Connect to CDC Port
        </button>
        <button
          onClick={handleCdcDisconnectClick}
          disabled={!cdcInstance.isConnected()}
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
          style={{marginBottom: '10px'}}
        />
        {processedImageData && (
          <p style={{color: 'green'}}>
            Image ready: <strong>{targetFilename}</strong> (
            {processedImageData.byteLength} bytes)
          </p>
        )}
      </div>

      <button
        onClick={handleSendImageClick}
        disabled={!cdcInstance.isConnected() || !processedImageData}
        title={
          !cdcInstance.isConnected()
            ? 'Connect to CDC port first'
            : !processedImageData
            ? 'Process an image first'
            : 'Send the processed image'
        }
      >
        Send Image via CDC
      </button>
      <button onClick={handleLsAllClick} disabled={!cdcInstance.isConnected()}>
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
          <hr style={{margin: '20px 0'}} />
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
