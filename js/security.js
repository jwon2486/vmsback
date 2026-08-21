/**
 * js/security.js
 * 보안실 출입 관제 및 대면 승인 처리 (인라인 CSS 완벽 제거)
 */

// 'YYYY-MM-DD HH:MM:SS' → 'HH:MM:SS' 만 반환.
//  - 표에는 이미 '방문일' 컬럼이 있어 날짜가 중복되므로 입·퇴실 셀은 시간만 표시한다.
//  - 값이 없거나 예상 형식이 아니면 안전하게 원본(또는 '-')을 그대로 반환.
function secTimeOnly(val) {
    if (!val) return '-';
    const parts = String(val).trim().split(' ');
    return parts.length > 1 ? parts[parts.length - 1] : val;
}

function showSecurityDashboard() {
    const emp = JSON.parse(sessionStorage.getItem('emp_session'));
    const empRegion = emp.region || '테크센터'; 
    const weekRange = getKstThisWeekRange();

    const container = document.querySelector('.container');
    if (container) container.classList.add('container-wide', 'container-security-wide');

    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    
    appCard.classList.remove('card-guest-wide');
    appCard.classList.add('card-wide', 'card-security-wide');
    
    appCard.innerHTML = `
    <div class="sec-erp-layout">
        <aside class="sec-erp-sidebar">
            <div class="sec-erp-brand">
                <span class="sec-erp-brand-icon">🛡️</span>
                <div class="sec-erp-brand-text">
                    <strong>보안실 관제</strong>
                    <span class="sec-region-text">${empRegion}</span>
                </div>
            </div>
            <nav class="sec-erp-nav">
                <button id="secMenuQueue" class="sec-nav-item active" onclick="switchSecTab('queue')">
                    <span>🚨 승인 요청</span>
                    <span id="secQueueCount" class="sec-nav-badge display-none">0</span>
                </button>
                <button id="secMenuLogs" class="sec-nav-item" onclick="switchSecTab('logs')">
                    <span>📊 출입 기록</span>
                </button>
                <button id="secMenuOverdue" class="sec-nav-item" onclick="switchSecTab('overdue')">
                    <span>⏰ 퇴실 지연</span>
                    <span id="secOverdueCount" class="sec-nav-badge sec-nav-badge-warn display-none">0</span>
                </button>
                <button id="secMenuPass" class="sec-nav-item" onclick="switchSecTab('pass')">
                    <span>🎫 출입 이용권</span>
                    <span id="secPassCount" class="sec-nav-badge display-none">0</span>
                </button>
            </nav>
            <div class="sec-erp-sidebar-action">
                <!-- 방문객 수동 예약: 요청에 의해 비활성화 (되살리려면 아래 버튼 주석 해제)
                <button onclick="toggleSecRegForm()" class="btn-list-action bg-blue btn-sec-action w-100">➕ 방문객 수동 예약</button>
                -->
            </div>
        </aside>

        <section class="sec-erp-content">
            <div class="sec-scan-bar">
                <span class="sec-scan-icon">📷</span>
                <!-- inputmode="none": 화상 키패드를 띄우지 않는다.
                     이 칸은 항상 포커스를 유지해야 리더기 스캔을 받을 수 있는데(secKeepScanFocus),
                     태블릿에서는 재실중·승인 대기 같은 빈 영역만 눌러도 포커스가 여기로 와서
                     키패드가 계속 떠버렸다. 리더기·물리 키보드 입력은 그대로 받는다. -->
                <input id="secScanInput" class="sec-scan-input" autocomplete="off" inputmode="none"
                       placeholder="QR 스캔 대기 — 리더기로 방문객 QR을 스캔하세요 (수동 입력 후 Enter 도 가능)">
                <span id="secScanResult" class="sec-scan-result"></span>
            </div>
            <!-- 요약 카드 = 해당 탭 바로가기. button 으로 두어 키보드 포커스·엔터도 동작한다. -->
            <div class="sec-stat-grid">
                <button type="button" class="sec-stat-card stat-pending" onclick="switchSecTab('queue')" title="승인 요청 탭으로 이동">
                    <span class="sec-stat-label">🚨 승인 대기</span>
                    <span class="sec-stat-value" id="secStatPending">-</span>
                </button>
                <button type="button" class="sec-stat-card stat-onsite" onclick="switchSecTab('logs')" title="출입 기록 탭으로 이동">
                    <span class="sec-stat-label">🏢 현재 재실중</span>
                    <span class="sec-stat-value" id="secStatOnsite">-</span>
                </button>
                <button type="button" class="sec-stat-card stat-overdue" onclick="switchSecTab('overdue')" title="퇴실 지연 탭으로 이동">
                    <span class="sec-stat-label">⏰ 퇴실 지연</span>
                    <span class="sec-stat-value" id="secStatOverdue">-</span>
                </button>
            </div>

            <div id="secRegFormZone" class="display-none form-container sec-reg-form">
                <h3 class="fs-10 my-title-color mb-15">📝 경비실 방문객 수동 예약</h3>
                <div class="input-row-group">
                    <div class="input-group"><label>방문 일자 <span class="req-star">*</span></label><input type="date" id="secRegDate" value="${weekRange.todayKst}"></div>
                    <div class="input-group"><label>방문객 이름 <span class="req-star">*</span></label><input type="text" id="secRegName" placeholder="성함 입력" autocomplete="off"></div>
                    <div class="input-group"><label>연락처 <span class="req-star">*</span></label>${phoneInputHtml('secRegContact')}</div>
                </div>
                <div class="input-row-group">
                    <div class="input-group"><label>소속 회사명 <span class="req-star">*</span></label><input type="text" id="secRegCompany" placeholder="소속 회사" autocomplete="off"></div>
                    <div class="input-group"><label>차량 번호</label><input type="text" id="secRegVehicle" placeholder="없을 시 비워둠" autocomplete="off"></div>
                    <div class="input-group"><label>사내 담당자 성명 <span class="req-star">*</span></label><input type="text" id="secRegManager" placeholder="만날 직원 성명" autocomplete="off"></div>
                </div>
                <div class="input-group mb-15">
                    <label>방문 목적 <span class="req-star">*</span></label>
                    <select id="secRegPurpose">
                        <option value="회의/미팅">🤝 회의/미팅</option>
                        <option value="제품 납품">📦 제품 납품</option>
                        <option value="상차/하차">🚚 상차/하차</option>
                        <option value="품질 검사">🔍 품질 검사</option>
                        <option value="시설 점검">🛠️ 시설 점검</option>
                        <option value="기타 업무">📁 기타 업무</option>
                    </select>
                </div>
                <div class="sec-reg-actions">
                    <button onclick="submitSecReg()" class="btn-list-action bg-green btn-sec-action">예약 등록 완료</button>
                    <button onclick="toggleSecRegForm()" class="btn-cancel-outline btn-sec-action">취소 (닫기)</button>
                </div>
            </div>

            <div id="secPanelQueue" class="sec-tab-panel active">
                <div class="sec-live-header">
                    <h3 class="sec-live-title">🚨 실시간 승인 대기열</h3>
                    <span class="sec-live-indicator">
                        <span class="spinner sec-spinner"></span> 자동 새로고침 중
                    </span>
                </div>
                <div class="table-responsive sec-table-container h-500">
                    <table class="modern-table w-100 min-w-700">
                        <thead class="sec-table-head">
                            <tr>
                                <th class="p-10">방문자 (소속)</th>
                                <th class="p-10">차량 번호</th>
                                <th class="p-10">연락처</th>
                                <th class="p-10">담당자</th>
                                <th class="p-10">승인 상태</th>
                            </tr>
                        </thead>
                        <tbody id="securityQueueBody">
                            <tr><td colspan="5" class="no-data-box">대기열을 불러오는 중입니다...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div id="secPanelLogs" class="sec-tab-panel">
                <div class="sec-logs-header">
                    <h3 class="sec-logs-title">📊 전체 출입 기록</h3>
                    <div class="date-range-picker-box flex-center-gap">
                        <input type="date" id="secLogStartDate" value="${weekRange.todayKst}" onchange="loadSecurityAllLogs()" class="sec-date-input">
                        <span class="range-tilde">~</span>
                        <input type="date" id="secLogEndDate" value="${weekRange.todayKst}" onchange="loadSecurityAllLogs()" class="sec-date-input">
                    </div>
                </div>
                <!-- 🗺️ 기록 조회는 관리자(3)·전체기록 열람(5)과 동일하게 전 사업장 + 거점 선택.
                     단 '퇴실 처리' 버튼은 자기 소속 센터(${empRegion}) 건에만 노출된다. -->
                <div class="region-filter-bar" id="secRegionFilterBar">
                    <span class="filter-label">🗺️ 사업장:</span>
                    <!-- 순서: '전 사업장' → 본인 소속 센터 → 나머지 (visitor-history.js 공용 헬퍼) -->
                    <div class="region-filter-btns">${regionFilterButtonsHtml(empRegion, 'setSecRegion')}</div>
                </div>
                <div class="table-responsive sec-table-container h-500">
                    <table class="modern-table w-100 min-w-900">
                        <thead class="sec-table-head">
                            <tr>
                                <th class="p-10">순번</th>
                                <th class="p-10">방문일</th>
                                <th class="p-10">이름</th>
                                <th class="p-10">연락처</th>
                                <th class="p-10">방문 횟수</th>
                                <th class="p-10">소속</th>
                                <th class="p-10">방문 목적</th>
                                <th class="p-10">담당자</th>
                                <th class="p-10 col-split-time">입실 시간</th>
                                <th class="p-10 col-split-time">퇴실 시간</th>
                                <th class="p-10 col-merged-time">입·퇴실</th>
                                <th class="p-10">상태</th>
                            </tr>
                        </thead>
                        <tbody id="secAllLogsBody">
                            <tr><td colspan="12" class="no-data-box">전체 기록을 불러오는 중입니다...</td></tr>
                        </tbody>
                    </table>
                </div>
                <div class="pagination-container" id="secLogPagination"></div>
            </div>

            <div id="secPanelOverdue" class="sec-tab-panel">
                <div class="sec-logs-header">
                    <h3 class="sec-logs-title">⏰ 퇴실 지연자 <span class="sec-region-text">(${empRegion})</span></h3>
                    <div class="date-range-picker-box flex-center-gap">
                        <input type="date" id="secOverdueStartDate" value="${weekRange.todayKst}" onchange="loadSecurityOverdue()" class="sec-date-input">
                        <span class="range-tilde">~</span>
                        <input type="date" id="secOverdueEndDate" value="${weekRange.todayKst}" onchange="loadSecurityOverdue()" class="sec-date-input">
                    </div>
                </div>
                <div class="table-responsive sec-table-container h-500">
                    <table class="modern-table w-100 min-w-900">
                        <thead class="sec-table-head">
                            <tr>
                                <th class="p-10">방문일</th>
                                <th class="p-10">이름 (소속)</th>
                                <th class="p-10">연락처</th>
                                <th class="p-10">차량 번호</th>
                                <th class="p-10">담당자</th>
                                <th class="p-10">입실 시간</th>
                                <th class="p-10">퇴실 예정</th>
                                <th class="p-10">지연 시간</th>
                                <th class="p-10">퇴실 처리</th>
                            </tr>
                        </thead>
                        <tbody id="secOverdueBody">
                            <tr><td colspan="9" class="no-data-box">퇴실 지연자를 조회하는 중입니다...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 🎫 정기 이용 방문객: 상시 출입증 발급·관리 + 오늘 출입 현황.
                 발급 권한은 자기 거점(${empRegion})으로 한정된다(서버가 세션 거점으로 강제). -->
            <div id="secPanelPass" class="sec-tab-panel">
                <div class="sec-logs-header">
                    <h3 class="sec-logs-title">🎫 출입 이용권 <span class="sec-region-text">(${empRegion})</span></h3>
                    <button onclick="toggleSecPassForm()" class="btn-list-action bg-blue btn-sec-action">➕ 이용권 발급</button>
                </div>
                <div id="secPassFormZone" class="display-none form-container sec-reg-form">
                    <h3 class="fs-10 my-title-color mb-15">📝 출입 이용권 발급 <span class="sec-region-text">(${empRegion})</span></h3>
                    <div class="input-group mb-15">
                        <label>이용권 종류 <span class="req-star">*</span></label>
                        <select id="secPassType" onchange="onSecPassTypeChange()">
                            <option value="정기">정기 이용권 — 매일 출입 (청소·급식·상주 용역)</option>
                            <option value="수시">수시 출입권 — 매일은 아니지만 반복 방문 (정기 점검·비정기 납품)</option>
                        </select>
                    </div>
                    <div class="input-row-group">
                        <div class="input-group"><label>방문객 성명 <span class="req-star">*</span></label><input type="text" id="secPassName" placeholder="성함 입력" autocomplete="off"></div>
                        <div class="input-group"><label>연락처 <span class="req-star">*</span></label>${phoneInputHtml('secPassContact')}</div>
                        <div class="input-group"><label>소속 업체 <span class="req-star">*</span></label><input type="text" id="secPassCompany" placeholder="예: OO물류" autocomplete="off"></div>
                    </div>
                    <div class="input-row-group">
                        <div class="input-group"><label>차량 번호</label><input type="text" id="secPassVehicle" placeholder="없을 시 비워둠" autocomplete="off"></div>
                        <div class="input-group"><label>이용 목적 <span class="req-star">*</span></label><input type="text" id="secPassPurpose" placeholder="예: 제품 납품" autocomplete="off"></div>
                    </div>
                    <div class="input-row-group">
                        <div class="input-group"><label>유효 시작일 <span class="req-star">*</span></label><input type="date" id="secPassFrom" value="${weekRange.todayKst}" onchange="syncSecPassDateLimit()"></div>
                        <div class="input-group"><label>이용 기간 <span class="req-star">*</span></label>
                            <!-- 운영 단위는 1일·1주일·1개월. 종료일은 시작일+단위로 자동 계산된다. -->
                            <select id="secPassPeriod" onchange="syncSecPassDateLimit()">
                                <option value="1일">1일</option>
                                <option value="1주일">1주일</option>
                                <option value="1개월" selected>1개월</option>
                            </select>
                        </div>
                        <div class="input-group"><label>유효 종료일 <span class="sec-auto-hint">(자동)</span></label><input type="date" id="secPassTo" readonly></div>
                        <div class="input-group"><label>승인 방식</label>
                            <select id="secPassAuto">
                                <option value="0">경비실 승인 (기본 — 대기열 전달)</option>
                                <option value="1">자동 승인 (스캔 즉시 처리)</option>
                            </select>
                        </div>
                    </div>
                    <div class="input-group mb-15">
                        <label>이용 요일 (체크한 요일만 출입 가능)</label>
                        <div class="sec-pass-weekday-box" id="secPassWeekdayBox">
                            <label class="sec-pass-weekday"><input type="checkbox" data-day="0" checked><span>월</span></label>
                            <label class="sec-pass-weekday"><input type="checkbox" data-day="1" checked><span>화</span></label>
                            <label class="sec-pass-weekday"><input type="checkbox" data-day="2" checked><span>수</span></label>
                            <label class="sec-pass-weekday"><input type="checkbox" data-day="3" checked><span>목</span></label>
                            <label class="sec-pass-weekday"><input type="checkbox" data-day="4" checked><span>금</span></label>
                            <label class="sec-pass-weekday"><input type="checkbox" data-day="5"><span>토</span></label>
                            <label class="sec-pass-weekday"><input type="checkbox" data-day="6"><span>일</span></label>
                        </div>
                    </div>
                    <div class="sec-reg-actions">
                        <button onclick="submitSecPass()" class="btn-list-action bg-green btn-sec-action">발급 완료</button>
                        <button onclick="toggleSecPassForm()" class="btn-cancel-outline btn-sec-action">취소 (닫기)</button>
                    </div>
                </div>

                <!-- 🙋 손님이 낸 발급 신청. 승인해야 이용권이 발급된다(그 전에는 스캔해도 출입 불가). -->
                <div id="secPassReqZone" class="display-none">
                    <h4 class="sec-pass-subtitle">🙋 발급 신청 <span id="secPassReqCount" class="sec-pass-summary"></span></h4>
                    <div class="table-responsive sec-table-container">
                        <table class="modern-table w-100 min-w-900">
                            <thead class="sec-table-head">
                                <tr>
                                    <th class="p-10">신청자 (소속)</th>
                                    <th class="p-10">연락처 / 차량</th>
                                    <th class="p-10">이용 목적</th>
                                    <th class="p-10">희망 종류</th>
                                    <th class="p-10">유효기간 확정</th>
                                    <th class="p-10">처리</th>
                                </tr>
                            </thead>
                            <tbody id="secPassReqBody"></tbody>
                        </table>
                    </div>
                </div>

                <h4 class="sec-pass-subtitle">🚶 오늘 출입 현황 <span id="secPassTodaySummary" class="sec-pass-summary"></span></h4>
                <div class="table-responsive sec-table-container">
                    <table class="modern-table w-100 min-w-700">
                        <thead class="sec-table-head">
                            <tr>
                                <th class="p-10">방문자 (소속)</th>
                                <th class="p-10">차량 번호</th>
                                <th class="p-10">입실</th>
                                <th class="p-10">퇴실</th>
                                <th class="p-10">상태</th>
                            </tr>
                        </thead>
                        <tbody id="secPassTodayBody">
                            <tr><td colspan="5" class="no-data-box">불러오는 중입니다...</td></tr>
                        </tbody>
                    </table>
                </div>

                <h4 class="sec-pass-subtitle">🎫 발급된 이용권 <span id="secPassIssuedSummary" class="sec-pass-summary"></span></h4>
                <div class="table-responsive sec-table-container h-500">
                    <table class="modern-table w-100 min-w-900">
                        <thead class="sec-table-head">
                            <tr>
                                <th class="p-10">종류</th>
                                <th class="p-10">방문객 (소속)</th>
                                <th class="p-10">연락처 / 차량</th>
                                <th class="p-10">이용 목적</th>
                                <th class="p-10">유효기간</th>
                                <th class="p-10">요일</th>
                                <th class="p-10">승인</th>
                                <th class="p-10">상태</th>
                                <th class="p-10">관리</th>
                            </tr>
                        </thead>
                        <tbody id="secPassListBody">
                            <tr><td colspan="9" class="no-data-box">불러오는 중입니다...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    </div>
    `;
    
    fetchSecurityQueue();
    loadSecurityAllLogs();
    loadSecurityOverdue();
    loadSecPassData();      // 🎫 정기권 목록 + 오늘 출입 현황 (사이드바 배지 포함)
    initSecScan();

    if (securityRefreshTimer) clearInterval(securityRefreshTimer);
    securityRefreshTimer = setInterval(() => {
        fetchSecurityQueue(true);
        loadSecurityAllLogs(true);
        loadSecurityOverdue(true);
    }, 10000);
}

