/**
 * 통합 admin.js (인라인 스타일 제로 및 클래스 제어 기반)
 * 🛡️ [주소창 수동 우회 진입 및 브라우저 캐시 부활 방어 로직 탑재]
 */

const empBaseUrl = "/admin/employees";
const ITEMS_PER_PAGE = 10;
const PAGE_BLOCK_SIZE = 5;

let allEmployees = [];
let filteredEmployeesList = [];
let currentEmpPage = 1;
let isEditMode = false;

const GROUP_PRIORITY = (emp) => {
    if (emp.type === "경영진" || emp.dept === "경영진") return 1;
    if (emp.region === "에코센터" && emp.type === "직영") return 2;
    if (emp.region === "테크센터" && emp.type === "직영") return 3;
    if (emp.dept && emp.dept.includes("식당")) return 4;
    if (emp.type === "협력사") return 5;
    return 6; 
};

const RANK_PRIORITY = {
    "회장": 1, "사장": 2, "부사장": 3, "전무": 4, "상무": 5, "이사": 6,
    "부장": 7, "차장": 8, "과장": 9, "대리": 10, "주임": 11, "사원": 12
};

// ====================================================================
// 🗺️ 한국 표준시(KST) 기준 이번 주 월요일 ~ 금요일 날짜 계산 함수
// ====================================================================
function getKstThisWeekRange() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const kstDate = new Date(utc + (9 * 60 * 60 * 1000));
    
    const currentDay = kstDate.getDay(); 
    const dayDiffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    const dayDiffToFriday = currentDay === 0 ? -2 : 5 - currentDay;
    
    const mondayDate = new Date(kstDate.getTime() + (dayDiffToMonday * 24 * 60 * 60 * 1000));
    const fridayDate = new Date(kstDate.getTime() + (dayDiffToFriday * 24 * 60 * 60 * 1000));
    
    const format = (d) => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };
    
    return { monday: format(mondayDate), friday: format(fridayDate), todayKst: format(kstDate) };
}

// ====================================================================
// 🚨 [최전방 세션 가드 인터셉터]
// ====================================================================
function verifyAdminSessionGate() {
    const empData = sessionStorage.getItem('emp_session');
    
    if (!empData) {
        alert("보안 세션이 없거나 만료되었습니다. 인증 후 진입하세요.");
        window.location.replace('/emp'); 
        return false;
    }
    
    try {
        const emp = JSON.parse(empData);
        if (!emp.level || parseInt(emp.level) !== 3) {
            alert("최고 관리자(Level 3) 전용 구역입니다. 접근 권한이 없습니다.");
            window.location.replace('/emp');
            return false;
        }
    } catch (e) {
        window.location.replace('/emp');
        return false;
    }
    return true;
}

// /admin 페이지에서만 클라이언트 세션 게이트(레벨3 강제) 실행.
// /records(전체기록 iframe, 레벨3·4·5 공용)에선 서버가 이미 권한을 검증하므로 이 게이트를 돌리면 안 됨(레벨5가 튕김).
if (window.location.pathname.startsWith('/admin')) {
    verifyAdminSessionGate();
}

document.addEventListener("DOMContentLoaded", () => {
    const startEl = document.getElementById('adminStartDate');
    const endEl = document.getElementById('adminEndDate');
    if (startEl && endEl) {
        const weekRange = getKstThisWeekRange();
        startEl.value = weekRange.todayKst;
        endEl.value = weekRange.todayKst;
    }

    renderAdminRegionButtons();
    renderPassRegionButtons();

    if (sessionStorage.getItem('emp_session')) {
        loadAdminLogs();
    }
});

// 🗺️ 거점 필터 버튼 렌더: '전 사업장' → 본인 소속 센터 → 나머지(기본 순서).
//    소속은 로그인 세션에서 읽고, 목록·순서 규칙은 visitor-history.js 의 공용 헬퍼가 담당한다.
function renderAdminRegionButtons() {
    const box = document.getElementById('regionFilterBtns');
    if (!box || typeof window.regionFilterButtonsHtml !== 'function') return;
    let myRegion = '';
    try {
        const emp = JSON.parse(sessionStorage.getItem('emp_session'));
        myRegion = emp ? (emp.region || '') : '';
    } catch (e) {}
    box.innerHTML = window.regionFilterButtonsHtml(myRegion, 'setAdminRegion');
}

window.addEventListener("pageshow", (event) => {
    if (window.location.pathname.startsWith('/admin') &&
        (event.persisted || (window.performance && window.performance.navigation.type === 2))) {
        verifyAdminSessionGate();
    }
});

// 'YYYY-MM-DD HH:MM:SS' → 'HH:MM:SS' 만 반환 (방문일 컬럼에 날짜가 있어 시간만 표시).
//  값이 없거나 예상 형식이 아니면 안전하게 원본(또는 '-') 반환. (경비실 표와 동일 규칙)
/* 🕗 신청이 접수된 시각. 같은 사람이 두 번 올라온 경우 어느 쪽이 나중 것인지 가려내는 근거.
   이 컬럼이 생기기 전에 접수된 건은 값이 없어 '-' 로 표시된다. */
/* 🙋 신청 주체 배지.
     requested_by 가 'visitor' 면 손님이 직접 올린 건, 사번이면 그 직원이 대신 올린 건.
     이 컬럼이 생기기 전 데이터는 값이 없어 배지를 붙이지 않는다(구분 불가). */
function requesterBadge(requestedBy, requestedByName) {
    const v = (requestedBy || '').trim();
    if (!v) return '';
    if (v === 'visitor') return '<span class="requester-tag requester-visitor">손님 신청</span>';
    const who = requestedByName || v;
    return `<span class="requester-tag requester-staff" title="${who}">임직원 신청</span>`;
}

/** 신청 주체 필터를 적용한 목록. 값이 없는 옛 데이터는 '전체' 에서만 보인다. */
function adminFilterByRequester(list) {
    const f = (document.getElementById('adminRequesterFilter') || {}).value || '';
    if (!f) return list;
    return list.filter(v => {
        const mb = (v.requested_by || '').trim();
        return f === 'visitor' ? mb === 'visitor' : (mb && mb !== 'visitor');
    });
}

