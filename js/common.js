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

// 🏢 전체 사업장(거점) 목록 — 거점 드롭다운의 단일 관리 지점.
//   값은 백엔드 ALLOWED_REGIONS(app.py REGION_MAP)와 정확히 일치해야 한다.
//   사업장이 늘거나 이름이 바뀌면 여기만 고치면 된다.
const REGION_LIST = ['테크센터', '에코센터', '평택공장', '거제 조선소'];

// 🕒 시간 선택기 — 크롬 기본 시간 픽커 스타일의 커스텀 '컬럼 스크롤' 드롭다운.
//   - 네이티브 <input type=time> 은 분 단위를 못 바꾸므로 동일한 컬럼 UI 를 직접 구현.
//   - [오전/오후] [시 01~12] [분 00,05,…,55] 3열. 선택값은 hidden input({prefix}_ap/_h/_m)에 저장.
function timeSelectHtml(prefix) {
    const apCol = [['AM', '오전'], ['PM', '오후']]
        .map(([v, l]) => `<div class="tp-opt" onclick="tpSelect('${prefix}','ap','${v}',this)">${l}</div>`).join('');
    let hCol = '';
    for (let h = 1; h <= 12; h++)
        hCol += `<div class="tp-opt" onclick="tpSelect('${prefix}','h','${h}',this)">${String(h).padStart(2, '0')}</div>`;
    let mCol = '';
    for (let m = 0; m < 60; m += 5)
        mCol += `<div class="tp-opt" onclick="tpSelect('${prefix}','m','${m}',this)">${String(m).padStart(2, '0')}</div>`;
    return `
        <div class="tp-wrap" id="${prefix}_wrap">
            <input type="hidden" id="${prefix}_ap">
            <input type="hidden" id="${prefix}_h">
            <input type="hidden" id="${prefix}_m">
            <button type="button" class="tp-field" id="${prefix}_display" onclick="tpToggle('${prefix}')">
                <span class="tp-placeholder">시간 선택</span>
            </button>
            <div class="tp-panel" id="${prefix}_panel">
                <div class="tp-col">${apCol}</div>
                <div class="tp-col">${hCol}</div>
                <div class="tp-col">${mCol}</div>
            </div>
        </div>`;
}

// 픽커 열기/닫기 (다른 픽커는 닫음)
function tpToggle(prefix) {
    const panel = document.getElementById(prefix + '_panel');
    if (!panel) return;
    const willOpen = !panel.classList.contains('open');
    document.querySelectorAll('.tp-panel.open').forEach(p => p.classList.remove('open'));
    if (willOpen) panel.classList.add('open');
}

// 컬럼 항목 선택 → hidden input 갱신 + 필드 표시 갱신
function tpSelect(prefix, type, value, el) {
    document.getElementById(prefix + '_' + type).value = value;
    el.parentElement.querySelectorAll('.tp-opt').forEach(o => o.classList.remove('sel'));
    el.classList.add('sel');
    const ap = document.getElementById(prefix + '_ap').value;
    const h = document.getElementById(prefix + '_h').value;
    const m = document.getElementById(prefix + '_m').value;
    if (ap && h !== '' && m !== '') {
        const apLabel = ap === 'AM' ? '오전' : '오후';
        document.getElementById(prefix + '_display').innerHTML =
            `<span class="tp-value">${apLabel} ${String(h).padStart(2, '0')}:${String(parseInt(m, 10)).padStart(2, '0')}</span>`;
    }
}

// 픽커 바깥 클릭 시 열린 패널 닫기 (문서에 1회만 바인딩)
if (!window.__tpOutsideBound) {
    window.__tpOutsideBound = true;
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.tp-wrap')) {
            document.querySelectorAll('.tp-panel.open').forEach(p => p.classList.remove('open'));
        }
    });
}

