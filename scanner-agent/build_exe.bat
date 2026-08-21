@echo off
chcp 65001 >nul
title VMS Scanner Agent - build exe
cd /d "%~dp0"

REM ==================================================================
REM  개발 PC 에서만 실행. scan_agent.py 를 exe 하나로 묶는다.
REM  경비실 PC 에는 Python 을 설치하지 않고 아래 두 파일만 복사하면 된다.
REM      dist\scan_agent.exe
REM      run_agent.bat
REM  (agent_config.json 은 PC 마다 --setup 으로 생기는 파일이라 복사하지 않는다)
REM ==================================================================

python -m pip install --upgrade pyinstaller pyserial || goto :fail
python -m PyInstaller --onefile --console --name scan_agent --noconfirm scan_agent.py || goto :fail

echo.
echo [완료] dist\scan_agent.exe 생성됨
echo        run_agent.bat 과 함께 경비실 PC 로 복사하세요.
goto :end

:fail
echo.
echo [실패] 빌드 중 오류가 발생했습니다. 위 메시지를 확인하세요.

:end
echo.
pause >nul
