param(
  [Parameter(Mandatory = $true)][string]$Deck,
  [Parameter(Mandatory = $true)][string]$Frame,
  [Parameter(Mandatory = $true)][string]$Image,
  [string]$Image2,
  [string]$Title,
  [int]$After = 0,
  [int]$Onto = 0,
  [switch]$Replace,
  [string]$Layout
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'match-presentation.ps1')
. (Join-Path $PSScriptRoot 'insert-checks.ps1')
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$frames = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'frames.json') | ConvertFrom-Json
$frameNames = @($frames.PSObject.Properties | ForEach-Object { $_.Name })
$known = @($frameNames | Where-Object { $_ -ieq $Frame })
if ($known.Count -ne 1) { throw "Unknown frame '$Frame'. Valid frames: $($frameNames -join ', ')." }
$Frame = $known[0]
$f = $frames.$Frame
if (($After -gt 0) -eq ($Onto -gt 0)) { throw 'Pass exactly one of -After N or -Onto N.' }
if ($f.titled -and [string]::IsNullOrWhiteSpace($Title)) { throw "The $Frame frame needs -Title (the takeaway in the navy bar). Ask the user for it; never draft one." }
if ((-not $f.titled) -and $Title) { throw 'The full frame has no title bar; drop -Title.' }
$images = @($Image); if ($Image2) { $images += $Image2 }
if ($images.Count -ne @($f.place).Count) { throw "The $Frame frame takes $(@($f.place).Count) image(s)." }

# Nothing under the repo's charts/ is read or written (the scripts/slides invariant in CLAUDE.md).
for ($k = 0; $k -lt $images.Count; $k++) {
  if (-not (Test-Path -LiteralPath $images[$k])) { throw "Image not found: $($images[$k])" }
  $images[$k] = (Resolve-Path -LiteralPath $images[$k]).Path
  Assert-OutsideArchive $images[$k] $repoRoot
  Assert-OutsideArchive (Join-Path (Split-Path -Parent $images[$k]) 'source.json') $repoRoot
}
$deckPath = (Resolve-Path -LiteralPath $Deck).Path
$bdir = Join-Path (Split-Path -Parent $deckPath) 'Slide charts\_backups'
Assert-OutsideArchive $deckPath $repoRoot
Assert-OutsideArchive $bdir $repoRoot

# Each image must have been rendered for this frame: AddPicture forces the slot's width and height,
# so a render for another frame would be squashed or stretched.
$alts = @()
for ($k = 0; $k -lt $images.Count; $k++) {
  $i = $images[$k]
  $sj = Join-Path (Split-Path -Parent $i) 'source.json'
  if (-not (Test-Path -LiteralPath $sj)) { throw "No source.json beside $i. Render it with render-slide.mjs first." }
  $src = Get-Content -Raw -Encoding UTF8 -LiteralPath $sj | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace($src.alt_text)) { throw "source.json beside $i has no alt_text. Re-render it with render-slide.mjs." }
  $place = @($f.place)[$k]
  $why = Get-FrameMismatch (Split-Path -Leaf $i) ([string]$src.frame) $Frame (Get-PngSize $i) $place
  if ($why) { throw $why }
  $alts += $src.alt_text
}

# Pictures the chart replaces: msoPicture (13), msoLinkedPicture (11), and picture-filled placeholders.
function Get-SlidePictures($slide) {
  $out = @()
  foreach ($s in @($slide.Shapes)) {
    $hit = ($s.Type -eq 13 -or $s.Type -eq 11)
    if ((-not $hit) -and $s.Type -eq 14) { try { if ($s.PlaceholderFormat.ContainedType -eq 13) { $hit = $true } } catch { } }
    if ($hit) { $out += $s }
  }
  return , $out
}
function Test-HasTitlePlaceholder($shapes) {
  foreach ($s in @($shapes)) {
    if ($s.Type -eq 14) { try { $t = $s.PlaceholderFormat.Type; if ($t -eq 1 -or $t -eq 3) { return $true } } catch { } }
  }
  return $false
}

# OneDrive records each synced root (local MountPoint <-> https UrlNamespace) in the registry.
function Get-OneDriveMappings {
  $out = @()
  $root = 'HKCU:\Software\SyncEngines\Providers\OneDrive'
  if (-not (Test-Path -LiteralPath $root)) { return , $out }
  foreach ($k in @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
    $v = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
    if ($v -and $v.MountPoint -and $v.UrlNamespace) { $out += [pscustomobject]@{ MountPoint = [string]$v.MountPoint; UrlNamespace = [string]$v.UrlNamespace } }
  }
  return , $out
}

