import { cdcInstance } from '../utils/toffee_studio/cdc';
import { getSelectedKeyboardAPI, getSelectedConnectedDevice } from './devicesSlice';
import { AppThunk } from './index';
import { setCdcStatus, setCdcError } from './cdcSlice';
import { ToffeeFileSystemAPI, ToffeeHIDDevice } from '../utils/toffee_studio/hid';

export const connectCdcPort = (): AppThunk => async (dispatch, getState) => {
  if (cdcInstance.isConnected()) return;

  const selectedDevice = getSelectedConnectedDevice(getState());
  if (!selectedDevice) {
    dispatch(setCdcError('A keyboard must be connected first.'));
    return;
  }

  dispatch(setCdcStatus('Connecting...'));
  const success = await cdcInstance.connect(
    selectedDevice.vendorId,
    selectedDevice.productId
  );

  if (success) {
    dispatch(setCdcStatus('Connected'));
  } else {
    dispatch(setCdcError('Could not connect. Is the port in use?'));
  }
};

export const disconnectCdcPort = (): AppThunk => async (dispatch) => {
  if (cdcInstance.isConnected()) {
    await cdcInstance.disconnect();
  }
  dispatch(setCdcStatus('Disconnected'));
};

export const sendImageViaCdc = (filename: string, data: Uint8Array): AppThunk => async (dispatch) => {
    if (!cdcInstance.isConnected()) {
        dispatch(setCdcError('CDC port is not connected.'));
        return;
    }
    try {
        await cdcInstance.sendFile(filename, data);
        // Optionally dispatch a success action here if needed
    } catch (error: any) {
        dispatch(setCdcError(error.message || 'Failed to send image.'));
    }
};

export const listAllFilesViaCdc = (): AppThunk<Promise<{ filename: string; data: Uint8Array }[]>> => async (dispatch, getState) => {
    const state = getState();
    const keyboardAPI = getSelectedKeyboardAPI(state);
    
    if (!cdcInstance.isConnected() || !keyboardAPI) {
        const errorMsg = 'CDC or HID is not connected.';
        dispatch(setCdcError(errorMsg));
        throw new Error(errorMsg);
    }

    const webHidDevice = (keyboardAPI.getHID() as any)._hidDevice._device;
    const toffeeDevice = new ToffeeHIDDevice(webHidDevice);
    await toffeeDevice.open();
    
    const fs = new ToffeeFileSystemAPI(toffeeDevice);
    console.log('Executing ls_all via thunk...');

    try {
        const files = await fs.ls_all(cdcInstance);
        return files;
    } catch (error: any) {
        dispatch(setCdcError(error.message || 'ls_all command failed.'));
        throw error; // Re-throw so the component can also catch it if needed
    }
};
