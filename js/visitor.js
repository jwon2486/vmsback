/**
 * js/visitor.js
 * 방문객(외부인) 현장 입/퇴실 프로세스 (인라인 CSS 완벽 제거 및 동반객 로직 추가)
 */

async function initVisitorPage() {
    stopVisitorPolling();
    // 🔳 QR 스캔(=링크 접속): URL 에 token 이 있으면 해당 방문 건 상태/행동 화면으로.
    const scanToken = new URLSearchParams(window.location.search).get('token');
    if (scanToken) { showScanStatus(scanToken); return; }

    const myVisitorId = localStorage.getItem('my_visitor_id');
    if (myVisitorId) {
        try {
            const res = await fetch(`/api/check-status/${myVisitorId}`);
            const status = await res.json();
            const v = status.visitor;
            if (v) {
                // 입실완료: 전용 퇴실 화면
                if (v.status === '입실완료') { showCheckoutPage(v); return; }
                // 진행 중(입실대기·퇴실대기): 본인 상태 화면으로 복귀(대기 시 자동 갱신)
                if (v.status === '입실대기' || v.status === '퇴실대기') { showPrecheckStatus(myVisitorId); return; }
                // 종료(퇴실완료·만료): 오래된 정보 정리 후 첫 화면
                if (v.status === '퇴실완료' || v.status === '만료') { localStorage.removeItem('my_visitor_id'); }
            }
        } catch (e) {}
    }
    showMainPage();
}

function goGuestHome() { stopVisitorPolling(); window.location.href = '/'; }

// ===== 방문객 상태 자동 갱신(폴링) =====
//  - 대기 상태(입실대기·퇴실대기)에서만 5초 주기로 상태를 재확인.
//  - 입실완료·퇴실완료·만료로 바뀌면(=대기 아님) 폴링을 멈추고 화면을 갱신.
let visitorPollTimer = null;

function stopVisitorPolling() {
    if (visitorPollTimer) { clearInterval(visitorPollTimer); visitorPollTimer = null; }
}

function isWaitingStatus(status) {
    return status === '입실대기' || status === '퇴실대기';
}

// fetchFn: async () => 방문객객체|null,  onResolved: (방문객객체) => void
function startVisitorPolling(fetchFn, onResolved) {
    stopVisitorPolling();
    visitorPollTimer = setInterval(async () => {
        try {
            const v = await fetchFn();
            if (!v) return;
            if (!isWaitingStatus(v.status)) {
                stopVisitorPolling();
                onResolved(v);
            }
        } catch (e) {}
    }, 5000);
}

async function fetchStatusByToken(token) {
    const res = await fetch(`/api/visitor/by-token?token=${encodeURIComponent(token)}`);
    const d = await res.json();
    return (d && d.success) ? d.visitor : null;
}

async function fetchStatusById(id) {
    const res = await fetch(`/api/check-status/${id}`);
    const d = await res.json();
    return (d && d.visitor) ? d.visitor : null;
}