$started = $false
try { $pp = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') }
catch { $pp = New-Object -ComObject PowerPoint.Application; $started = $true }
$pres = $null; $openedHere = $false
try {
  $pres = Select-OpenPresentation -Candidates @($pp.Presentations) -DeckPath $deckPath -Mappings (Get-OneDriveMappings)
  if (-not $pres) { $pres = $pp.Presentations.Open($deckPath, $false, $false, $false); $openedHere = $true }
  if ([math]::Abs($pres.PageSetup.SlideWidth - 960) -gt 1 -or [math]::Abs($pres.PageSetup.SlideHeight - 540) -gt 1) {
    throw 'This deck is not 16:9 (13.333 x 7.5 in). Only TBL 16:9 decks are supported.'
  }

  # Every refusal comes before any mutation or backup.
  $cl = $null; $slide = $null; $pics = @()
  if ($After -gt 0) {
    if ($After -gt $pres.Slides.Count) { throw "The deck has $($pres.Slides.Count) slides; -After $After is past the end." }
    $layoutName = $f.layout; if ($Layout) { $layoutName = $Layout }
    foreach ($d in @($pres.Designs)) { foreach ($l in @($d.SlideMaster.CustomLayouts)) { if ((-not $cl) -and $l.Name -eq $layoutName) { $cl = $l } } }
    if (-not $cl) {
      $names = @(); foreach ($d in @($pres.Designs)) { foreach ($l in @($d.SlideMaster.CustomLayouts)) { $names += $l.Name } }
      throw "Layout '$layoutName' is not in this deck. Available: $($names -join ', '). Pass -Layout."
    }
    if ($f.titled -and -not (Test-HasTitlePlaceholder $cl.Shapes)) { throw "Layout '$layoutName' has no title placeholder, and the $Frame frame needs one. Pass -Layout." }
  } else {
    if ($Onto -gt $pres.Slides.Count) { throw "The deck has $($pres.Slides.Count) slides; there is no slide $Onto." }
    $slide = $pres.Slides.Item($Onto)
    $pics = Get-SlidePictures $slide
    if ($pics.Count -gt 0 -and -not $Replace) { throw "Slide $Onto already has $($pics.Count) picture(s). Pass -Replace to swap them." }
    if ($f.titled -and -not $slide.Shapes.HasTitle) { throw "Slide $Onto has no title placeholder, and the $Frame frame needs one." }
  }

  New-Item -ItemType Directory -Force -Path $bdir | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = Join-Path $bdir ('{0}-{1}.pptx' -f [IO.Path]::GetFileNameWithoutExtension($deckPath), $stamp)
  $pres.SaveCopyAs($backup)

  $added = $null; $deleted = 0
  try {
    if ($After -gt 0) {
      $slide = $pres.Slides.AddSlide($After + 1, $cl)
      $added = $slide
      try { $slide.HeadersFooters.SlideNumber.Visible = $pres.Slides.Item($After).HeadersFooters.SlideNumber.Visible } catch { }
    } else {
      foreach ($s in $pics) { $s.Delete(); $deleted++ }
    }
    if ($f.titled) { $slide.Shapes.Title.TextFrame.TextRange.Text = $Title }
    for ($k = 0; $k -lt $images.Count; $k++) {
      $g = @($f.place)[$k]
      $pic = $slide.Shapes.AddPicture($images[$k], 0, -1, $g.left, $g.top, $g.width, $g.height)
      $pic.AlternativeText = $alts[$k]
      $pic.Name = "Slide chart $($k + 1)"
    }
  } catch {
    $reason = $_.Exception.Message
    $removed = $false
    if ($added) { try { $added.Delete(); $removed = $true } catch { } }
    throw (Get-InsertFailureMessage -Stage edit -After $After -Onto $Onto -OpenedHere $openedHere -Added ($null -ne $added) -Removed $removed -Deleted $deleted -Backup $backup -Reason $reason)
  }
  try { $pres.Save() }
  catch {
    throw (Get-InsertFailureMessage -Stage save -After $After -Onto $Onto -OpenedHere $openedHere -Added ($null -ne $added) -Deleted $deleted -Backup $backup -Reason $_.Exception.Message)
  }
  # The insert is saved; a QA export failure warns and does not roll it back.
  $qa = $null
  try {
    $qa = Join-Path $env:TEMP ('slide-charts-qa-{0}-{1}.png' -f $slide.SlideIndex, $stamp)
    $slide.Export($qa, 'PNG', 1600, 900)
  } catch { Write-Warning "QA export failed (the insert is saved): $($_.Exception.Message)"; $qa = $null }
  [pscustomobject]@{ slide = $slide.SlideIndex; slides = $pres.Slides.Count; backup = $backup; qa = $qa } | ConvertTo-Json
} finally {
  if ($openedHere -and $pres) { try { $pres.Close() } catch { } }
  if ($started) { try { if ($pp.Presentations.Count -eq 0) { $pp.Quit() } } catch { } }
}
