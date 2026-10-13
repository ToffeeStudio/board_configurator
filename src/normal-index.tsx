import {createRoot} from 'react-dom/client';
import Root from './containers/Root';
import {updateCSSVariables} from './utils/color-math';
import {getThemeModeFromStore, getThemeNameFromStore} from './utils/device-store';
import {THEMES} from './utils/themes';

const elem = document.getElementById('root');
if (elem) {
  createRoot(elem).render(<Root/>);
  document.documentElement.dataset['themeMode'] = getThemeModeFromStore();
  updateCSSVariables(getThemeNameFromStore() as keyof typeof THEMES);
}
