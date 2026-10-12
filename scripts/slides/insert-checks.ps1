# Pure checks for insert-slide.ps1 (no COM, no registry), unit-tested by test-insert-checks.ps1.

# Final path of an existing file or folder, through junctions and symlinks (the same Win32 call
# Node's realpathSync.native makes). Compiled once per session; if it can't be, links are not
# resolved and the guard falls back to the lexical path alone.
if (-not ('SlideCharts.RealPath' -as [type])) {
  try {
    Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
namespace SlideCharts {
  public static class RealPath {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr sec, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern uint GetFinalPathNameByHandleW(SafeFileHandle h, StringBuilder buf, uint len, uint flags);
    // No access rights, share everything, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS (needed for folders).
    public static string Get(string path) {
      using (SafeFileHandle h = CreateFileW(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
        if (h.IsInvalid) return null;
        StringBuilder sb = new StringBuilder(1024);
        uint n = GetFinalPathNameByHandleW(h, sb, (uint)sb.Capacity, 0);
        if (n >= sb.Capacity) { sb = new StringBuilder((int)n + 1); n = GetFinalPathNameByHandleW(h, sb, (uint)sb.Capacity, 0); }
        if (n == 0 || n >= sb.Capacity) return null;
        string s = sb.ToString();
        if (s.StartsWith(@"\\?\UNC\")) return @"\" + s.Substring(7);
        if (s.StartsWith(@"\\?\")) return s.Substring(4);
        return s;
      }
    }
  }
}
'@
  } catch { }
}

# paths.mjs realish: the deepest existing ancestor resolved through links, plus the rest as written.
function Resolve-RealishPath([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  $probe = $full
  while (-not (Test-Path -LiteralPath $probe)) {
    $up = Split-Path -Parent $probe
    if ([string]::IsNullOrEmpty($up) -or $up -eq $probe) { return $full }
    $probe = $up
  }
  $real = $null
  if ('SlideCharts.RealPath' -as [type]) { try { $real = [SlideCharts.RealPath]::Get($probe) } catch { } }
  if (-not $real) { return $full }
  $rest = $full.Substring($probe.Length).TrimStart('\')
  if ($rest) { return [IO.Path]::Combine($real, $rest) }
  return $real
}

# True when $Path is the repo's charts/ folder or inside it: case-insensitive, on path-segment
# boundaries, after `..` and `/` normalisation. Both the path and charts/ are compared as written
# and as resolved through junctions/symlinks, so a link either way round is caught.
function Test-InsideArchive([string]$Path, [string]$RepoRoot) {
  $charts = [IO.Path]::Combine([IO.Path]::GetFullPath($RepoRoot), 'charts')
  $roots = @($charts, (Resolve-RealishPath $charts))
  $paths = @([IO.Path]::GetFullPath($Path), (Resolve-RealishPath $Path))
  foreach ($r in $roots) {
    $r = $r.TrimEnd('\')
    foreach ($p in $paths) {
      $p = $p.TrimEnd('\')
      if ($p -ieq $r -or $p.StartsWith($r + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
  }
  return $false
}

function Assert-OutsideArchive([string]$Path, [string]$RepoRoot) {
  if (Test-InsideArchive $Path $RepoRoot) {
    throw "Refusing ${Path}: it is inside the published archive (charts/). Slide charts live beside the deck, in `"Slide charts\`"."
  }
}

# Width and height from a PNG's IHDR chunk (bytes 16-23, big-endian), or $null if it isn't a PNG.
function Get-PngSize([string]$Path) {
  $b = [byte[]]::new(24)
  $n = 0
  $fs = [IO.File]::OpenRead($Path)
  try {
    while ($n -lt 24) { $r = $fs.Read($b, $n, 24 - $n); if ($r -le 0) { break }; $n += $r }
  } finally { $fs.Dispose() }
  if ($n -lt 24) { return $null }
  $head = [byte[]](137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82)
  for ($i = 0; $i -lt 8; $i++) { if ($b[$i] -ne $head[$i]) { return $null } }
  for ($i = 12; $i -lt 16; $i++) { if ($b[$i] -ne $head[$i]) { return $null } }
  $w = ([long]$b[16] * 16777216) + ([long]$b[17] * 65536) + ([long]$b[18] * 256) + [long]$b[19]
  $h = ([long]$b[20] * 16777216) + ([long]$b[21] * 65536) + ([long]$b[22] * 256) + [long]$b[23]
  return [pscustomobject]@{ Width = $w; Height = $h }
}

# $null when an image rendered for $RenderedFrame (its source.json frame) and $Size pixels fits the
# $Frame slot $Place without distortion (AddPicture forces width and height); otherwise a one-line
# reason. The aspect tolerance is 0.5%, as in frames.test.mjs.
function Get-FrameMismatch([string]$Name, [string]$RenderedFrame, [string]$Frame, $Size, $Place) {
  $fix = "Re-render it with render-slide.mjs --frame $Frame."
  if ([string]::IsNullOrWhiteSpace($RenderedFrame)) { return "$Name has no frame in its source.json, so it can't be checked against the $Frame frame. $fix" }
  if ($RenderedFrame -cne $Frame) { return "$Name was rendered for the $RenderedFrame frame, not the $Frame frame, and would be distorted. $fix" }
  if (-not $Size -or $Size.Width -le 0 -or $Size.Height -le 0) { return "$Name is not a PNG with a readable size. $fix" }
  $ia = $Size.Width / $Size.Height
  $pa = $Place.width / $Place.height
  if ([math]::Abs($ia - $pa) / $pa -gt 0.005) {
    return ("{0} is {1}x{2} px, which does not fit the {3} frame's {4} x {5} pt slot (its source.json says {6}, the -Frame is {3}). {7}" -f $Name, $Size.Width, $Size.Height, $Frame, $Place.width, $Place.height, $RenderedFrame, $fix)
  }
  return $null
}

# The one message for a failed insert. Stage 'edit' is any failure while changing the slide; 'save'
# is $pres.Save() failing after the edits succeeded. $OpenedHere: the script opened the deck itself
# (and closes it without saving), as opposed to editing the copy open in the user's PowerPoint.
# $Deleted: pictures already deleted from slide $Onto (-Onto mode).
function Get-InsertFailureMessage {
  param(
    [ValidateSet('edit', 'save')][string]$Stage,
    [int]$After = 0,
    [int]$Onto = 0,
    [bool]$OpenedHere = $false,
    [bool]$Added = $false,
    [bool]$Removed = $false,
    [int]$Deleted = 0,
    [string]$Backup,
    [string]$Reason
  )
  $pics = 'picture is'; if ($Deleted -ne 1) { $pics = 'pictures are' }
  if ($Stage -eq 'save') {
    if ($OpenedHere) { return "Insert failed while saving: $Reason. The deck file was not saved; the original is backed up at $Backup" }
    $what = 'The edits remain unsaved in your open PowerPoint window'
    if ($Onto -gt 0 -and $Deleted -gt 0) { $what += " (slide ${Onto}'s $Deleted earlier $pics already deleted there)" }
    return "Insert failed while saving: $Reason. $what. Save from that window, or close it without saving; the original is backed up at $Backup"
  }
  if ($After -gt 0) {
    if (-not $Added) { return "Insert failed before a slide was added (the deck is unchanged): $Reason" }
    if ($Removed) { return "Insert failed and the added slide was removed (the deck file was not saved): $Reason" }
    if ($OpenedHere) { return "Insert failed and the added slide could not be removed, but the deck file was not saved, so it is unchanged: $Reason" }
    return "Insert failed and the added slide (slide $($After + 1)) could not be removed from the deck open in your PowerPoint window; delete it there, or close the deck without saving. The deck file was not saved; the original is backed up at ${Backup}: $Reason"
  }
  if ($OpenedHere) { return "Insert failed while editing slide $Onto; the deck file was not saved, so it is unchanged: $Reason" }
  $what = "slide $Onto has unsaved edits in your open PowerPoint window"
  if ($Deleted -gt 0) { $what += " (its $Deleted earlier $pics already deleted there)" }
  return "Insert failed while editing slide ${Onto}; $what. Close the deck without saving, or restore it from the backup at ${Backup}: $Reason"
}