// 📷 대시보드 내장 스캔 입력: 하드웨어 리더기 입력을 받아 /api/scan 처리 (별도 페이지 불필요)
function secKeepScanFocus() {
    const el = document.getElementById('secScanInput');
    if (el) el.focus({ preventScroll: true });   // 숨은 입력이라 포커스 시 스크롤 튐 방지
}

function initSecScan() {
    const el = document.getElementById('secScanInput');
    if (!el) return;
    setTimeout(secKeepScanFocus, 150);   // 렌더 직후 자동 포커스
    el.addEventListener('keydown', (e) => {
        // 리더기 스캔은 전역 리스너가 캡처 단계에서 먼저 가로채 처리한다(한글 IME 대응).
        // 여기 남는 건 사람이 직접 타이핑한 경우뿐.
        if (e.key === 'Enter') {
            const raw = el.value.trim();
            el.value = '';
            if (raw) secSubmitScan(raw);
        }
    });
    // 빈 영역 클릭 시 스캔칸으로 포커스 복귀(입력/버튼 클릭은 방해하지 않음). 문서에 1회만 바인딩.
    if (!window.__secScanFocusBound) {
        window.__secScanFocusBound = true;
        document.addEventListener('click', (e) => {
            if (!document.getElementById('secScanInput')) return;      // 보안실 화면 아닐 때는 무시
            if (!e.target.closest('input, select, textarea, button, a')) secKeepScanFocus();
        });
    }
    // 📷 전역 스캔 캡처 설치 (포커스·한글 IME 무관). 구현은 js/scan-util.js 공용.
    if (typeof installScanCapture === 'function') {
        installScanCapture({
            key: 'security',
            isActive: () => !!document.getElementById('secScanInput'),
            getInput: () => document.getElementById('secScanInput'),
            onScan: secSubmitScan,
        });
    }
}

