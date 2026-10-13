import React, { useState, useEffect, useMemo } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { useAppDispatch, useAppSelector } from 'src/store/hooks';
import { getSelectedKeyboardAPI, getSelectedConnectedDevice } from 'src/store/devicesSlice';
import { ToffeeFileSystemAPI, ToffeeLightingAPI, ToffeeHIDDevice } from 'src/utils/toffee_studio/hid';
import { processImageToRGB565, convertRawToPngDataUrl } from 'src/utils/toffee_studio/imageProcessor';
import { Buffer } from 'buffer';
import { getCdcStatus } from 'src/store/cdcSlice';
import { connectCdcPort, disconnectCdcPort, sendImageViaCdc, listAllFilesViaCdc } from 'src/store/cdcThunks';
import { GlowingMenu } from '../toffee_studio/GlowingMenu/GlowingMenu';

const fadeSlideIn = keyframes`
  0% {
    opacity: 0;
    transform: translateY(10px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
`;

const DisplayPaneContainer = styled.div`
  padding: 20px;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 15px;
  animation: ${fadeSlideIn} 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;

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

/* =========================================
   EXPERIMENTAL TOGGLE STYLES
   ========================================= */

// --- STYLE 1: NEON GRADIENT PILL ---
const TogglePillWrapper = styled.label<{ $active: boolean }>`
  position: relative;
  display: inline-block;
  width: 50px;
  height: 28px;
  cursor: pointer;
  border-radius: 28px;
  transition: all 0.3s ease;
  
  /* Off State */
  background: #1a1d2e; 
  border: 1px solid #3B2F63; 
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.5);

  /* On State */
  ${props => props.$active && css`
    background: linear-gradient(90deg, #7b4dff, #00e5ff);
    border-color: transparent;
    box-shadow: 0 0 15px rgba(123, 77, 255, 0.4); // Outer glow
  `}
`;

const TogglePillKnob = styled.span<{ $active: boolean }>`
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);

  ${props => props.$active && css`
    transform: translateX(22px);
  `}
`;

// --- STYLE 2: CYBER PLATE ---
const ToggleCyberWrapper = styled.label<{ $active: boolean }>`
  position: relative;
  display: inline-block;
  width: 54px;
  height: 26px;
  cursor: pointer;
  background: #0f101c;
  border: 1px solid #3B2F63;
  border-radius: 4px;
  overflow: hidden;
  transition: all 0.3s ease;

  ${props => props.$active && css`
    border-color: #00e5ff;
    box-shadow: 0 0 8px rgba(0, 229, 255, 0.15);
    
    /* Inner glow wash */
    &::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, rgba(123, 77, 255, 0.2), rgba(0, 229, 255, 0.2));
    }
  `}
`;

const ToggleCyberKnob = styled.span<{ $active: boolean }>`
  position: absolute;
  top: 2px;
  left: 2px;
  width: 24px;
  height: 20px;
  background: #2c2f48;
  border-radius: 2px;
  border: 1px solid #555;
  z-index: 2;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), background 0.3s, border-color 0.3s;
  
  /* Little grip lines */
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 2px;
  
  &::before, &::after {
    content: '';
    width: 1px;
    height: 8px;
    background: #555;
    transition: background 0.3s;
  }

  ${props => props.$active && css`
    transform: translateX(24px);
    background: #fff;
    border-color: #fff;
    
    &::before, &::after {
      background: #7b4dff;
    }
  `}
`;

// --- STYLE 3: ECLIPSE HALO (UPDATED) ---
const ToggleEclipseWrapper = styled.label`
  position: relative;
  display: inline-block;
  width: 48px;
  height: 24px;
  cursor: pointer;
  /* The track is just a thin line */
  &::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    width: 100%;
    height: 4px;
    background: #3B2F63;
    border-radius: 4px;
    transform: translateY(-50%);
  }
