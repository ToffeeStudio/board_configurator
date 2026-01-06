import React, {useMemo} from 'react';
import styled from 'styled-components';
import {Link, useLocation} from 'wouter';
import PANES from '../../utils/pane-config';
import {useAppSelector} from 'src/store/hooks';
import {getShowDesignTab} from 'src/store/settingsSlice';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {CategoryIconContainer} from '../panes/grid';
import GlowButton from '../toffee_studio/GlowButton/GlowButton';
import GlowContainer from '../toffee_studio/GlowContainer/GlowContainer';
import GlowTooltip from '../toffee_studio/GlowTooltip/GlowTooltip';
import {ErrorLink, ErrorsPaneConfig} from '../panes/errors';
import {ExternalLinks} from './external-links';

const {DEBUG_PROD, MODE, DEV} = import.meta.env;
const showDebugPane = MODE === 'development' || DEBUG_PROD === 'true' || DEV;

const GlobalContainer = styled.div`
  width: 300px;
  height: 100vh;
  padding: 0px 48px;
  border-right: 1px solid var(--border_color_cell);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg_outside-accent);
  row-gap: 12px;
  flex-shrink: 0;
  
  /* Ensure this sits above the fixed background overlay (z-index 10) */
  position: relative;
  z-index: 20;
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
          <GlowButton
            key={pane.key}
            onClick={() => navigate(pane.path)}
            forceOn={pane.path === location}
            sx={{ fontSize: "16px" }}
          >
            <div style={{
              display: "flex",
              justifyContent: "center",
              gap: "10px",
              padding: "2px",
              transform: "translateX(-12px)",
              width: "100%",
              fontWeight: 600
            }}>
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minWidth: "42px" }}>
                <FontAwesomeIcon size={'md'} icon={pane.icon} />
              </div>
              {pane.title}
            </div>
          </GlowButton>
        );
      },
    );
  }, [location, navigate, showDesignTab]);

  return (
    <React.Fragment>
      <GlobalContainer>
        <GlowContainer
          style={{
            display: "flex",
            flexDirection: "column",
            backgroundColor: "black", 
            borderRadius: "8px",
            height: "calc(100% - 64px)", 
            width: "100%"
          }}
        >
          <div style={{
            boxSizing: "border-box",
            width: "100%",
            height: "100%",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            alignItems: "stretch",
            overflowY: "auto", 
            maskImage: "linear-gradient(to bottom, black 90%, transparent 100%)",
          }}>
            <ErrorLink />
            {Panes}
            {/* <ExternalLinks /> */}
          </div>
        </GlowContainer>
      </GlobalContainer>
    </React.Fragment>
  );
};