async function secSubmitScan(raw) {
    // 한글 입력기로 조합돼 들어온 값이면 영문으로 되돌린다. (js/scan-util.js)
    if (typeof normalizeScanValue === 'function') raw = normalizeScanValue(raw);

    try {
        const res = await fetch('/api/scan', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: raw })
        });
        const d = await res.json();
        // 스캔바가 숨겨져 있으므로: 신규 접수(성공)는 대기열 갱신으로 확인,
        //   중복/실패만 알림으로 알려 준다.
        if (!d.success || d.already) alert(d.message || '처리할 수 없습니다.');
        fetchSecurityQueue();
        loadSecurityAllLogs();
        loadSecurityOverdue();
    } catch (e) {
        alert('스캔 처리 중 통신 오류가 발생했습니다.');
    }
    secKeepScanFocus();
}

// 🗂️ 사이드바 탭 전환: 'queue' / 'logs' / 'overdue'
function switchSecTab(tab) {
    const map = {
        queue:   { panel: 'secPanelQueue',   menu: 'secMenuQueue' },
        logs:    { panel: 'secPanelLogs',    menu: 'secMenuLogs' },
        overdue: { panel: 'secPanelOverdue', menu: 'secMenuOverdue' },
        pass:    { panel: 'secPanelPass',    menu: 'secMenuPass' },
    };
    if (!map[tab]) tab = 'queue';
    Object.keys(map).forEach(key => {
        const panel = document.getElementById(map[key].panel);
        const menu = document.getElementById(map[key].menu);
        const on = (key === tab);
        if (panel) panel.classList.toggle('active', on);
        if (menu) menu.classList.toggle('active', on);
    });
    // 정기권 탭은 진입할 때 조회한다(자동 새로고침 대상이 아님 — 변경이 잦지 않다).
    if (tab === 'pass') loadSecPassData();
}

