import React, { useState } from 'react';
import styled from 'styled-components';
import { useAppDispatch, useAppSelector } from 'src/store/hooks';
import { getSelectedKeyboardAPI, getSelectedConnectedDevice } from 'src/store/devicesSlice';
import { ToffeeFileSystemAPI, ToffeeHIDDevice } from 'src/utils/toffee_studio/hid';
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

  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setProcessedImageData(null);
    setTargetFilename('');
    try {
      const imageData = await processImageToRGB565(file);
      const filename = file.name.substring(0, file.name.lastIndexOf('.')) + '.raw';
      setProcessedImageData(imageData);
      setTargetFilename(filename);
      alert(`Image processed successfully! Ready to send as ${filename}.`);
    } catch (error) {
      alert(`Error processing image: ${error}`);
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

  return (
    <DisplayPaneContainer>
      <h1>Display Experimentation Page</h1>
      <p>Status: {keyboardAPI ? 'Connected' : 'Disconnected'}</p>
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
