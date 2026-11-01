import '@webscopeio/react-textarea-autocomplete/style.css';
import {createRoot} from 'react-dom/client';
import './app.global.css';
import {DEBUG_ENABLED, FIRMWARE_PATH, KEY_TESTER_PATH} from './config/debug';
import {keepDebugInUrl} from './utils/debug-url';

keepDebugInUrl();

// Static hosts may add a trailing slash to the tester's directory entry.
if (window.location.pathname === KEY_TESTER_PATH + '/') {
  window.history.replaceState(null, '', KEY_TESTER_PATH + window.location.search + window.location.hash);
}

const elem = document.getElementById('root');
if (elem) {
  if (window.location.pathname.replace(/\/+$/, '') === FIRMWARE_PATH) {
    // Do not import Redux/VIA/theme initialization or GLTF preloads in updater.
    const root = createRoot(elem);
    if (DEBUG_ENABLED) {
      import('./components/panes/firmware-update').then(({FirmwareUpdate}) => root.render(<FirmwareUpdate/>));
    } else root.render(<p>Debug mode is disabled.</p>);
  } else if (DEBUG_ENABLED) {
    // Reconnect the emulated board (if this tab had it) before the app scans for boards.
    import('./utils/toffee_studio/emulated-board')
      .then(({restoreEmulatedBoard}) => restoreEmulatedBoard())
      .finally(() => import('./normal-index'));
  } else {
    import('./normal-index');
  }
}
