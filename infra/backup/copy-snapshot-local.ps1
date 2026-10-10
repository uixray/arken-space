[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{64}$')][string]$SnapshotId,
  [Parameter(Mandatory)][string]$SourceRepository,
  [Parameter(Mandatory)][string]$LocalRepository,
  [switch]$Initialize
)
$ErrorActionPreference = 'Stop'
# Source credentials use RESTIC_FROM_PASSWORD_FILE / provider environment.
# Destination password is prompted by restic or supplied via RESTIC_PASSWORD_FILE.
# Never accept passwords as command-line parameters.
$restic = (Get-Command restic -ErrorAction Stop).Source
if ($LocalRepository -match '^[a-z]+://' -or $LocalRepository.StartsWith('\\')) { throw 'Destination must be local.' }
$destination = [IO.Path]::GetFullPath($LocalRepository)
if ($destination.StartsWith('\\') -or $destination -match '^[a-z]+://') {
  throw 'Destination must be an independent local filesystem repository.'
}
if ($SourceRepository -eq $destination) { throw 'Source and destination must differ.' }
function Invoke-Restic([string[]]$Arguments) {
  & $restic @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Restic failed (exit $LASTEXITCODE). Backup is not verified." }
}
if ($Initialize) {
  if (Test-Path -LiteralPath $destination) { throw 'Initialize requires a new destination path; existing repositories are preserved.' }
  Invoke-Restic -Arguments @('--quiet', '-r', $destination, 'init')
}
Invoke-Restic -Arguments @('--quiet', '-r', $destination, 'copy', '--from-repo', $SourceRepository, $SnapshotId)
# Reads every encrypted pack, not just repository metadata. No forget/prune/delete.
Invoke-Restic -Arguments @('--quiet', '-r', $destination, 'check', '--read-data')
$raw = & $restic -r $destination snapshots --json
if ($LASTEXITCODE -ne 0) { throw 'Could not verify copied snapshot.' }
$snapshots = $raw | ConvertFrom-Json
# restic copy changes snapshot ID; original ID is retained as original.
$copy = @($snapshots | Where-Object { $_.id -eq $SnapshotId -or $_.original -eq $SnapshotId })
if ($copy.Count -ne 1) { throw 'Expected exactly one matching copied snapshot.' }
Write-Host 'Encrypted snapshot copied locally and all repository data verified.'
Write-Host 'Restore rehearsal is still required before calling this recovery-ready.'