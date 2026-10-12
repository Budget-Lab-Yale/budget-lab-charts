# Pure matcher (no COM): pick which open presentation is the deck at $DeckPath.
# Candidates are objects with FullName and Name (PowerPoint Presentation objects, or test stubs).
function Get-NormalizedLocalPath([string]$p) {
  $full = $p
  try { $full = [IO.Path]::GetFullPath($p) } catch { }
  try { if (Test-Path -LiteralPath $full) { $full = (Get-Item -LiteralPath $full).FullName } } catch { }
  return $full
}

function Select-OpenPresentation {
  param($Candidates, [string]$DeckPath)
  $local = Get-NormalizedLocalPath $DeckPath
  $leaf = Split-Path -Leaf $local
  $parent = Split-Path -Leaf (Split-Path -Parent $local)

  # An exact local match wins outright.
  foreach ($c in @($Candidates)) {
    if ($c.FullName -notmatch '^https?://') {
      if ((Get-NormalizedLocalPath $c.FullName) -ieq $local) { return $c }
    }
  }

  # Cloud-synced decks report an https URL: require the parent folder and file name to match.
  $hits = @()
  foreach ($c in @($Candidates)) {
    if ($c.FullName -match '^https?://') {
      $segs = @([Uri]::UnescapeDataString($c.FullName).Split('/'))
      if ($segs.Count -ge 2 -and $segs[$segs.Count - 1] -ieq $leaf -and $segs[$segs.Count - 2] -ieq $parent) { $hits += $c }
    }
  }
  if ($hits.Count -gt 1) { throw "ambiguous: $($hits.Count) open presentations match $leaf; close the others" }
  if ($hits.Count -eq 1) { return $hits[0] }
  return $null
}
