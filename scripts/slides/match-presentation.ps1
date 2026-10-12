# Pure matcher (no COM, no registry): pick which open presentation is the deck at $DeckPath.
# Candidates: objects with FullName and Name (PowerPoint Presentation objects, or test stubs).
# Mappings: objects with MountPoint (local synced root) and UrlNamespace (its https root), as
# OneDrive records them under HKCU:\Software\SyncEngines\Providers\OneDrive\<id>.
# No name-only or parent-only matching: a same-name deck elsewhere must never be picked.
function Get-NormalizedLocalPath([string]$p) {
  $full = $p
  try { $full = [IO.Path]::GetFullPath($p) } catch { }
  try { if (Test-Path -LiteralPath $full) { $full = (Get-Item -LiteralPath $full).FullName } } catch { }
  return $full
}

function Select-OpenPresentation {
  param($Candidates, [string]$DeckPath, $Mappings = @())
  $local = Get-NormalizedLocalPath $DeckPath
  $leaf = Split-Path -Leaf $local

  # 1. An exact local match wins outright.
  foreach ($c in @($Candidates)) {
    if ($c.FullName -notmatch '^https?://') {
      if ((Get-NormalizedLocalPath $c.FullName) -ieq $local) { return $c }
    }
  }

  # 2. Longest MountPoint that is a path-segment prefix of the deck path.
  $best = $null; $bestMount = ''
  foreach ($m in @($Mappings)) {
    if (-not $m.MountPoint -or -not $m.UrlNamespace) { continue }
    $mp = (Get-NormalizedLocalPath ([string]$m.MountPoint)).TrimEnd('\')
    if ($local.Length -gt $mp.Length -and $local.StartsWith($mp + '\', [StringComparison]::OrdinalIgnoreCase)) {
      if ($mp.Length -gt $bestMount.Length) { $best = $m; $bestMount = $mp }
    }
  }
  if (-not $best) { return $null }

  $rel = $local.Substring($bestMount.Length + 1).Replace('\', '/')
  $expected = ([string]$best.UrlNamespace).TrimEnd('/') + '/' + $rel
  $expected = [Uri]::UnescapeDataString($expected).TrimEnd('/')
  $hits = @()
  foreach ($c in @($Candidates)) {
    if ($c.FullName -match '^https?://') {
      if ([Uri]::UnescapeDataString($c.FullName).TrimEnd('/') -ieq $expected) { $hits += $c }
    }
  }
  if ($hits.Count -gt 1) { throw "ambiguous: $($hits.Count) open presentations match $leaf; close the others" }
  if ($hits.Count -eq 1) { return $hits[0] }
  return $null
}
