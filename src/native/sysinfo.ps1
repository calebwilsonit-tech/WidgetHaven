# Haven Bar helper: prints one JSON line per tick with open windows (+ which virtual desktop each is on),
# the virtual desktop list, master volume and what's playing. Reads commands on stdin; exits when it closes.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

[ComImport, Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IVirtualDesktopManager {
  [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr hwnd, out bool on);
  [PreserveSig] int GetWindowDesktopId(IntPtr hwnd, out Guid id);
  [PreserveSig] int MoveWindowToDesktop(IntPtr hwnd, ref Guid id);
}
[ComImport, Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a")] class CVirtualDesktopManager {}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
  int j(); int GetMasterVolumeLevelScalar(out float level);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}

public class HavenSys {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtrW(IntPtr h, int i);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowExW(IntPtr p, IntPtr a, string c, string n);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint a, bool i, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr h, int f, StringBuilder s, ref int n);

  static IVirtualDesktopManager vdm;
  static IAudioEndpointVolume vol;
  static Dictionary<uint, string> exeCache = new Dictionary<uint, string>();

  static string Esc(string s) {
    if (s == null) return "";
    var b = new StringBuilder();
    foreach (char c in s) {
      if (c == '"' || c == '\\') { b.Append('\\'); b.Append(c); }
      else if (c < 32) b.Append(' ');
      else b.Append(c);
    }
    return b.ToString();
  }
  static string Exe(uint pid) {
    string p;
    if (exeCache.TryGetValue(pid, out p)) return p;
    p = "";
    IntPtr h = OpenProcess(0x1000, false, pid);
    if (h != IntPtr.Zero) { var sb = new StringBuilder(1024); int n = 1024; if (QueryFullProcessImageNameW(h, 0, sb, ref n)) p = sb.ToString(); CloseHandle(h); }
    if (exeCache.Count > 500) exeCache.Clear();
    exeCache[pid] = p;
    return p;
  }

  public static string Windows() {
    if (vdm == null) { try { vdm = (IVirtualDesktopManager)new CVirtualDesktopManager(); } catch {} }
    var fg = GetForegroundWindow();
    var outp = new StringBuilder("[");
    bool first = true;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      if (GetWindow(h, 4) != IntPtr.Zero) return true;                 // owned (dialogs, popups)
      long ex = GetWindowLongPtrW(h, -20).ToInt64();
      if ((ex & 0x80) != 0 && (ex & 0x40000) == 0) return true;        // tool windows
      if ((ex & 0x08000000) != 0 && (ex & 0x40000) == 0) return true;  // no-activate windows
      var t = new StringBuilder(512); GetWindowTextW(h, t, 512);
      if (t.Length == 0) return true;
      var c = new StringBuilder(256); GetClassNameW(h, c, 256);
      string cls = c.ToString();
      if (cls == "Windows.UI.Core.CoreWindow" || cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") return true;
      int cloaked = 0; DwmGetWindowAttribute(h, 14, out cloaked, 4);
      Guid d = Guid.Empty;
      if (vdm != null) { try { vdm.GetWindowDesktopId(h, out d); } catch {} }
      // Cloaked windows that aren't on another desktop are hidden shells / background windows.
      if (cloaked != 0 && d == Guid.Empty) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      // Store apps live inside ApplicationFrameHost; report the real app inside it.
      if (cls == "ApplicationFrameWindow") { var core = FindWindowExW(h, IntPtr.Zero, "Windows.UI.Core.CoreWindow", null); if (core != IntPtr.Zero) { uint p2; GetWindowThreadProcessId(core, out p2); if (p2 != 0) pid = p2; } }
      if (!first) outp.Append(",");
      first = false;
      outp.Append("{\"h\":").Append(h.ToInt64()).Append(",\"pid\":").Append(pid)
        .Append(",\"t\":\"").Append(Esc(t.ToString())).Append("\",\"c\":\"").Append(Esc(cls))
        .Append("\",\"exe\":\"").Append(Esc(Exe(pid))).Append("\",\"d\":\"").Append(d == Guid.Empty ? "" : d.ToString())
        .Append("\",\"min\":").Append(IsIconic(h) ? "true" : "false")
        .Append(",\"cl\":").Append(cloaked != 0 ? "true" : "false")
        .Append(",\"fg\":").Append(h == fg ? "true" : "false").Append("}");
      return true;
    }, IntPtr.Zero);
    return outp.Append("]").ToString();
  }

  static bool VolInit() {
    if (vol != null) return true;
    try {
      var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      IMMDevice dev; en.GetDefaultAudioEndpoint(0, 1, out dev);
      var iid = typeof(IAudioEndpointVolume).GUID; object o;
      dev.Activate(ref iid, 23, IntPtr.Zero, out o);
      vol = (IAudioEndpointVolume)o;
      return true;
    } catch { vol = null; return false; }
  }
  static int volTick = 0;
  public static string Volume() {
    // Re-acquire now and then so switching speakers/headphones is picked up.
    if (++volTick % 15 == 0) vol = null;
    if (!VolInit()) return "null";
    try { float v; bool m; vol.GetMasterVolumeLevelScalar(out v); vol.GetMute(out m);
      return "{\"level\":" + Math.Round(v * 100) + ",\"muted\":" + (m ? "true" : "false") + "}";
    } catch { vol = null; return "null"; }
  }
  public static void SetVolume(int pct) { if (VolInit()) { var g = Guid.Empty; vol.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, pct)) / 100f, ref g); } }
  public static void SetMute(bool m) { if (VolInit()) { var g = Guid.Empty; vol.SetMute(m, ref g); } }
  // Which processes own top-level windows, and which of those have one showing. A background app (tray app)
  // owns windows but shows none; console tools own none at all (their window belongs to the console host).
  public static string WindowOwners() {
    var any = new HashSet<uint>(); var shown = new HashSet<uint>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      any.Add(pid);
      if (IsWindowVisible(h)) {
        int cloaked = 0; DwmGetWindowAttribute(h, 14, out cloaked, 4);
        var t = new StringBuilder(8); if (cloaked == 0 && GetWindowTextW(h, t, 8) > 0) shown.Add(pid);
      }
      return true;
    }, IntPtr.Zero);
    return string.Join(",", any) + "|" + string.Join(",", shown);
  }
  public static void MoveToDesktop(long h, string id) { if (vdm != null) { var g = new Guid(id); vdm.MoveWindowToDesktop(new IntPtr(h), ref g); } }
}
'@

