/**
 * js/emp.js
 * 임직원(내부인) 사전 방문 예약 및 스케줄 관리 (인라인 CSS 완벽 제거)
 */

function addEmpCompanionField() {
    const zone = document.getElementById('emp-companion-zone');
    const divider = document.getElementById('emp-divider-comp');
    if (zone) {
        zone.classList.remove('display-none');
        zone.classList.add('display-block');
    }
    if (divider) {
        divider.classList.remove('display-none');
        divider.classList.add('display-block');
    }

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

function removeEmpCompanionField(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
    checkEmpCompanionEmpty();
}

function clearAllEmpCompanions() {
    const container = document.getElementById('emp-companion-container');
    if (container) container.innerHTML = '';
    window.empCompanionCount = 0;
    checkEmpCompanionEmpty();
}

function checkEmpCompanionEmpty() {
    const container = document.getElementById('emp-companion-container');
    const zone = document.getElementById('emp-companion-zone');
    const divider = document.getElementById('emp-divider-comp');
    
    if (container && container.querySelectorAll('.companion-box').length === 0) {
        if (zone) {
            zone.classList.remove('display-block');
            zone.classList.add('display-none');
        }
        if (divider) {
            divider.classList.remove('display-block');
            divider.classList.add('display-none');
        }
        window.empCompanionCount = 0;
    }
}

function showIntegratedEmpDashboard() {
    const emp = JSON.parse(sessionStorage.getItem('emp_session'));
    const weekRange = getKstThisWeekRange(); 
    const today = weekRange.todayKst; 
    
    const container = document.querySelector('.container');
    if (container) container.classList.add('container-wide');
    
    const appCard = document.getElementById('app-card');
    if (!appCard || !emp) return;
    
    appCard.classList.remove('card-guest-wide');
    appCard.classList.add('card-wide', 'card-emp-wide');

    window.empCompanionCount = 0; 

    const sessionRegion = emp.region || '테크센터';
    let regionSelectorHtml = '';
    let titleBadge = '';

    if (currentRegion) {
        titleBadge = `<span class="region-badge-success">(${currentRegion})</span>`;
        regionSelectorHtml = `<input type="hidden" id="empRegionSelect" value="${currentRegion}">`;
    } else {
        titleBadge = `<span class="region-badge-warning">(거점 선택 필요)</span>`;
        const empRegionOptions = REGION_LIST.map(r =>
            `<option value="${r}" ${sessionRegion === r ? 'selected' : ''}>${r}</option>`
        ).join('');
        regionSelectorHtml = `
            <div class="input-group mb-15">
                <label>방문 거점 선택 *</label>
                <select id="empRegionSelect">
                    ${empRegionOptions}
                </select>
            </div>
        `;
    }

    appCard.innerHTML = `
        <div class="mobile-tabs">
            <button class="mobile-tab-btn active" id="tab-btn-form" onclick="switchMobileTab('form')">📋 예약 하기</button>
            <button class="mobile-tab-btn" id="tab-btn-list" onclick="switchMobileTab('list')">📅 나의 예약</button>
        </div>
        <div class="dashboard-split-wrapper">
            <div class="dashboard-form-zone mobile-tab-content active" id="emp-form-zone">
                <h3 class="zone-title desktop-only-title">📋 새 방문객 예약 ${titleBadge}</h3>
                <div class="form-container form-container-flush">
                    <input type="hidden" id="proxyStaffId" value="${emp.id}">
                    
                    ${regionSelectorHtml}
                    
                    <div class="input-group"><label>방문 일자 *</label><input type="date" id="visitDate" value="${today}"></div>
                    
                    <div class="input-row-group">
                        <div class="input-group"><label>방문 예정시간 *</label><input type="time" id="expectedCheckin"></div>
                        <div class="input-group"><label>퇴실 예정시간 *</label><input type="time" id="expectedCheckout"></div>
                    </div>
                    
                    <div class="input-row-group">
                        <div class="input-group"><label>방문객 이름 *</label><input type="text" id="vName" placeholder="성함 입력" autocomplete="off"></div>
                        <div class="input-group"><label>방문객 연락처 *</label><input type="text" id="vContact" placeholder="- 없이 숫자만 입력" autocomplete="off"></div>
                    </div>
                    
                    <div class="input-row-group">
                        <div class="input-group"><label>소속 회사명 *</label><input type="text" id="vCompany" placeholder="회사명 입력" autocomplete="off"></div>
                        <div class="input-group"><label>차량 번호</label><input type="text" id="vVehicle" placeholder="없을 시 비워두세요" autocomplete="off"></div>
                    </div>

                    <div class="input-group">
                        <label>방문 목적 *</label>
                        <input type="hidden" id="vPurpose" value="회의/미팅">
                        <div class="purpose-button-group">
                            <button type="button" class="btn-choice active" onclick="selectPurpose(this, '회의/미팅', 'vPurpose')">🤝 회의/미팅</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '제품 납품', 'vPurpose')">📦 제품 납품</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '상차/하차', 'vPurpose')">🚚 상차/하차</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '품질 검사', 'vPurpose')">🔍 품질 검사</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '시설 점검', 'vPurpose')">🛠️ 시설 점검</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '기타 업무', 'vPurpose')">📁 기타 업무</button>
                        </div>
                    </div>
                    
                    <button type="button" onclick="openSheetAndAddFirst('emp')" class="btn-guest-sub btn-add-comp-outline mt-15">
                        ➕ 동반 일행 추가 (선택)
                    </button>

                    <button onclick="submitNewSchedule()" class="btn-emp-main btn-main-shadow">사전 예약 등록</button>
                </div>
            </div>
            
            <div class="dashboard-divider-line display-none" id="emp-divider-comp"></div>
            
            <div class="bs-overlay" onclick="closeCompanionSheet()"></div>
            
            <div class="dashboard-form-zone companion-zone-panel bs-sheet display-none" id="emp-companion-zone">
                <div class="bs-handle" onclick="closeCompanionSheet()"></div>
                <div class="comp-zone-header">
                    <h3 class="zone-title my-title-color fs-105">👥 동반 일행 입력</h3>
                    <button type="button" onclick="clearAllEmpCompanions()" class="btn-comp-clear">전체 취소</button>
                </div>
                <div id="emp-companion-container" class="emp-comp-scroll-box"></div>
                <button type="button" onclick="addEmpCompanionField()" class="btn-guest-sub btn-add-comp-outline-solid mt-10">
                    ➕ 인원 계속 추가
                </button>
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
                <div id="my-schedule-list" class="results-container emp-schedule-scroll-box">
                    <div class="no-data-box"><p>내역 동기화 중...</p></div>
                </div>
            </div>
        </div>
    `;
    fetchFilteredMySchedule();
}

async function fetchFilteredMySchedule() {
    const emp = JSON.parse(sessionStorage.getItem('emp_session'));
    const myListDiv = document.getElementById('my-schedule-list');
    
    if (!myListDiv || !emp) return;

    const myStart = document.getElementById('myStartDate') ? document.getElementById('myStartDate').value : '';
    const myEnd = document.getElementById('myEndDate') ? document.getElementById('myEndDate').value : '';
    
    try {
        const queryParams = `my_start=${myStart}&my_end=${myEnd}`;
        const res = await fetch(`/api/emp/my-schedule/${emp.id}?${queryParams}`);
        
        if (res.status === 401) {
            alert("보안 세션이 만료되었습니다. 다시 로그인해 주세요.");
            handleEmpLogout();
            return;
        }

        const data = await res.json();
        
        if (data.success) {
            if (data.my_list && data.my_list.length > 0) {
                globalCachedList = data.my_list;
                currentSchedulePage = 1;
                renderScheduleItems();
            } else {
                globalCachedList = [];
                myListDiv.innerHTML = `<div class="no-data-box"><p>선택 기간 내 나의 스케줄이 없습니다.</p></div>`;
            }
        }
    } catch (e) { 
        console.error("조회 실패:", e);
        myListDiv.innerHTML = '<div class="no-data-box"><p class="sync-error-text">동기화 오류가 발생했습니다.</p></div>'; 
    }
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

    const startIndex = (currentSchedulePage - 1) * pageLimit;
    const endIndex = startIndex + pageLimit;
    const pagedKeys = groupKeys.slice(startIndex, endIndex);

    let html = '';
    
    pagedKeys.forEach(gId => {
        const members = groupedLogs[gId];
        members.sort((a, b) => a.id - b.id);
        const isGroup = members.length > 1;

        if (isGroup) {
            const canCheckin = members.some(m => m.status === '사전예약');
            const canCheckout = members.some(m => m.status === '입실완료');

            let groupActionHtml = '';
            if (canCheckin) {
                groupActionHtml += `<button onclick="handleStaffGroupAction('${gId}', 'checkin')" class="btn-list-action bg-blue">일괄 입실</button>`;
                groupActionHtml += `<button onclick="handleStaffGroupAction('${gId}', 'cancel')" class="btn-cancel-outline">일괄 취소</button>`;
            }
            if (canCheckout) {
                groupActionHtml += `<button onclick="handleStaffGroupAction('${gId}', 'checkout')" class="btn-list-action bg-orange">일괄 퇴실</button>`;
            }

            html += `
                <div class="group-schedule-card">
                    <div class="group-schedule-header">
                        <strong class="text-gray-dark fs-9">👥 그룹 방문객 (${members.length}명) - 그룹장: ${members[0].name}</strong>
                        <div class="group-action-wrapper">${groupActionHtml}</div>
                    </div>
            `;
        }

        const subGroups = {};
        members.forEach(m => {
            const key = `${m.status}_${m.checkin_time || ''}_${m.checkout_time || ''}_${m.purpose}`;
            if (!subGroups[key]) subGroups[key] = [];
            subGroups[key].push(m);
        });

        for (const [key, subMembers] of Object.entries(subGroups)) {
            const v = subMembers[0]; 
            const isCombined = subMembers.length > 1; 

            let actionHtml = '';
            
            if (v.status === '사전예약') {
                if (isCombined) {
                    actionHtml = `<button onclick="toggleIndividualPanel('${key}')" class="btn-list-action bg-emp-sub">개별 신청</button>`;
                } else {
                    actionHtml = `
                        <button onclick="handleStaffDirectCheckin(${v.id}, '${v.name}')" class="btn-list-action bg-blue">입실 요청</button>
                        <button onclick="handleStaffCancelSchedule(${v.id}, '${v.name}')" class="btn-cancel-outline">취소</button>
                    `;
                }
            } else if (v.status === '입실대기') {
                actionHtml = `<span class="status-badge badge-waiting">입실 대기중</span>`;
            } else if (v.status === '입실완료') {
                if (isCombined) {
                    actionHtml = `<button onclick="toggleIndividualPanel('${key}')" class="btn-list-action bg-emp-sub">개별 신청</button>`;
                } else {
                    actionHtml = `<button onclick="handleStaffDirectCheckout(${v.id}, '${v.name}')" class="btn-list-action bg-orange">퇴실 요청</button>`;
                }
            } else if (v.status === '퇴실대기') {
                actionHtml = `<span class="status-badge badge-waiting">퇴실 대기중</span>`;
            } else {
                actionHtml = `<span class="status-badge badge-done">${v.status}</span>`;
            }
            
            // 입실/퇴실을 각각 '실제 | 예정' 한 줄로 표기 (실제값 없으면 대기중/-)
            const inActual = v.checkin_time || '<span class="time-pending">대기중</span>';
            const outActual = v.checkout_time || '<span class="time-pending">대기중</span>';
            const inExpected = v.expected_checkin || '-';
            const outExpected = v.expected_checkout || '-';
            let timeHtml = `
                <div class="time-checkin">입실: ${inActual} <span class="time-expected-inline">| 예정: ${inExpected}</span></div>
                <div class="time-checkout">퇴실: ${outActual} <span class="time-expected-inline">| 예정: ${outExpected}</span></div>
            `;
            
            const borderStyleClass = isGroup ? 'group-member-item' : 'normal-member-item';

            const companyGroups = {};
            subMembers.forEach(m => {
                const comp = m.company || '소속 미상';
                if (!companyGroups[comp]) companyGroups[comp] = [];
                companyGroups[comp].push(`<span class="ind-panel-name">${m.name} <span class="ind-panel-corp">(${m.contact || '-'})</span></span>`);
            });

            const combinedNamesHtml = Object.entries(companyGroups).map(([comp, namesHtmlArray]) => {
                return `${namesHtmlArray.join(', ')} <span class="corp-sub-text corp-label-font-size">(${comp})</span>`;
            }).join(', &nbsp;&nbsp;'); 

            let individualRowsHtml = '';
            if (isCombined) {
                individualRowsHtml = `
                    <div id="ind-panel-${key}" class="display-none ind-panel">
                        <div class="ind-panel-title">개별 입실 신청</div>
                `;
                subMembers.forEach(m => {
                    let indBtnHtml = '';
                    if (m.status === '사전예약') {
                        indBtnHtml = `
                            <button onclick="handleStaffDirectCheckin(${m.id}, '${m.name}')" class="btn-list-action bg-blue btn-ind-action">입실</button>
                            <button onclick="handleStaffCancelSchedule(${m.id}, '${m.name}')" class="btn-cancel-outline btn-ind-action">취소</button>
                        `;
                    } else if (m.status === '입실완료') {
                        indBtnHtml = `
                            <button onclick="handleStaffDirectCheckout(${m.id}, '${m.name}')" class="btn-list-action bg-orange btn-ind-action">퇴실</button>
                        `;
                    } else if (m.status === '입실대기' || m.status === '퇴실대기') {
                        indBtnHtml = `<span class="status-badge badge-waiting badge-ind-status">대기중</span>`;
                    } else {
                        indBtnHtml = `<span class="status-badge badge-done badge-ind-status">${m.status}</span>`;
                    }

                    individualRowsHtml += `
                        <div class="ind-panel-row">
                            <span class="ind-panel-name">${m.name} <span class="ind-panel-corp">(${m.company} | ${m.contact || '-'})</span></span>
                            <div class="ind-panel-actions">${indBtnHtml}</div>
                        </div>
                    `;
                });
                individualRowsHtml += `</div>`;
            }

            const regionBadgeHtml = `<span class="region-badge-success">📍 ${v.region || '미상'}</span>`;

            html += `
                <div class="result-item-schedule schedule-item-card-padding ${borderStyleClass}">
                    <div class="item-info">
                        <div style="line-height:1.5; word-break: keep-all; margin-bottom:4px;">${combinedNamesHtml}</div>
                        <div class="item-sub-desc schedule-desc-layout">
                            ${regionBadgeHtml} 📅 ${v.visit_date} | ${v.purpose}
                        </div>
                        <div class="item-sub-time schedule-time-font-size">${timeHtml}</div>
                    </div>
                    <div class="item-action-zone">
                        ${actionHtml}
                    </div>
                    ${individualRowsHtml} 
                </div>`;
        }

        if (isGroup) {
            html += `</div>`; 
        }
    });

    if (totalPages > 1) {
        html += `
            <div class="pagination-nav-bar">
                <button onclick="changeSchedulePage(${currentSchedulePage - 1})" class="btn-page" ${currentSchedulePage === 1 ? 'disabled' : ''}>이전</button>
                <span class="page-indicator">${currentSchedulePage} / ${totalPages}</span>
                <button onclick="changeSchedulePage(${currentSchedulePage + 1})" class="btn-page" ${currentSchedulePage === totalPages ? 'disabled' : ''}>다음</button>
            </div>
        `;
    }

    myListDiv.innerHTML = html;
}

function changeSchedulePage(targetPage) {
    currentSchedulePage = targetPage;
    renderScheduleItems();
    const myListDiv = document.getElementById('my-schedule-list');
    if (myListDiv) myListDiv.scrollTop = 0; 
}

function toggleIndividualPanel(key) {
    const panel = document.getElementById(`ind-panel-${key}`);
    if (!panel) return;
    if (panel.classList.contains('display-none')) {
        panel.classList.remove('display-none');
        panel.classList.add('display-block');
    } else {
        panel.classList.remove('display-block');
        panel.classList.add('display-none');
    }
}

async function handleStaffDirectCheckin(id, name, force = false) {
    if (!force && !confirm(`[${name}] 방문객의 입실을 요청하시겠습니까? (보안실 승인 후 최종 처리됩니다)`)) return;
    try {
        const res = await fetch('/api/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id, region: currentRegion, force: force })
        });
        const result = await res.json();

        // ⏰ 조기 입실: 담당자 확인 팝업 → '확인' 시 force 로 재요청
        if (result.early) {
            if (confirm(result.message)) {
                return handleStaffDirectCheckin(id, name, true);
            }
            return;
        }

        if (result.success) {
            alert(result.message);
            fetchFilteredMySchedule();
        } else {
            alert(result.message);
        }
    } catch (e) {
        alert("통신 오류가 발생했습니다.");
    }
}