/** 신청 주체 배지 + 접수 시각을 한 줄로. 배지에 '신청' 이 이미 들어 있어 말이 겹치지 않게 한다. */
function adminRequesterLine(v) {
    const badge = requesterBadge(v.requested_by, v.requested_by_name);
    const t = adminReqTime(v.created_at);
    return badge ? (badge + ' ' + t) : ('신청 ' + t);
}

function adminReqTime(createdAt) {
    const v = (createdAt || '').trim();
    return v ? v.slice(5, 16) : '-';
}

function adminTimeOnly(val) {
    if (!val) return '-';
    const parts = String(val).trim().split(' ');
    return parts.length > 1 ? parts[parts.length - 1] : val;
}

// 상태값 → 모바일 카드 상태 배지 색상 클래스 (진행 단계별로 색을 달리해 한눈에 구분).
function adminStatusClass(status) {
    const s = String(status || '');
    if (s === '퇴실완료') return 'st-done';
    if (s === '입실완료') return 'st-in';
    if (s === '퇴실대기') return 'st-out-wait';
    if (s === '입실대기' || s === '사전예약') return 'st-wait';
    return 'st-etc';
}

// ==========================================
// [구역 1] 방문객 출입 기록 처리 파트 (달력 연동)
// ==========================================

// 📄 조회 결과 전체(정렬 완료)와 현재 페이지. 표는 10건씩 끊어 보여준다.
//    요약 카드(입실 인원·완료·재실중)는 페이지가 아니라 '조회 결과 전체' 기준으로 계산한다.
let adminLogsAll = [];
let adminLogPage = 1;

// 🗺️ 선택된 거점 필터. '' = 전 사업장.
//   서버는 level 3·5 에만 이 값을 적용하고, 경비실(4)은 항상 자기 거점으로 강제한다.
//   값은 서버 화이트리스트(ALLOWED_REGIONS)로 재검증되므로 임의 값은 무시된다.
let adminRegionFilter = '';

// 거점 버튼 클릭 → 활성 표시 갱신 + 재조회
function setAdminRegion(btn) {
    if (!btn) return;
    adminRegionFilter = btn.dataset.region || '';
    const bar = document.getElementById('regionFilterBar');
    if (bar) bar.querySelectorAll('.region-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    loadAdminLogs();
}

async function loadAdminLogs() {
    const startEl = document.getElementById('adminStartDate');
    const endEl = document.getElementById('adminEndDate');
    
    const startDate = startEl ? startEl.value : '';
    const endDate = endEl ? endEl.value : '';
    
    const tbody = document.getElementById('adminLogBody');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="15" class="text-center text-muted">기록 내역을 불러오는 중입니다...</td></tr>';
    
    try {
        const regionParam = adminRegionFilter ? `&region=${encodeURIComponent(adminRegionFilter)}` : '';
        const res = await fetch(`/api/admin/logs?start_date=${startDate}&end_date=${endDate}${regionParam}`);
        
        if (res.status === 401 || res.status === 403) {
            alert("관리자 권한 인증 세션이 없거나 만료되었습니다.");
            sessionStorage.removeItem('emp_session');
            window.location.href = '/emp';
            return;
        }

        const logs = await res.json();

        // 상단 요약 카드: '실제 입실한 인원'만 모집단으로 삼는다.
        //  - 아직 안 온 예약(사전예약·입실대기)과 만료 건은 제외.
        //  - 완료 = 퇴실완료(입·퇴실 둘 다 됨), 미완료 = 재실 중(입실완료·퇴실대기).
        const arrived = logs.filter(v => ['입실완료', '퇴실대기', '퇴실완료'].includes(v.status));
        const totalCount = arrived.length;
        const completeCount = arrived.filter(v => v.status === '퇴실완료').length;
        const incompleteCount = totalCount - completeCount;
        const setStat = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        setStat('adminStatTotal', totalCount);
        setStat('adminStatComplete', completeCount);
        setStat('adminStatIncomplete', incompleteCount);

        // 순번: 서버가 계산한 '그 달 절대 순번'(month_seq) 사용 (경비실·엑셀과 동일 규칙).
        //  - 날짜 필터와 무관하게 매달 1일부터의 절대 위치. 표시는 최신순(방문일→id 내림차순).
        //  - 정렬 결과 전체를 보관하고, 표에는 현재 페이지 몫만 그린다(요약 카드는 전체 기준).
        adminLogsAll = [...logs].sort((a, b) => {
            if (a.visit_date !== b.visit_date) return a.visit_date > b.visit_date ? -1 : 1;
            return (b.id || 0) - (a.id || 0);
        });
        adminLogPage = 1;          // 조회 조건이 바뀌면 항상 1페이지부터
        renderAdminLogTable();
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="15" class="text-center text-danger">네트워크 통신 에러가 발생했습니다.</td></tr>';
    }
}

// 📄 현재 페이지 몫만 표에 렌더 + 페이지 버튼 갱신
/* ↩️ 입·퇴실 승인 취소
     날짜를 착각해 잘못 누른 승인을 되돌린다. 서버가 상태를 '입실대기'로 돌리고
     입·퇴실 시각을 지우므로, 경비실 승인 대기열에 다시 올라간다.
     되돌릴 승인이 있는 상태에만 버튼을 노출한다(서버도 같은 조건으로 한 번 더 막는다). */
const ADMIN_DELETABLE_STATUSES = ['사전예약', '입실대기'];            // 삭제 가능(아직 입실 전)
const ADMIN_RESET_STATUSES = ['입실완료', '퇴실대기', '퇴실완료'];   // 전체 취소 대상
const ADMIN_RESET_OUT_STATUSES = ['퇴실대기', '퇴실완료'];            // 퇴실만 취소 대상

/* mode
     'all'      : 입실·퇴실을 모두 잘못 눌렀을 때 → 입실대기, 두 시각 삭제
     'checkout' : 입실은 정상이고 퇴실만 잘못 눌렀을 때 → 입실완료, 퇴실 시각만 삭제 */
/* 🗑️ 중복 입실 신청 삭제
     그룹 신청에 이미 포함된 사람이 그 사실을 모르고 개별 신청을 또 올리면
     대기열에 두 번 뜨고 방문 횟수도 2회로 잡힌다. 아직 입실 전인 건만 지운다.
     (서버도 '사전예약·입실대기' 로 한 번 더 막는다) */
async function deleteVisitRequest(logId) {
    const target = (adminLogsAll || []).find(x => x.id === logId);
    const who = target ? (target.name + (target.company ? ' (' + target.company + ')' : '')) : '이 신청';
    if (!confirm([
        '🗑️ ' + who + ' 님의 입실 신청을 삭제합니다.',
        '',
        '· 중복 신청을 정리할 때 쓰는 기능입니다.',
        '· 삭제하면 되돌릴 수 없고 방문 횟수에서도 빠집니다.',
        '',
        '삭제할까요?'
    ].join(String.fromCharCode(10)))) return;

    try {
        const res = await fetch('/api/schedule/' + logId, { method: 'DELETE' });
        const d = await res.json();
        if (!d.success) { alert(d.message || '삭제에 실패했습니다.'); return; }
        alert(d.message);
        loadAdminLogs();
    } catch (e) {
        alert('삭제 중 통신 오류가 발생했습니다.');
    }
}

async function resetApproval(logId, mode) {
    // 이름은 onclick 에 넣지 않고 여기서 찾는다 (따옴표·특수문자가 속성을 깨뜨리지 않게)
    const target = (adminLogsAll || []).find(x => x.id === logId);
    const name = target ? target.name : '';
    const lines = (mode === 'checkout')
        ? [`↩️ ${name} 님의 퇴실 처리만 취소합니다.`,
           '',
           '· 상태가 「재실중」으로 돌아갑니다. 입실 기록은 그대로 둡니다.',
           '· 퇴실 시간만 삭제됩니다.']
        : [`↩️ ${name} 님의 입·퇴실 승인을 모두 취소합니다.`,
           '',
           '· 상태가 「입실 대기」로 돌아가 경비실이 다시 승인할 수 있습니다.',
           '· 입실 시간과 퇴실 시간이 모두 삭제됩니다.'];
    if (!confirm(lines.concat(['', '진행할까요?']).join('\n'))) return;

    try {
        const res = await fetch('/api/admin/reset-approval', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: logId, mode: mode || 'all' })
        });
        const d = await res.json();
        if (!d.success) { alert(d.message || '승인 취소에 실패했습니다.'); return; }
        alert(d.message);
        loadAdminLogs();      // 목록 새로고침
    } catch (e) {
        alert('승인 취소 중 통신 오류가 발생했습니다.');
    }
}

