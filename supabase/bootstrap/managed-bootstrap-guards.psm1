Set-StrictMode -Version Latest

$script:ProductionProjectRef = 'gadusaizqnshxqcckibq'
$script:ProductionSessionPoolerHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$script:RequiredSupabaseCliVersion = '2.120.0'

function Assert-ManagedTarget {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$ProjectRef,
    [Parameter(Mandatory)][string]$DatabaseHost,
    [Parameter(Mandatory)][int]$DatabasePort,
    [Parameter(Mandatory)][string]$DatabaseUsername,
    [Parameter(Mandatory)][ValidateSet('Direct', 'SessionPooler')][string]$ConnectionMode,
    [Parameter(Mandatory)][string]$StagingRef
  )

  if ($ProjectRef -notmatch '^[a-z0-9]{20}$') { throw 'invalid project reference' }
  if ($ProjectRef -eq $StagingRef) { throw 'staging project is not an allowed bootstrap target' }
  if ($ProjectRef -cne $script:ProductionProjectRef) { throw 'project reference is not the explicitly authorized production project' }
  if ($DatabasePort -ne 5432) { throw 'only PostgreSQL port 5432 is allowed; transaction pooling is unsupported' }

  if ($ConnectionMode -eq 'Direct') {
    if ($DatabaseHost -cnotmatch "^db\.$([regex]::Escape($ProjectRef))\.supabase\.(co|com)$") {
      throw 'direct database hostname does not match the explicitly selected project'
    }
    if ($DatabaseUsername -cne 'postgres') { throw 'direct database username must be postgres' }
  } else {
    if ($ProjectRef -cne $script:ProductionProjectRef) { throw 'session pooler is only authorized for the selected production project' }
    if ($DatabaseHost -cne $script:ProductionSessionPoolerHost) { throw 'session pooler hostname must exactly match the approved Seoul endpoint' }
    if ($DatabaseUsername -cne "postgres.$ProjectRef") { throw 'session pooler username must be project-qualified for the selected project' }
  }

  return [pscustomobject]@{
    ProjectRef = $ProjectRef
    Host = $DatabaseHost
    Port = $DatabasePort
    Username = $DatabaseUsername
    Mode = $ConnectionMode
    Database = 'postgres'
    SslMode = 'require'
    CliDbUrl = "postgresql://$DatabaseUsername@$DatabaseHost`:$DatabasePort/postgres?sslmode=require"
  }
}

function Assert-ManagedVersionList {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string[]]$Actual,
    [Parameter(Mandatory)][string[]]$Expected,
    [Parameter(Mandatory)][string]$Label
  )
  $a = @($Actual | Sort-Object -Unique)
  $e = @($Expected | Sort-Object -Unique)
  if (($a -join ',') -cne ($e -join ',')) {
    throw "$Label version set differs from the checked-in migrations"
  }
}

function Assert-EmptyPsqlCheckpointAllowed {
  [CmdletBinding()]
  param([Parameter(Mandatory)][psobject]$Target)
  if ($Target.ProjectRef -cne $script:ProductionProjectRef -or
      $Target.Mode -cne 'SessionPooler' -or
      $Target.Host -cne $script:ProductionSessionPoolerHost -or
      [int]$Target.Port -ne 5432 -or
      $Target.Username -cne "postgres.$script:ProductionProjectRef") {
    throw 'psql empty-database checkpoint is restricted to the authorized production Session Pooler target'
  }
  return $true
}

