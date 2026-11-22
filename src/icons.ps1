param([string]$List, [string]$Out)
# Extracts high-resolution (256px "jumbo") shell icons for files, shortcuts and Store apps.
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class HavenIcons {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct SHFILEINFO { public IntPtr hIcon; public int iIcon; public uint dwAttributes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName; }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SHGetFileInfo(string p, uint a, ref SHFILEINFO i, uint s, uint f);
  [DllImport("shell32.dll")] static extern IntPtr SHGetFileInfo(IntPtr pidl, uint a, ref SHFILEINFO i, uint s, uint f);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHParseDisplayName(string name, IntPtr bc, out IntPtr pidl, uint sfgao, out uint psfgao);
  [DllImport("shell32.dll", EntryPoint = "#727")] static extern int SHGetImageList(int i, ref Guid riid, out IntPtr ppv);
  [DllImport("comctl32.dll")] static extern IntPtr ImageList_GetIcon(IntPtr himl, int i, int flags);
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);
  [DllImport("ole32.dll")] static extern void CoTaskMemFree(IntPtr p);

  static Rectangle Bounds(Bitmap b) {
    int minX = b.Width, minY = b.Height, maxX = -1, maxY = -1;
    for (int y = 0; y < b.Height; y++) for (int x = 0; x < b.Width; x++)
      if (b.GetPixel(x, y).A > 8) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
    return maxX < 0 ? Rectangle.Empty : Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
  }

  static int Index(string path) {
    SHFILEINFO sfi = new SHFILEINFO();
    const uint SYSICONINDEX = 0x4000, PIDL = 0x8;
    if (path.StartsWith("shell:", StringComparison.OrdinalIgnoreCase)) {
      IntPtr pidl; uint o;
      if (SHParseDisplayName(path, IntPtr.Zero, out pidl, 0, out o) != 0) return -1;
      SHGetFileInfo(pidl, 0, ref sfi, (uint)Marshal.SizeOf(sfi), SYSICONINDEX | PIDL);
      CoTaskMemFree(pidl);
    } else {
      if (SHGetFileInfo(path, 0, ref sfi, (uint)Marshal.SizeOf(sfi), SYSICONINDEX) == IntPtr.Zero) return -1;
    }
    return sfi.iIcon;
  }

  static Bitmap Get(int list, int idx) {
    Guid iid = new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");
    IntPtr himl;
    if (SHGetImageList(list, ref iid, out himl) != 0 || himl == IntPtr.Zero) return null;
    IntPtr h = ImageList_GetIcon(himl, idx, 0x1);
    if (h == IntPtr.Zero) return null;
    Bitmap bmp;
    using (Icon ic = Icon.FromHandle(h)) bmp = ic.ToBitmap();
    DestroyIcon(h);
    return bmp;
  }

  public static bool Save(string path, string outFile) {
    int idx = Index(path);
    if (idx < 0) return false;
    Bitmap jumbo = Get(4, idx);
    if (jumbo != null) {
      Rectangle r = Bounds(jumbo);
      if (r.Width > 72 || r.Height > 72) { jumbo.Save(outFile, ImageFormat.Png); jumbo.Dispose(); return true; }
      jumbo.Dispose();
    }
    Bitmap xl = Get(2, idx);
    if (xl == null) return false;
    xl.Save(outFile, ImageFormat.Png); xl.Dispose();
    return true;
  }
}
"@
foreach ($line in [IO.File]::ReadAllLines($List)) {
  $parts = $line -split "`t", 2
  if ($parts.Count -lt 2) { continue }
  try { [void][HavenIcons]::Save($parts[1], (Join-Path $Out ($parts[0] + '.png'))) } catch {}
}