function renderAdminLogTable() {
    const tbody = document.getElementById('adminLogBody');
    if (!tbody) return;

    const shown = adminFilterByRequester(adminLogsAll);   // 🙋 신청 주체 필터
    const perPage = window.VISIT_LOG_PER_PAGE || 10;
    const totalPages = Math.max(1, Math.ceil(shown.length / perPage));
    if (adminLogPage > totalPages) adminLogPage = totalPages;
    const start = (adminLogPage - 1) * perPage;
    const sorted = shown.slice(start, start + perPage);

    {
        let html = '';
        if (shown.length === 0) {
            html = '<tr><td colspan="15" class="text-center text-muted">조회 범위 내 출입 데이터가 존재하지 않습니다.</td></tr>';
        } else {
            sorted.forEach(v => {
                const managerDisplay = v.emp_name
                    ? `<b>${v.emp_name}</b><br><span class="manager-dept-info">(${v.emp_dept || '부서없음'})</span>`
                    : '<span class="no-manager-dash">-</span>';
                const visitCountDisplay = v.visit_count != null
                    ? (v.visit_count >= 2 ? `<b>${v.visit_count}회</b>` : `${v.visit_count}회`)
                    : '-';

                // 방문 이력 팝업 호출(이름 클릭). 따옴표·한글이 섞여도 안전하게 인코딩해 전달.
                const historyCall = `openVisitorHistory(decodeURIComponent('${encodeURIComponent(v.name || '').replace(/'/g, '%27')}'),decodeURIComponent('${encodeURIComponent(v.contact || '').replace(/'/g, '%27')}'))`;
                // 🎫 출입권으로 생성된 방문 건 표시 (일반 방문객과 구분). 이름 아래 줄에 둔다 —
                //    이름 옆에 붙이면 긴 이름·좁은 열에서 줄바꿈이 지저분해진다.
                const passTag = v.pass_id ? '<div class="pass-tag-line"><span class="pass-tag">출입권</span></div>' : '';
                const nameLink = `<span class="visitor-name-link" onclick="${historyCall}">${v.name}</span>`;
                // ↩️ 날짜를 착각해 잘못 누른 입·퇴실 승인을 되돌린다. 이미 끝난 건(만료)·아직 승인 전은 대상이 아니다.
                let resetBtn = '<span class="no-manager-dash">-</span>';
                if (ADMIN_DELETABLE_STATUSES.includes(v.status)) {
                    // 아직 입실 전 → 중복 신청 정리용 삭제. (입실 후에는 실제 출입 사실이라 지우지 않는다)
                    resetBtn = `<button class="btn btn-secondary btn-action-sm" onclick="deleteVisitRequest(${v.id})">삭제</button>`;
                } else if (ADMIN_RESET_STATUSES.includes(v.status)) {
                    // 퇴실 단계면 '퇴실만' 되돌릴 선택지를 함께 준다 (입실은 정상인 경우가 많다)
                    const outBtn = ADMIN_RESET_OUT_STATUSES.includes(v.status)
                        ? `<button class="btn btn-secondary btn-action-sm" onclick="resetApproval(${v.id}, 'checkout')">퇴실만 취소</button>`
                        : '';
                    resetBtn = `${outBtn}<button class="btn btn-secondary btn-action-sm" onclick="resetApproval(${v.id}, 'all')">전체 취소</button>`;
                }

                html += `
                    <tr>
                        <td data-label="순번">${v.month_seq != null ? v.month_seq : '-'}</td>
                        <td data-label="방문일">${v.visit_date}</td>
                        <td class="col-split-visitor" data-label="이름">${nameLink}${passTag}<div class="req-time-line">${adminRequesterLine(v)}</div></td>
                        <td class="col-split-visitor" data-label="연락처">${formatPhone(v.contact)}</td>
                        <td class="col-merged-visitor" data-label="방문객">
                            ${nameLink}${passTag}
                            <span class="manager-dept-info">${formatPhone(v.contact)}</span>
                            <div class="req-time-line">${adminRequesterLine(v)}</div>
                        </td>
                        <td data-label="방문 횟수">${visitCountDisplay}</td>
                        <td data-label="소속">${v.company}</td>
                        <td data-label="방문 목적"><span class="purpose-tag">${v.purpose}</span></td>
                        <td data-label="담당자">${managerDisplay}</td>
                        <td class="col-split-time" data-label="입실 시간">${adminTimeOnly(v.checkin_time)}</td>
                        <td class="col-split-time" data-label="퇴실 시간">${adminTimeOnly(v.checkout_time)}</td>
                        <td class="col-merged-time" data-label="입·퇴실">
                            <span class="time-in">입 ${adminTimeOnly(v.checkin_time)}</span><br>
                            <span class="time-out">퇴 ${adminTimeOnly(v.checkout_time)}</span>
                        </td>
                        <td data-label="상태"><b>${statusLabel(v.status)}</b></td>
                        <td data-label="관리">${resetBtn}</td>
                        <!-- 📱 모바일 카드 전용 헤더(이름·일행·상태·연락처·횟수를 한 블록으로).
                             데스크톱·태블릿에선 숨김. 맨 끝에 두어 표의 고정 컬럼폭(nth-child)을 어긋나지 않게 하고,
                             카드에선 order:-1 로 최상단에 올린다. -->
                        <td class="col-card-head">
                            <div class="card-head-main">
                                <div class="card-head-id">
                                    <span class="card-seq">#${v.month_seq != null ? v.month_seq : '-'}</span>
                                    <span class="card-name">${nameLink}${passTag}</span>
                                </div>
                                <span class="card-status ${adminStatusClass(v.status)}">${statusLabel(v.status)}</span>
                            </div>
                            <div class="card-head-sub">${formatPhone(v.contact)} · 방문 ${v.visit_count != null ? v.visit_count : '-'}회</div>
                        </td>
                    </tr>
                `;
            });
        }
        tbody.innerHTML = html;
    }

    if (typeof window.renderLogPagination === 'function') {
        window.renderLogPagination('adminLogPagination', shown.length, adminLogPage, perPage, (p) => {
            adminLogPage = p;
            renderAdminLogTable();
        });
    }
}