function Assert-EmptyDatabaseState {
  [CmdletBinding()]
  param([Parameter(Mandatory)][psobject]$State)
  if ($State.Database -cne 'postgres' -or $State.EffectiveUser -cne 'postgres') { throw 'database identity differs from postgres/postgres' }
  if ([int]$State.ServerVersionMajor -ne 17) { throw 'expected PostgreSQL major version 17' }
  if ([int64]$State.PublicObjects -ne 0) { throw 'public application schema is not empty' }
  if ([int64]$State.MigrationLedgerRows -ne 0) { throw 'migration history is not empty' }
  if ([int64]$State.ApplicationSchemaCount -ne 0) { throw 'application schema already exists' }
  $requiredDataChecks = @(
    'auth.users', 'auth.identities', 'auth.sessions', 'auth.refresh_tokens',
    'auth.mfa_factors', 'storage.objects', 'storage.buckets', 'cron.job'
  )
  foreach ($name in $requiredDataChecks) {
    if (-not $State.UserDataCounts.Contains($name)) { throw "required emptiness check is missing: $name" }
    if ([int64]$State.UserDataCounts[$name] -ne 0) { throw "existing user data detected in $name" }
  }
  return $true
}

function Assert-CatalogSnapshotStable {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$BeforeSha256, [Parameter(Mandatory)][string]$AfterSha256)
  if ($BeforeSha256 -cnotmatch '^[a-f0-9]{64}$' -or $AfterSha256 -cnotmatch '^[a-f0-9]{64}$' -or $BeforeSha256 -cne $AfterSha256) {
    throw 'database catalog changed while the empty-project checkpoint was being established'
  }
  return $true
}

function New-ManagedProtectedCheckpointDirectory {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$RepositoryRoot)
  $fullPath = [IO.Path]::GetFullPath($Path)
  $repo = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if ($fullPath.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase) -or $fullPath -eq $repo.TrimEnd([IO.Path]::DirectorySeparatorChar)) {
    throw 'checkpoint directory must be outside the repository'
  }
  if (Test-Path -LiteralPath $fullPath) { throw 'checkpoint directory already exists; refusing to overwrite evidence' }
  if (-not $env:OS -or $env:OS -ne 'Windows_NT') { throw 'private checkpoint ACL setup requires Windows NTFS' }
  $parentPath = Split-Path -Parent $fullPath
  if (-not (Test-Path -LiteralPath $parentPath -PathType Container)) { throw 'checkpoint parent directory must already exist' }
  $ancestor = Get-Item -LiteralPath $parentPath -Force
  while ($null -ne $ancestor) {
    if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'checkpoint path cannot traverse a reparse point or symbolic link' }
    $ancestorPath = Split-Path -Parent $ancestor.FullName
    if (-not $ancestorPath -or $ancestorPath -eq $ancestor.FullName) { break }
    $ancestor = Get-Item -LiteralPath $ancestorPath -Force -ErrorAction SilentlyContinue
  }

  New-Item -ItemType Directory -Path $fullPath -ErrorAction Stop | Out-Null
  try {
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $adminsSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $acl = Get-Acl -LiteralPath $fullPath
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($currentSid)
    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($sid in @($currentSid, $systemSid, $adminsSid)) {
      $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        $sid,
        [Security.AccessControl.FileSystemRights]::FullControl,
        $inheritance,
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow
      )
      $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $fullPath -AclObject $acl -ErrorAction Stop
    $verified = Get-Acl -LiteralPath $fullPath
    if (-not $verified.AreAccessRulesProtected) { throw 'checkpoint ACL inheritance was not disabled' }
    $allowed = @($currentSid.Value, $systemSid.Value, $adminsSid.Value)
    foreach ($rule in $verified.Access) {
      $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
      if ($sid -notin $allowed -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) {
        throw 'checkpoint directory has an unexpected ACL entry'
      }
    }
    return $fullPath
  } catch {
    # Preserve a directory if ACL verification fails so the failure is visible;
    # no database write is attempted before this function succeeds.
    throw
  }
}

