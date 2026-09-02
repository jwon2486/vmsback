/**
 * js/security.js
 * 보안실 출입 관제 및 대면 승인 처리 (인라인 CSS 완벽 제거)
 */

// ⏱️ 자동 새로고침 주기. 화면에 표기되는 '자동 갱신 N초'도 이 값에서 뽑아 쓴다.
//    (주기와 안내 문구가 따로 놀지 않도록 정의를 한 곳으로 모은다)
const SEC_REFRESH_MS = 3000;
const SEC_REFRESH_LABEL = `자동 갱신 ${SEC_REFRESH_MS / 1000}초`;

// 'YYYY-MM-DD HH:MM:SS' → 'HH:MM:SS' 만 반환.
//  - 표에는 이미 '방문일' 컬럼이 있어 날짜가 중복되므로 입·퇴실 셀은 시간만 표시한다.
//  - 값이 없거나 예상 형식이 아니면 안전하게 원본(또는 '-')을 그대로 반환.
function secTimeOnly(val) {
    if (!val) return '-';
    const parts = String(val).trim().split(' ');
    return parts.length > 1 ? parts[parts.length - 1] : val;
}

// 🏷️ 경비실 화면 한정: 시스템 명칭(S&SYS VMS / 부제)을 상단 유틸리티 바 중앙에 넣는다.
//    원래 자리인 .app-header 는 CSS 로 숨긴다 — 표가 많은 화면이라 세로 공간을 아낀다.
//    renderEmpNavbar() 가 nav 를 다시 그린 뒤에 호출되므로 여기서 붙여도 지워지지 않는다.
function secMountNavBrand() {
    const nav = document.getElementById('utility-nav');
    if (!nav || nav.querySelector('.sec-nav-brand')) return;   // 중복 삽입 방지
    const box = document.createElement('div');
    box.className = 'sec-nav-brand';
    box.innerHTML = `<span class="sec-nav-title">S&amp;SYS VMS</span>`
                  + `<span class="sec-nav-sub">에스엔시스 방문객 출입관리 시스템</span>`;
    nav.appendChild(box);

    secSyncNavBrandLayout();

    // nav 폭이 바뀔 때마다 다시 판단한다.
    //  - window resize 이벤트만으로는 nav 자체가 다른 이유로 줄어드는 경우를 놓친다.
    //  - 세로(높이) 변화로는 재실행하지 않는다: 이 함수가 붙이는 클래스가 높이를 바꾸므로
    //    높이까지 보면 무한 루프가 된다.
    if (!window.__secNavBrandObserver && typeof ResizeObserver !== 'undefined') {
        let lastW = 0;
        window.__secNavBrandObserver = new ResizeObserver(entries => {
            const w = Math.round(entries[0].contentRect.width);
            if (w === lastW) return;
            lastW = w;
            secSyncNavBrandLayout();
        });
        window.__secNavBrandObserver.observe(nav);
    }
    // 안전망: ResizeObserver 가 동작하지 않는 환경을 대비해 창 리사이즈에도 붙여 둔다.
    if (!window.__secNavBrandBound) {
        window.__secNavBrandBound = true;
        window.addEventListener('resize', secSyncNavBrandLayout);
    }
}

// 브랜드를 nav 중앙에 겹쳐 놓을지(기본), 아랫줄로 내릴지 결정한다.
//  - 폭 breakpoint 로 끊으면 '자리가 남는데도 내려가는' 구간이 생긴다.
//    계정명·버튼 개수에 따라 필요한 여유가 달라지므로 실제 간격을 재서 판단한다.
//  - 기본은 absolute 라 레이아웃에 영향이 없다 → 버튼이 밀려 내려가지 않는다.
function secSyncNavBrandLayout() {
    const nav = document.getElementById('utility-nav');
    const brand = nav && nav.querySelector('.sec-nav-brand');
    const prof = nav && nav.querySelector('.nav-profile-info');
    const acts = nav && nav.querySelector('.nav-actions');
    if (!brand || !prof || !acts) return;

    brand.classList.remove('is-stacked');          // 먼저 중앙 상태로 되돌리고 재야 정확하다
    const gap = acts.getBoundingClientRect().left - prof.getBoundingClientRect().right;
    const need = brand.scrollWidth + 28;           // 좌우로 최소한 남겨 둘 간격
    if (gap < need) brand.classList.add('is-stacked');
}

/* ====================================================================
   🔍 경비실 콘솔 글자 배율 (노안 대응)
     - 루트 폰트만 배율로 곱한다. 글자·여백·버튼이 대부분 rem 이라 전체가 같은 비율로
       확대돼 레이아웃이 어긋나지 않는다.
     - 경비실 화면에서만 적용한다. 손님 화면으로 나가면 resetWideLayout() 이 해제한다.
     - 선택한 배율은 그 기기에 저장한다 (경비실 PC 는 계속 같은 사람이 쓴다).
   ==================================================================== */
