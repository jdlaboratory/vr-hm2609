@echo off
rem ===================================================================
rem  360 Virtual Tour - Windows launcher
rem
rem  Double-click this file. It starts a small local web server and
rem  opens the tour in your browser. Close the window (or press
rem  Ctrl+C) to stop it.
rem
rem  Pass --edit to open the hotspot editor instead:
rem      start-windows.bat --edit
rem ===================================================================

setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo   Starting the 360 Virtual Tour...
echo.

rem --- 1) Python launcher: the most reliable option on Windows --------
py -3 -c "pass" >nul 2>&1
if not errorlevel 1 (
    py -3 "tools\serve.py" %*
    goto :stopped
)

rem --- 2) python3 -----------------------------------------------------
python3 -c "pass" >nul 2>&1
if not errorlevel 1 (
    python3 "tools\serve.py" %*
    goto :stopped
)

rem --- 3) Node.js -----------------------------------------------------
node -e "0" >nul 2>&1
if not errorlevel 1 (
    node "tools\serve.js" %*
    goto :stopped
)

rem --- 4) bare "python" last: on some systems this is a Microsoft
rem        Store placeholder rather than a real interpreter ------------
python -c "pass" >nul 2>&1
if not errorlevel 1 (
    python "tools\serve.py" %*
    goto :stopped
)

echo   Neither Python nor Node.js was found on this computer.
echo.
echo   Install either one (both are free) and run this file again:
echo.
echo       Python    https://www.python.org/downloads/
echo       Node.js   https://nodejs.org/
echo.
echo   Nothing else needs to be installed - the tour itself has no
echo   dependencies. The server is only needed because browsers block
echo   local pages from reading config/tour.json directly.
echo.
pause
exit /b 1

:stopped
echo.
echo   The server has stopped.
echo.
pause
exit /b 0
