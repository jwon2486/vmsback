from flask import Flask, request, jsonify, render_template, send_file, send_from_directory, session, redirect, url_for
import sqlite3
import sys
import os
import re
import json
import uuid 
from datetime import datetime, timedelta, timezone
import pandas as pd
from io import BytesIO
import urllib.parse
import threading
import time
import requests
import base64
import qrcode
import qrcode.image.svg

# 콘솔 로그 인코딩 고정: Windows 기본 콘솔(cp949)에서 이모지/특수문자 print 시
# UnicodeEncodeError 로 프로세스가 죽는 것을 방지 (Render(Linux)는 이미 UTF-8).
try:
    # line_buffering=True: 파이프(Render)에서도 줄바꿈마다 즉시 flush →
    #   종료 직전 로그가 버퍼에 갇힌 채 프로세스가 죽는 것을 방지.
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
    sys.stderr.reconfigure(encoding='utf-8', line_buffering=True)
except Exception:
    pass

app = Flask(__name__, template_folder='html')

# 🔒 [보안 강화] 백엔드 세션 암호화 키
#   - 운영(Render): 대시보드에 등록한 환경변수 SECRET_KEY 값을 사용.
#   - 로컬/내부망 테스트: 환경변수가 없으면 아래 기본값으로 자동 폴백.
app.secret_key = os.environ.get("SECRET_KEY", "sn_sys_vms_secret_key_secure_and_safe_2026")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# DB 경로:
#   - 운영(Render): 영속 디스크 경로를 환경변수 DB_PATH 로 지정 (예: /var/data/db.sqlite).
#   - 로컬/내부망 테스트: 환경변수가 없으면 이 파일 옆의 db.sqlite 를 사용.
DB_PATH = os.environ.get("DB_PATH") or os.path.join(BASE_DIR, "db.sqlite")

# 🗺️ 한국 표준시(KST, UTC+9) 타임존
KST = timezone(timedelta(hours=9))

def get_current_kst_time():
    return datetime.now(KST)

def _group_member_count(conn, group_id, visit_date):
    """같은 그룹(group_id)의 같은 날 인원 수. 단독/그룹없음이면 1."""
    if not group_id or group_id == 'NONE':
        return 1
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM visitor_log WHERE group_id = ? AND visit_date = ?",
        (group_id, visit_date)
    ).fetchone()
    return (row['c'] if row and row['c'] else 1)

def get_or_create_token(conn, log_id):
    """방문 건(log_id)의 QR 토큰을 반환. 없으면 무작위 토큰을 생성·저장 후 반환.
    QR 에는 이 토큰만 담기며, 실제 개인정보는 담기지 않는다(서버 조회 방식)."""
    row = conn.execute("SELECT token FROM visitor_log WHERE id = ?", (log_id,)).fetchone()
    if not row:
        return None
    token = (row['token'] or '').strip()
    if not token:
        token = uuid.uuid4().hex  # 32자리 무작위 16진수
        conn.execute("UPDATE visitor_log SET token = ? WHERE id = ?", (token, log_id))
        conn.commit()
    return token

# ====================================================================
# 🗺️ 거점(REGION) 매핑 및 화이트리스트
#  - URL 코드는 '지명' 기준(동탄/부산/평택/거제)으로 고정한다.
#    → 사내 거점명(우변)이 바뀌어도 정문에 인쇄해 둔 QR은 재발급 불필요.
#  - 손님은 거점별 QR(/v/<코드>)로 진입하며, region 값은 서버 세션에만 저장되어
#    주소창·페이지 소스 어디에도 노출되지 않는다.
# ====================================================================
REGION_MAP = {
    'dt': '테크센터',     # 동탄
    'bs': '에코센터',     # 부산
    'pt': '평택공장',     # 평택
    'gj': '거제 조선소',  # 거제
}
ALLOWED_REGIONS = set(REGION_MAP.values())  # {'테크센터', '에코센터', '평택공장', '거제 조선소'}

def get_db_connection():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS employees (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            dept TEXT NOT NULL,
            rank TEXT DEFAULT '',
            password TEXT DEFAULT '',
            type TEXT DEFAULT '직영',
            region TEXT DEFAULT '',
            level INTEGER DEFAULT 1
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS visitor_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            visit_date TEXT NOT NULL,
            name TEXT NOT NULL,
            company TEXT NOT NULL,
            contact TEXT,
            vehicle_no TEXT DEFAULT '없음',
            purpose TEXT NOT NULL,
            manager_text TEXT NOT NULL,
            checkin_time TEXT,
            checkout_time TEXT,
            status TEXT DEFAULT '사전예약',
            created_by TEXT,
            region TEXT NOT NULL, 
            group_id TEXT DEFAULT 'NONE',
            expected_checkin TEXT DEFAULT '',
            expected_checkout TEXT DEFAULT '',
            token TEXT DEFAULT ''
        )
    """)
    
    try:
        cursor.execute("ALTER TABLE visitor_log ADD COLUMN group_id TEXT DEFAULT 'NONE'")
    except sqlite3.OperationalError:
        pass

    # 예정 방문/퇴실 시간 컬럼 (기존 DB 호환용 마이그레이션)
    for _col in ('expected_checkin', 'expected_checkout'):
        try:
            cursor.execute(f"ALTER TABLE visitor_log ADD COLUMN {_col} TEXT DEFAULT ''")
        except sqlite3.OperationalError:
            pass

    # QR 토큰 컬럼 (기존 DB 호환용 마이그레이션)
    try:
        cursor.execute("ALTER TABLE visitor_log ADD COLUMN token TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    
    cursor.execute("SELECT COUNT(*) FROM employees WHERE id = 'admin'")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
            INSERT INTO employees (id, name, dept, rank, type, region, level)
            VALUES ('admin', '최고관리자', '관리부', '팀장', '직영', '테크센터', 3)
        """)
        
    conn.commit()
    conn.close()

# ====================================================================
# ☁️ [Render 운영] GitHub 저장소를 이용한 DB 영속화 (백업/복원)
#   - Render 컨테이너 파일시스템은 재배포/재시작 시 초기화되므로,
#     db.sqlite 를 GitHub 저장소에 주기적으로 백업하고 부팅 시 복원한다.
#   - 로컬/내부망 테스트: GITHUB_TOKEN 미설정 → 백업/복원 모두 자동 비활성
#     (로컬 db.sqlite 를 그대로 사용하므로 운영 데이터와 완전히 분리된다).
# ====================================================================
GITHUB_REPO   = os.environ.get("GITHUB_REPO", "jwon2486/vms-db")   # 백업 전용 저장소
GITHUB_BRANCH = os.environ.get("GITHUB_BRANCH", "main")
GITHUB_PATH   = os.environ.get("GITHUB_DB_PATH", "db.sqlite")          # 저장소 내 파일명
GITHUB_TOKEN  = os.environ.get("GITHUB_TOKEN")                          # 있으면 운영(백업 활성)
GITHUB_API    = "https://api.github.com"

def _github_headers(accept="application/vnd.github+json"):
    return {"Authorization": f"Bearer {GITHUB_TOKEN}", "Accept": accept}

# 🛡️ 백업 안전 플래그.
#   - 부팅 복원이 '정상'으로 끝났을 때만 True 가 되어 자동 백업을 허용한다.
#   - 복원이 '실패'(백업이 있는데 못 가져옴)했는데 백업을 계속하면,
#     빈 DB 가 GitHub 의 멀쩡한 백업을 덮어써 전체 데이터가 날아간다. → 이를 원천 차단.
_backup_safe = False

