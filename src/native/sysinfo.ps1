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
  $json = if ($what -in 'notes', 'procs') { if ($data -eq $null -or @($data).Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject @($data) -Compress -Depth 5 } }
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
