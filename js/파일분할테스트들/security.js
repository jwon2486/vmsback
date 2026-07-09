/**
 * js/security.js
 * 경비실(보안실) 전용 출입 통제 관제 로직 (연동 액션 완전 수록본)
 */

function showSecurityDashboard() {
    const emp = JSON.parse(sessionStorage.getItem('emp_session'));
    const empRegion = emp.region || '테크센터'; 
    const weekRange = getKstThisWeekRange();
    const container = document.querySelector('.container');
    if (container) container.classList.add('container-wide');
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    
    appCard.classList.remove('card-emp-wide', 'card-guest-wide');
    appCard.classList.add('card-wide', 'card-security-wide');
    
    appCard.innerHTML = `
        <h2 class="zone-title sec-dashboard-title">🛡️ 보안실 출입 관제 대시보드 <span class="sec-region-text">(${empRegion})</span></h2>
        
        <div class="mb-30">
            <div class="sec-live-header">
                <h3 class="sec-live-title">🚨 실시간 승인 대기열</h3>
                <span class="sec-live-indicator"><span class="spinner sec-spinner"></span> 자동 새로고침 중</span>
            </div>
            
            <div class="table-responsive sec-table-container desktop-only-view">
                <table class="modern-table w-100 min-w-700">
                    <thead class="sec-table-head"><tr><th>요청 상태</th><th>방문자 (소속)</th><th>차량 번호</th><th>연락처</th><th>담당자</th><th>출입 승인</th></tr></thead>
                    <tbody id="securityQueueBody"><tr><td colspan="6" class="no-data-box">대기열을 불러오는 중입니다...</td></tr></tbody>
                </table>
            </div>

            <div id="securityQueueMobileList" class="sec-mobile-cards-wrapper mobile-only-view">
                <div class="sec-mobile-empty-card">대기열을 불러오는 중입니다...</div>
            </div>
        </div>
        
        <hr class="sec-divider">
        
        <div>
            <div class="sec-logs-header">
                <h3 class="sec-logs-title">📊 전체 출입 기록 <span class="sec-region-text">(${empRegion})</span></h3>
                <div class="date-range-picker-box">
                    <input type="date" id="secLogStartDate" value="${weekRange.monday}" onchange="loadSecurityAllLogs()">
                    <span class="range-tilde">~</span>
                    <input type="date" id="secLogEndDate" value="${weekRange.friday}" onchange="loadSecurityAllLogs()">
                </div>
            </div>
            
            <div class="table-responsive sec-table-container h-500 desktop-only-view">
                <table class="modern-table w-100 min-w-900">
                    <thead class="sec-table-head"><tr><th>순번</th><th>방문일</th><th>이름</th><th>소속</th><th>방문 목적</th><th>사내 담당자</th><th>입실 시간</th><th>퇴실 시간</th><th>상태</th></tr></thead>
                    <tbody id="secAllLogsBody"><tr><td colspan="9" class="no-data-box">전체 기록을 불러오는 중입니다...</td></tr></tbody>
                </table>
            </div>

            <div id="secAllLogsMobileList" class="sec-mobile-cards-wrapper mobile-only-view">
                <div class="sec-mobile-empty-card">전체 기록을 불러오는 중입니다...</div>
            </div>
        </div>
    `;
    
    fetchSecurityQueue();
    loadSecurityAllLogs();

    if (securityRefreshTimer) clearInterval(securityRefreshTimer);
    securityRefreshTimer = setInterval(() => {
        fetchSecurityQueue(true); loadSecurityAllLogs(true);
    }, 10000);
}