// 세 드롭다운 값을 24시간 "HH:MM" 로 변환. 하나라도 미선택이면 '' (미입력) 반환.
function readTimeSelect(prefix) {
    const ap = document.getElementById(prefix + '_ap');
    const hEl = document.getElementById(prefix + '_h');
    const mEl = document.getElementById(prefix + '_m');
    if (!ap || !hEl || !mEl) return '';
    const apv = ap.value, hv = hEl.value, mv = mEl.value;
    if (!apv || hv === '' || mv === '') return '';
    let h = parseInt(hv, 10);
    if (apv === 'AM') { if (h === 12) h = 0; }          // 오전 12시 = 00시
    else { if (h !== 12) h += 12; }                      // 오후 1~11시 = 13~23시 (오후 12시=12시)
    return String(h).padStart(2, '0') + ':' + String(parseInt(mv, 10)).padStart(2, '0');
}

// 📱 전화번호 3박스 입력 (010-1234-5678). 앞 박스가 차면 자동으로 다음 칸으로 이동.
//   - 저장은 숫자만 결합 (readPhone) → 기존 '숫자만' 저장 방식과 동일.
//   - value 를 주면 3박스로 분할해 채운다(사전 입력/수정 대비).
function phoneInputHtml(prefix, value) {
    const v = (value || '').replace(/\D/g, '');
    const box = (n, ml, val, ph) =>
        `<input type="tel" inputmode="numeric" id="${prefix}_p${n}" class="phone-box" maxlength="${ml}" value="${val}" placeholder="${ph}" oninput="phoneAdvance(this)" onkeydown="phoneKey(event,this)">`;
    return `
        <div class="phone-group" id="${prefix}_phone">
            ${box(1, 3, v.slice(0, 3), '010')}
            <span class="phone-sep">-</span>
            ${box(2, 4, v.slice(3, 7), '1234')}
            <span class="phone-sep">-</span>
            ${box(3, 4, v.slice(7, 11), '5678')}
        </div>`;
}
function phoneAdvance(el) {
    el.value = el.value.replace(/\D/g, '');           // 숫자만 허용
    if (el.value.length >= el.maxLength) {
        const boxes = Array.from(el.closest('.phone-group').querySelectorAll('.phone-box'));
        const i = boxes.indexOf(el);
        if (i > -1 && i < boxes.length - 1) boxes[i + 1].focus();
    }
}
function phoneKey(e, el) {
    const boxes = Array.from(el.closest('.phone-group').querySelectorAll('.phone-box'));
    const i = boxes.indexOf(el);
    // 빈 칸에서 백스페이스 → 이전 칸의 마지막 숫자를 바로 지우고 이동 (칸 경계 없이 연속 삭제)
    if (e.key === 'Backspace' && el.value === '' && i > 0) {
        const prev = boxes[i - 1];
        prev.value = prev.value.slice(0, -1);
        prev.focus();
        e.preventDefault();
    // ← 칸 맨 앞에서 왼쪽 화살표 → 이전 칸
    } else if (e.key === 'ArrowLeft' && el.selectionStart === 0 && i > 0) {
        boxes[i - 1].focus();
        e.preventDefault();
    // → 칸 맨 뒤에서 오른쪽 화살표 → 다음 칸
    } else if (e.key === 'ArrowRight' && el.selectionStart === el.value.length && i < boxes.length - 1) {
        boxes[i + 1].focus();
        e.preventDefault();
    }
}
function readPhone(prefix) {
    const a = document.getElementById(prefix + '_p1');
    const b = document.getElementById(prefix + '_p2');
    const c = document.getElementById(prefix + '_p3');
    if (!a || !b || !c) return '';
    return (a.value + b.value + c.value).replace(/\D/g, '');
}
function clearPhone(prefix) {
    ['_p1', '_p2', '_p3'].forEach(s => { const el = document.getElementById(prefix + s); if (el) el.value = ''; });
}
// 동적 행(동반객 등): id 없이 컨테이너 안의 .phone-box 3칸을 합쳐 숫자만 반환.
function readPhoneIn(container) {
    if (!container) return '';
    const boxes = container.querySelectorAll('.phone-box');
    if (boxes.length < 3) return '';
    return Array.from(boxes).map(b => b.value).join('').replace(/\D/g, '');
}

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