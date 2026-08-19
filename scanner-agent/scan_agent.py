"""
📷 QR 리더기 중계 프로그램 (경비실 PC 상주용)

■ 왜 필요한가
  웹 브라우저는 '활성 창 + 활성 탭'일 때만 키보드 입력을 받을 수 있다(브라우저 보안 정책).
  그래서 경비원이 다른 업무를 보는 동안에는 리더기 스캔이 VMS 화면에 전달되지 않는다.
  이 프로그램은 리더기를 '키보드'가 아니라 'COM 포트 장치'로 직접 읽어
  서버에 바로 전달하므로, 화면에 무엇이 떠 있든 상관없이 항상 동작한다.

■ 사전 준비 (한 번만)
  1) 리더기를 'USB Virtual COM(가상 시리얼)' 모드로 변경
     - 리더기 매뉴얼의 설정 바코드를 스캔하면 된다.
     - 항목 이름 예시: USB Virtual COM Port / USB COM Port Emulation / RS-232 Mode
     - 이 모드로 바꾸면 리더기가 더 이상 '타이핑'하지 않으므로
       한글 입력기 문제도 함께 사라진다.
  2) 파이썬 패키지 설치:  pip install pyserial

■ 실행
     python scan_agent.py
     python scan_agent.py --list                 (연결된 COM 포트 목록만 보기)
     python scan_agent.py --port COM3            (포트 직접 지정)
     python scan_agent.py --server http://10.101.52.119:5000

■ 자동 시작 (선택)
  Win+R → shell:startup → 이 폴더의 run_agent.bat 바로가기를 넣어둔다.
"""

import argparse
import ctypes
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

try:
    import serial                      # pyserial
    from serial.tools import list_ports
except ImportError:
    print("[오류] pyserial 이 없습니다.  설치:  pip install pyserial")
    sys.exit(1)


DEFAULT_SERVER = "http://10.101.52.119:5000"
BAUDRATE = 9600          # 대부분의 리더기 기본값. 매뉴얼과 다르면 --baud 로 지정.
RECONNECT_WAIT = 3       # 연결이 끊겼을 때 재시도 간격(초)

# 포트 자동 탐색 시 우선 매칭할 키워드 (장치 설명에 흔히 들어가는 단어)
SCANNER_HINTS = ("barcode", "scanner", "symbol", "honeywell", "zebra",
                 "datalogic", "newland", "zebex", "virtual com", "usb serial",
                 "usb 직렬", "ch340", "cp210", "cdc")

# 알려진 리더기 제조사 VID (16진수). 인투로직 B3200 = 0x9901
#   같은 모델이면 보통 동일하지만, 제조사가 칩셋을 바꾸면 달라질 수 있다.
#   그럴 때는 코드를 고치지 말고 --vid 9901,1A86 처럼 실행 옵션으로 추가하면 된다.
#   (VID 를 몰라도 'USB 시리얼 장치가 하나뿐'이면 자동으로 잡히므로 대개 신경 쓸 일이 없다)
KNOWN_SCANNER_VIDS = [0x9901]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ── 중복 실행 방지 ────────────────────────────────────────────────
#   COM 포트는 한 프로그램만 열 수 있다. 바로가기를 두 번 눌러 창이 두 개 뜨면
#   먼저 뜬 쪽이 포트를 잡고, 나중 창은 "액세스가 거부되었습니다"만 무한 반복한다.
#   그래서 두 번째 실행은 아예 시작하지 않고 안내 후 종료시킨다.
_instance_lock = None          # 전역으로 들고 있어야 프로그램이 끝날 때까지 유지된다


def already_running():
    """이미 실행 중이면 True. (윈도우 이름있는 뮤텍스 — 프로세스가 죽으면 OS가 자동 해제)"""
    global _instance_lock
    if sys.platform != "win32":
        return False
    ERROR_ALREADY_EXISTS = 183
    try:
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateMutexW.restype = ctypes.c_void_p
        # Local\ = 같은 로그인 세션 안에서만 유일. 권한 문제 없이 항상 만들어진다.
        handle = k32.CreateMutexW(None, False, r"Local\VMS_SCAN_AGENT")
        err = ctypes.get_last_error()
        if not handle:
            return False                       # 뮤텍스를 못 만들면 막지 말고 그냥 진행
        if err == ERROR_ALREADY_EXISTS:
            return True
        _instance_lock = handle                # 프로그램이 끝날 때까지 붙잡아 둔다
        return False
    except Exception:
        return False


def list_serial_ports():
    return list(list_ports.comports())