// 🔳 QR 스캔 진입 시: 토큰으로 상태 조회 → 상태 표시. 입실완료면 퇴실 신청 팝업(네/아니오).
async function showScanStatus(token, fromPoll = false) {
    stopVisitorPolling();
    resetWideLayout();
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    if (!fromPoll) appCard.innerHTML = `<div class="shimmer-loader"><div class="spinner"></div><p>방문 정보를 확인하고 있습니다...</p></div>`;

    let data = null;
    try {
        const res = await fetch(`/api/visitor/by-token?token=${encodeURIComponent(token)}`);
        data = await res.json();
    } catch (e) {}

    if (!data || !data.success) {
        appCard.innerHTML = `
            <h2 class="guest-title-bold-style">QR 확인</h2>
            <div class="no-data-box"><span class="icon">⚠️</span><p>${(data && data.message) || '유효하지 않은 코드입니다.'}</p></div>
            <div class="action-buttons visitor-btn-margin"><button onclick="goGuestHome()" class="btn-guest-sub">처음 화면으로</button></div>`;
        return;
    }

    const v = data.visitor;
    const sv = getStatusView(v.status);
    const checkoutBtn = sv.canCheckout
        ? `<div class="action-buttons"><button onclick="submitCheckout(${v.id})" class="btn-guest-main">지금 퇴실 요청하기</button></div>`
        : '';
    const waitingHint = isWaitingStatus(v.status)
        ? `<p class="poll-live-hint">🔄 승인되면 자동으로 갱신됩니다. 이 화면을 열어두세요.</p>`
        : '';
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">방문 상태 확인</h2>
        <div class="visitor-info-box">
            <p class="greet"><strong>${v.name}</strong> 님</p>
            <span class="badge-company">${v.company || '-'}</span>
            <p class="status-line"><b>${sv.label}</b></p>
            <p class="status-desc">${sv.desc}</p>
            <p class="time-info">입실: ${v.checkin_time || '-'} / 퇴실: ${v.checkout_time || '-'}</p>
            ${waitingHint}
        </div>
        ${checkoutBtn}
        <div class="action-buttons visitor-btn-margin"><button onclick="goGuestHome()" class="btn-guest-sub">처음 화면으로</button></div>
    `;

    // 입실완료 상태면 스캔 핵심 행동(퇴실) 팝업 — 최초 스캔 시에만(폴링 갱신 시에는 X)
    if (sv.canCheckout && !fromPoll) {
        setTimeout(() => {
            if (confirm('퇴실 신청을 하시겠습니까?')) submitCheckout(v.id);
        }, 300);
    }

    // 대기 상태면 자동 갱신 시작
    if (isWaitingStatus(v.status)) {
        startVisitorPolling(() => fetchStatusByToken(token), () => showScanStatus(token, true));
    }
}

function showMainPage() {
    stopVisitorPolling();
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
    stopVisitorPolling();
    resetWideLayout(); 
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">방문 조회 / 등록</h2>
        <div class="form-container form-container-verify-margin">
            <div class="input-group">
                <label>방문객 성명</label>
                <input type="text" id="checkName" placeholder="본인 성명" autocomplete="off">
            </div>
            <div class="input-group">
                <label>전화번호</label>
                <input type="tel" id="checkContact" placeholder="- 없이 숫자만 입력" autocomplete="off">
            </div>
        </div>
        <div class="action-buttons">
            <button onclick="verifyVisitorName()" class="btn-guest-main">조회하기</button>
            <button onclick="showMainPage()" class="btn-guest-sub">취소</button>
        </div>
    `;
}

async function verifyVisitorName() {
    const checkNameInput = document.getElementById("checkName");
    const checkContactInput = document.getElementById("checkContact");
    if (!checkNameInput) return;
    
    const name = checkNameInput.value.trim();
    const contact = checkContactInput ? checkContactInput.value.trim() : '';
    if (!name) return alert('성명을 입력해 주세요.');
    if (!contact) return alert('전화번호를 입력해 주세요.');

    try {
        const res = await fetch('/api/check-preregister', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, contact })
        });
        const result = await res.json();
        if (result.success && result.list && result.list.length > 0) {
            showPreMatchSelection(result.list, name, contact);
        } else {
            // 등록된 건이 없으면 현장 등록창으로 (이름·전화번호 프리필)
            showCheckinForm(name, contact); 
        }
    } catch (e) { 
        showCheckinForm(name, contact);
    }
}

