@echo off
rem ===================================================================
rem  360 Virtual Tour - editor launcher (Windows)
rem
rem  Double-click this file to open the tour in the editor with SAVING
rem  SWITCHED ON: the editor's Save button writes config/tour.json
rem  directly, keeping the previous version as config/tour.json.bak
rem
rem  This is start-windows.bat with --edit, and nothing else. Use the
rem  plain start-windows.bat when showing the tour to anyone: that one
rem  serves the site read-only and cannot be made to overwrite it.
rem
rem  Extra flags still work, e.g.
rem      start-editor-windows.bat --port 9000
rem ===================================================================

setlocal EnableExtensions
cd /d "%~dp0"

if not exist "%~dp0start-windows.bat" (
    echo.
    echo   start-windows.bat was not found next to this file.
    echo   Both launchers have to sit in the project folder together.
    echo.
    pause
    exit /b 1
)

echo.
echo   ================================================================
echo    EDITOR MODE - saving is ON
echo.
echo    The browser can overwrite config\tour.json from here.
echo    The version it replaces is kept as config\tour.json.bak
echo   ================================================================

call "%~dp0start-windows.bat" --edit %*
