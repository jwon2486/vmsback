from flask import Flask, request, jsonify, render_template, send_file, send_from_directory, session, redirect, url_for
import sqlite3
import sys
import os
import re
import json
import uuid 
from datetime import datetime, timedelta, timezone
import calendar
import pandas as pd
from io import BytesIO
import urllib.parse
import threading
import tempfile
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
    'dt': '테크센터',        # 동탄
    'bs': '에코센터',        # 부산
    'pt': '평택공장',        # 평택
    'gj': '거제 오션센터',   # 거제 (구 '거제 조선소' → 사명 변경, init_db 에서 기존 데이터 일괄 갱신)
}
ALLOWED_REGIONS = set(REGION_MAP.values())  # {'테크센터', '에코센터', '평택공장', '거제 오션센터'}

# 거점명 변경 이력: 예전 값 → 현재 값. init_db 가 기동 시 DB 를 자동 갱신한다(멱등).
REGION_RENAMES = {
    '거제 조선소': '거제 오션센터',
}

def get_db_connection():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn

def issue_visit_code(conn, emp_id):
    """직원 한 명에게 담당자 번호를 발급한다(이미 있으면 그대로 둔다).
       직원이 새로 생기는 모든 경로에서 호출한다 — 번호가 비어 있으면
       방문객이 그 직원을 담당자로 지정할 수 없다."""
    row = conn.execute("SELECT visit_code FROM employees WHERE id = ?", (emp_id,)).fetchone()
    if row and (row['visit_code'] or '').strip():
        return row['visit_code']
    used = {r[0] for r in conn.execute(
        "SELECT visit_code FROM employees WHERE visit_code IS NOT NULL AND visit_code != ''")}
    code = _new_visit_code(used)
    conn.execute("UPDATE employees SET visit_code = ? WHERE id = ?", (code, emp_id))
    return code

def _new_visit_code(used=None):
    """담당자 고유번호를 하나 만든다. 6자리 숫자(100000~999999).
       - 구두·문자로 전달하기 쉬운 길이이고, 모바일 숫자 키패드로 바로 입력된다.
       - 4자리면 오타가 다른 사람의 유효번호가 될 확률이 높아 6자리로 둔다.
       used: 이미 쓰인 번호 집합(대량 발급 시 DB 왕복을 줄이려고 받는다)"""
    import random
    while True:
        code = str(random.randint(100000, 999999))
        if used is None:
            return code
        if code not in used:
            used.add(code)
            return code

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

    # ── 🎫 정기 이용 방문객(정기권) ────────────────────────────────────
    #   상시 출입하는 용역·납품 업체가 매일 방문 신청하는 부담을 없애기 위한 '출입증' 개념.
    #   방문 기록 자체는 기존대로 visitor_log 에 쌓는다(스캔할 때마다 그날 행을 생성).
    #   → 출입기록·엑셀·통계·미퇴실 관리 등 기존 기능이 코드 변경 없이 정기 방문객까지 포함한다.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS visitor_pass (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            contact      TEXT NOT NULL,
            company      TEXT NOT NULL,
            vehicle_no   TEXT DEFAULT '없음',
            purpose      TEXT NOT NULL,
            manager_text TEXT NOT NULL,
            created_by   TEXT,                    -- 발급 시 블라인드 매칭된 사내 담당자 사번
            region       TEXT NOT NULL,           -- 거점 고정 (주차 정기권과 동일)
            valid_from   TEXT NOT NULL,
            valid_to     TEXT NOT NULL,           -- 필수: 무기한 출입증을 만들지 않기 위한 안전장치
            weekdays     TEXT DEFAULT '1111111',  -- 월~일 허용 요일 ('1'=허용)
            auto_approve INTEGER DEFAULT 0,       -- 0=경비실 대면 승인(기본), 1=스캔 즉시 입·퇴실 확정
            status       TEXT DEFAULT '활성',      -- 신청 / 활성 / 정지 / 만료 / 해지 / 반려
            token        TEXT UNIQUE NOT NULL,    -- 영구 QR 토큰 (visitor_log.token 과 형식 동일)
            memo         TEXT DEFAULT '',
            requested_at TEXT DEFAULT '',        -- 손님이 신청한 시각 (직접 발급이면 비어 있음)
            issued_at    TEXT DEFAULT '',        -- 승인·발급 시각
            issued_by    TEXT DEFAULT ''         -- 발급(승인)한 담당자 사번
        )
    """)
    try:
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_visitor_pass_token ON visitor_pass(token)")
    except sqlite3.OperationalError:
        pass

    # 손님이 직접 낸 발급 신청의 접수 시각 (승인 전). issued_at 은 '승인·발급' 시각이라 따로 둔다.
    try:
        cursor.execute("ALTER TABLE visitor_pass ADD COLUMN requested_at TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass

    # 출입증 유형(pass_type) 제거. 정기/수시를 나눠도 출입 동작이 같아 구분 실효가 없었다.
    #   기존 DB 호환: 컬럼이 남아 있으면 떨굴다 (SQLite 3.35+ 에서만 지원).
    try:
        cursor.execute("ALTER TABLE visitor_pass DROP COLUMN pass_type")
    except sqlite3.OperationalError:
        pass

    # 🕗 신청이 접수된 시각. 같은 사람이 그룹 신청에 포함된 줄 모르고 개별 신청을 또 올리면
    #    어느 쪽이 먼저·나중인지 화면에서 구분이 안 돼 중복 정리가 어렵다.
    #    (기존 행은 값이 없다 — 이 컬럼이 생기기 전에 접수된 건이라 소급해 채울 근거가 없다)
    try:
        cursor.execute("ALTER TABLE visitor_log ADD COLUMN created_at TEXT DEFAULT ''")
        print("🕗 [신청 시각] visitor_log.created_at 컬럼 추가")
    except sqlite3.OperationalError:
        pass

    # 방문 기록 ↔ 정기권 연결 (NULL = 일반 방문객). 기록 화면의 유형 배지·집계에 쓰인다.
    try:
        cursor.execute("ALTER TABLE visitor_log ADD COLUMN pass_id INTEGER")
    except sqlite3.OperationalError:
        pass
    
    cursor.execute("SELECT COUNT(*) FROM employees WHERE id = 'admin'")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
            INSERT INTO employees (id, name, dept, rank, type, region, level)
            VALUES ('admin', '최고관리자', '관리부', '팀장', '직영', '테크센터', 3)
        """)

    # 🗺️ 거점명 변경 반영 (멱등): 이미 저장된 옛 거점명을 현재 이름으로 일괄 갱신.
    #   region 은 조회 필터·경비실 권한 판정의 매칭 키라, 코드만 바꾸면 기존 데이터가 매칭되지 않는다.
    #   기동 시마다 실행되지만 대상 행이 없으면 아무 일도 하지 않는다.
    for old_name, new_name in REGION_RENAMES.items():
        for table in ('visitor_log', 'employees'):
            try:
                cursor.execute(f"UPDATE {table} SET region = ? WHERE region = ?", (new_name, old_name))
                if cursor.rowcount:
                    print(f"🗺️ [거점명 갱신] {table}: '{old_name}' → '{new_name}' {cursor.rowcount}건")
            except sqlite3.OperationalError:
                pass   # region 컬럼이 아직 없는 초기 스키마 등

    conn.commit()
    conn.close()

    migrate_department_tree()

# ====================================================================
# 🌳 부서 트리 도입 (멱등)
#   - 기존: employees.dept 평면 텍스트 → 계층 정보가 없어 '전력시스템팀(설계/설계-부산/연구)'
#           같은 하위 조직 구분이 사라졌다.
#   - 변경: department_tree(계층) + employees.dept_id(FK) 추가.
#           dept 컬럼은 '표시용'으로 그대로 유지한다. 뷰로 바꾸면 기존 쓰기 API가
#           동작하지 않으므로, 실테이블을 유지하고 컬럼만 늘리는 방식을 택했다.
#   - 트리 데이터는 department_tree_seed.json 에서 읽는다(전산장비 조직도 스냅샷 + 방문객 전용 노드).
#     ※ 전산장비 DB 를 런타임에 참조하지 않으므로 Render 환경에서도 동일하게 동작한다.
# ====================================================================
DEPT_SEED_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'department_tree_seed.json')

# ── 부서 사용 범위(dept_scope) ────────────────────────────────────────
#   조직도는 여러 사내 시스템(식수·방문객·전산장비)이 함께 쓰게 될 수 있는데,
#   시스템마다 필요한 부서가 다르다. 예) '서버실'·'폐기 대상 장비'는 전산장비 자산 관리용이라
#   방문객 조직도에 뜨면 안 되고, '경비실'·'에코센터경비실'은 그 반대다.
#   → 부서마다 "어느 시스템에서 쓰는가"를 별도 테이블로 관리하고, 각 시스템은 자기 것만 조회한다.
#   ⚠️ 트리 불변식: 자식이 보이는 시스템에서는 부모도 보여야 한다(안 그러면 고아 노드가 생김).
#      부서 추가/수정 API 가 이 규칙을 지키도록 부모 범위를 상속시킨다.
SYSTEM_VISITOR = 'visitor'
SYSTEM_EQUIPMENT = 'equipment'

# 🚪 퇴직자 보관함. '기타/외부' 아래에 두어 조직도 본문과 섞이지 않게 한다.
#   퇴직 처리 = 이 부서로 이동. 계정·방문 기록은 남기되 로그인은 차단한다.
#   완전 삭제는 이 폴더 안에서 관리자가 개별 판단해 수행한다.
RETIRED_DEPT_NAME = '퇴직자'
EXTERNAL_ROOT_NAME = '기타/외부'

# 전산장비 자산 관리 전용 노드(방문객 조직도에서 숨김). 이름으로 판정해 시드 1회만 적용한다.
EQUIPMENT_ONLY_DEPTS = {
    '서버실', '서버실(화성)', '서버실(부산)',
    '폐기 대상 장비', '퇴사자(장비반납대기)',
}

def migrate_dept_scope(cur):
    """부서 사용 범위 테이블 생성 + 최초 1회 시드 (멱등)."""
    cur.execute("""
        CREATE TABLE IF NOT EXISTS dept_scope (
            dept_id INTEGER NOT NULL REFERENCES department_tree(id),
            system  TEXT    NOT NULL,
            PRIMARY KEY (dept_id, system)
        )
    """)
    if cur.execute("SELECT COUNT(*) FROM dept_scope").fetchone()[0] > 0:
        return

    rows = cur.execute("SELECT id, dept_name, parent_id FROM department_tree").fetchall()
    tree = {r['id']: dict(r) for r in rows}

    def is_equipment_only(dept_id):
        """자신 또는 조상 중 하나라도 전산장비 전용이면 전용으로 본다(하위도 함께 숨김)."""
        seen = set()
        while dept_id in tree and dept_id not in seen:
            seen.add(dept_id)
            if tree[dept_id]['dept_name'] in EQUIPMENT_ONLY_DEPTS:
                return True
            dept_id = tree[dept_id]['parent_id']
        return False

    seed = []
    for i, d in tree.items():
        if i >= 9000:
            seed.append((i, SYSTEM_VISITOR))                     # 방문객 전용 노드
        elif is_equipment_only(i):
            seed.append((i, SYSTEM_EQUIPMENT))                   # 전산장비 전용 노드
        else:
            seed.append((i, SYSTEM_VISITOR))                     # 실제 조직 = 양쪽 공용
            seed.append((i, SYSTEM_EQUIPMENT))
    cur.executemany("INSERT INTO dept_scope (dept_id, system) VALUES (?, ?)", seed)
    v = sum(1 for _, s in seed if s == SYSTEM_VISITOR)
    print(f"🔖 [부서 범위] {len(tree)}개 노드 분류 (방문객 노출 {v}개)")


def ensure_retired_dept(cur):
    """'기타/외부 > 퇴직자' 부서를 보장하고 id 를 돌려준다. (없으면 생성)"""
    row = cur.execute("SELECT id FROM department_tree WHERE dept_name = ?",
                      (RETIRED_DEPT_NAME,)).fetchone()
    if row:
        retired_id = row['id']
    else:
        parent = cur.execute("SELECT id FROM department_tree WHERE dept_name = ?",
                             (EXTERNAL_ROOT_NAME,)).fetchone()
        cur.execute("INSERT INTO department_tree (dept_name, parent_id) VALUES (?, ?)",
                    (RETIRED_DEPT_NAME, parent['id'] if parent else None))
        retired_id = cur.lastrowid
    # 조직도에 반드시 보이도록 범위 등록 (빠뜨리면 퇴직자가 화면에서 사라진다)
    cur.execute("INSERT OR IGNORE INTO dept_scope (dept_id, system) VALUES (?, ?)",
                (retired_id, SYSTEM_VISITOR))
    return retired_id


def migrate_retired_dept(cur):
    """옛 이름('퇴사자')·최상위에 있던 퇴직자 폴더를 '기타/외부 > 퇴직자'로 정리한다(멱등)."""
    old = cur.execute("SELECT id, parent_id FROM department_tree WHERE dept_name = '퇴사자'").fetchone()
    if old:
        parent = cur.execute("SELECT id FROM department_tree WHERE dept_name = ?",
                             (EXTERNAL_ROOT_NAME,)).fetchone()
        cur.execute("UPDATE department_tree SET dept_name = ?, parent_id = ? WHERE id = ?",
                    (RETIRED_DEPT_NAME, parent['id'] if parent else None, old['id']))
        cur.execute("UPDATE employees SET dept = ? WHERE dept_id = ?", (RETIRED_DEPT_NAME, old['id']))
        cur.execute("INSERT OR IGNORE INTO dept_scope (dept_id, system) VALUES (?, ?)",
                    (old['id'], SYSTEM_VISITOR))
        n = cur.execute("SELECT COUNT(*) FROM employees WHERE dept_id = ?", (old['id'],)).fetchone()[0]
        print(f"🚪 [퇴직자] '퇴사자' → '{EXTERNAL_ROOT_NAME} > {RETIRED_DEPT_NAME}' 로 이전 ({n}명)")