function showPreMatchSelection(list, originalName, originalContact = '') {
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    let listHtml = '';
    list.forEach(v => {
        const managerInfo = v.emp_name ? `${v.emp_name} (${v.emp_dept})` : "미지정";
        const isWaiting = (v.status === '입실대기');
        const statusNote = isWaiting ? '<span class="match-status-wait">🟡 이미 접수됨 · 경비 승인 대기중 (눌러서 상태 확인)</span>' : '';
        // 입실대기(이미 접수됨) → 입실 트리거 없이 상태 안내. 사전예약(레거시) → 기존 입실 처리.
        const clickHandler = isWaiting ? `showPrecheckStatus(${v.id})` : `submitConfirmPrecheck(${v.id})`;
        listHtml += `
            <div class="match-item" onclick="${clickHandler}">
                <span class="match-manager">📋 사내 담당자: ${managerInfo}</span>
                <strong class="match-title">${v.name} <span class="match-corp">(${v.company})</span></strong>
                <p class="match-purpose">방문 목적: ${v.purpose}</p>
                ${statusNote}
            </div>
        `;
    });
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">사전 등록 스케줄</h2>
        <div class="results-container">${listHtml}</div>
        <button onclick="showCheckinForm('${originalName}', '${originalContact}')" class="btn-guest-sub direct-register-btn-margin">내 스케줄이 없습니다 (현장 등록)</button>
    `;
}

// 이미 접수된(입실대기) 건: 입실 트리거 없이 현재 상태만 안내
async function showPrecheckStatus(id, fromPoll = false) {
    stopVisitorPolling();
    resetWideLayout();
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    if (!fromPoll) appCard.innerHTML = `<div class="shimmer-loader"><div class="spinner"></div><p>상태를 확인하고 있습니다...</p></div>`;

    let s = null;
    try {
        const res = await fetch(`/api/check-status/${id}`);
        s = await res.json();
    } catch (e) {}

    if (!s || !s.visitor) {
        appCard.innerHTML = `
            <h2 class="guest-title-bold-style">상태 확인</h2>
            <div class="no-data-box"><span class="icon">⚠️</span><p>상태 정보를 불러오지 못했습니다.</p></div>
            <div class="action-buttons visitor-btn-margin"><button onclick="showNameVerifyForm()" class="btn-guest-sub">뒤로</button></div>`;
        return;
    }

    const v = s.visitor;
    const sv = getStatusView(v.status);
    const checkoutBtn = sv.canCheckout
        ? `<div class="action-buttons"><button onclick="submitCheckout(${v.id})" class="btn-guest-main">지금 퇴실 요청하기</button></div>`
        : '';
    const qrHtml = v.token
        ? `<div class="guest-qr-box">
               <img src="/api/qr?token=${encodeURIComponent(v.token)}" alt="내 방문 QR" class="guest-qr-img">
               <p class="guest-qr-hint">이 QR을 저장해 두면 다음부터 스캔만으로 확인·퇴실할 수 있습니다.</p>
           </div>`
        : '';
    const waitingHint = isWaitingStatus(v.status)
        ? `<p class="poll-live-hint">🔄 승인되면 자동으로 갱신됩니다. 이 화면을 열어두세요.</p>`
        : '';
    const groupBtn = (v.group_size && v.group_size >= 2)
        ? `<div class="action-buttons"><button onclick="showGroupQr(${v.id})" class="btn-guest-sub">👥 일행 전체 QR 보기</button></div>`
        : '';
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">방문 상태 확인</h2>
        <div class="visitor-info-box">
            <p class="greet"><strong>${v.name}</strong> 님</p>
            <span class="badge-company">${v.company || '-'}</span>
            <p class="status-line"><b>${sv.label}</b></p>
            <p class="status-desc">${sv.desc}</p>
            <p class="time-info">입실: ${v.checkin_time || '-'} / 퇴실: ${v.checkout_time || '-'}</p>
            ${waitingHint}
        </div>
        ${qrHtml}
        ${groupBtn}
        ${checkoutBtn}
        <div class="action-buttons visitor-btn-margin"><button onclick="showNameVerifyForm()" class="btn-guest-sub">뒤로</button></div>
    `;

    // 대기 상태면 자동 갱신 시작
    if (isWaitingStatus(v.status)) {
        startVisitorPolling(() => fetchStatusById(id), () => showPrecheckStatus(id, true));
    }
}

