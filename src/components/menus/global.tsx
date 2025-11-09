import React, {useMemo} from 'react';
import styled from 'styled-components';
import {Link, useLocation} from 'wouter';
import PANES from '../../utils/pane-config';
import {useAppSelector} from 'src/store/hooks';
import {getShowDesignTab} from 'src/store/settingsSlice';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {CategoryIconContainer} from '../panes/grid';
import GlowButton from '../toffee_studio/GlowButton/GlowButton';
import GlowTooltip from '../toffee_studio/GlowTooltip/GlowTooltip';
import {ErrorLink, ErrorsPaneConfig} from '../panes/errors';
import {ExternalLinks} from './external-links';

const {DEBUG_PROD, MODE, DEV} = import.meta.env;
const showDebugPane = MODE === 'development' || DEBUG_PROD === 'true' || DEV;

const GlobalContainer = styled.div`
  width: 180px;
  height: 100vh;
  padding: 20px 0;
  padding-left: 48px;
  border-right: 1px solid var(--border_color_cell);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg_outside-accent);
  row-gap: 20px;
  flex-shrink: 0;
`;

export const UnconnectedGlobalMenu = () => {
  const showDesignTab = useAppSelector(getShowDesignTab);

  const [location, navigate] = useLocation();

  const Panes = useMemo(() => {
    return PANES.filter((pane) => pane.key !== ErrorsPaneConfig.key).map(
      (pane) => {
        if (pane.key === 'design' && !showDesignTab) return null;
        if (pane.key === 'debug' && !showDebugPane) return null;
        return (
          <GlowTooltip key={pane.key} title={pane.title} position="right">
            <GlowButton
              onClick={() => navigate(pane.path)}
              forceOn={pane.path === location}
              sx={{fontSize: "18px"}}
            >
              <div style={{
                display: "flex",
                gap: "10px"
              }}>
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minWidth: "32px"}}>
                  <FontAwesomeIcon size={'xl'} icon={pane.icon} />
                </div>
              {pane.title}
              </div>
            </GlowButton>
          </GlowTooltip>
        );
      },
    );
  }, [location, navigate, showDesignTab]);

  return (
    <React.Fragment>
      <GlobalContainer>
        <ErrorLink />
        {Panes}
        {/* <ExternalLinks /> */}
      </GlobalContainer>
    </React.Fragment>
  );
};
