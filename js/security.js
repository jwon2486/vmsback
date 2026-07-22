/**
 * js/security.js
 * 보안실 출입 관제 및 대면 승인 처리 (인라인 CSS 완벽 제거)
 */

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
            </nav>
            <div class="sec-erp-sidebar-action">
                <button onclick="toggleSecRegForm()" class="btn-list-action bg-blue btn-sec-action w-100">➕ 방문객 수동 예약</button>
            </div>
        </aside>

        <section class="sec-erp-content">
            <div class="sec-scan-bar">
                <span class="sec-scan-icon">📷</span>
                <input id="secScanInput" class="sec-scan-input" autocomplete="off"
                       placeholder="QR 스캔 대기 — 리더기로 방문객 QR을 스캔하세요 (수동 입력 후 Enter 도 가능)">
                <span id="secScanResult" class="sec-scan-result"></span>
            </div>
            <div class="sec-stat-grid">
                <div class="sec-stat-card stat-pending">
                    <span class="sec-stat-label">🚨 승인 대기</span>
                    <span class="sec-stat-value" id="secStatPending">-</span>
                </div>
                <div class="sec-stat-card stat-onsite">
                    <span class="sec-stat-label">🏢 현재 재실중</span>
                    <span class="sec-stat-value" id="secStatOnsite">-</span>
                </div>
                <div class="sec-stat-card stat-overdue">
                    <span class="sec-stat-label">⏰ 퇴실 지연</span>
                    <span class="sec-stat-value" id="secStatOverdue">-</span>
                </div>
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
                                <th class="p-10">요청 상태</th>
                                <th class="p-10">방문자 (소속)</th>
                                <th class="p-10">차량 번호</th>
                                <th class="p-10">연락처</th>
                                <th class="p-10">담당자 매칭</th>
                                <th class="p-10">승인 액션</th>
                            </tr>
                        </thead>
                        <tbody id="securityQueueBody">
                            <tr><td colspan="6" class="no-data-box">대기열을 불러오는 중입니다...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div id="secPanelLogs" class="sec-tab-panel">
                <div class="sec-logs-header">
                    <h3 class="sec-logs-title">📊 전체 출입 기록 <span class="sec-region-text">(${empRegion})</span></h3>
                    <div class="date-range-picker-box flex-center-gap">
                        <input type="date" id="secLogStartDate" value="${weekRange.todayKst}" onchange="loadSecurityAllLogs()" class="sec-date-input">
                        <span class="range-tilde">~</span>
                        <input type="date" id="secLogEndDate" value="${weekRange.todayKst}" onchange="loadSecurityAllLogs()" class="sec-date-input">
                    </div>
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
                                <th class="p-10">사내 담당자</th>
                                <th class="p-10">입실 시간</th>
                                <th class="p-10">퇴실 시간</th>
                                <th class="p-10">상태</th>
                            </tr>
                        </thead>
                        <tbody id="secAllLogsBody">
                            <tr><td colspan="11" class="no-data-box">전체 기록을 불러오는 중입니다...</td></tr>
                        </tbody>
                    </table>
                </div>
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
                <p class="sec-overdue-hint">💡 퇴실 예정시간이 지났는데 아직 퇴실 처리(입실완료 상태)가 안 된 방문객입니다. 기본은 오늘 기준이며, 날짜를 조정하면 해당 범위로 조회합니다.</p>
                <div class="table-responsive sec-table-container h-500">
                    <table class="modern-table w-100 min-w-900">
                        <thead class="sec-table-head">
                            <tr>
                                <th class="p-10">방문일</th>
                                <th class="p-10">이름 (소속)</th>
                                <th class="p-10">연락처</th>
                                <th class="p-10">차량 번호</th>
                                <th class="p-10">사내 담당자</th>
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
        </section>
    </div>
    `;
    
    fetchSecurityQueue();
    loadSecurityAllLogs();
    loadSecurityOverdue();
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
}

async function secSubmitScan(raw) {
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
    };
    if (!map[tab]) tab = 'queue';
    Object.keys(map).forEach(key => {
        const panel = document.getElementById(map[key].panel);
        const menu = document.getElementById(map[key].menu);
        const on = (key === tab);
        if (panel) panel.classList.toggle('active', on);
        if (menu) menu.classList.toggle('active', on);
    });
}

async function fetchSecurityQueue(isAuto = false) {
    try {
        const emp = JSON.parse(sessionStorage.getItem('emp_session'));
        const empRegion = emp ? (emp.region || '테크센터') : '테크센터';
        
        const res = await fetch(`/api/security/pending-logs?region=${encodeURIComponent(empRegion)}`);
        const data = await res.json();
        const tbody = document.getElementById('securityQueueBody');
        if (!tbody) return; 

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
            tbody.innerHTML = `<tr><td colspan="6" class="no-data-box">현재 [${empRegion}] 승인 대기 중인 방문객 내역이 없습니다.</td></tr>`;
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
                        <td colspan="5" class="sec-group-title">
                            👥 그룹 방문객 (총 ${members.length}명 대기중) - 그룹장: ${members[0].name}
                        </td>
                        <td class="p-10">
                            <button onclick="approveSecurityGroup('${gId}', '${actionTarget}')" class="sec-btn-approve ${groupBtnClass}">
                                ⚡ 일괄 ${actionTarget}
                            </button>
                        </td>
                    </tr>
                `;
            }

            members.forEach(v => {
                const isMatchFailed = v.created_by === 'guard_pending';
                const actionTargetItem = v.status === '입실대기' ? '입실완료' : '퇴실완료';
                const btnColorClass = v.status === '입실대기' ? 'bg-green' : 'bg-orange';
                const matchStatusText = isMatchFailed 
                    ? '<span class="sec-match-fail">수동확인 필요</span>' 
                    : '<span class="sec-match-success">식별완료</span>';
                
                const indentClass = isGroup ? 'sec-indent' : '';
                const bgClass = isGroup ? 'sec-item-grouped' : '';

                html += `
                    <tr class="sec-item-row ${bgClass}">
                        <td class="p-10 ${indentClass}"><span class="status-badge badge-done">${v.status}</span></td>
                        <td class="p-10"><b>${v.name}</b><br><span class="text-gray-light">${v.company}</span></td>
                        <td class="p-10">${v.vehicle_no || '-'}</td>
                        <td class="p-10">${v.contact || '-'}</td>
                        <td class="p-10">
                            ${matchStatusText}<br>
                            <span class="fs-8">(고객 입력: ${v.manager_text})</span>
                        </td>
                        <td class="p-10">
                            <button onclick="approveSecurityAction(${v.id}, '${actionTargetItem}')" class="sec-btn-approve-item ${btnColorClass}">
                                ${actionTargetItem} 승인
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

async function loadSecurityAllLogs(isAuto = false) {
    const startDateEl = document.getElementById('secLogStartDate');
    const endDateEl = document.getElementById('secLogEndDate');
    const tbody = document.getElementById('secAllLogsBody');
    if (!tbody || !startDateEl || !endDateEl) return;
    
    if (!isAuto) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center-p20-gray">기록 내역을 불러오는 중입니다...</td></tr>';
    }
    
    try {
        const res = await fetch(`/api/admin/logs?start_date=${startDateEl.value}&end_date=${endDateEl.value}`);
        if (res.status === 401 || res.status === 403) {
            tbody.innerHTML = '<tr><td colspan="10" class="text-center-p20-red">조회 권한이 만료되었습니다. 재로그인 해주세요.</td></tr>';
            if (securityRefreshTimer) clearInterval(securityRefreshTimer);
            return;
        }

        const logs = await res.json();

        // 상단 요약 통계: 조회 기간 내 '입실완료'(=아직 퇴실 안 함) 인원 → 현재 재실중
        const onsiteEl = document.getElementById('secStatOnsite');
        if (onsiteEl) onsiteEl.textContent = logs.filter(v => v.status === '입실완료').length;

        // 순번: 서버가 계산한 '그 달 절대 순번'(month_seq)을 사용.
        //  - 날짜 필터와 무관하게 매달 1일부터의 절대 위치이므로, 마지막 주만 조회해도 85~100 처럼 표시됨.
        //  - 표시는 최신순(방문일→id 내림차순): 최근 방문이 맨 위.
        const sorted = [...logs].sort((a, b) => {
            if (a.visit_date !== b.visit_date) return a.visit_date > b.visit_date ? -1 : 1;
            return (b.id || 0) - (a.id || 0);
        });

        let html = '';
        if (sorted.length === 0) {
            html = '<tr><td colspan="11" class="text-center-p20-gray">해당 날짜에 조회된 출입 데이터가 없습니다.</td></tr>';
        } else {
            sorted.forEach(v => {
                const managerDisplay = v.emp_name
                    ? `${v.emp_name} <span class="text-gray-light">(${v.emp_dept || '부서없음'})</span>` 
                    : '<span class="text-gray-lighter">-</span>'; 
                
                html += `
                    <tr class="border-bottom-eee">
                        <td class="p-10">${v.month_seq != null ? v.month_seq : '-'}</td>
                        <td class="p-10">${v.visit_date}</td>
                        <td class="p-10"><span style="color:#2563eb;font-weight:700;text-decoration:underline;cursor:pointer;" onclick="openVisitorHistory(decodeURIComponent('${encodeURIComponent(v.name||'').replace(/'/g,'%27')}'),decodeURIComponent('${encodeURIComponent(v.contact||'').replace(/'/g,'%27')}'))">${v.name}</span></td>
                        <td class="p-10">${v.contact || '-'}</td>
                        <td class="p-10">${v.visit_count != null ? (v.visit_count >= 2 ? `<b class="text-blue">${v.visit_count}회</b>` : `${v.visit_count}회`) : '-'}</td>
                        <td class="p-10">${v.company}</td>
                        <td class="p-10"><span class="sec-purpose-badge">${v.purpose}</span></td>
                        <td class="p-10">${managerDisplay}</td>
                        <td class="p-10 text-green fw-600">${v.checkin_time || '-'}</td>
                        <td class="p-10 text-red fw-600">${v.checkout_time || '-'}</td>
                        <td class="p-10"><b>${v.status}</b></td>
                    </tr>
                `;
            });
        }
        tbody.innerHTML = html;
    } catch (e) {
        if (!isAuto) {
            tbody.innerHTML = '<tr><td colspan="10" class="text-center-p20-red">데이터 연동 에러가 발생했습니다.</td></tr>';
        }
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
                    <td class="p-10">${v.contact || '-'}</td>
                    <td class="p-10">${v.vehicle_no || '-'}</td>
                    <td class="p-10">${v.manager_text || '-'}</td>
                    <td class="p-10 text-green fw-600">${v.checkin_time || '-'}</td>
                    <td class="p-10 fw-600">${v.expected_checkout_dt || (v.expected_checkout || '-')}</td>
                    <td class="p-10"><span class="sec-overdue-badge">🔴 ${fmtDelay(v.overdue_minutes)} 초과</span></td>
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
    if(!force && !confirm(`대면 확인을 완료하셨습니까? 현 시점 기준으로 ${targetStatus} 승인 처리됩니다.`)) return;
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
    if(!force && !confirm(`해당 그룹 인원 중 '대기상태'인 사람 전체를 일괄 ${targetStatus} 처리 하시겠습니까?`)) return;
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