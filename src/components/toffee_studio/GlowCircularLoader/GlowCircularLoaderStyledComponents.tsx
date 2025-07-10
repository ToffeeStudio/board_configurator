import styled, { keyframes } from 'styled-components';

export const animate = keyframes`
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
`;

export interface LoaderWrapperProps {
  $size: string;
  $gradientColorStart: string;
  $gradientColorEnd: string;
  $animationDuration: string;
}

export interface LoaderSpanProps {
  $gradientColorStart: string;
  $gradientColorEnd: string;
  $blurAmount: string;
}

export interface LoaderInnerCutoutProps {
  $thickness: string;
  $innerBackgroundColor: string;
  $gradientColorStart: string;
  $gradientColorEnd: string;
}

export const LoaderWrapper = styled.div<LoaderWrapperProps>`
  position: relative;
  width: ${(props) => props.$size};
  height: ${(props) => props.$size};
  border-radius: 50%;
  background: linear-gradient(${(props) => props.$gradientColorStart}, ${(props) => props.$gradientColorEnd});
  animation: ${animate} ${(props) => props.$animationDuration} linear infinite;
`;

export const LoaderSpan = styled.span<LoaderSpanProps>`
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: linear-gradient(${(props) => props.$gradientColorStart}, ${(props) => props.$gradientColorEnd});
  filter: blur(${(props) => props.$blurAmount});
`;

export const LoaderInnerCutout = styled.div<LoaderInnerCutoutProps>`
  content: '';
  position: absolute;
  top: ${(props) => props.$thickness};
  left: ${(props) => props.$thickness};
  right: ${(props) => props.$thickness};
  bottom: ${(props) => props.$thickness};
  background: ${(props) => props.$innerBackgroundColor};
  border-radius: 50%;
  box-shadow: inset 0 0 7px ${(props) => props.$gradientColorStart},
    inset 0 0 20px ${(props) => props.$gradientColorEnd};
`;
