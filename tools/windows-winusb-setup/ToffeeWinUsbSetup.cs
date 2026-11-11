using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("Toffee Module Windows Setup")]
[assembly: System.Reflection.AssemblyCompany("Toffee Studio")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

internal static class ToffeeWinUsbSetup
{
    const string Title = "Toffee Module Windows Setup";
    const string EnumKey = @"SYSTEM\CurrentControlSet\Enum\";
    const string GuidValue = "DeviceInterfaceGUIDs";
    const string ToffeeGuid = "{82f8dc0a-38a1-4cdc-8699-1a794b4e1f22}";
    static readonly Regex Target = new Regex(
        @"\AUSB\\VID_2E8A&PID_0003&MI_01\\[A-Z0-9_&.-]+\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    static readonly string InboxInf = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.Windows), "INF", "winusb.inf");
    static readonly IntPtr InvalidHandle = new IntPtr(-1);

    [STAThread]
    static int Main(string[] args)
    {
        bool quiet = args.Length == 1 && args[0] == "--quiet";
        if (args.Length != 0 && !quiet) return 1;
        try
        {
            if (Environment.OSVersion.Version.Build < 19041)
                throw new InvalidOperationException("This setup requires Windows 10 version 2004 or later, or Windows 11.");
            bool first;
            using (var mutex = new Mutex(true, @"Local\ToffeeModuleWinUSBSetup", out first))
            {
                if (!first) throw new InvalidOperationException("Toffee Windows Setup is already running.");
                string instance = FindOne();
                bool reboot = Configure(instance);
                Report(quiet, reboot
                    ? "Setup is installed. Restart Windows, return the Module to update mode, then allow bootloader access in your browser."
                    : "Windows setup is ready. Return to the firmware updater and choose RP2 Boot when the browser asks.", false);
                return reboot ? 3010 : 0;
            }
        }
        catch (Exception error)
        {
            Report(quiet, error.Message, true);
            return 1;
        }
    }

    static void Report(bool quiet, string message, bool error)
    {
        if (quiet)
            (error ? Console.Error : Console.Out).WriteLine(message);
        else
            MessageBox.Show(message, Title, MessageBoxButtons.OK,
                error ? MessageBoxIcon.Error : MessageBoxIcon.Information);
    }

    static string FindOne()
    {
        // Ask PnP for present USB devices. Registry history also contains disconnected devices.
        const uint presentUsb = 0x101; // CM_GETIDLIST_FILTER_PRESENT | CM_GETIDLIST_FILTER_ENUMERATOR
        for (int attempt = 0; attempt < 3; attempt++)
        {
            uint size;
            CheckConfig(CM_Get_Device_ID_List_SizeW(out size, "USB", presentUsb), "enumerate USB devices");
            char[] list = new char[size];
            uint result = CM_Get_Device_ID_ListW("USB", list, size, presentUsb);
            if (result == 0x1a) continue; // CR_BUFFER_SMALL: a device arrived during enumeration.
            CheckConfig(result, "enumerate USB devices");
            string found = null;
            foreach (string id in new string(list).Split('\0'))
            {
                if (!Target.IsMatch(id)) continue;
                if (found != null) throw new InvalidOperationException("Disconnect the other RP2 Boot devices, then run setup again.");
                found = id;
            }
            if (found == null) throw new InvalidOperationException(
                "RP2 Boot is not connected. In the browser updater, start the Module update and wait for the bootloader prompt, then run this setup again.");
            return found;
        }
        throw new InvalidOperationException("USB devices changed during setup. Keep only the Module connected and try again.");
    }

    static void RequireSame(string instance)
    {
        if (!String.Equals(instance, FindOne(), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The bootloader changed during setup. Keep the same Module connected and try again.");
    }

    static string Service(string instance)
    {
        using (var key = Registry.LocalMachine.OpenSubKey(EnumKey + instance))
            return key == null ? null : key.GetValue("Service") as string;
    }

    static uint Problem(string instance, out uint status)
    {
        uint node, code;
        CheckConfig(CM_Locate_DevNodeW(out node, instance, 0), "locate RP2 Boot Interface 1");
        CheckConfig(CM_Get_DevNode_Status(out status, out code, node, 0), "check RP2 Boot status");
        return code;
    }

    static bool IsWinUsb(string instance)
    {
        return String.Equals(Service(instance), "WinUSB", StringComparison.OrdinalIgnoreCase);
    }

    static bool IsStarted(string instance)
    {
        uint status;
        return Problem(instance, out status) == 0 && (status & 8) != 0; // DN_STARTED
    }

    static bool IsUnbound(string instance, uint problem, uint status)
    {
        // An explicitly unbound devnode can report Code 0, but it is not started.
        return (problem == 28 || problem == 0) && (status & 8) == 0 &&
            String.IsNullOrEmpty(Service(instance));
    }

    static bool InterfaceReady(string instance)
    {
        if (!IsWinUsb(instance) || !IsStarted(instance)) return false;
        using (var key = Registry.LocalMachine.OpenSubKey(EnumKey + instance + @"\Device Parameters"))
        {
            if (key == null) return false;
            foreach (string value in new[] {"DeviceInterfaceGUID", GuidValue})
            {
                object entry = key.GetValue(value);
                string[] candidates = entry as string[] ?? new[] {entry as string};
                foreach (string candidate in candidates)
                {
                    Guid guid;
                    if (!Guid.TryParse(candidate, out guid) || guid == Guid.Empty) continue;
                    uint size;
                    // CM_GET_DEVICE_INTERFACE_LIST_PRESENT is zero. A nonempty MULTI_SZ
                    // for this instance means Windows registered an enabled interface path.
                    if (CM_Get_Device_Interface_List_SizeW(out size, ref guid, instance, 0) != 0 || size <= 1)
                        continue;
                    char[] paths = new char[size];
                    if (CM_Get_Device_Interface_ListW(ref guid, instance, paths, size, 0) == 0 && paths[0] != '\0')
                        return true;
                }
            }
        }
        return false;
    }

    static bool Configure(string instance)
    {
        if (InterfaceReady(instance)) return false; // Leave a working setup alone.
        uint status;
        bool wasWinUsb = IsWinUsb(instance);
        uint problem = Problem(instance, out status);
        if (wasWinUsb ? problem != 0 : !IsUnbound(instance, problem, status))
            throw new InvalidOperationException(
                "RP2 Boot Interface 1 already has a different driver or a Windows device error. Setup left it unchanged. Contact Toffee support.");

        string parameters = EnumKey + instance + @"\Device Parameters";
        object original = null;
        RegistryValueKind originalKind = RegistryValueKind.Unknown;
        bool attemptedInstall = false, guidChanged = false;
        try
        {
            RequireSame(instance);
            bool reboot = false;
            if (!wasWinUsb)
            {
                attemptedInstall = true;
                reboot = Install(instance, false);
                if (!IsWinUsb(instance)) throw new InvalidOperationException("Windows did not bind WinUSB to RP2 Boot Interface 1.");
            }
            if (InterfaceReady(instance)) return reboot;

            RequireSame(instance);
            using (var key = Registry.LocalMachine.OpenSubKey(parameters, true))
            {
                if (key == null) throw new InvalidOperationException("Windows did not create the interface settings.");
                original = key.GetValue(GuidValue, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
                if (original != null) originalKind = key.GetValueKind(GuidValue);
                var guids = new List<string>(original as string[] ?? new string[0]);
                guids.RemoveAll(value => String.Equals(value, ToffeeGuid, StringComparison.OrdinalIgnoreCase));
                guids.Add(ToffeeGuid);
                guidChanged = true;
                key.SetValue(GuidValue, guids.ToArray(), RegistryValueKind.MultiString);
            }
            if (reboot) return true;
            Restart(instance);
            var watch = Stopwatch.StartNew();
            while (watch.ElapsedMilliseconds < 8000)
            {
                if (InterfaceReady(instance)) return false;
                Thread.Sleep(250);
            }
            throw new InvalidOperationException("Windows did not expose the WinUSB interface to applications.");
        }
        catch (Exception setupError)
        {
            if (!attemptedInstall && !guidChanged) throw;
            try
            {
                RequireSame(instance);
                if (guidChanged)
                    using (var key = Registry.LocalMachine.OpenSubKey(parameters, true))
                    {
                        if (key == null) throw new InvalidOperationException("Interface settings are unavailable.");
                        if (original == null) key.DeleteValue(GuidValue, false);
                        else key.SetValue(GuidValue, original, originalKind);
                    }
                if (attemptedInstall && IsWinUsb(instance))
                {
                    uint rollbackStatus;
                    if (Install(instance, true))
                        throw new InvalidOperationException("Windows requested a reboot during rollback.");
                    uint rollbackProblem = Problem(instance, out rollbackStatus);
                    if (!IsUnbound(instance, rollbackProblem, rollbackStatus))
                        throw new InvalidOperationException("Windows did not restore the unbound interface.");
                }
                else if (guidChanged) Restart(instance);
            }
            catch (Exception rollbackError)
            {
                throw new InvalidOperationException(setupError.Message +
                    "\n\nSetup could not verify rollback: " + rollbackError.Message + " Contact Toffee support before retrying.");
            }
            throw new InvalidOperationException(setupError.Message + "\n\nSetup rolled back the Windows changes.");
        }
    }

    static void Restart(string instance)
    {
        RequireSame(instance);
        var command = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "pnputil.exe"),
            "/restart-device \"" + instance + "\"") {UseShellExecute = false, CreateNoWindow = true};
        using (var process = Process.Start(command))
        {
            if (!process.WaitForExit(20000))
                throw new InvalidOperationException("Windows did not finish restarting RP2 Boot Interface 1. Restart Windows before retrying.");
            if (process.ExitCode != 0)
                throw new InvalidOperationException("Windows could not restart RP2 Boot Interface 1 (exit " + process.ExitCode + ").");
        }
    }

    static bool Install(string instance, bool unbind)
    {
        RequireSame(instance);
        IntPtr list = SetupDiCreateDeviceInfoList(IntPtr.Zero, IntPtr.Zero);
        if (list == InvalidHandle) throw new Win32Exception();
        IntPtr selected = IntPtr.Zero;
        try
        {
            var device = new Device {Size = Marshal.SizeOf(typeof(Device))};
            Check(SetupDiOpenDeviceInfoW(list, instance, IntPtr.Zero, 0, ref device), "open RP2 Boot Interface 1");
            if (!unbind)
            {
                var model = FindInboxDriver(list, ref device);
                selected = Marshal.AllocHGlobal(model.Size);
                Marshal.StructureToPtr(model, selected, false);
            }
            bool reboot;
            Check(DiInstallDevice(IntPtr.Zero, list, ref device, selected, unbind ? 4u : 0u, out reboot),
                unbind ? "restore the unbound interface" : "bind the Microsoft WinUSB driver");
            return reboot;
        }
        finally
        {
            if (selected != IntPtr.Zero) Marshal.FreeHGlobal(selected);
            SetupDiDestroyDeviceInfoList(list);
        }
    }

    static Driver FindInboxDriver(IntPtr list, ref Device device)
    {
        var options = new InstallParams {Size = Marshal.SizeOf(typeof(InstallParams))};
        Check(SetupDiGetDeviceInstallParamsW(list, ref device, ref options), "read driver install options");
        options.Flags |= 0x10000; // DI_ENUMSINGLEINF
        options.FlagsEx |= 0x800; // DI_FLAGSEX_ALLOWEXCLUDEDDRVS
        options.DriverPath = InboxInf;
        Check(SetupDiSetDeviceInstallParamsW(list, ref device, ref options), "select the inbox WinUSB INF");
        const uint classDriver = 1;
        Check(SetupDiBuildDriverInfoList(list, ref device, classDriver), "read inbox WinUSB models");
        for (uint index = 0; ; index++)
        {
            var model = new Driver {Size = Marshal.SizeOf(typeof(Driver))};
            if (!SetupDiEnumDriverInfoW(list, ref device, classDriver, index, ref model))
            {
                if (Marshal.GetLastWin32Error() == 259) break; // ERROR_NO_MORE_ITEMS
                throw new Win32Exception();
            }
            // The model's INF section is stable across Windows display languages.
            if (String.Equals(model.Provider, "Microsoft", StringComparison.OrdinalIgnoreCase)
                && IsWinUsbModel(list, ref device, ref model)) return model;
        }
        throw new InvalidOperationException("Windows did not offer its built-in WinUsb Device model.");
    }

    static bool IsWinUsbModel(IntPtr list, ref Device device, ref Driver model)
    {
        int size = Marshal.SizeOf(typeof(DriverDetail));
        IntPtr detail = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.WriteInt32(detail, size);
            uint required;
            // Even if the trailing hardware ID list needs more space, the fixed fields are returned.
            if (!SetupDiGetDriverInfoDetailW(list, ref device, ref model, detail, (uint)size, out required)
                && Marshal.GetLastWin32Error() != 122)
                throw new Win32Exception();
            int section = Marshal.OffsetOf(typeof(DriverDetail), "Section").ToInt32();
            return String.Equals(Marshal.PtrToStringUni(IntPtr.Add(detail, section)), "WINUSB",
                StringComparison.OrdinalIgnoreCase);
        }
        finally { Marshal.FreeHGlobal(detail); }
    }

    static void Check(bool ok, string step)
    {
        if (!ok) throw new InvalidOperationException("Could not " + step + ": " + new Win32Exception().Message);
    }

    static void CheckConfig(uint result, string step)
    {
        if (result != 0) throw new InvalidOperationException("Could not " + step + " (Configuration Manager " + result + ").");
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Device { public int Size; public Guid Class; public uint DevInst; public IntPtr Reserved; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct InstallParams
    {
        public int Size;
        public uint Flags, FlagsEx;
        public IntPtr Parent, Handler, Context, Queue, ClassReserved;
        public uint Reserved;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string DriverPath;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Driver
    {
        public int Size;
        public uint Type;
        public IntPtr Reserved;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Description;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Manufacturer;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Provider;
        public System.Runtime.InteropServices.ComTypes.FILETIME Date;
        public ulong Version;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DriverDetail
    {
        public int Size;
        public System.Runtime.InteropServices.ComTypes.FILETIME Date;
        public uint CompatIdsOffset, CompatIdsLength;
        public IntPtr Reserved;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Section;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string InfFile;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Description;
        public char FirstHardwareIdChar;
    }

    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    static extern uint CM_Get_Device_ID_List_SizeW(out uint length, string filter, uint flags);
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    static extern uint CM_Get_Device_ID_ListW(string filter, [Out] char[] list, uint length, uint flags);
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    static extern uint CM_Locate_DevNodeW(out uint node, string instance, uint flags);
    [DllImport("cfgmgr32.dll")]
    static extern uint CM_Get_DevNode_Status(out uint status, out uint problem, uint node, uint flags);
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    static extern uint CM_Get_Device_Interface_List_SizeW(out uint length, ref Guid guid, string instance, uint flags);
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    static extern uint CM_Get_Device_Interface_ListW(ref Guid guid, string instance, [Out] char[] list, uint length, uint flags);
    [DllImport("setupapi.dll", SetLastError = true)]
    static extern IntPtr SetupDiCreateDeviceInfoList(IntPtr classGuid, IntPtr parent);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    static extern bool SetupDiOpenDeviceInfoW(IntPtr list, string instance, IntPtr parent, uint flags, ref Device device);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    static extern bool SetupDiGetDeviceInstallParamsW(IntPtr list, ref Device device, ref InstallParams options);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    static extern bool SetupDiSetDeviceInstallParamsW(IntPtr list, ref Device device, ref InstallParams options);
    [DllImport("setupapi.dll", SetLastError = true)]
    static extern bool SetupDiBuildDriverInfoList(IntPtr list, ref Device device, uint type);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    static extern bool SetupDiEnumDriverInfoW(IntPtr list, ref Device device, uint type, uint index, ref Driver driver);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    static extern bool SetupDiGetDriverInfoDetailW(IntPtr list, ref Device device, ref Driver driver, IntPtr detail, uint size, out uint required);
    [DllImport("setupapi.dll", SetLastError = true)]
    static extern bool SetupDiDestroyDeviceInfoList(IntPtr list);
    [DllImport("newdev.dll", SetLastError = true)]
    static extern bool DiInstallDevice(IntPtr parent, IntPtr list, ref Device device, IntPtr driver, uint flags, out bool reboot);
}
