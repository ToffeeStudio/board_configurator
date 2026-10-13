import { FC, useState } from 'react';
import styled from 'styled-components';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLightbulb } from '@fortawesome/free-solid-svg-icons';
import { Pane as BasePane, CenterPane } from './pane';
import { Grid, SpanOverflowCell } from './grid';
import { ToffeeLightingMenu } from '../toffee_studio/toffee-lighting-menu';
import { FrontLedMenu } from '../toffee_studio/front-led-menu';
import { GroupLightingMenu } from '../toffee_studio/group-lighting-menu';
import { GlowingMenu } from '../toffee_studio/GlowingMenu/GlowingMenu';
import {PowerDebug} from '../toffee_studio/power-debug';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedKeyboardAPI} from 'src/store/devicesSlice';

// This is the title that will appear in the tooltip for the tab icon.
export const Title = 'Lighting';

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

const MenuContainer = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
  padding: 10px 0;
  width: 100%;
  background: transparent; 
  flex-shrink: 0;
  position: relative;
  z-index: 2;
  pointer-events: all;
`;

// Override default 3-column Grid to 2-column to match standard VIA panes structure
// where the FrontLightingPane returns <SubmenuCell> and <OverflowCell>
const TwoColumnGrid = styled(Grid)`
  grid-template-columns: min-content 1fr;
  height: 100%;
  width: 100%;
`;

// This is the main component for the pane, which will be rendered when the tab is clicked.
export const ToffeeLighting: FC = () => {
  const keyboard = useAppSelector(getSelectedKeyboardAPI);
  const device = keyboard ? keyboard.getHID()._hidDevice!._device : null;
  const [selectedTab, setSelectedTab] = useState(0);
  const items = ['Underglow', 'Front Lighting', 'Per-Key LED', 'Badge'];
  
  return (
    <BasePane>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
        <MenuContainer>
          <GlowingMenu 
            items={items} 
            selectedIndex={selectedTab} 
            onChange={setSelectedTab} 
          />
        </MenuContainer>
        <PowerDebug device={device}/>
        
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <TwoColumnGrid>
            {selectedTab === 0 ? (
              /* Underglow Tab */
              <SpanOverflowCell style={{ flex: 1, borderWidth: 0 }}>
                <LightingPane>
                  <Container>
                    <ToffeeLightingMenu />
                  </Container>
                </LightingPane>
              </SpanOverflowCell>
            ) : selectedTab === 2 ? (
              /* Per-Key Front LED Tab */
              <SpanOverflowCell style={{ flex: 1, borderWidth: 0 }}>
                <LightingPane>
                  <Container>
                    <FrontLedMenu />
                  </Container>
                </LightingPane>
              </SpanOverflowCell>
            ) : (
              /* Front Lighting Tab */
              selectedTab === 1 || selectedTab === 3 ? (
                <SpanOverflowCell style={{ flex: 1, borderWidth: 0 }}>
                  <LightingPane><Container>
                    <GroupLightingMenu key={selectedTab} group={selectedTab === 1 ? 'front' : 'badge'}/>
                  </Container></LightingPane>
                </SpanOverflowCell>
              ) : (
                <SpanOverflowCell style={{ flex: 1, borderWidth: 0 }}>
                  <LightingPane>
                    <Container>
                      <div style={{ marginTop: '20px', color: '#888', fontStyle: 'italic' }}>
                        Lighting configuration menu not found for this device.
                      </div>
                    </Container>
                  </LightingPane>
                </SpanOverflowCell>
              )
            )}
          </TwoColumnGrid>
        </div>
      </div>
    </BasePane>
  );
};

// We also need to export the main component under a `component` alias for the pane config.
export const component = ToffeeLighting;
