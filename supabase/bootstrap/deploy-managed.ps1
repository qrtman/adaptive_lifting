[CmdletBinding()]
param(
  [ValidatePattern('^[a-z0-9]{20}$')]
  [string]$ProjectRef,

  [string]$DatabaseHost,

  [int]$DatabasePort = 5432,

  [string]$DatabaseUsername,

  [ValidateSet('Direct', 'SessionPooler')]
  [string]$ConnectionMode = 'Direct',

  [string]$CheckpointDirectory,
  [switch]$EmptyDatabasePsqlCheckpoint,
  [switch]$Apply,
  [switch]$ValidateFilesOnly
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$bootstrap = Join-Path $root 'supabase\bootstrap'
$guardModule = Join-Path $bootstrap 'managed-bootstrap-guards.psm1'
Import-Module $guardModule -Force
$migrationDir = Join-Path $root 'supabase\migrations'
$evidencePath = Join-Path $bootstrap 'verification-revisions.json'
$historicalEvidencePath = Join-Path $bootstrap 'verification-strict.json'
$stagingRef = 'admyuepbbtstayaydjmo'
$previousPgPassword = $env:PGPASSWORD
$previousPgSslMode = $env:PGSSLMODE
$setPgPassword = $false

function Stop-Safely([string]$Message) {
  throw "Managed bootstrap stopped: $Message"
}

function Get-ExpectedVersions {
  $files = @(Get-ChildItem -LiteralPath $migrationDir -Filter '*.sql' | Sort-Object Name)
  if ($files.Count -ne 63) { Stop-Safely "expected exactly 63 migration files; found $($files.Count)" }
  $versions = @()
  foreach ($file in $files) {
    if ($file.Name -notmatch '^(\d{14})_[a-z0-9_]+\.sql$') {
      Stop-Safely "invalid migration filename $($file.Name)"
    }
    $versions += $Matches[1]
  }
  if (($versions | Sort-Object -Unique).Count -ne 63) { Stop-Safely 'migration version IDs are not unique' }

  $evidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
  if ($evidence.migrations.Count -ne 63) { Stop-Safely 'strict replay evidence does not describe 63 migrations' }
  foreach ($item in $evidence.migrations) {
    $file = Join-Path $migrationDir $item.file
    if (-not (Test-Path -LiteralPath $file)) { Stop-Safely "strict evidence references missing $($item.file)" }
    $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $item.sha256_raw.ToLowerInvariant()) { Stop-Safely "migration hash differs from strict evidence: $($item.file)" }
  }
  $historical = Get-Content -LiteralPath $historicalEvidencePath -Raw | ConvertFrom-Json
  if ($historical.migrations.Count -ne 62) { Stop-Safely 'preserved historical 62-migration evidence is missing or changed' }
  for ($index = 0; $index -lt 62; $index++) {
    if ($evidence.migrations[$index].file -ne $historical.migrations[$index].file -or
        $evidence.migrations[$index].sha256_raw -ne $historical.migrations[$index].sha256_raw) {
      Stop-Safely 'the first 62 migration files no longer match the retained original strict evidence'
    }
  }
  $bootstrapHash = Get-LfSha256 (Join-Path $bootstrap 'application.sql')
  if ($bootstrapHash -ne $evidence.bootstrap_sha256_lf.ToLowerInvariant()) {
    Stop-Safely 'application.sql differs from strict replay evidence'
  }
  return [pscustomobject]@{ Versions = $versions; Evidence = $evidence }
}

