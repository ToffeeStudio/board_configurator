import {useProgress} from '@react-three/drei';
import {DefinitionVersionMap, KeyColorType} from '@the-via/reader';
import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {shallowEqual} from 'react-redux';
import {
  getCustomDefinitions,
  getSelectedDefinition,
  getSelectedKeyDefinitions,
} from 'src/store/definitionsSlice';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  clearSelectedKey,
  getConfigureKeyboardIsSelectable,
  getLoadProgress,
  updateSelectedKey,
} from 'src/store/keymapSlice';
import {
  getDesignDefinitionVersion,
  getSelectedTheme,
} from 'src/store/settingsSlice';
import {OVERRIDE_HID_CHECK} from 'src/utils/override';
import {useSize} from 'src/utils/use-size';
import {
  calculateKeyboardFrameDimensions,
  CSSVarObject,
} from 'src/utils/keyboard-rendering';
import styled, { keyframes } from 'styled-components';
import {useLocation} from 'wouter';
import {ConfigureKeyboard} from '../n-links/keyboard/configure';
import {Design} from '../n-links/keyboard/design';
import {Test} from '../n-links/keyboard/test';
import KeyboardCaseImg from '../../assets/images/case.png';

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

const KeyboardBG = styled.div<{
  onClick: () => void;
  $color: string;
  $visible: boolean;
}>`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: transparent;
  opacity: ${(props) => (props.$visible ? 1 : 0)};
`;

const FixedScreenOverlay = styled.div`
  position: absolute;
  z-index: 10;
  mix-blend-mode: screen;
  pointer-events: none;
  background-image: url(${KeyboardCaseImg});
  background-size: 100% 100%;
  background-position: center;
  background-repeat: no-repeat;
  
  /* Animation applied directly here to avoid wrapper stacking context issues with mix-blend-mode */
  animation: ${fadeSlideIn} 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
`;

const PaneAnimationWrapper = styled.div`
  height: 100%;
  width: 100%;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  animation: ${fadeSlideIn} 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
`;

// Helper to calculate scaling factors
const useKeyboardLayoutStats = (containerRect: DOMRect | null) => {
  const keys = useAppSelector(getSelectedKeyDefinitions);
  
  return useMemo(() => {
    if (!keys || !keys.length || !containerRect) return null;

    const {width, height} = calculateKeyboardFrameDimensions(keys);
    const containerHeight = containerRect.height;
    const minPadding = 35;
    
    const pxWidth = (CSSVarObject.keyWidth + CSSVarObject.keyXSpacing) * width - CSSVarObject.keyXSpacing + minPadding * 2;
    const pxHeight = (CSSVarObject.keyHeight + CSSVarObject.keyYSpacing) * height - CSSVarObject.keyYSpacing + minPadding * 2;

    const ratio = Math.min(
      Math.min(1, containerRect.width / pxWidth),
      containerHeight / pxHeight
    ) || 1;

    const finalScale = ratio * 0.95;

    return {
      scaledWidth: pxWidth * finalScale,
      scaledHeight: pxHeight * finalScale,
      ratio: finalScale,
    };
  }, [keys, containerRect]);
};