def repair_orphan_dept_scope(cur):
    """직원이 소속돼 있는데 범위가 없어 조직도에서 안 보이는 부서를 되살린다(멱등).

    화면에서 만든 부서(퇴사자 등)를 dept_scope 에 등록하지 않으면
    소속 직원이 조직도에서 통째로 사라져 되돌릴 방법이 없어진다.
    그런 '고아 부서'를 찾아 방문객 범위로 편입한다.
    """
    rows = cur.execute("""
        SELECT DISTINCT d.id, d.dept_name, COUNT(e.id) AS n
        FROM department_tree d
        JOIN employees e ON e.dept_id = d.id
        WHERE NOT EXISTS (
            SELECT 1 FROM dept_scope s WHERE s.dept_id = d.id AND s.system = ?
        )
        GROUP BY d.id
    """, (SYSTEM_VISITOR,)).fetchall()
    for r in rows:
        cur.execute("INSERT OR IGNORE INTO dept_scope (dept_id, system) VALUES (?, ?)",
                    (r['id'], SYSTEM_VISITOR))
        print(f"🔧 [부서 범위 복구] '{r['dept_name']}'({r['n']}명)가 조직도에서 누락되어 있어 복구")

def migrate_department_tree():
    if not os.path.exists(DEPT_SEED_PATH):
        return   # 시드가 없으면 조용히 통과 (기존 평면 dept 로 계속 동작)

    with open(DEPT_SEED_PATH, encoding='utf-8') as f:
        seed = json.load(f)

    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS department_tree (
            id             INTEGER PRIMARY KEY,
            dept_name      TEXT NOT NULL,
            parent_id      INTEGER REFERENCES department_tree(id),
            manager_emp_id TEXT,
            use_fallback   INTEGER DEFAULT 0
        )
    """)
    # 최초 1회만 시드 주입. 이후 화면에서 편집한 트리를 덮어쓰지 않는다.
    if cur.execute("SELECT COUNT(*) FROM department_tree").fetchone()[0] == 0:
        cur.executemany(
            "INSERT INTO department_tree (id, dept_name, parent_id) VALUES (?, ?, ?)",
            [(d['id'], d['dept_name'], d.get('parent_id')) for d in seed['departments']]
        )
        print(f"🌳 [부서 트리] {len(seed['departments'])}개 노드 생성")

    cols = {r[1] for r in cur.execute("PRAGMA table_info(employees)")}
    if 'dept_id' not in cols:
        cur.execute("ALTER TABLE employees ADD COLUMN dept_id INTEGER REFERENCES department_tree(id)")
        print("🌳 [부서 트리] employees.dept_id 컬럼 추가")

    # 🔢 방문 담당자 고유번호 (이 시스템 전용 · 사번과 분리)
    #   - 목적: 방문객이 '담당자 이름'을 한글로 치지 않아도 담당자를 특정할 수 있게 한다.
    #           (외국인 방문객은 한글 입력이 불가하고, 동명이인이면 이름으로는 특정이 안 된다)
    #   - 사번을 쓰지 않는 이유: 인사 식별자를 사외(방문객)에 노출하지 않기 위해서.
    #   - 인증이 아니라 '라우팅' 값이다. 최종 확인은 경비실 승인 화면에서 담당자명을 보고 한다.
    if 'visit_code' not in cols:
        cur.execute("ALTER TABLE employees ADD COLUMN visit_code TEXT DEFAULT ''")
        print("🔢 [담당자 번호] employees.visit_code 컬럼 추가")
    # 비어 있는 직원에게만 채운다(멱등). 재발급은 별도 API 로 처리.
    _need = cur.execute(
        "SELECT id FROM employees WHERE visit_code IS NULL OR visit_code = ''").fetchall()
    if _need:
        _used = {r[0] for r in cur.execute(
            "SELECT visit_code FROM employees WHERE visit_code IS NOT NULL AND visit_code != ''")}
        for _e in _need:
            cur.execute("UPDATE employees SET visit_code = ? WHERE id = ?",
                        (_new_visit_code(_used), _e['id']))
        print(f"🔢 [담당자 번호] {len(_need)}명에게 신규 발급")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_visit_code "
                "ON employees(visit_code) WHERE visit_code != ''")

    # 아직 배치되지 않은 직원만 채운다(멱등). 우선순위: ①사번 매핑 ②부서명 일치
    name_ids = {}
    for r in cur.execute("SELECT id, dept_name FROM department_tree"):
        name_ids.setdefault(r['dept_name'], []).append(r['id'])

    emp_dept = seed.get('emp_dept', {})
    placed = 0
    for e in cur.execute("SELECT id, dept FROM employees WHERE dept_id IS NULL").fetchall():
        did = emp_dept.get(e['id'])
        if did is None and e['dept'] in name_ids:
            # 같은 이름이 여러 노드면 상위(작은 id) 선택 — 전산장비 운영 기준과 동일
            did = min(name_ids[e['dept']])
        if did is None:
            continue
        cur.execute("UPDATE employees SET dept_id = ? WHERE id = ?", (did, e['id']))
        placed += 1
    if placed:
        print(f"🌳 [부서 트리] 직원 {placed}명 부서 배치")

    migrate_dept_scope(cur)
    migrate_retired_dept(cur)
    repair_orphan_dept_scope(cur)

    # 🔄 dept(표시용 텍스트)를 트리 기준으로 동기화.
    #    dept_id 가 유일한 진실이고 dept 는 그로부터 파생된 표시값이다.
    #    (기존 dept 는 상위 이름만 갖고 있어 '전력시스템팀' 처럼 하위 조직 구분이 없었다)
    #    매 기동 시 실행되지만 값이 이미 같으면 UPDATE 대상이 0건이라 부담이 없다.
    cur.execute("""
        UPDATE employees
           SET dept = (SELECT d.dept_name FROM department_tree d WHERE d.id = employees.dept_id)
         WHERE dept_id IS NOT NULL
           AND dept <> (SELECT d.dept_name FROM department_tree d WHERE d.id = employees.dept_id)
    """)
    if cur.rowcount:
        print(f"🌳 [부서 트리] 표시용 dept {cur.rowcount}명 동기화")

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

def resolve_manager_by_code(manager_code):
    """담당자 고유번호(visit_code)로 방문 담당자를 특정한다.
       방문객에게 직원 명부는 노출하지 않는다(블라인드).

    이름 매칭은 쓰지 않는다:
      - 외국인 방문객은 한글 이름을 입력할 수 없다.
      - 동명이인이면 이름만으로는 특정이 되지 않아 매번 데스크 확인으로 빠졌다.
    번호는 전사 유일하므로 거점을 따지지 않는다.

    returns (emp_id, emp_name)
      - 특정 실패 시 ('guard_pending', '') → 경비실 데스크에서 확인한다.
    """
    code = (manager_code or '').strip()
    if not code:
        return 'guard_pending', ''
    conn = get_db_connection()
    row = conn.execute(
        "SELECT id, name FROM employees WHERE visit_code = ? AND visit_code != ''", (code,)
    ).fetchone()
    conn.close()
    if row:
        return row['id'], row['name']
    return 'guard_pending', ''

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

def early_expected_str(visit_date, expected_checkin):
    """조기 입실 안내에 쓰는 '예약 예정시각' 표기. 손님 화면 번역의 치환값으로도 쓴다."""
    dt = _to_expected_dt(visit_date, expected_checkin)
    if dt and (expected_checkin or '').strip():
        return dt.strftime('%Y-%m-%d %H:%M')
    return f"{visit_date} (예정시간 미지정)"


def build_early_warning_message(visit_date, expected_checkin):
    """조기 입실 확인 팝업에 표시할 안내 문구."""
    expected_str = early_expected_str(visit_date, expected_checkin)
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

# 🌐 손님 화면 다국어 사전 (lang/ko.json, en.json, zh.json)
#    js/i18n.js 가 선택된 언어 + 폴백(ko)만 받아간다.
@app.route('/lang/<path:filename>')
def serve_lang(filename): return send_from_directory(os.path.join(BASE_DIR, 'lang'), filename)

@app.route('/')
@app.route('/emp')
def guest_page(): return render_template('guest.html')

@app.route('/v/<region_code>')
def guest_region_entry(region_code):
    """
    📍 거점별 QR/링크 진입점.
      - 정문에 비치한 거점별 QR이 이 경로를 가리킨다. (예: /v/gj → 거제 오션센터)
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

# 📊 전체 출입 기록 전용 페이지 (관리자 tab-panel 재사용). 팝업 iframe 대상.
#    권한: 최고 관리자(3)·경비실(4)·전체기록 열람(5). 그 외는 임직원 화면으로.
@app.route('/records')
def records_page():
    if 'user' not in session:
        return redirect(url_for('guest_page'))
    if int(session['user'].get('level', 1)) not in (3, 4, 5):
        return redirect(url_for('guest_page'))
    return render_template('records.html')

# ====================================================================
# 👤 임직원 인증 및 스케줄 API
# ====================================================================
@app.route('/api/emp/login', methods=['POST'])
def emp_login():
    data = request.json or {}
    emp_id, emp_name = data.get('id', '').strip(), data.get('name', '').strip()
    
    conn = get_db_connection()
    # 🚪 퇴직 여부를 함께 조회 (부서가 '퇴직자' 보관함이면 로그인 차단)
    emp = conn.execute("""
        SELECT e.id, e.name, e.dept, e.rank, e.level, e.region,
               (d.dept_name = ?) AS is_retired
        FROM employees e LEFT JOIN department_tree d ON e.dept_id = d.id
        WHERE e.id = ? AND e.name = ?
    """, (RETIRED_DEPT_NAME, emp_id, emp_name)).fetchone()
    conn.close()

    if emp:
        emp_dict = dict(emp)
        if emp_dict.pop('is_retired', 0):
            return jsonify({"success": False,
                            "message": "퇴직 처리된 계정입니다. 관리자에게 문의해 주세요."})
        session['user'] = emp_dict
        return jsonify({"success": True, "employee": emp_dict})
    return jsonify({"success": False, "message": "사번 또는 성명이 일치하지 않습니다."})

# 🔢 담당자 고유번호 — 본인 것만 조회/재발급한다.
#    방문객에게 이 번호를 알려주면, 방문객은 한글 이름을 치지 않고도 담당자를 지정할 수 있다.
@app.route('/api/emp/visit-code', methods=['GET', 'POST'])
def emp_visit_code():
    if 'user' not in session:
        return jsonify({"success": False, "message": "로그인이 필요합니다."}), 401
    emp_id = session['user'].get('id')
    conn = get_db_connection()
    cur = conn.cursor()

    if request.method == 'POST':
        # 재발급: 번호가 외부로 새어나갔을 때 쓴다. 이전 번호로 오는 신청은 그때부터 매칭되지 않는다.
        #  ※ 직원이 원하는 번호를 직접 고르는 방식은 쓰지 않는다.
        #     생일·전화 뒷자리는 겹치는 사람이 많아 '이미 사용 중'을 반복해서 만나게 되고,
        #     그런 번호는 예측 가능해서 오입력이 남의 유효번호가 될 확률도 올라간다.
        used = {r[0] for r in cur.execute(
            "SELECT visit_code FROM employees WHERE visit_code IS NOT NULL AND visit_code != ''")}
        cur.execute("UPDATE employees SET visit_code = ? WHERE id = ?",
                    (_new_visit_code(used), emp_id))
        conn.commit()

    row = cur.execute("SELECT visit_code FROM employees WHERE id = ?", (emp_id,)).fetchone()
    # 과거에 만들어진 계정 등으로 비어 있으면 이 시점에 채운다.
    if row and not (row['visit_code'] or '').strip():
        used = {r[0] for r in cur.execute(
            "SELECT visit_code FROM employees WHERE visit_code IS NOT NULL AND visit_code != ''")}
        code = _new_visit_code(used)
        cur.execute("UPDATE employees SET visit_code = ? WHERE id = ?", (code, emp_id))
        conn.commit()
    else:
        code = row['visit_code'] if row else ''
    conn.close()
    return jsonify({"success": True, "visit_code": code})

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