function downloadExcel() {
    const startEl = document.getElementById('adminStartDate');
    const endEl = document.getElementById('adminEndDate');
    
    const startDate = startEl ? startEl.value : '';
    const endDate = endEl ? endEl.value : '';
    
    // 화면의 거점 필터를 엑셀에도 동일 적용 (필터를 걸고 저장했는데 전 사업장이 나오면 혼란)
    const regionParam = adminRegionFilter ? `&region=${encodeURIComponent(adminRegionFilter)}` : '';
    window.location.href = `/api/admin/excel-download?start_date=${startDate}&end_date=${endDate}${regionParam}`;
}

// ==========================================
// [구역 2] 식수 연동 임직원 인사 데이터 관리 파트 (CRUD)
// ==========================================
// ⚠️ 아래 평면 표 기반 임직원 CRUD 는 부서 트리 화면(/emp-tree)으로 대체되었다.
//    관리자 화면에 해당 표 DOM 이 더 이상 없으므로, 남아 있는 호출 경로(엑셀 업로드 등)가
//    깨지지 않도록 요소 존재 여부를 먼저 확인하고 조용히 빠져나간다.
async function loadEmployees() {
    const tbody = document.getElementById("employeeTableBody");
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">직원 목록 동기화 중...</td></tr>';

    try {
        const res = await fetch(empBaseUrl);
        
        if (res.status === 401 || res.status === 403) {
            alert("관리자 권한 인증 세션이 없거나 만료되었습니다.");
            sessionStorage.removeItem('emp_session');
            window.location.href = '/emp';
            return;
        }

        const data = await res.json();
        allEmployees = data || [];

        allEmployees.sort((a, b) => {
            const pA = GROUP_PRIORITY(a);
            const pB = GROUP_PRIORITY(b);
            if (pA !== pB) return pA - pB;

            const rA = RANK_PRIORITY[a.rank] || 99;
            const rB = RANK_PRIORITY[b.rank] || 99;
            if (rA !== rB) return rA - rB;

            return a.name.localeCompare(b.name, "ko");
        });

        filteredEmployeesList = [...allEmployees];
        currentEmpPage = 1;
        renderEmployeeTable();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">⚠️ 직원 목록 조회 중 연동 에러가 발생했습니다.</td></tr>';
    }
}

function renderEmployeeTable() {
    const tbody = document.getElementById("employeeTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (filteredEmployeesList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">일치하는 임직원 정보가 없습니다.</td></tr>';
        const pg = document.getElementById("employeePagination");
        if (pg) pg.innerHTML = "";
        return;
    }

    const startIndex = (currentEmpPage - 1) * ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredEmployeesList.length);
    const pageData = filteredEmployeesList.slice(startIndex, endIndex);

    pageData.forEach(emp => {
        const tr = document.createElement("tr");
        
        // 💡 [수정됨] Level 2 폐지 및 Level 4(보안관제) 표시 로직
        let lvlBadge = '';
        if (emp.level === 3) {
            lvlBadge = '<span class="badge badge-lv3">최고관리자 (Lv.3)</span>';
        } else if (emp.level === 4) {
            lvlBadge = '<span class="badge badge-lv4">보안관제 (Lv.4)</span>';
        } else if (emp.level === 5) {
            lvlBadge = '<span class="badge badge-lv5">전체기록 열람 (Lv.5)</span>';
        } else {
            lvlBadge = '<span class="badge badge-lv1">일반임직원 (Lv.1)</span>';
        }

        tr.innerHTML = `
            <td><b>${emp.id}</b></td>
            <td class="text-bold">${emp.name}</td>
            <td>${emp.region || '-'}</td>
            <td><span class="dept-tag emp-dept-label">${emp.dept || '부서없음'}</span></td> 
            <td>${emp.type || '-'}</td>
            <td>${emp.rank || '-'}</td>
            <td>${lvlBadge}</td>
            <td>
                <button class="btn btn-secondary btn-action-sm" onclick="openEditModal('${emp.id}')">수정</button> 
                <button class="btn btn-danger btn-action-sm" onclick="deleteEmployee('${emp.id}')">삭제</button> 
            </td>
        `;
        tbody.appendChild(tr);
    });

    renderEmployeePagination();
}

