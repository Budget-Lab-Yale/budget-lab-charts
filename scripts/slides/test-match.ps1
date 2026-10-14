# COM-free tests for Select-OpenPresentation. Exits non-zero on failure.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'match-presentation.ps1')

function Stub([string]$full) { return [pscustomobject]@{ FullName = $full; Name = (Split-Path -Leaf $full) } }
function Map([string]$m, [string]$u) { return [pscustomobject]@{ MountPoint = $m; UrlNamespace = $u } }
$fail = 0
function Ok([string]$name, [bool]$cond) { if ($cond) { Write-Host "PASS $name" } else { Write-Host "FAIL $name"; $script:fail++ } }
function Throws([string]$name, [scriptblock]$b, [string]$pat) {
  $msg = $null; try { & $b } catch { $msg = $_.Exception.Message }
  Ok $name (($null -ne $msg) -and ($msg -match $pat))
}

$dash = [string][char]0x2014
$oneDrive = 'C:\Users\tester\OneDrive - Yale University'
$shared = "$oneDrive\Documents\Budget Lab Sharepoint"
$maps = @(
  (Map $oneDrive 'https://yaleedu-my.sharepoint.com/personal/tester_yale_edu/Documents/'),
  (Map $shared 'https://yaleedu.sharepoint.com/sites/BudgetLab/Shared Documents/'),
  (Map $shared 'https://yaleedu.sharepoint.com/sites/BudgetLab/Shared Documents/')   # duplicate entry
)
$base = 'https://yaleedu.sharepoint.com/sites/BudgetLab/Shared%20Documents'

# Exact local (paths need not exist; normalization falls back to GetFullPath)
$deck = "$shared\O'Neil $dash deck\deck.pptx"
$local = Stub $deck
Ok 'exact local' ((Select-OpenPresentation @($local) $deck $maps) -eq $local)
Ok 'exact local, different case' ((Select-OpenPresentation @((Stub $deck.ToUpper())) $deck $maps).FullName -eq $deck.ToUpper())
Ok 'exact local wins over a matching cloud deck listed first' ((Select-OpenPresentation @((Stub "$base/O%27Neil%20%E2%80%94%20deck/deck.pptx"), $local) $deck $maps) -eq $local)

# https under the BudgetLab mapping, %20 %27 and em dash encoded
$cloud = Stub "$base/O%27Neil%20%E2%80%94%20deck/deck.pptx"
Ok 'https with %20 %27 and encoded em dash' ((Select-OpenPresentation @($cloud) $deck $maps) -eq $cloud)

# Library root
$rootDeck = "$shared\deck.pptx"
$rootUrl = Stub "$base/deck.pptx"
Ok 'deck at the library root' ((Select-OpenPresentation @($rootUrl) $rootDeck $maps) -eq $rootUrl)

# Nested roots: the longer mount wins (the outer root would give a different expected URL)
$outerUrl = Stub 'https://yaleedu-my.sharepoint.com/personal/tester_yale_edu/Documents/Documents/Budget%20Lab%20Sharepoint/deck.pptx'
Ok 'nested roots: longer mount wins' ((Select-OpenPresentation @($outerUrl, $rootUrl) $rootDeck $maps) -eq $rootUrl)
Ok 'nested roots: outer-mapped URL alone does not match' ($null -eq (Select-OpenPresentation @($outerUrl) $rootDeck $maps))
$personal = "$oneDrive\Desktop\notes.pptx"
$personalUrl = Stub 'https://yaleedu-my.sharepoint.com/personal/tester_yale_edu/Documents/Desktop/notes.pptx'
Ok 'deck only under the outer root' ((Select-OpenPresentation @($personalUrl) $personal $maps) -eq $personalUrl)

# Segment boundary: "Budget Lab" must not prefix "Budget Lab Sharepoint"
$bad = @((Map "$oneDrive\Documents\Budget Lab" 'https://example.com/wrong/'))
Ok 'segment boundary' ($null -eq (Select-OpenPresentation @((Stub 'https://example.com/wrong/ Sharepoint/deck.pptx'), (Stub 'https://example.com/wrong/Sharepoint/deck.pptx')) $rootDeck $bad))

# Hijack: unrelated same-name cloud deck, target local and closed
$other = Stub "$base/Other%20folder/deck.pptx"
Ok 'same-name cloud deck elsewhere is not matched' ($null -eq (Select-OpenPresentation @($other) $deck $maps))
Ok 'same-name cloud deck, deck at root, other folder' ($null -eq (Select-OpenPresentation @($other) $rootDeck $maps))

# Ambiguity and no mappings
Throws 'two candidates with the same URL are ambiguous' { Select-OpenPresentation @($cloud, (Stub $cloud.FullName)) $deck $maps } 'ambiguous: 2 open presentations match deck.pptx; close the others'
Ok 'no mappings: https candidate not matched' ($null -eq (Select-OpenPresentation @($cloud, $rootUrl) $deck @()))
Ok 'empty candidates' ($null -eq (Select-OpenPresentation @() $deck $maps))

if ($fail -gt 0) { Write-Host "$fail FAILED"; exit 1 }
Write-Host 'PASS: all match cases'