def restore_db_from_github():
    """부팅 시 로컬 DB 가 없으면(=새 컨테이너) GitHub 백업에서 최신 db.sqlite 를 복원한다."""
    global _backup_safe
    if os.path.exists(DB_PATH):
        _backup_safe = True   # 로컬/영속 디스크: 기존 파일 사용 → 백업 허용
        return
    if not GITHUB_TOKEN:
        _backup_safe = True   # 로컬 테스트: 백업 자체가 비활성이므로 무관
        print("⚠️ [복원] GITHUB_TOKEN 없음 → 신규 빈 DB로 시작")
        return
    try:
        url = f"{GITHUB_API}/repos/{GITHUB_REPO}/contents/{GITHUB_PATH}"
        # 🔎 진단 로그: 어느 저장소/브랜치/파일을 조회하는지 명시 (설정 오류 즉시 파악용)
        print(f"[복원] 조회 대상 → repo={GITHUB_REPO}, path={GITHUB_PATH}, ref={GITHUB_BRANCH}")
        resp = requests.get(url, headers=_github_headers("application/vnd.github.raw"),
                            params={"ref": GITHUB_BRANCH}, timeout=30)
        if resp.status_code == 200 and resp.content:
            with open(DB_PATH, "wb") as f:
                f.write(resp.content)
            _backup_safe = True
            print(f"✅ [복원] GitHub 백업에서 DB 복원 완료 ({len(resp.content)} bytes)")
        elif resp.status_code == 404:
            _backup_safe = True   # 백업이 아직 없음(최초 실행) → 새로 시작해도 안전
            print(f"ℹ️ [복원] 기존 백업 없음(repo={GITHUB_REPO}, status=404) → 신규 DB로 시작. "
                  f"(repo 이름이 맞는지, 토큰이 이 private 저장소에 접근되는지 확인)")
        else:
            _backup_safe = False  # 백업이 있는데 못 가져옴 → 덮어쓰기 금지
            print(f"🛑 [복원] 백업 조회 실패(repo={GITHUB_REPO}, status={resp.status_code}). "
                  f"데이터 보호를 위해 자동 백업을 비활성화합니다.")
    except Exception as e:
        _backup_safe = False
        print(f"🛑 [복원] 실패: {e}. 데이터 보호를 위해 자동 백업을 비활성화합니다.")

def create_db_snapshot():
    """쓰기 중에도 안전한 일관된 스냅샷 생성 (sqlite 온라인 백업 API 사용)."""
    snapshot_path = DB_PATH + ".snapshot"
    src = sqlite3.connect(DB_PATH, timeout=10)
    dst = sqlite3.connect(snapshot_path)
    try:
        with dst:
            src.backup(dst)
    finally:
        src.close()
        dst.close()
    return snapshot_path

def backup_db_to_github():
    """db.sqlite 스냅샷을 GitHub 저장소에 커밋(업로드)한다. 토큰 없으면 아무것도 하지 않음."""
    if not GITHUB_TOKEN:
        return
    if not _backup_safe:
        # 복원이 확인되지 않은 상태 → 빈/불완전 DB 로 기존 백업을 덮어쓰지 않도록 중단.
        print("🛑 [백업] 복원 미확인 상태 → 백업 건너뜀(기존 백업 보호)")
        return
    snapshot = create_db_snapshot()
    with open(snapshot, "rb") as f:
        content_b64 = base64.b64encode(f.read()).decode("utf-8")

    url = f"{GITHUB_API}/repos/{GITHUB_REPO}/contents/{GITHUB_PATH}"
    sha = None
    get_resp = requests.get(url, headers=_github_headers(), params={"ref": GITHUB_BRANCH}, timeout=30)
    if get_resp.status_code == 200:
        sha = get_resp.json().get("sha")  # 기존 파일 갱신 시 필요

    now_str = get_current_kst_time().strftime('%Y-%m-%d %H:%M:%S')
    payload = {
        "message": f"VMS db backup - {now_str} KST",
        "content": content_b64,
        "branch": GITHUB_BRANCH,
    }
    if sha:
        payload["sha"] = sha

    put_resp = requests.put(url, headers=_github_headers(), json=payload, timeout=30)
    if 200 <= put_resp.status_code < 300:
        print(f"✅ [백업] GitHub DB 백업 성공 ({now_str} KST)")
    else:
        print(f"❌ [백업] 실패: {put_resp.status_code} {put_resp.text[:200]}")

def _backup_worker():
    """일정 주기(기본 60분)마다 GitHub 백업을 반복 실행."""
    interval = max(int(os.environ.get("BACKUP_INTERVAL_MIN", "60")), 5) * 60
    while True:
        time.sleep(interval)
        try:
            backup_db_to_github()
        except Exception as e:
            print(f"❌ [백업] 정기 백업 중 오류: {e}")

_backup_thread_started = False
_backup_thread_lock = threading.Lock()

def start_backup_thread():
    """GITHUB_TOKEN 이 설정된 환경(=Render 운영)에서만 백업 워커를 1회 기동."""
    global _backup_thread_started
    if not GITHUB_TOKEN:
        return  # 로컬/내부망: 백업 비활성
    with _backup_thread_lock:
        if not _backup_thread_started:
            threading.Thread(target=_backup_worker, daemon=True).start()
            _backup_thread_started = True
            print("🚀 [백업] GitHub 백업 워커 스레드 시동")

# 부팅 시퀀스: (1) 백업 복원 → (2) 테이블/admin 계정 보장.
#   복원이 init_db 보다 먼저 와야 한다. (init_db 가 먼저 빈 파일을 만들면 복원이 skip 되므로)
restore_db_from_github()
init_db()

# ====================================================================
# 🛡️ 백엔드 블라인드 매칭 및 권한 검증
# ====================================================================
def blind_match_employee(manager_text, region):
    conn = get_db_connection()
    employees = conn.execute(
        "SELECT id FROM employees WHERE name = ? AND region = ?", 
        (manager_text, region)
    ).fetchall()
    
    emp_id = employees[0]['id'] if len(employees) == 1 else 'guard_pending'
    conn.close()
    return emp_id

def is_admin_authenticated():
    if 'user' not in session: return False
    return int(session['user'].get('level', 1)) == 3

def resolve_guest_region(data=None):
    """
    🗺️ 방문객(손님) 입실/예약 시 거점 결정 로직.
      1순위: 서버 세션(guest_region) — 거점별 QR(/v/<코드>)로 진입 시 주입된 값.
             클라이언트 화면/소스에 노출되지 않으며 위조 불가.
      2순위: 클라이언트 전달 region — QR/키오스크 없이 / 로 직접 접속한 손님이
             드롭다운으로 직접 선택한 경우의 폴백.
    화이트리스트(ALLOWED_REGIONS)에 없는 값은 신뢰하지 않고 None 반환.
    (None인 경우 호출부에서 입실/예약을 거부하여 거점 오귀속을 차단한다.)
    """
    data = data or {}
    region = (session.get('guest_region') or '').strip()
    if not region:
        region = (data.get('region') or '').strip()
    if region not in ALLOWED_REGIONS:
        return None
    return region

def _to_expected_dt(visit_date, expected_checkin):
    """예약일(YYYY-MM-DD) + 예정 방문시간(HH:MM)을 KST datetime 으로 변환.
    시간이 비어 있으면 그 날 00:00 기준(=날짜만 비교)."""
    if not visit_date:
        return None
    time_part = (expected_checkin or '').strip() or '00:00'
    try:
        dt = datetime.strptime(f"{visit_date} {time_part}", "%Y-%m-%d %H:%M")
        return dt.replace(tzinfo=KST)
    except ValueError:
        return None

def is_early_checkin(visit_date, expected_checkin):
    """현재(KST)가 예약된 방문 예정시각보다 이르면 True (이른 날짜 포함)."""
    expected_dt = _to_expected_dt(visit_date, expected_checkin)
    if expected_dt is None:
        return False
    return get_current_kst_time() < expected_dt

def build_early_warning_message(visit_date, expected_checkin):
    """조기 입실 확인 팝업에 표시할 안내 문구."""
    dt = _to_expected_dt(visit_date, expected_checkin)
    if dt and (expected_checkin or '').strip():
        expected_str = dt.strftime('%Y-%m-%d %H:%M')
    else:
        expected_str = f"{visit_date} (예정시간 미지정)"
    return (
        f"⏰ 예약된 방문 예정시간({expected_str})보다 이른 입실입니다.\n\n"
        "조기 입실 시에는 반드시 사내 담당자에게 전화하여, "
        "담당자가 현재 사내에 있는지와 지금 입실해도 되는지 확인해야 합니다.\n\n"
        "담당자 확인을 완료하셨습니까?\n(확인 = 입실 진행 / 취소 = 중단)"
    )

# ====================================================================
# 🏠 정적 파일 및 라우팅
# ====================================================================
@app.route('/css/<path:filename>')
def serve_css(filename): return send_from_directory(os.path.join(BASE_DIR, 'css'), filename)