function Get-Desktops {
  $k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops'
  $p = Get-ItemProperty $k
  $ids = @()
  if ($p.VirtualDesktopIDs) { $b = [byte[]]$p.VirtualDesktopIDs; for ($i = 0; $i + 16 -le $b.Length; $i += 16) { $ids += ([Guid]::new([byte[]]$b[$i..($i + 15)])).ToString() } }
  $cur = $null
  if ($p.CurrentVirtualDesktop) { $cur = ([Guid]::new([byte[]]$p.CurrentVirtualDesktop)).ToString() }
  $list = foreach ($id in $ids) { $n = (Get-ItemProperty "$k\Desktops\{$id}" -Name Name).Name; @{ id = $id; name = "$n" } }
  @{ list = @($list); current = $cur }
}

# Moving another app's window to its own virtual desktop. Windows has no public way to do this, so it uses
# the shell's internal desktop interfaces (Windows 11 24H2 and later). If they're unavailable, the tiler
# falls back to floating the window.
try {
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
namespace HavenVD {
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("6D5140C1-7436-11CE-8034-00AA006009FA")]
  public interface IServiceProvider10 { [return: MarshalAs(UnmanagedType.IUnknown)] object QueryService(ref Guid service, ref Guid riid); }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("92CA9DCD-5622-4BBA-A805-5E9F541BD8C9")]
  public interface IObjectArray { void GetCount(out int count); void GetAt(int index, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object obj); }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("372E1D3B-38D3-42E4-A15B-8AB2B178F513")]
  public interface IApplicationView { }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("3F07F4BE-B107-441A-AF0F-39D82529072C")]
  public interface IVirtualDesktop { bool IsViewVisible(IApplicationView view); Guid GetId(); }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("53F5CA0B-158F-4124-900C-057158060B27")]
  public interface IVirtualDesktopManagerInternal {
    int GetCount();
    void MoveViewToDesktop(IApplicationView view, IVirtualDesktop desktop);
    bool CanViewMoveDesktops(IApplicationView view);
    IVirtualDesktop GetCurrentDesktop();
    void GetDesktops(out IObjectArray desktops);
    [PreserveSig] int GetAdjacentDesktop(IVirtualDesktop from, int direction, out IVirtualDesktop desktop);
    void SwitchDesktop(IVirtualDesktop desktop);
    void SwitchDesktopAndMoveForegroundView(IVirtualDesktop desktop);
    IVirtualDesktop CreateDesktop();
    void MoveDesktop(IVirtualDesktop desktop, int nIndex);
    void RemoveDesktop(IVirtualDesktop desktop, IVirtualDesktop fallback);
    IVirtualDesktop FindDesktop(ref Guid desktopid);
  }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("1841C6D7-4F9D-42C0-AF41-8747538F10E5")]
  public interface IApplicationViewCollection {
    int GetViews(out IObjectArray array);
    int GetViewsByZOrder(out IObjectArray array);
    int GetViewsByAppUserModelId(string id, out IObjectArray array);
    int GetViewForHwnd(IntPtr hwnd, out IApplicationView view);
  }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b")]
  public interface IVirtualDesktopManagerPublic {
    [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr hwnd, out bool on);
    [PreserveSig] int GetWindowDesktopId(IntPtr hwnd, out Guid id);
  }
  public static class VD {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowTextLengthW(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtrW(IntPtr h, int i);
    static IVirtualDesktopManagerInternal mgr;
    static IApplicationViewCollection views;
    static IVirtualDesktopManagerPublic pub;
    static void Init() {
      if (mgr != null) return;
      var shell = (IServiceProvider10)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("C2F03A33-21F5-47FA-B4BB-156362A2F239")));
      var sMgr = new Guid("C5E0CDCA-7B6E-41B2-9FC4-D93975CC467B"); var iMgr = typeof(IVirtualDesktopManagerInternal).GUID;
      mgr = (IVirtualDesktopManagerInternal)shell.QueryService(ref sMgr, ref iMgr);
      var iCol = typeof(IApplicationViewCollection).GUID;
      views = (IApplicationViewCollection)shell.QueryService(ref iCol, ref iCol);
      pub = (IVirtualDesktopManagerPublic)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a")));
    }
    public static string MoveToNew(long hwnd) {
      Init();
      IApplicationView view; int hr = views.GetViewForHwnd(new IntPtr(hwnd), out view);
      if (hr != 0 || view == null) throw new Exception("no view");
      var d = mgr.CreateDesktop();
      mgr.MoveViewToDesktop(view, d);
      return d.GetId().ToString();
    }
    public static void MoveHome(long hwnd) {
      Init();
      IApplicationView view; int hr = views.GetViewForHwnd(new IntPtr(hwnd), out view);
      if (hr != 0 || view == null) return;
      mgr.MoveViewToDesktop(view, mgr.GetCurrentDesktop());
    }
    // Removes a desktop Haven made, but only once no app windows are left on it.
    public static bool RemoveIfEmpty(string id) {
      Init();
      var g = new Guid(id);
      bool used = false;
      EnumWindows((h, l) => {
        if (!IsWindowVisible(h) || GetWindowTextLengthW(h) == 0) return true;
        if ((GetWindowLongPtrW(h, -20).ToInt64() & 0x80) != 0) return true;
        Guid d; if (pub.GetWindowDesktopId(h, out d) == 0 && d == g) { used = true; return false; }
        return true;
      }, IntPtr.Zero);
      if (used) return false;
      var desk = mgr.FindDesktop(ref g);
      mgr.RemoveDesktop(desk, mgr.GetCurrentDesktop());
      return true;
    }
  }
}
'@
} catch {}

