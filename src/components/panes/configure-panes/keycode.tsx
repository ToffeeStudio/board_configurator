import {FC, useState, useEffect, useMemo} from 'react';
import styled from 'styled-components';
import {KeycodeModal} from '../../inputs/custom-keycode-modal';
import {title, component} from '../../icons/keyboard';
import * as EncoderPane from './encoder';
import {
  keycodeInMaster,
  getByteForCode,
  getKeycodes,
  getOtherMenu,
  IKeycode,
  IKeycodeMenu,
  categoriesForKeycodeModule,
} from '../../../utils/key';
import {ErrorMessage} from '../../styled';
import {
  KeycodeType,
  getLightingDefinition,
  isVIADefinitionV3,
  isVIADefinitionV2,
  VIADefinitionV3,
} from '@the-via/reader';
import {SpanOverflowCell} from '../grid';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getBasicKeyToByte,
  getSelectedDefinition,
  getSelectedKeyDefinitions,
} from 'src/store/definitionsSlice';
import {getSelectedConnectedDevice} from 'src/store/devicesSlice';
import {
  getSelectedKey,
  getSelectedKeymap,
  updateKey as updateKeyAction,
  updateSelectedKey,
} from 'src/store/keymapSlice';
import {
  getMacroCount,
} from 'src/store/macrosSlice';
import {
  disableGlobalHotKeys,
  enableGlobalHotKeys,
  getDisableFastRemap,
} from 'src/store/settingsSlice';
import {getNextKey} from 'src/utils/keyboard-rendering';
import { GlowingMenu } from 'src/components/toffee_studio/GlowingMenu/GlowingMenu';
import GlowButton from 'src/components/toffee_studio/GlowButton/GlowButton';

// Controls grid cell size
const KeycodeList = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, 54px);
  grid-auto-rows: 54px;
  justify-content: center;
  grid-gap: 10px;
`;

const KeycodePaneContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const MenuContainer = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
  padding: 5px 10px 0 10px;
  background-color: transparent;
`;

// Wrapper to handle hover tooltips and event bubbling for the GlowButton
const KeycodeWrapper = styled.div<{disabled?: boolean}>`
  width: 100%;
  height: 100%;
  ${(props) => props.disabled && `
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  `}
`;

const KeycodeContainer = styled.div`
  padding: 6px 84px;
  /* 
     Large padding allows keys to scroll UP past the fade mask 
     so the last row is fully visible before the "dead zone" 
  */
  padding-bottom: 80px;
  box-sizing: border-box;
`;

const KeycodeDesc = styled.div`
  position: fixed;
  bottom: 64px;
  left: calc(300px + 43%);
  transform: translateX(-50%);
  background: #d9d9d9;
  box-sizing: border-box;
  transition: opacity 0.4s ease-out;
  height: 25px;
  width: auto;
  min-width: 150px;
  text-align: center;
  border-radius: 4px;
  line-height: 14px;
  padding: 5px 10px;
  font-size: 14px;
  color: #333;
  opacity: 1;
  pointer-events: none;
  z-index: 50;
  &:empty {
    opacity: 0;
  }
`;

const StyledSpanOverflowCell = styled(SpanOverflowCell)`
  /* 
     Gradient logic:
     1. Black (Visible) until 60px from bottom.
     2. Fades to Transparent (Invisible) at 20px from bottom.
     3. Stays Transparent for the last 20px (The "Dead Zone" / Spacing).
  */
  mask-image: linear-gradient(to bottom, black calc(100% - 80px), transparent calc(100% - 36px));
  -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 80px), transparent calc(100% - 36px));
`;

const generateKeycodeCategories = (basicKeyToByte: Record<string, number>, numMacros: number = 16) =>
  getKeycodes(numMacros).concat(getOtherMenu(basicKeyToByte));

const maybeFilter = <M extends Function>(maybe: boolean, filter: M) =>
  maybe ? () => true : filter;

