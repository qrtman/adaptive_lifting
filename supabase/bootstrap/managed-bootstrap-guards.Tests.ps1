$modulePath = Join-Path $PSScriptRoot 'managed-bootstrap-guards.psm1'
Import-Module $modulePath -Force

$prodRef = 'gadusaizqnshxqcckibq'
$stagingRef = 'admyuepbbtstayaydjmo'
$poolerHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$expectedPoolerUser = "postgres.$prodRef"

function New-EmptyTestState {
  $counts = @{}
  foreach ($table in @('auth.users','auth.identities','auth.sessions','auth.refresh_tokens','auth.mfa_factors','storage.objects','storage.buckets','cron.job')) { $counts[$table] = 0 }
  return [pscustomobject]@{
    Database = 'postgres'
    EffectiveUser = 'postgres'
    ServerVersionMajor = 17
    PublicObjects = 0
    MigrationLedgerExists = $false
    MigrationLedgerRows = 0
    ApplicationSchemaCount = 0
    UserDataCounts = $counts
  }
}

Describe 'Managed bootstrap target guards' {
  It 'accepts only the authorized production session pooler target' {
    $target = Assert-ManagedTarget -ProjectRef $prodRef -DatabaseHost $poolerHost -DatabasePort 5432 `
      -DatabaseUsername $expectedPoolerUser -ConnectionMode SessionPooler -StagingRef $stagingRef
    $target.ProjectRef | Should Be $prodRef
    $target.Host | Should Be $poolerHost
    $target.Port | Should Be 5432
    $target.Username | Should Be $expectedPoolerUser
    $target.SslMode | Should Be 'require'
  }

  It 'accepts the matching production direct endpoint when available' {
    $target = Assert-ManagedTarget -ProjectRef $prodRef -DatabaseHost "db.$prodRef.supabase.co" -DatabasePort 5432 `
      -DatabaseUsername 'postgres' -ConnectionMode Direct -StagingRef $stagingRef
    $target.Host | Should Be "db.$prodRef.supabase.co"
    $target.Username | Should Be 'postgres'
  }

  It 'rejects a different project reference for the approved pooler' {
    { Assert-ManagedTarget -ProjectRef 'abcdefghijklmnopqrst' -DatabaseHost $poolerHost -DatabasePort 5432 `
        -DatabaseUsername 'postgres.abcdefghijklmnopqrst' -ConnectionMode SessionPooler -StagingRef $stagingRef } | Should Throw
  }

  It 'rejects a different project reference even with a self-consistent direct host' {
    $otherRef = 'abcdefghijklmnopqrst'
    { Assert-ManagedTarget -ProjectRef $otherRef -DatabaseHost "db.$otherRef.supabase.co" -DatabasePort 5432 `
        -DatabaseUsername 'postgres' -ConnectionMode Direct -StagingRef $stagingRef } | Should Throw
  }

  It 'rejects a pooler username that is not project-qualified exactly' {
    { Assert-ManagedTarget -ProjectRef $prodRef -DatabaseHost $poolerHost -DatabasePort 5432 `
        -DatabaseUsername 'postgres' -ConnectionMode SessionPooler -StagingRef $stagingRef } | Should Throw
  }

  It 'rejects the staging project even when the host shape is otherwise plausible' {
    { Assert-ManagedTarget -ProjectRef $stagingRef -DatabaseHost "db.$stagingRef.supabase.co" -DatabasePort 5432 `
        -DatabaseUsername 'postgres' -ConnectionMode Direct -StagingRef $stagingRef } | Should Throw
  }

  It 'rejects transaction pooler port 6543' {
    { Assert-ManagedTarget -ProjectRef $prodRef -DatabaseHost $poolerHost -DatabasePort 6543 `
        -DatabaseUsername $expectedPoolerUser -ConnectionMode SessionPooler -StagingRef $stagingRef } | Should Throw
  }

  It 'rejects arbitrary hosts, including another pooler endpoint' {
    { Assert-ManagedTarget -ProjectRef $prodRef -DatabaseHost 'aws-0-ap-northeast-1.pooler.supabase.com' -DatabasePort 5432 `
        -DatabaseUsername $expectedPoolerUser -ConnectionMode SessionPooler -StagingRef $stagingRef } | Should Throw
  }
}

