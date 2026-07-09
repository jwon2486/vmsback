/**
 * js/vms-common.js
 * VMS 시스템 공통 핵심 코어 스크립트
 */

const urlParams = new URLSearchParams(window.location.search);
const currentRegion = urlParams.get('region') || '테크센터';

let securityRefreshTimer = null;
let companionCount = 0;

// 페이지네이션 전역 제어 설정 환경 변수
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
    if (appCard) appCard.classList.remove('card-wide', 'card-emp-wide', 'card-guest-wide', 'card-security-wide');
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
                const managerDisplay = v.emp_name ? `${v.emp_name} <span class="text-gray-light">(${v.emp_dept || '부서없음'})</span>` : '<span class="text-gray-lighter">-</span>'; 
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
                    </tr>`;
            });
        }
        tbody.innerHTML = html;
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center-p20-red">네트워크 통신 에러가 발생했습니다.</td></tr>';
    }
}

function openCompanionSheet() { document.body.classList.add('bs-active'); }
function closeCompanionSheet() { document.body.classList.remove('bs-active'); }