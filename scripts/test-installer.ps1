# Hermetic Windows installer tests with tiny fixtures: offline upgrade rollback, canonical
# bundle installs (local, sibling and online), both checksum layers, download failures, and
# pre-0.1.6 legacy archives from pinned versions.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Installer = Join-Path $RepoRoot "install.ps1"
$WorkDir = Join-Path ([IO.Path]::GetTempPath()) "wafh-installer-tests-$PID"
$OriginalPath = $env:Path
$OriginalOs = $env:OS
$OriginalDownloadBaseUrl = $env:WAFH_DOWNLOAD_BASE_URL
$OriginalArchive = $env:WAFH_ARCHIVE
$OriginalInstallDir = $env:WAFH_INSTALL_DIR
$OriginalVersion = $env:WAFH_VERSION
$Fixture = @{
  Requests = [Collections.Generic.List[string]]::new()
  Mode = "canonical"
  GoodBundle = $null
  BadInnerBundle = $null
  LegacyArchive = $null
  Installer = $Installer
}
$global:WafHarnessInstallerFixture = $Fixture

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "test failure: $Message" }
}

function New-FixtureArchive([string]$Name, [bool]$Fails = $false) {
  $SourceDir = Join-Path $WorkDir "$Name-source"
  $WafHarnessDir = Join-Path $SourceDir "wafh"
  New-Item -ItemType Directory -Path (Join-Path $WafHarnessDir "bin") -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $WafHarnessDir "lib") -Force | Out-Null
  $VersionLines = if ($Fails) {
    @("echo fixture runtime failure 1>&2", "exit /b 42")
  } else {
    @("echo fixture-old", "exit /b 0")
  }
  @("@echo off", "if `"%~1`"==`"--version`" (") + $VersionLines + @(")", "exit /b 0") |
    Set-Content -LiteralPath (Join-Path $WafHarnessDir "bin\wafh.cmd") -Encoding ascii
  "fixture" | Set-Content -LiteralPath (Join-Path $WafHarnessDir "lib\fixture.txt") -Encoding ascii
  @{ schemaVersion = 1; target = "win32-x64" } | ConvertTo-Json -Compress |
    Set-Content -LiteralPath (Join-Path $WafHarnessDir "package-manifest.json") -Encoding ascii
  $Archive = Join-Path $WorkDir "$Name.zip"
  Compress-Archive -Path $WafHarnessDir -DestinationPath $Archive -CompressionLevel Fastest
  $Hash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash
  "$Hash  $([IO.Path]::GetFileName($Archive))" |
    Set-Content -LiteralPath "$Archive.sha256" -Encoding ascii
  return $Archive
}

# Serves release assets for the online cases. The new installer never inspects HTTP status
# codes, so failure modes are plain throws.
function global:Invoke-WebRequest {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [switch]$UseBasicParsing,
    [int]$TimeoutSec = 0
  )
  $f = $global:WafHarnessInstallerFixture
  $f.Requests.Add($Uri)
  if ($f.Mode -eq "404") { throw "fixture 404: $Uri" }
  if ($f.Mode -eq "network") { throw "fixture network failure: $Uri" }
  switch -Wildcard ($Uri) {
    "*/wafh-win32-x64.zip.sha256" {
      switch ($f.Mode) {
        "outer-sha-mismatch" {
          ("0" * 64) + "  wafh-win32-x64.zip" | Set-Content -LiteralPath $OutFile -Encoding ascii
        }
        "inner-sha-mismatch" { Copy-Item -LiteralPath "$($f.BadInnerBundle).sha256" -Destination $OutFile }
        "legacy" { Copy-Item -LiteralPath "$($f.LegacyArchive).sha256" -Destination $OutFile }
        default { Copy-Item -LiteralPath "$($f.GoodBundle).sha256" -Destination $OutFile }
      }
    }
    "*/wafh-win32-x64.zip" {
      switch ($f.Mode) {
        "inner-sha-mismatch" { Copy-Item -LiteralPath $f.BadInnerBundle -Destination $OutFile }
        "legacy" { Copy-Item -LiteralPath $f.LegacyArchive -Destination $OutFile }
        default { Copy-Item -LiteralPath $f.GoodBundle -Destination $OutFile }
      }
    }
    default { throw "unexpected fixture request: $Uri" }
  }
}

