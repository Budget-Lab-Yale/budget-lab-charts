# COM-free tests for Select-OpenPresentation. Exits non-zero on failure.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'match-presentation.ps1')

$dash = [string][char]0x2014
$deckDir = Join-Path $env:TEMP "match-test\O'Neil $dash deck"
New-Item -ItemType Directory -Force -Path $deckDir | Out-Null
$deck = Join-Path $deckDir 'deck.pptx'
[IO.File]::WriteAllText($deck, 'x')

function Stub([string]$full) { return [pscustomobject]@{ FullName = $full; Name = (Split-Path -Leaf $full) } }
$fail = 0
function Ok([string]$name, [bool]$cond) { if ($cond) { Write-Host "PASS $name" } else { Write-Host "FAIL $name"; $script:fail++ } }
function Throws([string]$name, [scriptblock]$b, [string]$pat) {
  $msg = $null; try { & $b } catch { $msg = $_.Exception.Message }
  Ok $name (($null -ne $msg) -and ($msg -match $pat))
}

$local = Stub $deck
$url = 'https://yale.sharepoint.com/sites/x/Budget%20Lab%20Sharepoint/O%27Neil%20%E2%80%94%20deck/deck.pptx'
$cloud = Stub $url
$otherUrl = Stub 'https://yale.sharepoint.com/sites/x/Other%20folder/deck.pptx'
$otherLocal = Stub (Join-Path $env:TEMP 'match-test\elsewhere\deck.pptx')

Ok 'exact local' ((Select-OpenPresentation @($local) $deck) -eq $local)
Ok 'local, different case' ((Select-OpenPresentation @((Stub $deck.ToUpper())) $deck).FullName -eq $deck.ToUpper())
Ok 'local wins over same-name cloud deck listed later' ((Select-OpenPresentation @($local, $otherUrl) $deck) -eq $local)
Ok 'local wins over matching cloud deck listed later' ((Select-OpenPresentation @($local, $cloud) $deck) -eq $local)
Ok 'https with %20 %27 and encoded em dash' ((Select-OpenPresentation @($cloud) $deck) -eq $cloud)
Ok 'two same-name https decks: only the matching folder' ((Select-OpenPresentation @($otherUrl, $cloud) $deck) -eq $cloud)
Throws 'two that both match throw' { Select-OpenPresentation @($cloud, (Stub $url)) $deck } 'ambiguous: 2 open presentations match deck.pptx; close the others'
$rootDeck = Join-Path $env:TEMP 'match-test\Budget Lab Sharepoint\deck.pptx'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $rootDeck) | Out-Null
[IO.File]::WriteAllText($rootDeck, 'x')
$rootUrl = Stub 'https://yale.sharepoint.com/sites/x/Shared%20Documents/deck.pptx'
Ok 'root-level deck, mismatched parent, one https candidate' ((Select-OpenPresentation @($rootUrl, $otherLocal) $rootDeck) -eq $rootUrl)
Throws 'root-level deck, two same-name https decks, neither parent matches' { Select-OpenPresentation @($rootUrl, $otherUrl) $rootDeck } 'ambiguous: 2 open presentations match deck.pptx'
Ok 'none (same name, other folder)' ($null -eq (Select-OpenPresentation @($otherLocal) $deck))
Ok 'none (empty list)' ($null -eq (Select-OpenPresentation @() $deck))

Remove-Item -LiteralPath (Join-Path $env:TEMP 'match-test') -Recurse -Force
if ($fail -gt 0) { Write-Host "$fail FAILED"; exit 1 }
Write-Host 'PASS: all match cases'
