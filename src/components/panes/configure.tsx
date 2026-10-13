import React, {useState, useEffect, useMemo} from 'react';
import styled, {keyframes} from 'styled-components';
import ChippyLoader from '../chippy-loader';
import {ConfigureBasePane} from './pane';
import {
  CustomFeaturesV2,
  getLightingDefinition,
  isVIADefinitionV2,
  isVIADefinitionV3,
  VIADefinitionV2,
  VIADefinitionV3,
} from '@the-via/reader';
import {Grid, IconContainer, MenuCell, ConfigureFlexCell, SubmenuRow} from './grid';
import * as Keycode from './configure-panes/keycode';
import * as Macros from './configure-panes/macros';
import * as Layouts from './configure-panes/layouts';
import * as Lighting from './configure-panes/lighting';
import * as SaveLoad from './configure-panes/save-load';
import * as RotaryEncoder from './configure-panes/custom/satisfaction75';
import {makeCustomMenus} from './configure-panes/custom/menu-generator';
import GlowTooltip from '../toffee_studio/GlowTooltip/GlowTooltip';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedDefinition} from 'src/store/definitionsSlice';
import {
  clearSelectedKey,
  getLoadProgress,
  getNumberOfLayers,
  setConfigureKeyboardIsSelectable,
} from 'src/store/keymapSlice';
import {useDispatch} from 'react-redux';
import {getV3MenuComponents} from 'src/store/menusSlice';
import {getIsMacroFeatureSupported} from 'src/store/macrosSlice';
import {useAppDispatch} from 'src/store/hooks';
import { GlowingMenu } from '../toffee_studio/GlowingMenu/GlowingMenu';

// --- STYLED COMPONENTS MOVED OUTSIDE ---

const HorizontalMenuContainer = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  padding: 10px 0;
  background: transparent;
  pointer-events: all;
  flex-wrap: wrap;
  position: relative;
  z-index: 1;
`;

const fadeSlideIn = keyframes`
  0% {
    opacity: 0;
    transform: translateY(10px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
`;

// We extend Grid here to preserve the "display: grid" context for children
// like SubmenuCell and OverflowCell, while applying the animation to the container.
const PaneAnimationGrid = styled(Grid)`
  grid-template-columns: min-content minmax(0, 1fr);
  height: 100%;
  width: 100%;
  animation: ${fadeSlideIn} 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
`;

// ---------------------------------------

const Rows = [
  Keycode,
  Macros,
  Layouts,
  Lighting,
  SaveLoad,
  RotaryEncoder,
  ...makeCustomMenus([]),
];
function getCustomPanes(customFeatures: CustomFeaturesV2[]) {
  if (
    customFeatures.find((feature) => feature === CustomFeaturesV2.RotaryEncoder)
  ) {
    return [RotaryEncoder];
  }
  return [];
}

const getRowsForKeyboard = (): typeof Rows => {
  const showMacros = useAppSelector(getIsMacroFeatureSupported);
  const v3Menus = useAppSelector(getV3MenuComponents);
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const numberOfLayers = useAppSelector(getNumberOfLayers);

  if (!selectedDefinition) {
    return [];
  } else if (isVIADefinitionV2(selectedDefinition)) {
    return getRowsForKeyboardV2(selectedDefinition, showMacros, numberOfLayers);
  } else if (isVIADefinitionV3(selectedDefinition)) {
    return [
      ...filterInferredRows(selectedDefinition, showMacros, numberOfLayers, [
        Keycode,
        Layouts,
        Macros,
        SaveLoad,
      ]),
      ...v3Menus,
    ];
  } else {
    return [];
  }
};

const filterInferredRows = (
  selectedDefinition: VIADefinitionV3 | VIADefinitionV2,
  showMacros: boolean,
  numberOfLayers: number,
  rows: typeof Rows,
): typeof Rows => {
  const {layouts} = selectedDefinition;
  let removeList: typeof Rows = [];
  // LAYOUTS IS INFERRED, filter out if doesn't exist
  if (
    !(layouts.optionKeys && Object.entries(layouts.optionKeys).length !== 0)
  ) {
    removeList = [...removeList, Layouts];
  }

  if (numberOfLayers === 0) {
    removeList = [...removeList, Keycode, SaveLoad];
  }

  if (!showMacros) {
    removeList = [...removeList, Macros];
  }
  let filteredRows = rows.filter(
    (row) => !removeList.includes(row),
  ) as typeof Rows;
  return filteredRows;
};

const getRowsForKeyboardV2 = (
  selectedDefinition: VIADefinitionV2,
  showMacros: boolean,
  numberOfLayers: number,
): typeof Rows => {
  let rows: typeof Rows = [Keycode, Layouts, Macros, SaveLoad];
  if (isVIADefinitionV2(selectedDefinition)) {
    const {lighting, customFeatures} = selectedDefinition;
    const {supportedLightingValues} = getLightingDefinition(lighting);
    if (supportedLightingValues.length !== 0) {
      rows = [...rows, Lighting];
    }
    if (customFeatures) {
      rows = [...rows, ...getCustomPanes(customFeatures)];
    }
  }
  return filterInferredRows(
    selectedDefinition,
    showMacros,
    numberOfLayers,
    rows,
  );
};

export const ConfigurePane = () => {
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const loadProgress = useAppSelector(getLoadProgress);

  const showLoader = !selectedDefinition || loadProgress !== 1;
  if (showLoader) {
    return null; // The global loader overlay will be visible
  }

  return (
    <ConfigureBasePane>
      <ConfigureGrid />
    </ConfigureBasePane>
  );
};

const ConfigureGrid = () => {
  const dispatch = useAppDispatch();

  const [selectedRow, setRow] = useState(0);
  const KeyboardRows = getRowsForKeyboard();
  const SelectedPane = KeyboardRows[selectedRow]?.Pane;
  const selectedTitle = KeyboardRows[selectedRow]?.Title;

  useEffect(() => {
    if (selectedTitle !== 'Keymap') {
      dispatch(setConfigureKeyboardIsSelectable(false));
    } else {
      dispatch(setConfigureKeyboardIsSelectable(true));
    }
  }, [selectedTitle, dispatch]);

  // Memoize menu items to prevent array reference changes on re-renders
  const menuItems = useMemo(() => 
    (KeyboardRows || []).map((row) => (row.Title as string) || 'Unknown'),
  [KeyboardRows]);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', pointerEvents: 'none' }}>
        <HorizontalMenuContainer>
          <GlowingMenu 
            items={menuItems} 
            selectedIndex={selectedRow}
            onChange={(idx) => setRow(idx)} 
          />
        </HorizontalMenuContainer>

        <div style={{ flex: 1, overflow: 'auto', pointerEvents: 'all', position: 'relative' }}>
          {SelectedPane && (
            <PaneAnimationWrapper key={selectedRow}>
              <SelectedPane />
            </PaneAnimationWrapper>
          )}
        </div>
      </div>
    </>
  );
};

// Re-using the animation wrapper from design.tsx/others for consistent transition
const PaneAnimationWrapper = styled.div`
  height: 100%;
  width: 100%;
  animation: ${fadeSlideIn} 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
`;