@app.route('/js/<path:filename>')
def serve_js(filename): return send_from_directory(os.path.join(BASE_DIR, 'js'), filename)

@app.route('/logo/<path:filename>')
def serve_logo(filename): return send_from_directory(os.path.join(BASE_DIR, 'logo'), filename)

@app.route('/')
@app.route('/emp')
def guest_page(): return render_template('guest.html')

@app.route('/v/<region_code>')
def guest_region_entry(region_code):
    """
    📍 거점별 QR/링크 진입점.
      - 정문에 비치한 거점별 QR이 이 경로를 가리킨다. (예: /v/gj → 거제 조선소)
      - 매칭되는 거점이 있으면 region을 '서버 세션에만' 저장한다.
      - 이후 손님은 region이 노출되지 않는 깨끗한 '/' 로 리다이렉트된다.
      - 알 수 없는 코드면 세션에 아무것도 남기지 않아, '/' 에서 거점 선택 드롭다운으로 폴백된다.
    """
    region = REGION_MAP.get(region_code)
    if region:
        session['guest_region'] = region
    # url_for('guest_page')는 / 와 /emp 두 라우트 중 /emp 를 반환할 수 있어
    # 손님이 임직원 로그인 화면으로 잘못 빠진다. 손님 화면 '/' 로 명시 고정.
    return redirect('/')

@app.route('/admin')
def admin_page():
    if not is_admin_authenticated():
        session.clear()
        return redirect(url_for('guest_page'))
    return render_template('admin.html')

# ====================================================================
# 👤 임직원 인증 및 스케줄 API
# ====================================================================
@app.route('/api/emp/login', methods=['POST'])
def emp_login():
    data = request.json or {}
    emp_id, emp_name = data.get('id', '').strip(), data.get('name', '').strip()
    
    conn = get_db_connection()
    emp = conn.execute(
        "SELECT id, name, dept, rank, level, region FROM employees WHERE id = ? AND name = ?", 
        (emp_id, emp_name)
    ).fetchone()
    conn.close()
    
    if emp:
        emp_dict = dict(emp)
        session['user'] = emp_dict
        return jsonify({"success": True, "employee": emp_dict})
    return jsonify({"success": False, "message": "사번 또는 성명이 일치하지 않습니다."})

@app.route('/api/emp/logout', methods=['POST'])
def emp_logout():
    session.pop('user', None)
    return jsonify({"success": True})

@app.route('/api/emp/my-schedule/<string:emp_id>', methods=['GET'])
def get_emp_schedule(emp_id):
    if 'user' not in session:
        return jsonify({"success": False, "message": "인증 정보가 없습니다."}), 401

    my_start, my_end = request.args.get('my_start', '').strip(), request.args.get('my_end', '').strip()

    conn = get_db_connection()
    my_query = """
        SELECT v.id, v.visit_date, v.name, v.contact, v.company, v.purpose, v.checkin_time, v.checkout_time, v.status, v.group_id, v.region, v.expected_checkin, v.expected_checkout, e.name AS emp_name 
        FROM visitor_log v LEFT JOIN employees e ON v.created_by = e.id
        WHERE v.created_by = ?
    """
    my_params = [emp_id]
    if my_start:
        my_query += " AND v.visit_date >= ?"
        my_params.append(my_start)
    if my_end:
        my_query += " AND v.visit_date <= ?"
        my_params.append(my_end)
    my_query += " ORDER BY v.visit_date DESC, v.id DESC"
    
    my_logs = conn.execute(my_query, my_params).fetchall()
    conn.close()
    return jsonify({"success": True, "my_list": [dict(row) for row in my_logs]})

@app.route('/api/emp/group-action', methods=['POST'])
def handle_staff_group_action():
    if 'user' not in session: 
        return jsonify({"success": False, "message": "권한이 없습니다."}), 401

    data = request.json or {}
    group_id = data.get('group_id')
    action = data.get('action') 
    force = bool(data.get('force'))  # 조기 입실 확인 팝업에서 '확인' 시 True
    requester_id = session['user'].get('id')

    if not group_id or group_id == 'NONE':
        return jsonify({"success": False, "message": "유효하지 않은 그룹입니다."})

    conn = get_db_connection()
    
    if action == 'checkin':
        # ⏰ 조기 입실 검사: 그룹 내 사전예약 건 중 가장 이른 예정시각 기준으로 판정
        pending = conn.execute(
            "SELECT visit_date, expected_checkin FROM visitor_log WHERE group_id = ? AND status = '사전예약'",
            (group_id,)
        ).fetchall()
        if not force:
            for m in pending:
                if is_early_checkin(m['visit_date'], m['expected_checkin']):
                    conn.close()
                    return jsonify({
                        "success": False,
                        "early": True,
                        "message": build_early_warning_message(m['visit_date'], m['expected_checkin'])
                    })
        conn.execute("UPDATE visitor_log SET status = '입실대기' WHERE group_id = ? AND status = '사전예약'", (group_id,))
        msg = "그룹 일괄 입실 요청이 완료되었습니다."
    elif action == 'checkout':
        conn.execute("UPDATE visitor_log SET status = '퇴실대기' WHERE group_id = ? AND status = '입실완료'", (group_id,))
        msg = "그룹 일괄 퇴실 요청이 완료되었습니다."
    elif action == 'cancel':
        # Level 4(경비 담당)는 소유자 무관하게 취소 가능. 그 외에는 본인(created_by) 등록 건만.
        if int(session['user'].get('level', 1)) == 4:
            conn.execute("DELETE FROM visitor_log WHERE group_id = ? AND status IN ('사전예약', '입실대기')", (group_id,))
        else:
            conn.execute("DELETE FROM visitor_log WHERE group_id = ? AND created_by = ? AND status IN ('사전예약', '입실대기')", (group_id, requester_id))
        msg = "그룹 일괄 예약 취소가 완료되었습니다."
    else:
        conn.close()
        return jsonify({"success": False, "message": "잘못된 요청입니다."})

    conn.commit()
    conn.close()
    
    return jsonify({"success": True, "message": msg})

@app.route('/api/schedule/<int:log_id>', methods=['DELETE'])
def cancel_individual_schedule(log_id):
    if 'user' not in session:
        return jsonify({"success": False, "message": "권한이 없습니다."}), 401

    requester_id = session['user'].get('id')
    requester_level = int(session['user'].get('level', 1))

    try:
        conn = get_db_connection()
        # Level 4(경비 담당)는 소유자 무관하게 취소 가능. 그 외에는 본인(created_by) 등록 건만.
        if requester_level == 4:
            cur = conn.execute(
                "DELETE FROM visitor_log WHERE id = ? AND status IN ('사전예약', '입실대기')",
                (log_id,)
            )
        else:
            cur = conn.execute(
                "DELETE FROM visitor_log WHERE id = ? AND created_by = ? AND status IN ('사전예약', '입실대기')",
                (log_id, requester_id)
            )
        conn.commit()
        deleted = cur.rowcount
        conn.close()
        if deleted == 0:
            return jsonify({"success": False, "message": "본인이 등록한 예약만 취소할 수 있습니다. (이미 승인/처리되었거나 취소 불가 상태일 수 있습니다.)"}), 403
        return jsonify({"success": True, "message": "예약이 정상적으로 삭제되었습니다."})
    except Exception as e:
        print(f"Cancel Schedule Error: {e}")
        return jsonify({"success": False, "message": "삭제 중 서버 오류가 발생했습니다."}), 500