async function submitConfirmPrecheck(id, force = false) {
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
                return submitConfirmPrecheck(id, true);
            }
            return;
        }

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

function updateCompanionNumbers() {
    const container = document.getElementById('companion-container');
    if (!container) return;
    const titles = container.querySelectorAll('.comp-dynamic-title');
    titles.forEach((titleEl, index) => {
        titleEl.innerHTML = `👤 동반 방문객 ${index + 1}`;
    });
}

function clearAllCompanions() {
    const container = document.getElementById('companion-container');
    if (!container) return;
    const boxes = container.querySelectorAll('.companion-box');
    if (boxes.length === 0) return; 
    
    if (!confirm('추가된 동반 일행 정보를 모두 삭제하시겠습니까?')) return;

    boxes.forEach(box => box.remove());
    const msg = document.getElementById('empty-companion-msg');
    if (msg) msg.classList.remove('display-none');
    companionCount = 0; 
}

function addCompanionField() {
    const msg = document.getElementById('empty-companion-msg');
    if (msg) msg.classList.add('display-none');

    const mainCompanyInput = document.getElementById('company');
    const defaultCompany = mainCompanyInput ? mainCompanyInput.value.trim() : '';

    companionCount++;
    const id = 'comp-box-' + Date.now() + '-' + companionCount;
    const container = document.createElement('div');
    container.id = id;
    container.className = 'companion-box form-container-verify-margin companion-box-style mb-15';
    
    container.innerHTML = `
        <button type="button" onclick="removeCompanionField('${id}')" class="btn-comp-delete">삭제</button>
        <h4 class="comp-title-blue mb-15 comp-dynamic-title">👤 동반 방문객</h4>
        <div class="input-row-group mb-10">
            <div class="input-group"><label class="fs-8">성명 <span class="req-star">*</span></label><input type="text" class="comp-name comp-input-style" placeholder="동반인 성명"></div>
            <div class="input-group"><label class="fs-8">연락처 <span class="req-star">*</span></label><input type="text" class="comp-contact comp-input-style" placeholder="- 없이 숫자만"></div>
        </div>
        <div class="input-row-group mb-0">
            <div class="input-group"><label class="fs-8">소속 회사명</label><input type="text" class="comp-company comp-input-style" value="${defaultCompany}" placeholder="회사명 입력"></div>
            <div class="input-group"><label class="fs-8">차량 번호</label><input type="text" class="comp-vehicle comp-input-style" placeholder="없을 시 비워두세요"></div>
        </div>
    `;
    document.getElementById('companion-container').appendChild(container);
    updateCompanionNumbers();
}

function removeCompanionField(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
    
    const container = document.getElementById('companion-container');
    if (container && container.querySelectorAll('.companion-box').length === 0) {
        const msg = document.getElementById('empty-companion-msg');
        if (msg) msg.classList.remove('display-none');
        companionCount = 0;
    }
    updateCompanionNumbers();
}