const SEC_FONT_MIN = 0.9;
const SEC_FONT_MAX = 1.5;
const SEC_FONT_STEP = 0.05;
const SEC_FONT_KEY = 'sec_font_scale';

function secFontScaleRead() {
    const v = parseFloat(localStorage.getItem(SEC_FONT_KEY));
    if (!isFinite(v)) return 1;
    return Math.min(SEC_FONT_MAX, Math.max(SEC_FONT_MIN, v));
}

/** 배율을 화면에 적용하고 저장한다.
    CSS 규칙이 html:has(.container-security-wide) 로 범위를 좁히고 있어
    이 변수는 경비실 화면에서만 효과가 있다 — 손님 화면으로 새지 않는다. */
function applySecFontScale(scale) {
    const v = Math.min(SEC_FONT_MAX, Math.max(SEC_FONT_MIN, Math.round(scale * 100) / 100));
    const root = document.documentElement;
    root.style.setProperty('--sec-font-scale', String(v));
    try { localStorage.setItem(SEC_FONT_KEY, String(v)); } catch (e) {}

    const val = document.getElementById('secFontVal');
    if (val) val.textContent = Math.round(v * 100) + '%';
    // 한계에 닿으면 버튼을 비활성화해 '눌러도 안 바뀌는' 혼란을 없앤다
    const minus = document.getElementById('secFontMinus');
    const plus = document.getElementById('secFontPlus');
    if (minus) minus.disabled = (v <= SEC_FONT_MIN + 0.001);
    if (plus) plus.disabled = (v >= SEC_FONT_MAX - 0.001);
    return v;
}

function changeSecFontScale(dir) {
    applySecFontScale(secFontScaleRead() + dir * SEC_FONT_STEP);
}

