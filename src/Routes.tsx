import { CenterPane } from './components/panes/pane';
import GlowCircularLoader from './components/toffee_studio/GlowCircularLoader/GlowCircularLoader';
import GlowButton from './components/toffee_studio/GlowButton/GlowButton';
import LoadingText from './components/loading-text';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { isElectron } from './utils/running-context';
import { getSelectedTheme } from './store/settingsSlice';
import { getLoadProgress } from './store/keymapSlice';
import { getConnectedDevices, getSelectedConnectedDevice, getSelectedKeyboardAPI, getSupportedIds, setForceAuthorize } from './store/devicesSlice';
import {UnconnectedGlobalMenu} from './components/menus/global';
import {Route, useLocation} from 'wouter';
import {DEBUG_ENABLED, MEASUREMENT_PATH, KEY_TESTER_PATH} from './config/debug';
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
import {ConnectEmulatedBoardButton} from './components/toffee_studio/emulated-board';
import {HaloAmbient} from './components/toffee_studio/halo/halo-ambient';
import {HaloHeader} from './components/toffee_studio/halo/halo-header';
import {loadToffeeLighting, resetToffeeLighting} from './store/toffeeLightingSlice';
import {TARGET_PRODUCT_ID, TARGET_VENDOR_ID} from './config';
import {getVendorProductId} from './utils/hid-keyboards';
import styled from 'styled-components';

const MODULE_ID = getVendorProductId(TARGET_VENDOR_ID, TARGET_PRODUCT_ID);

const GlobalStyle = createGlobalStyle`
  *:focus {
    outline: none;
  }
`;

// Positioned so it paints above the fixed Halo ambient layer.
const MainContent = styled.div`
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
  padding: 24px 24px 24px 20px;
  position: relative;
  /* clip, not hidden: the case overlay is wider than this area, and focus must not scroll to it. */
  overflow: clip;
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
          {DEBUG_ENABLED && <ConnectEmulatedBoardButton />}
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
  const standaloneDebugRoute = location === MEASUREMENT_PATH || location === '/toffee-test';
  const debugRoute = standaloneDebugRoute || location === KEY_TESTER_PATH;

  const renderMode = useAppSelector(getRenderMode);
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const loadProgress = useAppSelector(getLoadProgress);
  const showLoader = (!selectedDefinition || loadProgress !== 1) && !debugRoute;

  // A Module's lighting tints the Halo background on every page; a new board starts from nothing.
  // Other boards don't answer Toffee commands, so they are never sent any.
  const dispatch = useAppDispatch();
  const keyboard = useAppSelector(getSelectedKeyboardAPI);
  const device = useAppSelector(getSelectedConnectedDevice);
  const isModule = !!device && device.vendorProductId === MODULE_ID;
  const boardReady = !!selectedDefinition && loadProgress === 1;
  useEffect(() => {
    dispatch(resetToffeeLighting());
  }, [keyboard, dispatch]);
  useEffect(() => {
    if (keyboard && isModule && boardReady) dispatch(loadToffeeLighting(keyboard));
  }, [keyboard, isModule, boardReady, dispatch]);

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
      <HaloAmbient />
      <TestContext.Provider value={testContextState}>
        <GlobalStyle />
        {hasHIDSupport && <UnconnectedGlobalMenu />}
        <MainContent>
          <HaloHeader />
          {!standaloneDebugRoute && (DEBUG_ENABLED || !debugRoute) && <CanvasRouter />}
          <Home hasHIDSupport={hasHIDSupport}>
            {!DEBUG_ENABLED && debugRoute ? <p style={{padding: 24}}>Debug mode is disabled.</p> : RouteComponents}
          </Home>
        </MainContent>
      </TestContext.Provider>
    </>
  );
};