async function fetchSecurityQueue(isAuto = false) {
    try {
        const emp = JSON.parse(sessionStorage.getItem('emp_session'));
        const empRegion = emp ? (emp.region || '테크센터') : '테크센터';

        // 🔒 거점은 서버가 세션에서만 읽는다(요청 파라미터 무시). 승인 대상은 항상 자기 센터.
        const res = await fetch('/api/security/pending-logs');
        const data = await res.json();
        const tbody = document.getElementById('securityQueueBody');
        if (!tbody) return; 

        // 권한 만료·세션 변경 시 서버가 403 을 주고 list 가 없다 → 콘솔 에러 대신 안내로 끝낸다.
        if (!data.success || !Array.isArray(data.list)) {
            tbody.innerHTML = '<tr><td colspan="5" class="no-data-box">조회 권한이 만료되었습니다. 재로그인 해주세요.</td></tr>';
            if (securityRefreshTimer) clearInterval(securityRefreshTimer);
            return;
        }

        // 사이드바 배지 + 상단 요약 통계(승인 대기 = 입실/퇴실 대기 통합) 갱신
        const totalPending = data.list.length;

        const badge = document.getElementById('secQueueCount');
        if (badge) {
            badge.textContent = totalPending;
            badge.classList.toggle('display-none', totalPending === 0);
        }
        const pendingStatEl = document.getElementById('secStatPending');
        if (pendingStatEl) pendingStatEl.textContent = totalPending;
        
        if (data.list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="no-data-box">현재 [${empRegion}] 승인 대기 중인 방문객 내역이 없습니다.</td></tr>`;
            return;
        }

        const groupedLogs = {};
        data.list.forEach(v => {
            const gId = (!v.group_id || v.group_id === 'NONE') ? v.id : v.group_id;
            if (!groupedLogs[gId]) groupedLogs[gId] = [];
            groupedLogs[gId].push(v);
        });

        let html = '';
        for (const [gId, members] of Object.entries(groupedLogs)) {
            members.sort((a, b) => a.id - b.id);
            const isGroup = members.length > 1;
            const actionTarget = members[0].status === '입실대기' ? '입실완료' : '퇴실완료';
            const groupBtnClass = actionTarget === '입실완료' ? 'bg-green-dark' : 'bg-orange-dark';

            if (isGroup) {
                html += `
                    <tr class="sec-group-row">
                        <td colspan="4" class="sec-group-title">
                            👥 그룹 방문객 (총 ${members.length}명 대기중) - 그룹장: ${members[0].name}
                        </td>
                        <td class="p-10">
                            <button onclick="approveSecurityGroup('${gId}', '${actionTarget}')" class="sec-btn-approve ${groupBtnClass}">
                                ⚡ 일괄 ${actionTarget.replace('완료', '')} 승인
                            </button>
                        </td>
                    </tr>
                `;
            }

            members.forEach(v => {
                const actionTargetItem = v.status === '입실대기' ? '입실완료' : '퇴실완료';
                const btnColorClass = v.status === '입실대기' ? 'bg-green' : 'bg-orange';
                // 담당자: 매칭된 직원이면 이름/(부서), 매칭 실패면 고객 입력값/(미매칭)
                const managerName = v.emp_name || v.manager_text || '-';
                const managerDeptLine = v.emp_name
                    ? `<span class="fs-8 text-gray-light">(${v.emp_dept || '부서없음'})</span>`
                    : `<span class="fs-8 sec-match-fail">(미매칭)</span>`;

                const indentClass = isGroup ? 'sec-indent' : '';
                const bgClass = isGroup ? 'sec-item-grouped' : '';

                html += `
                    <tr class="sec-item-row ${bgClass}">
                        <td class="p-10 ${indentClass}"><b>${v.name}</b>${v.pass_id ? `<span class="sec-pass-tag">${v.pass_type || '정기'}</span>` : ''}<br><span class="text-gray-light">${v.company}</span></td>
                        <td class="p-10">${v.vehicle_no || '-'}</td>
                        <td class="p-10">${formatPhone(v.contact)}</td>
                        <td class="p-10">
                            <b>${managerName}</b><br>
                            ${managerDeptLine}
                        </td>
                        <td class="p-10">
                            <button onclick="approveSecurityAction(${v.id}, '${actionTargetItem}')" class="sec-btn-approve-item ${btnColorClass}">
                                ${actionTargetItem.replace('완료', '')} 승인
                            </button>
                        </td>
                    </tr>
                `;
            });
        }
        tbody.innerHTML = html;
    } catch (e) {
        console.error("대기열 갱신 실패", e);
    }
}

// 🗺️ 경비실 기록 조회용 거점 필터. '' = 전 사업장. (조회 전용 — 승인 권한과 무관)
let secRegionFilter = '';

// 📄 조회 결과 전체(정렬 완료)와 현재 페이지. 표는 10건씩 끊어 보여준다.
let secLogsAll = [];
let secLogPage = 1;

function setSecRegion(btn) {
    if (!btn) return;
    secRegionFilter = btn.dataset.region || '';
    const bar = document.getElementById('secRegionFilterBar');
    if (bar) bar.querySelectorAll('.region-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    loadSecurityAllLogs();
}

// 로그인 세션의 담당 거점 (퇴실 처리 버튼 노출 판정용). 서버도 동일하게 재검증한다.
function secMyRegion() {
    try {
        const emp = JSON.parse(sessionStorage.getItem('emp_session'));
        return emp ? (emp.region || '') : '';
    } catch (e) { return ''; }
}

async function loadSecurityAllLogs(isAuto = false) {
    const startDateEl = document.getElementById('secLogStartDate');
    const endDateEl = document.getElementById('secLogEndDate');
    const tbody = document.getElementById('secAllLogsBody');
    if (!tbody || !startDateEl || !endDateEl) return;

    if (!isAuto) {
        tbody.innerHTML = '<tr><td colspan="12" class="text-center-p20-gray">기록 내역을 불러오는 중입니다...</td></tr>';
    }

    try {
        const regionParam = secRegionFilter ? `&region=${encodeURIComponent(secRegionFilter)}` : '';
        const res = await fetch(`/api/admin/logs?start_date=${startDateEl.value}&end_date=${endDateEl.value}${regionParam}`);
        if (res.status === 401 || res.status === 403) {
            tbody.innerHTML = '<tr><td colspan="12" class="text-center-p20-red">조회 권한이 만료되었습니다. 재로그인 해주세요.</td></tr>';
            if (securityRefreshTimer) clearInterval(securityRefreshTimer);
            return;
        }

        const logs = await res.json();
        const myRegion = secMyRegion();   // 퇴실 처리 버튼 노출 + 재실중 집계 기준

        // 상단 요약 통계 '현재 재실중': 조회 필터와 무관하게 '자기 센터' 기준으로 집계한다.
        //  - 승인 대기·퇴실 지연 카드는 서버가 자기 센터만 반환하므로, 여기서도 같은 기준을 써야
        //    카드 3장의 의미가 일관된다. (전 사업장 필터를 걸어도 관제 지표는 내 센터)
        const onsiteEl = document.getElementById('secStatOnsite');
        if (onsiteEl) onsiteEl.textContent = logs.filter(v => v.status === '입실완료' && v.region === myRegion).length;

        // 순번: 서버가 계산한 '그 달 절대 순번'(month_seq)을 사용.
        //  - 날짜 필터와 무관하게 매달 1일부터의 절대 위치이므로, 마지막 주만 조회해도 85~100 처럼 표시됨.
        //  - 표시는 최신순(방문일→id 내림차순): 최근 방문이 맨 위.
        //  - 정렬 결과 전체를 보관하고 표에는 현재 페이지 몫만 그린다.
        secLogsAll = [...logs].sort((a, b) => {
            if (a.visit_date !== b.visit_date) return a.visit_date > b.visit_date ? -1 : 1;
            return (b.id || 0) - (a.id || 0);
        });
        // 자동 새로고침(isAuto)일 때는 보고 있던 페이지를 유지한다.
        if (!isAuto) secLogPage = 1;
        renderSecurityLogTable();
    } catch (e) {
        if (!isAuto) {
            tbody.innerHTML = '<tr><td colspan="12" class="text-center-p20-red">데이터 연동 에러가 발생했습니다.</td></tr>';
        }
    }
}

// 📄 현재 페이지 몫만 표에 렌더 + 페이지 버튼 갱신
function renderSecurityLogTable() {
    const tbody = document.getElementById('secAllLogsBody');
    if (!tbody) return;
    const myRegion = secMyRegion();

    const perPage = window.VISIT_LOG_PER_PAGE || 10;
    const totalPages = Math.max(1, Math.ceil(secLogsAll.length / perPage));
    if (secLogPage > totalPages) secLogPage = totalPages;
    const start = (secLogPage - 1) * perPage;
    const sorted = secLogsAll.slice(start, start + perPage);

    {
        let html = '';
        if (secLogsAll.length === 0) {
            html = '<tr><td colspan="12" class="text-center-p20-gray">해당 날짜에 조회된 출입 데이터가 없습니다.</td></tr>';
        } else {
            sorted.forEach(v => {
                const managerDisplay = v.emp_name
                    ? `<b>${v.emp_name}</b><br><span class="fs-8 text-gray-light">(${v.emp_dept || '부서없음'})</span>`
                    : '<span class="text-gray-lighter">-</span>';

                // 🚪 재실 중(입실완료)이면 퇴실 예정시간 전이라도 즉시 퇴실 처리할 수 있게 버튼 노출.
                //    (손님이 퇴실 신청을 깜빡하고 나가버린 경우를 경비실에서 바로 정리)
                //    별도 컬럼 없이 '상태' 셀 안, 상태값 아래에 배치한다.
                //    🔒 승인은 자기 소속 센터만 → 다른 사업장 건에는 버튼을 렌더하지 않는다.
                //       (조회는 전 사업장이지만 처리 권한은 자기 센터로 한정. 서버도 동일하게 차단한다.)
                //    퇴실이 끝났거나 대상이 아닌 상태면 버튼 영역 자체가 없다.
                //    ('퇴실대기'는 승인 대기열 탭에서 처리하므로 여기서는 노출하지 않는다.)
                const canApprove = v.status === '입실완료' && v.region === myRegion;
                const checkoutBtn = canApprove
                    ? `<div class="sec-status-action"><button onclick="approveSecurityAction(${v.id}, '퇴실완료')" class="sec-btn-approve-item bg-orange">퇴실 처리</button></div>`
                    : '';

                html += `
                    <tr class="border-bottom-eee">
                        <td class="p-10">${v.month_seq != null ? v.month_seq : '-'}</td>
                        <td class="p-10">${v.visit_date}</td>
                        <td class="p-10"><span style="color:#2563eb;font-weight:700;text-decoration:underline;cursor:pointer;" onclick="openVisitorHistory(decodeURIComponent('${encodeURIComponent(v.name||'').replace(/'/g,'%27')}'),decodeURIComponent('${encodeURIComponent(v.contact||'').replace(/'/g,'%27')}'))">${v.name}</span>${v.pass_id ? `<span class="sec-pass-tag">${v.pass_type || '정기'}</span>` : ''}</td>
                        <td class="p-10">${formatPhone(v.contact)}</td>
                        <td class="p-10">${v.visit_count != null ? (v.visit_count >= 2 ? `<b class="text-blue">${v.visit_count}회</b>` : `${v.visit_count}회`) : '-'}</td>
                        <td class="p-10">${v.company}</td>
                        <td class="p-10"><span class="sec-purpose-badge">${v.purpose}</span></td>
                        <td class="p-10">${managerDisplay}</td>
                        <td class="p-10 text-green fw-600 col-split-time">${secTimeOnly(v.checkin_time)}</td>
                        <td class="p-10 text-red fw-600 col-split-time">${secTimeOnly(v.checkout_time)}</td>
                        <td class="p-10 col-merged-time">
                            <span class="text-green fw-600">입 ${secTimeOnly(v.checkin_time)}</span><br>
                            <span class="text-red fw-600">퇴 ${secTimeOnly(v.checkout_time)}</span>
                        </td>
                        <td class="p-10"><b>${statusLabel(v.status)}</b>${checkoutBtn}</td>
                    </tr>
                `;
            });
        }
        tbody.innerHTML = html;
    }

    if (typeof window.renderLogPagination === 'function') {
        window.renderLogPagination('secLogPagination', secLogsAll.length, secLogPage, perPage, (p) => {
            secLogPage = p;
            renderSecurityLogTable();
        });
    }
}

// ⏰ 퇴실 지연자 조회 (status=입실완료 이면서 퇴실 예정시간 초과)
async function loadSecurityOverdue(isAuto = false) {
    const startEl = document.getElementById('secOverdueStartDate');
    const endEl = document.getElementById('secOverdueEndDate');
    const tbody = document.getElementById('secOverdueBody');
    if (!tbody) return;

    if (!isAuto) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center-p20-gray">퇴실 지연자를 조회하는 중입니다...</td></tr>';
    }

    // 날짜 파라미터: 값이 있으면 범위 조회, 없으면 서버가 오늘 기준으로 판정
    const params = new URLSearchParams();
    if (startEl && startEl.value) params.append('start_date', startEl.value);
    if (endEl && endEl.value) params.append('end_date', endEl.value);

    try {
        const res = await fetch(`/api/security/overdue?${params.toString()}`);
        if (res.status === 401 || res.status === 403) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center-p20-red">조회 권한이 만료되었습니다. 재로그인 해주세요.</td></tr>';
            if (securityRefreshTimer) clearInterval(securityRefreshTimer);
            return;
        }
        const data = await res.json();
        const list = (data && data.list) ? data.list : [];

        // 사이드바 '퇴실 지연' 배지 갱신
        const badge = document.getElementById('secOverdueCount');
        if (badge) {
            badge.textContent = list.length;
            badge.classList.toggle('display-none', list.length === 0);
        }
        // 상단 요약 통계 '퇴실 지연' 카드 갱신
        const overdueStatEl = document.getElementById('secStatOverdue');
        if (overdueStatEl) overdueStatEl.textContent = list.length;

        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="no-data-box">현재 퇴실 예정시간을 초과한 재실자가 없습니다.</td></tr>';
            return;
        }

        // 지연 시간(분) → "N시간 M분" 표기
        const fmtDelay = (min) => {
            const h = Math.floor(min / 60);
            const m = min % 60;
            return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
        };

        let html = '';
        list.forEach(v => {
            html += `
                <tr class="sec-overdue-row">
                    <td class="p-10">${v.visit_date}</td>
                    <td class="p-10"><b>${v.name}</b><br><span class="text-gray-light">${v.company || '-'}</span></td>
                    <td class="p-10">${formatPhone(v.contact)}</td>
                    <td class="p-10">${v.vehicle_no || '-'}</td>
                    <td class="p-10">${v.manager_text || '-'}</td>
                    <td class="p-10 text-green fw-600">${secTimeOnly(v.checkin_time)}</td>
                    <td class="p-10 fw-600">${secTimeOnly(v.expected_checkout_dt || v.expected_checkout)}</td>
                    <td class="p-10"><span class="sec-overdue-badge">${fmtDelay(v.overdue_minutes)}</span></td>
                    <td class="p-10">
                        <button onclick="approveSecurityAction(${v.id}, '퇴실완료')" class="sec-btn-approve-item bg-orange">퇴실 처리</button>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    } catch (e) {
        if (!isAuto) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center-p20-red">데이터 연동 에러가 발생했습니다.</td></tr>';
        }
    }
}

