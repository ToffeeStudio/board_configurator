import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useAppSelector } from 'src/store/hooks';
import { getSelectedKeyboardAPI, getSelectedConnectedDevice } from 'src/store/devicesSlice';
import { ToffeeFileSystemAPI, ToffeeHIDDevice } from 'src/utils/toffee_studio/hid';

const DisplayPaneContainer = styled.div`
    padding: 20px;
    height: 100%;
    overflow-y: auto;
`;

export const DisplayPane: React.FC = () => {

    const keyboardAPI = useAppSelector(getSelectedKeyboardAPI);
    const selectedDevice = useAppSelector(getSelectedConnectedDevice);

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
          await toffeeDevice.open(); // Ensure the device is open
    
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
    
    
    return (
        <DisplayPaneContainer>
            <h1>Display Experimentation Page</h1>
            <p>To test connectivity with Module PCB</p>
            <p>Status: {keyboardAPI ? 'Connected' : 'Disconnected'}</p>
            {/* Display device info when connected */}
            {selectedDevice && (
                <div style={{display: "flex", flexDirection: "column"}}>
                    <div>selectedDevice.vendorId:{` ${selectedDevice.vendorId}`}</div>
                    <div>selectedDevice.productId:{` ${selectedDevice.productId}`}</div>
                </div>
            )}
            <button style={{cursor: 'pointer'}} onClick={handleTestButtonClick}>TEST BUTTON HERE</button>
        </DisplayPaneContainer>
    );
};