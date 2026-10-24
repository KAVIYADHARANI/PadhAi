<#
.SYNOPSIS
    Convenience alias for start_dev.ps1
#>
[CmdletBinding()]
param (
    [switch]$Background
)

& (Join-Path $PSScriptRoot "start_dev.ps1") -Background:$Background