# Tray icons (the taskbar's hidden icons). Haven sits in front of the taskbar's tray: every message is passed
# straight on to Windows' real tray (so it keeps working), and Haven learns each icon so the bar can show it
# and send the app the same left/right-click a real tray click would. Only started when the bar asks for it.
try {
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'

using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class TrayHost {
  delegate IntPtr WndProc(IntPtr h, uint m, IntPtr w, IntPtr l);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct WNDCLASSEX { public uint cbSize, style; public WndProc lpfnWndProc; public int cbClsExtra, cbWndExtra; public IntPtr hInstance, hIcon, hCursor, hbrBackground; public string lpszMenuName, lpszClassName; public IntPtr hIconSm; }
  [StructLayout(LayoutKind.Sequential)] struct COPYDATASTRUCT { public IntPtr dwData; public int cbData; public IntPtr lpData; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern ushort RegisterClassExW(ref WNDCLASSEX c);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowExW(uint ex, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
  [DllImport("user32.dll")] static extern IntPtr DefWindowProcW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessageW(out MSG m, IntPtr h, uint a, uint b);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessageW(ref MSG m);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeoutW(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterWindowMessageW(string s);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(uint pid);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  // This helper isn't DPI-aware, so GetCursorPos is scaled down on high-DPI screens; this one isn't.
  [DllImport("user32.dll")] static extern bool GetPhysicalCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

  public class Icon { public long hwnd; public uint uid, callback, version, pid; public string tip = ""; public long hicon; public bool hidden; }
  static readonly Dictionary<string, Icon> icons = new Dictionary<string, Icon>();
  static WndProc proc;
  static IntPtr me, explorer;
  static uint myPid = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;

  static IntPtr FindExplorerTray() {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      var c = new StringBuilder(64); GetClassNameW(h, c, 64);
      if (c.ToString() == "Shell_TrayWnd") { uint pid; GetWindowThreadProcessId(h, out pid); if (pid != myPid) { found = h; return false; } }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  static IntPtr Proc(IntPtr h, uint m, IntPtr w, IntPtr l) {
    if (m == 0x004A) { // WM_COPYDATA
      try {
        var cds = (COPYDATASTRUCT)Marshal.PtrToStructure(l, typeof(COPYDATASTRUCT));
        if (cds.dwData.ToInt64() == 1 && cds.cbData >= 8 + 24) Record(cds.lpData, cds.cbData);
      } catch {}
    }
    // Our own window housekeeping stays here; messages meant for the taskbar (data and app messages) go on to the
    // real taskbar, so Windows keeps working exactly as before.
    if (m != 0x004A && m < 0x0400) return DefWindowProcW(h, m, w, l);
    if (explorer == IntPtr.Zero || !IsWindow(explorer)) explorer = FindExplorerTray();
    if (explorer == IntPtr.Zero) return DefWindowProcW(h, m, w, l);
    IntPtr r; SendMessageTimeoutW(explorer, m, w, l, 0x0002 /* ABORTIFHUNG */, 3000, out r);
    return r;
  }

  static void Record(IntPtr p, int n) {
    uint msg = (uint)Marshal.ReadInt32(p, 4);
    int b = 8; // NOTIFYICONDATA (32-bit layout)
    uint hwnd = (uint)Marshal.ReadInt32(p, b + 4), uid = (uint)Marshal.ReadInt32(p, b + 8), flags = (uint)Marshal.ReadInt32(p, b + 12);
    string key = hwnd + ":" + uid;
    lock (icons) {
      if (msg == 2) { icons.Remove(key); return; }          // NIM_DELETE
      Icon ic; if (!icons.TryGetValue(key, out ic)) { ic = new Icon { hwnd = hwnd, uid = uid }; uint pid; GetWindowThreadProcessId(new IntPtr(hwnd), out pid); ic.pid = pid; icons[key] = ic; }
      if (msg == 4) { ic.version = (uint)Marshal.ReadInt32(p, b + 800); return; } // NIM_SETVERSION
      if ((flags & 1) != 0) ic.callback = (uint)Marshal.ReadInt32(p, b + 16);
      if ((flags & 2) != 0) ic.hicon = (uint)Marshal.ReadInt32(p, b + 20);
      if ((flags & 4) != 0) ic.tip = Marshal.PtrToStringUni(new IntPtr(p.ToInt64() + b + 24));
      if ((flags & 8) != 0 && n >= b + 288) { uint st = (uint)Marshal.ReadInt32(p, b + 280), mask = (uint)Marshal.ReadInt32(p, b + 284); if ((mask & 1) != 0) ic.hidden = (st & 1) != 0; }
      if (msg == 0 && n >= b + 804) { uint v = (uint)Marshal.ReadInt32(p, b + 800); if (v > 0 && v < 10) ic.version = v; }
    }
  }

  static bool started;
  public static void Start() {
    if (started) return; started = true;
    var t = new Thread(() => {
      proc = Proc;
      var wc = new WNDCLASSEX { cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX)), lpfnWndProc = proc, lpszClassName = "Shell_TrayWnd" };
      RegisterClassExW(ref wc);
      explorer = FindExplorerTray();
      me = CreateWindowExW(0x80 | 0x8 /* toolwindow, topmost */, "Shell_TrayWnd", "", 0x80000000, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
      SetWindowPos(me, new IntPtr(-1), 0, 0, 0, 0, 0x1 | 0x2 | 0x10);
      // Ask every app to (re)announce its tray icons; they reach us first, and we pass them on.
      PostMessageW(new IntPtr(0xFFFF), RegisterWindowMessageW("TaskbarCreated"), IntPtr.Zero, IntPtr.Zero);
      MSG m; while (GetMessageW(out m, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref m); DispatchMessageW(ref m); }
    });
    t.IsBackground = true; t.SetApartmentState(ApartmentState.STA); t.Start();
  }
  public static void Stop() { if (me != IntPtr.Zero) PostMessageW(me, 0x0010, IntPtr.Zero, IntPtr.Zero); }

  public static string List() {
    var sb = new StringBuilder("[");
    lock (icons) {
      bool first = true;
      foreach (var ic in icons.Values) {
        if (ic.hidden || !IsWindow(new IntPtr(ic.hwnd))) continue;
        if (!first) sb.Append(","); first = false;
        sb.Append("{\"id\":\"").Append(ic.hwnd + ":" + ic.uid).Append("\",\"pid\":").Append(ic.pid).Append(",\"v\":").Append(ic.version)
          .Append(",\"name\":\"").Append(ProcName(ic.pid)).Append("\",\"tip\":\"").Append((ic.tip ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", " ").Replace("\r", "")).Append("\",\"icon\":\"").Append(IconPng(ic.hicon)).Append("\"}");
      }
    }
    return sb.Append("]").ToString();
  }
  static string ProcName(uint pid) { try { return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { return ""; } }
  static readonly Dictionary<long, string> pngs = new Dictionary<long, string>();
  static string IconPng(long h) {
    if (h == 0) return "";
    string s; if (pngs.TryGetValue(h, out s)) return s;
    try { using (var ico = System.Drawing.Icon.FromHandle(new IntPtr(h))) using (var bmp = ico.ToBitmap()) using (var ms = new MemoryStream()) { bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png); s = Convert.ToBase64String(ms.ToArray()); } } catch { s = ""; }
    pngs[h] = s; return s;
  }

  // The same messages a real tray click sends to the app.
  public static bool Click(string id, string button) {
    Icon ic; lock (icons) { if (!icons.TryGetValue(id, out ic)) return false; }
    IntPtr hw = new IntPtr(ic.hwnd);
    AllowSetForegroundWindow(ic.pid);
    // Real screen pixels (this helper isn't DPI-aware, so it would otherwise get scaled coordinates and the
    // app's menu would open off to the side). Per-monitor aware just for this read.
    POINT pt; IntPtr old = IntPtr.Zero;
    try { old = SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch {}
    if (!GetCursorPos(out pt)) GetPhysicalCursorPos(out pt);
    if (old != IntPtr.Zero) { try { SetThreadDpiAwarenessContext(old); } catch {} }
    bool right = button == "right";
    uint down = right ? 0x0204u : 0x0201u, up = right ? 0x0205u : 0x0202u;
    // Like the real taskbar: the pointer moves over the icon first (some apps only react after that).
    if (ic.version >= 4) PostMessageW(hw, ic.callback, new IntPtr((pt.Y << 16) | (pt.X & 0xFFFF)), new IntPtr((long)((ic.uid << 16) | 0x0200u)));
    else PostMessageW(hw, ic.callback, new IntPtr(ic.uid), new IntPtr(0x0200));
    if (ic.version >= 4) {
      IntPtr w = new IntPtr((pt.Y << 16) | (pt.X & 0xFFFF));
      Func<uint, IntPtr> L = (ev) => new IntPtr((long)((ic.uid << 16) | (ev & 0xFFFF)));
      PostMessageW(hw, ic.callback, w, L(down)); PostMessageW(hw, ic.callback, w, L(up));
      PostMessageW(hw, ic.callback, w, L(right ? 0x007Bu /* WM_CONTEXTMENU */ : 0x0400u /* NIN_SELECT */));
    } else {
      PostMessageW(hw, ic.callback, new IntPtr(ic.uid), new IntPtr(down)); PostMessageW(hw, ic.callback, new IntPtr(ic.uid), new IntPtr(up));
      if (!right) PostMessageW(hw, ic.callback, new IntPtr(ic.uid), new IntPtr(0x0203)); // double-click: many old apps open on this
    }
    return true;
  }
}
'@
} catch {}

# Now playing (Windows media sessions: Spotify, browsers, media players…).
$script:media = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
} catch {}
function Await($op, $type) { $t = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op)); if ($t.Wait(1500)) { $t.Result } else { $null } }
try { $script:media = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]) } catch {}
function Get-Media {
  if (-not $script:media) { return $null }
  try {
    $s = $script:media.GetCurrentSession()
    if (-not $s) { return $null }
    $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $st = $s.GetPlaybackInfo().PlaybackStatus.ToString()
    @{ title = "$($p.Title)"; artist = "$($p.Artist)"; app = "$($s.SourceAppUserModelId)"; status = $st }
  } catch { $null }
}
function Invoke-Media($what) {
  try {
    $s = $script:media.GetCurrentSession(); if (-not $s) { return }
    switch ($what) { 'toggle' { $op = $s.TryTogglePlayPauseAsync() } 'next' { $op = $s.TrySkipNextAsync() } 'prev' { $op = $s.TrySkipPreviousAsync() } }
    $null = Await $op ([bool])
  } catch {}
}