function showCheckinForm(passedName = '', passedContact = '') {
    companionCount = 0; 
    
    const container = document.querySelector('.container');
    if (container) container.classList.add('container-wide');
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    
    appCard.classList.remove('card-emp-wide');
    appCard.classList.add('card-wide', 'card-guest-wide');

    let regionSelectorHtml = '';
    if (typeof currentRegion !== 'undefined' && currentRegion) {
        // QR/키오스크로 거점이 확정된 경우: 선택 UI 대신 확인 문구만 노출하고 값은 hidden 으로 전달
        regionSelectorHtml = `
            <div class="input-group mb-15">
                <div class="region-confirm-box" style="padding:10px 14px; background:#eef6ff; border:1px solid #bcdcff; border-radius:8px; font-weight:700; color:#1d4ed8;">
                    📍 ${currentRegion} 방문으로 등록됩니다.
                </div>
                <input type="hidden" id="guestRegionSelect" value="${currentRegion}">
            </div>
        `;
    } else {
        // QR 없이 직접 접속한 경우: 손님이 직접 사업장 선택 (value=사내 거점명, 표시=지명 병기)
        regionSelectorHtml = `
            <div class="input-group mb-15 warning-box">
                <label class="warning-text">📍 현재 방문하신 사업장을 선택해주세요 <span class="req-star">*</span></label>
                <select id="guestRegionSelect">
                    <option value="">-- 방문하신 사업장을 선택하세요 --</option>
                    <option value="테크센터">동탄 (테크센터)</option>
                    <option value="에코센터">부산 (에코센터)</option>
                    <option value="평택공장">평택공장</option>
                    <option value="거제 조선소">거제 조선소</option>
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
                        <div class="input-group"><label>성명 <span class="req-star">*</span></label><input type="text" id="name" value="${passedName}" placeholder="예) 홍길동"></div>
                        <div class="input-group"><label>본인 연락처 <span class="req-star">*</span></label><input type="text" id="contact" value="${passedContact}" placeholder="- 없이 숫자만 입력"></div>
                    </div>
                    
                    <div class="input-row-group">
                        <div class="input-group"><label>소속 회사명 <span class="req-star">*</span></label><input type="text" id="company" placeholder="예) 소속 기업명 입력"></div>
                        <div class="input-group"><label>차량 번호</label><input type="text" id="vehicle_no" placeholder="없을 시 비워두세요"></div>
                    </div>

                    <div class="input-row-group">
                        <div class="input-group"><label>방문 예정시간 <span class="req-star">*</span></label><input type="time" id="expectedCheckin"></div>
                        <div class="input-group"><label>퇴실 예정시간 <span class="req-star">*</span></label><input type="time" id="expectedCheckout"></div>
                    </div>

                    <div class="input-group">
                        <label>사내 방문 담당자 성명 <span class="req-star">*</span></label>
                        <input type="text" id="manager_text" placeholder="만나실 직원의 성명을 정확히 적어주세요">
                    </div>

                    <div class="input-group mb-20">
                        <label>방문 목적 <span class="req-star">*</span></label>
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
                    
                    <button type="button" onclick="openSheetAndAddFirst('guest')" class="btn-guest-sub mt-15 mobile-only-btn">
                        ➕ 동반 일행 추가 (선택)
                    </button>

                    <div class="privacy-consent-box mt-15">
                        <p class="privacy-text">
                            <strong>[개인정보 수집 및 이용 안내]</strong><br>
                            - 수집 항목: <strong>이름, 전화번호, 회사명, 차량번호</strong><br>
                            - 수집 목적: 사내 보안 및 출입 관리, 긴급 연락<br>
                            - 보유 기간: <strong>방문 목적 달성 후 파기 (또는 사내 보안 규정에 따름)</strong>
                        </p>
                        <div class="remember-me-box remember-checkbox-layout-style mt-10">
                            <input type="checkbox" id="privacyConsent" class="remember-checkbox-size">
                            <label for="privacyConsent" class="remember-label-pointer" style="color: #b91c1c; font-weight: 700;">
                                (필수) 개인정보 수집 및 이용에 동의합니다.
                            </label>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="dashboard-divider-line" id="guest-divider-line"></div>
            
            <div class="bs-overlay" onclick="closeCompanionSheet()"></div>
            
            <div class="dashboard-list-zone bs-sheet" id="guest-companion-zone">
                <div class="bs-handle" onclick="closeCompanionSheet()"></div>
                
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px;" class="desktop-only-title zone-title">
                    <h3 class="my-title-color" style="margin-bottom:0; font-size:1.2rem;">👥 동반 일행 정보</h3>
                    <button type="button" onclick="clearAllCompanions()" class="btn-list-action bg-orange" style="padding:4px 10px; font-size:0.8rem;">전체 삭제</button>
                </div>

                <div id="companion-container" class="results-container schedule-list-scroll-box guest-comp-scroll-box">
                    <div class="no-data-box empty-comp-msg" id="empty-companion-msg"><p>우측 하단 버튼을 눌러 동반 일행을 추가하세요.</p></div>
                </div>
                <button type="button" onclick="addCompanionField()" class="btn-guest-sub btn-add-comp-outline mt-15">
                    ➕ 인원 계속 추가
                </button>
                <button type="button" onclick="closeCompanionSheet()" class="btn-emp-main mobile-bs-close mt-15">입력 완료 (닫기)</button>
            </div>
        </div>

        <div class="action-buttons action-buttons-margin">
            <button onclick="submitCheckin()" class="btn-guest-main">등록 완료 및 승인 요청</button>
            <button onclick="showMainPage()" class="btn-guest-sub">취소</button>
        </div>
    `;
}

async function submitCheckin() {
    const privacyConsentEl = document.getElementById('privacyConsent');
    if (privacyConsentEl && !privacyConsentEl.checked) {
        alert('출입 등록을 위해 개인정보 수집 및 이용에 동의해 주세요.');
        privacyConsentEl.focus();
        return;
    }

    const nameEl = document.getElementById('name');
    const companyEl = document.getElementById('company');
    const contactEl = document.getElementById('contact');
    const vehicleNoEl = document.getElementById('vehicle_no');
    const managerTextEl = document.getElementById('manager_text');
    const purposeEl = document.getElementById('purpose');

    const guestRegionEl = document.getElementById('guestRegionSelect');
    const finalRegion = guestRegionEl ? guestRegionEl.value : (typeof currentRegion !== 'undefined' ? currentRegion : null);

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

    const expectedCheckinEl = document.getElementById('expectedCheckin');
    const expectedCheckoutEl = document.getElementById('expectedCheckout');
    const expected_checkin = expectedCheckinEl ? expectedCheckinEl.value.trim() : '';
    const expected_checkout = expectedCheckoutEl ? expectedCheckoutEl.value.trim() : '';
    
    if (!name || !company || !contact || !manager_text) return alert('필수 항목을 모두 입력해 주세요.');
    if (!expected_checkin || !expected_checkout) return alert('방문 예정시간과 퇴실 예정시간을 입력해 주세요.');

    let visitorsArray = [{
        name, company, contact, vehicle_no, manager_text, purpose, expected_checkin, expected_checkout
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
                purpose: purpose,
                expected_checkin: expected_checkin,
                expected_checkout: expected_checkout
            });
        }
    }

    try {
        const res = await fetch('/api/group-checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitors: visitorsArray, region: finalRegion }) 
        });
        const result = await res.json();
        if (result.success) {
            localStorage.setItem('my_visitor_id', result.id);
            showRegistrationComplete(result.members, result.message);
        } else {
            alert(result.message || "오류가 발생했습니다.");
        }
    } catch (e) {
        alert("서버와의 통신이 원활하지 않습니다.");
    }
}