# ── 사용자가 지정한 리더기를 기억해 두는 설정 파일 ──────────────────
#   COM 번호는 USB 포트를 바꿔 꽂거나 재부팅하면 달라질 수 있으므로,
#   번호가 아니라 '장치 고유값(VID:PID·시리얼번호)'을 저장한다.
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_config.json")


def load_config():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(port):
    """선택한 포트의 식별 정보를 저장. 다음 실행부터는 번호가 바뀌어도 찾아낸다."""
    cfg = {
        "vid": port.vid, "pid": port.pid,
        "serial_number": port.serial_number,
        "description": port.description,
        "last_device": port.device,
    }
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        log(f"리더기를 기억했습니다 → {CONFIG_PATH}")
    except Exception as e:
        log(f"[경고] 설정을 저장하지 못했습니다: {e}")


def match_saved(ports, cfg):
    """저장된 식별 정보와 일치하는 포트를 찾는다. (COM 번호가 바뀌어도 매칭)
       반환: (포트, 매칭근거) 또는 (None, None)"""
    if not cfg:
        return None, None
    # ① 시리얼번호까지 같으면 '바로 그 장치'로 확정 (같은 모델 두 대도 구분됨)
    if cfg.get("serial_number"):
        for p in ports:
            if p.serial_number == cfg["serial_number"]:
                return p, "기억된 리더기"
    # ② VID:PID 만 같으면 '같은 모델'. 리더기를 교체했을 때도 그대로 동작하도록 허용한다.
    if cfg.get("vid") is not None:
        for p in ports:
            if p.vid == cfg["vid"] and p.pid == cfg["pid"]:
                same = (not cfg.get("serial_number")) or (p.serial_number == cfg.get("serial_number"))
                return p, ("기억된 리더기" if same else "기억된 것과 같은 모델(교체된 듯)")
    return None, None


def choose_port_interactive(ports):
    """사용자가 직접 리더기를 지정한다. 잘 모를 때는 '스캔해서 찾기'도 제공."""
    print("\n연결된 COM 포트 목록:")
    print(f"  {'번호':<4} {'포트':<8} {'종류':<10} {'VID:PID':<12} 설명")
    print("  " + "-" * 64)
    for i, p in enumerate(ports, 1):
        if p.vid is None:
            kind, ids = "내장포트", "-"
        else:
            kind, ids = "USB", f"{p.vid:04X}:{p.pid:04X}"
        print(f"  {i:<4} {p.device:<8} {kind:<10} {ids:<12} {p.description}")

    print("\n어느 것이 바코드 스캐너인가요?")
    print("  · 번호를 입력하면 그 포트를 사용합니다")
    print("  · 모르겠으면 그냥 Enter → QR을 한 번 스캔하면 자동으로 찾아냅니다")
    try:
        answer = input("  선택: ").strip()
    except EOFError:
        return None

    if answer:
        if answer.isdigit() and 1 <= int(answer) <= len(ports):
            return ports[int(answer) - 1]
        print("  잘못된 번호입니다.")
        return None
    return detect_by_scanning(ports)


def detect_by_scanning(ports, timeout=20):
    """후보 포트를 모두 열어두고 실제로 데이터가 들어오는 포트를 리더기로 판정한다.
       사용자가 VID 를 몰라도 되고, 같은 USB 시리얼 장치가 여럿이어도 정확하다."""
    candidates = [p for p in ports if p.vid is not None] or ports
    opened = []
    for p in candidates:
        try:
            opened.append((p, serial.Serial(p.device, BAUDRATE, timeout=0.2)))
        except Exception as e:
            log(f"  {p.device} 열기 실패({e}) — 후보에서 제외")

    if not opened:
        print("  열 수 있는 포트가 없습니다.")
        return None

    print(f"\n  📷 지금 QR 을 한 번 스캔해 주세요 ({timeout}초 안에)...")
    found = None
    deadline = time.time() + timeout
    try:
        while time.time() < deadline and not found:
            for p, ser in opened:
                try:
                    if ser.in_waiting and ser.read(64).strip():
                        found = p
                        break
                except Exception:
                    continue
    finally:
        for _, ser in opened:
            try:
                ser.close()
            except Exception:
                pass

    if found:
        print(f"  ✅ 찾았습니다 → {found.device} ({found.description})")
    else:
        print("  시간 안에 스캔 신호를 받지 못했습니다.")
    return found


