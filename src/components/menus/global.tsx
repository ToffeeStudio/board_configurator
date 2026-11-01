import React, {useMemo} from 'react';
import styled from 'styled-components';
import {useLocation} from 'wouter';
import PANES from '../../utils/pane-config';
import {useAppSelector} from 'src/store/hooks';
import {getShowDesignTab} from 'src/store/settingsSlice';
import {getSelectedDefinition} from 'src/store/definitionsSlice';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {ErrorLink, ErrorsPaneConfig} from '../panes/errors';
import {DEBUG_ENABLED, FIRMWARE_PATH} from '../../config/debug';
import {EmulatedBoardStatus, useEmulatedBoardConnected} from '../toffee_studio/emulated-board';
import {focusRing, glass, glowEdge, HALO} from '../toffee_studio/halo/halo-style';

const {DEBUG_PROD, MODE, DEV} = import.meta.env;
const showDebugPane = MODE === 'development' || DEBUG_PROD === 'true' || DEV;

// Halo Stage sidebar: a glass panel with the brand, the real navigation list and the board status.
const Sidebar = styled.aside`
  ${glass}
  flex-shrink: 0;
  width: 256px;
  margin: 24px 0 24px 24px;
  box-sizing: border-box;
  border-radius: 18px;
  padding: 20px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: ${HALO.text};

  /* Above the board's case overlay, which extends sideways past the main area. */
  position: relative;
  z-index: 20;
`;

const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px 14px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.01em;
  &::before {
    content: '';
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: linear-gradient(135deg, ${HALO.lavender}, #7800f5);
    box-shadow: 0 0 14px rgba(120, 0, 245, 0.6);
  }
`;

const NavList = styled.nav`
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  padding: 2px;
  margin: -2px;
`;

const NavItem = styled.button<{$on: boolean}>`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 48px;
  padding: 8px 16px;
  box-sizing: border-box;
  border-radius: 12px;
  border: 1px solid ${HALO.line};
  background: rgba(9, 4, 30, 0.6);
  color: ${HALO.text};
  font-size: 15px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
  ${focusRing}
  &:hover {
    border-color: #5a4796;
  }
  svg {
    width: 18px;
    flex: none;
  }
  ${(props) => props.$on && glowEdge}
`;

const Status = styled.div`
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 10px 4px;
  font-size: 13px;
  color: ${HALO.muted};
`;

const StatusDot = styled.span<{$on: boolean}>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(props) => (props.$on ? '#3ee08a' : '#5d5675')};
  box-shadow: ${(props) => (props.$on ? '0 0 8px #3ee08a' : 'none')};
`;

function BoardStatus() {
  const emulated = useEmulatedBoardConnected();
  const definition = useAppSelector(getSelectedDefinition);
  if (DEBUG_ENABLED && emulated) return <Status><EmulatedBoardStatus /></Status>;
  return (
    <Status>
      <StatusDot $on={!!definition} />
      {definition ? `${definition.name} connected` : 'No board connected'}
    </Status>
  );
}

export const UnconnectedGlobalMenu = () => {
  const showDesignTab = useAppSelector(getShowDesignTab);
  const [location, navigate] = useLocation();

  const Panes = useMemo(() => {
    return PANES.filter((pane) => pane.key !== ErrorsPaneConfig.key).map(
      (pane) => {
        if (pane.key === 'design' && !showDesignTab) return null;
        if (pane.key === 'debug' && !showDebugPane) return null;
        return (
          <NavItem
            key={pane.key}
            type="button"
            $on={pane.path === location}
            aria-current={pane.path === location ? 'page' : undefined}
            onClick={() => pane.path === FIRMWARE_PATH ? window.location.assign(pane.path + '/') : navigate(pane.path)}
          >
            <FontAwesomeIcon icon={pane.icon} />
            {pane.title}
          </NavItem>
        );
      },
    );
  }, [location, navigate, showDesignTab]);

  return (
    <Sidebar>
      <Brand>Toffee Studio</Brand>
      <NavList aria-label="Pages">
        <ErrorLink />
        {Panes}
      </NavList>
      <BoardStatus />
    </Sidebar>
  );
};
