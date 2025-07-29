import { FC } from 'react';
import styled from 'styled-components';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLightbulb } from '@fortawesome/free-solid-svg-icons';
import { Pane as BasePane, CenterPane } from './pane';
import { Grid, SpanOverflowCell } from './grid';
import { ToffeeLightingMenu } from '../toffee_studio/toffee-lighting-menu';

// This is the title that will appear in the tooltip for the tab icon.
export const Title = 'Underglow';

// This is the icon that will be used for the tab.
export const Icon: FC = () => <FontAwesomeIcon icon={faLightbulb} />;

// Styled components to create the main content area for our menu.
const LightingPane = styled(CenterPane)`
  height: 100%;
  background: var(--color_dark_grey);
`;

const Container = styled.div`
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 0 12px;
`;

// This is the main component for the pane, which will be rendered when the tab is clicked.
export const ToffeeLighting: FC = () => {
  return (
    <BasePane>
      <Grid style={{ overflow: 'hidden' }}>
        {/* SpanOverflowCell makes our content take up the full area */}
        <SpanOverflowCell style={{ flex: 1, borderWidth: 0 }}>
          <LightingPane>
            <Container>
              {/* Here we are embedding the custom menu component we created earlier */}
              <ToffeeLightingMenu />
            </Container>
          </LightingPane>
        </SpanOverflowCell>
      </Grid>
    </BasePane>
  );
};

// We also need to export the main component under a `component` alias for the pane config.
export const component = ToffeeLighting;
