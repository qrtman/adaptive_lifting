[CmdletBinding()]
param(
  [ValidatePattern('^[a-z0-9]{20}$')]
  [string]$ProjectRef,

  [ValidatePattern('^db\.[a-z0-9]{20}\.supabase\.(co|com)$')]
  [string]$DatabaseHost,

  [string]$CheckpointDirectory,
  [switch]$Apply,
  [switch]$ValidateFilesOnly
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$bootstrap = Join-Path $root 'supabase\bootstrap'
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
  return ,$versions
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
  $a = @($Actual | Sort-Object -Unique)
  $e = @($Expected | Sort-Object -Unique)
  if (($a -join ',') -ne ($e -join ',')) {
    Stop-Safely "$Label version set differs from the checked-in 63 migrations"
  }
}

function Invoke-DbQuery([string]$Sql) {
  $result = & $script:psqlPath --no-password --no-psqlrc --quiet --tuples-only --no-align `
    --set ON_ERROR_STOP=1 --host $DatabaseHost --port 5432 --username postgres --dbname postgres `
    --command $Sql 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Stop-Safely "read-only psql query failed: $result" }
  return $result.Trim()
}

function Invoke-DbFile([string]$Path) {
  $result = & $script:psqlPath --no-password --no-psqlrc --quiet `
    --set ON_ERROR_STOP=1 --host $DatabaseHost --port 5432 --username postgres --dbname postgres `
    --file $Path 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Stop-Safely "SQL file failed; target may be partially changed. Preserve it and inspect before recovery: $result" }
  if ($result.Trim()) { Write-Host $result.Trim() }
}

function Invoke-DbCaptureFile([string]$Path) {
  $result = & $script:psqlPath --no-password --no-psqlrc --quiet --tuples-only --no-align `
    --set ON_ERROR_STOP=1 --host $DatabaseHost --port 5432 --username postgres --dbname postgres `
    --file $Path 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Stop-Safely "catalog query failed: $result" }
  return $result.Trim()
}

function Invoke-Supabase([string[]]$Arguments, [switch]$Capture) {
  if ($Capture) {
    $output = & $script:supabasePath @Arguments 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Stop-Safely "Supabase CLI failed: $output" }
    return $output
  }
  & $script:supabasePath @Arguments
  if ($LASTEXITCODE -ne 0) { Stop-Safely "Supabase CLI failed with exit code $LASTEXITCODE" }
}