# ── 🔳 직원이 대신 등록해 준 방문객의 QR 전달 ─────────────────────
#   왜: 손님이 직접 등록하지 않고 직원이 대신 잡아준 방문 건은, 손님에게 QR 이 없어
#       현장에서 입·퇴실 신청을 스스로 하지 못한다. 직원이 링크·QR 을 미리 보내주면
#       손님은 그 화면에서 평소처럼 입장·퇴장 신청을 할 수 있다.
#   보안: 토큰은 그 자체가 입·퇴실 신청 수단이라 아무에게나 내주지 않는다.
#        그 건을 등록한 본인, 또는 최고관리자(3)·경비실(4)·전체기록(5) 만 조회할 수 있다.
@app.route('/api/emp/visitor-qr', methods=['GET'])
def emp_visitor_qr():
    """방문 건(id)의 QR 토큰을 반환. 그룹 방문이면 같은 날 그룹 전원을 함께 돌려준다."""
    if 'user' not in session:
        return jsonify({"success": False, "message": "인증 정보가 없습니다."}), 401

    log_id = (request.args.get('id') or '').strip()
    if not log_id.isdigit():
        return jsonify({"success": False, "message": "대상이 없습니다."}), 400

    conn = get_db_connection()
    base = conn.execute("""
        SELECT id, name, company, contact, visit_date, status, group_id, created_by, region
          FROM visitor_log WHERE id = ?
    """, (log_id,)).fetchone()
    if not base:
        conn.close()
        return jsonify({"success": False, "message": "방문 정보를 찾을 수 없습니다."}), 404

    me = session['user'].get('id', '')
    level = int(session['user'].get('level', 1))
    if (base['created_by'] or '') != me and level not in (3, 4, 5):
        conn.close()
        return jsonify({"success": False, "message": "본인이 등록한 방문 건만 조회할 수 있습니다."}), 403

    gid = base['group_id']
    if not gid or gid == 'NONE':
        rows = [base]
    else:
        rows = conn.execute("""
            SELECT id, name, company, contact, visit_date, status, group_id, created_by, region
              FROM visitor_log WHERE group_id = ? AND visit_date = ? ORDER BY id ASC
        """, (gid, base['visit_date'])).fetchall()

    members = []
    for r in rows:
        members.append({
            "id": r['id'], "name": r['name'], "company": r['company'],
            "status": r['status'], "token": get_or_create_token(conn, r['id']),
        })
    conn.close()
    return jsonify({"success": True, "visit_date": base['visit_date'],
                    "region": base['region'], "members": members})


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
        # 중복 신청 정리용. 같은 사람이 그룹 신청에 포함된 줄 모르고 개별 신청을 또 올리면
        # 방문 횟수가 부풀고 대기열에 두 번 뜬다. 아직 입실 전(사전예약·입실대기)인 건만 지운다.
        #   → 이미 입실한 건을 지우면 실제 출입 사실이 기록에서 사라지므로 허용하지 않는다.
        # 최고 관리자(3)·경비실(4)은 소유자 무관하게, 그 외에는 본인(created_by) 등록 건만.
        if requester_level in (3, 4):
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
                INSERT INTO visitor_log (visit_date, name, contact, company, vehicle_no, purpose, manager_text, checkin_time, created_by, status, region, group_id, expected_checkin, expected_checkout, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, '입실대기', ?, ?, ?, ?, ?)
            """, (visit_date, name, contact, company, vehicle_no, purpose, manager_name, created_by, region, group_id, expected_checkin, expected_checkout, get_current_kst_time().strftime('%Y-%m-%d %H:%M:%S')))

        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": f"총 {len(visitors)}명의 방문객이 등록되어 경비실 승인 대기 상태로 접수되었습니다."})
    except Exception as e:
        print(f"Group PreRegister Error: {e}")
        return jsonify({"success": False, "message": "등록 처리 중 서버 에러가 발생했습니다."}), 500

# ====================================================================
# 🛡️ 보안실(Level 4) 중심 관제 API
#   🔒 승인(입·퇴실 처리)은 '자기 소속 센터'로만 한정한다.
#      거점은 반드시 세션에서만 읽는다 — 요청 파라미터를 받으면
#      주소창/콘솔에서 region 을 바꿔 다른 센터를 처리할 수 있다.
# ====================================================================
def security_session_region():
    """로그인 세션에 기록된 경비실 담당 거점. 승인 계열 API 의 유일한 거점 출처."""
    return (session.get('user') or {}).get('region') or ''

@app.route('/api/security/pending-logs', methods=['GET'])
def get_security_pending_logs():
    if 'user' not in session or int(session['user'].get('level', 1)) != 4:
        return jsonify({"success": False}), 403

    region = security_session_region()   # 🔒 클라이언트 파라미터 무시
    today_str = get_current_kst_time().strftime('%Y-%m-%d')

    conn = get_db_connection()
    logs = conn.execute("""
        SELECT v.*, e.name AS emp_name, e.dept AS emp_dept
        FROM visitor_log v LEFT JOIN employees e ON v.created_by = e.id
        WHERE v.region = ? AND v.status IN ('입실대기', '퇴실대기') AND v.visit_date = ?
        ORDER BY v.id ASC
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

    region = security_session_region()   # 🔒 퇴실 처리 대상 목록이므로 자기 센터로만 한정
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

    # 🔒 자기 소속 센터의 건만 승인할 수 있다. (화면에서 숨기는 것만으론 부족 — API 직접 호출 차단)
    my_region = security_session_region()
    target = conn.execute("SELECT region FROM visitor_log WHERE id = ?", (log_id,)).fetchone()
    if not target:
        conn.close()
        return jsonify({"success": False, "message": "방문 정보를 찾을 수 없습니다.", "message_key": "srv.group.notFound"}), 404
    if not my_region or target['region'] != my_region:
        conn.close()
        return jsonify({"success": False, "message": "다른 사업장의 방문 건은 처리할 수 없습니다."}), 403

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

        # 🔒 자기 소속 센터의 그룹만 승인 가능. (그룹 전원이 같은 거점이므로 대표 1건으로 판정)
        my_region = security_session_region()
        grp = conn.execute("SELECT region FROM visitor_log WHERE group_id = ? LIMIT 1", (group_id,)).fetchone()
        if not grp:
            conn.close()
            return jsonify({"success": False, "message": "그룹 정보를 찾을 수 없습니다."}), 404
        if not my_region or grp['region'] != my_region:
            conn.close()
            return jsonify({"success": False, "message": "다른 사업장의 방문 건은 처리할 수 없습니다."}), 403

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
            WHERE group_id = ? AND status = ? AND region = ?
        """, (target_status, now_str, group_id, current_status, my_region))
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
    manager_code = data.get('manager_code', '').strip()

    # 거점: 전달값 우선, 없으면 보안실 근무자 본인 거점. 화이트리스트 외 값은 본인 거점으로 정규화.
    region = (data.get('region') or session['user'].get('region', '')).strip()
    if region not in ALLOWED_REGIONS:
        region = session['user'].get('region', '거점미상')
    
    # 이 경로는 경비실 근무자가 직접 입력하는 화면이다(손님 화면이 아니다).
    #  → 한글 이름 입력에 문제가 없고, 동명이인은 근무자가 현장에서 가려낼 수 있으므로
    #    담당자 번호와 이름을 모두 받는다. (손님 경로는 번호 전용)
    if not visit_date or not name or not contact or not company or not (manager_code or manager_text):
        return jsonify({"success": False, "message": "필수 정보를 모두 입력해주세요."})

    try:
        conn = get_db_connection()
        # 번호가 있으면 번호로, 없으면 이름+거점으로 담당자를 특정한다.
        emp_id_match, matched_name = resolve_manager_by_code(manager_code)
        if matched_name:
            manager_text = matched_name      # 번호로 찾았으면 사내 기준 이름으로 정규화
        elif manager_text:
            _rows = conn.execute(
                "SELECT id FROM employees WHERE name = ? AND region = ?", (manager_text, region)
            ).fetchall()
            if len(_rows) == 1:
                emp_id_match = _rows[0]['id']
        # 매칭 실패 시 보안실 근무자 본인의 ID로 임시 귀속
        bind_id = emp_id_match if emp_id_match != 'guard_pending' else session['user'].get('id')
        
        conn.execute("""
            INSERT INTO visitor_log (visit_date, name, contact, company, vehicle_no, purpose, manager_text, checkin_time, created_by, status, region, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, '사전예약', ?, ?)
        """, (visit_date, name, contact, company, vehicle_no, purpose, manager_text, bind_id, region, get_current_kst_time().strftime('%Y-%m-%d %H:%M:%S')))
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
    # pass_months: 이용권 기본 이용 기간(개월). 손님 화면의 안내 문구·기간 계산이 이 값을 쓴다.
    return jsonify({"region": region if region in ALLOWED_REGIONS else '',
                    "pass_periods": list(PASS_PERIODS), "pass_default_period": PASS_DEFAULT_PERIOD})

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
                    "message": build_early_warning_message(row['visit_date'], row['expected_checkin']),
                    "message_key": "srv.checkin.early",
                    "message_vars": {"expected": early_expected_str(row['visit_date'], row['expected_checkin'])}
                })

            cursor.execute("UPDATE visitor_log SET status = '입실대기' WHERE id = ?", (log_id,))
            conn.commit()
            conn.close()
            return jsonify({"success": True, "id": log_id, "message": "입실 요청이 완료되었습니다. 보안실 대면 승인 대기 중입니다.", "message_key": "srv.checkin.ok"})
        
        # 신규 현장 입실 → 거점은 세션(QR) 우선, 없으면 드롭다운 값. 모두 무효면 거부.
        region = resolve_guest_region(data)
        if not region:
            conn.close()
            return jsonify({"success": False, "message": "방문 거점이 확인되지 않습니다. 정문에 비치된 QR을 다시 스캔하거나 사업장을 선택해 주세요.", "message_key": "srv.region.unknown"}), 400

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
        manager_code = data.get('manager_code', '').strip()
        expected_checkin = (data.get('expected_checkin') or '').strip()
        expected_checkout = (data.get('expected_checkout') or '').strip()
        
        # 담당자는 고유번호로만 지정한다.
        if not name or not company or not contact or not manager_code:
            conn.close()
            return jsonify({"success": False, "message": "필수 입력 항목이 누락되었습니다.", "message_key": "srv.checkin.missing"})
            
        matched_emp_id, matched_name = resolve_manager_by_code(manager_code)
        if matched_name: manager_text = matched_name
        
        cursor.execute("""
            INSERT INTO visitor_log (visit_date, name, company, contact, vehicle_no, purpose, manager_text, created_by, region, status, checkin_time, expected_checkin, expected_checkout, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '입실대기', '', ?, ?, ?)
        """, (today_date, name, company, contact, vehicle_no, purpose, manager_text, matched_emp_id, region, expected_checkin, expected_checkout, get_current_kst_time().strftime('%Y-%m-%d %H:%M:%S')))
        new_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        if matched_emp_id == 'guard_pending':
            return jsonify({"success": True, "id": new_id, "message": "담당자 확인이 필요합니다. 안내 데스크(경비실)로 이동해 주세요.", "message_key": "srv.checkin.needDesk"})
        return jsonify({"success": True, "id": new_id, "message": "입실 요청이 완료되었습니다. 대면 승인 대기 중입니다.", "message_key": "srv.checkin.ok2"})

    except Exception as e:
        print(f"Checkin Error: {e}")
        return jsonify({"success": False, "message": f"입실 처리 중 시스템 오류가 발생했습니다. ({str(e)})",
                        "message_key": "srv.checkin.error", "message_vars": {"detail": str(e)}}), 500

@app.route('/api/group-checkin', methods=['POST'])
def handle_group_checkin():
    data = request.json or {}
    visitors = data.get('visitors', [])

    # 거점: 세션(QR) 우선, 없으면 드롭다운 값. 모두 무효면 거부.
    region = resolve_guest_region(data)
    if not region:
        return jsonify({"success": False, "message": "방문 거점이 확인되지 않습니다. 정문에 비치된 QR을 다시 스캔하거나 사업장을 선택해 주세요.", "message_key": "srv.region.unknown"}), 400
    
    today_date = get_current_kst_time().strftime('%Y-%m-%d')
    
    if not visitors:
        return jsonify({"success": False, "message": "방문객 정보가 없습니다.", "message_key": "srv.group.noVisitors"})

    group_id = f"GRP_{uuid.uuid4().hex[:8].upper()}"
    new_id = None
    has_pending = False
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        member_ids = []
        for i, v in enumerate(visitors):
            matched_emp_id, matched_name = resolve_manager_by_code(v.get('manager_code', ''))
            if matched_name: v['manager_text'] = matched_name
            if matched_emp_id == 'guard_pending':
                has_pending = True
                
            cursor.execute("""
                INSERT INTO visitor_log (visit_date, name, company, contact, vehicle_no, purpose, manager_text, created_by, region, status, checkin_time, group_id, expected_checkin, expected_checkout, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '입실대기', '', ?, ?, ?, ?)
            """, (today_date, v['name'], v['company'], v['contact'], v.get('vehicle_no', '없음'), 
                  v['purpose'], v['manager_text'], matched_emp_id, region, group_id,
                  (v.get('expected_checkin') or '').strip(), (v.get('expected_checkout') or '').strip(), get_current_kst_time().strftime('%Y-%m-%d %H:%M:%S')))
            
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
        
        # 문구를 이어 붙이지 않고 두 벌로 나눈다 — 어순이 다른 언어에서 번역이 깨지지 않게.
        if has_pending:
            msg = f"총 {len(visitors)}명의 입실 요청이 완료되었습니다. 담당자 확인이 필요하여 데스크로 이동해주세요."
            key = "srv.group.okDesk"
        else:
            msg = f"총 {len(visitors)}명의 입실 요청이 완료되었습니다."
            key = "srv.group.ok"
        return jsonify({"success": True, "id": new_id, "token": token, "members": members,
                        "message": msg, "message_key": key,
                        "message_vars": {"count": len(visitors)}})
    except Exception as e:
        print(f"Group Checkin Error: {e}")
        return jsonify({"success": False, "message": f"시스템 오류가 발생했습니다. ({str(e)})",
                        "message_key": "srv.group.error", "message_vars": {"detail": str(e)}}), 500

@app.route('/api/checkout', methods=['POST'])
def handle_integrated_checkout():
    log_id = (request.json or {}).get('id')
    if not log_id: return jsonify({"success": False, "message": "ID 누락", "message_key": "srv.checkout.noId"}), 400
        
    conn = get_db_connection()
    conn.execute("UPDATE visitor_log SET status = '퇴실대기' WHERE id = ? AND status = '입실완료'", (log_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "퇴실 요청이 접수되었습니다. 보안실 최종 승인 후 마감 처리됩니다.", "message_key": "srv.checkout.ok"})

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
        return jsonify({"success": False, "message": "방문 거점이 확인되지 않습니다. 정문에 비치된 QR을 다시 스캔하거나 사업장을 선택해 주세요.", "message_key": "srv.region.unknown"}), 400

    if not visit_date or not name or not contact or not company or not purpose:
        return jsonify({"success": False, "message": "필수 예약 정보를 입력해 주세요."})

    try:
        conn = get_db_connection()
        conn.execute("""
            INSERT INTO visitor_log (visit_date, name, contact, company, vehicle_no, purpose, manager_text, checkin_time, created_by, status, region, created_at)
            VALUES (?, ?, ?, ?, ?, ?, '', '', ?, '사전예약', ?, ?)
        """, (visit_date, name, contact, company, vehicle_no, purpose, created_by, region, get_current_kst_time().strftime('%Y-%m-%d %H:%M:%S')))
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
    """토큰을 담은 스캔 링크(/v/scan?token=...)를 QR 이미지로 반환.
       - 기본은 SVG (화면 표시용 — 확대해도 깨지지 않는다)
       - format=png : 저장·전달용. 메신저·메일로 보내려면 PNG 가 호환성이 좋다.
       - download=1 : 첨부파일로 내려받게 한다. filename 으로 저장될 이름을 지정.
    """
    token = request.args.get('token', '').strip()
    if not token:
        return "missing token", 400
    scan_url = f"{request.host_url.rstrip('/')}/v/scan?token={urllib.parse.quote(token)}"
    from flask import Response

    if request.args.get('format') == 'png':
        img = qrcode.make(scan_url, box_size=10, border=2)      # 기본 PIL 이미지 → PNG
        buf = BytesIO()
        img.save(buf, format='PNG')
        resp = Response(buf.getvalue(), mimetype='image/png')
        if request.args.get('download'):
            name = (request.args.get('filename') or 'QR').strip() or 'QR'
            resp.headers["Content-Disposition"] = \
                f"attachment; filename*=UTF-8''{urllib.parse.quote(name + '.png')}"
        return resp

    img = qrcode.make(scan_url, image_factory=qrcode.image.svg.SvgImage, box_size=10, border=2)
    buf = BytesIO()
    img.save(buf)
    return Response(buf.getvalue(), mimetype='image/svg+xml')

# 📍 거점별 진입 링크(/v/<코드>)를 QR SVG 로 서버에서 즉석 생성 (외부 서비스·만료 없음).
#    링크는 접속 호스트(request.host_url) 기준이라 IP/도메인/https 어디서든 자동 반영.
@app.route('/api/region-qr/<region_code>', methods=['GET'])
def region_qr_image(region_code):
    if region_code not in REGION_MAP:
        return "unknown region", 404
    link = f"{request.host_url.rstrip('/')}/v/{region_code}"
    img = qrcode.make(link, box_size=10, border=2)   # 기본 PIL 이미지 → PNG (Word 등 붙여넣기 호환)
    buf = BytesIO()
    img.save(buf, format='PNG')
    from flask import Response
    return Response(buf.getvalue(), mimetype='image/png')

@app.route('/api/visitor/by-token', methods=['GET'])
def visitor_by_token():
    """QR 토큰으로 방문 건의 현재 상태를 조회 (개인정보 최소 반환)."""
    token = request.args.get('token', '').strip()
    if not token:
        return jsonify({"success": False, "message": "토큰이 없습니다.", "message_key": "srv.token.missing"}), 400
    conn = get_db_connection()
    row = conn.execute(
        """SELECT id, name, company, status, checkin_time, checkout_time, group_id, visit_date
             FROM visitor_log WHERE token = ?""",
        (token,)
    ).fetchone()
    if row:
        v = dict(row)
        # 화면에 QR 을 다시 띄우려면 토큰이 필요하다. 요청자가 이미 들고 온 값이라 새로 노출되는 정보는 없다.
        v['token'] = token
        v['group_size'] = _group_member_count(conn, v.get('group_id'), v.get('visit_date'))
        conn.close()
        return jsonify({"success": True, "visitor": v})

    # 🎫 정기권 QR 을 본인 휴대폰으로 열어본 경우.
    #    오늘 출입 기록이 있으면 그 건의 상태를(퇴실 요청까지 가능), 없으면 출입증 안내를 보여준다.
    p_row = conn.execute("SELECT * FROM visitor_pass WHERE token = ?", (token,)).fetchone()
    if not p_row:
        conn.close()
        return jsonify({"success": False, "message": "유효하지 않은 코드입니다.", "message_key": "srv.token.invalid"}), 404

    today = get_current_kst_time().strftime('%Y-%m-%d')
    log = conn.execute("""
        SELECT id, name, company, status, checkin_time, checkout_time
          FROM visitor_log WHERE pass_id = ? AND visit_date = ? ORDER BY id DESC LIMIT 1
    """, (p_row['id'], today)).fetchone()
    conn.close()
    if log:
        v = dict(log)
        v['is_pass'] = True
        # 손님이 들고 있는 QR 은 출입권 QR 이다 → 그 토큰을 그대로 돌려줘야 같은 QR 이 표시된다.
        v['token'] = token
        return jsonify({"success": True, "visitor": v})

    reason = pass_denial_reason(p_row, get_current_kst_time())
    return jsonify({"success": True, "visitor": {
        "id": None, "name": p_row['name'], "company": p_row['company'],
        "status": '정기권사용불가' if reason else '정기권',
        "checkin_time": '', "checkout_time": '',
        "is_pass": True, "valid_to": p_row['valid_to'],
        "pass_note": (reason or {}).get('message', ''),
        "pass_note_key": (reason or {}).get('message_key', ''),
        "pass_note_vars": (reason or {}).get('message_vars', {})
    }})

@app.route('/api/group/qr', methods=['GET'])
def group_qr_tokens():
    """특정 방문 건(id)이 속한 오늘 그룹 전원의 QR 토큰을 반환.
    그룹원 누구의 건(id)으로 조회해도 전체를 볼 수 있다(이름만 노출)."""
    log_id = request.args.get('id', '').strip()
    if not log_id:
        return jsonify({"success": False, "message": "대상이 없습니다.", "message_key": "srv.group.noTarget"}), 400

    conn = get_db_connection()
    base = conn.execute("SELECT group_id, visit_date FROM visitor_log WHERE id = ?", (log_id,)).fetchone()
    if not base:
        conn.close()
        return jsonify({"success": False, "message": "방문 정보를 찾을 수 없습니다.", "message_key": "srv.group.notFound"}), 404

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

# ====================================================================
# 🎫 상시 출입증(visitor_pass) — 주차장 정기권과 같은 개념
#   - 왜: 용역·납품처럼 반복해서 오는 사람이 매번 방문 신청을 하는 것은 비현실적이다.
#   - 어떻게: 정기권(visitor_pass)은 '출입증'만 담고, 실제 방문 기록은 스캔할 때마다
#            visitor_log 에 그날 행으로 쌓는다. → 출입기록·엑셀·통계·미퇴실 관리 등
#            기존 기능이 수정 없이 정기 방문객까지 그대로 포함한다.
#   - 승인 정책(auto_approve)은 코드가 아니라 데이터다. 운영 중 언제든 켜고 끌 수 있다.
#     기본값은 '경비실 승인'(0) — 정기권도 일반 방문객과 똑같이 대면 승인을 거친다.
#     자동 승인(1)은 개별 출입증 단위로만 켠다.
#   - 권한: 최고 관리자(3)=전 거점, 경비실(4)=자기 거점 한정. (승인 API 와 동일한 정책)
# ====================================================================
PASS_WEEKDAY_ALL = '1111111'
PASS_EDITABLE_STATUSES = ('활성', '정지', '해지')
# 이용권 유효기간 운영 단위. 종료일을 자유롭게 입력받지 않고 이 세 가지 중에서만 고른다.
#   → 화면은 '시작일 + 단위'로 종료일을 자동 계산해 보여주고, 최종 계산은 서버가 다시 한다.
PASS_PERIODS = ('1일', '1주일', '1개월')
PASS_DEFAULT_PERIOD = '1개월'
# 신청: 손님이 낸 발급 신청(승인 대기) / 반려: 승인 거절. 둘 다 출입에는 쓸 수 없다.
PASS_ALL_STATUSES = ('신청', '활성', '정지', '만료', '해지', '반려')


def _pass_guard():
    """정기권 관리 권한 검사. 통과하면 None, 아니면 (응답, 코드)."""
    if 'user' not in session:
        return jsonify({"success": False, "message": "인증 정보가 없습니다."}), 401
    if int(session['user'].get('level', 1)) not in (3, 4):
        return jsonify({"success": False, "message": "출입 이용권 관리 권한이 없습니다."}), 403
    return None


def _pass_scope_region():
    """조회·수정 가능한 거점. 최고 관리자(3)는 None(전 거점), 경비실(4)은 자기 거점 문자열."""
    u = session.get('user') or {}
    return None if int(u.get('level', 1)) == 3 else (u.get('region') or '')


def _pass_fetch(conn, pass_id):
    """권한 범위 안에서 정기권 1건 조회. 없거나 범위 밖이면 None."""
    row = conn.execute("SELECT * FROM visitor_pass WHERE id = ?", (pass_id,)).fetchone()
    if not row:
        return None
    scope = _pass_scope_region()
    if scope is not None and row['region'] != scope:
        return None
    return row


def _valid_date(v):
    """'YYYY-MM-DD' 형식 검사. 통과하면 문자열, 아니면 None."""
    v = (v or '').strip()
    try:
        datetime.strptime(v, '%Y-%m-%d')
        return v
    except ValueError:
        return None


def _add_months(date_str, months):
    """'YYYY-MM-DD' 에 개월 수를 더한다. 말일은 그 달의 마지막 날로 맞춘다 (1/31 +1개월 → 2/28)."""
    d = datetime.strptime(date_str, '%Y-%m-%d')
    total = d.month - 1 + months
    y, m = d.year + total // 12, total % 12 + 1
    last_day = calendar.monthrange(y, m)[1]
    return f"{y:04d}-{m:02d}-{min(d.day, last_day):02d}"


def pass_period_end(start_date, period):
    """시작일 + 이용 단위 → 종료일. 1개월은 말일 보정을 따른다(1/31 +1개월 → 2/28)."""
    if period == '1일':
        return (datetime.strptime(start_date, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
    if period == '1주일':
        return (datetime.strptime(start_date, '%Y-%m-%d') + timedelta(days=7)).strftime('%Y-%m-%d')
    return _add_months(start_date, 1)


def pass_period_of(valid_from, valid_to):
    """저장된 기간이 어느 단위였는지 역산 (화면의 단위 선택 초기값용). 해당 없으면 None."""
    for period in PASS_PERIODS:
        try:
            if pass_period_end(valid_from, period) == valid_to:
                return period
        except (ValueError, TypeError):
            return None
    return None


def _normalize_weekdays(v):
    """월~일 7자리 허용 요일 문자열. 형식이 어긋나면 전 요일 허용으로 보정."""
    s = (v or '').strip()
    if len(s) == 7 and set(s) <= {'0', '1'} and '1' in s:
        return s
    return PASS_WEEKDAY_ALL


# 출입 거부 사유. 손님 화면이 번역해 보여줄 수 있도록 문구·번역키·치환값을 함께 돌려준다.
#   (문구만 돌려주면 영어·중국어 손님에게 한국어가 그대로 나간다)
PASS_DENY_BY_STATUS = {
    '신청': ("아직 승인 전인 발급 신청입니다. 승인 후 사용할 수 있습니다.", 'srv.passdeny.pending'),
    '반려': ("반려된 발급 신청입니다. 안내 데스크(경비실)로 문의해 주세요.", 'srv.passdeny.rejected'),
    '정지': ("일시 정지된 출입권입니다. 안내 데스크(경비실)로 문의해 주세요.", 'srv.passdeny.paused'),
    '해지': ("해지된 출입권입니다. 안내 데스크(경비실)로 문의해 주세요.", 'srv.passdeny.ended'),
    '만료': ("유효기간이 끝난 출입권입니다. 재발급이 필요합니다.", 'srv.passdeny.expired'),
}
PASS_DENY_DEFAULT = ("사용할 수 없는 출입권입니다. 안내 데스크(경비실)로 문의해 주세요.", 'srv.passdeny.unusable')


def pass_denial_reason(p, now):
    """지금 이 출입권으로 출입할 수 있는지.
       가능하면 None, 불가하면 {"message", "message_key", "message_vars"} 를 돌려준다."""
    def deny(msg, key, **vars_):
        out = {"message": msg, "message_key": key}
        if vars_:
            out["message_vars"] = vars_
        return out

    today = now.strftime('%Y-%m-%d')
    status = p['status']
    # '활성' 외에는 전부 출입 불가로 막는다. (새 상태가 추가돼도 기본이 '차단'이 되도록 화이트리스트 방식)
    if status != '활성':
        msg, key = PASS_DENY_BY_STATUS.get(status, PASS_DENY_DEFAULT)
        return deny(msg, key)
    if p['valid_from'] and today < p['valid_from']:
        return deny(f"{p['valid_from']} 부터 사용할 수 있는 출입권입니다.",
                    'srv.passdeny.notYet', date=p['valid_from'])
    if p['valid_to'] and today > p['valid_to']:
        return deny(f"{p['valid_to']} 자로 유효기간이 끝난 출입권입니다. 재발급이 필요합니다.",
                    'srv.passdeny.overdue', date=p['valid_to'])
    weekdays = _normalize_weekdays(p['weekdays'])
    if weekdays[now.weekday()] != '1':
        return deny("오늘은 사용할 수 없는 요일로 등록된 출입권입니다.", 'srv.passdeny.weekday')
    return None


def scan_pass_action(conn, p, entry_only=False):
    """이용권 QR 스캔 처리. 그날 기록이 없으면 입실, 재실 중이면 퇴실, 이미 나갔으면 재입실.
       (하루 출입 횟수는 제한하지 않는다 — 납품·용역은 하루에도 여러 번 드나든다)

       entry_only=True: '입실' 방향만 처리한다. 손님이 자기 휴대폰으로 QR 을 여는 경로에 쓴다.
         → 재실 중인 사람이 상태를 확인하려고 QR 을 열었을 때 퇴실 요청이 자동으로 나가는 것을 막는다.
           (퇴실은 상태 화면의 '지금 퇴실 요청하기' 버튼으로만)"""
    now = get_current_kst_time()
    reason = pass_denial_reason(p, now)
    if reason:
        return dict(reason, success=False, name=p['name'])

    today = now.strftime('%Y-%m-%d')
    now_str = now.strftime('%Y-%m-%d %H:%M:%S')
    auto = bool(p['auto_approve'])

    # 오늘 이 정기권으로 만들어진 가장 최근 방문 건
    last = conn.execute("""
        SELECT id, status FROM visitor_log
         WHERE pass_id = ? AND visit_date = ?
         ORDER BY id DESC LIMIT 1
    """, (p['id'], today)).fetchone()
    status = last['status'] if last else None

    if status in ('입실대기', '퇴실대기'):
        return {"success": True, "already": True, "name": p['name'],
                "message": f"{p['name']} 님은 이미 {status[:2]} 승인 대기중입니다.",
                "message_key": 'srv.pass.waitIn' if status == '입실대기' else 'srv.pass.waitOut',
                "message_vars": {"name": p['name']}}

    if status == '입실완료':
        if entry_only:
            return {"success": True, "already": True, "name": p['name'], "status": status,
                    "message": f"{p['name']} 님은 현재 재실 중입니다.",
                    "message_key": "srv.pass.onsite", "message_vars": {"name": p['name']}}
        # 재실 중 → 퇴실 처리
        if auto:
            conn.execute("UPDATE visitor_log SET status = '퇴실완료', checkout_time = ? WHERE id = ?",
                         (now_str, last['id']))
            msg, key = f"{p['name']} 님 퇴실 처리되었습니다.", 'srv.pass.outDone'
        else:
            conn.execute("UPDATE visitor_log SET status = '퇴실대기' WHERE id = ?", (last['id'],))
            msg, key = f"{p['name']} 님 퇴실 요청 접수 — 보안실 승인 대기", 'srv.pass.outReq'
        conn.commit()
        return {"success": True, "id": last['id'], "name": p['name'], "company": p['company'],
                "action": "퇴실", "pass": True, "message": msg,
                "message_key": key, "message_vars": {"name": p['name']}}

    # 그날 첫 입실이거나(기록 없음), 퇴실완료 후 재입실 → 새 방문 기록 생성
    new_status = '입실완료' if auto else '입실대기'
    checkin_time = now_str if auto else ''
    cur = conn.execute("""
        INSERT INTO visitor_log (visit_date, name, company, contact, vehicle_no, purpose, manager_text,
             checkin_time, checkout_time, status, created_by, region, group_id,
             expected_checkin, expected_checkout, token, pass_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'NONE', '', '', '', ?, ?)
    """, (today, p['name'], p['company'], p['contact'], p['vehicle_no'], p['purpose'],
          p['manager_text'], checkin_time, new_status, p['created_by'], p['region'], p['id'], get_current_kst_time().strftime('%Y-%m-%d %H:%M:%S')))
    conn.commit()
    revisit = (status == '퇴실완료')
    if auto:
        msg = f"{p['name']} 님 {'재입실' if revisit else '입실'} 처리되었습니다."
        key = 'srv.pass.reinDone' if revisit else 'srv.pass.inDone'
    else:
        msg = f"{p['name']} 님 입실 요청 접수 — 보안실 승인 대기"
        key = 'srv.pass.inReq'
    return {"success": True, "id": cur.lastrowid, "name": p['name'], "company": p['company'],
            "action": "입실", "pass": True, "revisit": revisit, "message": msg,
            "message_key": key, "message_vars": {"name": p['name']}}


def expire_stale_passes():
    """⏳ 유효기간이 지난 정기권을 '만료'로 전환 (레코드는 보존). 멱등."""
    today_str = get_current_kst_time().strftime('%Y-%m-%d')
    try:
        conn = get_db_connection()
        cur = conn.execute("""
            UPDATE visitor_pass SET status = '만료'
             WHERE status IN ('활성', '정지') AND valid_to < ?
        """, (today_str,))
        conn.commit()
        n = cur.rowcount
        conn.close()
        if n:
            print(f"[PASS-EXPIRE] {today_str} 기준 정기권 만료 처리: {n}건")
        return n
    except Exception as e:
        print(f"[PASS-EXPIRE][ERROR] {e}")
        return 0


def _pass_payload(data, region_default):
    """발급·수정 공통 입력 파싱. (값 dict, 오류 메시지) 튜플 반환."""
    name = (data.get('name') or '').strip()
    contact = (data.get('contact') or '').strip()
    company = (data.get('company') or '').strip()
    purpose = (data.get('purpose') or '').strip()
    vehicle_no = (data.get('vehicle_no') or '').strip() or '없음'
    memo = (data.get('memo') or '').strip()
    # 사내 담당자는 이용권에서 다루지 않는다. (납품·용역은 특정인을 만나러 오는 방문이 아니다)
    #   컬럼은 기존 데이터 호환을 위해 남기고 항상 빈 값으로 저장한다.
    manager_text = ''

    if not name or not contact or not company or not purpose:
        return None, "이름·연락처·소속·방문목적은 필수 입력입니다."

    # 유효기간: 시작일 + 이용 단위(1일·1주일·1개월). 종료일은 서버가 계산한다.
    valid_from = _valid_date(data.get('valid_from'))
    if not valid_from:
        return None, "유효 시작일을 YYYY-MM-DD 형식으로 입력해 주세요."
    period = (data.get('period') or PASS_DEFAULT_PERIOD).strip()
    if period not in PASS_PERIODS:
        return None, "이용 기간은 1일·1주일·1개월 중에서 선택해 주세요."
    valid_to = pass_period_end(valid_from, period)

    # 거점: 최고 관리자만 지정 가능. 경비실은 항상 자기 거점으로 강제된다.
    scope = _pass_scope_region()
    if scope is None:
        region = (data.get('region') or '').strip()
        if region not in ALLOWED_REGIONS:
            region = region_default
    else:
        region = scope
    if region not in ALLOWED_REGIONS:
        return None, "거점이 확인되지 않습니다."

    return {
        "name": name, "contact": contact, "company": company, "purpose": purpose,
        "manager_text": manager_text, "vehicle_no": vehicle_no, "memo": memo,
        "valid_from": valid_from, "valid_to": valid_to, "period": period, "region": region,
        "weekdays": _normalize_weekdays(data.get('weekdays')),
        "auto_approve": 1 if str(data.get('auto_approve', 0)) in ('1', 'True', 'true') else 0,
    }, None


@app.route('/api/pass/list', methods=['GET'])
def pass_list():
    """정기권 목록. 경비실(4)은 자기 거점만, 최고 관리자(3)는 전 거점 + 거점 필터."""
    denied = _pass_guard()
    if denied:
        return denied

    expire_stale_passes()   # 조회 시점에도 만료를 반영 ('활성인데 기간이 지난' 표시 방지)

    scope = _pass_scope_region()
    req_region = (request.args.get('region') or '').strip()
    status = (request.args.get('status') or '').strip()
    q = (request.args.get('q') or '').strip()
    today = get_current_kst_time().strftime('%Y-%m-%d')

    query = """
        SELECT p.*,
               (SELECT COUNT(*) FROM visitor_log v
                 WHERE v.pass_id = p.id AND v.visit_date = ?) AS today_visits,
               (SELECT COUNT(*) FROM visitor_log v2 WHERE v2.pass_id = p.id) AS total_visits,
               (SELECT MAX(v3.visit_date) FROM visitor_log v3 WHERE v3.pass_id = p.id) AS last_visit
          FROM visitor_pass p
         WHERE 1=1
    """
    params = [today]
    if scope is not None:
        query += " AND p.region = ?"; params.append(scope)
    elif req_region and req_region in ALLOWED_REGIONS:
        query += " AND p.region = ?"; params.append(req_region)
    if status in PASS_ALL_STATUSES:
        query += " AND p.status = ?"; params.append(status)
    if q:
        query += " AND (p.name LIKE ? OR p.company LIKE ? OR p.contact LIKE ? OR p.vehicle_no LIKE ?)"
        params += [f"%{q}%"] * 4
    # 승인 대기(신청)를 항상 맨 위로 → 담당자가 탭을 열면 처리할 일이 먼저 보인다.
    query += """ ORDER BY CASE p.status WHEN '신청' THEN 0 WHEN '활성' THEN 1 WHEN '정지' THEN 2
                                       WHEN '만료' THEN 3 ELSE 4 END,
                          p.valid_to DESC, p.id DESC"""

    conn = get_db_connection()
    rows = conn.execute(query, params).fetchall()
    conn.close()

    out = []
    for r in rows:
        d = dict(r)
        d['period'] = pass_period_of(d['valid_from'], d['valid_to'])   # 1일/1주일/1개월 (해당 없으면 None)
        out.append(d)
    pending = len([d for d in out if d['status'] == '신청'])
    return jsonify({"success": True, "list": out, "today": today, "pending": pending,
                    "scope_region": scope,
                    "periods": list(PASS_PERIODS), "default_period": PASS_DEFAULT_PERIOD})


@app.route('/api/pass', methods=['POST'])
def pass_create():
    """정기권 발급. 영구 QR 토큰을 함께 만든다."""
    denied = _pass_guard()
    if denied:
        return denied

    u = session['user']
    vals, err = _pass_payload(request.json or {}, u.get('region', ''))
    if err:
        return jsonify({"success": False, "message": err}), 400

    conn = get_db_connection()
    try:
        created_by = ''     # 이용권은 담당자를 두지 않는다 → 출입 기록의 담당자 칸도 비운다
        token = uuid.uuid4().hex
        now_str = get_current_kst_time().strftime('%Y-%m-%d %H:%M:%S')
        cur = conn.execute("""
            INSERT INTO visitor_pass
                (name, contact, company, vehicle_no, purpose, manager_text, created_by, region,
                 valid_from, valid_to, weekdays, auto_approve, status, token, memo, issued_at, issued_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '활성', ?, ?, ?, ?)
        """, (vals['name'], vals['contact'], vals['company'], vals['vehicle_no'], vals['purpose'],
              vals['manager_text'], created_by, vals['region'], vals['valid_from'], vals['valid_to'],
              vals['weekdays'], vals['auto_approve'], token, vals['memo'],
              now_str, u.get('id', '')))
        conn.commit()
        new_id = cur.lastrowid
        conn.close()
        return jsonify({"success": True, "id": new_id, "token": token,
                        "message": f"{vals['name']} 님의 이용권이 발급되었습니다."})
    except Exception as e:
        conn.close()
        print(f"[PASS][CREATE][ERROR] {e}")
        return jsonify({"success": False, "message": f"정기권 발급 중 오류: {e}"}), 500


@app.route('/api/pass/<int:pass_id>', methods=['PUT'])
def pass_update(pass_id):
    """정기권 수정(정보·유효기간·요일·승인방식). 담당자는 이 시점에 다시 매칭한다."""
    denied = _pass_guard()
    if denied:
        return denied

    conn = get_db_connection()
    target = _pass_fetch(conn, pass_id)
    if not target:
        conn.close()
        return jsonify({"success": False, "message": "출입 이용권을 찾을 수 없습니다."}), 404

    vals, err = _pass_payload(request.json or {}, target['region'])
    if err:
        conn.close()
        return jsonify({"success": False, "message": err}), 400

    try:
        created_by = ''     # 이용권은 담당자를 두지 않는다
        # 만료된 이용권의 기간을 늘리면(연장) 자동으로 활성 복귀
        today = get_current_kst_time().strftime('%Y-%m-%d')
        new_status = target['status']
        if target['status'] == '만료' and vals['valid_to'] >= today:
            new_status = '활성'
        conn.execute("""
            UPDATE visitor_pass
               SET name = ?, contact = ?, company = ?, vehicle_no = ?, purpose = ?, manager_text = ?,
                   created_by = ?, region = ?, valid_from = ?, valid_to = ?, weekdays = ?,
                   auto_approve = ?, memo = ?, status = ?
             WHERE id = ?
        """, (vals['name'], vals['contact'], vals['company'], vals['vehicle_no'], vals['purpose'],
              vals['manager_text'], created_by, vals['region'], vals['valid_from'], vals['valid_to'],
              vals['weekdays'], vals['auto_approve'], vals['memo'], new_status, pass_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": "출입증 정보가 수정되었습니다."})
    except Exception as e:
        conn.close()
        print(f"[PASS][UPDATE][ERROR] {e}")
        return jsonify({"success": False, "message": f"수정 중 오류: {e}"}), 500


@app.route('/api/pass/<int:pass_id>/status', methods=['POST'])
def pass_set_status(pass_id):
    """활성 ↔ 정지 전환, 해지 처리. (만료는 유효기간이 결정하므로 수동 지정 대상이 아니다)"""
    denied = _pass_guard()
    if denied:
        return denied

    target_status = ((request.json or {}).get('status') or '').strip()
    if target_status not in PASS_EDITABLE_STATUSES:
        return jsonify({"success": False, "message": "활성·정지·해지만 지정할 수 있습니다."}), 400

    conn = get_db_connection()
    target = _pass_fetch(conn, pass_id)
    if not target:
        conn.close()
        return jsonify({"success": False, "message": "출입 이용권을 찾을 수 없습니다."}), 404

    # 승인 대기(신청) 건을 상태 토글로 바로 활성화하면 승인 절차를 우회하게 된다 → 전용 승인 API 로 유도.
    if target['status'] == '신청':
        conn.close()
        return jsonify({"success": False,
                        "message": "발급 신청 건입니다. '승인' 또는 '반려'로 처리해 주세요."}), 400

    # '활성'으로 되돌리는데 유효기간이 이미 지났으면 만료가 맞다 — 기간 연장을 먼저 하도록 안내.
    today = get_current_kst_time().strftime('%Y-%m-%d')
    if target_status == '활성' and target['valid_to'] < today:
        conn.close()
        return jsonify({"success": False,
                        "message": f"유효기간({target['valid_to']})이 지났습니다. 기간을 먼저 연장해 주세요."}), 400

    conn.execute("UPDATE visitor_pass SET status = ? WHERE id = ?", (target_status, pass_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": f"'{target['name']}' 출입증을 {target_status} 처리했습니다."})


@app.route('/api/pass/<int:pass_id>', methods=['DELETE'])
def pass_delete(pass_id):
    """정기권 완전 삭제 — 최고 관리자(3) 전용. 발급 이력을 남기려면 '해지'를 쓴다.
       이미 쌓인 방문 기록(visitor_log)은 지우지 않고 연결만 끊는다."""
    if 'user' not in session or int(session['user'].get('level', 1)) != 3:
        return jsonify({"success": False, "message": "최고 관리자만 삭제할 수 있습니다."}), 403

    conn = get_db_connection()
    row = conn.execute("SELECT name FROM visitor_pass WHERE id = ?", (pass_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"success": False, "message": "출입 이용권을 찾을 수 없습니다."}), 404
    conn.execute("UPDATE visitor_log SET pass_id = NULL WHERE pass_id = ?", (pass_id,))
    conn.execute("DELETE FROM visitor_pass WHERE id = ?", (pass_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": f"'{row['name']}' 출입 이용권을 삭제했습니다."})


@app.route('/api/pass/today', methods=['GET'])
def pass_today():
    """오늘 정기권으로 발생한 출입 현황 (경비실 화면용). 경비실은 자기 거점 기준."""
    denied = _pass_guard()
    if denied:
        return denied

    scope = _pass_scope_region()
    today = get_current_kst_time().strftime('%Y-%m-%d')
    query = """
        SELECT v.id, v.name, v.company, v.contact, v.vehicle_no, v.status,
               v.checkin_time, v.checkout_time, v.region, v.pass_id,
               p.auto_approve, p.valid_to
          FROM visitor_log v JOIN visitor_pass p ON v.pass_id = p.id
         WHERE v.visit_date = ?
    """
    params = [today]
    if scope is not None:
        query += " AND v.region = ?"; params.append(scope)
    query += " ORDER BY v.id DESC"

    conn = get_db_connection()
    rows = [dict(r) for r in conn.execute(query, params).fetchall()]

    # 오늘 사용 가능한(유효기간 안 + 활성) 출입증
    avail_q = """
        SELECT id, name, company, contact, vehicle_no, weekdays
          FROM visitor_pass
         WHERE status = '활성' AND valid_from <= ? AND valid_to >= ?
    """
    avail_p = [today, today]
    if scope is not None:
        avail_q += " AND region = ?"; avail_p.append(scope)
    avail = [dict(r) for r in conn.execute(avail_q, avail_p).fetchall()]
    conn.close()

    # 오늘 요일에 쓸 수 없는 이용권은 '오늘 사용 가능' 집계에서 뺀다.
    wd = get_current_kst_time().weekday()
    avail = [a for a in avail if _normalize_weekdays(a['weekdays'])[wd] == '1']

    pend_q = "SELECT COUNT(*) AS c FROM visitor_pass WHERE status = '신청'"
    pend_p = []
    if scope is not None:
        pend_q += " AND region = ?"; pend_p.append(scope)
    conn2 = get_db_connection()
    pending = conn2.execute(pend_q, pend_p).fetchone()['c']
    conn2.close()

    return jsonify({"success": True, "list": rows, "pending": pending,
                    "active_total": len(avail), "today": today,
                    "periods": list(PASS_PERIODS), "default_period": PASS_DEFAULT_PERIOD})


# ── 🙋 손님이 직접 내는 발급 신청 ─────────────────────────────────
#   - 로그인 없는 손님 화면에서 접수만 한다. 접수 상태는 '신청'이라 스캔해도 출입되지 않는다.
#   - 유효기간·요일은 '희망 사항'으로 받고, 최종 확정은 승인자가 한다.
#   - 승인 방식은 항상 경비실 승인(0)으로 접수한다. 자동 승인은 담당자가 별도로 켠다.
@app.route('/api/pass/self-checkin', methods=['POST'])
def pass_self_checkin():
    """🙋 손님이 자기 휴대폰으로 이용권 QR 을 열었을 때의 입실 요청.

       🔒 정문 거점 QR(/v/<코드>)로 만들어진 거점 세션이 있는 기기에서만 접수한다.
          링크(URL)는 집에서도 열 수 있어서, 이 제한이 없으면 현장에 오지 않은 사람의 요청이
          경비실 대기열에 쌓인다. 정문 QR 을 찍어야 세션이 생기므로 '정문 도착' 최소 확인이 된다.
       - 퇴실은 여기서 처리하지 않는다(entry_only). 상태 화면의 퇴실 버튼이 담당한다.
    """
    token = ((request.json or {}).get('token') or '').strip()
    if not token:
        return jsonify({"success": False, "message": "토큰이 없습니다.", "message_key": "srv.token.missing"}), 400

    region = (session.get('guest_region') or '').strip()
    if region not in ALLOWED_REGIONS:
        return jsonify({"success": False, "need_region": True,
                        "message": "정문에 비치된 사업장 QR을 먼저 스캔해 주세요. 현장 확인 후 입실 요청이 접수됩니다.",
                        "message_key": "srv.pass.needSiteQr"}), 403

    conn = get_db_connection()
    p_row = conn.execute("SELECT * FROM visitor_pass WHERE token = ?", (token,)).fetchone()
    if not p_row:
        conn.close()
        return jsonify({"success": False, "message": "유효하지 않은 이용권입니다.", "message_key": "srv.pass.invalid"}), 404
    if p_row['region'] != region:
        conn.close()
        return jsonify({"success": False,
                        "message": f"이 이용권은 {p_row['region']} 전용입니다. 해당 사업장 정문에서 이용해 주세요.",
                        "message_key": "srv.pass.wrongRegion", "message_vars": {"region": p_row['region']}}), 403

    result = scan_pass_action(conn, p_row, entry_only=True)
    conn.close()
    return jsonify(result)


@app.route('/api/pass/request', methods=['POST'])
def pass_request():
    data = request.json or {}

    # 거점: 손님 화면과 동일 규칙 (정문 QR 세션 우선, 없으면 선택값)
    region = resolve_guest_region(data)
    if not region:
        return jsonify({"success": False,
                        "message": "방문 거점이 확인되지 않습니다. 정문에 비치된 QR을 다시 스캔하거나 사업장을 선택해 주세요.",
                        "message_key": "srv.region.unknown"}), 400

    name = (data.get('name') or '').strip()
    contact = (data.get('contact') or '').strip()
    company = (data.get('company') or '').strip()
    purpose = (data.get('purpose') or '').strip()
    vehicle_no = (data.get('vehicle_no') or '').strip() or '없음'
    memo = (data.get('memo') or '').strip()
    if not name or not contact or not company or not purpose:
        return jsonify({"success": False, "message": "성명·연락처·소속·이용 목적은 필수 입력입니다.", "message_key": "srv.passreq.needFields"}), 400

    # 유효기간: 손님이 고른 '이용 시작일 + 이용 단위(1일·1주일·1개월)'.
    #   시작일은 오늘 이후만 허용한다(지난 날짜로 발급되는 것을 막는다).
    #   최종 확정은 승인 담당자가 하며, 승인 화면에서 시작일·단위를 바꿀 수 있다.
    period = (data.get('period') or PASS_DEFAULT_PERIOD).strip()
    if period not in PASS_PERIODS:
        return jsonify({"success": False, "message": "이용 기간은 1일·1주일·1개월 중에서 선택해 주세요.", "message_key": "srv.passreq.badPeriod"}), 400
    now = get_current_kst_time()
    today = now.strftime('%Y-%m-%d')
    valid_from = _valid_date(data.get('valid_from')) or today
    if valid_from < today:
        return jsonify({"success": False, "message": "이용 시작일은 오늘 이후로 선택해 주세요.", "message_key": "srv.passreq.badStart"}), 400
    valid_to = pass_period_end(valid_from, period)
    now_str = now.strftime('%Y-%m-%d %H:%M:%S')
    conn = get_db_connection()
    try:
        # 같은 사람이 같은 거점에 이미 낸 신청이 있으면 중복 접수를 막는다.
        dup = conn.execute("""
            SELECT id FROM visitor_pass
             WHERE name = ? AND contact = ? AND region = ? AND status = '신청'
        """, (name, contact, region)).fetchone()
        if dup:
            conn.close()
            return jsonify({"success": False,
                            "message": "이미 접수된 발급 신청이 있습니다. 승인 결과를 기다려 주세요.",
                        "message_key": "srv.passreq.dup"}), 409

        cur = conn.execute("""
            INSERT INTO visitor_pass
                (name, contact, company, vehicle_no, purpose, manager_text, created_by, region,
                 valid_from, valid_to, weekdays, auto_approve, status, token, memo, requested_at)
            VALUES (?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, 0, '신청', ?, ?, ?)
        """, (name, contact, company, vehicle_no, purpose, region,
              valid_from, valid_to, _normalize_weekdays(data.get('weekdays')),
              uuid.uuid4().hex, memo, now_str))
        conn.commit()
        new_id = cur.lastrowid
        conn.close()
        return jsonify({"success": True, "id": new_id,
                        "message": "출입권 발급 신청이 접수되었습니다. 경비실 승인 후 사용할 수 있습니다.",
                        "message_key": "srv.passreq.ok"})
    except Exception as e:
        conn.close()
        print(f"[PASS][REQUEST][ERROR] {e}")
        return jsonify({"success": False, "message": "신청 처리 중 오류가 발생했습니다.", "message_key": "srv.passreq.error"}), 500


@app.route('/api/pass/request/status', methods=['POST'])
def pass_request_status():
    """손님이 자기 신청·이용권 상태를 확인한다. 이름+연락처 정확 일치 (기존 방문 조회와 동일 기준).
       승인된 건은 QR 토큰까지 내려줘 휴대폰 화면으로 바로 쓸 수 있게 한다.
       (이용권만으로는 출입이 확정되지 않는다 — 입·퇴실은 경비실 승인을 거친다)"""
    data = request.json or {}
    name = (data.get('name') or '').strip()
    contact = (data.get('contact') or '').strip()
    if not name or not contact:
        return jsonify({"success": False, "message": "성명과 연락처를 모두 입력해 주세요.", "message_key": "srv.passstatus.needBoth"}), 400

    conn = get_db_connection()
    rows = conn.execute("""
        SELECT id, name, company, region, status, valid_from, valid_to, weekdays,
               vehicle_no, token, memo, requested_at, issued_at
          FROM visitor_pass
         WHERE name = ? AND contact = ?
         ORDER BY CASE status WHEN '활성' THEN 0 WHEN '신청' THEN 1 ELSE 2 END, id DESC
    """, (name, contact)).fetchall()
    conn.close()

    out = []
    for r in rows:
        d = dict(r)
        d['period'] = pass_period_of(d['valid_from'], d['valid_to'])
        if d['status'] != '활성':
            d.pop('token', None)      # 승인 전·정지·해지 건의 QR 은 내려주지 않는다
        out.append(d)
    return jsonify({"success": True, "list": out})


@app.route('/api/pass/<int:pass_id>/approve', methods=['POST'])
def pass_approve(pass_id):
    """발급 신청 승인 → 이용권 발급(활성). 유효기간·종류·요일·승인방식은 이 시점에 확정한다."""
    denied = _pass_guard()
    if denied:
        return denied

    conn = get_db_connection()
    target = _pass_fetch(conn, pass_id)
    if not target:
        conn.close()
        return jsonify({"success": False, "message": "발급 신청을 찾을 수 없습니다."}), 404
    if target['status'] != '신청':
        conn.close()
        return jsonify({"success": False, "message": f"승인 대상이 아닙니다. (현재 상태: {target['status']})"}), 400

    data = request.json or {}
    valid_from = _valid_date(data.get('valid_from')) or target['valid_from']
    period = (data.get('period') or pass_period_of(target['valid_from'], target['valid_to'])
              or PASS_DEFAULT_PERIOD).strip()
    if period not in PASS_PERIODS:
        conn.close()
        return jsonify({"success": False, "message": "이용 기간은 1일·1주일·1개월 중에서 선택해 주세요.", "message_key": "srv.passreq.badPeriod"}), 400
    valid_to = pass_period_end(valid_from, period)
    today = get_current_kst_time().strftime('%Y-%m-%d')
    if valid_to < today:
        conn.close()
        return jsonify({"success": False, "message": "이미 지난 날짜로는 발급할 수 없습니다. 종료일을 조정해 주세요."}), 400

    weekdays = _normalize_weekdays(data.get('weekdays') or target['weekdays'])
    auto = 1 if str(data.get('auto_approve', target['auto_approve'])) in ('1', 'True', 'true') else 0
    now_str = get_current_kst_time().strftime('%Y-%m-%d %H:%M:%S')

    conn.execute("""
        UPDATE visitor_pass
           SET status = '활성', valid_from = ?, valid_to = ?, weekdays = ?,
               auto_approve = ?, issued_at = ?, issued_by = ?
         WHERE id = ?
    """, (valid_from, valid_to, weekdays, auto, now_str,
          session['user'].get('id', ''), pass_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "token": target['token'],
                    "message": f"{target['name']} 님의 이용권을 발급했습니다. ({valid_from} ~ {valid_to})"})


@app.route('/api/pass/<int:pass_id>/reject', methods=['POST'])
def pass_reject(pass_id):
    """발급 신청 반려. 사유는 메모에 남겨 손님 조회 화면에서 확인할 수 있게 한다."""
    denied = _pass_guard()
    if denied:
        return denied

    conn = get_db_connection()
    target = _pass_fetch(conn, pass_id)
    if not target:
        conn.close()
        return jsonify({"success": False, "message": "발급 신청을 찾을 수 없습니다."}), 404
    if target['status'] != '신청':
        conn.close()
        return jsonify({"success": False, "message": f"반려 대상이 아닙니다. (현재 상태: {target['status']})"}), 400

    reason = ((request.json or {}).get('reason') or '').strip()
    memo = (target['memo'] or '').strip()
    memo = (memo + ' / ' if memo else '') + f"[반려] {reason or '사유 미기재'}"
    conn.execute("UPDATE visitor_pass SET status = '반려', memo = ? WHERE id = ?", (memo, pass_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": f"{target['name']} 님의 발급 신청을 반려했습니다."})


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
        return jsonify({"success": False, "message": "토큰이 없습니다.", "message_key": "srv.token.missing"}), 400

    conn = get_db_connection()
    row = conn.execute(
        "SELECT id, name, company, status FROM visitor_log WHERE token = ?", (token,)
    ).fetchone()
    if not row:
        # 🎫 일반 방문 건이 아니면 정기권 출입증인지 확인한다.
        #    (스캐너·QR 인프라를 그대로 쓰기 위해 토큰 체계를 공유한다)
        p_row = conn.execute("SELECT * FROM visitor_pass WHERE token = ?", (token,)).fetchone()
        if p_row:
            result = scan_pass_action(conn, p_row)
            conn.close()
            return jsonify(result)
        conn.close()
        return jsonify({"success": False, "message": "유효하지 않은 QR 입니다."}), 404

    v = dict(row)
    status = v['status']
    now_kst = get_current_kst_time().strftime('%Y-%m-%d %H:%M:%S')

    if status in ('사전예약',):
        conn.execute("UPDATE visitor_log SET status = '입실대기' WHERE id = ?", (v['id'],))
        conn.commit(); conn.close()
        return jsonify({"success": True, "name": v['name'], "company": v.get('company'),
                        "action": "입실",
                        "message": f"{v['name']} 님 입실 요청 접수 — 보안실 승인 대기"})
    elif status == '입실완료':
        conn.execute("UPDATE visitor_log SET status = '퇴실대기' WHERE id = ?", (v['id'],))
        conn.commit(); conn.close()
        return jsonify({"success": True, "name": v['name'], "company": v.get('company'),
                        "action": "퇴실",
                        "message": f"{v['name']} 님 퇴실 요청 접수 — 보안실 승인 대기"})
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
    req_region = request.args.get('region', '').strip()   # 거점 필터(빈 값 = 전 사업장)
    user_level = int(session['user'].get('level', 1))

    # 🔒 전체 출입 기록 조회 권한: 최고 관리자(3)·경비실(4)·전체기록 열람(5). 일반 임직원(1) 등은 차단.
    if user_level not in (3, 4, 5):
        return jsonify({"success": False, "message": "출입 기록 조회 권한이 없습니다."}), 403
    
    conn = get_db_connection()
    query = """
        SELECT v.id, v.visit_date, v.name, v.contact, v.company, v.purpose, v.checkin_time, v.checkout_time, v.status,
               e.name AS emp_name, e.dept AS emp_dept, v.region, v.expected_checkin, v.expected_checkout, v.pass_id, v.created_at,
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
    
    # 🗺️ '기록 조회'는 3·4·5 동일: 기본 전 사업장 + 거점 버튼으로 좁혀 보기.
    #    (경비실의 '승인' 권한은 여전히 자기 센터로 제한된다 — /api/security/* 참고.
    #     조회는 전 사업장 허용, 처리는 자기 센터만 이라는 정책.)
    #    화이트리스트로 검증해 임의 문자열 주입을 막는다.
    if req_region and req_region in ALLOWED_REGIONS:
        query += " AND v.region = ?"
        params.append(req_region)

    query += " ORDER BY v.id DESC"
    
    logs = conn.execute(query, params).fetchall()
    conn.close()
    return jsonify([dict(log) for log in logs])

