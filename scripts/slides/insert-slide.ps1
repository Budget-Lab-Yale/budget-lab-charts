param(
  [Parameter(Mandatory = $true)][string]$Deck,
  [Parameter(Mandatory = $true)][ValidateSet('below-title', 'full', 'half')][string]$Frame,
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
$frames = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'frames.json') | ConvertFrom-Json
$f = $frames.$Frame
if (($After -gt 0) -eq ($Onto -gt 0)) { throw 'Pass exactly one of -After N or -Onto N.' }
if ($f.titled -and [string]::IsNullOrWhiteSpace($Title)) { throw "The $Frame frame needs -Title (the takeaway in the navy bar). Ask the user for it; never draft one." }
if ((-not $f.titled) -and $Title) { throw 'The full frame has no title bar; drop -Title.' }
$images = @($Image); if ($Image2) { $images += $Image2 }
if ($images.Count -ne @($f.place).Count) { throw "The $Frame frame takes $(@($f.place).Count) image(s)." }
$alts = @()
foreach ($i in $images) {
  if (-not (Test-Path -LiteralPath $i)) { throw "Image not found: $i" }
  $sj = Join-Path (Split-Path -Parent $i) 'source.json'
  if (-not (Test-Path -LiteralPath $sj)) { throw "No source.json beside $i. Render it with render-slide.mjs first." }
  $alt = (Get-Content -Raw -Encoding UTF8 -LiteralPath $sj | ConvertFrom-Json).alt_text
  if ([string]::IsNullOrWhiteSpace($alt)) { throw "source.json beside $i has no alt_text. Re-render it with render-slide.mjs." }
  $alts += $alt
}
$deckPath = (Resolve-Path -LiteralPath $Deck).Path

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

  $bdir = Join-Path (Split-Path -Parent $deckPath) 'Slide charts\_backups'
  New-Item -ItemType Directory -Force -Path $bdir | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = Join-Path $bdir ('{0}-{1}.pptx' -f [IO.Path]::GetFileNameWithoutExtension($deckPath), $stamp)
  $pres.SaveCopyAs($backup)

  $added = $null; $saved = $false
  try {
    if ($After -gt 0) {
      $slide = $pres.Slides.AddSlide($After + 1, $cl)
      $added = $slide
      try { $slide.HeadersFooters.SlideNumber.Visible = $pres.Slides.Item($After).HeadersFooters.SlideNumber.Visible } catch { }
    } else {
      foreach ($s in $pics) { $s.Delete() }
    }
    if ($f.titled) { $slide.Shapes.Title.TextFrame.TextRange.Text = $Title }
    for ($k = 0; $k -lt $images.Count; $k++) {
      $g = @($f.place)[$k]
      $pic = $slide.Shapes.AddPicture((Resolve-Path -LiteralPath $images[$k]).Path, 0, -1, $g.left, $g.top, $g.width, $g.height)
      $pic.AlternativeText = $alts[$k]
      $pic.Name = "Slide chart $($k + 1)"
    }
    $pres.Save()
    $saved = $true
  } catch {
    $reason = $_.Exception.Message
    if ($saved) {
      if ($openedHere) { throw "Insert failed while saving: $reason. Backup of the original: $backup" }
      throw "Insert failed while saving: $reason. The deck is open in your PowerPoint window with the edits unsaved; the original is backed up at $backup"
    }
    if ($After -gt 0) {
      if ($added) {
        $removed = $false
        try { $added.Delete(); $removed = $true } catch { }
        if ($removed) { throw "Insert failed and the added slide was removed (the deck file was not saved): $reason" }
        throw "Insert failed and the added slide could not be removed; delete it by hand or restore the backup at ${backup}: $reason"
      }
      throw "Insert failed before a slide was added (the deck is unchanged): $reason"
    }
    throw "Insert failed after editing slide $Onto; restore the deck from the backup at ${backup}: $reason"
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