function showSecurityDashboard() {
    const emp = JSON.parse(sessionStorage.getItem('emp_session'));
    const empRegion = emp.region || '테크센터'; 
    const weekRange = getKstThisWeekRange();

    const container = document.querySelector('.container');
    if (container) container.classList.add('container-wide', 'container-security-wide');

    secMountNavBrand();   // 🏷️ 시스템 명칭을 상단 유틸리티 바 중앙으로

    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    
    appCard.classList.remove('card-guest-wide');
    appCard.classList.add('card-wide', 'card-security-wide');
    
    appCard.innerHTML = `
    <div class="sec-erp-layout">
        <aside class="sec-erp-sidebar">
            <div class="sec-erp-brand">
                <div class="sec-erp-brand-text">
                    <strong>출입관리</strong>
                    <span class="sec-brand-ver">SNSYS-VMS</span>
                </div>
            </div>
            <nav class="sec-erp-nav">
                <button id="secMenuQueue" class="sec-nav-item active" onclick="switchSecTab('queue')">
                    <span class="sec-nav-label"><span class="sec-nav-dot"></span>승인 요청</span>
                    <span id="secQueueCount" class="sec-nav-badge display-none">0</span>
                </button>
                <button id="secMenuLogs" class="sec-nav-item" onclick="switchSecTab('logs')">
                    <span class="sec-nav-label"><span class="sec-nav-dot"></span>출입 기록</span>
                </button>
                <button id="secMenuOverdue" class="sec-nav-item" onclick="switchSecTab('overdue')">
                    <span class="sec-nav-label"><span class="sec-nav-dot"></span>퇴실 지연</span>
                    <span id="secOverdueCount" class="sec-nav-badge sec-nav-badge-warn display-none">0</span>
                </button>
                <button id="secMenuPass" class="sec-nav-item" onclick="switchSecTab('pass')">
                    <span class="sec-nav-label"><span class="sec-nav-dot"></span>출입 이용권</span>
                    <span id="secPassCount" class="sec-nav-badge display-none">0</span>
                </button>
            </nav>
            <div class="sec-erp-sidebar-action">
                <!-- 방문객 수동 예약: 요청에 의해 비활성화 (되살리려면 아래 버튼 주석 해제)
                <button onclick="toggleSecRegForm()" class="btn-list-action bg-blue btn-sec-action w-100">방문객 수동 예약</button>
                -->
            </div>
        </aside>

        <section class="sec-erp-content">
            <!-- 🖥️ 콘솔 상태 바: 어느 거점의 무슨 화면을, 누가, 언제 기준으로 보고 있는지.
                 관제 화면에서 가장 먼저 확인해야 하는 정보라 최상단에 고정한다. -->
            <div class="sec-console-bar">
                <div class="sec-console-loc">
                    <span class="sec-console-live" id="secConsoleLive"></span>
                    <span class="sec-console-region">${empRegion}</span>
                    <span class="sec-console-sep">／</span>
                    <span class="sec-console-view" id="secConsoleView">승인 요청</span>
                </div>
                <!-- 운영자 표기는 두지 않는다 — 상단 유틸리티 바(nav)에 이미 계정·소속이 있다. -->
                <div class="sec-console-meta">
                    <span class="sec-font-zoom" title="글자 크기 조절">
                        <button type="button" id="secFontMinus" onclick="changeSecFontScale(-1)">−</button>
                        <span class="sec-font-zoom-val" id="secFontVal">100%</span>
                        <button type="button" id="secFontPlus" onclick="changeSecFontScale(1)">+</button>
                    </span>
                    <span class="sec-console-sync" id="secConsoleSync">동기화 대기</span>
                    <span class="sec-console-clock" id="secConsoleClock">--:--:--</span>
                </div>
            </div>

            <!-- 본문 2단: 좌 = 작업 영역, 우 = 관제 요약 패널.
                 우측 패널은 넓은 화면(≥1440px)에서만 나타난다. 그보다 좁으면 표가 눌리므로 숨긴다. -->
            <div class="sec-console-body">
            <div class="sec-console-main">

            <div class="sec-scan-bar">
                <span class="sec-scan-icon"></span>
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
                    <span class="sec-stat-label">승인 대기</span>
                    <span class="sec-stat-value" id="secStatPending">-</span>
                </button>
                <button type="button" class="sec-stat-card stat-onsite" onclick="switchSecTab('logs')" title="출입 기록 탭으로 이동">
                    <span class="sec-stat-label">현재 재실중</span>
                    <span class="sec-stat-value" id="secStatOnsite">-</span>
                </button>
                <button type="button" class="sec-stat-card stat-overdue" onclick="switchSecTab('overdue')" title="퇴실 지연 탭으로 이동">
                    <span class="sec-stat-label">퇴실 지연</span>
                    <span class="sec-stat-value" id="secStatOverdue">-</span>
                </button>
            </div>

            <!-- 📈 금일 시간대별 입실 추이: 별도 API 없이 이미 받아 둔 출입 기록(secLogsAll)에서 집계한다.
                 06~20시를 1시간 단위로 끊어 그리며, 자기 거점·오늘 자 입실 기록만 센다. -->
            <div class="sec-trend-strip">
                <svg class="sec-trend-svg" id="secTrendSvg" viewBox="0 0 300 40"
                     preserveAspectRatio="none" aria-hidden="true"></svg>
                <div class="sec-trend-readout">
                    <span class="sec-trend-label">금일 입실</span>
                    <span class="sec-trend-value" id="secTrendTotal">-</span>
                    <span class="sec-trend-peak" id="secTrendPeak"></span>
                </div>
            </div>

            <div id="secRegFormZone" class="display-none form-container sec-reg-form">
                <h3 class="fs-10 my-title-color mb-15">경비실 방문객 수동 예약</h3>
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
                        <option value="회의/미팅">회의/미팅</option>
                        <option value="제품 납품">제품 납품</option>
                        <option value="상차/하차">상차/하차</option>
                        <option value="품질 검사">품질 검사</option>
                        <option value="시설 점검">시설 점검</option>
                        <option value="기타 업무">기타 업무</option>
                    </select>
                </div>
                <div class="sec-reg-actions">
                    <button onclick="submitSecReg()" class="btn-list-action bg-green btn-sec-action">예약 등록 완료</button>
                    <button onclick="toggleSecRegForm()" class="btn-cancel-outline btn-sec-action">취소 (닫기)</button>
                </div>
            </div>

            <div id="secPanelQueue" class="sec-tab-panel active">
                <div class="sec-panel-head sec-live-header">
                    <h3 class="sec-live-title">실시간 승인 대기열</h3>
                    <span class="sec-live-indicator">
                        <span class="spinner sec-spinner"></span> ${SEC_REFRESH_LABEL}
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
                <div class="sec-panel-head sec-logs-header">
                    <h3 class="sec-logs-title">전체 출입 기록</h3>
                    <div class="date-range-picker-box flex-center-gap">
                        <input type="date" id="secLogStartDate" value="${weekRange.todayKst}" onchange="loadSecurityAllLogs()" class="sec-date-input">
                        <span class="range-tilde">~</span>
                        <input type="date" id="secLogEndDate" value="${weekRange.todayKst}" onchange="loadSecurityAllLogs()" class="sec-date-input">
                    </div>
                </div>
                <!-- 🗺️ 기록 조회는 관리자(3)·전체기록 열람(5)과 동일하게 전 사업장 + 거점 선택.
                     단 '퇴실 처리' 버튼은 자기 소속 센터(${empRegion}) 건에만 노출된다. -->
                <div class="region-filter-bar" id="secRegionFilterBar">
                    <span class="filter-label">사업장</span>
                    <!-- 순서: '전 사업장' → 본인 소속 센터 → 나머지 (visitor-history.js 공용 헬퍼) -->
                    <div class="region-filter-btns">${regionFilterButtonsHtml(empRegion, 'setSecRegion')}</div>
                </div>
                <div class="table-responsive sec-table-container h-500">
                    <table class="modern-table w-100 min-w-900">
                        <thead class="sec-table-head">
                            <tr>
                                <th class="p-10 col-lo">순번</th>
                                <th class="p-10">방문일</th>
                                <th class="p-10">이름</th>
                                <th class="p-10 col-lo">연락처</th>
                                <th class="p-10">방문 횟수</th>
                                <th class="p-10">소속</th>
                                <th class="p-10 col-lo">방문 목적</th>
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
                <div class="sec-panel-head sec-logs-header">
                    <h3 class="sec-logs-title">퇴실 지연자 <span class="sec-region-text">${empRegion}</span></h3>
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
                                <th class="p-10 col-lo">연락처</th>
                                <th class="p-10 col-lo">차량 번호</th>
                                <th class="p-10">담당자</th>
                                <th class="p-10">입실 시간</th>
                                <th class="p-10 col-lo">퇴실 예정</th>
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
                <!-- 이 탭은 아래에 표가 바로 붙지 않고 구역이 여러 개라, 제목 바는 독립형(solo)으로 둔다. -->
                <div class="sec-panel-head sec-panel-head-solo sec-logs-header">
                    <h3 class="sec-logs-title">출입 이용권 <span class="sec-region-text">${empRegion}</span></h3>
                    <button onclick="toggleSecPassForm()" class="btn-list-action bg-blue btn-sec-action">이용권 발급</button>
                </div>
                <div id="secPassFormZone" class="display-none form-container sec-reg-form">
                    <h3 class="fs-10 my-title-color mb-15">출입 이용권 발급 <span class="sec-region-text">${empRegion}</span></h3>
                    <div class="input-row-group">
                        <div class="input-group"><label>방문객 성명 <span class="req-star">*</span></label><input type="text" id="secPassName" placeholder="성함 입력" autocomplete="off"></div>
                        <div class="input-group"><label>연락처 <span class="req-star">*</span></label>${phoneInputHtml('secPassContact')}</div>
                        <div class="input-group"><label>소속 업체 <span class="req-star">*</span></label><input type="text" id="secPassCompany" placeholder="방문객 업체명" autocomplete="off"></div>
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
                    <div class="sec-panel-head sec-pass-head">
                        <span class="sec-pass-head-title">발급 신청</span>
                        <span id="secPassReqCount" class="sec-pass-summary"></span>
                    </div>
                    <div class="table-responsive sec-table-container">
                        <table class="modern-table w-100 min-w-900">
                            <thead class="sec-table-head">
                                <tr>
                                    <th class="p-10">신청자 (소속)</th>
                                    <th class="p-10 col-lo">연락처 / 차량</th>
                                    <th class="p-10 col-lo">이용 목적</th>
                                    <th class="p-10">유효기간 확정</th>
                                    <th class="p-10">처리</th>
                                </tr>
                            </thead>
                            <tbody id="secPassReqBody"></tbody>
                        </table>
                    </div>
                </div>

                <div class="sec-panel-head sec-pass-head">
                    <span class="sec-pass-head-title">오늘 출입 현황</span>
                    <span id="secPassTodaySummary" class="sec-pass-summary"></span>
                </div>
                <div class="table-responsive sec-table-container">
                    <table class="modern-table w-100 min-w-700">
                        <thead class="sec-table-head">
                            <tr>
                                <th class="p-10">방문자 (소속)</th>
                                <th class="p-10 col-lo">차량 번호</th>
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

                <div class="sec-panel-head sec-pass-head">
                    <span class="sec-pass-head-title">발급된 이용권</span>
                    <span id="secPassIssuedSummary" class="sec-pass-summary"></span>
                </div>
                <div class="table-responsive sec-table-container h-500">
                    <table class="modern-table w-100 min-w-900">
                        <thead class="sec-table-head">
                            <tr>
                                <th class="p-10">방문객 (소속)</th>
                                <th class="p-10 col-lo">연락처 / 차량</th>
                                <th class="p-10 col-lo">이용 목적</th>
                                <th class="p-10">유효기간</th>
                                <th class="p-10 col-lo">요일</th>
                                <th class="p-10 col-lo">승인</th>
                                <th class="p-10">상태</th>
                                <th class="p-10">관리</th>
                            </tr>
                        </thead>
                        <tbody id="secPassListBody">
                            <tr><td colspan="8" class="no-data-box">불러오는 중입니다...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
            </div><!-- /.sec-console-main -->

            <aside class="sec-console-side">
                <!-- 거점별 현황: 사용자가 바꾸는 조회 필터와 무관하게, 항상 '오늘 · 전 사업장' 기준으로
                     따로 조회한다. (기록 탭의 secLogsAll 을 재활용하면 날짜·거점 필터에 딸려 흔들린다) -->
                <div class="sec-side-block">
                    <div class="sec-side-head">
                        <span class="sec-side-title">거점별 현황</span>
                        <span class="sec-side-meta" id="secRegionMeta">오늘</span>
                    </div>
                    <div class="sec-side-list" id="secRegionList">
                        <div class="sec-side-empty">불러오는 중</div>
                    </div>
                </div>

                <!-- 승인 대기 큐: 대기열 표와 같은 데이터를 쓰되, '지금 처리할 것'만 압축해 보여준다. -->
                <div class="sec-side-block">
                    <div class="sec-side-head">
                        <span class="sec-side-title">승인 대기 큐</span>
                        <span class="sec-side-meta" id="secQueueSideMeta">0건</span>
                    </div>
                    <div class="sec-side-list" id="secQueueSideList">
                        <div class="sec-side-empty">불러오는 중</div>
                    </div>
                </div>
            </aside>

            </div><!-- /.sec-console-body -->

            <!-- 🖥️ 콘솔 하단 상태 바: 이 화면이 '살아 있는지' 판단할 근거를 항상 노출한다.
                 (자동 갱신 주기 / 마지막 동기화 시각 / 조회 거점 / 접속 계정) -->
            <div class="sec-console-foot">
                <span>${SEC_REFRESH_LABEL}</span>
                <span id="secFootSync">마지막 동기화 --:--:--</span>
                <span>조회 거점 ${empRegion}</span>
                <span class="sec-console-foot-end">${emp.id || emp.name || '-'}</span>
            </div>
        </section>
    </div>
    `;

    fetchSecurityQueue();
    loadSecurityAllLogs();
    loadSecurityOverdue();
    loadSecPassData();      // 🎫 정기권 목록 + 오늘 출입 현황 (사이드바 배지 포함)
    loadSecRegionStatus();  // 🗺️ 우측 패널 거점별 현황 (오늘 · 전 사업장)
    initSecScan();
    secStartConsoleClock();   // 🖥️ 상단 시계 + '동기화 N초 전' 카운터 기동

    if (securityRefreshTimer) clearInterval(securityRefreshTimer);
    securityRefreshTimer = setInterval(() => {
        fetchSecurityQueue(true);
        loadSecurityAllLogs(true);
        loadSecurityOverdue(true);
        loadSecRegionStatus();
    }, SEC_REFRESH_MS);
}

