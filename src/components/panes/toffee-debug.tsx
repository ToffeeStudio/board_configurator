import {useAppDispatch, useAppSelector} from '../../store/hooks';
import {getSelectedKeyboardAPI, setForceAuthorize} from '../../store/devicesSlice';
import {reloadConnectedDevices} from '../../store/devicesThunks';
import {ManualMeasurement} from '../toffee_studio/manual-measurement';

export function ToffeeDebug() {
  const keyboard = useAppSelector(getSelectedKeyboardAPI);
  const dispatch = useAppDispatch();
  const device = keyboard ? keyboard.getHID()._hidDevice!._device : null;
  return <ManualMeasurement device={device} onConnect={() => {
    dispatch(setForceAuthorize(true)); dispatch(reloadConnectedDevices());
  }}/>;
}
