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
const REGION_LIST = ['테크센터', '에코센터', '평택공장', '거제 오션센터'];

/**
 * 🌐 tOr — 여러 화면이 함께 쓰는 코드에서 안전하게 번역하는 헬퍼.
 *
 * 왜 t() 를 그냥 쓰면 안 되나
 *   다국어는 '손님 화면'에만 적용된다. 그런데 손님·임직원·경비실이 같은 guest.html 을
 *   쓰기 때문에 i18n.js 는 세 화면 모두에 로드된다. 사전(lang/*.json)만 손님 화면에서 받는다.
 *   → 임직원·경비실 화면에서는 t() 가 존재하지만 번역을 못 찾아 '키'를 그대로 돌려준다.
 *     실제로 시간 선택기에 "tp.am", "tp.placeholder" 가 그대로 찍힌 적이 있다.
 *
 * 사용법
 *   공용 파일(common.js 등)에서는 t('key') 대신 tOr('key', '한국어 기본값') 을 쓴다.
 *     tOr('tp.am', '오전')      → 손님 화면: AM / 上午,  그 외 화면: 오전
 *   손님 화면 전용 파일(visitor.js)에서는 t() 를 그대로 써도 된다.
 *
 * @param {string} key 번역 키
 * @param {string} ko  번역이 없을 때 쓸 한국어 문구 (필수 — 생략하면 키가 노출된다)
 */
function tOr(key, ko) {
    if (typeof t !== 'function') return ko;
    const s = t(key);
    return (!s || s === key) ? ko : s;   // 사전 미로드 시 t() 는 키를 그대로 반환한다
}

// 🕒 시간 선택기 — 크롬 기본 시간 픽커 스타일의 커스텀 '컬럼 스크롤' 드롭다운.
//   - 네이티브 <input type=time> 은 분 단위를 못 바꾸므로 동일한 컬럼 UI 를 직접 구현.
//   - [오전/오후] [시 01~12] [분 00,10,…,50] 3열. 선택값은 hidden input({prefix}_ap/_h/_m)에 저장.
// 현재 KST 시각을 '이상(올림)'인 10분 단위로 반환 → {ap, h(1~12), m}.
//   예) 14:14 → 오후 02:20, 11:17 → 오전 11:20, 23:55 → 오전 12:00(익일)
function roundUpToTenKst() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const kst = new Date(utc + (9 * 60 * 60 * 1000));
    let h = kst.getHours();
    let m = Math.ceil(kst.getMinutes() / 10) * 10;
    if (m >= 60) { m = 0; h = (h + 1) % 24; }
    const ap = h < 12 ? 'AM' : 'PM';
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    return { ap: ap, h: h12, m: m };
}

// def(선택) = {ap,'AM'|'PM', h:1~12, m:0~50} 를 주면 그 값으로 기본 선택된 상태로 렌더.
function timeSelectHtml(prefix, def) {
    const selAp = def ? def.ap : '';
    const selH = def ? String(def.h) : '';
    const selM = def ? String(def.m) : '';
    const apCol = [['AM', tOr('tp.am', '오전')], ['PM', tOr('tp.pm', '오후')]]
        .map(([v, l]) => `<div class="tp-opt${v === selAp ? ' sel' : ''}" onclick="tpSelect('${prefix}','ap','${v}',this)">${l}</div>`).join('');
    let hCol = '';
    for (let h = 1; h <= 12; h++)
        hCol += `<div class="tp-opt${String(h) === selH ? ' sel' : ''}" onclick="tpSelect('${prefix}','h','${h}',this)">${String(h).padStart(2, '0')}</div>`;
    let mCol = '';
    for (let m = 0; m < 60; m += 10)
        mCol += `<div class="tp-opt${String(m) === selM ? ' sel' : ''}" onclick="tpSelect('${prefix}','m','${m}',this)">${String(m).padStart(2, '0')}</div>`;
    const displayHtml = def
        ? `<span class="tp-value">${def.ap === 'AM' ? tOr('tp.am', '오전') : tOr('tp.pm', '오후')} ${String(def.h).padStart(2, '0')}:${String(def.m).padStart(2, '0')}</span>`
        : `<span class="tp-placeholder">${tOr('tp.placeholder', '시간 선택')}</span>`;
    return `
        <div class="tp-wrap" id="${prefix}_wrap">
            <input type="hidden" id="${prefix}_ap" value="${selAp}">
            <input type="hidden" id="${prefix}_h" value="${selH}">
            <input type="hidden" id="${prefix}_m" value="${selM}">
            <button type="button" class="tp-field" id="${prefix}_display" onclick="tpToggle('${prefix}')">
                ${displayHtml}
            </button>
            <div class="tp-panel" id="${prefix}_panel">
                <div class="tp-col">${apCol}</div>
                <div class="tp-col" data-base="12">${hCol}</div>
                <div class="tp-col" data-base="12">${mCol}</div>
            </div>
        </div>`;
}

