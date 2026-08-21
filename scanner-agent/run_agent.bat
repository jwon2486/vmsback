@echo off
chcp 65001 >nul
title VMS QR Scanner Agent
cd /d "%~dp0"

REM ==================================================================
REM  Runs on the SECURITY DESK PC (not on the server).
REM  The scanner is plugged into THIS pc, so the server cannot read it.
REM
REM  SERVER : change the line below for each site.
REM     online (Render) : https://snsys-vms.onrender.com
REM     intranet test   : http://10.101.52.119:5000
REM
REM  COM port is detected automatically. If it fails, run once:
REM     run_agent.bat --setup
REM
REM  Korean setup guide: see README.md
REM ==================================================================

set SERVER=https://snsys-vms.onrender.com

REM --- pick how to run: exe first (no python needed), python as fallback ---
if exist "%~dp0scan_agent.exe" (
    "%~dp0scan_agent.exe" --server %SERVER% %*
) else if exist "%~dp0dist\scan_agent.exe" (
    "%~dp0dist\scan_agent.exe" --server %SERVER% %*
) else (
    python "%~dp0scan_agent.py" --server %SERVER% %*
)

echo.
echo [ended] press any key to close this window.
pause >nul
