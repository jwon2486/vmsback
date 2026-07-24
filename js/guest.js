/**
 * js/guest.js
 * VMS 통합 클라이언트 시스템
 */

// 💡 [수정] 위험한 자동 추측(Fallback) 로직 완전 제거. 오직 URL 파라미터만 확인합니다.
const urlParams = new URLSearchParams(window.location.search);
const currentRegion = urlParams.get('region'); // URL에 없으면 null 유지 (함부로 할당하지 않음)

let securityRefreshTimer = null;
let companionCount = 0;

// ==========================================
// 💡 페이지네이션 전역 제어 설정 환경 변수
// ==========================================
const PC_PAGE_LIMIT = 5;      
const MOBILE_PAGE_LIMIT = 5;  
let currentSchedulePage = 1;  
let globalCachedList = [];    

document.addEventListener("DOMContentLoaded", () => {
    if (window.location.pathname.includes('/emp')) {
        const utilityNav = document.getElementById('utility-nav');
        if (utilityNav) {
            utilityNav.classList.remove('display-none');
            utilityNav.classList.add('display-flex');
        }
        
        const empData = sessionStorage.getItem('emp_session');
        if (empData) {
            renderEmpNavbar();
            const level = parseInt(JSON.parse(empData).level);
            if (level === 4) {
                showSecurityDashboard();
            } else {
                showIntegratedEmpDashboard(); 
            }
        } else {
            showEmpLoginForm();
        }
    } else {
        const utilityNav = document.getElementById('utility-nav');
        if (utilityNav) utilityNav.classList.add('display-none');
        initVisitorPage();
    }
});

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

function resetWideLayout() {
    const container = document.querySelector('.container');
    if (container) container.classList.remove('container-wide');
    const appCard = document.getElementById('app-card');
    if (appCard) appCard.classList.remove('card-wide', 'card-emp-wide', 'card-guest-wide');
}

function renderEmpNavbar() {
    const emp = JSON.parse(sessionStorage.getItem('emp_session'));
    const utilityNav = document.getElementById('utility-nav');
    if (!utilityNav) return;
    
    let adminBtnHtml = '';
    if (emp && parseInt(emp.level) === 3) {
        adminBtnHtml = `<a href="/admin" class="btn-link-admin btn-nav-admin-mode">⚙️ 관리자</a>`;
    }
    
    let allLogsBtnHtml = '';
    if (emp && parseInt(emp.level) !== 4) {
        allLogsBtnHtml = `<button onclick="openVisitorLogModal()" class="btn-nav-link btn-all-logs">📊 전체기록</button>`;
    }
    
    utilityNav.innerHTML = `
        <div class="nav-profile-info">
            <span class="avatar">👤</span>
            <span class="user-text"><b>${emp.name} ${emp.rank || ''}</b> <span class="dept-tag">${emp.dept}</span></span>
        </div>
        <div class="nav-actions nav-actions-flex-wrapper">
            ${allLogsBtnHtml}
            ${adminBtnHtml}
            <button onclick="handleEmpLogout()" class="btn-nav-link btn-link-danger">로그아웃</button>
        </div>
    `;
}

function selectPurpose(btn, purposeVal, targetId) {
    const group = btn.closest('.purpose-button-group');
    group.querySelectorAll('.btn-choice').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(targetId).value = purposeVal;
}

function openSheetAndAddFirst(type) {
    if (type === 'emp') {
        if (!window.empCompanionCount || window.empCompanionCount === 0) {
            addEmpCompanionField();
        }
    } else {
        if (companionCount === 0) {
            addCompanionField();
        }
    }
    openCompanionSheet();
}

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

