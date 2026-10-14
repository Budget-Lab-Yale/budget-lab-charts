# COM-free tests for insert-checks.ps1 (archive guard, frame/image fit, failure messages).
# Exits non-zero on failure.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'insert-checks.ps1')

$fail = 0
function Ok([string]$name, [bool]$cond) { if ($cond) { Write-Host "PASS $name" } else { Write-Host "FAIL $name"; $script:fail++ } }
function Throws([string]$name, [scriptblock]$b, [string]$pat) {
  $msg = $null; try { & $b } catch { $msg = $_.Exception.Message }
  Ok $name (($null -ne $msg) -and ($msg -match $pat))
}

# --- Archive guard -------------------------------------------------------------------------------
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$dash = [string][char]0x2014
Ok 'charts\x\deck.pptx is refused' (Test-InsideArchive "$repo\charts\x\deck.pptx" $repo)
Ok 'charts itself is refused' (Test-InsideArchive "$repo\charts" $repo)
Ok 'charts\ with a trailing separator is refused' (Test-InsideArchive "$repo\charts\" $repo)
Ok 'CHARTS (case) is refused' (Test-InsideArchive "$repo\CHARTS\x\deck.pptx" $repo)
Ok '.. traversal is refused' (Test-InsideArchive "$repo\scripts\..\charts\x\deck.pptx" $repo)
Ok 'forward slashes are refused' (Test-InsideArchive ($repo.Replace('\', '/') + '/charts/x/deck.pptx') $repo)
Ok 'a ..foo folder inside charts is refused' (Test-InsideArchive "$repo\charts\..foo\x\deck.pptx" $repo)
Ok 'charts..foo sibling is accepted' (-not (Test-InsideArchive "$repo\charts..foo\deck.pptx" $repo))
Ok 'chartsfoo sibling is accepted' (-not (Test-InsideArchive "$repo\chartsfoo\deck.pptx" $repo))
Ok 'repo root is accepted' (-not (Test-InsideArchive "$repo\deck.pptx" $repo))
$sp = "C:\Users\tester\OneDrive - Yale University\Documents\Budget Lab Sharepoint\O'Neil $dash deck\deck.pptx"
Ok 'SharePoint-style path is accepted' (-not (Test-InsideArchive $sp $repo))
Ok 'SharePoint-style backup dir is accepted' (-not (Test-InsideArchive (Join-Path (Split-Path -Parent $sp) 'Slide charts\_backups') $repo))
Throws 'Assert-OutsideArchive names the archive' { Assert-OutsideArchive "$repo\charts\x\deck.pptx" $repo } 'inside the published archive \(charts/\)'
$okAssert = $true; try { Assert-OutsideArchive $sp $repo } catch { $okAssert = $false }
Ok 'Assert-OutsideArchive passes a SharePoint-style path' $okAssert

# Junctions (no admin needed). The fake repo is a temp tree; junctions are removed with
# [IO.Directory]::Delete before the tree, so the recursive delete never follows one.
$tmp = Join-Path $env:TEMP ("slide-charts-checks-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$fake = Join-Path $tmp 'repo'
New-Item -ItemType Directory -Force -Path (Join-Path $fake 'charts\a') | Out-Null
$links = @()
try {
  $toCharts = Join-Path $tmp 'decks'
  $toRepo = Join-Path $tmp 'repo-link'
  $made = $true
  try {
    New-Item -ItemType Junction -Path $toCharts -Target (Join-Path $fake 'charts') | Out-Null; $links += $toCharts
    New-Item -ItemType Junction -Path $toRepo -Target $fake | Out-Null; $links += $toRepo
  } catch { $made = $false; Write-Host "SKIP junction cases: could not create a junction ($($_.Exception.Message))" }
  if ($made) {
    Ok 'a junction into charts is refused (existing folder)' (Test-InsideArchive (Join-Path $toCharts 'a\deck.pptx') $fake)
    Ok 'a junction into charts is refused (new folder below it)' (Test-InsideArchive (Join-Path $toCharts 'new\Slide charts\_backups') $fake)
    Ok 'charts reached through a junctioned repo root is refused' (Test-InsideArchive (Join-Path $fake 'charts\a\deck.pptx') $toRepo)
    Ok 'the junctioned repo root, outside charts, is accepted' (-not (Test-InsideArchive (Join-Path $toRepo 'deck.pptx') $fake))

    # Fail closed: a resolver that cannot read a link refuses instead of falling back to the
    # lexical path (which, here, is outside the fake charts/).
    $broken = { param($p) throw 'injected resolver failure' }
    Throws 'resolver failure on a junction refuses (Assert)' { Assert-OutsideArchive (Join-Path $toCharts 'a\deck.pptx') $fake -LinkTarget $broken } "can't verify this path is outside the archive"
    Throws 'resolver failure on a junction throws (Test)' { Test-InsideArchive (Join-Path $toCharts 'a\deck.pptx') $fake -LinkTarget $broken } 'injected resolver failure'
    Throws 'resolver failure on a junctioned repo root refuses' { Assert-OutsideArchive (Join-Path $tmp 'elsewhere\deck.pptx') $toRepo -LinkTarget $broken } "can't verify"
    $plain = Join-Path $tmp 'plain\deck.pptx'
    $okPlain = $true; try { Assert-OutsideArchive $plain $fake -LinkTarget $broken } catch { $okPlain = $false }
    Ok 'no reparse point on the path: the resolver is never asked' $okPlain
  }

  # cmd's mklink /J into a fake archive root, and a dangling one.
  $mk = Join-Path $tmp 'mk-junction'
  $gone = Join-Path $fake 'charts\gone'
  New-Item -ItemType Directory -Force -Path $gone | Out-Null
  $dang = Join-Path $tmp 'mk-dangling'
  # Native stderr under 'Stop' throws in 5.1; a failed mklink must skip, not crash.
  $ErrorActionPreference = 'Continue'
  cmd /c mklink /J "$mk" "$(Join-Path $fake 'charts\a')" 2>$null | Out-Null
  cmd /c mklink /J "$dang" "$gone" 2>$null | Out-Null
  $ErrorActionPreference = 'Stop'
  if ((Test-Path -LiteralPath $mk) -and (Test-Path -LiteralPath $dang)) {
    $links += $mk; $links += $dang
    Remove-Item -LiteralPath $gone -Force
    Ok 'mklink /J into charts is refused' (Test-InsideArchive (Join-Path $mk 'deck.pptx') $fake)
    Ok 'a dangling junction into charts is refused' (Test-InsideArchive (Join-Path $dang 'new\deck.pptx') $fake)
  } else { Write-Host 'SKIP mklink /J cases: mklink failed' }

  # A relative directory symlink (needs the symlink privilege; skipped without it).
  $rel = Join-Path $tmp 'rel-link'
  $ErrorActionPreference = 'Continue'
  cmd /c mklink /D "$rel" "repo\charts" 2>$null | Out-Null
  $ErrorActionPreference = 'Stop'
  if (Test-Path -LiteralPath $rel) {
    $links += $rel
    Ok 'a relative symlink into charts is refused' (Test-InsideArchive (Join-Path $rel 'a\deck.pptx') $fake)
  } else { Write-Host 'SKIP relative symlink case: mklink /D failed (no symlink privilege)' }
} finally {
  $left = 0
  foreach ($l in $links) { try { [IO.Directory]::Delete($l) } catch { $left++; Write-Warning "could not remove junction ${l}: $($_.Exception.Message)" } }
  if ($left -eq 0 -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Recurse -Force }
}

# OneDrive folders and files are reparse points too (cloud-file tags, not links). They must not be
# refused as unverifiable, or no synced deck could ever be used.
if ($env:OneDrive -and (Test-Path -LiteralPath $env:OneDrive)) {
  $odDeck = Join-Path $env:OneDrive 'Documents\no-such-folder\deck.pptx'
  $odMsg = $null; $odIn = $null
  try { $odIn = Test-InsideArchive $odDeck $repo } catch { $odMsg = $_.Exception.Message }
  Ok "a OneDrive path (cloud reparse points) is accepted: $odMsg" (($null -eq $odMsg) -and ($odIn -eq $false))
} else { Write-Host 'SKIP OneDrive case: $env:OneDrive is not set' }

# --- PNG size ------------------------------------------------------------------------------------
$pngDir = Join-Path $env:TEMP ("slide-charts-png-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $pngDir | Out-Null
try {
  Add-Type -AssemblyName System.Drawing
  $p = Join-Path $pngDir 'a.png'
  $bmp = New-Object System.Drawing.Bitmap(640, 309); $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  $sz = Get-PngSize $p
  Ok 'Get-PngSize reads IHDR' (($sz.Width -eq 640) -and ($sz.Height -eq 309))
  # Large dimensions: high bytes set (3200 x 70000 as raw IHDR bytes, no pixel data needed).
  $raw = [byte[]](137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 12, 128, 0, 1, 17, 112)
  $q = Join-Path $pngDir 'big.png'; [IO.File]::WriteAllBytes($q, $raw)
  $sz = Get-PngSize $q
  Ok 'Get-PngSize reads big-endian 32-bit sizes' (($sz.Width -eq 3200) -and ($sz.Height -eq 70000))
  $t = Join-Path $pngDir 'not.png'; [IO.File]::WriteAllText($t, 'not a png, but at least twenty-four bytes long')
  Ok 'Get-PngSize returns null for a non-PNG' ($null -eq (Get-PngSize $t))
  $s = Join-Path $pngDir 'short.png'; [IO.File]::WriteAllBytes($s, [byte[]](137, 80, 78, 71))
  Ok 'Get-PngSize returns null for a truncated file' ($null -eq (Get-PngSize $s))
} finally {
  Remove-Item -LiteralPath $pngDir -Recurse -Force
}

# --- Frame / image fit ---------------------------------------------------------------------------
$frames = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'frames.json') | ConvertFrom-Json
$bt = @($frames.'below-title'.place)[0]; $half = @($frames.half.place)[1]; $full = @($frames.full.place)[0]
$btPng = [pscustomobject]@{ Width = 3200; Height = 1545 }
$halfPng = [pscustomobject]@{ Width = 1600; Height = 1545 }
$fullPng = [pscustomobject]@{ Width = 3200; Height = 1800 }
Ok 'below-title render fits below-title' ($null -eq (Get-FrameMismatch 'a.png' 'below-title' 'below-title' $btPng $bt))
Ok 'half render fits half' ($null -eq (Get-FrameMismatch 'b.png' 'half' 'half' $halfPng $half))
Ok 'full render fits full' ($null -eq (Get-FrameMismatch 'c.png' 'full' 'full' $fullPng $full))
$m = Get-FrameMismatch 'a.png' 'below-title' 'half' $btPng $half
Ok 'below-title render into half is refused, naming both frames' (($m -match 'below-title') -and ($m -match 'half') -and ($m -match 'a\.png'))
Ok 'the frame refusal is one line' ($m -notmatch "`n")
$m = Get-FrameMismatch 'a.png' 'half' 'half' $btPng $half
Ok 'a half source.json over a below-title-shaped PNG is refused' (($m -match '3200x1545') -and ($m -match 'half'))
$m = Get-FrameMismatch 'a.png' '' 'half' $halfPng $half
Ok 'a source.json with no frame is refused' ($m -match 'no frame')
$m = Get-FrameMismatch 'a.png' 'half' 'half' $null $half
Ok 'a non-PNG is refused' ($m -match 'not a PNG')
$m = Get-FrameMismatch 'a.png' 'half' 'half' ([pscustomobject]@{ Width = 0; Height = 0 }) $half
Ok 'a zero-size PNG is refused' ($m -match 'not a PNG')
# 0.5% tolerance against the 480 x 463.5 slot: 1607x1545 is 0.44% wider and fits; 1610x1545 is 0.62% and does not.
Ok 'within 0.5% fits' ($null -eq (Get-FrameMismatch 'a.png' 'half' 'half' ([pscustomobject]@{ Width = 1607; Height = 1545 }) $half))
Ok 'beyond 0.5% is refused' ($null -ne (Get-FrameMismatch 'a.png' 'half' 'half' ([pscustomobject]@{ Width = 1610; Height = 1545 }) $half))

# --- Failure messages ----------------------------------------------------------------------------
$bk = 'C:\x\Slide charts\_backups\deck-1.pptx'
function Msg([hashtable]$h) {
  $base = @{ Stage = 'edit'; After = 0; Onto = 0; OpenedHere = $false; Added = $false; Removed = $false; Deleted = 0; Backup = $bk; Reason = 'boom' }
  foreach ($k in $h.Keys) { $base[$k] = $h[$k] }
  return (Get-InsertFailureMessage @base)
}
$m = Msg @{ After = 1 }
Ok 'edit, -After, no slide added: deck unchanged' (($m -match 'before a slide was added') -and ($m -match 'unchanged') -and ($m -match 'boom'))
$m = Msg @{ After = 1; Added = $true; Removed = $true }
Ok 'edit, -After, slide removed' (($m -match 'added slide was removed') -and ($m -match 'not saved'))
$m = Msg @{ After = 1; Added = $true; OpenedHere = $true }
Ok 'edit, -After, not removed, opened here: file unchanged' (($m -match 'could not be removed') -and ($m -match 'not saved, so it is unchanged') -and ($m -notmatch 'PowerPoint window'))
$m = Msg @{ After = 1; Added = $true }
Ok 'edit, -After, not removed, user window: names slide 2 and the backup' (($m -match 'slide 2') -and ($m -match 'open in your PowerPoint window') -and ($m -match [regex]::Escape($bk)))
$m = Msg @{ Onto = 3; OpenedHere = $true; Deleted = 2 }
Ok 'edit, -Onto, opened here: file unchanged' (($m -match 'slide 3') -and ($m -match 'not saved, so it is unchanged'))
$m = Msg @{ Onto = 3; Deleted = 2 }
Ok 'edit, -Onto, user window: unsaved edits, pictures deleted, backup' (($m -match 'open PowerPoint window') -and ($m -match '2 earlier picture') -and ($m -match [regex]::Escape($bk)))
$m = Msg @{ Stage = 'save'; After = 1; Added = $true; OpenedHere = $true }
Ok 'save, opened here: file not saved, backup' (($m -match 'while saving') -and ($m -match 'was not saved') -and ($m -match [regex]::Escape($bk)) -and ($m -notmatch 'PowerPoint window'))
$m = Msg @{ Stage = 'save'; After = 1; Added = $true }
Ok 'save, -After, user window: edits unsaved in the window, backup' (($m -match 'unsaved in your open PowerPoint window') -and ($m -match [regex]::Escape($bk)) -and ($m -notmatch 'deleted'))
$m = Msg @{ Stage = 'save'; Onto = 3; Deleted = 1 }
Ok 'save, -Onto, user window: says the pictures are already deleted there' (($m -match 'unsaved in your open PowerPoint window') -and ($m -match '1 earlier picture') -and ($m -match 'already deleted') -and ($m -match [regex]::Escape($bk)))
$m = Msg @{ Stage = 'save'; Onto = 3; Deleted = 0 }
Ok 'save, -Onto with nothing deleted: no deleted claim' (($m -match 'unsaved in your open PowerPoint window') -and ($m -notmatch 'deleted'))
foreach ($h in @(@{ After = 1 }, @{ Stage = 'save'; Onto = 3; Deleted = 1 })) { Ok "one line ($($h.Keys -join ','))" ((Msg $h) -notmatch "`n") }

if ($fail -gt 0) { Write-Host "$fail FAILED"; exit 1 }
Write-Host 'PASS: all insert-checks cases'