// 컬럼 바닥 근처에서 원본 묶음(00~55 / 01~12)을 한 벌 더 덧붙여 '무한 스크롤' 느낌.
//   - 아래에 추가하므로 스크롤 위치가 튀지 않아 버벅임 없음.
function tpAppendBatch(col) {
    const base = parseInt(col.dataset.base || '0', 10);
    if (!base) return;
    const opts = col.querySelectorAll('.tp-opt');
    for (let k = 0; k < base && k < opts.length; k++) {
        col.appendChild(opts[k].cloneNode(true));   // inline onclick 도 함께 복제됨
    }
}

// 픽커 열기/닫기 (다른 픽커는 닫음)
function tpToggle(prefix) {
    const panel = document.getElementById(prefix + '_panel');
    if (!panel) return;
    const willOpen = !panel.classList.contains('open');
    document.querySelectorAll('.tp-panel.open').forEach(p => p.classList.remove('open'));
    if (willOpen) {
        panel.classList.add('open');
        // 스크롤 시 바닥 근처면 묶음 추가 (리스너는 컬럼당 1회만 등록)
        panel.querySelectorAll('.tp-col[data-base]').forEach(col => {
            if (!col.dataset.loopBound) {
                col.dataset.loopBound = '1';
                col.addEventListener('scroll', () => {
                    if (col.scrollTop + col.clientHeight >= col.scrollHeight - 40) tpAppendBatch(col);
                });
            }
        });
    }
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
        const apLabel = ap === 'AM' ? tOr('tp.am', '오전') : tOr('tp.pm', '오후');
        document.getElementById(prefix + '_display').innerHTML =
            `<span class="tp-value">${apLabel} ${String(h).padStart(2, '0')}:${String(parseInt(m, 10)).padStart(2, '0')}</span>`;
        // 마지막 칸인 '분'을 고르면 선택이 끝난 것으로 보고 바로 닫는다.
        //   '세 칸이 다 챠을 때' 로 하면 안 된다 — 입실 예정시간은 기본값이 미리 들어 있어
        //   오전/오후만 눌러도 공란이 다 차서, 시·분을 고르기 전에 닫혀버린다.
        //   고른 항목에 표시(sel)가 들어온 걸 눈으로 확인할 여유만 짧게 둔다.
        if (type === 'm') {
            const panel = document.getElementById(prefix + '_panel');
            if (panel) setTimeout(() => panel.classList.remove('open'), 150);
        }
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
        // 🎫 이용권 유효기간 운영 단위 — 서버 값을 그대로 받아 화면 선택지·기간 계산에 쓴다.
        if (data && data.pass_periods) window.PASS_PERIODS = data.pass_periods;
        if (data && data.pass_default_period) window.PASS_DEFAULT_PERIOD = data.pass_default_period;
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

// ====================================================================
// 📍 거점별 링크·QR 안내 (직원용 보조)
//   - 링크는 현재 접속 도메인(window.location.origin) 기준으로 생성 → IP/도메인/https 무관.
//   - QR 이미지는 /qr/<코드>.png (qr/ 폴더에 업로드). 없으면 '준비중' 안내로 대체.
// ====================================================================
const REGION_QR_LIST = [
    { code: 'dt', name: '테크센터', area: '동탄' },
    { code: 'bs', name: '에코센터', area: '부산' },
    { code: 'pt', name: '평택공장', area: '평택' },
    { code: 'gj', name: '거제 오션센터', area: '거제' },
];

function openRegionQrModal() {
    const modal = document.getElementById('regionQrModal');
    const grid = document.getElementById('regionQrGrid');
    if (!modal || !grid) return;
    const origin = window.location.origin;
    grid.innerHTML = REGION_QR_LIST.map(r => {
        const link = origin + '/v/' + r.code;
        return `
            <div class="region-qr-card">
                <div class="region-qr-name">${r.name} <span class="region-qr-area">(${r.area})</span></div>
                <div class="region-qr-imgwrap">
                    <img class="region-qr-img" src="/api/region-qr/${r.code}" alt="${r.name} QR"
                         onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                    <div class="region-qr-missing" style="display:none;">QR 생성 실패<br><small>서버 재시작 필요</small></div>
                </div>
                <div class="region-qr-link" title="${link}">${link}</div>
                <button type="button" class="region-qr-copy" onclick="copyRegionInfo('${r.code}','${r.name}','${r.area}','${link}', this)">센터명·QR·링크 복사</button>
            </div>`;
    }).join('');
    // QR PNG를 미리 base64 data URI 로 캐시 → '복사' 클릭 시 동기 실행되어 클립보드가 안정적.
    window.__regionQrPng = window.__regionQrPng || {};
    REGION_QR_LIST.forEach(r => {
        if (window.__regionQrPng[r.code]) return;
        fetch('/api/region-qr/' + r.code)
            .then(res => res.ok ? res.blob() : Promise.reject())
            .then(blobToDataUri)
            .then(d => { window.__regionQrPng[r.code] = d; })
            .catch(() => {});
    });
    modal.classList.remove('display-none');
}

function closeRegionQrModal() {
    const modal = document.getElementById('regionQrModal');
    if (modal) modal.classList.add('display-none');
}

// Blob → data URI (base64) 변환
function blobToDataUri(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
    });
}