async function approveSecurityAction(id, targetStatus, force = false) {
    // 버튼 클릭 즉시 처리 (라우틴 확인창 제거). 조기 입실 경고는 서버 응답(d.early)에서만 확인.
    try {
        const res = await fetch('/api/security/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, target_status: targetStatus, force })
        });
        const d = await res.json();
        // 조기 입실 경고 → 확인 시 강제(force) 재승인
        if (!d.success && d.early) {
            if (confirm(d.message)) return approveSecurityAction(id, targetStatus, true);
            return;
        }
        if (!d.success) { alert(d.message || '승인 처리에 실패했습니다. (권한/상태를 확인하세요)'); return; }
    } catch (e) {
        alert('승인 처리 중 통신 오류가 발생했습니다.');
        return;
    }
    fetchSecurityQueue();
    loadSecurityAllLogs();
    loadSecurityOverdue();
}

async function approveSecurityGroup(groupId, targetStatus, force = false) {
    // 버튼 클릭 즉시 처리 (라우틴 확인창 제거). 조기 입실 경고는 서버 응답(d.early)에서만 확인.
    try {
        const res = await fetch('/api/security/approve-group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group_id: groupId, target_status: targetStatus, force })
        });
        const d = await res.json();
        if (!d.success && d.early) {
            if (confirm(d.message)) return approveSecurityGroup(groupId, targetStatus, true);
            return;
        }
        if (!d.success) { alert(d.message || '그룹 승인 처리에 실패했습니다.'); return; }
    } catch (e) {
        alert('그룹 승인 처리 중 통신 오류가 발생했습니다.');
        return;
    }
    fetchSecurityQueue();
    loadSecurityAllLogs();
    loadSecurityOverdue();
}

