import {useState, useMemo, FC, useCallback} from 'react';
import styled from 'styled-components';
import {SpanOverflowCell, SubmenuRow} from '../grid';
import {CenterPane} from '../pane';
import {title, component} from '../../icons/adjust';
import {MacroDetailPane} from './submenus/macros/macro-detail';
import {useAppDispatch, useAppSelector} from '../../../store/hooks';
import {getSelectedConnectedDevice} from '../../../store/devicesSlice';
import {
  getExpressions,
  getMacroCount,
  saveMacros,
} from '../../../store/macrosSlice';

const FullHeightContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
`;

const HorizontalMenu = styled.div`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  padding: 15px;
  border-bottom: 1px solid var(--border_color_cell);
`;

const MacroPane = styled(CenterPane)`
  flex-grow: 1;
  background: var(--color_dark_grey);
`;

const Container = styled.div`
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 12px;
  padding-top: 0;
`;

export const Pane: FC = () => {
  const dispatch = useAppDispatch();
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);
  const macroExpressions = useAppSelector(getExpressions);
  const macroCount = useAppSelector(getMacroCount);

  const [selectedMacro, setSelectedMacro] = useState(0);

  const saveMacro = useCallback(
    async (macro: string) => {
      if (!selectedDevice) {
        return;
      }

      const newMacros = macroExpressions.map((oldMacro, i) =>
        i === selectedMacro ? macro : oldMacro,
      );

      dispatch(saveMacros(selectedDevice, newMacros));
    },
    [macroExpressions, saveMacros, dispatch, selectedDevice, selectedMacro],
  );

  const macroMenus = useMemo(
    () =>
      Array(macroCount)
        .fill(0)
        .map((_, idx) => idx)
        .map((idx) => (
          <SubmenuRow
            $selected={selectedMacro === idx}
            onClick={() => setSelectedMacro(idx)}
            key={idx}
            style={{borderWidth: 0, textAlign: 'center', marginBottom: 0}}
          >
            {`M${idx}`}
          </SubmenuRow>
        )),
    [selectedMacro, macroCount],
  );

  if (!selectedDevice) {
    return null;
  }
  return (
    <SpanOverflowCell>
      <FullHeightContainer>
        <HorizontalMenu>{macroMenus}</HorizontalMenu>
        <MacroPane>
          <Container>
            <MacroDetailPane
              macroExpressions={macroExpressions}
              selectedMacro={selectedMacro}
              saveMacros={saveMacro}
              protocol={selectedDevice ? selectedDevice.protocol : -1}
            />
          </Container>
        </MacroPane>
      </FullHeightContainer>
    </SpanOverflowCell>
  );
};

// TODO: these are used in the context that configure.tsx imports menus with props Icon, Title, Pane.
// Should we encapsulate this type and wrap the exports to conform to them?
export const Icon = component;
export const Title = title;