# ====================================================================
# 🧾 특정 방문객의 방문 이력 조회 (이름+연락처 기준) — 관리자/경비실 공용
#   - 출입기록 표에서 사람을 클릭하면 그 사람의 전체 방문 이력을 팝업으로 보여준다.
# ====================================================================
@app.route('/api/visitor/history', methods=['GET'])
def visitor_history():
    if 'user' not in session:
        return jsonify({"success": False}), 401

    name = request.args.get('name', '').strip()
    contact = request.args.get('contact', '').strip()
    start = request.args.get('start_date', '').strip()
    end = request.args.get('end_date', '').strip()
    if not name:
        return jsonify({"success": False, "message": "이름이 없습니다."}), 400

    q = """
        SELECT v.visit_date, v.company, v.purpose, v.contact,
               v.checkin_time, v.checkout_time, v.status, v.region,
               e.name AS emp_name, e.dept AS emp_dept
        FROM visitor_log v LEFT JOIN employees e ON v.created_by = e.id
        WHERE v.name = ?
    """
    params = [name]
    if contact:
        q += " AND IFNULL(v.contact, '') = ?"; params.append(contact)
    if start:
        q += " AND v.visit_date >= ?"; params.append(start)
    if end:
        q += " AND v.visit_date <= ?"; params.append(end)
    q += " ORDER BY v.visit_date DESC, v.id DESC"

    conn = get_db_connection()
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return jsonify({"success": True, "name": name, "list": [dict(r) for r in rows]})