async function handleStaffDirectCheckout(id, name) {
    if (!confirm(`[${name}] 방문객의 퇴실을 요청하시겠습니까? (보안실 승인 후 최종 처리됩니다)`)) return;
    try {
        const res = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id })
        });
        const result = await res.json();
        if (result.success) {
            alert(result.message);
            fetchFilteredMySchedule();
        } else {
            alert(result.message);
        }
    } catch (e) {
        alert("통신 오류가 발생했습니다.");
    }
}

async function handleStaffGroupAction(groupId, actionType, force = false) {
    let actionText = '';
    if (actionType === 'checkin') actionText = '입실';
    else if (actionType === 'checkout') actionText = '퇴실';
    else if (actionType === 'cancel') actionText = '예약 삭제';

    if (!force && !confirm(`해당 그룹 인원들의 ${actionText} 처리를 일괄 요청하시겠습니까?`)) return;

    try {
        const res = await fetch('/api/emp/group-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group_id: groupId, action: actionType, force: force })
        });
        const result = await res.json();

        // ⏰ 조기 입실(그룹): 담당자 확인 팝업 → '확인' 시 force 로 재요청
        if (result.early) {
            if (confirm(result.message)) {
                return handleStaffGroupAction(groupId, actionType, true);
            }
            return;
        }

        if (result.success) {
            alert(result.message);
            fetchFilteredMySchedule(); 
        } else {
            alert(result.message);
        }
    } catch (e) {
        alert("통신 중 오류가 발생했습니다.");
    }
}