function toggleSecRegForm() {
    const form = document.getElementById('secRegFormZone');
    if (!form) return;
    // display-block(block !important)을 강제하면 .form-container 의 flex 레이아웃이 깨진다.
    // 숨김/보임은 display-none 만 토글하고, 보일 때는 .form-container 의 display:flex 가 그대로 적용되게 둔다.
    form.classList.toggle('display-none');
}

async function submitSecReg() {
    const date = document.getElementById('secRegDate').value;
    const name = document.getElementById('secRegName').value.trim();
    const contact = readPhone('secRegContact');
    const company = document.getElementById('secRegCompany').value.trim();
    const vehicle = document.getElementById('secRegVehicle').value.trim() || '없음';
    const manager = document.getElementById('secRegManager').value.trim();
    const purpose = document.getElementById('secRegPurpose').value;

    if (!date || !name || !contact || !company || !manager || !purpose) {
        return alert('필수 입력 항목(* 표시)을 모두 채워주세요.');
    }

    try {
        const res = await fetch('/api/security/preregister', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                visit_date: date,
                name: name,
                contact: contact,
                company: company,
                vehicle_no: vehicle,
                manager_text: manager,
                purpose: purpose
            })
        });
        const result = await res.json();
        if (result.success) {
            alert(result.message);
            document.getElementById('secRegName').value = '';
            clearPhone('secRegContact');
            document.getElementById('secRegCompany').value = '';
            document.getElementById('secRegVehicle').value = '';
            document.getElementById('secRegManager').value = '';
            
            toggleSecRegForm(); 
            fetchSecurityQueue(); 
            loadSecurityAllLogs(); 
        } else {
            alert(result.message);
        }
    } catch (e) {
        alert('서버 통신 중 오류가 발생했습니다.');
    }
}


// ====================================================================
// 🎫 정기 이용 방문객(정기권) — 경비실 화면
//   - 발급 대상 거점은 서버가 세션에서 강제한다(자기 센터). 화면에서 고를 수 없다.
//   - QR 은 별도 창으로 열어 바로 인쇄한다. (경비실 화면에는 모달 컴포넌트가 없다)
// ====================================================================
let secPassCache = [];

// 요일 표기는 화면마다 같아야 하므로 공용 함수(visitor-history.js)를 쓴다.
function secPassWeekdayText(weekdays) { return window.passWeekdayText(weekdays); }

function toggleSecPassForm() {
    const zone = document.getElementById('secPassFormZone');
    if (!zone) return;
    zone.classList.toggle('display-none');
    if (!zone.classList.contains('display-none')) {
        // 기본 유효기간: 오늘 ~ 기본 기간(PASS_DEFAULT_MONTHS 개월) 뒤 — 손님 신청 건과 같은 기준.
        //   종료일은 그 이후로 선택할 수 없게 달력 범위도 함께 제한한다.
        syncSecPassDateLimit();
    }
}

// 정기는 평일 상주가 일반적, 수시는 언제 올지 모르니 전 요일 허용이 기본.
function onSecPassTypeChange() {
    const type = (document.getElementById('secPassType') || {}).value;
    const preset = (type === '수시') ? '1111111' : '1111100';
    document.querySelectorAll('#secPassWeekdayBox input[type="checkbox"]').forEach(cb => {
        cb.checked = preset[parseInt(cb.dataset.day, 10)] === '1';
    });
}

// 발급 폼: 종료일 선택 범위를 시작일 기준으로 다시 계산
function syncSecPassDateLimit() {
    window.syncPassPeriod(document.getElementById('secPassFrom'),
                          document.getElementById('secPassPeriod'),
                          document.getElementById('secPassTo'));
}

// 발급 신청 표: 행마다 종료일 범위를 다시 계산 (승인 시 기간을 늘려 발급하지 못하게)
function syncSecReqDateLimit(passId) {
    window.syncPassPeriod(document.getElementById(`secReqFrom_${passId}`),
                          document.getElementById(`secReqPeriod_${passId}`),
                          document.getElementById(`secReqTo_${passId}`),
                          document.getElementById(`secReqRange_${passId}`));
}

async function loadSecPassData() {
    await Promise.all([loadSecPassList(), loadSecPassToday()]);
}

