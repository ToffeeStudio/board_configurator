import { FC, useState, useMemo } from 'react';
import styled from 'styled-components';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLightbulb } from '@fortawesome/free-solid-svg-icons';
import { Pane as BasePane, CenterPane } from './pane';
import { Grid, SpanOverflowCell } from './grid';
import { ToffeeLightingMenu } from '../toffee_studio/toffee-lighting-menu';
import { FrontLedMenu } from '../toffee_studio/front-led-menu';
import { Pane as FrontLightingPane } from './configure-panes/lighting';
import { GlowingMenu } from '../toffee_studio/GlowingMenu/GlowingMenu';
import { useAppSelector } from 'src/store/hooks';
import { getSelectedDefinition } from 'src/store/definitionsSlice';
import { getV3MenuComponents } from 'src/store/menusSlice';
import { isVIADefinitionV2, isVIADefinitionV3 } from '@the-via/reader';

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
  const [selectedTab, setSelectedTab] = useState(0);
  const items = ['Underglow', 'Front Lighting', 'Per-Key LED'];
  
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const v3Menus = useAppSelector(getV3MenuComponents);

  const FrontLightingComponent = useMemo(() => {
    if (!selectedDefinition) return null;

    if (isVIADefinitionV2(selectedDefinition)) {
      return FrontLightingPane;
    } 
    
    if (isVIADefinitionV3(selectedDefinition)) {
      // Find the V3 menu that corresponds to Lighting. 
      // Usually titled 'Lighting' or 'Backlight' in the definition.
      const lightingMenu = v3Menus.find(m => m.Title === 'Lighting' || m.Title === 'Backlight');
      if (lightingMenu) {
        return lightingMenu.Pane;
      }
    }
    return null;
  }, [selectedDefinition, v3Menus]);

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
              FrontLightingComponent ? (
                <FrontLightingComponent />
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