# ====================================================================
# ✨ 임직원 사전 등록 거점 역전 및 담당자 텍스트 누락 방지 모듈
# ====================================================================
@app.route('/api/emp/group-preregister', methods=['POST'])
def group_preregister_visitor():
    data = request.json or {}
    visitors = data.get('visitors', [])
    created_by = data.get('created_by', '').strip()

    # 1️⃣ [우선순위 1] 출장 근무자를 고려하여 화면(주소창)에서 넘어온 현재 거점 정보를 최우선 적용
    region = data.get('region', '').strip()

    # 2️⃣ [우선순위 2] 화면 데이터 유실 시 로그인 세션 내 본인 지역 정보 활용
    if not region and 'user' in session:
        region = session['user'].get('region', '').strip()
    
    # 3️⃣ [우선순위 3] 극단적 유실 시 인사 마스터 DB 거점 직접 추적
    if not region and created_by:
        try:
            conn_temp = get_db_connection()
            emp_info = conn_temp.execute("SELECT region FROM employees WHERE id = ?", (created_by,)).fetchone()
            conn_temp.close()
            if emp_info:
                region = emp_info['region'].strip()
        except Exception as e:
            print(f"Fallback Region Query Error: {e}")

    # 4️⃣ [최종 방어] 예외 처리 바인딩
    if not region:
        region = '거점미상'

    # 5️⃣ [화이트리스트 정규화] 오타/조작 값 차단. '거점미상'은 의도된 식별값이므로 허용.
    if region not in ALLOWED_REGIONS and region != '거점미상':
        region = '거점미상'

    if not visitors:
        return jsonify({"success": False, "message": "예약할 방문객 정보가 없습니다."})

    group_id = f"GRP_{uuid.uuid4().hex[:8].upper()}"

    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        emp_row = cursor.execute("SELECT name FROM employees WHERE id = ?", (created_by,)).fetchone()
        manager_name = emp_row['name'] if emp_row else '미상'

        for v in visitors:
            visit_date = v.get('visit_date', '').strip()
            name = v.get('name', '').strip()
            contact = v.get('contact', '').strip()
            company = v.get('company', '').strip()
            vehicle_no = v.get('vehicle_no', '없음').strip()
            if not vehicle_no: vehicle_no = '없음'
            purpose = v.get('purpose', '').strip()
            expected_checkin = (v.get('expected_checkin') or '').strip()
            expected_checkout = (v.get('expected_checkout') or '').strip()

            cursor.execute("""
                INSERT INTO visitor_log (visit_date, name, contact, company, vehicle_no, purpose, manager_text, checkin_time, created_by, status, region, group_id, expected_checkin, expected_checkout)
                VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, '입실대기', ?, ?, ?, ?)
            """, (visit_date, name, contact, company, vehicle_no, purpose, manager_name, created_by, region, group_id, expected_checkin, expected_checkout))

        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": f"총 {len(visitors)}명의 방문객이 등록되어 경비실 승인 대기 상태로 접수되었습니다."})
    except Exception as e:
        print(f"Group PreRegister Error: {e}")
        return jsonify({"success": False, "message": "등록 처리 중 서버 에러가 발생했습니다."}), 500

# ====================================================================
# 🛡️ 보안실(Level 4) 중심 관제 API 
# ====================================================================
@app.route('/api/security/pending-logs', methods=['GET'])
def get_security_pending_logs():
    if 'user' not in session or int(session['user'].get('level', 1)) != 4:
        return jsonify({"success": False}), 403
        
    region = request.args.get('region') or session['user'].get('region')
    today_str = get_current_kst_time().strftime('%Y-%m-%d')

    conn = get_db_connection()
    logs = conn.execute("""
        SELECT * FROM visitor_log 
        WHERE region = ? AND status IN ('입실대기', '퇴실대기') AND visit_date = ?
        ORDER BY id ASC
    """, (region, today_str)).fetchall()
    conn.close()
    return jsonify({"success": True, "list": [dict(log) for log in logs]})