# Windows notifications (the same ones as the notification center).
$script:notes = $null
try {
  $null = [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime]
  $l = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
  if ($l.GetAccessStatus().ToString() -eq 'Allowed') { $script:notes = $l }
} catch {}
$script:noteType = [System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]]
function Get-Notes {
  if (-not $script:notes) { return @() }
  try { $n = Await ($script:notes.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) $script:noteType } catch { return @() }
  if (-not $n) { return @() }
  $list = foreach ($x in $n) {
    $texts = @()
    try {
      $b = $x.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric)
      if ($b) { $texts = @($b.GetTextElements() | % { $_.Text }) }
    } catch {}
    $app = ''; try { $app = $x.AppInfo.DisplayInfo.DisplayName } catch {}
    @{ id = $x.Id; app = ("$app" -replace '[\x00-\x1f]', ' '); title = ("$($texts | Select-Object -First 1)" -replace '[\x00-\x1f]', ' '); body = ((($texts | Select-Object -Skip 1) -join ' ') -replace '[\x00-\x1f]', ' '); time = $x.CreationTime.ToUnixTimeMilliseconds() }
  }
  @($list)
}
function Get-NoteCount { if (-not $script:notes) { return 0 }; try { (Await ($script:notes.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) $script:noteType).Count } catch { 0 } }