try {
  $versions = Get-ExpectedVersions
  if ($ValidateFilesOnly) {
    Write-Host "File validation PASS: exact baseline hash and $($versions.Count) ordered migrations match strict replay evidence."
    exit 0
  }

  if ($ProjectRef -notmatch '^[a-z0-9]{20}$') { Stop-Safely 'provide an exact 20-character Supabase project reference' }
  if ($DatabaseHost -notmatch '^db\.[a-z0-9]{20}\.supabase\.(co|com)$') { Stop-Safely 'provide the exact direct database hostname shown by the Supabase Dashboard' }
  if ($ProjectRef -eq $stagingRef) { Stop-Safely 'the staging project is not a production bootstrap target' }
  if ($DatabaseHost -notmatch "^db\.$([regex]::Escape($ProjectRef))\.supabase\.(co|com)$") { Stop-Safely 'database host does not match the explicitly supplied project reference' }
  if (-not $env:SUPABASE_DB_PASSWORD) { Stop-Safely 'set SUPABASE_DB_PASSWORD in the local process environment; never pass it as a CLI argument or store it in a file' }
  $env:PGPASSWORD = $env:SUPABASE_DB_PASSWORD
  $env:PGSSLMODE = 'require'
  $setPgPassword = $true
  $script:psqlPath = (Get-Command psql -ErrorAction Stop).Source
  $script:supabasePath = (Get-Command supabase -ErrorAction Stop).Source
  $script:pythonPath = (Get-Command python -ErrorAction Stop).Source
  & $script:pythonPath -c 'import sqlalchemy' 2>$null
  if ($LASTEXITCODE -ne 0) { Stop-Safely 'install supabase/bootstrap/requirements.txt before applying; catalog comparison uses the validated schema checker' }
  # Verify owner account access and exact selected project before DB access.
  $projectsJson = Invoke-Supabase -Arguments @('projects', 'list', '--output', 'json') -Capture
  try { $projects = $projectsJson | ConvertFrom-Json } catch { Stop-Safely 'projects list did not return parseable JSON' }
  if ($projects -isnot [System.Array]) { Stop-Safely 'unexpected projects list shape; refusing to infer the selected project' }
  $matches = @($projects | Where-Object { $_.ref -eq $ProjectRef -or $_.id -eq $ProjectRef -or $_.project_ref -eq $ProjectRef })
  if ($matches.Count -ne 1) { Stop-Safely 'authenticated Supabase account does not identify exactly one project with this reference' }

  # Read-only identity and emptiness checks. This transaction is the recovery
  # checkpoint for a new empty target; it deliberately contains only counts.
  $identity = Invoke-DbQuery "SELECT current_database() || '|' || current_user;"
  if ($identity -ne 'postgres|postgres') { Stop-Safely 'database identity is not postgres/postgres' }
  $serverMajor = [int](Invoke-DbQuery "SELECT current_setting('server_version_num')::integer / 10000;")
  if ($serverMajor -ne 17) { Stop-Safely "expected validated PostgreSQL major 17; found $serverMajor" }
  Invoke-DbFile (Join-Path $bootstrap 'managed-preflight.sql')
  $publicCount = [int](Invoke-DbQuery "SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f');")
  if ($publicCount -ne 0) { Stop-Safely "public application schema is not empty ($publicCount objects)" }
  $ledgerExists = Invoke-DbQuery "SELECT (pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL)::text;"
  if ($ledgerExists -eq 'true') {
    $ledgerCount = [int](Invoke-DbQuery 'SELECT count(*) FROM supabase_migrations.schema_migrations;')
    if ($ledgerCount -ne 0) { Stop-Safely "migration ledger is not empty ($ledgerCount rows)" }
  }
  Write-Host "Read-only preflight PASS: project $ProjectRef; database postgres; public schema empty; migration ledger empty."

  if (-not $Apply) {
    Write-Host 'No changes made. Re-run with -Apply after the project, backup/recovery checkpoint, and maintenance window are explicitly approved.'
    exit 0
  }
  if (-not $CheckpointDirectory) { Stop-Safely 'provide a protected checkpoint directory outside the repository' }
  $checkpoint = [IO.Path]::GetFullPath($CheckpointDirectory)
  if ($checkpoint.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    Stop-Safely 'checkpoint directory must be outside the repository'
  }
  $typed = Read-Host "Type APPLY EMPTY SUPABASE PROJECT $ProjectRef to proceed"
  if ($typed -cne "APPLY EMPTY SUPABASE PROJECT $ProjectRef") { Stop-Safely 'typed target confirmation did not match' }
  if (Test-Path -LiteralPath $checkpoint) { Stop-Safely 'checkpoint directory already exists; refusing to overwrite evidence' }
  New-Item -ItemType Directory -Path $checkpoint | Out-Null

  $pgDumpPath = (Get-Command pg_dump -ErrorAction Stop).Source
  $emptySchemaPath = Join-Path $checkpoint 'empty-public-schema.sql'
  & $pgDumpPath --no-password --schema-only --schema=public --host $DatabaseHost --port 5432 `
    --username postgres --dbname postgres --file $emptySchemaPath
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $emptySchemaPath)) {
    Stop-Safely 'could not establish the pre-change empty-schema checkpoint; no SQL changes were attempted'
  }
  $checkpointManifest = [ordered]@{
    project_ref = $ProjectRef
    database = 'postgres'
    public_schema_objects = 0
    migration_ledger_rows = 0
    migration_versions = $versions
    application_bootstrap_sha256_lf = Get-LfSha256 (Join-Path $bootstrap 'application.sql')
    recorded_at_utc = [DateTime]::UtcNow.ToString('o')
    note = 'Schema-only pre-bootstrap checkpoint; no user data. Not a verified restore rehearsal.'
  }
  $checkpointManifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $checkpoint 'checkpoint.json') -Encoding utf8

  # Managed extensions/services first, then the explicit historical baseline.
  Invoke-DbFile (Join-Path $bootstrap 'managed-prerequisites.sql')
  Invoke-DbFile (Join-Path $bootstrap 'application.sql')
  $tableCount = [int](Invoke-DbQuery "SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> 'alembic_version';")
  if ($tableCount -ne 35) { Stop-Safely "baseline verification failed after write (expected 35 tables, found $tableCount); preserve state and do not rerun" }

  # Isolated CLI workdir ensures this cannot use the repository's staging link.
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

  Invoke-Supabase -Arguments @('--workdir', $workdir, 'link', '--project-ref', $ProjectRef)
  $migrationList = Invoke-Supabase -Arguments @('--workdir', $workdir, 'migration', 'list', '--linked') -Capture
  Assert-VersionList (Get-VersionIds $migrationList) $versions 'linked migration list'
  $dryRun = Invoke-Supabase -Arguments @('--workdir', $workdir, 'db', 'push', '--linked', '--dry-run', '--skip-vault') -Capture
  Assert-VersionList (Get-VersionIds $dryRun) $versions 'migration dry run'
  Write-Host 'Dry run PASS: exactly the 63 checked-in version IDs would be applied.'

  Invoke-Supabase -Arguments @('--workdir', $workdir, 'db', 'push', '--linked', '--skip-vault')
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
  $finalList = Invoke-Supabase -Arguments @('--workdir', $workdir, 'migration', 'list', '--linked') -Capture
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
