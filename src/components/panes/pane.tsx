import styled, {keyframes} from 'styled-components';

const fadeSlideIn = keyframes`
  0% {
    opacity: 0;
    transform: translateY(10px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
`;

export const Pane = styled.div`
  background: var(--gradient);
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--gradient);
  animation: ${fadeSlideIn} 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
`;

export const CenterPane = styled(Pane)`
  overflow: auto;
  display: block;
`;

export const ConfigureBasePane = styled(Pane)`
  flex-direction: column;
  align-items: center;
  justify-content: space-evenly;
  background: transparent;
  pointer-events: none;
  z-index: 3;
`;