async function fetchSecurityQueue(isAuto = false) {
    try {
        const emp = JSON.parse(sessionStorage.getItem('emp_session'));
        const empRegion = emp ? (emp.region || '테크센터') : '테크센터';
        const res = await fetch(`/api/security/pending-logs?region=${encodeURIComponent(empRegion)}`);
        const data = await res.json();
        
        const tbody = document.getElementById('securityQueueBody');
        const mobileList = document.getElementById('securityQueueMobileList');
        if (!tbody || !mobileList) return; 
        
        if (data.list.length === 0) {
            const emptyHtml = `<div class="sec-mobile-empty-card">현재 [${empRegion}]<br>승인 대기 중인 방문객이 없습니다.</div>`;
            tbody.innerHTML = `<tr><td colspan="6" class="no-data-box">현재 [${empRegion}] 승인 대기 중인 방문객 내역이 없습니다.</td></tr>`;
            mobileList.innerHTML = emptyHtml;
            return;
        }

        const groupedLogs = {};
        data.list.forEach(v => {
            const gId = (!v.group_id || v.group_id === 'NONE') ? v.id : v.group_id;
            if (!groupedLogs[gId]) groupedLogs[gId] = []; groupedLogs[gId].push(v);
        });

        let desktopHtml = '';
        let mobileHtml = '';

        for (const [gId, members] of Object.entries(groupedLogs)) {
            members.sort((a, b) => a.id - b.id);
            const isGroup = members.length > 1;
            const actionTarget = members[0].status === '입실대기' ? '입실완료' : '퇴실완료';

            if (isGroup) {
                desktopHtml += `<tr class="sec-group-row"><td colspan="5" class="sec-group-title">👥 그룹 방문객 (총 ${members.length}명 대기중)</td><td><button onclick="approveSecurityGroup('${gId}', '${actionTarget}')" class="sec-btn-approve">⚡ 일괄 ${actionTarget}</button></td></tr>`;
                mobileHtml += `
                    <div class="sec-m-group-header">
                        <span>👥 단체 예약 (${members.length}명 대기열)</span>
                        <button onclick="approveSecurityGroup('${gId}', '${actionTarget}')" class="sec-m-btn-group-approve">⚡ 일괄 ${actionTarget} 승인</button>
                    </div>`;
            }

            members.forEach(v => {
                const isMatchFailed = v.created_by === 'guard_pending';
                const matchStatusText = isMatchFailed ? '<span style="color:red;font-weight:bold;">수동확인 필요</span>' : '식별완료';

                desktopHtml += `
                    <tr class="sec-item-row">
                        <td><span class="status-badge badge-done">${v.status}</span></td>
                        <td><b>${v.name}</b><br><span>${v.company}</span></td>
                        <td><b>${v.vehicle_no || '-'}</b></td>
                        <td>${v.contact || '-'}</td>
                        <td>${matchStatusText}<br><small>(${v.manager_text})</small></td>
                        <td><button onclick="approveSecurityAction(${v.id}, '${actionTarget}')" class="sec-btn-approve-item">${actionTarget} 승인</button></td>
                    </tr>`;

                mobileHtml += `
                    <div class="sec-m-card ${isGroup ? 'group-bordered' : ''}">
                        <div class="sec-m-card-badge-line">
                            <span class="sec-m-status-badge">${v.status}</span>
                            <span class="sec-m-match">${isMatchFailed ? '⚠️ 데스크 수동 확인' : '✅ 매칭 확인'}</span>
                        </div>
                        <div class="sec-m-card-main-info">
                            <span class="sec-m-name">${v.name}</span> <span class="sec-m-comp">${v.company}</span>
                        </div>
                        <div class="sec-m-card-sub-info">
                            <p>🚘 <b>차량번호:</b> <span class="sec-m-highlight">${v.vehicle_no || '없음'}</span></p>
                            <p>📞 <b>연락처:</b> ${v.contact || '-'}</p>
                            <p>👤 <b>사내 담당자:</b> ${v.manager_text}</p>
                        </div>
                        <div class="sec-m-card-action-zone">
                            <button onclick="approveSecurityAction(${v.id}, '${actionTarget}')" class="sec-m-btn-approve-item ${actionTarget === '입실완료' ? 'bg-green' : 'bg-orange'}">
                                ${actionTarget} 최종 승인
                            </button>
                        </div>
                    </div>`;
            });
        }
        tbody.innerHTML = desktopHtml;
        mobileList.innerHTML = mobileHtml;
    } catch (e) {}
}

