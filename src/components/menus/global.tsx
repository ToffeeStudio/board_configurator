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

const Container = styled.div`
  width: 100vw;
  padding: 36px 0;
  border-bottom: 1px solid var(--border_color_cell);
  display: flex;
  align-items: center;
  justify-content: center;
`;

const {DEBUG_PROD, MODE, DEV} = import.meta.env;
const showDebugPane = MODE === 'development' || DEBUG_PROD === 'true' || DEV;

const GlobalContainer = styled(Container)`
  background: var(--bg_outside-accent);
  column-gap: 20px;
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
          <GlowTooltip key={pane.key} title={pane.title} position="bottom">
            <GlowButton
              onClick={() => navigate(pane.path)}
              forceOn={pane.path === location}
            >
              <FontAwesomeIcon size={'lg'} icon={pane.icon} />
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
        <ExternalLinks />
      </GlobalContainer>
    </React.Fragment>
  );
};
