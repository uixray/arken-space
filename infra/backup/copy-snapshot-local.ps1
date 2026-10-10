[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{64}$')][string]$SnapshotId,
  [Parameter(Mandatory)][string]$SourceRepository,
  [Parameter(Mandatory)][string]$LocalRepository,
  [Parameter(Mandatory)][string]$ReceiptPath,
  [switch]$Initialize
)
$ErrorActionPreference = 'Stop'
# Source credentials use RESTIC_FROM_PASSWORD_FILE / provider environment.
# Destination password is prompted by restic or supplied via RESTIC_PASSWORD_FILE.
# Never accept passwords as command-line parameters.
$resticCommand = Get-Command restic -ErrorAction Stop
$restic = if ($resticCommand.Source) { $resticCommand.Source } else { 'restic' }
if ($LocalRepository -match '^[a-z]+://' -or $LocalRepository.StartsWith('\\')) { throw 'Destination must be local.' }
$destination = [IO.Path]::GetFullPath($LocalRepository)
if ($destination.StartsWith('\\') -or $destination -match '^[a-z]+://') {
  throw 'Destination must be an independent local filesystem repository.'
}
function Resolve-CanonicalLocalPath([string]$Value) {
  if ($Value -match '^file://') {
    $uri = [Uri]$Value
    $Value = [Uri]::UnescapeDataString($uri.LocalPath)
    if ($Value -match '^/[A-Za-z]:/') { $Value = $Value.Substring(1) }
  } elseif (($Value -match '^[a-z][a-z0-9+.-]*:' -and $Value -notmatch '^[A-Za-z]:[\\/]') -or $Value.StartsWith('\\')) { return $null }
  $full = [IO.Path]::GetFullPath($Value)
  $probe = $full
  while ($probe) {
    if (Test-Path -LiteralPath $probe) {
      $item = Get-Item -LiteralPath $probe -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Local repository paths may not traverse symlinks, junctions, or reparse points.' }
    }
    $parent = [IO.Directory]::GetParent($probe)
    if ($null -eq $parent) { break }
    $probe = $parent.FullName
  }
  $root = [IO.Path]::GetPathRoot($full)
  if ($full.Length -gt $root.Length) { return $full.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) }
  return $full
}
function Test-SamePath([string]$Left, [string]$Right) {
  if ($null -eq $Left -or $null -eq $Right) { return $false }
  return [string]::Equals($Left, $Right, [StringComparison]::OrdinalIgnoreCase)
}
$sourceCanonical = Resolve-CanonicalLocalPath $SourceRepository
$destinationCanonical = Resolve-CanonicalLocalPath $destination
if (Test-SamePath $sourceCanonical $destinationCanonical) { throw 'Source and destination must be different canonical paths.' }
if (Test-Path -LiteralPath $destination) {
  $destinationItem = Get-Item -LiteralPath $destination -Force
  if ($destinationItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Destination repository may not be a symlink or reparse point.' }
}
if ([string]::IsNullOrWhiteSpace($ReceiptPath)) { throw 'A private non-overwrite receipt path is required.' }
$receipt = [IO.Path]::GetFullPath($ReceiptPath)
$receiptParent = Split-Path -Parent $receipt
if (-not (Test-Path -LiteralPath $receiptParent -PathType Container)) { throw 'Receipt parent directory must already exist.' }
if (Test-Path -LiteralPath $receipt) { throw 'Receipt path or parent is unsafe or already exists.' }
$null = Resolve-CanonicalLocalPath $receiptParent
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function Assert-PrivateAccessAcl($Acl) {
  $rules = @($Acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if (-not $Acl.AreAccessRulesProtected -or $rules.Count -ne 1 -or
      $rules[0].IdentityReference.Value -ne $currentSid -or
      $rules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
      $rules[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) {
    throw 'Receipt access must be protected and granted only to the current Windows user.'
  }
}
$parentAcl = [IO.FileSystemAclExtensions]::GetAccessControl([IO.DirectoryInfo]::new($receiptParent),[Security.AccessControl.AccessControlSections]::Access)
Assert-PrivateAccessAcl $parentAcl
foreach ($repoPath in @($sourceCanonical,$destinationCanonical)) {
  if ($null -eq $repoPath) { continue }
  $relative = [IO.Path]::GetRelativePath($repoPath, $receipt)
  if (-not [IO.Path]::IsPathRooted($relative) -and $relative -ne '..' -and -not $relative.StartsWith('..' + [IO.Path]::DirectorySeparatorChar) -and -not $relative.StartsWith('..' + [IO.Path]::AltDirectorySeparatorChar)) {
    throw 'Receipt must be outside both repositories.'
  }
}
if ($sourceCanonical -and (Test-Path -LiteralPath $sourceCanonical)) {
  $sourceItem = Get-Item -LiteralPath $sourceCanonical -Force
  if ($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Source repository may not be a symlink or reparse point.' }
}
function Set-CurrentUserOnlyAcl([string]$Path) {
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow)
  [void]$acl.AddAccessRule($rule)
  $file = [IO.FileInfo]::new($Path)
  [IO.FileSystemAclExtensions]::SetAccessControl($file,$acl)
  Assert-PrivateAccessAcl ([IO.FileSystemAclExtensions]::GetAccessControl($file,[Security.AccessControl.AccessControlSections]::Access))
}
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
$copy = @($snapshots | Where-Object { $_.original -eq $SnapshotId })
if ($copy.Count -ne 1) { throw 'Expected exactly one matching copied snapshot.' }
if ($copy[0].id -notmatch '^[0-9a-f]{64}$' -or $copy[0].id -eq $SnapshotId) { throw 'Copied snapshot identity is invalid.' }
$receiptObject = [ordered]@{
  format = 'arken-restic-copy-receipt-v1'
  verifiedAt = [DateTime]::UtcNow.ToString('o')
  sourceSnapshotId = $SnapshotId
  copiedSnapshotId = $copy[0].id
  integrityCheck = 'restic-check-read-data-passed'
}
$receiptJson = ($receiptObject | ConvertTo-Json -Depth 5) + [Environment]::NewLine
$bytes = [Text.Encoding]::UTF8.GetBytes($receiptJson)
$stream = $null
try {
  $stream = [IO.File]::Open($receipt, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush($true)
} catch {
  throw 'Encrypted copy exists and integrity was checked, but its mapping receipt could not be created.'
} finally {
  if ($null -ne $stream) { $stream.Dispose() }
}
try { Set-CurrentUserOnlyAcl $receipt } catch { Remove-Item -LiteralPath $receipt -Force -ErrorAction SilentlyContinue; throw 'Encrypted copy exists and integrity was checked, but private receipt ACL verification failed; recovery proof is incomplete.' }
Write-Host 'Encrypted snapshot copied locally and all repository data verified.'
Write-Host 'A private receipt records the exact source-to-local snapshot ID mapping.'
Write-Host 'Restore rehearsal is still required before calling this recovery-ready.'
