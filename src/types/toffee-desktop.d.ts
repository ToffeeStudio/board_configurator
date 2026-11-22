type ToffeeUsbMode = 'module' | 'bootloader';
type ToffeeUsbTarget = {location: string; serial: string | null};

interface Window {
  toffeeDesktop?: {
    platform: string;
    factory: boolean;
    installUsbDriver(location: string | null): Promise<string>;
    qualifyInstaller: boolean;
    installerTarget(mode: ToffeeUsbMode): Promise<ToffeeUsbTarget | null>;
    modulePort(): Promise<string | null>;
    onPowerChange(listener: (asleep: boolean) => void): void;
  };
}