/* ============================================================================
   🖥️ 콘솔 계기(시계 · 동기화 표시 · 시간대별 추이)
   ----------------------------------------------------------------------------
   모두 이미 화면에 있는 데이터로만 그린다. 새 API 를 부르지 않는다.
   ============================================================================ */

let secClockTimer = null;
let secLastSyncAt = null;

// 두 자리 0 채움 (시:분:초 표기용)
function secPad2(n) { return String(n).padStart(2, '0'); }
function secHms(d) { return `${secPad2(d.getHours())}:${secPad2(d.getMinutes())}:${secPad2(d.getSeconds())}`; }

// 1초마다 시계와 '동기화 N초 전'을 함께 갱신한다.
// 화면이 경비실에서 벗어나면(요소 소멸) 스스로 타이머를 정리한다.
function secStartConsoleClock() {
    if (secClockTimer) clearInterval(secClockTimer);
    const tick = () => {
        const clockEl = document.getElementById('secConsoleClock');
        if (!clockEl) { clearInterval(secClockTimer); secClockTimer = null; return; }
        clockEl.textContent = secHms(new Date());
        secRenderSyncAge();
    };
    tick();
    secClockTimer = setInterval(tick, 1000);
}

// 데이터 로드가 성공한 시점을 기록한다. (각 load* 함수가 호출)
function secMarkSync() {
    secLastSyncAt = new Date();
    const footEl = document.getElementById('secFootSync');
    if (footEl) footEl.textContent = `마지막 동기화 ${secHms(secLastSyncAt)}`;
    secRenderSyncAge();
}