/* ====================================================================
   ✨ 임직원 전용 사전 방문 예약 대시보드 엔진 렌더러
   ==================================================================== */
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

    // 💡 [직원용] URL에 거점 파라미터가 없으면 직원이 직접 선택하도록 UI 생성
    const sessionRegion = emp.region || '테크센터';
    let regionSelectorHtml = '';
    let titleBadge = '';

    if (currentRegion) {
        titleBadge = `<span class="region-badge-success">(${currentRegion})</span>`;
        regionSelectorHtml = `<input type="hidden" id="empRegionSelect" value="${currentRegion}">`;
    } else {
        titleBadge = `<span class="region-badge-success" style="background-color: #f59e0b;">(거점 선택 필요)</span>`;
        regionSelectorHtml = `
            <div class="input-group mb-15">
                <label>방문 거점 선택 *</label>
                <select id="empRegionSelect" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.9rem;">
                    <option value="테크센터" ${sessionRegion === '테크센터' ? 'selected' : ''}>테크센터</option>
                    <option value="에코센터" ${sessionRegion === '에코센터' ? 'selected' : ''}>에코센터</option>
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
                    actionHtml = `<button onclick="toggleIndividualPanel('${key}')" class="btn-list-action" style="background:#64748b;">개별 신청</button>`;
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
                    actionHtml = `<button onclick="toggleIndividualPanel('${key}')" class="btn-list-action" style="background:#64748b;">개별 신청</button>`;
                } else {
                    actionHtml = `<button onclick="handleStaffDirectCheckout(${v.id}, '${v.name}')" class="btn-list-action bg-orange">퇴실 요청</button>`;
                }
            } else if (v.status === '퇴실대기') {
                actionHtml = `<span class="status-badge badge-waiting">퇴실 대기중</span>`;
            } else {
                actionHtml = `<span class="status-badge badge-done">${v.status}</span>`;
            }
            
            let timeHtml = '';
            if (v.checkin_time) timeHtml += `<div class="time-checkin">입실: ${v.checkin_time}</div>`;
            if (v.checkout_time) timeHtml += `<div class="time-checkout">퇴실: ${v.checkout_time}</div>`;
            
            const borderStyleClass = isGroup ? 'group-member-item' : 'normal-member-item';

            const companyGroups = {};
            subMembers.forEach(m => {
                const comp = m.company || '소속 미상';
                if (!companyGroups[comp]) companyGroups[comp] = [];
                companyGroups[comp].push(`<span style="font-weight:700; color:var(--text-main);">${m.name}</span>`);
            });

            const combinedNamesHtml = Object.entries(companyGroups).map(([comp, namesHtmlArray]) => {
                return `${namesHtmlArray.join(', ')} <span class="corp-sub-text corp-label-font-size">(${comp})</span>`;
            }).join(', &nbsp;&nbsp;'); 

            let individualRowsHtml = '';
            if (isCombined) {
                individualRowsHtml = `
                    <div id="ind-panel-${key}" class="display-none" style="width:100%; background:#f8fafc; border-top:1px dashed #cbd5e1; padding:8px 10px; margin-top:8px; border-radius:6px;">
                        <div style="font-size:0.78rem; color:var(--text-muted); font-weight:700; margin-bottom:6px;">개별 입실 신청</div>
                `;
                subMembers.forEach(m => {
                    let indBtnHtml = '';
                    if (m.status === '사전예약') {
                        indBtnHtml = `
                            <button onclick="handleStaffDirectCheckin(${m.id}, '${m.name}')" class="btn-list-action bg-blue" style="padding:2px 6px !important; font-size:0.75rem !important;">입실</button>
                            <button onclick="handleStaffCancelSchedule(${m.id}, '${m.name}')" class="btn-cancel-outline" style="padding:2px 6px !important; font-size:0.75rem !important;">취소</button>
                        `;
                    } else if (m.status === '입실완료') {
                        indBtnHtml = `
                            <button onclick="handleStaffDirectCheckout(${m.id}, '${m.name}')" class="btn-list-action bg-orange" style="padding:2px 6px !important; font-size:0.75rem !important;">퇴실</button>
                        `;
                    } else if (m.status === '입실대기' || m.status === '퇴실대기') {
                        indBtnHtml = `<span class="status-badge badge-waiting" style="padding:2px 6px; font-size:0.7rem;">대기중</span>`;
                    } else {
                        indBtnHtml = `<span class="status-badge badge-done" style="padding:2px 6px; font-size:0.7rem;">${m.status}</span>`;
                    }

                    individualRowsHtml += `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px solid #f1f5f9;">
                            <span style="font-size:0.85rem; color:#334155;"><b>${m.name}</b> <small style="color:#64748b;">(${m.company})</small></span>
                            <div style="display:flex; gap:4px; align-items:center;">${indBtnHtml}</div>
                        </div>
                    `;
                });
                individualRowsHtml += `</div>`;
            }

            // 💡 [직원용 뱃지] 리스트에서 한눈에 파악 가능한 거점 뱃지 생성
            const regionBadgeHtml = `<span style="background-color: #e2e8f0; color: #334155; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; margin-right: 4px;">📍 ${v.region || '미상'}</span>`;

            html += `
                <div class="result-item-schedule schedule-item-card-padding ${borderStyleClass}">
                    <div class="item-info">
                        <div style="line-height:1.5; word-break: keep-all; margin-bottom:4px;">${combinedNamesHtml}</div>
                        <div class="item-sub-desc schedule-desc-layout" style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                            ${regionBadgeHtml} 📅 ${v.visit_date} | ${v.purpose}
                        </div>
                        ${timeHtml ? `<div class="item-sub-time schedule-time-font-size">${timeHtml}</div>` : ''}
                    </div>
                    <div class="item-action-zone">
                        ${actionHtml}
                    </div>
                    ${individualRowsHtml} </div>`;
        }

        if (isGroup) {
            html += `</div>`; 
        }
    });

    if (totalPages > 1) {
        html += `
            <div class="pagination-nav-bar" style="display:flex; justify-content:center; align-items:center; gap:12px; margin-top:15px; padding:6px 0; width:100%;">
                <button onclick="changeSchedulePage(${currentSchedulePage - 1})" ${currentSchedulePage === 1 ? 'disabled' : ''} style="padding:4px 10px; font-size:0.85rem; border:1px solid #cbd5e1; background:#fff; border-radius:4px; color:#475569; cursor:pointer; font-weight:700;">이전</button>
                <span style="font-size:0.88rem; font-weight:800; color:#334155;">${currentSchedulePage} / ${totalPages}</span>
                <button onclick="changeSchedulePage(${currentSchedulePage + 1})" ${currentSchedulePage === totalPages ? 'disabled' : ''} style="padding:4px 10px; font-size:0.85rem; border:1px solid #cbd5e1; background:#fff; border-radius:4px; color:#475569; cursor:pointer; font-weight:700;">다음</button>
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

async function handleStaffDirectCheckin(id, name) {
    if (!confirm(`[${name}] 방문객의 입실을 요청하시겠습니까? (보안실 승인 후 최종 처리됩니다)`)) return;
    try {
        const res = await fetch('/api/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id, region: currentRegion })
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

async function handleStaffGroupAction(groupId, actionType) {
    let actionText = '';
    if (actionType === 'checkin') actionText = '입실';
    else if (actionType === 'checkout') actionText = '퇴실';
    else if (actionType === 'cancel') actionText = '예약 삭제';

    if (!confirm(`해당 그룹 인원들의 ${actionText} 처리를 일괄 요청하시겠습니까?`)) return;

    try {
        const res = await fetch('/api/emp/group-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group_id: groupId, action: actionType })
        });
        const result = await res.json();
        
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

    // 💡 [직원용] 제출 전 거점 선택 유무 검증
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

    if (!visit_date || !name || !contact || !company || !purpose) return alert('필수 예약 정보(* 표시)를 모두 채워주세요.');

    let visitorsArray = [{
        visit_date, name, contact, company, vehicle_no, purpose
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
                purpose: purpose
            });
        }
    }

    try {
        const res = await fetch('/api/emp/group-preregister', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitors: visitorsArray, created_by, region: finalEmpRegion }) // 선택된 최종 거점 전송
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

function showSecurityDashboard() {
    const emp = JSON.parse(sessionStorage.getItem('emp_session'));
    const empRegion = emp.region || '테크센터'; 
    const weekRange = getKstThisWeekRange();

    const container = document.querySelector('.container');
    if (container) container.classList.add('container-wide');

    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    
    appCard.classList.remove('card-guest-wide');
    appCard.classList.add('card-wide', 'card-emp-wide');
    
    appCard.innerHTML = `
        <h2 class="zone-title sec-dashboard-title">🛡️ 보안실 출입 관제 대시보드 <span class="sec-region-text">(${empRegion})</span></h2>
        
        <div class="mb-30">
            <div class="sec-live-header">
                <h3 class="sec-live-title">🚨 실시간 승인 대기열</h3>
                <span class="sec-live-indicator">
                    <span class="spinner sec-spinner"></span> 자동 새로고침 중
                </span>
            </div>
            <div class="table-responsive sec-table-container">
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

        <hr class="sec-divider">

        <div>
            <div class="sec-logs-header">
                <h3 class="sec-logs-title">📊 전체 출입 기록 <span class="sec-region-text">(${empRegion})</span></h3>
                <div class="date-range-picker-box flex-center-gap">
                    <input type="date" id="secLogStartDate" value="${weekRange.monday}" onchange="loadSecurityAllLogs()" class="sec-date-input">
                    <span class="range-tilde">~</span>
                    <input type="date" id="secLogEndDate" value="${weekRange.friday}" onchange="loadSecurityAllLogs()" class="sec-date-input">
                </div>
            </div>
            <div class="table-responsive sec-table-container h-500">
                <table class="modern-table w-100 min-w-900">
                    <thead class="sec-table-head">
                        <tr>
                            <th class="p-10">순번</th>
                            <th class="p-10">방문일</th>
                            <th class="p-10">이름</th>
                            <th class="p-10">소속</th>
                            <th class="p-10">방문 목적</th>
                            <th class="p-10">사내 담당자</th>
                            <th class="p-10">입실 시간</th>
                            <th class="p-10">퇴실 시간</th>
                            <th class="p-10">상태</th>
                        </tr>
                    </thead>
                    <tbody id="secAllLogsBody">
                        <tr><td colspan="9" class="no-data-box">전체 기록을 불러오는 중입니다...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    fetchSecurityQueue();
    loadSecurityAllLogs();

    if (securityRefreshTimer) clearInterval(securityRefreshTimer);
    securityRefreshTimer = setInterval(() => {
        fetchSecurityQueue(true);
        loadSecurityAllLogs(true);
    }, 10000);
}

async function fetchSecurityQueue(isAuto = false) {
    try {
        const emp = JSON.parse(sessionStorage.getItem('emp_session'));
        const empRegion = emp ? (emp.region || '테크센터') : '테크센터';
        
        const res = await fetch(`/api/security/pending-logs?region=${encodeURIComponent(empRegion)}`);
        const data = await res.json();
        const tbody = document.getElementById('securityQueueBody');
        if (!tbody) return; 
        
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
                        <td class="p-10">${formatPhone(v.contact)}</td>
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
        tbody.innerHTML = '<tr><td colspan="9" class="text-center-p20-gray">기록 내역을 불러오는 중입니다...</td></tr>';
    }
    
    try {
        const res = await fetch(`/api/admin/logs?start_date=${startDateEl.value}&end_date=${endDateEl.value}`);
        if (res.status === 401 || res.status === 403) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center-p20-red">조회 권한이 만료되었습니다. 재로그인 해주세요.</td></tr>';
            if (securityRefreshTimer) clearInterval(securityRefreshTimer);
            return;
        }

        const logs = await res.json();
        let html = '';
        if (logs.length === 0) {
            html = '<tr><td colspan="9" class="text-center-p20-gray">해당 날짜에 조회된 출입 데이터가 없습니다.</td></tr>';
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
            tbody.innerHTML = '<tr><td colspan="9" class="text-center-p20-red">데이터 연동 에러가 발생했습니다.</td></tr>';
        }
    }
}

async function approveSecurityAction(id, targetStatus) {
    if(!confirm(`대면 확인을 완료하셨습니까? 현 시점 기준으로 ${targetStatus} 승인 처리됩니다.`)) return;
    await fetch('/api/security/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, target_status: targetStatus })
    });
    fetchSecurityQueue();
    loadSecurityAllLogs();
}

async function approveSecurityGroup(groupId, targetStatus) {
    if(!confirm(`해당 그룹 인원 중 '대기상태'인 사람 전체를 일괄 ${targetStatus} 처리 하시겠습니까?`)) return;
    await fetch('/api/security/approve-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId, target_status: targetStatus })
    });
    fetchSecurityQueue();
    loadSecurityAllLogs();
}

async function initVisitorPage() {
    const myVisitorId = localStorage.getItem('my_visitor_id');
    if (myVisitorId) {
        try {
            const res = await fetch(`/api/check-status/${myVisitorId}`);
            const status = await res.json();
            if (status.canCheckout) { showCheckoutPage(status.visitor); return; }
        } catch (e) {}
    }
    showMainPage();
}

function showMainPage() {
    resetWideLayout(); 
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    appCard.innerHTML = `
        <div class="welcome-text">
            <h2>안녕하세요!<br><span>방문 등록</span>을 진행해 주세요.</h2>
            <p>안전하고 쾌적한 사내 보안 관리를 위해 출입 정보를 입력받고 있습니다.</p>
        </div>
        <div class="action-buttons">
            <button onclick="showNameVerifyForm()" class="btn-guest-main">
                <span class="guest-emoji-header">👋</span>
                처음 왔습니다<br><span class="guest-btn-sub-label">(입실 등록)</span>
            </button>
            <button onclick="showSearchForm()" class="btn-guest-sub">
                <span class="guest-emoji-header">🏃</span>
                나가려고 합니다<br><span class="guest-btn-sub-label">(퇴실 요청)</span>
            </button>
        </div>
    `;
}

function showNameVerifyForm() {
    resetWideLayout(); 
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">사전 예약 확인</h2>
        <div class="input-group input-group-verify-margin">
            <label>방문객 성명</label>
            <input type="text" id="checkName" placeholder="본인 성명을 입력하세요" autocomplete="off">
        </div>
        <div class="action-buttons">
            <button onclick="verifyVisitorName()" class="btn-guest-main">조회하기</button>
            <button onclick="showMainPage()" class="btn-guest-sub">취소</button>
        </div>
    `;
}

async function verifyVisitorName() {
    const checkNameInput = document.getElementById("checkName");
    if (!checkNameInput) return;
    
    const name = checkNameInput.value.trim();
    if (!name) return alert('성명을 입력해 주세요.');

    try {
        const res = await fetch('/api/check-preregister', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
        });
        const result = await res.json();
        if (result.success && result.list && result.list.length > 0) {
            showPreMatchSelection(result.list, name);
        } else {
            showCheckinForm(name); 
        }
    } catch (e) { 
        showCheckinForm(name);
    }
}

function showPreMatchSelection(list, originalName) {
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    let listHtml = '';
    list.forEach(v => {
        const managerInfo = v.emp_name ? `${v.emp_name} (${v.emp_dept})` : "미지정";
        listHtml += `
            <div class="match-item" onclick="submitConfirmPrecheck(${v.id})">
                <span class="match-manager">📋 사내 담당자: ${managerInfo}</span>
                <strong class="match-title">${v.name} <span class="match-corp">(${v.company})</span></strong>
                <p class="match-purpose">방문 목적: ${v.purpose}</p>
            </div>
        `;
    });
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">사전 등록 스케줄</h2>
        <div class="results-container">${listHtml}</div>
        <button onclick="showCheckinForm('${originalName}')" class="btn-guest-sub direct-register-btn-margin">내 스케줄이 없습니다 (현장 등록)</button>
    `;
}

async function submitConfirmPrecheck(id) {
    try {
        const res = await fetch('/api/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id, region: currentRegion })
        });
        const result = await res.json();
        if (result.success) {
            localStorage.setItem('my_visitor_id', result.id);
            alert(result.message);
            initVisitorPage();
        } else {
            alert(result.message);
        }
    } catch (e) {
        alert("처리에 실패했습니다.");
    }
}

function addCompanionField() {
    const msg = document.getElementById('empty-companion-msg');
    if (msg) msg.classList.add('display-none');

    companionCount++;
    const id = 'comp-box-' + Date.now() + '-' + companionCount;
    const container = document.createElement('div');
    container.id = id;
    container.className = 'companion-box form-container-verify-margin companion-box-style mb-15';
    
    container.innerHTML = `
        <button type="button" onclick="removeCompanionField('${id}')" class="btn-comp-delete">삭제</button>
        <h4 class="comp-title-blue mb-15">👤 동반 방문객</h4>
        <div class="input-row-group mb-10">
            <div class="input-group"><label class="fs-8">성명 *</label><input type="text" class="comp-name comp-input-style" placeholder="동반인 성명"></div>
            <div class="input-group"><label class="fs-8">연락처 *</label><input type="text" class="comp-contact comp-input-style" placeholder="- 없이 숫자만"></div>
        </div>
        <div class="input-row-group mb-0">
            <div class="input-group"><label class="fs-8">소속 회사명</label><input type="text" class="comp-company comp-input-style" placeholder="미입력시 대표자와 동일"></div>
            <div class="input-group"><label class="fs-8">차량 번호</label><input type="text" class="comp-vehicle comp-input-style" placeholder="없을 시 비워두세요"></div>
        </div>
    `;
    document.getElementById('companion-container').appendChild(container);
}

function removeCompanionField(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
    
    const container = document.getElementById('companion-container');
    if (container && container.querySelectorAll('.companion-box').length === 0) {
        const msg = document.getElementById('empty-companion-msg');
        if (msg) msg.classList.remove('display-none');
    }
}

/* ====================================================================
   ✨ 손님용 현장 즉시 입실 등록 폼 양식 스키마 렌더러
   ==================================================================== */
function showCheckinForm(passedName = '') {
    companionCount = 0; 
    
    const container = document.querySelector('.container');
    if (container) container.classList.add('container-wide');
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    
    appCard.classList.remove('card-emp-wide');
    appCard.classList.add('card-wide', 'card-guest-wide');

    // 💡 [손님용] URL에 거점 정보가 없으면 경고 스타일의 강제 선택 UI 렌더링
    let regionSelectorHtml = '';
    if (currentRegion) {
        regionSelectorHtml = `<input type="hidden" id="guestRegionSelect" value="${currentRegion}">`;
    } else {
        regionSelectorHtml = `
            <div class="input-group mb-15" style="border: 2px solid #f59e0b; padding: 10px; border-radius: 8px; background: #fffbeb;">
                <label style="color: #d97706; font-weight: bold;">📍 현재 방문하신 거점을 선택해주세요 *</label>
                <select id="guestRegionSelect" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 1rem;">
                    <option value="">-- 방문하신 센터를 선택하세요 --</option>
                    <option value="테크센터">테크센터</option>
                    <option value="에코센터">에코센터</option>
                </select>
            </div>
        `;
    }
    
    appCard.innerHTML = `
        <div class="dashboard-split-wrapper">
            <div class="dashboard-form-zone" id="guest-form-zone">
                <h2 class="guest-title-heavy-style desktop-only-title">방문객 현장 입실 등록</h2>
                <div class="form-container form-container-verify-margin">
                    
                    ${regionSelectorHtml}

                    <div class="input-row-group">
                        <div class="input-group"><label>성명 *</label><input type="text" id="name" value="${passedName}" placeholder="예) 홍길동"></div>
                        <div class="input-group"><label>본인 연락처 *</label><input type="text" id="contact" placeholder="- 없이 숫자만 입력"></div>
                    </div>
                    
                    <div class="input-row-group">
                        <div class="input-group"><label>소속 회사명 *</label><input type="text" id="company" placeholder="예) 소속 기업명 입력"></div>
                        <div class="input-group"><label>차량 번호</label><input type="text" id="vehicle_no" placeholder="없을 시 비워두세요"></div>
                    </div>

                    <div class="input-group">
                        <label>사내 방문 담당자 성명 *</label>
                        <input type="text" id="manager_text" placeholder="만나실 직원의 성명을 정확히 적어주세요">
                    </div>

                    <div class="input-group mb-20">
                        <label>방문 목적 *</label>
                        <input type="hidden" id="purpose" value="회의/미팅">
                        <div class="purpose-button-group">
                            <button type="button" class="btn-choice active" onclick="selectPurpose(this, '회의/미팅', 'purpose')">🤝 회의/미팅</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '제품 납품', 'purpose')">📦 제품 납품</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '상차/하차', 'purpose')">🚚 상차/하차</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '품질 검사', 'purpose')">🔍 품질 검사</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '시설 점검', 'purpose')">🛠️ 시설 점검</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '기타 업무', 'purpose')">📁 기타 업무</button>
                        </div>
                    </div>
                    
                    <button type="button" onclick="openSheetAndAddFirst('guest')" class="btn-guest-sub mt-15">
                        ➕ 동반 일행 추가 (선택)
                    </button>
                </div>
            </div>
            
            <div class="dashboard-divider-line" id="guest-divider-line"></div>
            
            <div class="bs-overlay" onclick="closeCompanionSheet()"></div>
            
            <div class="dashboard-list-zone bs-sheet" id="guest-companion-zone">
                <div class="bs-handle" onclick="closeCompanionSheet()"></div>
                <h3 class="zone-title my-title-color mb-15 desktop-only-title">👥 동반 일행 정보</h3>
                <div id="companion-container" class="results-container schedule-list-scroll-box guest-comp-scroll-box">
                    <div class="no-data-box empty-comp-msg" id="empty-companion-msg"><p>하단 버튼을 눌러 동반 일행을 추가하세요.</p></div>
                </div>
                <button type="button" onclick="addCompanionField()" class="btn-guest-sub btn-add-comp-outline mt-15">
                    ➕ 인원 계속 추가
                </button>
                <button type="button" onclick="closeCompanionSheet()" class="btn-emp-main mobile-bs-close mt-15">입력 완료 (닫기)</button>
            </div>
        </div>

        <div class="privacy-consent-box" style="margin: 20px 0; padding: 15px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; text-align: left;">
            <p style="font-size: 0.85rem; color: #475569; margin-bottom: 10px; line-height: 1.5; word-break: keep-all;">
                <strong>[개인정보 수집 및 이용 안내]</strong><br>
                - 수집 항목: <strong>이름, 전화번호, 회사명, 차량번호</strong><br>
                - 수집 목적: 사내 보안 및 출입 관리, 긴급 연락<br>
                - 보유 기간: <strong>방문 목적 달성 후 파기 (또는 사내 보안 규정에 따름)</strong>
            </p>
            <div class="remember-me-box remember-checkbox-layout-style" style="justify-content: flex-start; gap: 8px;">
                <input type="checkbox" id="privacyConsent" class="remember-checkbox-size" style="width: 18px; height: 18px;">
                <label for="privacyConsent" class="remember-label-pointer" style="font-weight: bold; color: #b91c1c; font-size: 0.95rem;">
                    (필수) 개인정보 수집 및 이용에 동의합니다.
                </label>
            </div>
        </div>
        <div class="action-buttons action-buttons-margin">
            <button onclick="submitCheckin()" class="btn-guest-main">등록 완료 및 승인 요청</button>
            <button onclick="showMainPage()" class="btn-guest-sub">취소</button>
        </div>
    `;
}

async function submitCheckin() {
    // 👇 개인정보 동의 검증 로직 추가
    const privacyConsentEl = document.getElementById('privacyConsent');
    if (privacyConsentEl && !privacyConsentEl.checked) {
        alert('출입 등록을 위해 개인정보 수집 및 이용에 동의해 주세요.');
        privacyConsentEl.focus();
        return;
    }
    // 👆 추가 끝

    const nameEl = document.getElementById('name');
    const companyEl = document.getElementById('company');
    const contactEl = document.getElementById('contact');
    const vehicleNoEl = document.getElementById('vehicle_no');
    const managerTextEl = document.getElementById('manager_text');
    const purposeEl = document.getElementById('purpose');

    // 💡 [손님용] 제출 전 거점 선택 유무 검증
    const guestRegionEl = document.getElementById('guestRegionSelect');
    const finalRegion = guestRegionEl ? guestRegionEl.value : currentRegion;

    if (!finalRegion) {
        return alert('현재 방문하신 센터(거점)를 꼭 선택해 주세요!');
    }

    if (!nameEl || !companyEl || !contactEl || !managerTextEl) return;

    const name = nameEl.value.trim();
    const company = companyEl.value.trim();
    const contact = contactEl.value.trim();
    const vehicle_no = vehicleNoEl ? (vehicleNoEl.value.trim() || '없음') : '없음';
    const manager_text = managerTextEl.value.trim();
    const purpose = purposeEl.value;
    
    if (!name || !company || !contact || !manager_text) return alert('필수 항목을 모두 입력해 주세요.');
    
    let visitorsArray = [{
        name, company, contact, vehicle_no, manager_text, purpose
    }];

    const compNames = document.querySelectorAll('.comp-name');
    const compContacts = document.querySelectorAll('.comp-contact');
    const compCompanies = document.querySelectorAll('.comp-company');
    const compVehicles = document.querySelectorAll('.comp-vehicle');
    
    for(let i=0; i<compNames.length; i++) {
        const cName = compNames[i].value.trim();
        const cContact = compContacts[i].value.trim();
        const cCompany = compCompanies[i].value.trim() || company;
        const cVehicle = compVehicles[i].value.trim() || '없음';

        if(cName && cContact) {
            visitorsArray.push({
                name: cName,
                company: cCompany,
                contact: cContact,
                vehicle_no: cVehicle,
                manager_text: manager_text,
                purpose: purpose
            });
        }
    }

    try {
        const res = await fetch('/api/group-checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitors: visitorsArray, region: finalRegion }) // 선택된 최종 거점 전송
        });
        const result = await res.json();
        if (result.success) {
            localStorage.setItem('my_visitor_id', result.id);
            alert(result.message); 
            initVisitorPage();
        } else {
            alert(result.message || "오류가 발생했습니다.");
        }
    } catch (e) {
        alert("서버와의 통신이 원활하지 않습니다.");
    }
}

function showCheckoutPage(visitor) {
    resetWideLayout(); 
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">방문종료 (퇴실)</h2>
        <div class="visitor-info-box">
            <p class="greet"><strong>${visitor.name}</strong> 님</p>
            <span class="badge-company">${visitor.company}</span>
            <p class="time-info">입실 처리 시간: ${visitor.checkin_time || '승인 대기 중'}</p>
        </div>
        <div class="action-buttons">
            <button onclick="submitCheckout(${visitor.id})" class="btn-guest-main">네, 지금 퇴실 요청합니다</button>
            <button onclick="showSearchForm()" class="btn-guest-sub">제 정보가 아닙니다 (다시 검색)</button>
        </div>
    `;
}

