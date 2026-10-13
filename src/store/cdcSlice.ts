import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { RootState } from './index';

type CdcStatus = 'Disconnected' | 'Connecting' | 'Connected' | 'Failed';

interface CdcState {
  status: CdcStatus;
  error: string | null;
}

const initialState: CdcState = {
  status: 'Disconnected',
  error: null,
};

const cdcSlice = createSlice({
  name: 'cdc',
  initialState,
  reducers: {
    setCdcStatus(state, action: PayloadAction<CdcStatus>) {
      state.status = action.payload;
      if (action.payload !== 'Failed') {
        state.error = null;
      }
    },
    setCdcError(state, action: PayloadAction<string | null>) {
      state.status = 'Failed';
      state.error = action.payload;
    },
  },
});

export const { setCdcStatus, setCdcError } = cdcSlice.actions;

export default cdcSlice.reducer;

// Selectors
export const getCdcStatus = (state: RootState) => state.cdc.status;
export const getCdcError = (state: RootState) => state.cdc.error;