def pick_port(explicit=None, force_setup=False):
    """사용할 COM 포트 결정.

    COM 번호는 PC 마다·재부팅마다 달라질 수 있으므로 번호로 판단하지 않는다.
    순서:
      0) --port 로 직접 지정
      1) 저장된 설정(사용자가 한 번 지정해 둔 장치) — 번호가 바뀌어도 VID/시리얼로 추적
      2) 알려진 리더기 VID
      3) USB 시리얼이 하나뿐 (메인보드 내장 포트는 vid 가 없어 자동 제외)
      4) 장치 설명 키워드
      5) 그래도 모르면 사용자에게 직접 물어보고, 그 선택을 저장한다
    """
    ports = list_serial_ports()
    if explicit:
        return explicit
    if not ports:
        return None

    if force_setup:                                    # --setup: 무조건 다시 지정
        chosen = choose_port_interactive(ports)
        if chosen:
            save_config(chosen)
            return chosen.device
        return None

    cfg = load_config()
    saved, why = match_saved(ports, cfg)
    if saved:
        log(f"{why} → {saved.device} ({saved.description})")
        return saved.device
    if cfg:
        log("기억된 리더기를 찾지 못했습니다. (다른 PC 이거나 장치가 바뀐 경우)")

    for p in ports:                                    # ② 알려진 VID
        if p.vid in KNOWN_SCANNER_VIDS:
            log(f"리더기 VID 일치 → {p.device} ({p.description})")
            return p.device

    usb_ports = [p for p in ports if p.vid is not None]
    if len(usb_ports) == 1:                            # ③ USB 시리얼이 하나뿐
        log(f"USB 시리얼 장치가 하나뿐 → {usb_ports[0].device} ({usb_ports[0].description})")
        return usb_ports[0].device

    for p in (usb_ports or ports):                     # ④ 설명 키워드
        desc = f"{p.description} {p.manufacturer or ''}".lower()
        if any(h in desc for h in SCANNER_HINTS):
            log(f"장치 설명 일치 → {p.device} ({p.description})")
            return p.device

    # ⑤ 자동으로 못 고르면 사용자에게 물어본다 (화면이 있는 경우에만)
    if sys.stdin and sys.stdin.isatty():
        log("리더기를 자동으로 특정하지 못했습니다. 직접 지정해 주세요.")
        chosen = choose_port_interactive(ports)
        if chosen:
            save_config(chosen)
            return chosen.device
        return None

    log("리더기를 특정하지 못했습니다. --setup 으로 한 번 지정하거나 --port COM4 처럼 직접 지정하세요.")
    for p in ports:
        vid = f"VID_{p.vid:04X}" if p.vid else "내장포트"
        log(f"   {p.device}  {p.description}  [{vid}]")
    return None


def extract_token(raw):
    """QR 내용에서 토큰만 뽑는다. 서버도 같은 처리를 하지만 로그를 읽기 쉽게 하려고 여기서도 한다."""
    m = re.search(r"token=([A-Za-z0-9]+)", raw)
    return m.group(1) if m else raw