Describe 'psql empty-database checkpoint gates' {
  It 'permits the fallback only for the exact production Session Pooler target' {
    $target = Assert-ManagedTarget -ProjectRef $prodRef -DatabaseHost $poolerHost -DatabasePort 5432 `
      -DatabaseUsername $expectedPoolerUser -ConnectionMode SessionPooler -StagingRef $stagingRef
    Assert-EmptyPsqlCheckpointAllowed -Target $target | Should Be $true
  }

  It 'rejects the fallback for direct mode, another project, or another host' {
    $direct = Assert-ManagedTarget -ProjectRef $prodRef -DatabaseHost "db.$prodRef.supabase.co" -DatabasePort 5432 `
      -DatabaseUsername 'postgres' -ConnectionMode Direct -StagingRef $stagingRef
    { Assert-EmptyPsqlCheckpointAllowed -Target $direct } | Should Throw
    $bad = [pscustomobject]@{ ProjectRef=$prodRef; Mode='SessionPooler'; Host='aws-0-ap-northeast-1.pooler.supabase.com'; Port=5432; Username=$expectedPoolerUser }
    { Assert-EmptyPsqlCheckpointAllowed -Target $bad } | Should Throw
    $bad = [pscustomobject]@{ ProjectRef=$prodRef; Mode='SessionPooler'; Host=$poolerHost; Port=6543; Username=$expectedPoolerUser }
    { Assert-EmptyPsqlCheckpointAllowed -Target $bad } | Should Throw
    $bad = [pscustomobject]@{ ProjectRef=$prodRef; Mode='SessionPooler'; Host=$poolerHost; Port=5432; Username='postgres' }
    { Assert-EmptyPsqlCheckpointAllowed -Target $bad } | Should Throw
    $bad = [pscustomobject]@{ ProjectRef=$stagingRef; Mode='SessionPooler'; Host=$poolerHost; Port=5432; Username="postgres.$stagingRef" }
    { Assert-EmptyPsqlCheckpointAllowed -Target $bad } | Should Throw
  }

  It 'accepts a fully empty database state' {
    Assert-EmptyDatabaseState -State (New-EmptyTestState) | Should Be $true
  }

  It 'rejects public objects, application schemas, migration history, and wrong server identity/version' {
    foreach ($property in @('PublicObjects','ApplicationSchemaCount','MigrationLedgerRows')) {
      $state = New-EmptyTestState
      $state.$property = 1
      { Assert-EmptyDatabaseState -State $state } | Should Throw
    }
    $state = New-EmptyTestState; $state.EffectiveUser = 'other'
    { Assert-EmptyDatabaseState -State $state } | Should Throw
    $state = New-EmptyTestState; $state.ServerVersionMajor = 18
    { Assert-EmptyDatabaseState -State $state } | Should Throw
  }

  It 'rejects nonzero rows in each Auth or Storage user-data table' {
    foreach ($table in @('auth.users','auth.identities','auth.sessions','auth.refresh_tokens','auth.mfa_factors','storage.objects','storage.buckets','cron.job')) {
      $state = New-EmptyTestState
      $state.UserDataCounts[$table] = 1
      { Assert-EmptyDatabaseState -State $state } | Should Throw
    }
  }

  It 'rejects a missing user-data check instead of treating it as empty' {
    $state = New-EmptyTestState
    $state.UserDataCounts.Remove('auth.identities')
    { Assert-EmptyDatabaseState -State $state } | Should Throw
  }

  It 'rejects a catalog that changed between capture and prewrite recheck' {
    { Assert-CatalogSnapshotStable -BeforeSha256 ('a' * 64) -AfterSha256 ('b' * 64) } | Should Throw
    Assert-CatalogSnapshotStable -BeforeSha256 ('a' * 64) -AfterSha256 ('a' * 64) | Should Be $true
  }

  It 'creates a private checkpoint directory outside the repository and refuses an existing target' {
    $temp = Join-Path $env:TEMP ("bootstrap-acl-test-" + [guid]::NewGuid().ToString('N'))
    try {
      $created = New-ManagedProtectedCheckpointDirectory -Path $temp -RepositoryRoot $PSScriptRoot
      (Get-Acl -LiteralPath $created).AreAccessRulesProtected | Should Be $true
      { New-ManagedProtectedCheckpointDirectory -Path $temp -RepositoryRoot $PSScriptRoot } | Should Throw
      { New-ManagedProtectedCheckpointDirectory -Path (Join-Path $PSScriptRoot 'checkpoint-test') -RepositoryRoot $PSScriptRoot } | Should Throw
    } finally {
      if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
    }
  }

  It 'rejects a missing checkpoint parent before attempting to create evidence' {
    $missingParent = Join-Path $env:TEMP ("missing-parent-" + [guid]::NewGuid().ToString('N'))
    { New-ManagedProtectedCheckpointDirectory -Path (Join-Path $missingParent 'checkpoint') -RepositoryRoot $PSScriptRoot } | Should Throw
  }

  It 'writes nonempty checkpoint files atomically and marks them read-only' {
    $dir = Join-Path $env:TEMP ("bootstrap-file-test-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    $file = Join-Path $dir 'snapshot.json'
    try {
      $result = Write-ManagedReadOnlyCheckpointFile -Path $file -Content '{"snapshot":true}'
      $result.Length | Should BeGreaterThan 0
      $result.ReadOnly | Should Be $true
      ((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReadOnly) | Should Not Be 0
      { Write-ManagedReadOnlyCheckpointFile -Path $file -Content 'overwrite' } | Should Throw
      { Write-ManagedReadOnlyCheckpointFile -Path (Join-Path $dir 'empty.json') -Content '' } | Should Throw
    } finally {
      if (Test-Path -LiteralPath $file) { [IO.File]::SetAttributes($file, [IO.FileAttributes]::Normal) }
      Remove-Item -LiteralPath $dir -Recurse -Force
    }
  }
}

Describe 'Managed migration CLI safety' {
  It 'uses only the exact password-free production URL for list, dry-run and push without a linked ref' {
    $url = "postgresql://$expectedPoolerUser@$poolerHost`:5432/postgres?sslmode=require"
    $previousTestPassword = $env:SUPABASE_DB_PASSWORD
    $previousPgPassword = $env:PGPASSWORD
    $env:SUPABASE_DB_PASSWORD = 'test-only-secret-marker'
    $env:PGPASSWORD = 'test-only-pg-secret-marker'
    try {
      foreach ($action in @('List', 'DryRun', 'Push')) {
        $args = Get-ManagedMigrationCliArguments -Action $action -Workdir 'C:\isolated\supabase' -ProjectRef $prodRef -DbUrl $url
        ($args -join ' ') | Should Match ([regex]::Escape($url))
        ($args -join ' ') | Should Not Match '--project-ref|--linked|--include-all'
        ($args -join ' ') | Should Not Match 'test-only-secret-marker'
        ($args -join ' ') | Should Not Match 'test-only-pg-secret-marker'
      }
    } finally {
      if ($null -eq $previousTestPassword) { Remove-Item Env:\SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue }
      else { $env:SUPABASE_DB_PASSWORD = $previousTestPassword }
      if ($null -eq $previousPgPassword) { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
      else { $env:PGPASSWORD = $previousPgPassword }
    }
  }

  It 'rejects a non-production or password-bearing migration URL' {
    { Get-ManagedMigrationCliArguments -Action List -Workdir 'C:\isolated\supabase' -ProjectRef $stagingRef -DbUrl "postgresql://postgres.$stagingRef@aws-0-ap-northeast-2.pooler.supabase.com`:5432/postgres?sslmode=require" } | Should Throw
    { Get-ManagedMigrationCliArguments -Action List -Workdir 'C:\isolated\supabase' -ProjectRef $prodRef -DbUrl "postgresql://postgres:secret@$poolerHost`:5432/postgres?sslmode=require" } | Should Throw
    { Get-ManagedMigrationCliArguments -Action List -Workdir 'C:\isolated\supabase' -ProjectRef $prodRef -DbUrl "postgresql://$expectedPoolerUser@aws-0-ap-northeast-1.pooler.supabase.com`:5432/postgres?sslmode=require" } | Should Throw
  }

  It 'pins the migration workflow to the CLI version verified for explicit db-url mode' {
    Assert-SupabaseCliVersion -ExitCode 0 -Output "2.120.0`n" | Should Be '2.120.0'
    Assert-SupabaseCliVersion -ExitCode 0 -Output "supabase 2.120.0`n" | Should Be '2.120.0'
    { Assert-SupabaseCliVersion -ExitCode 0 -Output '2.121.0' } | Should Throw
    { Assert-SupabaseCliVersion -ExitCode 1 -Output '2.120.0' } | Should Throw
  }

  It 'runs the pinned CLI version check and 63-migration dry run before the first managed SQL write' {
    $scriptPath = Join-Path $PSScriptRoot 'deploy-managed.ps1'
    $scriptText = Get-Content -LiteralPath $scriptPath -Raw
    $versionCheck = $scriptText.IndexOf('Assert-SupabaseCliVersion')
    $prewriteDryRun = $scriptText.IndexOf('$prewriteDryRun = Invoke-Supabase')
    $firstDatabaseWrite = $scriptText.IndexOf("Invoke-DbFile (Join-Path `$bootstrap 'managed-prerequisites.sql')")
    $versionCheck | Should BeGreaterThan -1
    $prewriteDryRun | Should BeGreaterThan $versionCheck
    $firstDatabaseWrite | Should BeGreaterThan $prewriteDryRun
  }

  It 'writes the checkpoint manifest with exactly 63 migration filenames and hashes' {
    $evidencePath = Join-Path $PSScriptRoot 'verification-revisions.json'
    $evidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
    $state = New-EmptyTestState
    $state | Add-Member -NotePropertyName ServerVersion -NotePropertyValue '17.11'
    $identity = [ordered]@{ project_ref = $prodRef; name = 'adaptive-lifting-production' }
    $artifact = [pscustomobject]@{ Length = 18; Sha256 = 'a' * 64 }
    $manifest = New-ManagedCheckpointManifest -ProjectRef $prodRef -ProjectIdentity $identity `
      -DatabaseState $state -SnapshotArtifact $artifact -SnapshotFile 'catalog.json' `
      -CatalogDigest ('b' * 64) -BaselineSha256 ('c' * 64) -Migrations $evidence.migrations
    $dir = Join-Path $env:TEMP ("bootstrap-manifest-test-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    $path = Join-Path $dir 'checkpoint-manifest.json'
    try {
      Write-ManagedReadOnlyCheckpointFile -Path $path -Content ($manifest | ConvertTo-Json -Depth 8) | Out-Null
      $written = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
      $written.restorable_backup | Should Be $false
      $written.migrations.Count | Should Be 63
      for ($index = 0; $index -lt 63; $index++) {
        $written.migrations[$index].file | Should Be $evidence.migrations[$index].file
        $written.migrations[$index].sha256_raw | Should Be $evidence.migrations[$index].sha256_raw
      }
    } finally {
      if (Test-Path -LiteralPath $path) { [IO.File]::SetAttributes($path, [IO.FileAttributes]::Normal) }
      Remove-Item -LiteralPath $dir -Recurse -Force
    }
  }

  It 'rejects incomplete or malformed checkpoint migration hash evidence' {
    $evidence = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'verification-revisions.json') -Raw | ConvertFrom-Json
    $state = New-EmptyTestState
    $state | Add-Member -NotePropertyName ServerVersion -NotePropertyValue '17.11'
    $manifestArgs = @{
      ProjectRef = $prodRef
      ProjectIdentity = [ordered]@{ project_ref = $prodRef }
      DatabaseState = $state
      SnapshotArtifact = [pscustomobject]@{ Length = 1; Sha256 = 'a' * 64 }
      SnapshotFile = 'catalog.json'
      CatalogDigest = 'b' * 64
      BaselineSha256 = 'c' * 64
    }
    { New-ManagedCheckpointManifest @manifestArgs -Migrations $evidence.migrations[0..61] } | Should Throw
    $badMigrations = @($evidence.migrations)
    $badMigrations[10] = [pscustomobject]@{ file = $badMigrations[10].file; sha256_raw = 'not-a-hash' }
    { New-ManagedCheckpointManifest @manifestArgs -Migrations $badMigrations } | Should Throw
  }

  It 'rejects a mismatched remote migration ledger version set' {
    { Assert-ManagedVersionList -Actual @('20261010120000') -Expected @('20261010120000', '20261011120000') -Label 'database ledger' } | Should Throw
  }

  It 'rejects a failed or incomplete migration dry run' {
    { Assert-ManagedVersionList -Actual @('20261010120000') -Expected @('20261010120000', '20261011120000') -Label 'migration dry run' } | Should Throw
  }

  It 'fails closed when the CLI dry-run exits unsuccessfully and redacts the environment secret' {
    $message = ''
    try { Complete-ManagedCliResult -ExitCode 1 -Output 'error for test-only-secret-marker' -Label 'migration dry run' -Secret 'test-only-secret-marker' | Out-Null }
    catch { $message = $_.Exception.Message }
    $message | Should Match '\[redacted\]'
    $message | Should Not Match 'test-only-secret-marker'
  }
}

Describe 'Checkpoint executable gate' {
  It 'rejects a missing pg_dump executable' {
    { Assert-CheckpointTool -ToolPath (Join-Path $env:TEMP 'missing-pg_dump-executable.exe') -Runner { param($path) $null } } | Should Throw
  }

  It 'rejects pg_dump when Application Control or execution failure prevents startup' {
    $fake = Join-Path $env:TEMP ("pg_dump-test-" + [guid]::NewGuid().ToString('N') + '.exe')
    Set-Content -LiteralPath $fake -Value 'test stub' -Encoding ascii
    try {
      { Assert-CheckpointTool -ToolPath $fake -Runner { param($path) [pscustomobject]@{ ExitCode = 126; Output = 'execution denied' } } } | Should Throw
    } finally {
      Remove-Item -LiteralPath $fake -Force
    }
  }

  It 'accepts a pg_dump executable only after a successful version check' {
    $fake = Join-Path $env:TEMP ("pg_dump-test-" + [guid]::NewGuid().ToString('N') + '.exe')
    Set-Content -LiteralPath $fake -Value 'test stub' -Encoding ascii
    try {
      Assert-CheckpointTool -ToolPath $fake -Runner { param($path) [pscustomobject]@{ ExitCode = 0; Output = 'pg_dump (PostgreSQL) 18.6' } } | Should Be $fake
    } finally {
      Remove-Item -LiteralPath $fake -Force
    }
  }
}