// 마지막 동기화 후 경과 시간. 30초를 넘으면 '지연'으로 표시해 멈춘 화면을 구분한다.
function secRenderSyncAge() {
    const el = document.getElementById('secConsoleSync');
    const live = document.getElementById('secConsoleLive');
    if (!el) return;
    if (!secLastSyncAt) { el.textContent = '동기화 대기'; return; }
    const age = Math.max(0, Math.round((Date.now() - secLastSyncAt.getTime()) / 1000));
    el.textContent = `실시간 동기화 · ${age}초 전`;
    // '지연' 판정도 주기에서 파생시킨다. 갱신을 5회 연속 놓치면 멈춘 화면으로 본다.
    //  (주기를 바꿔도 기준이 같이 따라오도록 — 고정 30초로 두면 3초 주기에선 너무 느슨하다)
    const stale = age > (SEC_REFRESH_MS / 1000) * 5;
    el.classList.toggle('is-stale', stale);
    if (live) live.classList.toggle('is-stale', stale);
}

// 📈 금일 시간대별 입실 추이 스파크라인.
//    secLogsAll(전체 기록 탭이 받아 둔 배열)에서 '오늘 + 내 거점 + 입실시각 있음'만 집계한다.
function secRenderTrend() {
    const svg = document.getElementById('secTrendSvg');
    const totalEl = document.getElementById('secTrendTotal');
    const peakEl = document.getElementById('secTrendPeak');
    if (!svg || !Array.isArray(secLogsAll)) return;

    const H_FROM = 6, H_TO = 20;                      // 06시~20시 (경비실 운영 시간대)
    const buckets = new Array(H_TO - H_FROM + 1).fill(0);
    const today = getKstThisWeekRange().todayKst;
    const myRegion = secMyRegion();

    secLogsAll.forEach(v => {
        if (v.visit_date !== today || v.region !== myRegion) return;
        const hour = parseInt(String(secTimeOnly(v.checkin_time)).slice(0, 2), 10);
        if (isNaN(hour) || hour < H_FROM || hour > H_TO) return;
        buckets[hour - H_FROM]++;
    });

    const total = buckets.reduce((a, b) => a + b, 0);
    const max = Math.max(1, ...buckets);              // 0 나눗셈 방지
    const W = 300, H = 40, PAD = 3;
    const step = W / (buckets.length - 1);
    const pts = buckets.map((v, i) => `${(i * step).toFixed(1)},${(H - PAD - (v / max) * (H - PAD * 2)).toFixed(1)}`);

    svg.innerHTML =
        `<polygon points="0,${H} ${pts.join(' ')} ${W},${H}" fill="currentColor" opacity="0.13"></polygon>` +
        `<polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.4"></polyline>`;

    if (totalEl) totalEl.textContent = `${total}명`;
    if (peakEl) {
        const peakIdx = buckets.indexOf(Math.max(...buckets));
        peakEl.textContent = total ? `피크 ${H_FROM + peakIdx}시 (${buckets[peakIdx]}명)` : '기록 없음';
    }
}