// 🔳 등록 완료 화면: 그룹 전원의 개인 QR을 각자 이름과 함께 표시
//    (대표자 폰 방전/분실 대비 — 각자 자기 QR을 저장; 직접 조회 백업도 병행 가능)
function showRegistrationComplete(members, message) {
    resetWideLayout();
    const appCard = document.getElementById('app-card');
    if (!appCard) return;

    let qrListHtml = '';
    if (Array.isArray(members) && members.length > 0) {
        qrListHtml = members.map(m => m.token ? `
            <div class="guest-qr-box">
                <p class="guest-qr-name">${m.name} 님</p>
                <img src="/api/qr?token=${encodeURIComponent(m.token)}" alt="${m.name} 방문 QR" class="guest-qr-img">
            </div>` : '').join('');
        if (qrListHtml) {
            qrListHtml = `
                <p class="guest-qr-guide">👇 각자 <strong>본인 QR</strong>을 저장(캡처)해 두세요. 퇴실 시 스캔만으로 처리됩니다. QR이 없어도 <strong>이름+전화번호</strong>로 조회하면 됩니다.</p>
                <div class="guest-qr-grid">${qrListHtml}</div>`;
        }
    }

    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">✅ 등록 완료</h2>
        <div class="visitor-info-box">
            <p class="status-line"><b>🟡 입실 승인 대기중</b></p>
            <p class="status-desc">${message || '입실 요청이 접수되었습니다. 경비실 승인을 기다려 주세요.'}</p>
        </div>
        ${qrListHtml}
        <div class="action-buttons visitor-btn-margin"><button onclick="goGuestHome()" class="btn-guest-sub">처음 화면으로</button></div>
    `;
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
            // 퇴실 요청 접수(퇴실대기) → 상태 화면 표시. 최종 승인되면 자동 갱신됨.
            showPrecheckStatus(id);
        }
    } catch (e) {}
}

function showSearchForm() {
    stopVisitorPolling();
    resetWideLayout(); 
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">내 방문 상태 조회</h2>
        <div class="form-container form-container-verify-margin">
            <div class="input-group">
                <label>성명</label>
                <input type="text" id="searchName" placeholder="본인 성명 (정확히 입력)" autocomplete="off">
            </div>
            <div class="input-group">
                <label>전화번호</label>
                <input type="tel" id="searchContact" placeholder="등록한 전화번호 (숫자만, 예: 01012345678)" autocomplete="off">
            </div>
        </div>
        <div class="action-buttons">
            <button onclick="searchVisitor()" class="btn-guest-main">조회하기</button>
            <button onclick="initVisitorPage()" class="btn-guest-sub">처음 화면으로</button>
        </div>
        <div id="searchResult"></div>
    `;
}

