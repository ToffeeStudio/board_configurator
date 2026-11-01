// Debug-only controls for the emulated Module (src/utils/toffee_studio/emulated-board.ts).
import {useSyncExternalStore} from 'react';
import styled from 'styled-components';
import GlowButton from './GlowButton/GlowButton';
import {useAppDispatch} from 'src/store/hooks';
import {selectDevice, setForceAuthorize, updateConnectedDevices} from 'src/store/devicesSlice';
import {reloadConnectedDevices} from 'src/store/devicesThunks';
import {HID} from 'src/shims/node-hid';
import {
  connectEmulatedBoard, disconnectEmulatedBoard, isEmulatedBoardConnected, subscribeEmulatedBoard,
} from 'src/utils/toffee_studio/emulated-board';

export const useEmulatedBoardConnected = () =>
  useSyncExternalStore(subscribeEmulatedBoard, isEmulatedBoardConnected, isEmulatedBoardConnected);

/** Shown under "Connect Keyboard" in Debug mode. */
export function ConnectEmulatedBoardButton() {
  const dispatch = useAppDispatch();
  return (
    // Sits closer to "Connect Keyboard" than the loader's usual 50px gap, in the quieter basic style.
    <div style={{marginTop: -26}}>
      <GlowButton
        basic
        onClick={() => {
          connectEmulatedBoard();
          dispatch(setForceAuthorize(false));
          dispatch(reloadConnectedDevices());
        }}
        sx={{fontSize: '0.9rem', minWidth: '180px', fontWeight: 500}}
      >
        Connect emulated board
      </GlowButton>
    </div>
  );
}

// Sits in the sidebar's status line, in place of "<board> connected".
const Pill = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 8px 8px 12px;
  border-radius: 14px;
  border: 1px solid rgba(221, 190, 120, 0.55);
  background: rgba(36, 30, 18, 0.92);
  color: #f3dcaa;
  font: 500 12px/1.3 Montserrat, system-ui, sans-serif;
  button {
    font: inherit;
    color: inherit;
    border: 1px solid rgba(221, 190, 120, 0.45);
    border-radius: 999px;
    background: transparent;
    padding: 4px 10px;
    cursor: pointer;
  }
  button:hover {background: rgba(221, 190, 120, 0.16);}
  button:focus-visible {outline: 2px solid #f3dcaa; outline-offset: 2px;}
`;

/** Always visible while the emulated board stands in for a real one. */
export function EmulatedBoardStatus() {
  const dispatch = useAppDispatch();
  const connected = useEmulatedBoardConnected();
  if (!connected) return null;
  return (
    <Pill role="status" aria-label="Emulated board connected">
      <span>Emulated board · no hardware</span>
      <button
        type="button"
        onClick={async () => {
          disconnectEmulatedBoard();
          // Like unplugging: back to the connect screen.
          dispatch(updateConnectedDevices({}));
          dispatch(selectDevice(null));
          dispatch(setForceAuthorize(true));
          // A real board this browser already trusts connects on its own.
          if ((await HID.getFilteredDevices()).length) {
            dispatch(setForceAuthorize(false));
            dispatch(reloadConnectedDevices());
          }
        }}
      >
        Disconnect
      </button>
    </Pill>
  );
}