function renderEmployeePagination() {
    const container = document.getElementById("employeePagination");
    if (!container) return;
    container.innerHTML = "";

    const totalPages = Math.ceil(filteredEmployeesList.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) return;

    const currentBlock = Math.ceil(currentEmpPage / PAGE_BLOCK_SIZE);
    const startPage = (currentBlock - 1) * PAGE_BLOCK_SIZE + 1;
    const endPage = Math.min(startPage + PAGE_BLOCK_SIZE - 1, totalPages);

    const appendBtn = (label, targetPage, disabled) => {
        const btn = document.createElement("button");
        btn.innerHTML = label;
        btn.disabled = disabled;
        btn.onclick = () => { currentEmpPage = targetPage; renderEmployeeTable(); };
        container.appendChild(btn);
    };

    appendBtn("«", 1, currentEmpPage === 1);
    appendBtn("‹", Math.max(1, currentEmpPage - 1), currentEmpPage === 1);

    for (let i = startPage; i <= endPage; i++) {
        const pBtn = document.createElement("button");
        pBtn.innerText = i;
        if (i === currentEmpPage) pBtn.classList.add("active");
        pBtn.onclick = () => { currentEmpPage = i; renderEmployeeTable(); };
        container.appendChild(pBtn);
    }

    appendBtn("›", Math.min(totalPages, currentEmpPage + 1), currentEmpPage === totalPages);
    appendBtn("»", totalPages, currentEmpPage === totalPages);
}

function searchEmployees() {
    const box = document.getElementById("empSearchInput");
    if (!box) return;
    const query = box.value.trim().toLowerCase();
    if (!query) {
        filteredEmployeesList = [...allEmployees];
    } else {
        filteredEmployeesList = allEmployees.filter(emp => 
            (emp.id && emp.id.toLowerCase().includes(query)) ||
            (emp.name && emp.name.toLowerCase().includes(query)) ||
            (emp.dept && emp.dept.toLowerCase().includes(query))
        );
    }
    currentEmpPage = 1;
    renderEmployeeTable();
}

function openAddModal() {
    isEditMode = false;
    document.getElementById("modalTitle").innerText = "👥 신규 임직원 정보 추가";
    document.getElementById("empId").value = "";
    document.getElementById("empId").disabled = false;
    document.getElementById("empName").value = "";
    document.getElementById("empRegion").value = "";
    document.getElementById("empDept").value = "";
    document.getElementById("empType").value = "";
    document.getElementById("empRank").value = "";
    document.getElementById("empLevel").value = "1";
    document.getElementById("editModal").classList.add("modal-active"); 
}

function openEditModal(id) {
    const emp = allEmployees.find(e => e.id === id);
    if (!emp) return;

    isEditMode = true;
    document.getElementById("modalTitle").innerText = "⚙️ 임직원 정보 수정";
    document.getElementById("empId").value = emp.id;
    document.getElementById("empId").disabled = true; 
    document.getElementById("empName").value = emp.name || "";
    document.getElementById("empRegion").value = emp.region || "";
    document.getElementById("empDept").value = emp.dept || "";
    document.getElementById("empType").value = emp.type || "";
    document.getElementById("empRank").value = emp.rank || "";
    document.getElementById("empLevel").value = emp.level || "1";
    document.getElementById("editModal").classList.add("modal-active"); 
}

function closeModal() {
    document.getElementById("editModal").classList.remove("modal-active"); 
}

async function saveEmployee() {
    const empData = {
        id: document.getElementById("empId").value.trim(),
        name: document.getElementById("empName").value.trim(),
        region: document.getElementById("empRegion").value.trim(),
        dept: document.getElementById("empDept").value.trim(),
        type: document.getElementById("empType").value.trim(),
        rank: document.getElementById("empRank").value.trim(),
        level: parseInt(document.getElementById("empLevel").value)
    };

    if (!empData.id || !empData.name) return alert("사번과 성명은 필수 입력값입니다.");

    const url = isEditMode ? `${empBaseUrl}/${empData.id}` : empBaseUrl;
    const method = isEditMode ? "PUT" : "POST";

    try {
        const res = await fetch(url, {
            method: method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(empData)
        });

        if (res.status === 401 || res.status === 403) {
            alert("수정 권한 세션이 만료되었습니다.");
            sessionStorage.removeItem('emp_session');
            window.location.href = '/emp';
            return;
        }

        const result = await res.json();
        if (result.success || result.id) {
            alert("✅ 사원 정보가 완벽하게 저장되었습니다.");
            loadEmployees();
            closeModal();
        }
    } catch (e) {
        alert("통신 중 오류가 발생했습니다.");
    }
}

async function deleteEmployee(id) {
    if (!confirm("해당 직원을 정말 삭제하시겠습니까?")) return;
    try {
        const res = await fetch(`${empBaseUrl}/${id}`, { method: "DELETE" });
        
        if (res.status === 401 || res.status === 403) {
            alert("삭제 권한 세션이 만료되었습니다.");
            sessionStorage.removeItem('emp_session');
            window.location.href = '/emp';
            return;
        }

        alert("🗑️ 사원 정보가 삭제되었습니다.");
        loadEmployees();
    } catch (e) {
        alert("삭제 실패");
    }
}

async function uploadEmployeeFile() {
    const fileInput = document.getElementById("uploadFile");
    const file = fileInput.files[0];
    if (!file) return alert("업로드할 엑셀 파일을 선택해 주세요.");

    const formData = new FormData();
    formData.append("file", file);

    try {
        const res = await fetch("/api/admin/upload-employees", { method: "POST", body: formData });
        
        if (res.status === 401 || res.status === 403) {
            alert("일괄 등록 권한 세션이 만료되었습니다.");
            sessionStorage.removeItem('emp_session');
            window.location.href = '/emp';
            return;
        }

        alert("📊 엑셀 일괄 업로드가 성공적으로 완료되었습니다.");
        loadEmployees();
        fileInput.value = "";
    } catch(e) {
        alert("업로드 실패");
    }
}

// 탭 정의: 메뉴 버튼 ↔ 콘텐츠 패널 짝. 탭이 늘어나도 여기만 추가하면 된다.
const ADMIN_TABS = {
    visitor:  { btn: 'menuVisitor',  panel: 'tabContentVisitor' },
    employee: { btn: 'menuEmployee', panel: 'tabContentEmployee' },
    pass:     { btn: 'menuPass',     panel: 'tabContentPass' },
};