function Write-ManagedReadOnlyCheckpointFile {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][AllowEmptyString()][string]$Content)
  if ([string]::IsNullOrWhiteSpace($Content)) { throw 'checkpoint content is empty' }
  $fullPath = [IO.Path]::GetFullPath($Path)
  $parent = Split-Path -Parent $fullPath
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw 'checkpoint directory is unavailable' }
  if (Test-Path -LiteralPath $fullPath) { throw 'checkpoint artifact already exists; refusing to overwrite evidence' }
  $tempPath = Join-Path $parent ('.checkpoint-' + [guid]::NewGuid().ToString('N') + '.tmp')
  $encoding = [Text.UTF8Encoding]::new($false)
  try {
    [IO.File]::WriteAllText($tempPath, $Content, $encoding)
    if (-not (Test-Path -LiteralPath $tempPath -PathType Leaf) -or (Get-Item -LiteralPath $tempPath).Length -eq 0) {
      throw 'temporary checkpoint artifact was not written'
    }
    [IO.File]::Move($tempPath, $fullPath)
    $item = Get-Item -LiteralPath $fullPath
    if ($item.Length -eq 0) { throw 'checkpoint artifact is empty after write' }
    [IO.File]::SetAttributes($fullPath, $item.Attributes -bor [IO.FileAttributes]::ReadOnly)
    $bytes = [IO.File]::ReadAllBytes($fullPath)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    return [pscustomobject]@{ Path = $fullPath; Length = $bytes.Length; Sha256 = $hash; ReadOnly = $true }
  } finally {
    if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue }
  }
}

function Complete-ManagedCliResult {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][int]$ExitCode,
    [AllowEmptyString()][string]$Output = '',
    [Parameter(Mandatory)][string]$Label,
    [AllowEmptyString()][string]$Secret = ''
  )
  $safeOutput = $Output
  if ($Secret) { $safeOutput = $safeOutput.Replace($Secret, '[redacted]') }
  if ($ExitCode -ne 0) {
    throw "$Label failed with exit code $ExitCode. $safeOutput"
  }
  return $safeOutput
}

function Assert-SupabaseCliVersion {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][int]$ExitCode,
    [Parameter(Mandatory)][AllowEmptyString()][string]$Output
  )
  if ($ExitCode -ne 0) { throw 'Supabase CLI version check failed' }
  $match = [regex]::Match($Output, '(?m)^\s*(?:supabase(?:\s+CLI)?\s+)?v?(\d+\.\d+\.\d+)\s*$')
  if (-not $match.Success -or $match.Groups[1].Value -cne $script:RequiredSupabaseCliVersion) {
    throw "Supabase CLI $script:RequiredSupabaseCliVersion is required for the guarded explicit database URL workflow"
  }
  return $match.Groups[1].Value
}