export const Pane: FC = () => {
  const selectedKey = useAppSelector(getSelectedKey);
  const dispatch = useAppDispatch();
  const keys = useAppSelector(getSelectedKeyDefinitions);
  useEffect(
    () => () => {
      dispatch(updateSelectedKey(null));
    },
    [],
  ); // componentWillUnmount equiv

  if (selectedKey !== null && keys[selectedKey].ei !== undefined) {
    return <EncoderPane.Pane />;
  }
  return <KeycodePane />;
};

export const KeycodePane: FC = () => {
  const dispatch = useAppDispatch();
  const macros = useAppSelector((state: any) => state.macros);
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);
  const matrixKeycodes = useAppSelector(getSelectedKeymap);
  const selectedKey = useAppSelector(getSelectedKey);
  const disableFastRemap = useAppSelector(getDisableFastRemap);
  const selectedKeyDefinitions = useAppSelector(getSelectedKeyDefinitions);
  const {basicKeyToByte} = useAppSelector(getBasicKeyToByte);
  const macroCount = useAppSelector(getMacroCount);

  const KeycodeCategories = useMemo(
    () => generateKeycodeCategories(basicKeyToByte, macroCount),
    [basicKeyToByte, macroCount],
  );

  // TODO: improve typing so we can get rid of this
  if (!selectedDefinition || !selectedDevice || !matrixKeycodes) {
    return null;
  }

  const [selectedCategory, setSelectedCategory] = useState(
    KeycodeCategories[0].id,
  );
  const [mouseOverDesc, setMouseOverDesc] = useState<string | null>(null);
  const [showKeyTextInputModal, setShowKeyTextInputModal] = useState(false);

  const getEnabledMenus = (): IKeycodeMenu[] => {
    if (isVIADefinitionV3(selectedDefinition)) {
      return getEnabledMenusV3(selectedDefinition);
    }
    const {lighting, customKeycodes} = selectedDefinition;
    const {keycodes} = getLightingDefinition(lighting);
    return KeycodeCategories.filter(
      maybeFilter(
        keycodes === KeycodeType.QMK,
        ({id}) => id !== 'qmk_lighting',
      ),
    )
      .filter(
        maybeFilter(keycodes === KeycodeType.WT, ({id}) => id !== 'lighting'),
      )
      .filter(
        maybeFilter(
          typeof customKeycodes !== 'undefined',
          ({id}) => id !== 'custom',
        ),
      );
  };
  const getEnabledMenusV3 = (definition: VIADefinitionV3): IKeycodeMenu[] => {
    const keycodes = ['default' as const, ...(definition.keycodes || [])];
    const allowedKeycodes = keycodes.flatMap((keycodeName) =>
      categoriesForKeycodeModule(keycodeName),
    );
    if ((selectedDefinition.customKeycodes || []).length !== 0) {
      allowedKeycodes.push('custom');
    }
    return KeycodeCategories.filter((category) =>
      allowedKeycodes.includes(category.id),
    );
  };

  const renderMacroError = () => {
    return (
      <ErrorMessage>
        Your current firmware does not support macros. Install the latest
        firmware for your device.
      </ErrorMessage>
    );
  };

  const renderCategories = () => {
    const enabledMenus = getEnabledMenus();
    const menuItems = enabledMenus.map((m) => m.label);
    const activeIndex = enabledMenus.findIndex((m) => m.id === selectedCategory);

    return (
      <MenuContainer>
        <GlowingMenu 
          items={menuItems}
          selectedIndex={activeIndex !== -1 ? activeIndex : 0}
          onChange={(idx) => setSelectedCategory(enabledMenus[idx].id)}
          fontSize="15px"
          hideBaseLine={true} // No static line
          hideIndicator={true} // No moving line
        />
      </MenuContainer>
    );
  };

  const renderKeyInputModal = () => {
    dispatch(disableGlobalHotKeys());

    return (
      <KeycodeModal
        defaultValue={
          selectedKey !== null ? matrixKeycodes[selectedKey] : undefined
        }
        onExit={() => {
          dispatch(enableGlobalHotKeys());
          setShowKeyTextInputModal(false);
        }}
        onConfirm={(keycode) => {
          dispatch(enableGlobalHotKeys());
          updateKey(keycode);
          setShowKeyTextInputModal(false);
        }}
      />
    );
  };

  const updateKey = (value: number) => {
    if (selectedKey !== null) {
      dispatch(updateKeyAction(selectedKey, value));
      dispatch(
        updateSelectedKey(
          disableFastRemap || !selectedKeyDefinitions
            ? null
            : getNextKey(selectedKey, selectedKeyDefinitions),
        ),
      );
    }
  };

  const handleClick = (code: string, i: number) => {
    if (code == 'text') {
      setShowKeyTextInputModal(true);
    } else {
      return (
        keycodeInMaster(code, basicKeyToByte) &&
        updateKey(getByteForCode(code, basicKeyToByte))
      );
    }
  };

  const renderKeycode = (keycode: IKeycode, index: number) => {
    const {code, title, name} = keycode;
    const isDisabled = !keycodeInMaster(code, basicKeyToByte) && code != 'text';
    
    return (
      <KeycodeWrapper
        key={code}
        disabled={isDisabled}
        onMouseOver={() => setMouseOverDesc(title ? `${code}: ${title}` : code)}
        onMouseOut={() => setMouseOverDesc(null)}
      >
        <GlowButton
          square
          basic
          onClick={() => handleClick(code, index)}
          sx={{ 
            fontSize: '13px',
            fontWeight: 600,
            lineHeight: '1.2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2px',
            overflow: 'hidden',
            wordBreak: 'break-word'
          }}
        >
          {name}
        </GlowButton>
      </KeycodeWrapper>
    );
  };

  const renderCustomKeycode = () => {
    return (
      <KeycodeWrapper
        key="customKeycode"
        onMouseOver={() => setMouseOverDesc('Enter any QMK Keycode')}
        onMouseOut={() => setMouseOverDesc(null)}
      >
        <GlowButton
          square
          basic
          onClick={() => selectedKey !== null && handleClick('text', 0)}
          sx={{ fontSize: '14px', fontWeight: 'bold' }}
        >
          Any
        </GlowButton>
      </KeycodeWrapper>
    );
  };

  const renderSelectedCategory = (
    keycodes: IKeycode[],
    selectedCategory: string,
  ) => {
    const keycodeListItems = keycodes.map((keycode, i) =>
      renderKeycode(keycode, i),
    );
    switch (selectedCategory) {
      case 'macro': {
        return !macros.isFeatureSupported ? (
          renderMacroError()
        ) : (
          <KeycodeList>{keycodeListItems}</KeycodeList>
        );
      }
      case 'special': {
        return (
          <KeycodeList>
            {keycodeListItems.concat(renderCustomKeycode())}
          </KeycodeList>
        );
      }
      case 'custom': {
        if (
          (!isVIADefinitionV2(selectedDefinition) &&
            !isVIADefinitionV3(selectedDefinition)) ||
          !selectedDefinition.customKeycodes
        ) {
          return null;
        }
        return (
          <KeycodeList>
            {selectedDefinition.customKeycodes.map((keycode, idx) => {
              return renderKeycode(
                {
                  ...keycode,
                  code: `CUSTOM(${idx})`,
                },
                idx,
              );
            })}
          </KeycodeList>
        );
      }
      default: {
        return <KeycodeList>{keycodeListItems}</KeycodeList>;
      }
    }
  };

  const selectedCategoryKeycodes = KeycodeCategories.find(
    ({id}) => id === selectedCategory,
  )?.keycodes as IKeycode[];

  return (
    <>
      <StyledSpanOverflowCell>
        <KeycodePaneContainer>
          {renderCategories()}
          <KeycodeContainer>
            {renderSelectedCategory(selectedCategoryKeycodes, selectedCategory)}
          </KeycodeContainer>
        </KeycodePaneContainer>
      </StyledSpanOverflowCell>
      <KeycodeDesc>{mouseOverDesc}</KeycodeDesc>
      {showKeyTextInputModal && renderKeyInputModal()}
    </>
  );
};

export const Icon = component;
export const Title = title;
