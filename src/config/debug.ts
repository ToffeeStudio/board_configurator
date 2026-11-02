// Single switch for all Toffee debug UI and routes, set from the page URL:
//   ?debug=1  turns Debug on for this browser tab
//   ?debug=0  turns it off again
// The choice is remembered for the tab (sessionStorage), so in-app navigation, reloads and the
// firmware page keep it; src/utils/debug-url.ts also keeps ?debug=1 visible in the address bar.
// A new tab opened without ?debug=1 starts with Debug off.
//
// Builds always contain the debug pages; the URL decides whether they are shown. The firmware
// updater (/toffee-firmware/, including ?recovery=1) and its downloads are public and do not
// depend on this switch. Build scripts and unit tests run without a page URL, so there the
// value is true.
// This does NOT change firmware already installed on a board.
export const DEBUG_PARAM = 'debug';
export const DEBUG_STORAGE_KEY = 'toffee-debug';

type DebugStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function readDebugMode(search: string, storage: DebugStorage | null): boolean {
  const value = new URLSearchParams(search).get(DEBUG_PARAM);
  try {
    if (value === '1') storage?.setItem(DEBUG_STORAGE_KEY, '1');
    else if (value === '0') storage?.removeItem(DEBUG_STORAGE_KEY);
    else return storage?.getItem(DEBUG_STORAGE_KEY) === '1';
  } catch {
    // Storage can be blocked; then only the current URL decides.
  }
  return value === '1';
}

const tabStorage = (): DebugStorage | null => {
  try {return window.sessionStorage;} catch {return null;}
};
export const DEBUG_ENABLED: boolean =
  typeof window === 'undefined' ? true : readDebugMode(window.location.search, tabStorage());
export const MEASUREMENT_PATH = '/toffee-debug';
export const FIRMWARE_PATH = '/toffee-firmware';
export const KEY_TESTER_PATH = '/test';
