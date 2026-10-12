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
  $alts += (Get-Content -Raw -Encoding UTF8 -LiteralPath $sj | ConvertFrom-Json).alt_text
}
$deckPath = (Resolve-Path -LiteralPath $Deck).Path
$leaf = Split-Path -Leaf $deckPath

$started = $false
try { $pp = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') }
catch { $pp = New-Object -ComObject PowerPoint.Application; $started = $true }
$pres = $null; $openedHere = $false
foreach ($p in @($pp.Presentations)) {
  if ($p.FullName -eq $deckPath -or ($p.FullName -like 'http*' -and $p.Name -eq $leaf)) { $pres = $p }
}
if (-not $pres) { $pres = $pp.Presentations.Open($deckPath, $false, $false, $false); $openedHere = $true }
try {
  if ([math]::Abs($pres.PageSetup.SlideWidth - 960) -gt 1 -or [math]::Abs($pres.PageSetup.SlideHeight - 540) -gt 1) {
    throw 'This deck is not 16:9 (13.333 x 7.5 in). Only TBL 16:9 decks are supported.'
  }
  $bdir = Join-Path (Split-Path -Parent $deckPath) 'Slide charts\_backups'
  New-Item -ItemType Directory -Force -Path $bdir | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = Join-Path $bdir ('{0}-{1}.pptx' -f [IO.Path]::GetFileNameWithoutExtension($deckPath), $stamp)
  $pres.SaveCopyAs($backup)

  if ($After -gt 0) {
    if ($After -gt $pres.Slides.Count) { throw "The deck has $($pres.Slides.Count) slides; -After $After is past the end." }
    $layoutName = $f.layout; if ($Layout) { $layoutName = $Layout }
    $cl = $null
    foreach ($d in @($pres.Designs)) { foreach ($l in @($d.SlideMaster.CustomLayouts)) { if ((-not $cl) -and $l.Name -eq $layoutName) { $cl = $l } } }
    if (-not $cl) {
      $names = @(); foreach ($d in @($pres.Designs)) { foreach ($l in @($d.SlideMaster.CustomLayouts)) { $names += $l.Name } }
      throw "Layout '$layoutName' is not in this deck. Available: $($names -join ', '). Pass -Layout."
    }
    $slide = $pres.Slides.AddSlide($After + 1, $cl)
    try { $slide.HeadersFooters.SlideNumber.Visible = $pres.Slides.Item($After).HeadersFooters.SlideNumber.Visible } catch { }
  } else {
    if ($Onto -gt $pres.Slides.Count) { throw "The deck has $($pres.Slides.Count) slides; there is no slide $Onto." }
    $slide = $pres.Slides.Item($Onto)
    $pics = @(); foreach ($s in @($slide.Shapes)) { if ($s.Type -eq 13) { $pics += $s } }
    if ($pics.Count -gt 0 -and -not $Replace) { throw "Slide $Onto already has $($pics.Count) picture(s). Pass -Replace to swap them." }
    foreach ($s in $pics) { $s.Delete() }
  }
  if ($f.titled) {
    if (-not $slide.Shapes.HasTitle) { throw "That slide has no title placeholder, and the $Frame frame needs one." }
    $slide.Shapes.Title.TextFrame.TextRange.Text = $Title
  }
  for ($k = 0; $k -lt $images.Count; $k++) {
    $g = @($f.place)[$k]
    $pic = $slide.Shapes.AddPicture((Resolve-Path -LiteralPath $images[$k]).Path, 0, -1, $g.left, $g.top, $g.width, $g.height)
    $pic.AlternativeText = $alts[$k]
    $pic.Name = "Slide chart $($k + 1)"
  }
  $pres.Save()
  $qa = Join-Path $env:TEMP ('slide-charts-qa-{0}-{1}.png' -f $slide.SlideIndex, $stamp)
  $slide.Export($qa, 'PNG', 1600, 900)
  [pscustomobject]@{ slide = $slide.SlideIndex; slides = $pres.Slides.Count; backup = $backup; qa = $qa } | ConvertTo-Json
} finally {
  if ($openedHere) { $pres.Close() }
  if ($started -and $pp.Presentations.Count -eq 0) { try { $pp.Quit() } catch { } }
}