// 상태별 안내 정보 (배지 문구/색 클래스/설명)
function getStatusView(status) {
    switch (status) {
        case '입실대기': return { label: '🟡 입실 승인 대기중', desc: '경비실의 입실 승인을 기다리고 있습니다. 승인 완료 후 퇴실 요청이 가능합니다.', canCheckout: false };
        case '입실완료': return { label: '🟢 입실 완료 (재실중)', desc: '정상 입실 상태입니다. 나가실 때 아래 버튼으로 퇴실 요청을 해주세요.', canCheckout: true };
        case '퇴실대기': return { label: '🟠 퇴실 승인 대기중', desc: '퇴실 요청이 접수되었습니다. 경비실 최종 승인 후 마감됩니다.', canCheckout: false };
        case '퇴실완료': return { label: '✅ 퇴실 완료', desc: '이미 퇴실 처리가 완료된 방문입니다.', canCheckout: false };
        case '만료':     return { label: '⛔ 만료됨', desc: '입실하지 않아 만료된 예약입니다. 방문하시려면 처음 화면에서 다시 등록해 주세요.', canCheckout: false };
        default:         return { label: `ℹ️ ${status || '상태 미상'}`, desc: '현재 상태 정보를 확인해 주세요.', canCheckout: false };
    }
}