async function handleStaffCancelSchedule(id, name) {
    if (!confirm(`[${name}] 방문객의 사전 예약을 정말 삭제하시겠습니까?`)) return;
    
    try {
        const res = await fetch(`/api/schedule/${id}`, { 
            method: 'DELETE' 
        });
        const result = await res.json();
        
        if (result.success) {
            alert('🗑️ 예약이 정상적으로 삭제되었습니다.');
            fetchFilteredMySchedule();
        } else {
            alert(result.message || '삭제 처리에 실패했습니다.');
        }
    } catch (e) {
        alert('서버 통신 중 오류가 발생했습니다.');
    }
}

async function submitNewSchedule() {
    const visitDateEl = document.getElementById('visitDate');
    const vNameEl = document.getElementById('vName');
    const vContactEl = document.getElementById('vContact');
    const vCompanyEl = document.getElementById('vCompany');
    const vVehicleEl = document.getElementById('vVehicle');
    const vPurposeEl = document.getElementById('vPurpose');
    const proxyStaffIdEl = document.getElementById('proxyStaffId');

    const empRegionEl = document.getElementById('empRegionSelect');
    const finalEmpRegion = empRegionEl ? empRegionEl.value : currentRegion;
    
    if (!finalEmpRegion) {
        return alert("방문 거점을 반드시 선택해 주세요.");
    }

    if (!visitDateEl || !vNameEl || !vContactEl || !vCompanyEl || !vPurposeEl) {
        return alert("시스템 입력란을 찾을 수 없습니다.");
    }

    const visit_date = visitDateEl.value;
    const name = vNameEl.value.trim();
    const contact = vContactEl.value.trim();
    const company = vCompanyEl.value.trim();
    const vehicle_no = vVehicleEl ? (vVehicleEl.value.trim() || '없음') : '없음';
    const purpose = vPurposeEl.value.trim();
    const created_by = proxyStaffIdEl.value; 

    const expectedCheckinEl = document.getElementById('expectedCheckin');
    const expectedCheckoutEl = document.getElementById('expectedCheckout');
    const expected_checkin = expectedCheckinEl ? expectedCheckinEl.value.trim() : '';
    const expected_checkout = expectedCheckoutEl ? expectedCheckoutEl.value.trim() : '';

    if (!visit_date || !name || !contact || !company || !purpose) return alert('필수 예약 정보(* 표시)를 모두 채워주세요.');
    if (!expected_checkin || !expected_checkout) return alert('방문 예정시간과 퇴실 예정시간을 모두 입력해 주세요.');

    let visitorsArray = [{
        visit_date, name, contact, company, vehicle_no, purpose, expected_checkin, expected_checkout
    }];

    const compNames = document.querySelectorAll('.emp-comp-name');
    const compContacts = document.querySelectorAll('.emp-comp-contact');
    const compCompanies = document.querySelectorAll('.emp-comp-company');
    const compVehicles = document.querySelectorAll('.emp-comp-vehicle');

    for(let i=0; i<compNames.length; i++) {
        const cName = compNames[i].value.trim();
        const cContact = compContacts[i].value.trim();
        const cCompany = compCompanies[i].value.trim() || company; 
        const cVehicle = compVehicles[i].value.trim() || '없음';

        if(cName && cContact) {
            visitorsArray.push({
                visit_date: visit_date,
                name: cName,
                contact: cContact,
                company: cCompany,
                vehicle_no: cVehicle,
                purpose: purpose,
                expected_checkin: expected_checkin,
                expected_checkout: expected_checkout
            });
        }
    }

    try {
        const res = await fetch('/api/emp/group-preregister', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitors: visitorsArray, created_by, region: finalEmpRegion }) 
        });
        const result = await res.json();
        
        if (result.success) {
            alert(result.message);
            vNameEl.value = '';
            vContactEl.value = '';
            vCompanyEl.value = '';
            if (vVehicleEl) vVehicleEl.value = '';
            
            clearAllEmpCompanions();
            fetchFilteredMySchedule();
        } else {
            alert(result.message || '서버 오류로 인해 예약에 실패했습니다.');
        }
    } catch (e) { 
        alert('스케줄 저장 통신에 실패했습니다.'); 
    }
}