def send_scan(server, raw):
    """서버에 스캔 결과 전달. (/api/scan 은 인증 없이 호출 가능)"""
    body = json.dumps({"token": raw}).encode("utf-8")
    req = urllib.request.Request(
        server.rstrip("/") + "/api/scan",
        data=body, method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            return {"success": False, "message": f"서버 오류 (HTTP {e.code})"}
    except Exception as e:
        return {"success": False, "message": f"서버에 연결하지 못했습니다: {e}"}


def show(result):
    """스캔 결과를 눈에 띄게 출력. 경비원이 브라우저를 안 보고 있어도 알 수 있게 한다."""
    name = result.get("name") or "-"
    msg = result.get("message") or ""
    if result.get("success") and not result.get("already"):
        print("\n" + "=" * 52)
        print(f"  ✅  {name}  —  {result.get('action', '')} 요청 접수")
        print(f"      {msg}")
        print("=" * 52 + "\n", flush=True)
    elif result.get("already"):
        print("\n" + "-" * 52)
        print(f"  ⚠️  {name}  —  {msg}")
        print("-" * 52 + "\n", flush=True)
    else:
        print("\a\n" + "!" * 52)          # \a = 경고음
        print(f"  ❌  {msg or '처리하지 못했습니다.'}")
        print("!" * 52 + "\n", flush=True)


def run(port, server, baud):
    log(f"서버: {server}")
    log(f"포트: {port} ({baud}bps)")
    log("스캔 대기 중...  (종료: Ctrl+C)")

    warned_busy = False        # 같은 안내를 3초마다 반복해서 찍지 않도록
    while True:
        try:
            with serial.Serial(port, baud, timeout=1) as ser:
                if warned_busy:
                    log(f"{port} 연결되었습니다.")
                warned_busy = False
                buf = b""
                while True:
                    chunk = ser.read(256)
                    if not chunk:
                        continue
                    buf += chunk
                    # 리더기는 보통 CR/LF 로 한 건을 끝맺는다
                    while b"\r" in buf or b"\n" in buf:
                        idx = min((buf.index(c) for c in (b"\r", b"\n") if c in buf))
                        line, buf = buf[:idx], buf[idx + 1:].lstrip(b"\r\n")
                        raw = line.decode("utf-8", errors="ignore").strip()
                        if not raw:
                            continue
                        log(f"스캔: {raw}  →  토큰 {extract_token(raw)}")
                        show(send_scan(server, raw))
        except serial.SerialException as e:
            if isinstance(e.__cause__ or e, PermissionError) or "PermissionError" in str(e):
                # 포트는 있는데 열 수 없다 = 다른 프로그램이 이미 쓰고 있다
                if not warned_busy:
                    log(f"{port} 를 다른 프로그램이 사용 중입니다.")
                    log("  · 이 프로그램 창이 여러 개 떠 있지 않은지 확인하세요 (하나만 남기고 닫기)")
                    log("  · 리더기 설정 프로그램·터미널 프로그램이 켜져 있으면 닫으세요")
                    log(f"  {RECONNECT_WAIT}초마다 계속 재시도합니다...")
                    warned_busy = True
            else:
                log(f"포트 연결 끊김({e}). {RECONNECT_WAIT}초 후 재시도합니다.")
                warned_busy = False
            time.sleep(RECONNECT_WAIT)
        except KeyboardInterrupt:
            log("종료합니다.")
            return


def main():
    ap = argparse.ArgumentParser(description="VMS QR 리더기 중계 프로그램")
    ap.add_argument("--server", default=DEFAULT_SERVER, help=f"VMS 주소 (기본 {DEFAULT_SERVER})")
    ap.add_argument("--port", default=None, help="COM 포트 (예: COM3). 생략 시 자동 탐색")
    ap.add_argument("--baud", type=int, default=BAUDRATE, help=f"통신 속도 (기본 {BAUDRATE})")
    ap.add_argument("--list", action="store_true", help="연결된 COM 포트 목록만 출력")
    ap.add_argument("--vid", default=None,
                    help="리더기 VID 추가 등록 (16진수, 쉼표 구분). 예: --vid 1A86,0403")
    ap.add_argument("--setup", action="store_true",
                    help="어느 포트가 바코드 스캐너인지 직접 지정하고 기억시킨다")
    args = ap.parse_args()

    # 새 모델·다른 칩셋 리더기를 코드 수정 없이 인식시키기 위한 옵션
    if args.vid:
        for v in args.vid.split(","):
            v = v.strip().lstrip("0xX")
            if v:
                try:
                    KNOWN_SCANNER_VIDS.append(int(v, 16))
                except ValueError:
                    log(f"[무시] VID 형식이 올바르지 않습니다: {v}")

    if args.list:
        ports = list_serial_ports()
        if not ports:
            print("연결된 COM 포트가 없습니다. 리더기가 'USB Virtual COM' 모드인지 확인하세요.")
            return
        print(f"{'포트':<8} {'종류':<12} {'VID:PID':<12} 설명")
        print("-" * 68)
        for p in ports:
            if p.vid is None:
                kind, ids = "내장포트", "-"
            else:
                kind = "USB" + (" ★리더기" if p.vid in KNOWN_SCANNER_VIDS else "")
                ids = f"{p.vid:04X}:{p.pid:04X}"
            print(f"{p.device:<8} {kind:<12} {ids:<12} {p.description}")
        print("\n★ 표시가 리더기입니다. 없으면 USB 항목 중에서 고르세요.")
        return

    if already_running():
        print()
        print("이미 리더기 중계 프로그램이 실행 중입니다.")
        print("  검은 창이 여러 개 떠 있으면 하나만 남기고 닫으세요.")
        print("  (COM 포트는 한 프로그램만 열 수 있어, 두 개를 켜면 둘 다 먹통이 됩니다)")
        print()
        input("엔터를 누르면 이 창을 닫습니다... ")
        sys.exit(0)

    port = pick_port(args.port, force_setup=args.setup)
    if not port:
        print("\n리더기 COM 포트를 찾지 못했습니다.")
        print("  1) 리더기가 'USB Virtual COM' 모드인지 확인 (매뉴얼의 설정 바코드 스캔)")
        print("  2) python scan_agent.py --setup   으로 직접 지정 (한 번만 하면 기억합니다)")
        print("  3) python scan_agent.py --list    로 확인 후 --port COM4 처럼 지정")
        sys.exit(1)

    run(port, args.server, args.baud)


if __name__ == "__main__":
    main()