async function searchVisitor() {
    const nameEl = document.getElementById('searchName');
    const contactEl = document.getElementById('searchContact');
    const resultDiv = document.getElementById('searchResult');
    if (!resultDiv) return;

    const name = nameEl ? nameEl.value.trim() : '';
    const contact = contactEl ? contactEl.value.trim() : '';
    if (!name || !contact) {
        resultDiv.innerHTML = `<div class="no-data-box"><span class="icon">✏️</span><p>성명과 전화번호를 모두 입력해 주세요.</p></div>`;
        return;
    }

    try {
        const res = await fetch(`/api/search?name=${encodeURIComponent(name)}&contact=${encodeURIComponent(contact)}`);
        const list = await res.json();

        if (!list || list.length === 0) {
            resultDiv.innerHTML = `<div class="no-data-box"><span class="icon">🔍</span><p>검색된 결과가 없습니다.</p></div>`;
            return;
        }

        // 이름+전화번호 정확 일치라 사실상 1건. 가장 최근 건 기준으로 상태 표시.
        const v = list[0];
        const sv = getStatusView(v.status);
        const checkoutBtn = sv.canCheckout
            ? `<div class="action-buttons"><button onclick="submitCheckout(${v.id})" class="btn-guest-main">지금 퇴실 요청하기</button></div>`
            : '';
        const qrHtml = v.token
            ? `<div class="guest-qr-box">
                   <img src="/api/qr?token=${encodeURIComponent(v.token)}" alt="내 방문 QR" class="guest-qr-img">
                   <p class="guest-qr-hint">이 QR을 저장해 두면 다음부터 스캔만으로 확인·퇴실할 수 있습니다.</p>
               </div>`
            : '';

        const groupBtn = (v.group_size && v.group_size >= 2)
            ? `<div class="action-buttons"><button onclick="showGroupQr(${v.id})" class="btn-guest-sub">👥 일행 전체 QR 보기</button></div>`
            : '';

        resultDiv.innerHTML = `
            <div class="visitor-info-box">
                <p class="greet"><strong>${v.name}</strong> 님</p>
                <span class="badge-company">${v.company || '-'}</span>
                <p class="status-line"><b>${sv.label}</b></p>
                <p class="status-desc">${sv.desc}</p>
                <p class="time-info">입실: ${v.checkin_time || '-'} / 퇴실: ${v.checkout_time || '-'}</p>
            </div>
            ${qrHtml}
            ${groupBtn}
            ${checkoutBtn}
        `;
    } catch (e) {
        resultDiv.innerHTML = `<div class="no-data-box"><span class="icon">⚠️</span><p>조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.</p></div>`;
    }
}

// 👥 일행(그룹) 전체 QR 보기: 방문 건 id 로 같은 그룹 전원의 QR을 조회해 표시
async function showGroupQr(logId) {
    resetWideLayout();
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    appCard.innerHTML = `<div class="shimmer-loader"><div class="spinner"></div><p>일행 정보를 불러오는 중입니다...</p></div>`;

    let data = null;
    try {
        const res = await fetch(`/api/group/qr?id=${encodeURIComponent(logId)}`);
        data = await res.json();
    } catch (e) {}

    if (!data || !data.success || !Array.isArray(data.members) || data.members.length === 0) {
        appCard.innerHTML = `
            <h2 class="guest-title-bold-style">일행 전체 QR</h2>
            <div class="no-data-box"><span class="icon">⚠️</span><p>${(data && data.message) || '일행 정보를 불러오지 못했습니다.'}</p></div>
            <div class="action-buttons visitor-btn-margin"><button onclick="showSearchForm()" class="btn-guest-sub">뒤로</button></div>`;
        return;
    }

    const qrListHtml = data.members.map(m => m.token ? `
        <div class="guest-qr-box">
            <p class="guest-qr-name">${m.name} 님</p>
            <img src="/api/qr?token=${encodeURIComponent(m.token)}" alt="${m.name} 방문 QR" class="guest-qr-img">
        </div>` : '').join('');

    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">👥 일행 전체 QR (${data.members.length}명)</h2>
        <p class="guest-qr-guide">각자 <strong>본인 QR</strong>을 저장(캡처)해 두세요. 퇴실 시 스캔만으로 처리됩니다.</p>
        <div class="guest-qr-grid">${qrListHtml}</div>
        <div class="action-buttons visitor-btn-margin"><button onclick="showSearchForm()" class="btn-guest-sub">뒤로</button></div>
    `;
}