function Reply($what, $data) {
  # Lists stay lists even with 0 or 1 entries (PowerShell would otherwise unwrap them).
  $json = if ($what -in 'notes', 'procs', 'bgapps') { if ($data -eq $null -or @($data).Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject @($data) -Compress -Depth 5 } }
          elseif ($data -eq $null) { 'null' } else { ConvertTo-Json -InputObject $data -Compress -Depth 5 }
  $out.WriteLine('{"reply":"' + $what + '","data":' + $json + '}'); $out.Flush()
}
function Get-Brightness { try { [int](Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness } catch { -1 } }
function Get-NetInfo {
  $cur = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | % { @{ name = "$($_.Name)"; alias = "$($_.InterfaceAlias)"; internet = ("$($_.IPv4Connectivity)" -eq 'Internet') } })
  $saved = @((netsh wlan show profiles) -match ':\s' | % { ($_ -split ':', 2)[1].Trim() } | ? { $_ })
  $ip = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ? { $_.IPAddress -notmatch '^(127|169\.254)' } | % { "$($_.InterfaceAlias): $($_.IPAddress)" })
  @{ current = $cur; saved = $saved; ip = $ip }
}
# Apps running in the background: own an app window but show none (like the ones in the tray).
function Get-BgApps {
  $parts = [HavenSys]::WindowOwners().Split('|')
  $owners = [Collections.Generic.HashSet[int]]::new(); foreach ($x in $parts[0].Split(',')) { if ($x) { [void]$owners.Add([int]$x) } }
  $shown = [Collections.Generic.HashSet[int]]::new(); foreach ($x in $parts[1].Split(',')) { if ($x) { [void]$shown.Add([int]$x) } }
  $sid = (Get-Process -Id $PID).SessionId
  $skip = 'helper|crash|update|service|broker|host|webview|runtime|elevat|setup|install|squirrel|subprocess|plugin|addin|provider|server|notifier|daemon|watchdog|prelaunch|gpu|renderer|utility|conhost|powershell|cmd|bash|python|node|electron'
  $mine = [Diagnostics.Process]::GetCurrentProcess().Id
  $list = foreach ($g in (Get-Process | ? { $_.SessionId -eq $sid -and $_.Path } | Group-Object Path)) {
    $path = $g.Name
    if ($path -like 'C:\Windows\*' -or $path -like '*_cw5n1h2txyewy\*') { continue }
    $exe = [IO.Path]::GetFileNameWithoutExtension($path)
    if ($exe -match $skip -or $exe -match 'GameAssist|WidgetBoard|CrossDevice') { continue }
    $ids = @($g.Group | % { $_.Id })
    if (-not ($ids | ? { $owners.Contains($_) })) { continue }   # no app window at all: a console tool or a pure service
    if ($ids | ? { $shown.Contains($_) }) { continue }            # showing a window: it's on the taskbar already
    $desc = ''; try { $desc = "$((Get-Item $path).VersionInfo.FileDescription)" } catch {}
    @{ name = $(if ($desc -and $desc.Length -lt 40) { $desc } else { $exe }); pid = $ids[0]; path = $path }
  }
  @($list | Sort-Object { $_.name })
}
function Get-Procs { @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 6 | % { @{ name = "$($_.ProcessName)"; mb = [math]::Round($_.WorkingSet64 / 1MB) } }) }