// 🗺️ 우측 패널 - 거점별 현황.
//    기록 탭의 날짜·거점 필터에 영향받지 않도록 '오늘 · 전 사업장'을 따로 조회한다.
//    거점 목록은 REGION_LIST(js/common.js)를 기준으로 삼아, 오늘 기록이 없는 거점도 빠뜨리지 않는다.
async function loadSecRegionStatus() {
    const listEl = document.getElementById('secRegionList');
    if (!listEl) return;

    const today = getKstThisWeekRange().todayKst;
    const myRegion = secMyRegion();

    try {
        const res = await fetch(`/api/admin/logs?start_date=${today}&end_date=${today}`);
        if (!res.ok) { listEl.innerHTML = '<div class="sec-side-empty">조회 권한 없음</div>'; return; }
        const logs = await res.json();
        if (!Array.isArray(logs)) { listEl.innerHTML = '<div class="sec-side-empty">조회 불가</div>'; return; }

        const regions = (typeof REGION_LIST !== 'undefined' && REGION_LIST.length)
            ? REGION_LIST
            : [...new Set(logs.map(v => v.region).filter(Boolean))];

        let live = 0;
        listEl.innerHTML = regions.map(rg => {
            const mine = logs.filter(v => v.region === rg);
            const entered = mine.filter(v => v.checkin_time).length;
            const onsite = mine.filter(v => v.status === '입실완료').length;
            // 상태색: 오늘 아무도 안 온 거점만 주의 표시. 정상 운영 중인 곳은 무채색으로 둔다.
            const quiet = entered === 0;
            if (!quiet) live++;
            // 누르면 '출입 기록' 탭으로 이동해 이 거점만 조회한다.
            const arg = `decodeURIComponent('${encodeURIComponent(rg)}')`;
            return `
                <button type="button" class="sec-side-row sec-side-row-btn${rg === myRegion ? ' is-mine' : ''}"
                        onclick="secOpenRegionLogs(${arg})" title="${rg} 출입 기록 보기">
                    <span class="sec-side-row-name">
                        <span class="sec-side-dot${quiet ? ' is-warn' : ' is-ok'}"></span>${rg}
                    </span>
                    <span class="sec-side-row-val">${quiet ? '미출입' : `입실 ${entered} · 재실 ${onsite}`}</span>
                </button>`;
        }).join('');

        const meta = document.getElementById('secRegionMeta');
        if (meta) meta.textContent = `${live}/${regions.length} 운영`;
    } catch (e) {
        listEl.innerHTML = '<div class="sec-side-empty">연동 오류</div>';
    }
}

// 🚨 우측 패널 - 승인 대기 큐. 대기열 표와 같은 목록을 압축해 표시한다.
//    (fetchSecurityQueue 가 데이터를 받은 뒤 호출한다 — 별도 조회 없음)
function secRenderQueueSide(list) {
    const listEl = document.getElementById('secQueueSideList');
    const metaEl = document.getElementById('secQueueSideMeta');
    if (!listEl) return;

    if (metaEl) metaEl.textContent = `${list.length}건`;
    if (!list.length) {
        listEl.innerHTML = '<div class="sec-side-empty">대기 없음</div>';
        return;
    }
    // 오래 기다린 건이 위로 오도록 접수 순(id 오름차순)
    listEl.innerHTML = [...list].sort((a, b) => a.id - b.id).slice(0, 8).map(v => {
        const kind = v.status === '입실대기' ? '입실' : '퇴실';
        return `
            <div class="sec-side-row">
                <span class="sec-side-row-name">
                    <span class="sec-side-dot is-warn"></span>${v.name || '-'}
                </span>
                <span class="sec-side-row-val">${kind} 대기</span>
            </div>`;
    }).join('') + (list.length > 8 ? `<div class="sec-side-more">외 ${list.length - 8}건</div>` : '');
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
    applySecFontScale(secFontScaleRead());   // 저장해 둔 글자 배율 복원
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
    // 🖥️ 콘솔 상단 바에 현재 보고 있는 화면 이름을 반영한다.
    const viewEl = document.getElementById('secConsoleView');
    if (viewEl) {
        viewEl.textContent = { queue: '승인 요청', logs: '출입 기록', overdue: '퇴실 지연', pass: '출입 이용권' }[tab];
    }
    // 정기권 탭은 진입할 때 조회한다(자동 새로고침 대상이 아님 — 변경이 잦지 않다).
    if (tab === 'pass') loadSecPassData();
}

