param(
  [string]$Template = "$env:USERPROFILE\OneDrive - Yale University\Documents\Budget Lab Sharepoint\Templates\Budget Lab Slides Template A (16x9 aspect) - Preferred.pptx"
)
# Smoke test for insert-slide.ps1. Drives PowerPoint through COM: close real decks first.
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Template)) { Write-Host "SKIP: template not found: $Template"; exit 0 }

$insert = Join-Path $PSScriptRoot 'insert-slide.ps1'
$script:qas = @()
$root = Join-Path $env:TEMP 'slide-charts-test'
$deckDir = Join-Path $root "Budget Lab Sharepoint\O'Neil $([char]0x2014) deck"
$deck = Join-Path $deckDir 'deck.pptx'
$sc = Join-Path $deckDir 'Slide charts'
$tpl43 = Join-Path (Split-Path -Parent $Template) 'Budget Lab Slides Template A (4x3 aspect).pptx'

Add-Type -AssemblyName System.Drawing
function New-Png([string]$path, [int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(230, 238, 245))
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
function New-Fixture([string]$name, [int]$w, [int]$h, [string]$alt) {
  $d = Join-Path $sc $name
  New-Item -ItemType Directory -Force -Path $d | Out-Null
  New-Png (Join-Path $d "$name.png") $w $h
  $json = (@{ alt_text = $alt } | ConvertTo-Json)
  [IO.File]::WriteAllText((Join-Path $d 'source.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
  return (Join-Path $d "$name.png")
}
function Fail([string]$case, [string]$msg) { throw "FAIL case ${case}: $msg" }
function Check([string]$case, [bool]$ok, [string]$msg) { if (-not $ok) { Fail $case $msg } }
function Near([double]$a, [double]$b) { return ([math]::Abs($a - $b) -le 0.5) }

# Runs insert-slide.ps1 in a child shell. Returns @{ code; out; err }.
function Run-Insert([string[]]$argList) {
  $errFile = Join-Path $env:TEMP 'slide-charts-test-stderr.txt'
  if (Test-Path -LiteralPath $errFile) { Remove-Item -LiteralPath $errFile -Force }
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $out = & powershell -NoProfile -File $insert @argList 2>$errFile
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  $err = ''
  if (Test-Path -LiteralPath $errFile) { $err = [IO.File]::ReadAllText($errFile) }
  return @{ code = $code; out = (($out | Out-String).Trim()); err = $err }
}
function Expect-Throw([string]$case, [string[]]$argList, [string]$pattern) {
  $r = Run-Insert $argList
  Check $case ($r.code -ne 0) 'expected a refusal but the script succeeded'
  Check $case (($r.err + $r.out) -match $pattern) "refusal did not match '$pattern': $($r.err)"
}
function Expect-Ok([string]$case, [string[]]$argList) {
  $r = Run-Insert $argList
  Check $case ($r.code -eq 0) "script failed: $($r.err) $($r.out)"
  $j = $r.out | ConvertFrom-Json
  if ($j.qa) { $script:qas += $j.qa }
  return $j
}
function Slide-Info($slide) {
  $pics = @(); foreach ($s in @($slide.Shapes)) { if ($s.Type -eq 13) { $pics += $s } }
  $title = $null; if ($slide.Shapes.HasTitle) { $title = $slide.Shapes.Title.TextFrame.TextRange.Text }
  $num = $null; try { $num = [bool]$slide.HeadersFooters.SlideNumber.Visible } catch { }
  return @{ pics = $pics; title = $title; num = $num }
}

$started = $false
try { $pp = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') }
catch { $pp = New-Object -ComObject PowerPoint.Application; $started = $true }
$opened = @()
try {
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $deckDir | Out-Null
  Copy-Item -LiteralPath $Template -Destination $deck
  $a = New-Fixture 'a' 1280 618 'Alt text for chart A'
  $b = New-Fixture 'b' 640 618 'Alt text for chart B'

  # Inspect the saved deck read-only, without a window, unless the test has it open.
  function Inspect([scriptblock]$body) {
    $p = $pp.Presentations.Open($deck, -1, 0, 0)
    try { return (& $body $p) } finally { $p.Close() }
  }

  # Set slide 1's slide-number visibility to the OPPOSITE of what a new below-title slide gets from
  # its layout, so the copy from slide 1 is actually exercised. The layout default is read from a
  # throwaway slide that is deleted again.
  $p0 = $pp.Presentations.Open($deck, 0, 0, 0)
  try {
    $cl0 = $null
    foreach ($d in @($p0.Designs)) { foreach ($l in @($d.SlideMaster.CustomLayouts)) { if ((-not $cl0) -and $l.Name -eq '1_Title - no content') { $cl0 = $l } } }
    Check 'setup' ($null -ne $cl0) 'layout "1_Title - no content" not found in the template'
    $tmp = $p0.Slides.AddSlide($p0.Slides.Count + 1, $cl0)
    $layoutDefault = [bool]$tmp.HeadersFooters.SlideNumber.Visible
    $tmp.Delete()
    $p0.Slides.Item(1).HeadersFooters.SlideNumber.Visible = -not $layoutDefault
    $p0.Save()
  } finally { $p0.Close() }
  $before = Inspect { param($p) @{ n = $p.Slides.Count; num1 = (Slide-Info $p.Slides.Item(1)).num } }
  Check '1' ($null -ne $before.num1) 'slide 1 slide-number visibility could not be read'
  Check '1' ($before.num1 -ne $layoutDefault) "slide 1 visibility $($before.num1) was not set opposite to the layout default $layoutDefault"

  # Case 1
  $r = Expect-Ok '1' @('-Deck', $deck, '-Frame', 'below-title', '-Image', $a, '-Title', 'T1', '-After', '1')
  Check '1' ($r.slides -eq $before.n + 1) "slide count $($r.slides), expected $($before.n + 1)"
  Check '1' ($r.slide -eq 2) "new slide index $($r.slide), expected 2"
  $info = Inspect { param($p)
    $i = Slide-Info $p.Slides.Item(2)
    $pic = $i.pics[0]
    @{ n = $p.Slides.Count; title = $i.title; num = $i.num; count = $i.pics.Count
       l = $pic.Left; t = $pic.Top; w = $pic.Width; h = $pic.Height; alt = $pic.AlternativeText }
  }
  Check '1' ($info.n -eq $before.n + 1) "independent slide count $($info.n), expected $($before.n + 1)"
  Check '1' ($info.title -eq 'T1') "title '$($info.title)'"
  Check '1' ($info.count -eq 1) "picture count $($info.count)"
  Check '1' ((Near $info.l 0) -and (Near $info.t 76.707) -and (Near $info.w 960) -and (Near $info.h 463.5)) "picture at ($($info.l), $($info.t), $($info.w), $($info.h))"
  Check '1' ($info.alt -eq 'Alt text for chart A') "alt text '$($info.alt)'"
  Check '1' (@(Get-ChildItem -LiteralPath (Join-Path $sc '_backups') -Filter '*.pptx').Count -ge 1) 'no backup in Slide charts\_backups'
  Check '1' (Test-Path -LiteralPath $r.qa) "QA PNG missing: $($r.qa)"
  Check '1' ($null -ne $info.num) 'new slide slide-number visibility could not be read'
  Check '1' ($info.num -eq $before.num1) "slide-number visibility $($info.num) differs from slide 1 ($($before.num1))"
  Check '1' ($info.num -ne $layoutDefault) "inserted slide kept the layout default $layoutDefault, so the copy from slide 1 is unproven"
  Check '1' (Test-Path -LiteralPath $r.backup) "backup missing: $($r.backup)"
  $pb = $pp.Presentations.Open($r.backup, -1, 0, 0)
  try { $bn = $pb.Slides.Count } finally { $pb.Close() }
  Check '1' ($bn -eq $before.n) "backup has $bn slides, expected the pre-insert count $($before.n)"

  # Case 2
  Expect-Throw '2' @('-Deck', $deck, '-Frame', 'below-title', '-Image', $a, '-Title', 'T2', '-Onto', '2') 'already has'

  # Case 3
  $r = Expect-Ok '3' @('-Deck', $deck, '-Frame', 'below-title', '-Image', $a, '-Title', 'T2', '-Onto', '2', '-Replace')
  $info = Inspect { param($p) $i = Slide-Info $p.Slides.Item(2); @{ title = $i.title; count = $i.pics.Count } }
  Check '3' ($info.count -eq 1) "picture count after -Replace is $($info.count)"
  Check '3' ($info.title -eq 'T2') "title '$($info.title)'"

  # Case 4
  $r = Expect-Ok '4' @('-Deck', $deck, '-Frame', 'half', '-Image', $a, '-Image2', $b, '-Title', 'Two-up', '-After', '2')
  $info = Inspect { param($p)
    $i = Slide-Info $p.Slides.Item(3)
    $o = @(); foreach ($pic in $i.pics) { $o += , @($pic.Left, $pic.Top, $pic.Width, $pic.Height, $pic.AlternativeText) }
    @{ count = $i.pics.Count; pos = $o; title = $i.title }
  }
  Check '4' ($info.count -eq 2) "picture count $($info.count)"
  Check '4' ($info.title -eq 'Two-up') "title '$($info.title)'"
  $want = @(@(0, 76.707, 480, 463.5), @(480, 76.707, 480, 463.5))
  for ($k = 0; $k -lt 2; $k++) {
    $got = $null
    foreach ($p in $info.pos) { if (Near $p[0] $want[$k][0]) { $got = $p } }
    Check '4' ($null -ne $got) "no picture at left $($want[$k][0])"
    Check '4' ((Near $got[1] $want[$k][1]) -and (Near $got[2] $want[$k][2]) -and (Near $got[3] $want[$k][3])) "half placement $k is ($($got -join ', '))"
    $wantAlt = @('Alt text for chart A', 'Alt text for chart B')[$k]
    Check '4' ($got[4] -eq $wantAlt) "picture $k (left $($want[$k][0])) has alt '$($got[4])', expected '$wantAlt' (image a left, b right)"
  }

  # Case 5
  Expect-Throw '5a' @('-Deck', $deck, '-Frame', 'half', '-Image', $a, '-Title', 'x', '-After', '1') 'takes 2 image'
  Expect-Throw '5b' @('-Deck', $deck, '-Frame', 'below-title', '-Image', $a, '-After', '1') 'needs -Title'
  Expect-Throw '5c' @('-Deck', $deck, '-Frame', 'full', '-Image', $a, '-Title', 'x', '-After', '1') 'no title bar'

  # Case 6: deck already open with a window
  $open = $pp.Presentations.Open($deck, 0, 0, -1)
  $opened += $open
  $n0 = $pp.Presentations.Count
  $s0 = $open.Slides.Count
  $r = Expect-Ok '6' @('-Deck', $deck, '-Frame', 'below-title', '-Image', $a, '-Title', 'T6', '-After', '1')
  Check '6' ($pp.Presentations.Count -eq $n0) "Presentations.Count grew from $n0 to $($pp.Presentations.Count)"
  Check '6' ($open.Slides.Count -eq $s0 + 1) "open presentation has $($open.Slides.Count) slides, expected $($s0 + 1)"
  Check '6' ((Slide-Info $open.Slides.Item(2)).title -eq 'T6') 'open presentation slide 2 is not the new slide'
  $open.Close()
  $opened = @()

  # Case 7: 4:3 deck
  if (Test-Path -LiteralPath $tpl43) {
    $deck43 = Join-Path $deckDir 'deck43.pptx'
    Copy-Item -LiteralPath $tpl43 -Destination $deck43
    Expect-Throw '7' @('-Deck', $deck43, '-Frame', 'below-title', '-Image', $a, '-Title', 'T7', '-After', '1') '16:9'
  } else {
    Write-Host "SKIP case 7: 4x3 template not found: $tpl43"
  }

  Write-Host 'PASS: all insert-slide cases'
} finally {
  foreach ($o in $opened) { try { $o.Close() } catch { } }
  if ($started) { try { if ($pp.Presentations.Count -eq 0) { $pp.Quit() } } catch { } }
  foreach ($q in $script:qas) { try { Remove-Item -LiteralPath $q -Force -ErrorAction Stop } catch { Write-Warning "could not remove QA PNG ${q}: $($_.Exception.Message)" } }
  $ef = Join-Path $env:TEMP 'slide-charts-test-stderr.txt'
  if (Test-Path -LiteralPath $ef) { try { Remove-Item -LiteralPath $ef -Force -ErrorAction Stop } catch { Write-Warning "could not remove ${ef}: $($_.Exception.Message)" } }
  if (Test-Path -LiteralPath $root) { try { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop } catch { Write-Warning "could not remove temp tree ${root}: $($_.Exception.Message)" } }
}
