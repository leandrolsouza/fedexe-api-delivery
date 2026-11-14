[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateRange(1, [int]::MaxValue)]
    [int]$RootProcessId,

    [Parameter(Mandatory)]
    [string]$OutputPath,

    [ValidateRange(1, 3600)]
    [int]$Seconds = 30,

    [ValidateRange(1, 1000)]
    [int]$IntervalMs = 10
)

$ErrorActionPreference = 'Stop'

function Get-ProcessTreeIds {
    param([int]$RootId)
    $children = Get-CimInstance Win32_Process | Group-Object ParentProcessId -AsHashTable -AsString
    $ids = [System.Collections.Generic.List[int]]::new()
    $ids.Add($RootId)
    for ($index = 0; $index -lt $ids.Count; $index++) {
        foreach ($child in $children[[string]$ids[$index]]) {
            if ($null -ne $child -and !$ids.Contains([int]$child.ProcessId)) {
                $ids.Add([int]$child.ProcessId)
            }
        }
    }
    return $ids.ToArray()
}

$root = Get-Process -Id $RootProcessId
$clock = [Diagnostics.Stopwatch]::StartNew()
$samples = [System.Collections.Generic.List[object]]::new()
$refreshAt = 0
$ids = @()
while ($clock.Elapsed.TotalSeconds -lt $Seconds -and !$root.HasExited) {
    if ($clock.ElapsedMilliseconds -ge $refreshAt) {
        $ids = @(Get-ProcessTreeIds $RootProcessId)
        $refreshAt = $clock.ElapsedMilliseconds + 1000
    }
    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $measurement = Get-Process -Id $ids -ErrorAction SilentlyContinue |
        Measure-Object PrivateMemorySize64 -Sum
    $samples.Add([pscustomobject]@{
        timestamp_ms = $timestamp
        private_bytes = [long]$measurement.Sum
        processes = $measurement.Count
    })
    Start-Sleep -Milliseconds $IntervalMs
}
$samples | Export-Csv -LiteralPath $OutputPath -NoTypeInformation -Encoding utf8
