@echo off
rem wafh CLI launcher, installed as bin\wafh.cmd inside the program directory.
rem Runs the CLI on the Node runtime bundled at node\ when this package carries one,
rem otherwise on system Node (>= 24). The web assets sit beside it at web\.
rem
rem There is deliberately no wafh.ps1 sibling: PowerShell prefers .ps1 over .cmd on
rem PATH, and client Windows defaults to the Restricted execution policy, which would
rem then break the plain `wafh` command. Batch files are exempt from that policy.
setlocal
set "DIR=%~dp0.."
if not defined WAFH_WEB_DIST set "WAFH_WEB_DIST=%DIR%\web"
if exist "%DIR%\git\usr\bin\sh.exe" set "WAFH_BUNDLED_SHELL=%DIR%\git\usr\bin\sh.exe"
rem The test browser a platform package ships (see scripts/package-release-bundles.sh).
if not defined WAFH_BUNDLED_BROWSERS if exist "%DIR%\browsers" set "WAFH_BUNDLED_BROWSERS=%DIR%\browsers"
if exist "%DIR%\node\node.exe" (
  "%DIR%\node\node.exe" "%DIR%\lib\dist\wafh.js" %*
) else (
  node "%DIR%\lib\dist\wafh.js" %*
)
exit /b %ERRORLEVEL%