async function loadSecPassList() {
    const tbody = document.getElementById('secPassListBody');
    if (!tbody) return;
    const fail = (msg) => { tbody.innerHTML = `<tr><td colspan="9" class="no-data-box">${msg}</td></tr>`; };

    // ① 통신 단계
    let data;
    try {
        const res = await fetch('/api/pass/list');
        data = await res.json();
    } catch (e) {
        console.error('[이용권] 목록 조회 통신 실패', e);
        return fail('이용권 조회 중 통신 오류가 발생했습니다.');
    }
    if (!data.success) return fail(data.message || '조회에 실패했습니다.');

    // ② 표시 단계 — 화면 코드 오류를 통신 오류로 오인하지 않도록 분리한다.
    try {
        secPassCache = data.list || [];
        if (data.periods) window.PASS_PERIODS = data.periods;                       // 서버 운영 단위 반영
        if (data.default_period) window.PASS_DEFAULT_PERIOD = data.default_period;
        renderSecPassList(data.today);
    } catch (e) {
        console.error('[이용권] 목록 표시 중 오류', e);
        fail(`목록을 표시하는 중 오류가 발생했습니다. (${e.message})`);
    }
}

function renderSecPassList(today) {
    renderSecPassRequests(today);
    const tbody = document.getElementById('secPassListBody');
    if (!tbody) return;
    // 승인 대기 건은 위쪽 '발급 신청' 표에서 처리하므로 아래 목록에서는 뺀다.
    const issued = secPassCache.filter(p => p.status !== '신청');
    if (!issued.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="no-data-box">발급된 출입 이용권이 없습니다.</td></tr>';
        return;
    }

    // 소제목 요약: 활성 이용권을 승인 방식으로 나눠 보여준다 (자동 승인은 승인 대기열을 거치지 않는다)
    const summary = document.getElementById('secPassIssuedSummary');
    if (summary) {
        const active = issued.filter(p => p.status === '활성');
        const auto = active.filter(p => p.auto_approve).length;
        summary.textContent = active.length
            ? `활성 ${active.length}장 · 경비실 승인 ${active.length - auto} · 자동 승인 ${auto}`
            : '';
    }

    tbody.innerHTML = issued.map(p => {
        const statusClass = p.status === '활성' ? 'sec-pass-badge-on'
            : (p.status === '정지' || p.status === '반려' ? 'sec-pass-badge-off' : 'sec-pass-badge-end');
        const toggleBtn = (p.status === '활성' || p.status === '정지')
            ? `<button onclick="setSecPassStatus(${p.id}, '${p.status === '활성' ? '정지' : '활성'}')" class="sec-btn-approve-item ${p.status === '활성' ? 'bg-orange' : 'bg-green'}">${p.status === '활성' ? '정지' : '활성화'}</button>`
            : '';
        const typeChip = `<span class="sec-pass-chip ${p.pass_type === '수시' ? 'type-occasional' : 'type-regular'}">${p.pass_type || '정기'}</span>`;
        const dormantMark = p.dormant
            ? `<br><span class="fs-8 sec-pass-dormant">💤 ${p.idle_days != null ? p.idle_days + '일 전' : '미사용'}</span>`
            : '';
        return `
            <tr class="sec-item-row">
                <td class="p-10">${typeChip}${dormantMark}</td>
                <td class="p-10"><b>${p.name}</b><br><span class="text-gray-light">${p.company}</span></td>
                <td class="p-10">${formatPhone(p.contact)}<br><span class="fs-8 text-gray-light">🚗 ${p.vehicle_no || '없음'}</span></td>
                <td class="p-10"><span class="sec-purpose-badge">${p.purpose}</span></td>
                <td class="p-10">${p.valid_from}<br>~ ${p.valid_to}${p.period ? `<br><span class="fs-8 text-gray-light">${p.period}</span>` : ''}</td>
                <td class="p-10">${secPassWeekdayText(p.weekdays)}</td>
                <td class="p-10">${p.auto_approve ? '자동' : '승인'}</td>
                <td class="p-10"><span class="sec-pass-badge ${statusClass}">${p.status}</span></td>
                <td class="p-10 sec-pass-actions">
                    <button onclick="showSecPassQr(${p.id})" class="sec-btn-approve-item bg-blue">QR</button>
                    ${toggleBtn}
                </td>
            </tr>`;
    }).join('');
}

// 🙋 발급 신청 표: 유효기간·종류를 이 자리에서 확정해 바로 승인한다.
function renderSecPassRequests(today) {
    const zone = document.getElementById('secPassReqZone');
    const tbody = document.getElementById('secPassReqBody');
    const cnt = document.getElementById('secPassReqCount');
    if (!zone || !tbody) return;

    const reqs = secPassCache.filter(p => p.status === '신청');
    zone.classList.toggle('display-none', reqs.length === 0);
    if (cnt) cnt.textContent = reqs.length ? `${reqs.length}건 대기중` : '';
    if (!reqs.length) { tbody.innerHTML = ''; return; }

    tbody.innerHTML = reqs.map(p => {
        const memo = p.memo ? `<br><span class="fs-8 text-gray-light">💬 ${p.memo}</span>` : '';
        return `
            <tr class="sec-item-row sec-pass-req-row">
                <td class="p-10"><b>${p.name}</b><br><span class="text-gray-light">${p.company}</span>${memo}</td>
                <td class="p-10">${formatPhone(p.contact)}<br><span class="fs-8 text-gray-light">🚗 ${p.vehicle_no || '없음'}</span></td>
                <td class="p-10"><span class="sec-purpose-badge">${p.purpose}</span></td>
                <td class="p-10">
                    <select id="secReqType_${p.id}" class="sec-req-input">
                        <option value="정기" ${p.pass_type !== '수시' ? 'selected' : ''}>정기</option>
                        <option value="수시" ${p.pass_type === '수시' ? 'selected' : ''}>수시</option>
                    </select>
                </td>
                <td class="p-10">
                    <input type="date" id="secReqFrom_${p.id}" class="sec-req-input" value="${p.valid_from}"
                           onchange="syncSecReqDateLimit(${p.id})">
                    <select id="secReqPeriod_${p.id}" class="sec-req-input" onchange="syncSecReqDateLimit(${p.id})">
                        ${['1일', '1주일', '1개월'].map(x =>
                            `<option value="${x}" ${(p.period || '1개월') === x ? 'selected' : ''}>${x}</option>`).join('')}
                    </select>
                    <input type="hidden" id="secReqTo_${p.id}" value="${p.valid_to}">
                    <span id="secReqRange_${p.id}" class="fs-8 text-gray-light">${p.valid_from} ~ ${p.valid_to}</span>
                </td>
                <td class="p-10 sec-pass-actions">
                    <button onclick="approveSecPass(${p.id})" class="sec-btn-approve-item bg-green">승인 발급</button>
                    <button onclick="rejectSecPass(${p.id})" class="sec-btn-approve-item bg-orange">반려</button>
                </td>
            </tr>`;
    }).join('');
}

async function approveSecPass(passId) {
    const p = secPassCache.find(x => x.id === passId);
    const get = (id) => (document.getElementById(id) || {}).value || '';
    const payload = {
        pass_type: get(`secReqType_${passId}`),
        valid_from: get(`secReqFrom_${passId}`),
        period: get(`secReqPeriod_${passId}`),      // 종료일은 서버가 '시작일 + 단위'로 계산
    };
    const endDate = window.passPeriodEnd(payload.valid_from, payload.period);
    if (!confirm(`${p ? p.name + ' 님의 ' : ''}${payload.pass_type} 이용권을 발급합니다.\n유효기간: ${payload.valid_from} ~ ${endDate} (${payload.period})\n\n승인할까요?`)) return;

    const res = await fetch(`/api/pass/${passId}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.success) return alert(data.message || '승인에 실패했습니다.');
    alert(data.message);
    await loadSecPassData();
    showSecPassQr(passId);       // 발급 직후 QR 표시 (전달용)
}

async function rejectSecPass(passId) {
    const p = secPassCache.find(x => x.id === passId);
    const reason = prompt(`${p ? p.name + ' 님의 ' : ''}발급 신청을 반려합니다.\n사유를 입력하세요 (손님 조회 화면에 표시됩니다).`, '');
    if (reason === null) return;
    const res = await fetch(`/api/pass/${passId}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() })
    });
    const data = await res.json();
    alert(data.message || (data.success ? '반려 처리했습니다.' : '처리에 실패했습니다.'));
    if (data.success) loadSecPassData();
}

