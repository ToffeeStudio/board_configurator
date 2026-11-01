// Halo Stage page header: the page title and a line about it; on Lighting, the zone tabs.
import styled from 'styled-components';
import {useLocation} from 'wouter';
import PANES from 'src/utils/pane-config';
import {LightingZoneTabs} from './halo-lighting';
import {HALO} from './halo-style';

const LIGHTING_PATH = '/toffee-lighting';
const SUBTITLES: Record<string, string> = {
  '/': 'Keymap, layouts and macros',
  [LIGHTING_PATH]: '104 LEDs in three zones · changes save after a one-second pause',
};

// One line: the subtitle gives way to the zone tabs on narrow windows.
const Header = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 0 8px;
  flex-shrink: 0;
  color: ${HALO.text};
  > div {
    min-width: 0;
  }
  > nav {
    flex-shrink: 0;
  }
  h1 {
    margin: 0;
    font-size: 30px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  p {
    margin: 4px 0 0;
    font-size: 14px;
    color: ${HALO.muted};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

export function HaloHeader() {
  const [location] = useLocation();
  const pane = PANES.find((item) => item.path === location);
  if (!pane) return null;
  return (
    <Header>
      <div>
        <h1>{pane.title}</h1>
        {SUBTITLES[location] && <p>{SUBTITLES[location]}</p>}
      </div>
      {location === LIGHTING_PATH && <LightingZoneTabs />}
    </Header>
  );
}
