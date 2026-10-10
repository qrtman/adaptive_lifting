$modulePath = Join-Path $PSScriptRoot 'managed-bootstrap-guards.psm1'
Import-Module $modulePath -Force

$prodRef = 'gadusaizqnshxqcckibq'
$stagingRef = 'admyuepbbtstayaydjmo'
$poolerHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$expectedPoolerUser = "postgres.$prodRef"

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

Describe 'Managed migration CLI safety' {
  It 'uses explicit project and session-pooler URL for list, dry-run and push' {
    $url = "postgresql://$expectedPoolerUser@$poolerHost`:5432/postgres?sslmode=require"
    $previousTestPassword = $env:SUPABASE_DB_PASSWORD
    $env:SUPABASE_DB_PASSWORD = 'test-only-secret-marker'
    try {
      foreach ($action in @('List', 'DryRun', 'Push')) {
        $args = Get-ManagedMigrationCliArguments -Action $action -Workdir 'C:\isolated\supabase' -ProjectRef $prodRef -DbUrl $url
        ($args -join ' ') | Should Match ([regex]::Escape($url))
        ($args -join ' ') | Should Match ([regex]::Escape($prodRef))
        ($args -join ' ') | Should Not Match 'password|--linked|--include-all'
        ($args -join ' ') | Should Not Match 'test-only-secret-marker'
      }
    } finally {
      if ($null -eq $previousTestPassword) { Remove-Item Env:\SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue }
      else { $env:SUPABASE_DB_PASSWORD = $previousTestPassword }
    }
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