async function loadSecPassToday() {
    const tbody = document.getElementById('secPassTodayBody');
    if (!tbody) return;
    const fail5 = (msg) => { tbody.innerHTML = `<tr><td colspan="5" class="no-data-box">${msg}</td></tr>`; };

    let data;
    try {
        const res = await fetch('/api/pass/today');
        data = await res.json();
    } catch (e) {
        console.error('[이용권] 오늘 현황 통신 실패', e);
        return fail5('통신 오류가 발생했습니다.');
    }
    if (!data.success) return fail5(data.message || '조회에 실패했습니다.');

    try {
        const list = data.list || [];

        // 사이드바 배지: 승인 대기가 있으면 그 건수를(빨강), 없으면 오늘 출입 건수를 보여준다.
        const badge = document.getElementById('secPassCount');
        if (badge) {
            const pending = data.pending || 0;
            badge.textContent = pending || list.length;
            badge.classList.toggle('sec-nav-badge-warn', pending > 0);
            badge.classList.toggle('display-none', pending === 0 && list.length === 0);
        }
        const byType = data.active_by_type || {};
        const summary = document.getElementById('secPassTodaySummary');
        if (summary) {
            summary.textContent = `오늘 ${list.length}건 · 오늘 사용 가능 ${data.active_total}장`
                + ` (정기 ${byType['정기'] || 0} · 수시 ${byType['수시'] || 0})`;
        }

        tbody.innerHTML = list.length
            ? list.map(v => `
                <tr class="sec-item-row">
                    <td class="p-10"><span class="sec-pass-chip ${v.pass_type === '수시' ? 'type-occasional' : 'type-regular'}">${v.pass_type || '정기'}</span>
                        <b>${v.name}</b><br><span class="text-gray-light">${v.company}</span></td>
                    <td class="p-10">${v.vehicle_no || '-'}</td>
                    <td class="p-10 text-green fw-600">${secTimeOnly(v.checkin_time)}</td>
                    <td class="p-10 text-orange fw-600">${secTimeOnly(v.checkout_time)}</td>
                    <td class="p-10">${v.status}</td>
                </tr>`).join('')
            : '<tr><td colspan="5" class="no-data-box">오늘 이용권으로 출입한 방문객이 없습니다.</td></tr>';
    } catch (e) {
        console.error('[이용권] 오늘 현황 표시 중 오류', e);
        fail5(`현황을 표시하는 중 오류가 발생했습니다. (${e.message})`);
    }
}

async function submitSecPass() {
    const get = (id) => (document.getElementById(id) || {}).value || '';
    let weekdays = '';
    document.querySelectorAll('#secPassWeekdayBox input[type="checkbox"]').forEach(cb => {
        weekdays += cb.checked ? '1' : '0';
    });
    if (!weekdays.includes('1')) {
        alert('이용 요일을 최소 하나는 선택해 주세요.');
        return;
    }

    const payload = {
        pass_type: get('secPassType'),
        name: get('secPassName').trim(),
        contact: readPhone('secPassContact'),           // 3박스 입력 → 숫자만 결합 (js/common.js)
        company: get('secPassCompany').trim(),
        vehicle_no: get('secPassVehicle').trim(),
        purpose: get('secPassPurpose').trim(),
        valid_from: get('secPassFrom'),
        period: get('secPassPeriod'),       // 종료일은 서버가 '시작일 + 단위'로 계산
        auto_approve: get('secPassAuto'),
        weekdays: weekdays,
        // region 은 서버가 세션(자기 거점)으로 강제하므로 보내지 않는다.
    };

    const res = await fetch('/api/pass', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.success) {
        alert(data.message || '발급에 실패했습니다.');
        return;
    }
    alert(data.message);

    ['secPassName', 'secPassCompany', 'secPassVehicle', 'secPassPurpose']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    clearPhone('secPassContact');
    toggleSecPassForm();
    await loadSecPassData();
    if (data.id) showSecPassQr(data.id);     // 발급 직후 QR 표시 (전달용)
}

async function setSecPassStatus(passId, status) {
    const p = secPassCache.find(x => x.id === passId);
    const label = p ? `'${p.name}(${p.company})' ` : '';
    if (!confirm(`${label}출입 이용권을 ${status} 처리할까요?`)) return;
    const res = await fetch(`/api/pass/${passId}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
    });
    const data = await res.json();
    alert(data.message || (data.success ? '처리되었습니다.' : '처리에 실패했습니다.'));
    if (data.success) loadSecPassData();
}

// 🎫 QR 이용권 보기: 인쇄 창을 띄우지 않는다. 화면에 QR 을 띄우고, 필요하면 PNG 로 저장해
//    문자·메신저로 방문객에게 전달한다. (경비실 화면에는 모달 컴포넌트가 없어 자립형 오버레이로 구성)
function showSecPassQr(passId) {
    const p = secPassCache.find(x => x.id === passId);
    if (!p) return;
    const kind = p.pass_type === '수시' ? '수시 출입권' : '정기 이용권';

    document.getElementById('secPassQrOverlay')?.remove();
    const ov = document.createElement('div');
    ov.id = 'secPassQrOverlay';
    ov.className = 'sec-qr-overlay';
    ov.innerHTML = `
        <div class="sec-qr-dialog">
            <div class="sec-qr-title">${kind} · ${p.region}</div>
            <img class="sec-qr-img" src="/api/qr?token=${encodeURIComponent(p.token)}" alt="이용권 QR">
            <div class="sec-qr-name">${p.name}</div>
            <div class="sec-qr-company">${p.company}</div>
            <div class="sec-qr-meta">
                <span>유효기간</span><b>${p.valid_from} ~ ${p.valid_to}</b>
                <span>이용 요일</span><b>${secPassWeekdayText(p.weekdays)}</b>
                <span>차량 번호</span><b>${p.vehicle_no || '없음'}</b>
            </div>
            <div class="sec-qr-actions">
                <button onclick="downloadSecPassQr(${p.id})" class="btn-list-action bg-blue btn-sec-action">📥 QR 이미지 저장</button>
                <button onclick="closeSecPassQr()" class="btn-cancel-outline btn-sec-action">닫기</button>
            </div>
        </div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov) closeSecPassQr(); });
    document.body.appendChild(ov);
    // 저장 버튼이 즉시 반응하도록 카드 이미지를 미리 만들어 둔다.
    window.preparePassCardImage(p, secPassWeekdayText(p.weekdays));
}

function closeSecPassQr() {
    document.getElementById('secPassQrOverlay')?.remove();
    if (typeof secKeepScanFocus === 'function') secKeepScanFocus();   // 스캔 대기 상태로 복귀
}

// 저장은 화면의 카드 그대로 PNG 로 (QR + 이름·소속·유효기간·요일·차량).
//   생성기는 visitor-history.js 의 공용 함수 (관리자 화면과 동일한 결과물).
function downloadSecPassQr(passId) {
    const p = secPassCache.find(x => x.id === passId);
    if (!p) return;
    window.downloadPassCardPng(p, secPassWeekdayText(p.weekdays));
}
