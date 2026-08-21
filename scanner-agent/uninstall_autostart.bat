@echo off
chcp 65001 >nul
title VMS Scanner Agent - 자동 시작 해제
cd /d "%~dp0"

REM  시작프로그램 폴더에 넣어둔 바로가기를 지운다.
REM  프로그램 자체는 지우지 않으므로, 필요하면 run_agent.bat 으로 계속 쓸 수 있다.

echo.
echo  [자동 시작 해제] VMS QR 리더기 중계 프로그램
echo  --------------------------------------------------

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$link = Join-Path ([Environment]::GetFolderPath('Startup')) 'VMS Scanner Agent.lnk';" ^
  "if (Test-Path $link) { Remove-Item $link -Force; Write-Host ('  삭제 완료 : ' + $link) }" ^
  "else { Write-Host '  등록되어 있지 않습니다. (할 일 없음)' }"

echo.
echo  이미 떠 있는 창은 그대로 동작합니다. 닫으려면 창에서 Ctrl+C 를 누르세요.
echo.
pause >nul