export const CanvasRouter = () => {
  const [path] = useLocation();
  const body = useRef(document.body);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadProgress = useAppSelector(getLoadProgress);
  const {progress} = useProgress();
  const dispatch = useAppDispatch();
  
  const [absoluteRect, setAbsoluteRect] = useState<DOMRect | null>(null);
  
  // We keep this just to ensure the component updates if the body resizes
  const dimensions = useSize(body); 
  
  useLayoutEffect(() => {
    let animationFrameId: number;

    const updateRect = () => {
      if (containerRef.current) {
        const newRect = containerRef.current.getBoundingClientRect();
        
        setAbsoluteRect(prev => {
          if (!prev) return newRect;
          if (
            prev.x === newRect.x && 
            prev.y === newRect.y && 
            prev.width === newRect.width && 
            prev.height === newRect.height
          ) {
            return prev;
          }
          return newRect;
        });
      }
      animationFrameId = requestAnimationFrame(updateRect);
    };

    updateRect(); // Start

    return () => cancelAnimationFrame(animationFrameId); // Cleanup
  }, []);

  const localDefinitions = Object.values(useAppSelector(getCustomDefinitions));
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const definitionVersion = useAppSelector(getDesignDefinitionVersion);
  const theme = useAppSelector(getSelectedTheme);
  const accentColor = useMemo(() => theme[KeyColorType.Accent].c, [theme]);
  
  const showLoader = path === '/' && (!selectedDefinition || loadProgress !== 1);
  const versionDefinitions: DefinitionVersionMap[] = useMemo(
    () =>
      localDefinitions.filter(
        (definitionMap) => definitionMap[definitionVersion],
      ),
    [localDefinitions, definitionVersion],
  );
  
  const hideDesignScene = '/design' === path && !versionDefinitions.length;
  const hideConfigureScene = '/' === path && (!selectedDefinition || (loadProgress + progress / 100) / 2 !== 1);
  const terrainOnClick = useCallback(() => {
    if (true) {
      dispatch(updateSelectedKey(null));
    }
  }, [dispatch]);
  const showAuthorizeButton = 'hid' in navigator || OVERRIDE_HID_CHECK;

  const ALLOWED_CANVAS_ROUTES = ['/', '/test', '/design', '/debug'];
  const showCanvas = ALLOWED_CANVAS_ROUTES.includes(path);

  const hideCanvasScene =
    !showAuthorizeButton ||
    !showCanvas ||
    hideDesignScene ||
    hideConfigureScene;
  const configureKeyboardIsSelectable = useAppSelector(getConfigureKeyboardIsSelectable);
  const hideTerrainBG = showLoader;

  // --- OVERLAY CALCULATION START ---
  const layoutStats = useKeyboardLayoutStats(absoluteRect);
  
  let overlayStyle: React.CSSProperties = { display: 'none' };

  if (layoutStats && absoluteRect && !hideCanvasScene && !hideTerrainBG) {
    const offsetX = 4 * layoutStats.ratio;
    const offsetY = -86 * layoutStats.ratio;

    // Calculate center relative to the container since position is absolute
    const containerCenterX = absoluteRect.width / 2 + offsetX;
    const containerCenterY = absoluteRect.height / 2 + offsetY;

    const overlayWidth = layoutStats.scaledWidth * 2.21;
    const overlayHeight = layoutStats.scaledHeight * 3.46;

    // We calculate Top/Left explicitly to avoid using transform: translate(-50%, -50%)
    // This frees up the transform property for the fadeSlideIn animation.
    overlayStyle = {
      display: 'block',
      width: overlayWidth,
      height: overlayHeight,
      left: containerCenterX - overlayWidth / 2,
      top: containerCenterY - overlayHeight / 2,
    };
  }
  // --- OVERLAY CALCULATION END ---

  return (
    <>
      <div
        style={{
          height: 430,
          width: '100%',
          top: 50,
          transform: hideCanvasScene
            ? !hideTerrainBG
              ? 'translateY(-500px)'
              : !dimensions
              ? ''
              : `translateY(${-300 + dimensions!.height / 2}px)`
            : '',
          position: hideCanvasScene && !hideTerrainBG ? 'absolute' : 'relative',
          overflow: 'visible',
          zIndex: 2,
          visibility: hideCanvasScene && !hideTerrainBG ? 'hidden' : 'visible',
        }}
        onClick={(evt) => {
          if ((evt.target as any).nodeName !== 'CANVAS')
            dispatch(clearSelectedKey());
        }}
        ref={containerRef}
      >
        {hideCanvasScene ? null : (
          <>
            <KeyboardBG
              onClick={terrainOnClick}
              $color={accentColor}
              $visible={!hideTerrainBG}
            />
            
            {/* 
              Applied animation directly to component and removed wrapper.
              Fixed positioning to not rely on transform: translate.
              This restores mix-blend-mode behavior while keeping animation.
            */}
            <FixedScreenOverlay style={overlayStyle} key={path} />
            
            <KeyboardGroup
              containerDimensions={absoluteRect}
              configureKeyboardIsSelectable={configureKeyboardIsSelectable}
              loadProgress={loadProgress}
            />
          </>
        )}
      </div>
    </>
  );
};

const KeyboardGroupContainer = styled.div`
  z-index: 2;
  display: block;
  white-space: nowrap;
  height: 100%;
  width: 100%;
  position: absolute;
  top: 0;
  left: 0;
`;

const KeyboardGroup = React.memo((props: any) => {
  const {configureKeyboardIsSelectable, containerDimensions} = props;
  const [path] = useLocation();

  let ComponentToRender = null;

  switch (path) {
    case '/':
      ComponentToRender = (
        <ConfigureKeyboard
          dimensions={containerDimensions}
          selectable={configureKeyboardIsSelectable}
          nDimension={'2D'}
        />
      );
      break;
    case '/test':
      ComponentToRender = (
        <Test dimensions={containerDimensions} nDimension={'2D'} />
      );
      break;
    case '/design':
      ComponentToRender = (
        <Design dimensions={containerDimensions} nDimension={'2D'} />
      );
      break;
    default:
      ComponentToRender = null;
  }

  return (
    <KeyboardGroupContainer>
      {ComponentToRender && (
        <PaneAnimationWrapper key={path}>
          {ComponentToRender}
        </PaneAnimationWrapper>
      )}
    </KeyboardGroupContainer>
  );
}, shallowEqual);