function switchTab(tabType) {
    if (!ADMIN_TABS[tabType]) return;

    Object.entries(ADMIN_TABS).forEach(([key, ids]) => {
        const btn = document.getElementById(ids.btn);
        const panel = document.getElementById(ids.panel);
        if (btn) btn.classList.toggle('active', key === tabType);
        if (panel) panel.classList.toggle('section-hidden', key !== tabType);
    });

    // 엑셀 일괄 등록 박스는 임직원 탭에서만 노출
    const excelBox = document.getElementById('sidebarExcelBox');
    if (excelBox) excelBox.classList.toggle('excel-sidebar-active', tabType === 'employee');

    if (tabType === 'visitor') {
        loadAdminLogs();
    } else if (tabType === 'employee') {
        // 🌳 임직원 관리는 부서 트리 화면(/emp-tree)을 iframe 으로 사용한다.
        //    탭을 처음 열 때만 로드하고, 이후에는 그 안에서 자체 갱신된다.
        const frame = document.getElementById('empTreeFrame');
        if (frame && !frame.src) frame.src = '/emp-tree';
    } else if (tabType === 'pass') {
        loadPasses();
    }

    const sidebar = document.getElementById('erpSidebar');
    if (sidebar && sidebar.classList.contains('open')) {
        toggleMobileSidebar();
    }
}

function toggleMobileSidebar() {
    const sidebar = document.getElementById('erpSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!sidebar || !overlay) return;

    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
}


// ====================================================================
// 🎫 정기 이용 방문객(정기권) 관리
//   - 정기권은 '출입증'이고, 실제 방문 기록은 QR 을 스캔할 때마다 출입 기록에 쌓인다.
//     → 이 화면은 출입증의 발급·유효기간·사용 조건만 관리한다.
//   - 승인 방식(auto_approve)은 정책값이라 발급 후에도 언제든 바꿀 수 있다.
// ====================================================================
let passRegionFilter = '';     // '' = 전 사업장
let passSearchTimer = null;
let passListCache = [];
let editingPassId = null;      // null = 신규 발급 모드

function renderPassRegionButtons() {
    const box = document.getElementById('passRegionFilterBtns');
    if (!box || typeof window.regionFilterButtonsHtml !== 'function') return;
    let myRegion = '';
    try {
        const emp = JSON.parse(sessionStorage.getItem('emp_session'));
        myRegion = emp ? (emp.region || '') : '';
    } catch (e) {}
    box.innerHTML = window.regionFilterButtonsHtml(myRegion, 'setPassRegion');
}

function setPassRegion(btn) {
    passRegionFilter = btn.dataset.region || '';
    document.querySelectorAll('#passRegionFilterBtns .region-filter-btn')
        .forEach(b => b.classList.toggle('active', b === btn));
    loadPasses();
}

// 검색은 타이핑마다 조회하지 않고 잠깐 멈춘 뒤 1회만 (표가 깜빡이는 것 방지)
function onPassSearchInput() {
    clearTimeout(passSearchTimer);
    passSearchTimer = setTimeout(loadPasses, 300);
}

async function loadPasses() {
    const tbody = document.getElementById('passBody');
    if (!tbody) return;

    const status = (document.getElementById('passStatusFilter') || {}).value || '';
    const q = (document.getElementById('passSearch') || {}).value || '';
    const params = new URLSearchParams();
    if (passRegionFilter) params.set('region', passRegionFilter);
    if (status) params.set('status', status);
    if (q.trim()) params.set('q', q.trim());

    const fail = (msg) => {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">${msg}</td></tr>`;
    };
    tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">불러오는 중입니다...</td></tr>`;

    // ① 통신 단계 — 서버에 닿지 못했거나 응답이 JSON 이 아닌 경우
    let data;
    try {
        const res = await fetch(`/api/pass/list?${params.toString()}`);
        data = await res.json();
    } catch (e) {
        console.error('[이용권] 목록 조회 통신 실패', e);
        return fail('서버와 통신하지 못했습니다.');
    }
    if (!data.success) return fail(data.message || '조회에 실패했습니다.');

    // ② 표시 단계 — 여기서 나는 오류는 화면 코드 문제다. 통신 오류로 뭉뚱그리지 않는다.
    try {
        passListCache = data.list || [];
        if (data.periods) window.PASS_PERIODS = data.periods;                       // 서버 운영 단위 반영
        if (data.default_period) window.PASS_DEFAULT_PERIOD = data.default_period;
        renderPassTable(data.today);
    } catch (e) {
        console.error('[이용권] 목록 표시 중 오류', e);
        fail(`목록을 표시하는 중 오류가 발생했습니다. (${e.message})`);
    }
}

// 'YYYY-MM-DD' 두 날짜의 일수 차 (b - a). 만료 임박 판정용.
function daysBetween(a, b) {
    const d1 = new Date(`${a}T00:00:00`);
    const d2 = new Date(`${b}T00:00:00`);
    return Math.round((d2 - d1) / 86400000);
}

// 요일 표기는 화면마다 같아야 하므로 공용 함수(visitor-history.js)의 window.passWeekdayText 를 직접 쓴다.
//   ⚠️ 여기서 같은 이름의 전역 함수를 만들면 window.passWeekdayText 를 덮어써 자기 자신을 호출한다(무한 재귀).

function passStatusBadge(status) {
    const cls = { '신청': 'badge-pending', '활성': 'badge-lv2', '정지': 'badge-lv3',
                  '만료': 'badge-lv1', '해지': 'badge-lv1', '반려': 'badge-lv3' }[status] || 'badge-lv1';
    return `<span class="badge ${cls}">${status}</span>`;
}

function renderPassTable(today) {
    const tbody = document.getElementById('passBody');
    if (!tbody) return;

    if (!passListCache.length) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">등록된 출입 이용권이 없습니다. 우측 상단 '이용권 발급'으로 추가하세요.</td></tr>`;
    } else {
        tbody.innerHTML = passListCache.map(p => {
            const left = daysBetween(today, p.valid_to);      // 남은 일수 (음수 = 이미 지남)
            const expiring = p.status === '활성' && left >= 0 && left <= 30;
            const validHtml = `${p.valid_from} ~ ${p.valid_to}` +
                (p.period ? `<div class="pass-sub">${p.period}</div>` : '') +
                (p.status === '활성'
                    ? `<div class="pass-sub${expiring ? ' pass-sub-warn' : ''}">${left < 0 ? '기간 종료' : `D-${left}`}</div>`
                    : '');
            const approve = p.auto_approve
                ? `<span class="badge badge-lv2">자동</span>`
                : `<span class="badge badge-lv5">승인</span>`;
            const isRequest = p.status === '신청';
            const canToggle = p.status === '활성' || p.status === '정지';
            const toggleBtn = canToggle
                ? `<button class="btn btn-secondary btn-action-sm" onclick="setPassStatus(${p.id}, '${p.status === '활성' ? '정지' : '활성'}')">${p.status === '활성' ? '정지' : '활성화'}</button>`
                : '';
            const revokeBtn = (p.status !== '해지')
                ? `<button class="btn btn-secondary btn-action-sm" onclick="setPassStatus(${p.id}, '해지')">해지</button>`
                : '';

            const reqMark = isRequest && p.requested_at
                ? `<div class="pass-sub">🙋 ${p.requested_at.slice(0, 16)} 신청</div>` : '';

            return `
            <tr class="${isRequest ? 'pass-row-request' : ''}">
                <td data-label="방문객"><b>${p.name}</b><div class="pass-sub">${p.company || '-'}</div>${reqMark}</td>
                <td data-label="연락처">${window.formatPhone ? window.formatPhone(p.contact) : (p.contact || '-')}
                    <div class="pass-sub">🚗 ${p.vehicle_no || '없음'}</div></td>
                <td data-label="이용 목적">${p.purpose || '-'}</td>
                <td data-label="사업장">${p.region || '-'}</td>
                <td data-label="유효기간">${validHtml}</td>
                <td data-label="이용 요일">${window.passWeekdayText(p.weekdays)}</td>
                <td data-label="승인 방식">${approve}</td>
                <td data-label="상태">${passStatusBadge(p.status)}</td>
                <td data-label="출입">${p.today_visits || 0} / ${p.total_visits || 0}
                    <div class="pass-sub">${p.last_visit ? `최근 ${p.last_visit}` : '방문 없음'}</div></td>
                <td data-label="관리" class="pass-actions">
                    ${isRequest
                        ? `<button class="btn btn-primary btn-action-sm" onclick="openPassModal(${p.id})">검토·승인</button>
                           <button class="btn btn-danger btn-action-sm" onclick="rejectPass(${p.id})">반려</button>`
                        : `<button class="btn btn-primary btn-action-sm" onclick="showPassQr(${p.id})">QR</button>
                           <button class="btn btn-secondary btn-action-sm" onclick="openPassModal(${p.id})">수정</button>
                           ${toggleBtn}${revokeBtn}
                           <button class="btn btn-danger btn-action-sm" onclick="deletePass(${p.id})">삭제</button>`}
                </td>
            </tr>`;
        }).join('');
    }

    // 상단 요약: 승인 방식별 활성 수 / 오늘 출입 / 정리 대상(만료 임박)
    const active = passListCache.filter(p => p.status === '활성');
    const todayVisits = passListCache.reduce((sum, p) => sum + (p.today_visits || 0), 0);
    const expiringSoon = active.filter(p => {
        const left = daysBetween(today, p.valid_to);
        return left >= 0 && left <= 30;
    });
    const attention = new Set(expiringSoon.map(p => p.id));
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    // 승인 방식별(활성 기준): 자동 승인은 스캔 즉시 확정되므로 몇 장이나 열려 있는지 따로 본다.
    set('passStatAuto', active.filter(p => p.auto_approve).length);
    set('passStatManual', active.filter(p => !p.auto_approve).length);
    set('passStatPending', passListCache.filter(p => p.status === '신청').length);
    set('passStatActive', active.length);
    set('passStatToday', todayVisits);
    set('passStatAttention', attention.size);
}

