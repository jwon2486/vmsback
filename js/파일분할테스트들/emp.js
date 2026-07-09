/**
 * js/emp.js
 * 일반 사원용 사전 예약 관제 로직
 */

function showEmpLoginForm() {
    resetWideLayout(); 
    const appCard = document.getElementById('app-card');
    if (!appCard) return;

    const savedId = localStorage.getItem('remember_emp_id') || '';
    const savedName = localStorage.getItem('remember_emp_name') || '';
    const isChecked = savedId && savedName ? 'checked' : '';
    const utilityNav = document.getElementById('utility-nav');
    if (utilityNav) {
        utilityNav.classList.remove('display-flex');
        utilityNav.classList.add('display-none');
    }

    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">🔒 시스템 로그인</h2>
        <div class="form-container form-container-verify-margin">
            <div class="input-row-group">
                <div class="input-group"><label>사원 번호 (사번)</label><input type="text" id="empId" placeholder="사번 입력" value="${savedId}"></div>
                <div class="input-group"><label>성명</label><input type="text" id="empName" placeholder="본인 성함 입력" value="${savedName}"></div>
            </div>
            <div class="remember-me-box remember-checkbox-layout-style">
                <input type="checkbox" id="rememberMe" ${isChecked} class="remember-checkbox-size">
                <label for="rememberMe" class="remember-label-pointer">로그인 정보 저장</label>
            </div>
        </div>
        <div class="action-buttons"><button onclick="handleEmpLogin()" class="btn-emp-main">인증 및 로그인</button></div>
    `;

    const rememberCheckbox = document.getElementById('rememberMe');
    if (rememberCheckbox) {
        rememberCheckbox.addEventListener('change', (event) => {
            if (!event.target.checked) {
                localStorage.removeItem('remember_emp_id');
                localStorage.removeItem('remember_emp_name');
                const empIdInput = document.getElementById('empId');
                const empNameInput = document.getElementById('empName');
                if (empIdInput) empIdInput.value = '';
                if (empNameInput) empNameInput.value = '';
            }
        });
    }
}

async function handleEmpLogin() {
    const empIdInput = document.getElementById('empId');
    const empNameInput = document.getElementById('empName');
    if (!empIdInput || !empNameInput) return;
    const id = empIdInput.value.trim();
    const name = empNameInput.value.trim();
    const rememberMe = document.getElementById('rememberMe').checked;
    if (!id || !name) return alert('사번과 성명을 모두 입력해 주세요.');
    
    try {
        const res = await fetch('/api/emp/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name })
        });
        const result = await res.json();
        if (result.success) {
            sessionStorage.setItem('emp_session', JSON.stringify(result.employee));
            if (rememberMe) {
                localStorage.setItem('remember_emp_id', id);
                localStorage.setItem('remember_emp_name', name);
            } else {
                localStorage.removeItem('remember_emp_id');
                localStorage.removeItem('remember_emp_name');
                empIdInput.value = '';
                empNameInput.value = '';
            }
            window.location.reload();
        } else { alert(result.message); }
    } catch (e) { alert('로그인 통신 중 오류가 발생했습니다.'); }
}

function handleEmpLogout() {
    if (securityRefreshTimer) clearInterval(securityRefreshTimer);
    sessionStorage.removeItem('emp_session');
    window.location.reload();
}

function showIntegratedEmpDashboard() {
    const emp = JSON.parse(sessionStorage.getItem('emp_session'));
    const weekRange = getKstThisWeekRange(); 
    const today = weekRange.todayKst; 
    const empRegion = emp.region || '테크센터';
    const container = document.querySelector('.container');
    if (container) container.classList.add('container-wide');
    const appCard = document.getElementById('app-card');
    if (!appCard || !emp) return;
    
    appCard.classList.remove('card-guest-wide', 'card-security-wide');
    appCard.classList.add('card-wide', 'card-emp-wide');
    window.empCompanionCount = 0; 

    appCard.innerHTML = `
        <div class="mobile-tabs">
            <button class="mobile-tab-btn active" id="tab-btn-form" onclick="switchMobileTab('form')">📋 예약 하기</button>
            <button class="mobile-tab-btn" id="tab-btn-list" onclick="switchMobileTab('list')">📅 나의 예약</button>
        </div>
        <div class="dashboard-split-wrapper">
            <div class="dashboard-form-zone mobile-tab-content active" id="emp-form-zone">
                <h3 class="zone-title desktop-only-title">📋 새 방문객 예약 <span class="region-badge-success">(${empRegion})</span></h3>
                <div class="form-container form-container-flush">
                    <input type="hidden" id="proxyStaffId" value="${emp.id}">
                    <div class="input-group"><label>방문 일자 *</label><input type="date" id="visitDate" value="${today}"></div>
                    <div class="input-row-group">
                        <div class="input-group"><label>방문객 이름 *</label><input type="text" id="vName" placeholder="성함 입력" autocomplete="off"></div>
                        <div class="input-group"><label>방문객 연락처 *</label><input type="text" id="vContact" placeholder="- 없이 숫자만 입력" autocomplete="off"></div>
                    </div>
                    <div class="input-row-group">
                        <div class="input-group"><label>소속 회사명 *</label><input type="text" id="vCompany" placeholder="회사명 입력" autocomplete="off"></div>
                        <div class="input-group"><label>차량 번호</label><input type="text" id="vVehicle" placeholder="없을 시 비워두세요" autocomplete="off"></div>
                    </div>
                    <div class="input-group">
                        <label>방문 목적 *</label><input type="hidden" id="vPurpose" value="회의/미팅">
                        <div class="purpose-button-group">
                            <button type="button" class="btn-choice active" onclick="selectPurpose(this, '회의/미팅', 'vPurpose')">🤝 회의/미팅</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '제품 납품', 'vPurpose')">📦 제품 납품</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '상차/하차', 'vPurpose')">🚚 상차/하차</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '품질 검사', 'vPurpose')">🔍 품질 검사</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '시설 점검', 'vPurpose')">🛠️ 시설 점검</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '기타 업무', 'vPurpose')">📁 기타 업무</button>
                        </div>
                    </div>
                    <button type="button" onclick="openSheetAndAddFirst('emp')" class="btn-guest-sub btn-add-comp-outline mt-15">➕ 동반 일행 추가 (선택)</button>
                    <button onclick="submitNewSchedule()" class="btn-emp-main btn-main-shadow">사전 예약 등록</button>
                </div>
            </div>
            <div class="dashboard-divider-line display-none" id="emp-divider-comp"></div>
            <div class="bs-overlay" onclick="closeCompanionSheet()"></div>
            <div class="dashboard-form-zone companion-zone-panel bs-sheet display-none" id="emp-companion-zone">
                <div class="bs-handle" onclick="closeCompanionSheet()"></div>
                <div class="comp-zone-header"><h3 class="zone-title my-title-color fs-105">👥 동반 일행 입력</h3><button type="button" onclick="clearAllEmpCompanions()" class="btn-comp-clear">전체 취소</button></div>
                <div id="emp-companion-container" class="comp-scroll-container"></div>
                <button type="button" onclick="addEmpCompanionField()" class="btn-guest-sub btn-add-comp-outline-solid mt-10">➕ 인원 계속 추가</button>
                <button type="button" onclick="closeCompanionSheet()" class="btn-emp-main mobile-bs-close mt-15">입력 완료 (닫기)</button>
            </div>
            <div class="dashboard-divider-line" id="emp-divider-line"></div>
            <div class="dashboard-list-zone mobile-tab-content" id="emp-list-zone">
                <div class="list-header-row dept-header-column">
                    <h3 class="zone-title my-title-color">📅 나의 예약</h3>
                    <div class="date-range-picker-box picker-box-full">
                        <input type="date" id="myStartDate" value="${weekRange.monday}" onchange="fetchFilteredMySchedule()" class="picker-date-input">
                        <span class="range-tilde-text">~</span>
                        <input type="date" id="myEndDate" value="${weekRange.friday}" onchange="fetchFilteredMySchedule()" class="picker-date-input">
                    </div>
                </div>
                <div id="my-schedule-list" class="results-container schedule-list-scroll-box"><div class="no-data-box"><p>내역 동기화 중...</p></div></div>
            </div>
        </div>
    `;
    fetchFilteredMySchedule();
}

function addEmpCompanionField() {
    const zone = document.getElementById('emp-companion-zone');
    const divider = document.getElementById('emp-divider-comp');
    if (zone) { zone.classList.remove('display-none'); zone.classList.add('display-block'); }
    if (divider) { divider.classList.remove('display-none'); divider.classList.add('display-block'); }

    window.empCompanionCount = (window.empCompanionCount || 0) + 1;
    const id = 'emp-comp-box-' + Date.now() + '-' + window.empCompanionCount;
    const container = document.createElement('div');
    container.id = id;
    container.className = 'companion-box form-container-verify-margin companion-box-style';
    container.innerHTML = `
        <button type="button" onclick="removeEmpCompanionField('${id}')" class="btn-comp-delete">삭제</button>
        <h4 class="comp-title-blue">👤 동반 방문객 ${window.empCompanionCount}</h4>
        <div class="input-row-group mb-10">
            <div class="input-group"><label class="fs-8">성명 *</label><input type="text" class="emp-comp-name comp-input-style" placeholder="동반인 성명"></div>
            <div class="input-group"><label class="fs-8">연락처 *</label><input type="text" class="emp-comp-contact comp-input-style" placeholder="- 없이 숫자만"></div>
        </div>
        <div class="input-row-group mb-0">
            <div class="input-group"><label class="fs-8">소속 회사명</label><input type="text" class="emp-comp-company comp-input-style" placeholder="미입력시 대표자와 동일"></div>
            <div class="input-group"><label class="fs-8">차량 번호</label><input type="text" class="emp-comp-vehicle comp-input-style" placeholder="없을시 공백"></div>
        </div>
    `;
    document.getElementById('emp-companion-container').appendChild(container);
}

function removeEmpCompanionField(id) { document.getElementById(id).remove(); checkEmpCompanionEmpty(); }
function clearAllEmpCompanions() { document.getElementById('emp-companion-container').innerHTML = ''; window.empCompanionCount = 0; checkEmpCompanionEmpty(); }
function checkEmpCompanionEmpty() {
    const container = document.getElementById('emp-companion-container');
    const zone = document.getElementById('emp-companion-zone');
    const divider = document.getElementById('emp-divider-comp');
    if (container && container.querySelectorAll('.companion-box').length === 0) {
        if (zone) { zone.classList.remove('display-block'); zone.classList.add('display-none'); }
        if (divider) { divider.classList.remove('display-block'); divider.classList.add('display-none'); }
        window.empCompanionCount = 0;
    }
}

async function fetchFilteredMySchedule() {
    const emp = JSON.parse(sessionStorage.getItem('emp_session'));
    const myListDiv = document.getElementById('my-schedule-list');
    if (!myListDiv || !emp) return;
    const myStart = document.getElementById('myStartDate') ? document.getElementById('myStartDate').value : '';
    const myEnd = document.getElementById('myEndDate') ? document.getElementById('myEndDate').value : '';
    
    try {
        const res = await fetch(`/api/emp/my-schedule/${emp.id}?my_start=${myStart}&my_end=${myEnd}`);
        if (res.status === 401) { alert("보안 세션이 만료되었습니다. 다시 로그인해 주세요."); handleEmpLogout(); return; }
        const data = await res.json();
        if (data.success) {
            if (data.my_list && data.my_list.length > 0) {
                globalCachedList = data.my_list; currentSchedulePage = 1; renderScheduleItems();
            } else {
                globalCachedList = []; myListDiv.innerHTML = `<div class="no-data-box"><p>선택 기간 내 나의 스케줄이 없습니다.</p></div>`;
            }
        }
    } catch (e) { myListDiv.innerHTML = '<div class="no-data-box"><p class="sync-error-text">동기화 오류가 발생했습니다.</p></div>'; }
}

function renderScheduleItems() {
    const myListDiv = document.getElementById('my-schedule-list');
    if (!myListDiv) return;
    const isMobile = window.innerWidth <= 640;
    const pageLimit = isMobile ? MOBILE_PAGE_LIMIT : PC_PAGE_LIMIT;

    const groupedLogs = {};
    globalCachedList.forEach(v => {
        const gId = (!v.group_id || v.group_id === 'NONE') ? v.id : v.group_id;
        if (!groupedLogs[gId]) groupedLogs[gId] = [];
        groupedLogs[gId].push(v);
    });

    const groupKeys = Object.keys(groupedLogs);
    const totalGroups = groupKeys.length;
    const totalPages = Math.ceil(totalGroups / pageLimit) || 1;
    if (currentSchedulePage > totalPages) currentSchedulePage = totalPages;
    if (currentSchedulePage < 1) currentSchedulePage = 1;

    const pagedKeys = groupKeys.slice((currentSchedulePage - 1) * pageLimit, currentSchedulePage * pageLimit);
    let html = '';
    
    pagedKeys.forEach(gId => {
        const members = groupedLogs[gId]; members.sort((a, b) => a.id - b.id);
        const isGroup = members.length > 1;

        if (isGroup) {
            const canCheckin = members.some(m => m.status === '사전예약');
            const canCheckout = members.some(m => m.status === '입실완료');
            let groupActionHtml = '';
            if (canCheckin) {
                groupActionHtml += `<button onclick="handleStaffGroupAction('${gId}', 'checkin')" class="btn-list-action bg-blue">일괄 입실</button>`;
                groupActionHtml += `<button onclick="handleStaffGroupAction('${gId}', 'cancel')" class="btn-cancel-outline">일괄 취소</button>`;
            }
            if (canCheckout) groupActionHtml += `<button onclick="handleStaffGroupAction('${gId}', 'checkout')" class="btn-list-action bg-orange">일괄 퇴실</button>`;

            html += `<div class="group-schedule-card"><div class="group-schedule-header"><strong class="text-gray-dark fs-9">👥 그룹 방문객 (${members.length}명)</strong><div class="group-action-wrapper">${groupActionHtml}</div></div>`;
        }

        const subGroups = {};
        members.forEach(m => {
            const key = `${m.status}_${m.checkin_time || ''}_${m.checkout_time || ''}_${m.purpose}`;
            if (!subGroups[key]) subGroups[key] = [];
            subGroups[key].push(m);
        });

        for (const [key, subMembers] of Object.entries(subGroups)) {
            const v = subMembers[0]; const isCombined = subMembers.length > 1;
            let actionHtml = '';
            
            if (v.status === '사전예약') {
                actionHtml = isCombined ? `<button onclick="toggleIndividualPanel('${key}')" class="btn-list-action" style="background:#64748b;">개별 신청</button>` : `<button onclick="handleStaffDirectCheckin(${v.id}, '${v.name}')" class="btn-list-action bg-blue">입실 요청</button><button onclick="handleStaffCancelSchedule(${v.id}, '${v.name}')" class="btn-cancel-outline">취소</button>`;
            } else if (v.status === '입실대기') { actionHtml = `<span class="status-badge badge-waiting">입실 대기중</span>`; }
              else if (v.status === '입실완료') { actionHtml = isCombined ? `<button onclick="toggleIndividualPanel('${key}')" class="btn-list-action" style="background:#64748b;">개별 신청</button>` : `<button onclick="handleStaffDirectCheckout(${v.id}, '${v.name}')" class="btn-list-action bg-orange">퇴실 요청</button>`; }
              else if (v.status === '퇴실대기') { actionHtml = `<span class="status-badge badge-waiting">퇴실 대기중</span>`; }
              else { actionHtml = `<span class="status-badge badge-done">${v.status}</span>`; }
            
            let timeHtml = '';
            if (v.checkin_time) timeHtml += `<div class="time-checkin">입실: ${v.checkin_time}</div>`;
            if (v.checkout_time) timeHtml += `<div class="time-checkout">퇴실: ${v.checkout_time}</div>`;
            
            const companyGroups = {};
            subMembers.forEach(m => {
                if (!companyGroups[m.company || '소속 미상']) companyGroups[m.company || '소속 미상'] = [];
                companyGroups[m.company || '소속 미상'].push(`<b>${m.name}</b>`);
            });
            const combinedNamesHtml = Object.entries(companyGroups).map(([comp, names]) => `${names.join(', ')} <span class="corp-sub-text corp-label-font-size">(${comp})</span>`).join(', &nbsp;&nbsp;');

            let individualRowsHtml = '';
            if (isCombined) {
                individualRowsHtml = `<div id="ind-panel-${key}" class="display-none" style="width:100%; background:#f8fafc; border-top:1px dashed #cbd5e1; padding:8px 10px; margin-top:8px; border-radius:6px;">`;
                subMembers.forEach(m => {
                    let indBtnHtml = m.status === '사전예약' ? `<button onclick="handleStaffDirectCheckin(${m.id}, '${m.name}')" class="btn-list-action bg-blue" style="padding:2px 6px !important;">입실</button>` : `<span class="status-badge badge-done">${m.status}</span>`;
                    individualRowsHtml += `<div style="display:flex; justify-content:space-between; padding:4px 0;"><span>${m.name} (${m.company})</span><div>${indBtnHtml}</div></div>`;
                });
                individualRowsHtml += `</div>`;
            }

            html += `<div class="result-item-schedule schedule-item-card-padding ${isGroup ? 'group-member-item' : 'normal-member-item'}"><div class="item-info"><div>${combinedNamesHtml}</div><div class="item-sub-desc">📅 ${v.visit_date} | ${v.purpose}</div>${timeHtml}</div><div class="item-action-zone">${actionHtml}</div>${individualRowsHtml}</div>`;
        }
        if (isGroup) html += `</div>`;
    });

    if (totalPages > 1) {
        html += `<div class="pagination-nav-bar" style="display:flex; justify-content:center; gap:12px; margin-top:15px;"><button onclick="changeSchedulePage(${currentSchedulePage - 1})" ${currentSchedulePage === 1 ? 'disabled' : ''}>이전</button><span>${currentSchedulePage} / ${totalPages}</span><button onclick="changeSchedulePage(${currentSchedulePage + 1})" ${currentSchedulePage === totalPages ? 'disabled' : ''}>다음</button></div>`;
    }
    myListDiv.innerHTML = html;
}

function changeSchedulePage(targetPage) { currentSchedulePage = targetPage; renderScheduleItems(); }
function toggleIndividualPanel(key) { const panel = document.getElementById(`ind-panel-${key}`); panel.classList.toggle('display-none'); }

async function submitNewSchedule() {
    const visit_date = document.getElementById('visitDate').value;
    const name = document.getElementById('vName').value.trim();
    const contact = document.getElementById('vContact').value.trim();
    const company = document.getElementById('vCompany').value.trim();
    const vehicle_no = document.getElementById('vVehicle').value.trim() || '없음';
    const purpose = document.getElementById('vPurpose').value;
    const created_by = document.getElementById('proxyStaffId').value;
    if (!visit_date || !name || !contact || !company) return alert('필수 입력란을 모두 채워주세요.');

    let visitorsArray = [{ visit_date, name, contact, company, vehicle_no, purpose }];
    document.querySelectorAll('.emp-comp-name').forEach((el, i) => {
        const cName = el.value.trim();
        if (cName) {
            visitorsArray.push({
                visit_date, name: cName,
                contact: document.querySelectorAll('.emp-comp-contact')[i].value.trim(),
                company: document.querySelectorAll('.emp-comp-company')[i].value.trim() || company,
                vehicle_no: document.querySelectorAll('.emp-comp-vehicle')[i].value.trim() || '없음',
                purpose
            });
        }
    });

    try {
        const res = await fetch('/api/emp/group-preregister', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitors: visitorsArray, created_by, region: currentRegion })
        });
        const result = await res.json();
        if (result.success) {
            alert(result.message); document.getElementById('vName').value = ''; clearAllEmpCompanions(); fetchFilteredMySchedule();
        }
    } catch (e) { alert('스케줄 저장 통신에 실패했습니다.'); }
}

function switchMobileTab(tabId) {
    document.getElementById('emp-form-zone').classList.toggle('active', tabId === 'form');
    document.getElementById('emp-list-zone').classList.toggle('active', tabId === 'list');
    document.getElementById('tab-btn-form').classList.toggle('active', tabId === 'form');
    document.getElementById('tab-btn-list').classList.toggle('active', tabId === 'list');
}

/**
 * 임직원 스케줄: 개별 입실 요청 처리 함수
 */
async function handleStaffDirectCheckin(logId, name) {
    if (!logId) return;
    try {
        const res = await fetch('/api/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: logId, region: currentRegion })
        });

        if (res.status === 401) {
            alert("보안 세션이 만료되었습니다. 다시 로그인해 주세요.");
            handleEmpLogout();
            return;
        }

        const result = await res.json();
        if (result.success) {
            alert(`${name}님의 입실 요청이 완료되었습니다.\n보안실 승인을 대기합니다.`);
            fetchFilteredMySchedule(); // 목록 새로고침
        } else {
            alert(result.message || "입실 요청 중 오류가 발생했습니다.");
        }
    } catch (e) {
        alert("서버 통신 오류가 발생했습니다.");
    }
}

/**
 * 임직원 스케줄: 개별 퇴실 요청 처리 함수
 */
async function handleStaffDirectCheckout(logId, name) {
    if (!logId) return;
    try {
        const res = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: logId })
        });

        if (res.status === 401) {
            alert("보안 세션이 만료되었습니다. 다시 로그인해 주세요.");
            handleEmpLogout();
            return;
        }

        const result = await res.json();
        if (result.success) {
            alert(`${name}님의 퇴실 요청이 접수되었습니다.\n보안실 최종 승인 후 처리됩니다.`);
            fetchFilteredMySchedule(); // 목록 새로고침
        } else {
            alert(result.message || "퇴실 요청 중 오류가 발생했습니다.");
        }
    } catch (e) {
        alert("서버 통신 오류가 발생했습니다.");
    }
}

/**
 * 임직원 스케줄: 그룹 일괄 입실/퇴실/취소 요청 처리 함수
 */
async function handleStaffGroupAction(groupId, action) {
    if (!groupId || groupId === 'NONE') return;
    
    // 취소 요청 시 사용자에게 최종 확인
    if (action === 'cancel' && !confirm('해당 그룹의 모든 사전예약을 일괄 취소하시겠습니까?')) {
        return;
    }

    try {
        const res = await fetch('/api/emp/group-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group_id: groupId, action: action })
        });

        if (res.status === 401) {
            alert("보안 세션이 만료되었습니다. 다시 로그인해 주세요.");
            handleEmpLogout();
            return;
        }

        const result = await res.json();
        if (result.success) {
            alert(result.message);
            fetchFilteredMySchedule(); // 상태 변경 반영을 위해 목록 새로고침
        } else {
            alert(result.message || "요청 처리 중 오류가 발생했습니다.");
        }
    } catch(e) {
        alert("서버 연동 중 에러가 발생했습니다.");
    }
}