function Get-LfSha256([string]$Path) {
  $text = [IO.File]::ReadAllText($Path).Replace("`r`n", "`n")
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($text)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { $hash = $algorithm.ComputeHash($bytes) } finally { $algorithm.Dispose() }
  return ([BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
}

function Get-VersionIds([string]$Text) {
  return ,@([regex]::Matches($Text, '(?<!\d)\d{14}(?!\d)') |
    ForEach-Object { $_.Value } | Sort-Object -Unique)
}

function Assert-VersionList([string[]]$Actual, [string[]]$Expected, [string]$Label) {
  try { Assert-ManagedVersionList -Actual $Actual -Expected $Expected -Label $Label }
  catch { Stop-Safely $_.Exception.Message }
}

function Invoke-DbQuery([string]$Sql) {
  $nativeResult = Invoke-ManagedNativeCommand -ExecutablePath $script:psqlPath -Arguments @(
    '--no-password', '--no-psqlrc', '--quiet', '--tuples-only', '--no-align',
    '--set', 'ON_ERROR_STOP=1', '--host', $script:dbTarget.Host, '--port', [string]$script:dbTarget.Port,
    '--username', $script:dbTarget.Username, '--dbname', 'postgres', '--command', $Sql
  )
  if ($nativeResult.ExitCode -ne 0) { Stop-Safely "read-only psql query failed: $($nativeResult.Output)" }
  return $nativeResult.Output.Trim()
}

function Invoke-DbFile([string]$Path) {
  $nativeResult = Invoke-ManagedNativeCommand -ExecutablePath $script:psqlPath -Arguments @(
    '--no-password', '--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1',
    '--host', $script:dbTarget.Host, '--port', [string]$script:dbTarget.Port,
    '--username', $script:dbTarget.Username, '--dbname', 'postgres', '--file', $Path
  )
  if ($nativeResult.ExitCode -ne 0) { Stop-Safely "SQL file failed; target may be partially changed. Preserve it and inspect before recovery: $($nativeResult.Output)" }
  if ($nativeResult.Output.Trim()) { Write-Host $nativeResult.Output.Trim() }
}

function Invoke-DbCaptureFile([string]$Path) {
  $nativeResult = Invoke-ManagedNativeCommand -ExecutablePath $script:psqlPath -Arguments @(
    '--no-password', '--no-psqlrc', '--quiet', '--tuples-only', '--no-align',
    '--set', 'ON_ERROR_STOP=1', '--host', $script:dbTarget.Host, '--port', [string]$script:dbTarget.Port,
    '--username', $script:dbTarget.Username, '--dbname', 'postgres', '--file', $Path
  )
  if ($nativeResult.ExitCode -ne 0) { Stop-Safely "catalog query failed: $($nativeResult.Output)" }
  return $nativeResult.Output.Trim()
}

function Get-ManagedEmptyState {
  Invoke-DbFile (Join-Path $bootstrap 'managed-preflight.sql')
  $identityParts = (Invoke-DbQuery "SELECT current_database() || '|' || current_user;") -split '\|', 2
  $publicCount = [int64](Invoke-DbQuery "SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f');")
  $ledgerExists = (Invoke-DbQuery "SELECT (pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL)::text;") -eq 'true'
  $ledgerCount = 0
  if ($ledgerExists) { $ledgerCount = [int64](Invoke-DbQuery 'SELECT count(*) FROM supabase_migrations.schema_migrations;') }
  $applicationSchemaCount = [int64](Invoke-DbQuery "SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname LIKE 'al\_%' ESCAPE '\';")
  $dataCounts = @{}
  foreach ($table in @('auth.users','auth.identities','auth.sessions','auth.refresh_tokens','auth.mfa_factors','storage.objects','storage.buckets','cron.job')) {
    $exists = (Invoke-DbQuery "SELECT (pg_catalog.to_regclass('$table') IS NOT NULL)::text;") -eq 'true'
    $dataCounts[$table] = if ($exists) { [int64](Invoke-DbQuery "SELECT count(*) FROM $table;") } else { 0 }
  }
  $state = [pscustomobject]@{
    Database = $identityParts[0]
    EffectiveUser = $identityParts[1]
    ServerVersionMajor = [int](Invoke-DbQuery "SELECT current_setting('server_version_num')::integer / 10000;")
    ServerVersion = Invoke-DbQuery "SELECT current_setting('server_version');"
    PublicObjects = $publicCount
    MigrationLedgerExists = $ledgerExists
    MigrationLedgerRows = $ledgerCount
    ApplicationSchemaCount = $applicationSchemaCount
    UserDataCounts = $dataCounts
  }
  try { Assert-EmptyDatabaseState -State $state | Out-Null }
  catch { Stop-Safely $_.Exception.Message }
  return $state
}

function Get-Utf8Sha256([string]$Text) {
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Text)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Assert-CheckpointArtifact([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Stop-Safely "checkpoint artifact was not created: $([IO.Path]::GetFileName($Path))" }
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -le 0 -or -not ($item.Attributes -band [IO.FileAttributes]::ReadOnly)) {
    Stop-Safely "checkpoint artifact is empty or not read-only: $([IO.Path]::GetFileName($Path))"
  }
}

function Invoke-Supabase([string[]]$Arguments, [switch]$Capture) {
  $nativeResult = Invoke-ManagedNativeCommand -ExecutablePath $script:supabasePath -Arguments $Arguments
  try {
    $output = Complete-ManagedCliResult -ExitCode $nativeResult.ExitCode -Output $nativeResult.Output -Label 'Supabase CLI' -Secret $env:SUPABASE_DB_PASSWORD
  } catch { Stop-Safely $_.Exception.Message }
  if ($Capture) { return $output }
  if ($output.Trim()) { Write-Host $output.Trim() }
}

try {
  $expectedMigrations = Get-ExpectedVersions
  $versions = @($expectedMigrations.Versions)
  $evidence = $expectedMigrations.Evidence
  if ($ValidateFilesOnly) {
    Write-Host "File validation PASS: exact baseline hash and $($versions.Count) ordered migrations match strict replay evidence."
    exit 0
  }

  if (-not $ProjectRef) { Stop-Safely 'provide an exact 20-character Supabase project reference' }
  if (-not $DatabaseHost) { Stop-Safely 'provide an explicitly approved database hostname' }
  if (-not $DatabaseUsername) {
    if ($ConnectionMode -eq 'SessionPooler') { $DatabaseUsername = "postgres.$ProjectRef" }
    else { $DatabaseUsername = 'postgres' }
  }
  try {
    $script:dbTarget = Assert-ManagedTarget -ProjectRef $ProjectRef -DatabaseHost $DatabaseHost `
      -DatabasePort $DatabasePort -DatabaseUsername $DatabaseUsername -ConnectionMode $ConnectionMode `
      -StagingRef $stagingRef
  } catch { Stop-Safely $_.Exception.Message }
  if (-not $env:SUPABASE_DB_PASSWORD) { Stop-Safely 'set SUPABASE_DB_PASSWORD in the local process environment; never pass it as a CLI argument or store it in a file' }
  $env:PGPASSWORD = $env:SUPABASE_DB_PASSWORD
  $env:PGSSLMODE = 'require'
  $setPgPassword = $true
  $script:psqlPath = (Get-Command psql -ErrorAction Stop).Source
  $script:supabasePath = (Get-Command supabase -ErrorAction Stop).Source
  $cliVersionResult = Invoke-ManagedNativeCommand -ExecutablePath $script:supabasePath -Arguments @('--version')
  try { $validatedCliVersion = Assert-SupabaseCliVersion -ExitCode $cliVersionResult.ExitCode -Output $cliVersionResult.Output }
  catch { Stop-Safely $_.Exception.Message }
  Write-Host "Supabase CLI compatibility PASS: version $validatedCliVersion; explicit --db-url mode only."
  $script:pythonPath = (Get-Command python -ErrorAction Stop).Source
  & $script:pythonPath -c 'import sqlalchemy' 2>$null
  if ($LASTEXITCODE -ne 0) { Stop-Safely 'install supabase/bootstrap/requirements.txt before applying; catalog comparison uses the validated schema checker' }
  # Verify owner account access and exact selected project before DB access.
  $projectsJson = Invoke-Supabase -Arguments @('projects', 'list', '--output', 'json') -Capture
  try { $projects = $projectsJson | ConvertFrom-Json } catch { Stop-Safely 'projects list did not return parseable JSON' }
  if ($projects -isnot [System.Array]) { Stop-Safely 'unexpected projects list shape; refusing to infer the selected project' }
  $matches = @($projects | Where-Object { $_.ref -eq $ProjectRef -or $_.id -eq $ProjectRef -or $_.project_ref -eq $ProjectRef })
  if ($matches.Count -ne 1) { Stop-Safely 'authenticated Supabase account does not identify exactly one project with this reference' }

  # Read-only identity and emptiness checks. No database changes occur here.
  $identity = Invoke-DbQuery "SELECT current_database() || '|' || current_user;"
  if ($identity -ne 'postgres|postgres') { Stop-Safely 'database identity is not postgres/postgres' }
  $initialEmptyState = Get-ManagedEmptyState
  Write-Host "Read-only preflight PASS: project $ProjectRef; database postgres; public schema empty; migration ledger empty."

  if (-not $Apply) {
    Write-Host 'No changes made. Re-run with -Apply after the project, backup/recovery checkpoint, and maintenance window are explicitly approved.'
    exit 0
  }
  if (-not $CheckpointDirectory) { Stop-Safely 'provide a protected checkpoint directory outside the repository' }
  if ($EmptyDatabasePsqlCheckpoint) {
    try { Assert-EmptyPsqlCheckpointAllowed -Target $script:dbTarget | Out-Null }
    catch { Stop-Safely $_.Exception.Message }
  }
  $pgDumpPath = $null
  if (-not $EmptyDatabasePsqlCheckpoint) {
    # Detect Windows Application Control before confirmation or database writes.
    try { $pgDumpPath = (Get-Command pg_dump -ErrorAction Stop).Source }
    catch { Stop-Safely 'pg_dump is unavailable; use the guarded psql empty-database checkpoint only for the authorized empty production target, or obtain an approved client' }
    try {
      Assert-CheckpointTool -ToolPath $pgDumpPath -Runner {
        param($path)
        $versionOutput = & $path --version 2>&1 | Out-String
        [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $versionOutput }
      } | Out-Null
    } catch { Stop-Safely 'pg_dump failed its execution check; use the guarded psql empty-database checkpoint only for the authorized empty production target, or obtain an approved client' }
  }
  $typed = Read-Host "Type APPLY EMPTY SUPABASE PROJECT $ProjectRef to proceed"
  if ($typed -cne "APPLY EMPTY SUPABASE PROJECT $ProjectRef") { Stop-Safely 'typed target confirmation did not match' }
  try { $checkpoint = New-ManagedProtectedCheckpointDirectory -Path $CheckpointDirectory -RepositoryRoot $root }
  catch { Stop-Safely $_.Exception.Message }

  $checkpointFiles = @()
  if ($EmptyDatabasePsqlCheckpoint) {
    $emptyStateBeforeSnapshot = Get-ManagedEmptyState
    $catalogSqlPath = Join-Path $bootstrap 'managed-empty-checkpoint.sql'
    $catalogSnapshot = Invoke-DbCaptureFile $catalogSqlPath
    if ([string]::IsNullOrWhiteSpace($catalogSnapshot)) { Stop-Safely 'read-only catalog snapshot returned no content' }
    $catalogDigest = Get-Utf8Sha256 $catalogSnapshot
    $snapshotPath = Join-Path $checkpoint 'production-empty-database-catalog.json'
    $snapshotArtifact = Write-ManagedReadOnlyCheckpointFile -Path $snapshotPath -Content ($catalogSnapshot + "`n")
    Assert-CheckpointArtifact $snapshotPath

    $projectIdentity = [ordered]@{ project_ref = $ProjectRef }
    foreach ($field in @('name','organization_id','region','status','id')) {
      if ($matches[0].PSObject.Properties.Name -contains $field) { $projectIdentity[$field] = $matches[0].$field }
    }
    try {
      $checkpointManifest = New-ManagedCheckpointManifest -ProjectRef $ProjectRef -ProjectIdentity $projectIdentity `
        -DatabaseState $emptyStateBeforeSnapshot -SnapshotArtifact $snapshotArtifact `
        -SnapshotFile ([IO.Path]::GetFileName($snapshotPath)) -CatalogDigest $catalogDigest `
        -BaselineSha256 (Get-LfSha256 (Join-Path $bootstrap 'application.sql')) -Migrations $evidence.migrations
    } catch { Stop-Safely $_.Exception.Message }
    $manifestPath = Join-Path $checkpoint 'checkpoint-manifest.json'
    Write-ManagedReadOnlyCheckpointFile -Path $manifestPath -Content ($checkpointManifest | ConvertTo-Json -Depth 8) | Out-Null
    Assert-CheckpointArtifact $manifestPath
    $checkpointFiles += $snapshotPath, $manifestPath

    # Re-run emptiness and catalog checks after the checkpoint files exist.
    $emptyStateAfterSnapshot = Get-ManagedEmptyState
    $catalogAfterSnapshot = Invoke-DbCaptureFile $catalogSqlPath
    try { Assert-CatalogSnapshotStable -BeforeSha256 $catalogDigest -AfterSha256 (Get-Utf8Sha256 $catalogAfterSnapshot) | Out-Null }
    catch { Stop-Safely $_.Exception.Message }
    $recheck = [ordered]@{
      project_ref = $ProjectRef
      checked_at_utc = [DateTime]::UtcNow.ToString('o')
      result = 'EMPTY_AND_CATALOG_UNCHANGED'
      server_version = $emptyStateAfterSnapshot.ServerVersion
      public_objects = $emptyStateAfterSnapshot.PublicObjects
      migration_ledger_exists = $emptyStateAfterSnapshot.MigrationLedgerExists
      migration_ledger_rows = $emptyStateAfterSnapshot.MigrationLedgerRows
      application_schema_count = $emptyStateAfterSnapshot.ApplicationSchemaCount
      relevant_user_data_rows = $emptyStateAfterSnapshot.UserDataCounts
      catalog_sha256 = Get-Utf8Sha256 $catalogAfterSnapshot
    }
    $recheckPath = Join-Path $checkpoint 'prewrite-empty-recheck.json'
    Write-ManagedReadOnlyCheckpointFile -Path $recheckPath -Content ($recheck | ConvertTo-Json -Depth 6) | Out-Null
    Assert-CheckpointArtifact $recheckPath
    $checkpointFiles += $recheckPath
  } else {
    $emptyStateBeforeCheckpoint = Get-ManagedEmptyState
    $emptySchemaPath = Join-Path $checkpoint 'empty-public-schema.sql'
    & $pgDumpPath --no-password --schema-only --schema=public --host $script:dbTarget.Host --port $script:dbTarget.Port `
      --username $script:dbTarget.Username --dbname postgres --file $emptySchemaPath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $emptySchemaPath) -or (Get-Item -LiteralPath $emptySchemaPath).Length -eq 0) {
      Stop-Safely 'could not establish the pre-change schema checkpoint; no SQL changes were attempted'
    }
    [IO.File]::SetAttributes($emptySchemaPath, (Get-Item $emptySchemaPath).Attributes -bor [IO.FileAttributes]::ReadOnly)
    Assert-CheckpointArtifact $emptySchemaPath
    $checkpointManifest = [ordered]@{
      checkpoint_kind = 'pg_dump-public-schema-only'
      restorable_backup = $false
      warning = 'NOT A RESTORABLE BACKUP. This schema-only checkpoint does not contain database data.'
      project_identity = [ordered]@{ project_ref = $ProjectRef }
      connection = [ordered]@{ mode = $ConnectionMode; host = $script:dbTarget.Host; port = $script:dbTarget.Port; username = $script:dbTarget.Username; sslmode = 'require' }
      database = [ordered]@{ name = 'postgres'; role = 'postgres'; server_version = $emptyStateBeforeCheckpoint.ServerVersion; server_major = $emptyStateBeforeCheckpoint.ServerVersionMajor }
      public_schema_objects = $emptyStateBeforeCheckpoint.PublicObjects
      migration_ledger_exists = $emptyStateBeforeCheckpoint.MigrationLedgerExists
      migration_ledger_rows = $emptyStateBeforeCheckpoint.MigrationLedgerRows
      migrations = @($evidence.migrations | ForEach-Object { [ordered]@{ file = $_.file; sha256_raw = $_.sha256_raw } })
      application_bootstrap_sha256_lf = Get-LfSha256 (Join-Path $bootstrap 'application.sql')
      recorded_at_utc = [DateTime]::UtcNow.ToString('o')
    }
    $manifestPath = Join-Path $checkpoint 'checkpoint-manifest.json'
    Write-ManagedReadOnlyCheckpointFile -Path $manifestPath -Content ($checkpointManifest | ConvertTo-Json -Depth 8) | Out-Null
    Assert-CheckpointArtifact $manifestPath
    $checkpointFiles += $emptySchemaPath, $manifestPath
    Get-ManagedEmptyState | Out-Null
  }
  foreach ($artifactPath in $checkpointFiles) { Assert-CheckpointArtifact $artifactPath }
  Write-Host "Checkpoint PASS: $($checkpointFiles.Count) protected artifacts outside the repository. This is NOT a restorable backup."

  # Exercise this exact CLI's explicit URL mode and complete dry run before any
  # managed prerequisite or baseline SQL can change the target.
  $workdir = Join-Path ([IO.Path]::GetTempPath()) ("adaptive-lifting-prod-bootstrap-" + [guid]::NewGuid().ToString('N'))
  $supabaseDir = Join-Path $workdir 'supabase'
  New-Item -ItemType Directory -Path (Join-Path $supabaseDir 'migrations') -Force | Out-Null
  @'
project_id = "adaptive-lifting-production-bootstrap"
[db]
major_version = 17
[db.migrations]
enabled = true
schema_paths = []
[db.seed]
enabled = false
'@ | ForEach-Object { [IO.File]::WriteAllText((Join-Path $supabaseDir 'config.toml'), $_, [Text.UTF8Encoding]::new($false)) }
  Copy-Item (Join-Path $migrationDir '*.sql') (Join-Path $supabaseDir 'migrations')
  $dryRunArgs = Get-ManagedMigrationCliArguments -Action DryRun -Workdir $workdir -ProjectRef $ProjectRef -DbUrl $script:dbTarget.CliDbUrl
  $prewriteDryRun = Invoke-Supabase -Arguments $dryRunArgs -Capture
  Assert-VersionList (Get-VersionIds $prewriteDryRun) $versions 'prewrite migration dry run'
  Write-Host 'Prewrite CLI check PASS: pinned CLI connected through the explicit production URL and reported exactly 63 migrations; no database writes have occurred.'

  # Managed extensions/services first, then the explicit historical baseline.
  Invoke-DbFile (Join-Path $bootstrap 'managed-prerequisites.sql')
  Invoke-DbFile (Join-Path $bootstrap 'application.sql')
  $tableCount = [int](Invoke-DbQuery "SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> 'alembic_version';")
  if ($tableCount -ne 35) { Stop-Safely "baseline verification failed after write (expected 35 tables, found $tableCount); preserve state and do not rerun" }

  $migrationListArgs = Get-ManagedMigrationCliArguments -Action List -Workdir $workdir -ProjectRef $ProjectRef -DbUrl $script:dbTarget.CliDbUrl
  $migrationList = Invoke-Supabase -Arguments $migrationListArgs -Capture
  Assert-VersionList (Get-VersionIds $migrationList) $versions 'explicit-target migration list'
  $dryRunArgs = Get-ManagedMigrationCliArguments -Action DryRun -Workdir $workdir -ProjectRef $ProjectRef -DbUrl $script:dbTarget.CliDbUrl
  $dryRun = Invoke-Supabase -Arguments $dryRunArgs -Capture
  Assert-VersionList (Get-VersionIds $dryRun) $versions 'migration dry run'
  Write-Host 'Dry run PASS: exactly the 63 checked-in version IDs would be applied.'

  $pushArgs = Get-ManagedMigrationCliArguments -Action Push -Workdir $workdir -ProjectRef $ProjectRef -DbUrl $script:dbTarget.CliDbUrl
  Invoke-Supabase -Arguments $pushArgs
  $ledgerOutput = Invoke-DbQuery 'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;'
  $ledger = @($ledgerOutput -split "`r?`n" | Where-Object { $_ -match '^\d{14}$' })
  Assert-VersionList $ledger $versions 'database migration ledger'
  Invoke-DbFile (Join-Path $bootstrap 'managed-postflight.sql')
  $catalogPath = Join-Path $checkpoint 'managed-catalog.json'
  $catalogOutput = Invoke-DbCaptureFile (Join-Path $bootstrap 'catalog.sql')
  Set-Content -LiteralPath $catalogPath -Value $catalogOutput -Encoding utf8
  $comparison = & $script:pythonPath (Join-Path $bootstrap 'verify-managed-catalog.py') $catalogPath 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Stop-Safely "managed catalog differs from validated schema: $comparison" }
  Write-Host $comparison.Trim()
  Invoke-DbFile (Join-Path $bootstrap 'test_behavior.sql')
  $finalListArgs = Get-ManagedMigrationCliArguments -Action List -Workdir $workdir -ProjectRef $ProjectRef -DbUrl $script:dbTarget.CliDbUrl
  $finalList = Invoke-Supabase -Arguments $finalListArgs -Capture
  Assert-VersionList (Get-VersionIds $finalList) $versions 'final CLI migration list'
  Write-Host 'Managed bootstrap PASS: explicit baseline, 63/63 migrations, exact ledger and postflight assertions.'
  Write-Host 'Preserve checkpoint and project state. Synthetic tests should use dedicated test accounts and clean only their own records.'
} catch {
  Write-Host "ERROR: $_" -ForegroundColor Red
  Write-Host 'STOP. Do not rerun bootstrap or push migrations blindly. Preserve the project and checkpoint; inspect the exact partial state and use a reviewed forward fix.' -ForegroundColor Red
  exit 1
} finally {
  if ($setPgPassword) {
    $env:PGPASSWORD = $previousPgPassword
    $env:PGSSLMODE = $previousPgSslMode
  }
}