// 센터명 + QR 이미지(PNG) + 링크를 '리치'로 복사 (카톡·메일·워드 등에 그대로 붙여넣기).
//   - QR을 PNG base64 data URI 로 내장 → Word 등에서도 이미지가 정상 삽입됨(SVG는 미지원).
//   - 모달 열 때 미리 캐시해 둔 data URI 를 쓰면 복사 클릭이 동기 실행되어 클립보드가 안정적.
//   - execCommand 기반이라 http(비보안) 환경에서도 동작. 실패 시 텍스트(센터명+링크)만 폴백.
async function copyRegionInfo(code, name, area, link, btn) {
    const orig = btn.textContent;
    const flash = (msg) => { btn.textContent = msg; setTimeout(() => { btn.textContent = orig; }, 1800); };
    try {
        let pngDataUri = (window.__regionQrPng || {})[code];
        if (!pngDataUri) {
            const res = await fetch('/api/region-qr/' + code);
            if (!res.ok) throw new Error('qr fetch failed');
            pngDataUri = await blobToDataUri(await res.blob());
        }
        const tmp = document.createElement('div');
        tmp.setAttribute('contenteditable', 'true');
        // 배경/글자색을 명시해, 복사 HTML에 페이지 배경색(#f8fafc)이 딸려가 Word 에서 음영으로 보이는 것을 방지.
        tmp.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:normal;background:#ffffff;color:#000000;';
        tmp.innerHTML =
            '<div style="background:#ffffff;color:#000000;"><strong>' + name + ' (' + area + ')</strong></div>' +
            '<div style="background:#ffffff;"><img src="' + pngDataUri + '" width="200" height="200" alt="' + name + ' QR"></div>' +
            '<div style="background:#ffffff;color:#000000;">' + link + '</div>';
        document.body.appendChild(tmp);
        const range = document.createRange();
        range.selectNodeContents(tmp);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const ok = document.execCommand('copy');
        sel.removeAllRanges();
        document.body.removeChild(tmp);
        if (ok) { flash('복사됨 ✓'); return; }
    } catch (e) { /* 아래 텍스트 폴백 */ }

    // 폴백: 센터명 + 링크 텍스트만
    const text = name + ' (' + area + ')\n' + link;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => flash('복사됨 ✓ (텍스트)')).catch(() => fallbackCopyLink(text, () => flash('복사됨 ✓ (텍스트)')));
    } else {
        fallbackCopyLink(text, () => flash('복사됨 ✓ (텍스트)'));
    }
}

function fallbackCopyLink(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* noop */ }
    document.body.removeChild(ta);
}
