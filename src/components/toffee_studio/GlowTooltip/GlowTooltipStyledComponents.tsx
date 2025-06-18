import styled from 'styled-components';

export const TooltipWrapper = styled.div`
  position: relative;
  display: inline-block;
`;

export const TooltipBox = styled.div`
  position: absolute;
  bottom: 125%; // Position above the element
  left: 50%;
  transform: translateX(-50%);
  color: #fff;
  z-index: 10;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s, visibility 0.2s;




  ${TooltipWrapper}:hover & {
    opacity: 1;
    visibility: visible;
  }
`;