# ====================================================================
# 📊 [최고 관리자 전용] 엑셀 다운로드
# ====================================================================
@app.route('/api/admin/excel-download', methods=['GET'])
def admin_excel():
    if not is_admin_authenticated(): return jsonify({"success": False}), 401
        
    start_date, end_date = request.args.get('start_date', ''), request.args.get('end_date', '')
    req_region = request.args.get('region', '').strip()   # 화면의 거점 필터와 동일하게 적용 (빈 값 = 전 사업장)
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
               v.expected_checkin, v.expected_checkout, v.checkin_time, v.checkout_time, v.status,
               v.contact, v.vehicle_no, v.region, v.pass_id
        FROM visitor_log v LEFT JOIN employees e ON v.created_by = e.id WHERE 1=1
    """
    params = []
    if start_date: query += " AND v.visit_date >= ?"; params.append(start_date)
    if end_date: query += " AND v.visit_date <= ?"; params.append(end_date)
    if req_region in ALLOWED_REGIONS:   # 화이트리스트 검증 (빈 값·미지의 값 → 전 사업장)
        query += " AND v.region = ?"
        params.append(req_region)
    query += " ORDER BY v.visit_date ASC, v.id ASC"
    
    logs = conn.execute(query, params).fetchall()
    conn.close()
    
    rows = [dict(log) for log in logs]

    # 📗 시트 분리: 방문 성격이 달라 필요한 컬럼도 다르다.
    #    - 일반 방문객: 사내 담당자·방문 예정시간이 핵심 (누구를 만나러 언제 오기로 했나)
    #    - 출입권: 담당자·예정시간 개념이 없고, 대신 연락처·차량이 핵심
    #    두 시트 모두 같은 visitor_log 에서 나오며, 순번(month_seq)은 화면 표시와 동일한 통합 순번이다.
    GENERAL_COLS = ['순번', '방문일', '이름', '소속', '방문 목적', '사내 담당자',
                    '방문 예정시간', '퇴실 예정시간', '입실 시간', '퇴실 시간', '현재 상태']
    PASS_COLS = ['순번', '방문일', '이름', '소속', '연락처', '차량 번호',
                 '이용 목적', '사업장', '입실 시간', '퇴실 시간', '현재 상태']

    def _status(v):
        # 화면과 동일한 표시 라벨 사용 (DB 저장값은 '입실완료' 그대로, 표시만 '재실중')
        return '재실중' if v == '입실완료' else v

    def _phone(v):
        # 하이픈을 넣어 저장한다: 숫자만 쓰면 엑셀이 수치로 인식해 앞자리 0 이 사라진다.
        d = ''.join(ch for ch in str(v or '') if ch.isdigit())
        if len(d) == 11:
            return f"{d[:3]}-{d[3:7]}-{d[7:]}"
        if len(d) == 10:
            return f"{d[:2]}-{d[2:6]}-{d[6:]}" if d.startswith('02') else f"{d[:3]}-{d[3:6]}-{d[6:]}"
        return d

    general, passes = [], []
    for r in rows:
        if r.get('pass_id'):        # 출입권(visitor_pass)으로 들어온 건
            passes.append({
                '순번': r['month_seq'], '방문일': r['visit_date'],
                '이름': r['name'], '소속': r['company'], '연락처': _phone(r.get('contact')),
                '차량 번호': r.get('vehicle_no') or '', '이용 목적': r['purpose'],
                '사업장': r.get('region') or '', '입실 시간': r.get('checkin_time') or '',
                '퇴실 시간': r.get('checkout_time') or '', '현재 상태': _status(r['status']),
            })
        else:
            general.append({
                '순번': r['month_seq'], '방문일': r['visit_date'], '이름': r['name'],
                '소속': r['company'], '방문 목적': r['purpose'], '사내 담당자': r.get('emp_name') or '',
                '방문 예정시간': r.get('expected_checkin') or '', '퇴실 예정시간': r.get('expected_checkout') or '',
                '입실 시간': r.get('checkin_time') or '', '퇴실 시간': r.get('checkout_time') or '',
                '현재 상태': _status(r['status']),
            })

    df_general = pd.DataFrame(general, columns=GENERAL_COLS)
    df_pass = pd.DataFrame(passes, columns=PASS_COLS)

    output = BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        # 건수가 0이어도 시트는 만든다 (헤더만) — 받는 쪽에서 시트가 사라지지 않게.
        df_general.to_excel(writer, index=False, sheet_name='일반 방문객')
        df_pass.to_excel(writer, index=False, sheet_name='출입권')
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

# 주소 두 가지를 모두 받는다 — 손으로 URL 을 칠 때 순서를 헷갈리기 쉬워서다.
@app.route('/api/admin/db-download', methods=['GET'])
@app.route('/api/admin/download-db', methods=['GET'])
def admin_db_download():
    """
    💾 [최고 관리자 전용] DB 파일(db.sqlite) 전체를 내려받는다.

    ⚠️ 이 경로 하나로 전 직원·방문객 개인정보가 통째로 나간다.
       - 최고 관리자(level 3) 세션에서만 허용한다.
       - 누가 언제 받아 갔는지 서버 로그에 남긴다(감사 테이블이 없으므로 stdout).

    파일을 그대로 읽지 않고 sqlite3 backup API 로 스냅샷을 뜬다.
      - 운영 중에는 쓰기가 진행 중일 수 있어, 파일을 직접 복사하면
        중간 상태(깨진 DB)가 그대로 내려갈 수 있다.
      - backup() 은 일관된 시점의 사본을 보장한다. (GitHub 백업도 같은 방식)
    """
    if not is_admin_authenticated():
        return jsonify({"success": False}), 401

    who = (session.get('user') or {}).get('name', '?')
    now = get_current_kst_time()
    tmp_dir = tempfile.mkdtemp(prefix='vms_dbdl_')
    tmp_path = os.path.join(tmp_dir, 'snapshot.sqlite')
    try:
        src = sqlite3.connect(DB_PATH)
        dst = sqlite3.connect(tmp_path)
        with dst:
            src.backup(dst)
        dst.close()
        src.close()

        # 스냅샷을 메모리로 옮긴 뒤 임시 파일을 지운다.
        # (send_file 에 경로를 넘기면 전송이 끝날 때까지 파일이 잠겨 정리 시점이 애매해진다)
        with open(tmp_path, 'rb') as f:
            blob = BytesIO(f.read())
        blob.seek(0)
    except Exception as e:
        print(f"❌ [DB다운로드] 실패 - {who} - {e}")
        return jsonify({"success": False, "message": f"DB 스냅샷 생성 실패: {str(e)}"}), 500
    finally:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            os.rmdir(tmp_dir)
        except Exception:
            pass

    print(f"💾 [DB다운로드] {now.strftime('%Y-%m-%d %H:%M:%S')} KST "
          f"- 관리자: {who} - IP: {request.remote_addr} - {blob.getbuffer().nbytes:,} bytes")

    return send_file(blob,
                     mimetype='application/vnd.sqlite3',
                     as_attachment=True,
                     download_name=f"VMS_DB_{now.strftime('%Y%m%d_%H%M')}.sqlite")

# ====================================================================
# ↩️ [최고 관리자 전용] 입·퇴실 승인 취소 (되돌리기)
#   - 왜: 날짜를 착각해 엉뚱한 건에 입실 승인·퇴실 처리를 눌러버리는 일이 생긴다.
#         경비실은 되돌릴 수단이 없어(승인은 단방향) 기록이 잘못된 채로 남는다.
#   - 무엇을: 상태를 '입실대기'로 되돌리고 입·퇴실 시각을 비운다.
#         → 경비실 승인 대기열에 다시 올라가 정상적으로 다시 승인할 수 있다.
#         → 실제로 일어나지 않은 출입이므로 시각을 남기지 않는다.
#   - 권한: 최고 관리자(3)만. 경비실이 자기 실수를 스스로 지우게 두지 않는다.
# ====================================================================
#   - 두 가지 경우가 있어 mode 로 나눈다.
#       · all      : 입실·퇴실을 모두 잘못 눌렀다 → '입실대기'로, 두 시각 모두 삭제
#       · checkout : 입실은 정상이고 퇴실만 잘못 눌렀다 → '입실완료'로, 퇴실 시각만 삭제
RESET_APPROVAL_FROM = ('입실완료', '퇴실대기', '퇴실완료')   # mode=all 에서 되돌릴 수 있는 상태
RESET_CHECKOUT_FROM = ('퇴실대기', '퇴실완료')               # mode=checkout 에서 되돌릴 수 있는 상태

@app.route('/api/admin/reset-approval', methods=['POST'])
def admin_reset_approval():
    if not is_admin_authenticated():
        return jsonify({"success": False, "message": "최고 관리자만 승인을 취소할 수 있습니다."}), 403

    data = request.json or {}
    log_id = data.get('id')
    mode = (data.get('mode') or 'all').strip()
    if mode not in ('all', 'checkout'):
        return jsonify({"success": False, "message": "취소 방식이 올바르지 않습니다."}), 400
    if not str(log_id or '').strip().isdigit():
        return jsonify({"success": False, "message": "대상이 없습니다."}), 400

    conn = get_db_connection()
    row = conn.execute("""
        SELECT id, name, visit_date, status, checkin_time, checkout_time
          FROM visitor_log WHERE id = ?
    """, (log_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"success": False, "message": "방문 정보를 찾을 수 없습니다."}), 404

    if mode == 'checkout':
        if row['status'] not in RESET_CHECKOUT_FROM:
            conn.close()
            return jsonify({"success": False,
                            "message": f"'{row['status']}' 상태는 되돌릴 퇴실 처리가 없습니다."}), 400
        # 입실 시각이 없으면 '입실완료'로 되돌릴 근거가 없다 → 전체 취소를 쓰게 안내한다.
        if not (row['checkin_time'] or '').strip():
            conn.close()
            return jsonify({"success": False,
                            "message": "입실 시각이 없어 퇴실만 되돌릴 수 없습니다. 전체 취소를 사용해 주세요."}), 400
        conn.execute("UPDATE visitor_log SET status = '입실완료', checkout_time = '' WHERE id = ?",
                     (log_id,))
        after, note, msg = '입실완료', '퇴실 시각만 삭제', '퇴실 처리를 취소했습니다. 재실 중 상태로 돌아갑니다.'
    else:
        if row['status'] not in RESET_APPROVAL_FROM:
            conn.close()
            return jsonify({"success": False,
                            "message": f"'{row['status']}' 상태는 되돌릴 승인이 없습니다."}), 400
        conn.execute("""
            UPDATE visitor_log SET status = '입실대기', checkin_time = '', checkout_time = ''
             WHERE id = ?
        """, (log_id,))
        after, note, msg = '입실대기', '입·퇴실 시각 삭제', '승인을 취소했습니다. 다시 승인 대기 상태입니다.'

    conn.commit()
    conn.close()
    print(f"↩️ [승인취소:{mode}] log={row['id']} {row['name']}({row['visit_date']}) "
          f"{row['status']} → {after}, {note} (by {session['user'].get('id', '')})")
    return jsonify({"success": True,
                    "message": f"{row['name']} 님의 {msg}",
                    "before": row['status'], "after": after})


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
        issue_visit_code(conn, emp_id)      # 🔢 담당자 번호 발급
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

            # 🌳 부서명 → dept_id 해석. 트리에 없는 이름이면 dept_id 는 비워두고 텍스트만 남긴다
            #    (조직도 화면에는 안 보이므로, 업로드 후 트리에서 배치해 주면 된다).
            #    같은 이름이 여러 노드면 상위(작은 id) 선택 — 마이그레이션과 동일 규칙.
            drow = conn.execute(
                "SELECT id FROM department_tree WHERE dept_name = ? ORDER BY id LIMIT 1", (dept,)
            ).fetchone() if dept else None
            dept_id = drow['id'] if drow else None

            existing = conn.execute("SELECT level FROM employees WHERE id = ?", (emp_id,)).fetchone()
            if existing:
                # 🔒 기존 직원: 권한(level)은 보존하고 나머지 정보만 갱신.
                #    (엑셀 일괄 업로드로 관리자/보안실 권한이 실수로 바뀌는 것을 방지)
                #    dept_id 는 해석에 성공했을 때만 갱신해, 트리에서 정리해 둔 배치를 지우지 않는다.
                if dept_id is not None:
                    conn.execute(
                        "UPDATE employees SET name=?, region=?, dept=?, dept_id=?, type=?, rank=? WHERE id=?",
                        (name, region, dept, dept_id, emp_type, rank, emp_id)
                    )
                else:
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
                    "INSERT INTO employees (id, name, region, dept, dept_id, type, rank, level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (emp_id, name, region, dept, dept_id, emp_type, rank, level)
                )
                issue_visit_code(conn, emp_id)   # 🔢 담당자 번호 발급
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
        expire_stale_passes()      # 🎫 유효기간이 끝난 정기권도 함께 만료 처리

# ====================================================================
# 🌳 [최고 관리자] 부서 트리 기반 임직원 관리 API  (/api/tree/...)
#   - 전산장비 관리 시스템의 조직도 UI 를 이식한 것. 라우트에 /tree 접두어를 두어
#     기존 방문객 API(/api/admin/employees 등)와 충돌하지 않게 한다.
#   - 방문객 시스템 고유 항목(region·type·level)을 함께 다룬다.
#   - dept(표시용 텍스트)는 dept_id 로부터 항상 파생 저장한다. (init_db 동기화와 동일 규칙)
# ====================================================================
def _tree_guard():
    """최고 관리자(3) 전용. 통과하면 None, 아니면 (응답, 코드) 튜플."""
    if 'user' not in session:
        return jsonify({'success': False, 'message': '인증 정보가 없습니다.'}), 401
    if int(session['user'].get('level', 1)) != 3:
        return jsonify({'success': False, 'message': '최고 관리자만 사용할 수 있습니다.'}), 403
    return None

def _dept_name(conn, dept_id):
    row = conn.execute("SELECT dept_name FROM department_tree WHERE id = ?", (dept_id,)).fetchone()
    return row['dept_name'] if row else ''

@app.route('/emp-tree')
def emp_tree_page():
    """관리자 화면의 임직원 탭에 iframe 으로 임베드되는 조직도 페이지."""
    return render_template('emp_tree.html')

@app.route('/api/tree/departments', methods=['GET'])
def tree_departments():
    g = _tree_guard()
    if g: return g
    conn = get_db_connection()
    # 🔖 방문객 시스템에서 쓰는 부서만 조회 (전산장비 자산 전용 노드 '서버실'·'폐기 대상 장비' 등은 제외)
    rows = conn.execute("""
        SELECT d.id, d.dept_name, d.parent_id, COUNT(e.id) AS member_count
        FROM department_tree d
        JOIN dept_scope s ON s.dept_id = d.id AND s.system = ?
        LEFT JOIN employees e ON e.dept_id = d.id
        GROUP BY d.id, d.dept_name, d.parent_id ORDER BY d.id
    """, (SYSTEM_VISITOR,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/tree/employees/all', methods=['GET'])
def tree_employees_all():
    g = _tree_guard()
    if g: return g
    conn = get_db_connection()
    rows = conn.execute("""
        SELECT e.id, e.name AS emp_name, e.rank AS position, e.dept_id, d.dept_name
        FROM employees e LEFT JOIN department_tree d ON e.dept_id = d.id
        ORDER BY d.dept_name, e.name
    """).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/tree/departments/<int:dept_id>/employees', methods=['GET'])
def tree_dept_employees(dept_id):
    """클릭한 부서에 '직속'으로 소속된 인원만 (하위 부서는 트리에서 따로 선택)."""
    g = _tree_guard()
    if g: return g
    conn = get_db_connection()
    rows = conn.execute("""
        SELECT e.id, e.name AS emp_name, e.rank AS position, e.dept_id, d.dept_name,
               e.region, e.type, e.level, e.visit_code
        FROM employees e JOIN department_tree d ON e.dept_id = d.id
        WHERE e.dept_id = ?
        ORDER BY
            CASE e.rank
                WHEN '회장' THEN 1 WHEN '부회장' THEN 2 WHEN '사장' THEN 3 WHEN '부사장' THEN 4
                WHEN '전무' THEN 5 WHEN '상무' THEN 6 WHEN '본부장' THEN 7 WHEN '담당' THEN 8
                WHEN '공장장' THEN 9 WHEN '센터장' THEN 10 WHEN '소장' THEN 11 WHEN '법인장' THEN 12
                WHEN '이사대우' THEN 13 WHEN '수석부장' THEN 14 WHEN '팀장' THEN 15 WHEN '부장' THEN 16
                WHEN '차장' THEN 17 WHEN '과장' THEN 18 WHEN '부과장' THEN 19 WHEN '주관' THEN 20
                WHEN '대리' THEN 21 WHEN '주임' THEN 22 WHEN '사원' THEN 23
                ELSE 100 END, e.name ASC
    """, (dept_id,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/tree/employees', methods=['POST'])
def tree_add_employee():
    g = _tree_guard()
    if g: return g
    d = request.json or {}
    emp_id, name = str(d.get('id', '')).strip(), str(d.get('name', '')).strip()
    dept_id = d.get('dept_id')
    if not emp_id or not name or not dept_id:
        return jsonify({'success': False, 'message': '사번·이름·부서는 필수입니다.'}), 400
    conn = get_db_connection()
    try:
        if conn.execute("SELECT id FROM employees WHERE id = ?", (emp_id,)).fetchone():
            return jsonify({'success': False, 'message': '이미 존재하는 사번입니다.'}), 400
        conn.execute("""
            INSERT INTO employees (id, name, dept, dept_id, rank, type, region, level, password)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')
        """, (emp_id, name, _dept_name(conn, dept_id), dept_id,
              str(d.get('rank', '')).strip(), d.get('type', '직영'),
              d.get('region', '기타'), int(d.get('level', 1))))
        issue_visit_code(conn, emp_id)      # 🔢 담당자 번호 발급
        conn.commit()
        return jsonify({'success': True, 'message': '새 직원이 등록되었습니다.'})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/tree/employees/<emp_id>', methods=['PUT'])
def tree_edit_employee(emp_id):
    g = _tree_guard()
    if g: return g
    d = request.json or {}
    dept_id = d.get('dept_id')
    conn = get_db_connection()
    try:
        conn.execute("""
            UPDATE employees SET name = ?, rank = ?, dept_id = ?, dept = ?,
                                 type = ?, region = ?, level = ?
             WHERE id = ?
        """, (str(d.get('name', '')).strip(), str(d.get('rank', '')).strip(), dept_id,
              _dept_name(conn, dept_id), d.get('type', '직영'),
              d.get('region', '기타'), int(d.get('level', 1)), emp_id))
        conn.commit()
        return jsonify({'success': True, 'message': '직원 정보가 수정되었습니다.'})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/tree/employees/<emp_id>/retire', methods=['POST'])
def tree_retire_employee(emp_id):
    """퇴사 처리: '퇴사자' 부서로 이동 (계정·방문 기록은 그대로 남긴다)."""
    g = _tree_guard()
    if g: return g
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        retire_id = ensure_retired_dept(cur)      # 기타/외부 > 퇴직자
        cur.execute("UPDATE employees SET dept_id = ?, dept = ? WHERE id = ?",
                    (retire_id, RETIRED_DEPT_NAME, emp_id))
        conn.commit()
        return jsonify({'success': True,
                        'message': f"퇴직 처리되었습니다. '{EXTERNAL_ROOT_NAME} > {RETIRED_DEPT_NAME}' 에 보관되며 로그인은 차단됩니다."})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/tree/employees/<emp_id>', methods=['DELETE'])
def tree_delete_employee(emp_id):
    g = _tree_guard()
    if g: return g
    conn = get_db_connection()
    try:
        conn.execute("DELETE FROM employees WHERE id = ?", (emp_id,))
        conn.commit()
        return jsonify({'success': True, 'message': '직원이 삭제되었습니다.'})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/tree/departments', methods=['POST'])
def tree_add_department():
    g = _tree_guard()
    if g: return g
    d = request.json or {}
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("INSERT INTO department_tree (dept_name, parent_id) VALUES (?, ?)",
                    (d.get('dept_name'), d.get('parent_id') or None))
        # 🔖 방문객 화면에서 만든 부서이므로 방문객 범위를 부여한다.
        #    (부모는 이미 방문객 범위에 있으므로 '부모 ⊇ 자식' 불변식이 유지된다)
        cur.execute("INSERT INTO dept_scope (dept_id, system) VALUES (?, ?)",
                    (cur.lastrowid, SYSTEM_VISITOR))
        conn.commit()
        return jsonify({'success': True, 'message': '새 부서가 추가되었습니다.'})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/tree/departments/<int:dept_id>', methods=['PUT'])
def tree_edit_department(dept_id):
    g = _tree_guard()
    if g: return g
    d = request.json or {}
    if dept_id == d.get('parent_id'):
        return jsonify({'success': False, 'message': '자기 자신을 상위 부서로 지정할 수 없습니다.'}), 400
    conn = get_db_connection()
    try:
        conn.execute("UPDATE department_tree SET dept_name = ?, parent_id = ? WHERE id = ?",
                     (d.get('dept_name'), d.get('parent_id') or None, dept_id))
        # 부서명이 바뀌면 소속 직원의 표시용 dept 도 함께 갱신
        conn.execute("UPDATE employees SET dept = ? WHERE dept_id = ?", (d.get('dept_name'), dept_id))
        conn.commit()
        return jsonify({'success': True, 'message': '부서가 수정되었습니다.'})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/tree/departments/<int:dept_id>', methods=['DELETE'])
def tree_delete_department(dept_id):
    g = _tree_guard()
    if g: return g
    conn = get_db_connection()
    try:
        if conn.execute("SELECT id FROM department_tree WHERE parent_id = ?", (dept_id,)).fetchall():
            return jsonify({'success': False, 'message': '하위 부서가 있어 삭제할 수 없습니다.'}), 400
        if conn.execute("SELECT id FROM employees WHERE dept_id = ?", (dept_id,)).fetchall():
            return jsonify({'success': False, 'message': '소속 직원이 있어 삭제할 수 없습니다.'}), 400
        # 🔖 다른 시스템도 쓰는 부서면 트리에서 지우지 않고 '방문객 범위'만 해제한다.
        #    (전산장비 등 다른 시스템의 조직도를 함부로 훼손하지 않기 위함)
        others = conn.execute(
            "SELECT COUNT(*) FROM dept_scope WHERE dept_id = ? AND system <> ?",
            (dept_id, SYSTEM_VISITOR)
        ).fetchone()[0]
        conn.execute("DELETE FROM dept_scope WHERE dept_id = ? AND system = ?", (dept_id, SYSTEM_VISITOR))
        if others == 0:
            conn.execute("DELETE FROM department_tree WHERE id = ?", (dept_id,))
        conn.commit()
        return jsonify({'success': True, 'message': '부서가 삭제되었습니다.'})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        conn.close()

# ── 부서장 지정 ─────────────────────────────────────────────────────
def _tree_emp_brief(conn, emp_id):
    if not emp_id:
        return None
    row = conn.execute("""
        SELECT e.id, e.name, e.rank, d.dept_name
        FROM employees e LEFT JOIN department_tree d ON e.dept_id = d.id
        WHERE e.id = ?
    """, (emp_id,)).fetchone()
    return dict(row) if row else None

@app.route('/api/tree/departments/<int:dept_id>/manager', methods=['GET'])
def tree_get_manager(dept_id):
    """부서장 조회. 직접 임명자가 없고 use_fallback 이면 상위 부서장을 대체 표시."""
    g = _tree_guard()
    if g: return g
    conn = get_db_connection()
    chain = conn.execute("""
        WITH RECURSIVE chain(id, parent_id, dept_name, manager_emp_id, use_fallback, depth) AS (
            SELECT id, parent_id, dept_name, manager_emp_id, use_fallback, 0
            FROM department_tree WHERE id = ?
            UNION ALL
            SELECT d.id, d.parent_id, d.dept_name, d.manager_emp_id, d.use_fallback, c.depth + 1
            FROM department_tree d JOIN chain c ON d.id = c.parent_id
        )
        SELECT * FROM chain ORDER BY depth
    """, (dept_id,)).fetchall()
    if not chain:
        conn.close()
        return jsonify({'manager': None, 'is_inherited': False, 'use_fallback': True}), 404

    me = chain[0]
    out = {'use_fallback': bool(me['use_fallback']), 'is_inherited': False,
           'manager': None, 'source_dept_name': None}
    if me['manager_emp_id']:
        out['manager'] = _tree_emp_brief(conn, me['manager_emp_id'])
        out['source_dept_name'] = me['dept_name']
    elif me['use_fallback']:
        for anc in chain[1:]:
            if anc['manager_emp_id']:
                out['manager'] = _tree_emp_brief(conn, anc['manager_emp_id'])
                out['source_dept_name'] = anc['dept_name']
                out['is_inherited'] = True
                break
    conn.close()
    return jsonify(out)

@app.route('/api/tree/departments/<int:dept_id>/manager-candidates', methods=['GET'])
def tree_manager_candidates(dept_id):
    g = _tree_guard()
    if g: return g
    conn = get_db_connection()
    rows = conn.execute("""
        WITH RECURSIVE sub AS (
            SELECT id FROM department_tree WHERE id = ?
            UNION ALL
            SELECT d.id FROM department_tree d JOIN sub ON d.parent_id = sub.id
        )
        SELECT e.id, e.name, e.rank, d.dept_name
        FROM employees e JOIN department_tree d ON e.dept_id = d.id
        WHERE e.dept_id IN (SELECT id FROM sub) ORDER BY d.dept_name, e.name
    """, (dept_id,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/tree/departments/<int:dept_id>/manager', methods=['POST'])
def tree_set_manager(dept_id):
    g = _tree_guard()
    if g: return g
    emp_id = (request.json or {}).get('emp_id')
    if not emp_id:
        return jsonify({'success': False, 'message': '임명할 직원을 선택하세요.'}), 400
    conn = get_db_connection()
    try:
        ok = conn.execute("""
            WITH RECURSIVE sub AS (
                SELECT id FROM department_tree WHERE id = ?
                UNION ALL
                SELECT d.id FROM department_tree d JOIN sub ON d.parent_id = sub.id
            )
            SELECT 1 FROM employees WHERE id = ? AND dept_id IN (SELECT id FROM sub)
        """, (dept_id, emp_id)).fetchone()
        if not ok:
            return jsonify({'success': False, 'message': '해당 부서 또는 하위 부서 소속 직원만 지정할 수 있습니다.'}), 400
        conn.execute("UPDATE department_tree SET manager_emp_id = ? WHERE id = ?", (emp_id, dept_id))
        conn.commit()
        return jsonify({'success': True, 'message': '부서장이 임명되었습니다.'})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/tree/departments/<int:dept_id>/manager', methods=['DELETE'])
def tree_unset_manager(dept_id):
    g = _tree_guard()
    if g: return g
    conn = get_db_connection()
    try:
        conn.execute("UPDATE department_tree SET manager_emp_id = NULL WHERE id = ?", (dept_id,))
        conn.commit()
        return jsonify({'success': True, 'message': '부서장이 해제되었습니다.'})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/tree/departments/<int:dept_id>/fallback', methods=['PUT'])
def tree_set_fallback(dept_id):
    g = _tree_guard()
    if g: return g
    enabled = 1 if (request.json or {}).get('enabled') else 0
    conn = get_db_connection()
    try:
        conn.execute("UPDATE department_tree SET use_fallback = ? WHERE id = ?", (enabled, dept_id))
        conn.commit()
        return jsonify({'success': True, 'message': '설정이 변경되었습니다.'})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        conn.close()


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