/* 🕗 신청이 접수된 시각. 같은 사람이 두 번 올라온 경우 어느 쪽이 나중 것인지 가려내는 근거가 된다.
   오늘 접수분은 시각만, 지난 날짜는 날짜까지 보여 준다.
   이 컬럼이 생기기 전에 접수된 건은 값이 없어 '-' 로 표시된다. */
function secReqTimeText(createdAt) {
    const v = (createdAt || '').trim();
    if (!v) return '-';
    const d = new Date();
    const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
                + '-' + String(d.getDate()).padStart(2, '0');
    return v.slice(0, 10) === today ? v.slice(11, 16) : v.slice(5, 16);
}

let secQueueCache = [];   // 승인 대기열 원본 (삭제 확인창에서 이름·소속을 찾는 데 쓴다)

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

        secQueueCache = data.list;
        secRenderQueueSide(data.list);   // 🚨 우측 패널 대기 큐도 같은 데이터로 갱신

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
                            그룹 방문객 (총 ${members.length}명 대기중) - 그룹장: ${members[0].name}
                        </td>
                        <td class="p-10">
                            <button onclick="approveSecurityGroup('${gId}', '${actionTarget}')" class="sec-btn-approve ${groupBtnClass}">
                                일괄 ${actionTarget.replace('완료', '')} 승인
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
                        <td class="p-10 ${indentClass}"><b>${v.name}</b>${v.pass_id ? '<span class="sec-pass-tag">출입권</span>' : ''}<br><span class="text-gray-light">${v.company}</span><br><span class="fs-8 sec-req-time">신청 ${secReqTimeText(v.created_at)}</span></td>
                        <td class="p-10">${v.vehicle_no || '-'}</td>
                        <td class="p-10">${formatPhone(v.contact)}</td>
                        <td class="p-10">
                            <b>${managerName}</b><br>
                            ${managerDeptLine}
                        </td>
                        <td class="p-10 sec-queue-actions">
                            <button onclick="approveSecurityAction(${v.id}, '${actionTargetItem}')" class="sec-btn-approve-item ${btnColorClass}">
                                ${actionTargetItem.replace('완료', '')} 승인
                            </button>
                            ${v.status === '입실대기' ? `<button onclick="deleteVisitRequest(${v.id})" class="sec-btn-approve-item bg-gray">삭제</button>` : ''}
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

// 거점 필터를 '값'으로 적용한다. ('' = 전 사업장)
//  - 필터 버튼 클릭과 거점별 현황 클릭이 같은 경로를 타도록 여기로 모았다.
function applySecRegionFilter(region) {
    secRegionFilter = region || '';
    const bar = document.getElementById('secRegionFilterBar');
    if (bar) {
        bar.querySelectorAll('.region-filter-btn').forEach(b =>
            b.classList.toggle('active', (b.dataset.region || '') === secRegionFilter));
    }
    loadSecurityAllLogs();
}

function setSecRegion(btn) {
    if (!btn) return;
    applySecRegionFilter(btn.dataset.region || '');
}