async function submitCheckout(id) {
    try {
        const res = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id })
        });
        const result = await res.json();
        if (result.success) {
            if (localStorage.getItem('my_visitor_id') == id) localStorage.removeItem('my_visitor_id');
            alert(result.message);
            initVisitorPage();
        }
    } catch (e) {}
}

function showSearchForm() {
    resetWideLayout(); 
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">퇴실 대상자 검색</h2>
        <div class="input-group"><input type="text" id="searchName" oninput="searchVisitor()" placeholder="본인 성명 입력 (ex: 홍)" autocomplete="off"></div>
        <div id="searchResult" class="results-container visitor-result-box-margin"></div>
        <div class="action-buttons visitor-btn-margin"><button onclick="initVisitorPage()" class="btn-guest-sub">처음 화면으로</button></div>
    `;
}

async function searchVisitor() {
    const query = document.getElementById('searchName').value.trim();
    const resultDiv = document.getElementById('searchResult');
    if (!resultDiv) return;
    if (!query) { resultDiv.innerHTML = ''; return; }
    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const list = await res.json();
        let html = '';
        if (list.length > 0) {
            list.forEach(v => {
                html += `
                    <div class="result-item" onclick="submitCheckout(${v.id})">
                        <div class="item-info">
                            <strong>${v.name}</strong> 
                            <span>(${v.company})</span>
                        </div>
                        <div class="item-action-text">퇴실 요청 →</div>
                    </div>`;
            });
            resultDiv.innerHTML = html;
        } else {
            resultDiv.innerHTML = `<div class="no-data-box"><span class="icon">🔍</span><p>조회된 상주 인원이 없습니다.</p></div>`;
        }
    } catch (e) {}
}

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
                <div class="input-group">
                    <label>사원 번호 (사번)</label>
                    <input type="text" id="empId" placeholder="사번 입력" value="${savedId}">
                </div>
                <div class="input-group">
                    <label>성명</label>
                    <input type="text" id="empName" placeholder="본인 성함 입력" value="${savedName}">
                </div>
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
        } else { 
            alert(result.message);
        }
    } catch (e) {
        alert('로그인 통신 중 오류가 발생했습니다.');
    }
}

function handleEmpLogout() {
    if (securityRefreshTimer) clearInterval(securityRefreshTimer);
    sessionStorage.removeItem('emp_session');
    window.location.reload();
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
    
    tbody.innerHTML = '<tr><td colspan="9" class="text-center-p20-gray">기록 내역을 불러오는 중입니다...</td></tr>';
    
    try {
        const res = await fetch(`/api/admin/logs?start_date=${startDate}&end_date=${endDate}`);
        if (res.status === 401 || res.status === 403) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center-p20-red">조회 권한이 만료되었습니다. 재로그인 해주세요.</td></tr>';
            if (securityRefreshTimer) clearInterval(securityRefreshTimer);
            return;
        }

        const logs = await res.json();
        let html = '';
        if (logs.length === 0) {
            html = '<tr><td colspan="9" class="text-center-p20-gray">조회 범위 내 출입 데이터가 존재하지 않습니다.</td></tr>';
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
                        <td class="p-10">${v.company}</td>
                        <td class="p-10"><span class="sec-purpose-badge">${v.purpose}</span></td>
                        <td class="p-10">${managerDisplay}</td>
                        <td class="p-10">${v.checkin_time || '-'}</td>
                        <td class="p-10">${v.checkout_time || '-'}</td>
                        <td class="p-10"><b>${v.status}</b></td>
                    </tr>
                `;
            });
        }
        tbody.innerHTML = html;
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center-p20-red">네트워크 통신 에러가 발생했습니다.</td></tr>';
    }
}

function switchMobileTab(tabId) {
    const formZone = document.getElementById('emp-form-zone');
    const listZone = document.getElementById('emp-list-zone');
    const btnForm = document.getElementById('tab-btn-form');
    const btnList = document.getElementById('tab-btn-list');
    
    if (tabId === 'form') {
        if(formZone) formZone.classList.add('active');
        if(listZone) listZone.classList.remove('active');
        if(btnForm) btnForm.classList.add('active');
        if(btnList) btnList.classList.remove('active');
    } else {
        if(formZone) formZone.classList.remove('active');
        if(listZone) listZone.classList.add('active');
        if(btnForm) btnForm.classList.remove('active');
        if(btnList) btnList.classList.add('active');
    }
}

function openCompanionSheet() {
    document.body.classList.add('bs-active');
}

function closeCompanionSheet() {
    document.body.classList.remove('bs-active');
}