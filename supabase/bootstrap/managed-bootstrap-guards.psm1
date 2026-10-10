Set-StrictMode -Version Latest

$script:ProductionProjectRef = 'gadusaizqnshxqcckibq'
$script:ProductionSessionPoolerHost = 'aws-0-ap-northeast-2.pooler.supabase.com'

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

function Get-ManagedMigrationCliArguments {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][ValidateSet('List', 'DryRun', 'Push')][string]$Action,
    [Parameter(Mandatory)][string]$Workdir,
    [Parameter(Mandatory)][string]$ProjectRef,
    [Parameter(Mandatory)][string]$DbUrl
  )
  # The URI intentionally contains no password. The caller provides the secret
  # only through the inherited process environment.
  $common = @('--workdir', $Workdir, '--project-ref', $ProjectRef)
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

Export-ModuleMember -Function Assert-ManagedTarget, Assert-ManagedVersionList, Complete-ManagedCliResult, Get-ManagedMigrationCliArguments, Assert-CheckpointTool
