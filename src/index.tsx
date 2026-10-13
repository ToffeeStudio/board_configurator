import '@webscopeio/react-textarea-autocomplete/style.css';
import {createRoot} from 'react-dom/client';
import './app.global.css';
import {DEBUG_ENABLED, FIRMWARE_PATH} from './config/debug';

const elem = document.getElementById('root');
if (elem) {
  if (window.location.pathname === FIRMWARE_PATH) {
    // Do not import Redux/VIA/theme initialization or GLTF preloads in updater.
    const root = createRoot(elem);
    if (DEBUG_ENABLED) {
      import('./components/panes/firmware-update').then(({FirmwareUpdate}) => root.render(<FirmwareUpdate/>));
    } else root.render(<p>Debug mode is disabled.</p>);
  } else {
    import('./normal-index');
  }
}
