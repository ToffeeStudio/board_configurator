import {FC} from 'react';
import styled from 'styled-components';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faLightbulb} from '@fortawesome/free-solid-svg-icons';
import {Pane} from './pane';
import {HaloLightingControls} from '../toffee_studio/halo/halo-lighting';
import {PowerDebug} from '../toffee_studio/power-debug';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedKeyboardAPI} from 'src/store/devicesSlice';

// This is the title that will appear in the tooltip for the tab icon.
export const Title = 'Lighting';

// This is the icon that will be used for the tab.
export const Icon: FC = () => <FontAwesomeIcon icon={faLightbulb} />;

// The board shows above this pane (see two-string/canvas-router.tsx); the zone tabs are in the page
// header. The pane holds the Debug power panel and the control bar, which sits at the bottom.
const LightingPane = styled(Pane)`
  background: transparent;
  overflow: auto;
  gap: 12px;
  padding-bottom: 4px;
  > section:last-child {
    margin-top: auto;
  }
`;

export const ToffeeLighting: FC = () => {
  const keyboard = useAppSelector(getSelectedKeyboardAPI);
  const device = keyboard ? keyboard.getHID()._hidDevice!._device : null;
  return (
    <LightingPane>
      <PowerDebug device={device} />
      <HaloLightingControls />
    </LightingPane>
  );
};

// We also need to export the main component under a `component` alias for the pane config.
export const component = ToffeeLighting;
