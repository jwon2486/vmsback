@echo off
chcp 65001 >nul
title VMS Scanner Agent - 자동 시작 등록
cd /d "%~dp0"

REM ==================================================================
REM  경비실 PC 를 켤 때(로그인할 때) 리더기 중계 프로그램이 자동으로 뜨게 한다.
REM  윈도우 '시작프로그램' 폴더에 run_agent.bat 바로가기를 만들어 넣는 방식.
REM  관리자 권한이 필요 없고, 해제도 uninstall_autostart.bat 하나로 끝난다.
REM ==================================================================

echo.
echo  [자동 시작 등록] VMS QR 리더기 중계 프로그램
echo  --------------------------------------------------
echo   대상 : %~dp0run_agent.bat
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$link = Join-Path ([Environment]::GetFolderPath('Startup')) 'VMS Scanner Agent.lnk';" ^
  "$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($link);" ^
  "$sc.TargetPath = '%~dp0run_agent.bat';" ^
  "$sc.WorkingDirectory = '%~dp0';" ^
  "$sc.Description = 'VMS QR 리더기 중계 프로그램';" ^
  "$sc.WindowStyle = 7;" ^
  "$sc.Save();" ^
  "Write-Host ('  등록 완료 : ' + $link)"

if errorlevel 1 (
    echo.
    echo  [실패] 등록하지 못했습니다.
    echo    수동 등록: Win+R 로 shell:startup 을 연 뒤,
    echo               run_agent.bat 의 '바로가기'를 그 폴더에 넣으세요.
    goto :end
)

echo.
echo  이제 이 PC 에 로그인하면 자동으로 실행됩니다. (창은 최소화 상태로 뜹니다)
echo.
echo  · 지금 바로 확인하려면 run_agent.bat 을 실행해 보세요.
echo  · 자동 시작을 없애려면 uninstall_autostart.bat 을 실행하세요.
echo  · 창이 두 개 떠도 두 번째는 자동으로 차단되므로 안전합니다.

:end
echo.
pause >nul
