import { CenterPane } from './components/panes/pane';
import GlowCircularLoader from './components/toffee_studio/GlowCircularLoader/GlowCircularLoader';
import GlowButton from './components/toffee_studio/GlowButton/GlowButton';
import LoadingText from './components/loading-text';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { isElectron } from './utils/running-context';
import { getSelectedTheme } from './store/settingsSlice';
import { getLoadProgress } from './store/keymapSlice';
import { getConnectedDevices, getSupportedIds, setForceAuthorize } from './store/devicesSlice';
import {UnconnectedGlobalMenu} from './components/menus/global';
import {Route, useLocation} from 'wouter';
import {DEBUG_ENABLED, MEASUREMENT_PATH} from './config/debug';
import PANES from './utils/pane-config';
import {Home} from './components/Home';
import {createGlobalStyle} from 'styled-components';
import {CanvasRouter as CanvasRouter3D} from './components/three-fiber/canvas-router';
import {CanvasRouter as CanvasRouter2D} from './components/two-string/canvas-router';
import {TestContext} from './components/panes/test';
import {useMemo, useState, useEffect} from 'react';
import {OVERRIDE_HID_CHECK} from './utils/override';
import {useAppSelector, useAppDispatch} from './store/hooks';
import {getRenderMode} from './store/settingsSlice';
import {getSelectedDefinition} from './store/definitionsSlice';
import {reloadConnectedDevices} from './store/devicesThunks';
import styled from 'styled-components';

const GlobalStyle = createGlobalStyle`
  *:focus {
    outline: none;
  }
`;

const MainContent = styled.div`
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  overflow: hidden;
`

const defaultGlowColors = [
  '#7b4dff', // 0: buttonShineLeft (Purple)
  '#00e5ff', // 1: buttonShineRight (Cyan)
  '#7b4dff', // 2: buttonGlowStart (Purple)
  '#00e5ff', // 3: buttonGlowEnd (Cyan)
  '#00c6ff', // 4: Border gradient / Glow Container bottom glow (Bright Blue)
  '#1a1d2e', // 5: Glow Container background (Dark Blue/Purple)
  '#2c2f48', // 6: buttonBackground (Slightly Lighter Dark Blue/Purple)
  '#0f101c', // 7: buttonShadow (Very Dark Blue/Purple)
];

const LoaderPane = styled(CenterPane)`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  row-gap: 50px;
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 100;
  background-color: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(5px);
`;

const Loader: React.FC = () => {
  const dispatch = useAppDispatch();
  const selectedDefinition = useAppSelector(getSelectedDefinition);

  const connectedDevices = useAppSelector(getConnectedDevices);
  const supportedIds = useAppSelector(getSupportedIds);
  const noSupportedIds = !Object.values(supportedIds).length;
  const noConnectedDevices = !Object.values(connectedDevices).length;
  const [showButton, setShowButton] = useState<boolean>(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!selectedDefinition) {
        setShowButton(true);
      }
    }, 3000);
    return () => clearTimeout(timeout);
  }, [selectedDefinition]);

  return (
    <LoaderPane>
      {(showButton || noConnectedDevices) && !noSupportedIds && !isElectron ? (
        <>
          <GlowCircularLoader size='120px' thickness='2px' sx={{ marginBottom: '20px' }} />
          <GlowButton
            onClick={() => {
              dispatch(setForceAuthorize(true));
              dispatch(reloadConnectedDevices());
            }}
            colors={defaultGlowColors}
            sx={{ fontSize: '1rem', minWidth: '180px', fontWeight: 500 }}
          >
            Connect Keyboard
            <FontAwesomeIcon style={{ marginLeft: '10px' }} icon={faPlus} />
          </GlowButton>
        </>
       ) : (
         <LoadingText isSearching={!selectedDefinition} />
       )}
    </LoaderPane>
  );
};

export default () => {
  const hasHIDSupport = 'hid' in navigator || OVERRIDE_HID_CHECK;
  const [location] = useLocation();
  const debugRoute = location === MEASUREMENT_PATH || location === '/toffee-test';

  const renderMode = useAppSelector(getRenderMode);
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const loadProgress = useAppSelector(getLoadProgress);
  const showLoader = (!selectedDefinition || loadProgress !== 1) && !debugRoute;

  const RouteComponents = useMemo(
    () =>
      PANES.map((pane) => {
        return (
          <Route component={pane.component} key={pane.key} path={pane.path} />
        );
      }),
    [],
  );

  const CanvasRouter = renderMode === '2D' ? CanvasRouter2D : CanvasRouter3D;
  const testContextState = useState({clearTestKeys: () => {}});
  return (
    <>
      {showLoader && <Loader />}
      <TestContext.Provider value={testContextState}>
        <GlobalStyle />
        {hasHIDSupport && <UnconnectedGlobalMenu />}
        <MainContent>
          {!debugRoute && <CanvasRouter />}
          <Home hasHIDSupport={hasHIDSupport}>
            {!DEBUG_ENABLED && debugRoute ? <p style={{padding: 24}}>Debug mode is disabled.</p> : RouteComponents}
          </Home>
        </MainContent>
      </TestContext.Provider>
    </>
  );
};
