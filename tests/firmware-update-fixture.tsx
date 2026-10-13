import {createRoot} from 'react-dom/client';
import {FirmwareUpdate} from '../src/components/panes/firmware-update';
import {FirmwareFakeDevice} from './firmware-fake-device';
const device = new FirmwareFakeDevice();
Object.assign(window, {firmwareFixture: device});
Object.defineProperty(navigator, 'hid', {configurable: true, value: {
  requestDevice: async () => [device], getDevices: async () => [device],
}});
createRoot(document.getElementById('root')!).render(<FirmwareUpdate/>);
