@echo off
chcp 65001 > nul
title VMS QR 리더기 중계
cd /d "%~dp0"

REM ====================================================================
REM  이 프로그램은 '경비실 PC'에서 돌아갑니다. (서버가 아닙니다)
REM  리더기는 이 PC 의 USB 에 꽂혀 있으므로, 서버(Render)가 대신 읽을 수 없습니다.
REM
REM  [서버 주소]  아래 SERVER 값만 현장에 맞게 바꾸세요.
REM    · 온라인(Render) :  https://snsys-vms.onrender.com
REM    · 사내망 테스트  :  http://10.101.52.119:5000
REM
REM  [COM 포트]   자동으로 찾습니다. PC 마다 COM3/COM4/COM5 로 달라져도 무관합니다.
REM               자동 인식이 안 되면 한 번만  python scan_agent.py --setup  을 실행하세요.
REM ====================================================================

set SERVER=https://snsys-vms.onrender.com

python scan_agent.py --server %SERVER%

echo.
echo 프로그램이 종료되었습니다. 창을 닫으려면 아무 키나 누르세요.
pause > nul