// ── 발급 / 수정 모달 ──────────────────────────────────────────────
function openPassModal(passId) {
    const modal = document.getElementById('passModal');
    if (!modal) return;
    editingPassId = (passId === undefined || passId === null) ? null : passId;

    const val = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const setDays = (weekdays) => {
        document.querySelectorAll('#passWeekdayBox input[type="checkbox"]').forEach(cb => {
            cb.checked = weekdays[parseInt(cb.dataset.day, 10)] === '1';
        });
    };

    if (editingPassId === null) {
        // 신규: 오늘부터 기본 단위(보통 1개월). 종료일은 syncPassDateLimit() 이 계산한다.
        const today = getKstThisWeekRange().todayKst;
        document.getElementById('passModalTitle').textContent = '출입 이용권 발급';
        const saveBtnNew = document.getElementById('passSaveBtn');
        if (saveBtnNew) saveBtnNew.textContent = '저장하기';
        ['passName', 'passContact', 'passCompany', 'passVehicle', 'passPurpose', 'passMemo']
            .forEach(id => val(id, ''));
        val('passValidFrom', today);
        val('passPeriod', window.PASS_DEFAULT_PERIOD || '1개월');
        val('passAutoApprove', '0');   // 기본은 경비실 승인 — 자동승인은 개별로만 켠다
        setDays('1111100');
        // 발급자 본인 거점을 기본 선택
        try {
            const emp = JSON.parse(sessionStorage.getItem('emp_session'));
            if (emp && emp.region) val('passRegion', emp.region);
        } catch (e) {}
    } else {
        const p = passListCache.find(x => x.id === editingPassId);
        if (!p) return;
        const isReq = p.status === '신청';
        document.getElementById('passModalTitle').textContent = isReq
            ? `🙋 발급 신청 검토 — ${p.name} (${p.company})`
            : `이용권 수정 — ${p.name} (${p.company})`;
        const saveBtn = document.getElementById('passSaveBtn');
        if (saveBtn) saveBtn.textContent = isReq ? '승인하고 발급' : '저장하기';
        val('passName', p.name); val('passContact', p.contact); val('passCompany', p.company);
        val('passVehicle', p.vehicle_no === '없음' ? '' : (p.vehicle_no || ''));
        val('passPurpose', p.purpose);
        val('passRegion', p.region); val('passValidFrom', p.valid_from);
        val('passPeriod', p.period || window.passPeriodOf(p.valid_from, p.valid_to));
        val('passAutoApprove', String(p.auto_approve ? 1 : 0));
        val('passMemo', p.memo || '');
        setDays(p.weekdays || '1111111');
    }
    syncPassDateLimit();      // 종료일 달력을 '시작일 + 기본 기간' 까지로 제한
    modal.classList.add('modal-active');
}