@app.route('/api/security/overdue', methods=['GET'])
def get_security_overdue():
    """
    ⏰ 퇴실 지연자 조회.
      - 대상: status = '입실완료' (재실 중, 아직 퇴실 안 됨)
      - 판정: visit_date + expected_checkout 이 현재(KST)보다 과거 → 퇴실 예정시간 초과
      - 날짜 파라미터(start_date/end_date) 없으면 오늘 방문자 기준.
      - expected_checkout 이 비어 있으면 판정 불가 → 제외.
    """
    if 'user' not in session or int(session['user'].get('level', 1)) != 4:
        return jsonify({"success": False}), 403

    region = request.args.get('region') or session['user'].get('region')
    start_date = request.args.get('start_date', '').strip()
    end_date = request.args.get('end_date', '').strip()

    now_kst = get_current_kst_time()
    today_str = now_kst.strftime('%Y-%m-%d')

    query = "SELECT * FROM visitor_log WHERE region = ? AND status = '입실완료'"
    params = [region]
    if start_date or end_date:
        if start_date:
            query += " AND visit_date >= ?"; params.append(start_date)
        if end_date:
            query += " AND visit_date <= ?"; params.append(end_date)
    else:
        # 기본값: 오늘 방문자
        query += " AND visit_date = ?"; params.append(today_str)
    query += " ORDER BY visit_date ASC, id ASC"

    conn = get_db_connection()
    rows = conn.execute(query, params).fetchall()
    conn.close()

    overdue = []
    for r in rows:
        v = dict(r)
        expected_out = (v.get('expected_checkout') or '').strip()
        if not expected_out:
            continue  # 예정 퇴실시간 미입력 → 판정 불가, 제외
        expected_dt = _to_expected_dt(v.get('visit_date'), expected_out)
        if expected_dt is None:
            continue
        if now_kst > expected_dt:
            # 지연 시간(분) 계산
            delay_min = int((now_kst - expected_dt).total_seconds() // 60)
            v['expected_checkout_dt'] = expected_dt.strftime('%Y-%m-%d %H:%M')
            v['overdue_minutes'] = delay_min
            overdue.append(v)

    return jsonify({"success": True, "list": overdue, "now": now_kst.strftime('%Y-%m-%d %H:%M')})

@app.route('/api/security/approve', methods=['POST'])
def approve_security_log():
    if 'user' not in session or int(session['user'].get('level', 1)) != 4:
        return jsonify({"success": False}), 403
        
    data = request.json or {}
    log_id, target_status = data.get('id'), data.get('target_status')
    force = bool(data.get('force', False))
    now_str = get_current_kst_time().strftime('%Y-%m-%d %H:%M:%S')
    time_column = 'checkin_time' if target_status == '입실완료' else 'checkout_time'
    
    conn = get_db_connection()

    # ⏰ 입실 승인 시 조기입실(예정시간보다 이른 입실) 검사 → 미확인 상태면 경고 반환
    if target_status == '입실완료' and not force:
        row = conn.execute("SELECT visit_date, expected_checkin FROM visitor_log WHERE id = ?", (log_id,)).fetchone()
        if row and is_early_checkin(row['visit_date'], row['expected_checkin']):
            conn.close()
            return jsonify({
                "success": False,
                "early": True,
                "message": build_early_warning_message(row['visit_date'], row['expected_checkin'])
            })

    conn.execute(f"UPDATE visitor_log SET status = ?, {time_column} = ? WHERE id = ?", (target_status, now_str, log_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route('/api/security/approve-group', methods=['POST'])
def approve_security_log_group():
    if 'user' not in session or int(session['user'].get('level', 1)) != 4:
        return jsonify({"success": False}), 403
        
    data = request.json or {}
    group_id = data.get('group_id')
    target_status = data.get('target_status') 
    force = bool(data.get('force', False))
    
    current_status = '입실대기' if target_status == '입실완료' else '퇴실대기'
    now_str = get_current_kst_time().strftime('%Y-%m-%d %H:%M:%S')
    time_column = 'checkin_time' if target_status == '입실완료' else 'checkout_time'
    
    if not group_id or group_id == 'NONE':
        return jsonify({"success": False, "message": "잘못된 그룹 ID입니다."}), 400
    
    try:
        conn = get_db_connection()

        # ⏰ 입실 승인 시 조기입실 검사: 그룹 내 입실대기 건 중 가장 이른 예정시각 기준으로 판정
        if target_status == '입실완료' and not force:
            rows = conn.execute(
                "SELECT visit_date, expected_checkin FROM visitor_log WHERE group_id = ? AND status = '입실대기'",
                (group_id,)
            ).fetchall()
            earliest = None
            for r in rows:
                dt = _to_expected_dt(r['visit_date'], r['expected_checkin'])
                if dt and (earliest is None or dt < earliest):
                    earliest = dt
                    earliest_row = r
            if earliest is not None and get_current_kst_time() < earliest:
                conn.close()
                return jsonify({
                    "success": False,
                    "early": True,
                    "message": build_early_warning_message(earliest_row['visit_date'], earliest_row['expected_checkin'])
                })

        conn.execute(f"""
            UPDATE visitor_log 
            SET status = ?, {time_column} = ? 
            WHERE group_id = ? AND status = ?
        """, (target_status, now_str, group_id, current_status))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        print(f"❌ [Group Approve API Error]: {e}")
        return jsonify({"success": False, "message": f"그룹 승인 중 서버 오류 발생: {str(e)}"}), 500

@app.route('/api/security/preregister', methods=['POST'])
def security_preregister():
    if 'user' not in session or int(session['user'].get('level', 1)) != 4:
        return jsonify({"success": False, "message": "권한이 없습니다."}), 403
        
    data = request.json or {}
    visit_date = data.get('visit_date', '').strip()
    name = data.get('name', '').strip()
    contact = data.get('contact', '').strip()
    company = data.get('company', '').strip()
    vehicle_no = data.get('vehicle_no', '없음').strip()
    purpose = data.get('purpose', '').strip()
    manager_text = data.get('manager_text', '').strip()

    # 거점: 전달값 우선, 없으면 보안실 근무자 본인 거점. 화이트리스트 외 값은 본인 거점으로 정규화.
    region = (data.get('region') or session['user'].get('region', '')).strip()
    if region not in ALLOWED_REGIONS:
        region = session['user'].get('region', '거점미상')
    
    if not visit_date or not name or not contact or not company or not manager_text:
        return jsonify({"success": False, "message": "필수 정보를 모두 입력해주세요."})
        
    try:
        conn = get_db_connection()
        # 입력한 담당자 이름(manager_text)을 바탕으로 실제 사번(created_by) 추적
        emp_id_match = blind_match_employee(manager_text, region)
        # 매칭 실패 시 보안실 근무자 본인의 ID로 임시 귀속
        bind_id = emp_id_match if emp_id_match != 'guard_pending' else session['user'].get('id')
        
        conn.execute("""
            INSERT INTO visitor_log (visit_date, name, contact, company, vehicle_no, purpose, manager_text, checkin_time, created_by, status, region)
            VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, '사전예약', ?)
        """, (visit_date, name, contact, company, vehicle_no, purpose, manager_text, bind_id, region))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": "방문 예약이 정상적으로 등록되었습니다."})
    except Exception as e:
        return jsonify({"success": False, "message": f"서버 오류: {str(e)}"}), 500

# ====================================================================
# 🧭 [방문객 공용] 현재 세션 거점 확인 (본인 거점 표시용)
#   - 손님이 어느 사업장으로 등록되는지 화면에 확인 문구로 보여주기 위한 용도.
#   - 세션에 귀속된 '본인 거점명' 하나만 반환하며, 매핑 로직/타 거점 목록은 노출하지 않는다.
# ====================================================================
@app.route('/api/guest/context', methods=['GET'])
def guest_context():
    region = (session.get('guest_region') or '').strip()
    return jsonify({"region": region if region in ALLOWED_REGIONS else ''})

# ====================================================================
# 👥 방문객 등록 및 일반 출입 API
# ====================================================================
@app.route('/api/checkin', methods=['POST'])
def handle_integrated_checkin():
    try:
        data = request.json or {}
        log_id = data.get('id')
        force = bool(data.get('force'))  # 조기 입실 확인 팝업에서 '확인'을 누르면 True
        today_date = get_current_kst_time().strftime('%Y-%m-%d')
        
        conn = get_db_connection()
        cursor = conn.cursor()

        # 사전예약 방문객의 현장 입실 → 이미 거점 정보가 DB에 존재하므로 region 재확인 불필요
        if log_id:
            row = cursor.execute(
                "SELECT visit_date, expected_checkin, status FROM visitor_log WHERE id = ?",
                (log_id,)
            ).fetchone()

            # ⏰ 조기 입실 검사: 예약 방문 예정시각보다 이른데 아직 확인(force) 안 했으면 팝업 유도
            if row and not force and is_early_checkin(row['visit_date'], row['expected_checkin']):
                conn.close()
                return jsonify({
                    "success": False,
                    "early": True,
                    "id": log_id,
                    "message": build_early_warning_message(row['visit_date'], row['expected_checkin'])
                })

            cursor.execute("UPDATE visitor_log SET status = '입실대기' WHERE id = ?", (log_id,))
            conn.commit()
            conn.close()
            return jsonify({"success": True, "id": log_id, "message": "입실 요청이 완료되었습니다. 보안실 대면 승인 대기 중입니다."})
        
        # 신규 현장 입실 → 거점은 세션(QR) 우선, 없으면 드롭다운 값. 모두 무효면 거부.
        region = resolve_guest_region(data)
        if not region:
            conn.close()
            return jsonify({"success": False, "message": "방문 거점이 확인되지 않습니다. 정문에 비치된 QR을 다시 스캔하거나 사업장을 선택해 주세요."}), 400

        name = data.get('name', '').strip()
        company = data.get('company', '').strip()
        contact = data.get('contact', '').strip()
        vehicle_no = data.get('vehicle_no') 
        if not vehicle_no or vehicle_no.strip() == '':
            vehicle_no = '없음'
        else:
            vehicle_no = vehicle_no.strip()

        purpose = data.get('purpose', '').strip()
        manager_text = data.get('manager_text', '').strip()
        expected_checkin = (data.get('expected_checkin') or '').strip()
        expected_checkout = (data.get('expected_checkout') or '').strip()
        
        if not name or not company or not manager_text or not contact:
            conn.close()
            return jsonify({"success": False, "message": "필수 입력 항목이 누락되었습니다."})
            
        matched_emp_id = blind_match_employee(manager_text, region)
        
        cursor.execute("""
            INSERT INTO visitor_log 
            (visit_date, name, company, contact, vehicle_no, purpose, manager_text, created_by, region, status, checkin_time, expected_checkin, expected_checkout)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '입실대기', '', ?, ?)
        """, (today_date, name, company, contact, vehicle_no, purpose, manager_text, matched_emp_id, region, expected_checkin, expected_checkout))
        new_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        if matched_emp_id == 'guard_pending':
            return jsonify({"success": True, "id": new_id, "message": "담당자 확인이 필요합니다. 안내 데스크(경비실)로 이동해 주세요."})
        return jsonify({"success": True, "id": new_id, "message": "입실 요청이 완료되었습니다. 대면 승인 대기 중입니다."})

    except Exception as e:
        print(f"Checkin Error: {e}")
        return jsonify({"success": False, "message": f"입실 처리 중 시스템 오류가 발생했습니다. ({str(e)})"}), 500

@app.route('/api/group-checkin', methods=['POST'])
def handle_group_checkin():
    data = request.json or {}
    visitors = data.get('visitors', [])

    # 거점: 세션(QR) 우선, 없으면 드롭다운 값. 모두 무효면 거부.
    region = resolve_guest_region(data)
    if not region:
        return jsonify({"success": False, "message": "방문 거점이 확인되지 않습니다. 정문에 비치된 QR을 다시 스캔하거나 사업장을 선택해 주세요."}), 400
    
    today_date = get_current_kst_time().strftime('%Y-%m-%d')
    
    if not visitors:
        return jsonify({"success": False, "message": "방문객 정보가 없습니다."})

    group_id = f"GRP_{uuid.uuid4().hex[:8].upper()}"
    new_id = None
    has_pending = False
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        member_ids = []
        for i, v in enumerate(visitors):
            matched_emp_id = blind_match_employee(v.get('manager_text', ''), region)
            if matched_emp_id == 'guard_pending':
                has_pending = True
                
            cursor.execute("""
                INSERT INTO visitor_log 
                (visit_date, name, company, contact, vehicle_no, purpose, manager_text, created_by, region, status, checkin_time, group_id, expected_checkin, expected_checkout)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '입실대기', '', ?, ?, ?)
            """, (today_date, v['name'], v['company'], v['contact'], v.get('vehicle_no', '없음'), 
                  v['purpose'], v['manager_text'], matched_emp_id, region, group_id,
                  (v.get('expected_checkin') or '').strip(), (v.get('expected_checkout') or '').strip()))
            
            row_id = cursor.lastrowid
            member_ids.append(row_id)
            if i == 0:
                new_id = row_id
            
        conn.commit()

        # 그룹 전원에게 개인 QR 토큰 발급 → 완료 화면에서 각자의 QR 표시 (대표자 폰 방전 등 대비)
        members = []
        for idx, mid in enumerate(member_ids):
            tk = get_or_create_token(conn, mid)
            members.append({
                "id": mid,
                "name": visitors[idx].get('name', ''),
                "token": tk
            })
        token = members[0]['token'] if members else None  # 하위호환용 대표 토큰
        conn.close()
        
        msg = f"총 {len(visitors)}명의 입실 요청이 완료되었습니다."
        if has_pending:
            msg += " 담당자 확인이 필요하여 데스크로 이동해주세요."
            
        return jsonify({"success": True, "id": new_id, "token": token, "members": members, "message": msg})
    except Exception as e:
        print(f"Group Checkin Error: {e}")
        return jsonify({"success": False, "message": f"시스템 오류가 발생했습니다. ({str(e)})"}), 500

@app.route('/api/checkout', methods=['POST'])
def handle_integrated_checkout():
    log_id = (request.json or {}).get('id')
    if not log_id: return jsonify({"success": False, "message": "ID 누락"}), 400
        
    conn = get_db_connection()
    conn.execute("UPDATE visitor_log SET status = '퇴실대기' WHERE id = ? AND status = '입실완료'", (log_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "퇴실 요청이 접수되었습니다. 보안실 최종 승인 후 마감 처리됩니다."})

@app.route('/api/preregister', methods=['POST'])
def preregister_visitor():
    data = request.json or {}
    visit_date = data.get('visit_date', '').strip()
    name = data.get('name', '').strip()
    contact = data.get('contact', '').strip()
    company = data.get('company', '').strip()
    
    vehicle_no = data.get('vehicle_no')
    if not vehicle_no or vehicle_no.strip() == '':
        vehicle_no = '없음'
    else:
        vehicle_no = vehicle_no.strip()

    purpose = data.get('purpose', '').strip()
    created_by = data.get('created_by', '').strip() 

    # 거점: 세션(QR) 우선, 없으면 드롭다운 값. 모두 무효면 거부.
    region = resolve_guest_region(data)
    if not region:
        return jsonify({"success": False, "message": "방문 거점이 확인되지 않습니다. 정문에 비치된 QR을 다시 스캔하거나 사업장을 선택해 주세요."}), 400

    if not visit_date or not name or not contact or not company or not purpose:
        return jsonify({"success": False, "message": "필수 예약 정보를 입력해 주세요."})

    try:
        conn = get_db_connection()
        conn.execute("""
            INSERT INTO visitor_log (visit_date, name, contact, company, vehicle_no, purpose, manager_text, checkin_time, created_by, status, region)
            VALUES (?, ?, ?, ?, ?, ?, '', '', ?, '사전예약', ?)
        """, (visit_date, name, contact, company, vehicle_no, purpose, created_by, region))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": "사전 예약이 완료되었습니다."})
    except Exception as e:
        print(f"PreRegister Error: {e}")
        return jsonify({"success": False, "message": "사전 예약 처리 중 서버 에러가 발생했습니다."}), 500

@app.route('/api/check-preregister', methods=['POST'])
def check_preregister_visitor():
    data = request.json or {}
    name = data.get('name', '').strip()
    contact = data.get('contact', '').strip()
    if not name: return jsonify({"success": False})

    conn = get_db_connection()
    today = get_current_kst_time().strftime('%Y-%m-%d')
    # 사전예약(레거시) + 입실대기(현행) 모두 조회. 전화번호가 있으면 함께 정확 일치.
    q = """
        SELECT v.id, v.visit_date, v.name, v.company, v.purpose, v.status, e.name AS emp_name, e.dept AS emp_dept
        FROM visitor_log v LEFT JOIN employees e ON v.created_by = e.id
        WHERE v.name = ? AND v.status IN ('사전예약', '입실대기') AND v.visit_date >= ?
    """
    params = [name, today]
    if contact:
        q += " AND v.contact = ?"
        params.append(contact)
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return jsonify({"success": True, "list": [dict(r) for r in rows]})

@app.route('/api/check-status/<int:log_id>', methods=['GET'])
def check_visitor_status(log_id):
    conn = get_db_connection()
    row = conn.execute("SELECT id, name, company, checkin_time, checkout_time, status, group_id, visit_date FROM visitor_log WHERE id = ?", (log_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"canCheckout": False})
    v = dict(row)
    v['token'] = get_or_create_token(conn, log_id)  # QR 표시용 토큰 보장
    v['group_size'] = _group_member_count(conn, v.get('group_id'), v.get('visit_date'))  # 일행 인원 수
    conn.close()
    return jsonify({"canCheckout": bool(v.get('status') == '입실완료'), "visitor": v})

@app.route('/api/search', methods=['GET'])
def search_active_visitors():
    # '나가려고 합니다'(퇴실) 화면 전용. 이름+전화번호 정확 일치로 '오늘' 방문 건 조회.
    #  - 이미 입실한(입실완료) 사람만 대상. 입실대기(아직 미입실)·퇴실완료·만료는 제외.
    #  - 입실대기 확인은 '처음 왔습니다' 화면(check-preregister)이 담당.
    name = request.args.get('name', '').strip()
    contact = request.args.get('contact', '').strip()
    if not name or not contact:
        return jsonify([])

    today_str = get_current_kst_time().strftime('%Y-%m-%d')
    conn = get_db_connection()
    rows = conn.execute(
        """SELECT id, name, company, status, checkin_time, checkout_time, expected_checkin, expected_checkout, region, group_id
           FROM visitor_log
           WHERE name = ? AND contact = ? AND visit_date = ? AND status = '입실완료'
           ORDER BY id DESC""",
        (name, contact, today_str)
    ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d['token'] = get_or_create_token(conn, d['id'])  # 조회된 건에 QR 토큰 보장
        d['group_size'] = _group_member_count(conn, d.get('group_id'), today_str)  # 일행 인원 수
        result.append(d)
    conn.close()
    return jsonify(result)

# ====================================================================
# 🔳 QR 토큰 기반 방문객 자기 확인 (리더기 없이 링크 접속으로 테스트)
# ====================================================================
@app.route('/api/qr', methods=['GET'])
def qr_image():
    """토큰을 담은 스캔 링크(/v/scan?token=...)를 QR SVG 로 렌더링해 반환."""
    token = request.args.get('token', '').strip()
    if not token:
        return "missing token", 400
    scan_url = f"{request.host_url.rstrip('/')}/v/scan?token={urllib.parse.quote(token)}"
    img = qrcode.make(scan_url, image_factory=qrcode.image.svg.SvgImage, box_size=10, border=2)
    buf = BytesIO()
    img.save(buf)
    from flask import Response
    return Response(buf.getvalue(), mimetype='image/svg+xml')

@app.route('/api/visitor/by-token', methods=['GET'])
def visitor_by_token():
    """QR 토큰으로 방문 건의 현재 상태를 조회 (개인정보 최소 반환)."""
    token = request.args.get('token', '').strip()
    if not token:
        return jsonify({"success": False, "message": "토큰이 없습니다."}), 400
    conn = get_db_connection()
    row = conn.execute(
        "SELECT id, name, company, status, checkin_time, checkout_time FROM visitor_log WHERE token = ?",
        (token,)
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"success": False, "message": "유효하지 않은 코드입니다."}), 404
    return jsonify({"success": True, "visitor": dict(row)})

@app.route('/api/group/qr', methods=['GET'])
def group_qr_tokens():
    """특정 방문 건(id)이 속한 오늘 그룹 전원의 QR 토큰을 반환.
    그룹원 누구의 건(id)으로 조회해도 전체를 볼 수 있다(이름만 노출)."""
    log_id = request.args.get('id', '').strip()
    if not log_id:
        return jsonify({"success": False, "message": "대상이 없습니다."}), 400

    conn = get_db_connection()
    base = conn.execute("SELECT group_id, visit_date FROM visitor_log WHERE id = ?", (log_id,)).fetchone()
    if not base:
        conn.close()
        return jsonify({"success": False, "message": "방문 정보를 찾을 수 없습니다."}), 404

    group_id = base['group_id']
    # 단독 방문(그룹 없음)인 경우: 본인만 반환
    if not group_id or group_id == 'NONE':
        tk = get_or_create_token(conn, log_id)
        one = conn.execute("SELECT name FROM visitor_log WHERE id = ?", (log_id,)).fetchone()
        conn.close()
        return jsonify({"success": True, "members": [{"id": int(log_id), "name": one['name'], "token": tk}]})

    rows = conn.execute(
        "SELECT id, name FROM visitor_log WHERE group_id = ? AND visit_date = ? ORDER BY id ASC",
        (group_id, base['visit_date'])
    ).fetchall()
    members = []
    for r in rows:
        members.append({"id": r['id'], "name": r['name'], "token": get_or_create_token(conn, r['id'])})
    conn.close()
    return jsonify({"success": True, "members": members})

@app.route('/v/scan', methods=['GET'])
def scan_landing():
    """QR 스캔(=링크 접속) 진입점. 손님 화면(guest.html)을 그대로 열어주고,
    프론트가 URL 의 token 파라미터를 읽어 상태/행동 화면을 띄운다."""
    return render_template('guest.html')

# ====================================================================
# 🖥️ [데스크 스캐너] PC 하드웨어 리더기 전용 페이지 + 스캔 처리 API
#   - /scan : 보안 데스크 PC 에서 열어두는 키오스크 페이지(포커스된 입력창이 리더기 입력을 받음).
#   - /api/scan : 스캔된 토큰으로 현재 상태에 맞는 입/퇴실 '요청'을 생성. 최종 승인은 보안실 대시보드에서.
# ====================================================================
@app.route('/scan', methods=['GET'])
def scan_desk_page():
    return render_template('scan.html')

@app.route('/api/scan', methods=['POST'])
def scan_action():
    data = request.json or {}
    raw = (data.get('token') or '').strip()
    # 리더기가 전체 URL(.../v/scan?token=XYZ)을 타이핑했을 수도 있으니 token 값만 추출.
    m = re.search(r'token=([A-Za-z0-9]+)', raw)
    token = m.group(1) if m else raw
    if not token:
        return jsonify({"success": False, "message": "토큰이 없습니다."}), 400

    conn = get_db_connection()
    row = conn.execute(
        "SELECT id, name, company, status FROM visitor_log WHERE token = ?", (token,)
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"success": False, "message": "유효하지 않은 QR 입니다."}), 404

    v = dict(row)
    status = v['status']
    now_kst = get_current_kst_time().strftime('%Y-%m-%d %H:%M:%S')

    if status in ('사전예약',):
        conn.execute("UPDATE visitor_log SET status = '입실대기' WHERE id = ?", (v['id'],))
        conn.commit(); conn.close()
        return jsonify({"success": True, "name": v['name'], "company": v.get('company'),
                        "action": "입실", "message": f"{v['name']} 님 입실 요청 접수 — 보안실 승인 대기"})
    elif status == '입실완료':
        conn.execute("UPDATE visitor_log SET status = '퇴실대기' WHERE id = ?", (v['id'],))
        conn.commit(); conn.close()
        return jsonify({"success": True, "name": v['name'], "company": v.get('company'),
                        "action": "퇴실", "message": f"{v['name']} 님 퇴실 요청 접수 — 보안실 승인 대기"})
    elif status == '입실대기':
        conn.close()
        return jsonify({"success": True, "already": True, "name": v['name'],
                        "message": f"{v['name']} 님은 이미 입실 승인 대기중입니다."})
    elif status == '퇴실대기':
        conn.close()
        return jsonify({"success": True, "already": True, "name": v['name'],
                        "message": f"{v['name']} 님은 이미 퇴실 승인 대기중입니다."})
    else:  # 퇴실완료 / 만료 등
        conn.close()
        return jsonify({"success": False, "name": v['name'],
                        "message": f"{v['name']} 님은 처리할 수 없는 상태입니다 ({status})."})

# ====================================================================
# 📊 사내 전체 방문객 데이터 조회 (임직원 공용)
# ====================================================================
@app.route('/api/admin/logs', methods=['GET'])
def admin_logs():
    if 'user' not in session: return jsonify({"success": False}), 401
    
    start_date, end_date = request.args.get('start_date', ''), request.args.get('end_date', '')
    user_level = int(session['user'].get('level', 1))
    user_region = session['user'].get('region', '')
    
    conn = get_db_connection()
    query = """
        SELECT v.id, v.visit_date, v.name, v.contact, v.company, v.purpose, v.checkin_time, v.checkout_time, v.status,
               e.name AS emp_name, e.dept AS emp_dept, v.region, v.expected_checkin, v.expected_checkout,
               (SELECT COUNT(*) FROM visitor_log v2
                  WHERE IFNULL(v2.region, '') = IFNULL(v.region, '')
                    AND substr(v2.visit_date, 1, 7) = substr(v.visit_date, 1, 7)
                    AND ( v2.visit_date < v.visit_date
                          OR (v2.visit_date = v.visit_date AND v2.id <= v.id) )
               ) AS month_seq,
               (SELECT COUNT(*) FROM visitor_log v3
                  WHERE v3.name = v.name
                    AND IFNULL(v3.contact, '') = IFNULL(v.contact, '')
                    AND v3.status != '만료'
               ) AS visit_count
        FROM visitor_log v LEFT JOIN employees e ON v.created_by = e.id WHERE 1=1
    """
    params = []
    if start_date: query += " AND v.visit_date >= ?"; params.append(start_date)
    if end_date: query += " AND v.visit_date <= ?"; params.append(end_date)
    
    if user_level == 4 and user_region:
        query += " AND v.region = ?"
        params.append(user_region)
        
    query += " ORDER BY v.id DESC"
    
    logs = conn.execute(query, params).fetchall()
    conn.close()
    return jsonify([dict(log) for log in logs])

# ====================================================================
# 📊 [최고 관리자 전용] 엑셀 다운로드
# ====================================================================
@app.route('/api/admin/excel-download', methods=['GET'])
def admin_excel():
    if not is_admin_authenticated(): return jsonify({"success": False}), 401
        
    start_date, end_date = request.args.get('start_date', ''), request.args.get('end_date', '')
    conn = get_db_connection()
    query = """
        SELECT
               (SELECT COUNT(*) FROM visitor_log v2
                  WHERE IFNULL(v2.region, '') = IFNULL(v.region, '')
                    AND substr(v2.visit_date, 1, 7) = substr(v.visit_date, 1, 7)
                    AND ( v2.visit_date < v.visit_date
                          OR (v2.visit_date = v.visit_date AND v2.id <= v.id) )
               ) AS month_seq,
               v.visit_date, v.name, v.company, v.purpose, e.name AS emp_name,
               v.expected_checkin, v.expected_checkout, v.checkin_time, v.checkout_time, v.status
        FROM visitor_log v LEFT JOIN employees e ON v.created_by = e.id WHERE 1=1
    """
    params = []
    if start_date: query += " AND v.visit_date >= ?"; params.append(start_date)
    if end_date: query += " AND v.visit_date <= ?"; params.append(end_date)
    query += " ORDER BY v.visit_date ASC, v.id ASC"
    
    logs = conn.execute(query, params).fetchall()
    conn.close()
    
    df = pd.DataFrame([dict(log) for log in logs])
    _cols = ['순번', '방문일', '이름', '소속', '방문 목적', '사내 담당자', '방문 예정시간', '퇴실 예정시간', '입실 시간', '퇴실 시간', '현재 상태']
    if not df.empty: df.columns = _cols
    else: df = pd.DataFrame(columns=_cols)
        
    output = BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer: df.to_excel(writer, index=False, sheet_name='방문기록')
    output.seek(0)
    
    file_name = f"VMS_Logs_{get_current_kst_time().strftime('%Y%m%d')}.xlsx"
    response = send_file(output, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{urllib.parse.quote(file_name)}"
    return response

# ====================================================================
# ☁️ [최고 관리자 전용] GitHub 수동 백업 트리거
#   - 계획된 재배포 직전 등에 관리자가 최신 상태를 즉시 백업할 때 사용.
# ====================================================================
@app.route('/api/admin/backup-now', methods=['POST'])
def admin_backup_now():
    if not is_admin_authenticated():
        return jsonify({"success": False}), 401
    if not GITHUB_TOKEN:
        return jsonify({"success": False, "message": "백업이 비활성 상태입니다(GITHUB_TOKEN 미설정)."}), 400
    try:
        backup_db_to_github()
        return jsonify({"success": True, "message": "GitHub 백업이 완료되었습니다."})
    except Exception as e:
        return jsonify({"success": False, "message": f"백업 실패: {str(e)}"}), 500

# ====================================================================
# 👥 [최고 관리자 전용] 임직원 마스터 데이터 CRUD
# ====================================================================
@app.route('/admin/employees', methods=['GET'])
def get_all_employees():
    if not is_admin_authenticated(): return jsonify({"success": False}), 401
    conn = get_db_connection()
    employees = conn.execute("SELECT id, name, region, dept, type, rank, level FROM employees").fetchall()
    conn.close()
    return jsonify([dict(emp) for emp in employees])

@app.route('/admin/employees', methods=['POST'])
def add_employee():
    if not is_admin_authenticated(): return jsonify({"success": False}), 401
    data = request.json
    emp_id, name, region, dept, emp_type, rank, level = data.get('id','').strip(), data.get('name','').strip(), data.get('region','').strip(), data.get('dept','').strip(), data.get('type','직영').strip(), data.get('rank','').strip(), int(data.get('level', 1))
    if not emp_id or not name: return jsonify({"success": False})
    try:
        conn = get_db_connection()
        conn.execute("INSERT INTO employees (id, name, region, dept, type, rank, level) VALUES (?, ?, ?, ?, ?, ?, ?)", (emp_id, name, region, dept, emp_type, rank, level))
        conn.commit(); conn.close()
        return jsonify({"success": True, "id": emp_id})
    except sqlite3.IntegrityError:
        return jsonify({"success": False, "message": "이미 존재하는 사번입니다."})

@app.route('/admin/employees/<string:emp_id>', methods=['PUT'])
def update_employee(emp_id):
    if not is_admin_authenticated(): return jsonify({"success": False}), 401
    data = request.json
    name, region, dept, emp_type, rank, level = data.get('name','').strip(), data.get('region','').strip(), data.get('dept','').strip(), data.get('type','직영').strip(), data.get('rank','').strip(), int(data.get('level', 1))
    conn = get_db_connection()
    conn.execute("UPDATE employees SET name=?, region=?, dept=?, type=?, rank=?, level=? WHERE id=?", (name, region, dept, emp_type, rank, level, emp_id))
    conn.commit(); conn.close()
    return jsonify({"success": True})

@app.route('/admin/employees/<string:emp_id>', methods=['DELETE'])
def delete_employee(emp_id):
    if not is_admin_authenticated(): return jsonify({"success": False}), 401
    conn = get_db_connection()
    conn.execute("DELETE FROM employees WHERE id=?", (emp_id,))
    conn.commit(); conn.close()
    return jsonify({"success": True})

@app.route('/api/admin/upload-employees', methods=['POST'])
def upload_employees_excel():
    if not is_admin_authenticated(): return jsonify({"success": False}), 401
    file = request.files.get('file')
    if not file or file.filename == '': return jsonify({"success": False, "message": "파일 없음"}), 400

    try:
        df = pd.read_excel(BytesIO(file.read()))
        conn = get_db_connection()
        success_count = 0
        for _, row in df.iterrows():
            emp_id, name = str(row.get('사번', '')).strip(), str(row.get('성명', '')).strip()
            if not emp_id or not name or emp_id == 'nan' or name == 'nan': continue

            region = str(row.get('지역', '')).replace('nan', '')
            dept = str(row.get('부서', '')).replace('nan', '')
            emp_type = str(row.get('구분', '직영')).replace('nan', '직영')
            rank = str(row.get('직급', '')).replace('nan', '')

            existing = conn.execute("SELECT level FROM employees WHERE id = ?", (emp_id,)).fetchone()
            if existing:
                # 🔒 기존 직원: 권한(level)은 보존하고 나머지 정보만 갱신.
                #    (엑셀 일괄 업로드로 관리자/보안실 권한이 실수로 바뀌는 것을 방지)
                conn.execute(
                    "UPDATE employees SET name=?, region=?, dept=?, type=?, rank=? WHERE id=?",
                    (name, region, dept, emp_type, rank, emp_id)
                )
            else:
                # 신규 직원: 엑셀의 '권한' 값으로 최초 등록 (값이 없거나 잘못되면 기본 1).
                try:
                    level = int(row.get('권한', 1))
                except (ValueError, TypeError):
                    level = 1
                conn.execute(
                    "INSERT INTO employees (id, name, region, dept, type, rank, level) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (emp_id, name, region, dept, emp_type, rank, level)
                )
            success_count += 1
        conn.commit(); conn.close()
        return jsonify({"success": True, "message": f"{success_count}명 등록 완료"})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

def expire_stale_reservations():
    """⏳ '유통기한' 만료 처리.
      - 대상: status 가 '사전예약' 또는 '입실대기' 인데 방문 예정일(visit_date)이 오늘보다 이전이고,
              아직 입실하지 않은(checkin_time 없음) 건.
      - 처리: status 를 '만료' 로 변경 (레코드는 보존). 재방문하려면 새로 신청해야 함.
      - 지역 구분 없이 전체 대상. 이미 지난 건만 대상이라 반복 실행해도 안전(멱등).
    """
    today_str = get_current_kst_time().strftime('%Y-%m-%d')
    try:
        conn = get_db_connection()
        cur = conn.execute("""
            UPDATE visitor_log
               SET status = '만료'
             WHERE status IN ('사전예약', '입실대기')
               AND visit_date < ?
               AND (checkin_time IS NULL OR checkin_time = '')
        """, (today_str,))
        conn.commit()
        n = cur.rowcount
        conn.close()
        print(f"[EXPIRE] {today_str} 기준 만료 처리 완료: {n}건")
        return n
    except Exception as e:
        print(f"[EXPIRE][ERROR] {e}")
        return 0

def _midnight_expiry_scheduler():
    """매일 KST 자정 직후(00:00:10) expire_stale_reservations 를 실행하는 백그라운드 루프 (표준 라이브러리만 사용)."""
    while True:
        now = get_current_kst_time()
        next_run = (now + timedelta(days=1)).replace(hour=0, minute=0, second=10, microsecond=0)
        time.sleep(max((next_run - now).total_seconds(), 1))
        expire_stale_reservations()

# 디버그/리로더 설정 (스케줄러 중복 기동 방지에 사용)
#   - Render 플랫폼은 환경변수 RENDER=true 를 자동 주입한다 → 운영에서는 항상 디버그 OFF.
#   - 로컬/내부망 테스트에서는 기본 ON (원하면 FLASK_DEBUG=0 으로 끌 수 있음).
IS_RENDER = os.environ.get("RENDER") == "true"
DEBUG = (not IS_RENDER) and (os.environ.get("FLASK_DEBUG", "1") == "1")

if __name__ == '__main__':
    # Flask 디버그 리로더는 프로세스를 2개 띄우므로, 실제 서빙 프로세스에서만 스케줄러를 1회 기동.
    if (not DEBUG) or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        expire_stale_reservations()  # 시작 시 밀린 만료 즉시 정리 (자정에 서버가 꺼져 있던 경우 대비)
        threading.Thread(target=_midnight_expiry_scheduler, daemon=True).start()
        start_backup_thread()        # Render(GITHUB_TOKEN 설정 시)에서만 GitHub 백업 워커 기동

        # 🛑 종료 직전 자동 백업: Render 는 재배포/재시작 전에 SIGTERM 을 먼저 보낸다.
        #   그 순간 최신 DB 를 한 번 더 백업 → '커밋 깜빡'으로 인한 유실을 원천 제거.
        #   (로컬 개발의 Ctrl+C 는 SIGINT 라 영향 없음. GITHUB_TOKEN 있을 때만 설치.)
        if GITHUB_TOKEN:
            import signal
            def _graceful_backup(signum, frame):
                print("🧹 [종료] SIGTERM 감지 → 종료 직전 백업 시도", flush=True)
                try:
                    backup_db_to_github()
                except Exception as e:
                    print(f"❌ [종료] 종료 직전 백업 실패: {e}", flush=True)
                finally:
                    sys.stdout.flush()
                    sys.stderr.flush()
                    os._exit(0)
            signal.signal(signal.SIGTERM, _graceful_backup)
            # 등록 확인용: 시작 로그에 이 줄이 보이면 종료 훅이 정상 설치된 것.
            print("🔧 [종료훅] SIGTERM 백업 핸들러 등록 완료", flush=True)

    # 포트: Render 는 PORT 환경변수를 주입한다. 로컬/내부망은 5000 기본.
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=DEBUG)