`;

const ToggleEclipseKnob = styled.span<{ $active: boolean }>`
  position: absolute;
  top: 0;
  left: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #1a1d2e;
  border: 1.5px solid #3B2F63; 
  box-sizing: border-box;
  
  transition: all 0.2s ease-out; 
  box-shadow: 0 0 0 rgba(0,0,0,0);

  ${props => props.$active && css`
    transform: translateX(24px);
    background: #1a1d2e; 
    border-color: color-mix(in srgb, #ffffff 30%, #7b4dff);
    box-shadow: 0 0 10px #7b4dff; 
  `}
`;

/* =========================================
   EXPERIMENTAL SLIDER STYLES
   ========================================= */

// Base styled input for range
const BaseRange = styled.input.attrs({ type: 'range' })`
  -webkit-appearance: none;
  width: 200px;
  background: transparent;
  cursor: pointer;
  
  &:focus {
    outline: none;
  }
`;

// --- STYLE 1: NEON PULSE SLIDER ---
const NeonRange = styled(BaseRange)<{ $percent: number }>`
  /* Track */
  &::-webkit-slider-runnable-track {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    /* Dynamic background gradient based on value */
    background: linear-gradient(to right, #7b4dff 0%, #00e5ff ${props => props.$percent}%, #1a1d2e ${props => props.$percent}%, #1a1d2e 100%);
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.5);
  }

  /* Thumb */
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    height: 18px;
    width: 18px;
    border-radius: 50%;
    background: #ffffff;
    margin-top: -6px; /* Center on track */
    box-shadow: 0 0 10px rgba(0, 229, 255, 0.8);
    transition: transform 0.1s ease;
  }

  &:active::-webkit-slider-thumb {
    transform: scale(1.2);
    box-shadow: 0 0 15px rgba(123, 77, 255, 1);
  }
`;

// --- STYLE 2: CYBER STRIP SLIDER ---
const CyberRange = styled(BaseRange)<{ $percent: number }>`
  /* Track */
  &::-webkit-slider-runnable-track {
    width: 100%;
    height: 12px;
    border: 1px solid #3B2F63;
    background: 
      repeating-linear-gradient(
        90deg,
        #1a1d2e,
        #1a1d2e 2px,
        transparent 2px,
        transparent 4px
      ),
      linear-gradient(to right, rgba(0, 229, 255, 0.2) 0%, rgba(0, 229, 255, 0.2) ${props => props.$percent}%, transparent ${props => props.$percent}%);
  }

  /* Thumb */
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    height: 16px;
    width: 8px;
    background: #0f101c;
    border: 1px solid #00e5ff;
    margin-top: -3px;
    box-shadow: 0 0 5px #00e5ff;
  }