async function approveSecurityAction(logId, targetStatus) {
    if (!logId || !targetStatus) return;
    if (!confirm(`선택한 사용자를 [${targetStatus}] 처리하시겠습니까?`)) return;

    try {
        const res = await fetch('/api/security/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: logId, target_status: targetStatus })
        });
        if (res.status === 403) return alert("보안관제 권한이 없습니다.");
        const result = await res.json();
        if (result.success) { fetchSecurityQueue(true); loadSecurityAllLogs(true); }
    } catch (e) { alert("서버 승인 처리 실패"); }
}

async function approveSecurityGroup(groupId, targetStatus) {
    if (!groupId || groupId === 'NONE' || !targetStatus) return;
    if (!confirm(`해당 단체 인원 전체를 일괄 [${targetStatus}] 승인하십니까?`)) return;

    try {
        const res = await fetch('/api/security/approve-group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group_id: groupId, target_status: targetStatus })
        });
        const result = await res.json();
        if (result.success) { fetchSecurityQueue(true); loadSecurityAllLogs(true); }
    } catch (e) { alert("서버 일괄 승인 실패"); }
}

async function loadSecurityAllLogs(isAuto = false) {
    const startDate = document.getElementById('secLogStartDate').value;
    const endDate = document.getElementById('secLogEndDate').value;
    const tbody = document.getElementById('secAllLogsBody');
    const mobileList = document.getElementById('secAllLogsMobileList');
    if (!tbody || !mobileList) return;
    
    try {
        const res = await fetch(`/api/admin/logs?start_date=${startDate}&end_date=${endDate}`);
        const logs = await res.json();
        
        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="no-data-box">지정 범위 내 데이터가 없습니다.</td></tr>';
            mobileList.innerHTML = '<div class="sec-mobile-empty-card">선택 기간 내 출입 기록 기록이 존재하지 않습니다.</div>';
            return;
        }

        let desktopHtml = '';
        let mobileHtml = '';

        logs.forEach(v => {
            desktopHtml += `
                <tr class="border-bottom-eee">
                    <td><b>${v.id}</b></td>
                    <td>${v.visit_date}</td>
                    <td><b>${v.name}</b></td>
                    <td>${v.company}</td>
                    <td><span class="sec-purpose-badge">${v.purpose}</span></td>
                    <td>${v.emp_name || '-'}</td>
                    <td style="color:#10b981;font-weight:bold;">${v.checkin_time || '-'}</td>
                    <td style="color:#ef4444;font-weight:bold;">${v.checkout_time || '-'}</td>
                    <td><b>${v.status}</b></td>
                </tr>`;

            mobileHtml += `
                <div class="sec-m-log-card">
                    <div class="sec-m-log-top">
                        <span class="sec-m-log-id">No.${v.id}</span>
                        <span class="sec-m-log-date">📅 ${v.visit_date}</span>
                    </div>
                    <div class="sec-m-log-visitor">
                        <strong>${v.name}</strong> <small>(${v.company})</small>
                    </div>
                    <div class="sec-m-log-details">
                        <p>🎯 <b>목적:</b> ${v.purpose} | 👤 <b>담당:</b> ${v.emp_name || '-'}</p>
                        <div class="sec-m-log-times">
                            <span class="t-in">📥 입실: ${v.checkin_time || '-'}</span>
                            <span class="t-out">📤 퇴실: ${v.checkout_time || '-'}</span>
                        </div>
                    </div>
                    <div class="sec-m-log-status">상태: <b>${v.status}</b></div>
                </div>`;
        });
        tbody.innerHTML = desktopHtml;
        mobileList.innerHTML = mobileHtml;
    } catch (e) {}
}