// 종료일 = 시작일 + 선택한 이용 단위 (시작일·단위를 바꿀 때마다 호출)
function syncPassDateLimit() {
    window.syncPassPeriod(document.getElementById('passValidFrom'),
                          document.getElementById('passPeriod'),
                          document.getElementById('passValidTo'));
}

function closePassModal() {
    const modal = document.getElementById('passModal');
    if (modal) modal.classList.remove('modal-active');
    editingPassId = null;
}

async function savePass() {
    const get = (id) => (document.getElementById(id) || {}).value || '';
    let weekdays = '';
    document.querySelectorAll('#passWeekdayBox input[type="checkbox"]').forEach(cb => {
        weekdays += cb.checked ? '1' : '0';
    });
    if (!weekdays.includes('1')) {
        alert('이용 요일을 최소 하나는 선택해 주세요.');
        return;
    }

    const payload = {
        name: get('passName').trim(),
        contact: get('passContact').replace(/\D/g, ''),   // 저장은 숫자만 (표시할 때 formatPhone 이 하이픈 처리)
        company: get('passCompany').trim(),
        vehicle_no: get('passVehicle').trim(),
        purpose: get('passPurpose').trim(),
        region: get('passRegion'),
        valid_from: get('passValidFrom'),
        period: get('passPeriod'),        // 종료일은 서버가 '시작일 + 단위'로 계산한다
        auto_approve: get('passAutoApprove'),
        weekdays: weekdays,
        memo: get('passMemo').trim(),
    };

    const isNew = (editingPassId === null);
    const target = isNew ? null : passListCache.find(x => x.id === editingPassId);
    // 승인 대기 건을 저장하면 '승인 발급'이다. (기간·요일을 화면 값으로 확정한다)
    const isApprove = !!target && target.status === '신청';
    if (isApprove && !confirm(`${target.name} 님의 이용권을 발급합니다.\n유효기간: ${payload.valid_from} ~ ${get('passValidTo')} (${payload.period})\n\n승인할까요?`)) return;

    const url = isNew ? '/api/pass' : (isApprove ? `/api/pass/${editingPassId}/approve` : `/api/pass/${editingPassId}`);
    const res = await fetch(url, {
        method: (isNew || isApprove) ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) {
        alert(data.message || '저장에 실패했습니다.');
        return;
    }

    alert(data.message);

    const newId = isNew ? data.id : editingPassId;
    closePassModal();
    await loadPasses();
    if ((isNew || isApprove) && newId) showPassQr(newId);   // 발급 직후 바로 QR 출력 화면
}

async function rejectPass(passId) {
    const p = passListCache.find(x => x.id === passId);
    const reason = prompt(`${p ? p.name + ' 님의 ' : ''}발급 신청을 반려합니다.\n사유를 입력하세요 (손님 조회 화면에 표시됩니다).`, '');
    if (reason === null) return;      // 취소
    const res = await fetch(`/api/pass/${passId}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
    });
    const data = await res.json();
    alert(data.message || (data.success ? '반려 처리했습니다.' : '처리에 실패했습니다.'));
    if (data.success) loadPasses();
}

async function setPassStatus(passId, status) {
    const p = passListCache.find(x => x.id === passId);
    const label = p ? `'${p.name}(${p.company})' ` : '';
    const confirmMsg = status === '해지'
        ? `${label}출입 이용권을 해지합니다.\n해지하면 QR이 즉시 사용 불가가 됩니다. 계속할까요?`
        : `${label}출입 이용권을 ${status} 처리할까요?`;
    if (!confirm(confirmMsg)) return;

    const res = await fetch(`/api/pass/${passId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
    });
    const data = await res.json();
    alert(data.message || (data.success ? '처리되었습니다.' : '처리에 실패했습니다.'));
    if (data.success) loadPasses();
}

async function deletePass(passId) {
    const p = passListCache.find(x => x.id === passId);
    const label = p ? `'${p.name}(${p.company})'` : '이 이용권';
    if (!confirm(`${label} 이용권을 완전히 삭제합니다.\n\n· 발급 이력을 남기려면 '해지'를 사용하세요.\n· 이미 쌓인 출입 기록은 삭제되지 않습니다.\n\n삭제할까요?`)) return;

    const res = await fetch(`/api/pass/${passId}`, { method: 'DELETE' });
    const data = await res.json();
    alert(data.message || (data.success ? '삭제되었습니다.' : '삭제에 실패했습니다.'));
    if (data.success) loadPasses();
}

// ── QR 출입증 (화면 표시 + 인쇄) ──────────────────────────────────
let qrViewPassId = null;      // 현재 QR 창에 띄운 이용권 id (이미지 저장에 사용)

function showPassQr(passId) {
    const p = passListCache.find(x => x.id === passId);
    if (!p) return;
    qrViewPassId = passId;
    const card = document.getElementById('passQrCard');
    const modal = document.getElementById('passQrModal');
    if (!card || !modal) return;

    card.innerHTML = `
        <div class="pass-card-title">출입권 · ${p.region}</div>
        <img class="pass-card-qr" src="/api/qr?token=${encodeURIComponent(p.token)}" alt="출입 이용권 QR">
        <div class="pass-card-name">${p.name}</div>
        <div class="pass-card-company">${p.company}</div>
        <div class="pass-card-meta">
            <span>유효기간</span><b>${p.valid_from} ~ ${p.valid_to}</b>
            <span>이용 요일</span><b>${window.passWeekdayText(p.weekdays)}</b>
            <span>차량 번호</span><b>${p.vehicle_no || '없음'}</b>
        </div>`;
    modal.classList.add('modal-active');
    // 저장 버튼이 즉시 반응하도록 카드 이미지를 미리 만들어 둔다.
    window.preparePassCardImage(p, window.passWeekdayText(p.weekdays));
}

function closePassQr() {
    const modal = document.getElementById('passQrModal');
    if (modal) modal.classList.remove('modal-active');
}

// QR 이미지 저장: 화면의 카드 그대로(QR + 이름·소속·유효기간·요일·차량) PNG 로 내려받는다.
//   생성기는 visitor-history.js 의 공용 함수 (경비실 화면과 동일한 결과물).
function downloadPassQr() {
    const p = passListCache.find(x => x.id === qrViewPassId);
    if (!p) return;
    window.downloadPassCardPng(p, window.passWeekdayText(p.weekdays));
}