# Commands arrive on stdin (one per line) and are read on a background thread.
$queue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
$rs = [runspacefactory]::CreateRunspace(); $rs.Open(); $rs.SessionStateProxy.SetVariable('q', $queue)
$ps = [powershell]::Create(); $ps.Runspace = $rs
$null = $ps.AddScript({ $in = [Console]::In; while ($true) { $l = $in.ReadLine(); if ($l -eq $null) { $q.Enqueue('quit'); break }; $q.Enqueue($l) } }).BeginInvoke()

$tick = 0
$out = [Console]::Out
$lastMedia = $null
while ($true) {
  $cmd = $null; $fast = $false
  while ($queue.TryDequeue([ref]$cmd)) {
    if ($cmd -eq 'quit') { [Environment]::Exit(0) }
    $a = $cmd.Split(' ')
    switch ($a[0]) {
      'vol' { [HavenSys]::SetVolume([int]$a[1]) }
      'mute' { [HavenSys]::SetMute($a[1] -eq '1') }
      'move' { [HavenSys]::MoveToDesktop([long]$a[1], $a[2]) }
      'media' { Invoke-Media $a[1]; Start-Sleep -Milliseconds 250; $tick = 0 }
      'notes' { Reply 'notes' (Get-Notes) }
      'noteRemove' { try { $script:notes.RemoveNotification([uint32]$a[1]) } catch {}; Start-Sleep -Milliseconds 200; Reply 'notes' (Get-Notes); $tick = 0 }
      'noteClear' {
        # Remove them one by one (ClearNotifications doesn't reliably apply to desktop apps), then re-read.
        try {
          $all = Await ($script:notes.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) $script:noteType
          foreach ($x in @($all)) { try { $script:notes.RemoveNotification($x.Id) } catch {} }
        } catch {}
        Start-Sleep -Milliseconds 300
        Reply 'notes' (Get-Notes); $noteCount = 0; $tick = 0
      }
      'toastTest' {
        # Shows a test notification (used to check dismissing works).
        try {
          $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
          $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
          $x = [Windows.Data.Xml.Dom.XmlDocument]::new()
          $x.LoadXml('<toast><visual><binding template="ToastGeneric"><text>Haven test</text><text>' + ($a[1..($a.Length - 1)] -join ' ') + '</text></binding></visual></toast>')
          $aumid = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
          [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid).Show([Windows.UI.Notifications.ToastNotification]::new($x))
        } catch {}
        Start-Sleep -Milliseconds 600; Reply 'notes' (Get-Notes)
      }
      'bright' { Reply 'bright' (Get-Brightness) }
      'setBright' { try { Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]$a[1] } | Out-Null } catch {} }
      'net' { Reply 'net' (Get-NetInfo) }
      'procs' { Reply 'procs' (Get-Procs) }
      'bgapps' { Reply 'bgapps' (Get-BgApps) }
      'trayon' { try { [TrayHost]::Start() } catch {} }
      'tray' { $t = '[]'; try { $t = [TrayHost]::List() } catch {}; $out.WriteLine('{"reply":"tray","data":' + $t + '}'); $out.Flush() }
      'trayclick' { try { [void][TrayHost]::Click($a[1], $a[2]) } catch {} }
      'vdnew' { try { $id = [HavenVD.VD]::MoveToNew([long]$a[1]); Reply 'vd' @{ ok = $true; id = $id } } catch { Reply 'vd' @{ ok = $false; error = "$($_.Exception.Message)" } } }
      'vdclean' { try { $null = [HavenVD.VD]::RemoveIfEmpty($a[1]) } catch {} }
      'vdhome' { try { [HavenVD.VD]::MoveHome([long]$a[1]) } catch {}; Reply 'vdhome' $true }
    }
    $fast = $true
  }
  if ($tick % 3 -eq 0) { $lastMedia = Get-Media }
  if ($tick % 4 -eq 0) { $noteCount = Get-NoteCount }
  $line = '{"windows":' + [HavenSys]::Windows() + ',"desktops":' + (ConvertTo-Json (Get-Desktops) -Compress -Depth 4) + ',"volume":' + [HavenSys]::Volume() + ',"notes":' + [int]$noteCount + ',"media":' + $(if ($lastMedia) { ConvertTo-Json $lastMedia -Compress } else { 'null' }) + '}'
  $out.WriteLine($line); $out.Flush()
  $tick++
  for ($i = 0; $i -lt 10 -and $queue.IsEmpty; $i++) { Start-Sleep -Milliseconds 60 }
}
