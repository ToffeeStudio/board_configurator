import {UnconnectedGlobalMenu} from './components/menus/global';
import {Route} from 'wouter';
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
import {loadCustomDefinitions, storeCustomDefinitions} from './store/definitionsSlice';
import {reloadConnectedDevices} from './store/devicesThunks';
import {ensureSupportedIds, selectDevice} from './store/devicesSlice';
import draftDefinition from './draft_definition.json';
import {
  DefinitionVersion,
  VIADefinitionV2,
  VIADefinitionV3,
  isVIADefinitionV2,
  isKeyboardDefinitionV2,
  keyboardDefinitionV2ToVIADefinitionV2,
  isVIADefinitionV3, // Import V3 validation
  isKeyboardDefinitionV3, // Import V3 validation
  keyboardDefinitionV3ToVIADefinitionV3, // Import V3 transformation
} from '@the-via/reader';

const GlobalStyle = createGlobalStyle`
  *:focus {
    outline: none;
  }
`;

export default () => {
  const hasHIDSupport = 'hid' in navigator || OVERRIDE_HID_CHECK;

  const renderMode = useAppSelector(getRenderMode);
  const dispatch = useAppDispatch();

  useEffect(() => {
    try {
      const version: DefinitionVersion = 'v3'; // Correctly assume V3
      let definitionToLoad: VIADefinitionV2 | VIADefinitionV3 | null = null;

      // Validate and transform if necessary (mimicking importDefinitions logic for V3)

      if (isVIADefinitionV3(draftDefinition)) { // Check for V3 VIA definition
        definitionToLoad = draftDefinition;

      } else if (isKeyboardDefinitionV3(draftDefinition)) { // Check for V3 Keyboard definition

        definitionToLoad = keyboardDefinitionV3ToVIADefinitionV3(draftDefinition); // Transform V3 Keyboard to V3 VIA
      } else {
        console.error(
          'Imported draft_definition.json is not a valid V3 Keyboard or VIA definition.', // Update error message
          (isVIADefinitionV3.errors || []).concat(isKeyboardDefinitionV3.errors || []), // Use V3 errors
        );
        return; // Stop if invalid
      }

      // Ensure the definition object is valid after potential transformation
      if (!definitionToLoad || typeof definitionToLoad.vendorProductId === 'undefined') {
        console.error('Failed to process draft definition: Missing vendorProductId after transformation.');
        return; // Stop if processing failed
      }

      const definitions = [definitionToLoad];

      // Dispatch actions similar to importDefinitions
      dispatch(loadCustomDefinitions({definitions, version}));
      dispatch(storeCustomDefinitions({definitions, version})); // Store for persistence
      dispatch(
        ensureSupportedIds({
          productIds: definitions.map((d) => d.vendorProductId),
          version,
        }),
      );
      dispatch(selectDevice(null)); // Deselect current device
      dispatch(reloadConnectedDevices()); // Reload devices
    } catch (error) {
      console.error('Error auto-loading draft definition:', error);
    }
  }, [dispatch]); // Run once on mount

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
      <TestContext.Provider value={testContextState}>
        <GlobalStyle />
        {hasHIDSupport && <UnconnectedGlobalMenu />}
        <CanvasRouter />

        <Home hasHIDSupport={hasHIDSupport}>{RouteComponents}</Home>
      </TestContext.Provider>
    </>
  );
};
