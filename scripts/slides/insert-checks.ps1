# Pure checks for insert-slide.ps1 (no COM, no registry), unit-tested by test-insert-checks.ps1.

# The archive guard resolves paths through junctions and symlinks by walking each existing
# component with Get-Item (nothing compiled). It fails closed: a link whose target can't be read
# refuses the path instead of falling back to the lexical one.
$script:SlideChartsTagCache = @{}

# The reparse tag of an existing entry, read by fsutil; throws if it can't be read.
function Get-ReparseTag([string]$Path) {
  if ($script:SlideChartsTagCache.ContainsKey($Path)) { return $script:SlideChartsTagCache[$Path] }
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = (& fsutil.exe reparsepoint query $Path 2>&1 | Out-String); $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prev }
  if ($code -ne 0 -or $out -notmatch '0x([0-9a-fA-F]{8})') { throw "fsutil could not read the reparse tag of $Path" }
  $tag = [Convert]::ToUInt32($Matches[1], 16)
  $script:SlideChartsTagCache[$Path] = $tag
  return $tag
}

# Default link resolver for an existing reparse point: the full path a junction or symlink points
# at, or $null for a reparse point that is not a link. OneDrive files and folders are reparse
# points with cloud tags, so only the name-surrogate bit (0x20000000, set on every tag that
# redirects a path) makes an unrecognised one a link. Throws when the target can't be determined.
function Get-LinkTarget([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  $type = [string]$item.LinkType
  if ($type -eq 'Junction' -or $type -eq 'SymbolicLink') {
    $t = [string](@($item.Target | Where-Object { $_ }) | Select-Object -First 1)
    if (-not $t) { throw "the $type at $Path has no readable target" }
    if ($t -match 'Volume\{') { throw "the $type at $Path points at a volume ($t)" }
    if (-not [IO.Path]::IsPathRooted($t)) { $t = [IO.Path]::Combine((Split-Path -Parent $Path), $t) }
    return [IO.Path]::GetFullPath($t)
  }
  if ((Get-ReparseTag $Path) -band 0x20000000) { throw "$Path is a link PowerShell can't resolve" }
  return $null
}

# paths.mjs realish: the path with every existing component resolved through links, plus the
# components that don't exist yet as written. $LinkTarget replaces Get-LinkTarget (tests inject one).
function Resolve-RealishPath([string]$Path, [scriptblock]$LinkTarget) {
  if (-not $LinkTarget) { $LinkTarget = ${function:Get-LinkTarget} }
  $full = [IO.Path]::GetFullPath($Path)
  for ($hop = 0; $hop -lt 40; $hop++) {
    $root = [IO.Path]::GetPathRoot($full)
    $parts = @($full.Substring($root.Length).Split([char]'\') | Where-Object { $_ })
    $cur = $root
    $redirect = $null
    $i = 0
    for (; $i -lt $parts.Count; $i++) {
      if (-not [IO.Directory]::Exists($cur)) { break }
      $entry = @(([IO.DirectoryInfo]::new($cur)).GetFileSystemInfos($parts[$i])) | Select-Object -First 1
      if (-not $entry) { break }
      $next = [IO.Path]::Combine($cur, $entry.Name)
      if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        $t = & $LinkTarget $next
        if ($t) {
          $redirect = $t
          if ($i + 1 -lt $parts.Count) { $redirect = [IO.Path]::Combine($t, ($parts[($i + 1)..($parts.Count - 1)] -join '\')) }
          break
        }
      }
      $cur = $next
    }
    if ($null -eq $redirect) {
      if ($i -lt $parts.Count) { return [IO.Path]::Combine($cur, ($parts[$i..($parts.Count - 1)] -join '\')) }
      return $cur
    }
    $full = [IO.Path]::GetFullPath($redirect)
  }
  throw "more than 40 links resolving $Path"
}

# True when $Path is the repo's charts/ folder or inside it: case-insensitive, on path-segment
# boundaries, after `..` and `/` normalisation. Both the path and charts/ are compared as written
# and as resolved through links, so a link either way round is caught. Throws if a link on either
# path can't be resolved.
function Test-InsideArchive([string]$Path, [string]$RepoRoot, [scriptblock]$LinkTarget) {
  $charts = [IO.Path]::Combine([IO.Path]::GetFullPath($RepoRoot), 'charts')
  $roots = @($charts, (Resolve-RealishPath $charts $LinkTarget))
  $paths = @([IO.Path]::GetFullPath($Path), (Resolve-RealishPath $Path $LinkTarget))
  foreach ($r in $roots) {
    $r = $r.TrimEnd('\')
    foreach ($p in $paths) {
      $p = $p.TrimEnd('\')
      if ($p -ieq $r -or $p.StartsWith($r + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
  }
  return $false
}

function Assert-OutsideArchive([string]$Path, [string]$RepoRoot, [scriptblock]$LinkTarget) {
  $inside = $false
  try { $inside = Test-InsideArchive $Path $RepoRoot $LinkTarget }
  catch { throw "Refusing ${Path}: can't verify this path is outside the archive (charts/): $($_.Exception.Message)" }
  if ($inside) {
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
