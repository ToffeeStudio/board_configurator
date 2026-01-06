import styled from 'styled-components';

interface RangeProps {
  $percent: number;
  $trackColor: string;
  $thumbBg: string;
  $thumbBorder: string;
  $glowColor: string;
}

export const RangeInput = styled.input.attrs({ type: 'range' })<RangeProps>`
  -webkit-appearance: none;
  width: 100%;
  background: transparent;
  cursor: pointer;
  
  &:focus {
    outline: none;
  }

  /* Track */
  &::-webkit-slider-runnable-track {
    width: 100%;
    height: 4px;
    background: ${props => props.$trackColor};
    border-radius: 4px;
  }

  /* Thumb */
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    height: 24px;
    width: 24px;
    border-radius: 50%;
    background: ${props => props.$thumbBg};
    border: 1.5px solid ${props => props.$thumbBorder};
    margin-top: -10px; /* (24 - 4) / 2 */
    transition: all 0.2s ease-out;
    box-shadow: 0 0 0 rgba(0,0,0,0); 
  }

  /* On Hover/Active */
  &:hover::-webkit-slider-thumb, &:active::-webkit-slider-thumb {
    border-color: color-mix(in srgb, #ffffff 30%, ${props => props.$glowColor});
    box-shadow: 0 0 10px ${props => props.$glowColor};
  }
  
  /* Firefox styles */
  &::-moz-range-track {
    width: 100%;
    height: 4px;
    background: ${props => props.$trackColor};
    border-radius: 4px;
  }

  &::-moz-range-thumb {
    height: 24px;
    width: 24px;
    border-radius: 50%;
    background: ${props => props.$thumbBg};
    border: 1.5px solid ${props => props.$thumbBorder};
    transition: all 0.2s ease-out;
    box-shadow: 0 0 0 rgba(0,0,0,0);
  }

  &:hover::-moz-range-thumb, &:active::-moz-range-thumb {
    border-color: color-mix(in srgb, #ffffff 30%, ${props => props.$glowColor});
    box-shadow: 0 0 10px ${props => props.$glowColor};
  }
`;
