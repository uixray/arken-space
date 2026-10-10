$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'copy-snapshot-local.ps1'
$temp = Join-Path ([IO.Path]::GetTempPath()) ('arken-copy-test-' + [guid]::NewGuid().ToString('N'))
$source = Join-Path $temp 'source-repo'
$destination = Join-Path $temp 'local-repo'
$receiptDir = Join-Path $temp 'private-receipts'
New-Item -ItemType Directory -Path $source,$receiptDir | Out-Null
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow)
[void]$acl.AddAccessRule($rule)
[IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($receiptDir),$acl)
$sourceId = 'a' * 64
$copyId = 'b' * 64
$global:FakeResticMode = 'unique'
$global:FakeResticCalls = @()
$global:FakeSourceId = $sourceId
$global:FakeCopyId = $copyId
function global:restic {
  $global:FakeResticCalls += ,@($args)
  $global:LASTEXITCODE = 0
  if ($args -contains 'snapshots') {
    if ($global:FakeResticMode -eq 'ambiguous') {
      Write-Output (@(
        @{ id = ('b' * 64); original = $global:FakeSourceId },
        @{ id = ('c' * 64); original = $global:FakeSourceId }
      ) | ConvertTo-Json -Compress)
    } else {
      Write-Output (@(@{ id = $global:FakeCopyId; original = $global:FakeSourceId }) | ConvertTo-Json -Compress)
    }
  }
}
try {
  $receipt = Join-Path $receiptDir 'copy-success.json'
  & $scriptPath -SnapshotId $sourceId -SourceRepository $source -LocalRepository $destination -ReceiptPath $receipt -Initialize
  $saved = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
  if ($saved.sourceSnapshotId -ne $sourceId -or $saved.copiedSnapshotId -ne $copyId -or $saved.integrityCheck -ne 'restic-check-read-data-passed') {
    throw 'Receipt did not record the exact verified source-to-copy IDs.'
  }
  $fileAcl = [IO.FileSystemAclExtensions]::GetAccessControl([IO.FileInfo]::new($receipt),[Security.AccessControl.AccessControlSections]::Access)
  $rules = @($fileAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  if (-not $fileAcl.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) {
    throw 'Receipt ACL is not exactly current-user-only FullControl.'
  }
  $before = $global:FakeResticCalls.Count
  $aliasError = ''
  try {
    & $scriptPath -SnapshotId $sourceId -SourceRepository $source -LocalRepository (Join-Path $source '.') -ReceiptPath (Join-Path $receiptDir 'alias.json')
  } catch {
    $aliasError = $_.Exception.Message
  }
  if ($aliasError -notmatch 'different canonical paths') { throw 'Expected canonical local repository alias collision.' }
  if ($global:FakeResticCalls.Count -ne $before) { throw 'Alias collision executed Restic commands.' }

  # A protected DACL with an arbitrary extra SID is not private, even if it
  # contains none of the common Everyone/Users broad groups.
  $extraSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-21-100-200-300-9876')
  $unsafeAcl = [Security.AccessControl.DirectorySecurity]::new()
  $unsafeAcl.SetAccessRuleProtection($true,$false)
  $unsafeAcl.AddAccessRule($rule)
  $unsafeAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($extraSid,[Security.AccessControl.FileSystemRights]::Read,[Security.AccessControl.AccessControlType]::Allow))
  [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($receiptDir),$unsafeAcl)
  $beforeAcl = $global:FakeResticCalls.Count
  $aclError = ''
  try {
    & $scriptPath -SnapshotId $sourceId -SourceRepository $source -LocalRepository $destination -ReceiptPath (Join-Path $receiptDir 'unsafe-acl.json')
  } catch { $aclError = $_.Exception.Message }
  if ($aclError -notmatch 'only to the current Windows user') { throw 'Expected arbitrary extra SID refusal.' }
  if ($global:FakeResticCalls.Count -ne $beforeAcl) { throw 'Unsafe receipt ACL invoked Restic.' }
  if (Test-Path -LiteralPath (Join-Path $receiptDir 'unsafe-acl.json')) { throw 'Unsafe ACL wrote receipt.' }
  $restoredAcl = [Security.AccessControl.DirectorySecurity]::new()
  $restoredAcl.SetAccessRuleProtection($true,$false)
  $restoredAcl.AddAccessRule($rule)
  [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($receiptDir),$restoredAcl)

  $global:FakeResticMode = 'ambiguous'
  $ambiguousError = ''
  try {
    & $scriptPath -SnapshotId $sourceId -SourceRepository $source -LocalRepository $destination -ReceiptPath (Join-Path $receiptDir 'ambiguous.json')
  } catch {
    $ambiguousError = $_.Exception.Message
  }
  if ($ambiguousError -notmatch 'exactly one matching copied snapshot') { throw ('Expected ambiguous copied snapshot refusal: ' + $ambiguousError) }
  if (Test-Path -LiteralPath (Join-Path $receiptDir 'ambiguous.json')) { throw 'Ambiguous copy wrote a receipt.' }
  Write-Output 'PASS: copy launcher canonical alias guard, integrity-gated unique ID mapping, ambiguity refusal, and private non-overwrite receipt.'
} finally {
  Remove-Item Function:\global:restic -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