function openVisitorLogModal() {
    const modal = document.getElementById('allVisitorLogModal');
    if (modal) {
        modal.classList.remove('display-none');
        const weekRange = getKstThisWeekRange();
        const startEl = document.getElementById('allVisitorStartDate');
        const endEl = document.getElementById('allVisitorEndDate');
        if (startEl && endEl) {
            startEl.value = weekRange.monday;
            endEl.value = weekRange.friday;
        }
        loadAllVisitorLogs();
    }
}

function closeVisitorLogModal() {
    const modal = document.getElementById('allVisitorLogModal');
    if (modal) modal.classList.add('display-none');
}

async function loadAllVisitorLogs() {
    const startEl = document.getElementById('allVisitorStartDate');
    const endEl = document.getElementById('allVisitorEndDate');
    const startDate = startEl ? startEl.value : '';
    const endDate = endEl ? endEl.value : '';
    const tbody = document.getElementById('allVisitorLogBody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="11" class="text-center-p20-gray">기록 내역을 불러오는 중입니다...</td></tr>';
    
    try {
        const res = await fetch(`/api/admin/logs?start_date=${startDate}&end_date=${endDate}`);
        if (res.status === 401 || res.status === 403) {
            tbody.innerHTML = '<tr><td colspan="11" class="text-center-p20-red">조회 권한이 만료되었습니다. 재로그인 해주세요.</td></tr>';
            if (securityRefreshTimer) clearInterval(securityRefreshTimer);
            return;
        }

        const logs = await res.json();
        let html = '';
        if (logs.length === 0) {
            html = '<tr><td colspan="11" class="text-center-p20-gray">조회 범위 내 출입 데이터가 존재하지 않습니다.</td></tr>';
        } else {
            logs.forEach(v => {
                const managerDisplay = v.emp_name
                    ? `${v.emp_name} <span class="text-gray-light">(${v.emp_dept || '부서없음'})</span>` 
                    : '<span class="text-gray-lighter">-</span>'; 
                
                html += `
                    <tr class="border-bottom-eee">
                        <td class="p-10">${v.id}</td>
                        <td class="p-10">${v.visit_date}</td>
                        <td class="p-10 fw-bold">${v.name}</td>
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
        tbody.innerHTML = '<tr><td colspan="11" class="text-center-p20-red">네트워크 통신 에러가 발생했습니다.</td></tr>';
    }
}