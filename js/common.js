/**
 * js/common.js
 * 전역 변수 및 공통 유틸리티 함수
 */

const urlParams = new URLSearchParams(window.location.search);

// 🗺️ 방문객 거점(region) 정보.
//  - 주소창(?region=)에서 읽지 않는다. 손님이 거점별 QR(/v/<코드>)로 진입하면
//    서버가 region을 '세션'에만 저장하므로, 화면에서는 /api/guest/context 로 받아온다.
//  - QR 없이 / 로 직접 들어온 손님은 null 상태가 되어 거점 선택 드롭다운으로 폴백한다.
let currentRegion = null;

// 서버 세션에 귀속된 손님 거점명을 받아와 currentRegion 에 채운다.
async function loadGuestRegion() {
    try {
        const res = await fetch('/api/guest/context');
        const data = await res.json();
        currentRegion = (data && data.region) ? data.region : null;
    } catch (e) {
        currentRegion = null;
    }
}

let securityRefreshTimer = null;
let companionCount = 0;

const PC_PAGE_LIMIT = 5;      
const MOBILE_PAGE_LIMIT = 5;  
let currentSchedulePage = 1;  
let globalCachedList = [];    

document.addEventListener("DOMContentLoaded", () => {
    // 정확히 /emp (또는 /emp/) 인 경우에만 임직원 모드.
    //  - 기존 includes('/emp') 는 /v/... 등 다른 경로가 끼면 오판할 수 있어 정밀 비교로 변경.
    const path = window.location.pathname;
    const isEmpPage = (path === '/emp' || path === '/emp/');

    if (isEmpPage) {
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
        // 손님 화면: 먼저 서버 세션의 거점 정보를 받아온 뒤 초기화한다.
        loadGuestRegion().then(() => initVisitorPage());
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