`;

// --- STYLE 3: ECLIPSE HALO SLIDER (Matches Toggle) ---
const EclipseRange = styled(BaseRange)<{ $percent: number }>`
  /* Track: Thin line, minimal logic */
  &::-webkit-slider-runnable-track {
    width: 100%;
    height: 4px;
    background: #3B2F63; /* The structural color */
    border-radius: 4px;
  }

  /* Thumb: Dark circle with structural border + halo */
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    height: 24px;
    width: 24px;
    border-radius: 50%;
    background: #1a1d2e;
    border: 1.5px solid #3B2F63;
    margin-top: -10px; /* (24 - 4) / 2 */
    transition: all 0.2s ease-out;
    box-shadow: 0 0 0 rgba(0,0,0,0); /* No glow by default */
  }

  /* On Hover/Active: Show the purple halo and light up border */
  &:hover::-webkit-slider-thumb, &:active::-webkit-slider-thumb {
    border-color: color-mix(in srgb, #ffffff 30%, #7b4dff);
    box-shadow: 0 0 10px #7b4dff;
  }
`;


export const DisplayPane: React.FC = () => {
  const dispatch = useAppDispatch();
  const keyboardAPI = useAppSelector(getSelectedKeyboardAPI);
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);
  const cdcStatus = useAppSelector(getCdcStatus);

  // Experimental Toggle States
  const [toggle1, setToggle1] = useState(false);
  const [toggle2, setToggle2] = useState(false);
  const [toggle3, setToggle3] = useState(false);

  // Experimental Slider States
  const [slider1, setSlider1] = useState(50);
  const [slider2, setSlider2] = useState(75);
  const [slider3, setSlider3] = useState(25);

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
      
      <GlowingMenu 
        items={['General', 'Implementation', 'Security & Compliance', 'Use Cases']} 
        onChange={(idx) => console.log(`Menu index ${idx} clicked`)}
      />

      {/* --- EXPERIMENTAL TOGGLES SECTION --- */}
      <div style={{ border: '1px solid #3B2F63', padding: '20px', borderRadius: '8px', background: '#0f101c' }}>
        <h2 style={{marginTop: 0, marginBottom: '20px', color: '#fff'}}>Experimental Toggle Styles</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '40px', flexWrap: 'wrap' }}>
          
          {/* Style 1 */}
          <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px'}}>
            <span style={{color: '#aaa', fontSize: '14px'}}>Neon Gradient Pill</span>
            <TogglePillWrapper $active={toggle1} onClick={() => setToggle1(!toggle1)}>
              <TogglePillKnob $active={toggle1} />
            </TogglePillWrapper>
          </div>

          {/* Style 2 */}
          <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px'}}>
            <span style={{color: '#aaa', fontSize: '14px'}}>Cyber Plate</span>
            <ToggleCyberWrapper $active={toggle2} onClick={() => setToggle2(!toggle2)}>
              <ToggleCyberKnob $active={toggle2} />
            </ToggleCyberWrapper>
          </div>

          {/* Style 3 */}
          <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px'}}>
            <span style={{color: '#aaa', fontSize: '14px'}}>Eclipse Halo</span>
            <ToggleEclipseWrapper onClick={() => setToggle3(!toggle3)}>
              <ToggleEclipseKnob $active={toggle3} />
            </ToggleEclipseWrapper>
          </div>

        </div>
      </div>

      {/* --- EXPERIMENTAL SLIDERS SECTION --- */}
      <div style={{ border: '1px solid #3B2F63', padding: '20px', borderRadius: '8px', background: '#0f101c', marginTop: '20px' }}>
        <h2 style={{marginTop: 0, marginBottom: '20px', color: '#fff'}}>Experimental Slider Styles</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
          
          {/* Style 1 */}
          <div style={{display: 'flex', alignItems: 'center', gap: '20px'}}>
            <span style={{color: '#aaa', fontSize: '14px', width: '120px'}}>Neon Pulse</span>
            <NeonRange 
              value={slider1} 
              onChange={(e) => setSlider1(parseInt(e.target.value))} 
              $percent={slider1}
            />
            <span style={{color: '#fff', width: '30px'}}>{slider1}</span>
          </div>

          {/* Style 2 */}
          <div style={{display: 'flex', alignItems: 'center', gap: '20px'}}>
            <span style={{color: '#aaa', fontSize: '14px', width: '120px'}}>Cyber Strip</span>
            <CyberRange 
              value={slider2} 
              onChange={(e) => setSlider2(parseInt(e.target.value))} 
              $percent={slider2}
            />
            <span style={{color: '#fff', width: '30px'}}>{slider2}</span>
          </div>

          {/* Style 3 */}
          <div style={{display: 'flex', alignItems: 'center', gap: '20px'}}>
            <span style={{color: '#aaa', fontSize: '14px', width: '120px'}}>Eclipse Halo</span>
            <EclipseRange 
              value={slider3} 
              onChange={(e) => setSlider3(parseInt(e.target.value))} 
              $percent={slider3}
            />
            <span style={{color: '#fff', width: '30px'}}>{slider3}</span>
          </div>

        </div>
      </div>
      {/* ----------------------------------- */}

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