function Invoke-OnlineCase(
  [string]$Name,
  [string]$Mode,
  [string]$Version,
  [bool]$ShouldSucceed,
  [int]$ExpectedRequests,
  [string]$InstallerPath = ""
) {
  $Fixture.Mode = $Mode
  $Fixture.Requests.Clear()
  $InstallDir = Join-Path $WorkDir "$Name-install"
  $Arguments = @{ InstallDir = $InstallDir }
  if ($Version) { $Arguments.Version = $Version }
  if (-not $InstallerPath) { $InstallerPath = $Installer }
  $Succeeded = $true
  $Output = @()
  try { $Output = @(& $InstallerPath @Arguments *>&1) } catch { $Succeeded = $false; $Output += $_ }
  Assert-True ($Succeeded -eq $ShouldSucceed) "$Name returned an unexpected result: $(($Output | Out-String).Trim())"
  Assert-True ($Fixture.Requests.Count -eq $ExpectedRequests) `
    "$Name made $($Fixture.Requests.Count) requests, expected $ExpectedRequests"
  [PSCustomObject]@{ InstallDir = $InstallDir; Requests = @($Fixture.Requests); Output = @($Output) }
}

try {
  New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
  # Keep the fixture tests away from the runner's user registry Path.
  $env:OS = "WafHarnessInstallerFixtureTest"
  Remove-Item Env:\WAFH_DOWNLOAD_BASE_URL, Env:\WAFH_ARCHIVE, Env:\WAFH_INSTALL_DIR, `
    Env:\WAFH_VERSION -ErrorAction SilentlyContinue

  # --- Offline program archive: good install, then a failing upgrade must roll back. ---
  $InstallDir = Join-Path $WorkDir "offline-installed"
  $GoodArchive = New-FixtureArchive "valid"
  & $Installer -InstallDir $InstallDir -ArchivePath $GoodArchive *>&1 | Out-Null

  $FailedArchive = New-FixtureArchive "failure" $true
  $Failed = $false
  try {
    & $Installer -InstallDir $InstallDir -ArchivePath $FailedArchive *>&1 | Out-Null
  } catch {
    $Failed = $true
  }
  Assert-True $Failed "failing Windows upgrade unexpectedly succeeded"
  $Version = & (Join-Path $InstallDir "bin\wafh.cmd") --version
  Assert-True ($Version -eq "fixture-old") "previous Windows installation was not restored"

  # --- A second installation beside the first leaves `wafh` with the first: with
  #     -NoModifyPath its bin directory is not put on the Path. ---
  $SecondDir = Join-Path $WorkDir "offline-second"
  $SecondBin = Join-Path $SecondDir "bin"
  & $Installer -InstallDir $SecondDir -ArchivePath $GoodArchive -NoModifyPath *>&1 | Out-Null
  $Version = & (Join-Path $SecondBin "wafh.cmd") --version
  Assert-True ($Version -eq "fixture-old") "second Windows installation did not produce a working command"
  Assert-True (($env:Path -split ";") -notcontains $SecondBin) "-NoModifyPath still put the second installation on the Path"

  # --- Canonical bundle fixtures: flat outer layer sealing payload.zip + checksum + installers. ---
  $BundleDir = Join-Path $WorkDir "bundle"
  New-Item -ItemType Directory -Path $BundleDir | Out-Null
  Copy-Item $GoodArchive (Join-Path $BundleDir "payload.zip")
  $PayloadHash = (Get-FileHash -LiteralPath (Join-Path $BundleDir "payload.zip") -Algorithm SHA256).Hash
  "$PayloadHash  payload.zip" |
    Set-Content -LiteralPath (Join-Path $BundleDir "payload.zip.sha256") -Encoding ascii
  Copy-Item (Join-Path $RepoRoot "install.ps1"), (Join-Path $RepoRoot "install.cmd") $BundleDir
  $Fixture.GoodBundle = Join-Path $WorkDir "wafh-win32-x64.zip"
  Compress-Archive -Path (Join-Path $BundleDir "*") -DestinationPath $Fixture.GoodBundle -CompressionLevel Fastest
  $GoodHash = (Get-FileHash $Fixture.GoodBundle -Algorithm SHA256).Hash
  "$GoodHash  wafh-win32-x64.zip" |
    Set-Content -LiteralPath "$($Fixture.GoodBundle).sha256" -Encoding ascii

  $BadBundleDir = Join-Path $WorkDir "bad-bundle"
  Copy-Item $BundleDir $BadBundleDir -Recurse
  (("0" * 64) + "  payload.zip") |
    Set-Content (Join-Path $BadBundleDir "payload.zip.sha256") -Encoding ascii
  $Fixture.BadInnerBundle = Join-Path $WorkDir "bad-inner.zip"
  Compress-Archive -Path (Join-Path $BadBundleDir "*") -DestinationPath $Fixture.BadInnerBundle
  $BadHash = (Get-FileHash $Fixture.BadInnerBundle -Algorithm SHA256).Hash
  "$BadHash  wafh-win32-x64.zip" |
    Set-Content -LiteralPath "$($Fixture.BadInnerBundle).sha256" -Encoding ascii

  $Fixture.LegacyArchive = $GoodArchive
  # Model the release workflow's installer stamping without changing the source installer.
  $StampedInstaller = Join-Path $WorkDir "install-v0.0.0-test.ps1"
  $InstallerText = [IO.File]::ReadAllText($Installer, [Text.UTF8Encoding]::new($false))
  Assert-True ($InstallerText.Contains('__WAFH_RELEASE_VERSION__')) `
    "Windows installer release-version token is missing"
  $InstallerText = $InstallerText.Replace('__WAFH_RELEASE_VERSION__', 'v0.0.0-test')
  [IO.File]::WriteAllText($StampedInstaller, $InstallerText, [Text.UTF8Encoding]::new($false))

  # --- Local bundle via -ArchivePath: opened flat, sealed payload checksum verified. ---
  $BundleInstall = Join-Path $WorkDir "bundle-install"
  & $Installer -InstallDir $BundleInstall -ArchivePath $Fixture.GoodBundle *>&1 | Out-Null
  $Version = & (Join-Path $BundleInstall "bin\wafh.cmd") --version
  Assert-True ($Version -eq "fixture-old") "local bundle install did not produce a working command"

  # --- Extracted bundle: install.ps1 next to payload.zip installs it with no network. ---
  $SiblingDir = Join-Path $WorkDir "sibling"
  New-Item -ItemType Directory -Path $SiblingDir | Out-Null
  Expand-Archive -LiteralPath $Fixture.GoodBundle -DestinationPath $SiblingDir
  $SiblingInstall = Join-Path $WorkDir "sibling-install"
  $Fixture.Requests.Clear()
  & (Join-Path $SiblingDir "install.ps1") -InstallDir $SiblingInstall *>&1 | Out-Null
  Assert-True ($Fixture.Requests.Count -eq 0) "sibling install unexpectedly touched the network"
  $Version = & (Join-Path $SiblingInstall "bin\wafh.cmd") --version
  Assert-True ($Version -eq "fixture-old") "sibling install did not produce a working command"

  # --- Online cases. An unstamped source copy downloads the latest GitHub Release; a stamped
  #     Release installer downloads its own immutable tag. ---
  $Repo = "https://github.com/nicolaepocroianu/waf-harness"
  $canonical = Invoke-OnlineCase "canonical" "canonical" "" $true 2
  Assert-True ($canonical.Requests[0] -eq "$Repo/releases/latest/download/wafh-win32-x64.zip") `
    "unstamped installer did not download the latest GitHub Release"
  $Version = & (Join-Path $canonical.InstallDir "bin\wafh.cmd") --version
  Assert-True ($Version -eq "fixture-old") "canonical bundle was not installed"

  $stamped = Invoke-OnlineCase "stamped" "canonical" "" $true 2 $StampedInstaller
  Assert-True ($stamped.Requests[0] -eq "$Repo/releases/download/v0.0.0-test/wafh-win32-x64.zip") `
    "stamped installer did not select its own immutable GitHub release"

  # An explicit https base wins over the GitHub Release.
  $SelfHosted = "https://downloads.example.test/wafh/v0.0.0-test"
  $env:WAFH_DOWNLOAD_BASE_URL = $SelfHosted
  $override = Invoke-OnlineCase "download-base-override" "canonical" "" $true 2
  Assert-True ($override.Requests[0] -eq "$SelfHosted/wafh-win32-x64.zip") `
    "download base override did not request the configured asset directory"
  Remove-Item Env:\WAFH_DOWNLOAD_BASE_URL

  Remove-Item Env:\WAFH_ARCHIVE, Env:\WAFH_INSTALL_DIR, Env:\WAFH_VERSION -ErrorAction SilentlyContinue

  Invoke-OnlineCase "outer-mismatch" "outer-sha-mismatch" "" $false 2 | Out-Null
  Invoke-OnlineCase "inner-mismatch" "inner-sha-mismatch" "" $false 2 | Out-Null
  Invoke-OnlineCase "latest-404" "404" "" $false 1 | Out-Null
  Invoke-OnlineCase "pinned-network" "network" "v0.1.4" $false 1 | Out-Null
  $pinned = Invoke-OnlineCase "pinned-legacy" "legacy" "v0.1.4" $true 2
  Assert-True ($pinned.Requests[0] -eq "$Repo/releases/download/v0.1.4/wafh-win32-x64.zip") `
    "pinned legacy did not download the pinned GitHub asset"

  Write-Host "Windows installer bundle, offline, rollback and online tests passed."
} finally {
  $env:Path = $OriginalPath
  $env:OS = $OriginalOs
  if ($null -eq $OriginalDownloadBaseUrl) {
    Remove-Item Env:\WAFH_DOWNLOAD_BASE_URL -ErrorAction SilentlyContinue
  } else {
    $env:WAFH_DOWNLOAD_BASE_URL = $OriginalDownloadBaseUrl
  }
  if ($null -eq $OriginalArchive) {
    Remove-Item Env:\WAFH_ARCHIVE -ErrorAction SilentlyContinue
  } else {
    $env:WAFH_ARCHIVE = $OriginalArchive
  }
  if ($null -eq $OriginalInstallDir) {
    Remove-Item Env:\WAFH_INSTALL_DIR -ErrorAction SilentlyContinue
  } else {
    $env:WAFH_INSTALL_DIR = $OriginalInstallDir
  }
  if ($null -eq $OriginalVersion) {
    Remove-Item Env:\WAFH_VERSION -ErrorAction SilentlyContinue
  } else {
    $env:WAFH_VERSION = $OriginalVersion
  }
  Remove-Item Function:\Invoke-WebRequest -ErrorAction SilentlyContinue
  Remove-Variable WafHarnessInstallerFixture -Scope Global -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $WorkDir) { Remove-Item -LiteralPath $WorkDir -Recurse -Force }
}