function New-ManagedCheckpointManifest {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$ProjectRef,
    [Parameter(Mandatory)][psobject]$ProjectIdentity,
    [Parameter(Mandatory)][psobject]$DatabaseState,
    [Parameter(Mandatory)][psobject]$SnapshotArtifact,
    [Parameter(Mandatory)][string]$SnapshotFile,
    [Parameter(Mandatory)][string]$CatalogDigest,
    [Parameter(Mandatory)][string]$BaselineSha256,
    [Parameter(Mandatory)][object[]]$Migrations
  )
  if ($ProjectRef -cne $script:ProductionProjectRef) { throw 'checkpoint manifest is restricted to the authorized production project' }
  if ($Migrations.Count -ne 63) { throw 'checkpoint manifest must contain exactly 63 checked-in migrations' }
  if ($CatalogDigest -cnotmatch '^[a-f0-9]{64}$' -or $BaselineSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'checkpoint manifest contains an invalid SHA-256 digest' }
  $migrationEvidence = @()
  foreach ($migration in $Migrations) {
    if ($migration.file -notmatch '^\d{14}_[a-z0-9_]+\.sql$' -or $migration.sha256_raw -cnotmatch '^[a-f0-9]{64}$') {
      throw 'checkpoint manifest contains malformed migration hash evidence'
    }
    $migrationEvidence += [ordered]@{ file = $migration.file; sha256_raw = $migration.sha256_raw }
  }
  if (@($migrationEvidence.file | Sort-Object -Unique).Count -ne 63) { throw 'checkpoint manifest migration filenames are not unique' }
  return [ordered]@{
    checkpoint_kind = 'psql-read-only-empty-database-catalog'
    restorable_backup = $false
    warning = 'NOT A RESTORABLE BACKUP. This catalog snapshot cannot restore this database.'
    project_identity = $ProjectIdentity
    connection = [ordered]@{ mode = 'SessionPooler'; host = $script:ProductionSessionPoolerHost; port = 5432; username = "postgres.$ProjectRef"; sslmode = 'require' }
    database = [ordered]@{ name = 'postgres'; role = 'postgres'; server_version = $DatabaseState.ServerVersion; server_major = $DatabaseState.ServerVersionMajor }
    empty_state = [ordered]@{
      public_objects = $DatabaseState.PublicObjects
      migration_ledger_exists = $DatabaseState.MigrationLedgerExists
      migration_ledger_rows = $DatabaseState.MigrationLedgerRows
      application_schema_count = $DatabaseState.ApplicationSchemaCount
      relevant_user_data_rows = $DatabaseState.UserDataCounts
    }
    catalog_snapshot = [ordered]@{ file = $SnapshotFile; bytes = $SnapshotArtifact.Length; sha256 = $SnapshotArtifact.Sha256; query_digest = $CatalogDigest }
    application_baseline_sha256_lf = $BaselineSha256
    migrations = $migrationEvidence
    captured_at_utc = [DateTime]::UtcNow.ToString('o')
    note = 'Protected, read-only structural catalog evidence for a verified empty project; not a data dump or restore point.'
  }
}

function Get-ManagedMigrationCliArguments {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][ValidateSet('List', 'DryRun', 'Push')][string]$Action,
    [Parameter(Mandatory)][string]$Workdir,
    [Parameter(Mandatory)][string]$ProjectRef,
    [Parameter(Mandatory)][string]$DbUrl
  )
  if ($ProjectRef -cne $script:ProductionProjectRef) { throw 'migration CLI target is not the explicitly authorized production project' }
  $expectedUrl = "postgresql://postgres.$ProjectRef@$script:ProductionSessionPoolerHost`:5432/postgres?sslmode=require"
  if ($DbUrl -cne $expectedUrl) { throw 'migration CLI URL must be the exact password-free production Session Pooler URL' }
  # v2.120.0 rejects --project-ref with --db-url. The exact database URL is
  # the target selector; omitting --linked and using an isolated workdir
  # prevents fallback to the repository's staging link.
  $common = @('--workdir', $Workdir)
  switch ($Action) {
    'List' { return ,($common + @('migration', 'list', '--db-url', $DbUrl)) }
    'DryRun' { return ,($common + @('db', 'push', '--db-url', $DbUrl, '--dry-run', '--skip-vault')) }
    'Push' { return ,($common + @('db', 'push', '--db-url', $DbUrl, '--skip-vault', '--yes')) }
  }
}

function Assert-CheckpointTool {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$ToolPath,
    [Parameter(Mandatory)][scriptblock]$Runner
  )
  if (-not (Test-Path -LiteralPath $ToolPath -PathType Leaf)) { throw 'pg_dump checkpoint executable is missing' }
  $result = & $Runner $ToolPath
  if ($null -eq $result -or $result.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace([string]$result.Output)) {
    throw 'pg_dump checkpoint executable failed its version check'
  }
  return $ToolPath
}

Export-ModuleMember -Function Assert-ManagedTarget, Assert-ManagedVersionList, Assert-EmptyPsqlCheckpointAllowed, Assert-EmptyDatabaseState, Assert-CatalogSnapshotStable, New-ManagedProtectedCheckpointDirectory, Write-ManagedReadOnlyCheckpointFile, Complete-ManagedCliResult, Assert-SupabaseCliVersion, New-ManagedCheckpointManifest, Get-ManagedMigrationCliArguments, Assert-CheckpointTool