// 🗺️ 우측 '거점별 현황'에서 센터를 누르면 '출입 기록' 탭으로 이동해 그 거점만 조회한다.
function secOpenRegionLogs(region) {
    switchSecTab('logs');
    applySecRegionFilter(region);
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
        secMarkSync();      // 🖥️ 콘솔 상태 바: 이 시각을 '마지막 동기화'로 표시
        secRenderTrend();   // 📈 방금 받은 기록으로 시간대별 추이 다시 그림
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
                        <td class="p-10 col-lo">${v.month_seq != null ? v.month_seq : '-'}</td>
                        <td class="p-10">${v.visit_date}</td>
                        <td class="p-10"><span style="color:#2563eb;font-weight:700;text-decoration:underline;cursor:pointer;" onclick="openVisitorHistory(decodeURIComponent('${encodeURIComponent(v.name||'').replace(/'/g,'%27')}'),decodeURIComponent('${encodeURIComponent(v.contact||'').replace(/'/g,'%27')}'))">${v.name}</span>${v.pass_id ? '<div class="sec-pass-tag-line"><span class="sec-pass-tag">출입권</span></div>' : ''}<div class="fs-8 sec-req-time">신청 ${secReqTimeText(v.created_at)}</div></td>
                        <td class="p-10 col-lo">${formatPhone(v.contact)}</td>
                        <td class="p-10">${v.visit_count != null ? (v.visit_count >= 2 ? `<b class="text-blue">${v.visit_count}회</b>` : `${v.visit_count}회`) : '-'}</td>
                        <td class="p-10">${v.company}</td>
                        <td class="p-10 col-lo"><span class="sec-purpose-badge">${v.purpose}</span></td>
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
                    <td class="p-10 col-lo">${formatPhone(v.contact)}</td>
                    <td class="p-10 col-lo">${v.vehicle_no || '-'}</td>
                    <td class="p-10">${v.manager_text || '-'}</td>
                    <td class="p-10 text-green fw-600">${secTimeOnly(v.checkin_time)}</td>
                    <td class="p-10 col-lo fw-600">${secTimeOnly(v.expected_checkout_dt || v.expected_checkout)}</td>
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

/* 🗑️ 중복 입실 신청 삭제
     그룹 신청에 이미 포함된 사람이 그 사실을 모르고 개별 신청을 또 올리는 경우가 있다.
     그대로 두면 대기열에 두 번 뜨고 방문 횟수도 2회로 잡힌다.
     아직 입실 전인 건만 지운다 — 서버도 '사전예약·입실대기' 로 한 번 더 막는다. */
async function deleteVisitRequest(logId) {
    // 이름·소속은 onclick 에 넣지 않고 여기서 찾는다 (따옴표가 속성을 깨뜨리지 않게)
    const v = (secQueueCache || []).find(x => x.id === logId);
    const who = v ? (v.name + (v.company ? ' (' + v.company + ')' : '')) : '이 신청';
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
    } catch (e) {
        alert('삭제 중 통신 오류가 발생했습니다.');
        return;
    }
    fetchSecurityQueue();
    loadSecurityAllLogs();
    loadSecurityOverdue();
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
    const fail = (msg) => { tbody.innerHTML = `<tr><td colspan="8" class="no-data-box">${msg}</td></tr>`; };

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
        tbody.innerHTML = '<tr><td colspan="8" class="no-data-box">발급된 출입 이용권이 없습니다.</td></tr>';
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
        return `
            <tr class="sec-item-row">
                <td class="p-10"><b>${p.name}</b><br><span class="text-gray-light">${p.company}</span></td>
                <td class="p-10 col-lo">${formatPhone(p.contact)}<br><span class="fs-8 text-gray-light">차량 ${p.vehicle_no || '없음'}</span></td>
                <td class="p-10 col-lo"><span class="sec-purpose-badge">${p.purpose}</span></td>
                <td class="p-10">${p.valid_from}<br>~ ${p.valid_to}${p.period ? `<br><span class="fs-8 text-gray-light">${p.period}</span>` : ''}</td>
                <td class="p-10 col-lo">${secPassWeekdayText(p.weekdays)}</td>
                <td class="p-10 col-lo">${p.auto_approve ? '자동' : '승인'}</td>
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
        const memo = p.memo ? `<br><span class="fs-8 text-gray-light">${p.memo}</span>` : '';
        return `
            <tr class="sec-item-row sec-pass-req-row">
                <td class="p-10"><b>${p.name}</b><br><span class="text-gray-light">${p.company}</span>${memo}</td>
                <td class="p-10 col-lo">${formatPhone(p.contact)}<br><span class="fs-8 text-gray-light">차량 ${p.vehicle_no || '없음'}</span></td>
                <td class="p-10 col-lo"><span class="sec-purpose-badge">${p.purpose}</span></td>
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
        // 종류(정기/수시)는 화면에서 고르지 않는다 — 서버가 신청 시 저장된 값을 그대로 쓴다.
        valid_from: get(`secReqFrom_${passId}`),
        period: get(`secReqPeriod_${passId}`),      // 종료일은 서버가 '시작일 + 단위'로 계산
    };
    const endDate = window.passPeriodEnd(payload.valid_from, payload.period);
    if (!confirm(`${p ? p.name + ' 님의 ' : ''}이용권을 발급합니다.\n유효기간: ${payload.valid_from} ~ ${endDate} (${payload.period})\n\n승인할까요?`)) return;

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
        const summary = document.getElementById('secPassTodaySummary');
        if (summary) {
            summary.textContent = `오늘 ${list.length}건 · 오늘 사용 가능 ${data.active_total}장`;
        }

        tbody.innerHTML = list.length
            ? list.map(v => `
                <tr class="sec-item-row">
                    <td class="p-10"><b>${v.name}</b><br><span class="text-gray-light">${v.company}</span></td>
                    <td class="p-10 col-lo">${v.vehicle_no || '-'}</td>
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
    const kind = '출입권';

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
                <button onclick="downloadSecPassQr(${p.id})" class="btn-list-action bg-blue btn-sec-action">QR 이미지 저장</button>
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
