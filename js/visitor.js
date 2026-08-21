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
                //  ※ '사전예약'은 여기서 복원하지 않는다. 상태 화면에는 입실 버튼이 없어
                //    아직 입실 전인 손님이 입실을 못 하는 막다른 화면이 된다. (첫 화면 → 조회 경로 유지)
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

// 상태 화면에 1회 표시할 인라인 안내(예: 퇴실 요청 접수). alert 대체용.
let guestFlash = '';

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

    let v = data.visitor;

    // 🎫 이용권 QR 인데 오늘 출입 기록이 아직 없는 상태('정기권')라면 = 지금 막 정문에서 찍은 것.
    //    거점 세션이 있는 기기(정문 QR 을 스캔한 기기)면 곧바로 입실 요청을 접수한다.
    //    거점 세션이 없으면(집에서 링크를 연 경우 등) 접수하지 않고 안내만 한다.
    if (v.status === '정기권' && !fromPoll) {
        const done = await tryPassSelfCheckin(token);
        if (done) return;          // 접수 성공 → 상태 화면을 다시 그린다 (재귀 호출로 처리됨)
        v = passSelfCheckinBlocked
            ? Object.assign({}, v, { status: '정기권거점필요', pass_note: passSelfCheckinBlocked })
            : v;
    }

    const sv = getStatusView(v.status);
    const checkoutBtn = sv.canCheckout
        ? `<div class="action-buttons"><button onclick="submitCheckout(${v.id})" class="btn-guest-main">지금 퇴실 요청하기</button></div>`
        : '';
    const waitingHint = isWaitingStatus(v.status)
        ? `<p class="poll-live-hint">🔄 승인되면 자동으로 갱신됩니다. 이 화면을 열어두세요.</p>`
        : '';
    const flashHtml = guestFlash ? `<div class="guest-flash">✅ ${guestFlash}</div>` : '';
    guestFlash = '';   // 1회 표시 후 소비
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">방문 상태 확인</h2>
        ${flashHtml}
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

    // 입실완료 상태면 스캔 즉시 퇴실 요청 (확인 팝업 생략, 최초 스캔 시에만 · 폴링 갱신 시에는 X)
    if (sv.canCheckout && !fromPoll) {
        setTimeout(() => submitCheckout(v.id), 300);
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
        <!-- 🎫 반복 방문자용: 매번 입실 등록하지 않도록 이용권을 신청받는다.
             신청·조회 두 동선을 같은 크기의 버튼으로 나란히 둔다(조회가 문구처럼 묻히지 않게). -->
        <div class="guest-pass-entry">
            <div class="guest-pass-title">🎫 자주 방문하시나요? <span>QR 이용권 한 장으로 출입하실 수 있습니다</span></div>
            <div class="guest-pass-btns">
                <button onclick="showPassRequestForm()" class="btn-guest-pass">
                    <span class="guest-emoji-header">📝</span>
                    이용권 신청<br><span class="guest-btn-sub-label">정기 · 수시</span>
                </button>
                <button onclick="showPassStatusForm()" class="btn-guest-pass btn-guest-pass-outline">
                    <span class="guest-emoji-header">🔍</span>
                    내 이용권 조회<br><span class="guest-btn-sub-label">신청 결과 · QR 보기</span>
                </button>
            </div>
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
                ${phoneInputHtml('checkContact')}
            </div>
        </div>
        <div class="action-buttons">
            <button onclick="verifyVisitorName()" class="btn-guest-main">조회하기</button>
            <button onclick="showMainPage()" class="btn-guest-sub">취소</button>
        </div>
    `;
}

// 🔖 조회 결과에서 '내 방문 건'을 이 기기에 기억시킨다.
//    - 저장 대상은 아직 끝나지 않은 건(퇴실완료·만료 제외)만.
//    - 후보가 1건일 때만 저장한다. 여러 건이면 본인 건을 특정할 수 없어 오인식 위험이 있다.
function rememberMyVisit(list) {
    const alive = (list || []).filter(v => v.status !== '퇴실완료' && v.status !== '만료');
    if (alive.length === 1) localStorage.setItem('my_visitor_id', alive[0].id);
}

async function verifyVisitorName() {
    const checkNameInput = document.getElementById("checkName");
    if (!checkNameInput) return;

    const name = checkNameInput.value.trim();
    const contact = readPhone('checkContact');
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
            // 🔖 조회 단계에서 바로 이 기기에 내 방문 건을 기억시킨다.
            //    (승인 전이라도 재접속 시 initVisitorPage 가 상태 화면으로 복원 → 다시 등록하는 실수 방지)
            //    후보가 여러 건이면 어느 것이 본인 건인지 확정할 수 없으므로 저장하지 않고,
            //    목록에서 선택하면 그때 showPrecheckStatus 가 저장한다.
            rememberMyVisit(result.list);
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
    // 🔖 조회로 확인된 내 방문 건을 이 기기에도 기억 (다른 사람이 대신 등록해준 건도 내 폰에 저장)
    if (v.status !== '퇴실완료' && v.status !== '만료') localStorage.setItem('my_visitor_id', v.id);
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
    const flashHtml = guestFlash ? `<div class="guest-flash">✅ ${guestFlash}</div>` : '';
    guestFlash = '';   // 1회 표시 후 소비
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">방문 상태 확인</h2>
        ${flashHtml}
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
            <div class="input-group"><label class="fs-8">연락처 <span class="req-star">*</span></label>${phoneInputHtml(id + '_ct')}</div>
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
                    <option value="거제 오션센터">거제 오션센터</option>
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
                        <div class="input-group"><label>본인 연락처 <span class="req-star">*</span></label>${phoneInputHtml('contact', passedContact)}</div>
                    </div>
                    
                    <div class="input-row-group">
                        <div class="input-group"><label>소속 회사명 <span class="req-star">*</span></label><input type="text" id="company" placeholder="예) 소속 기업명 입력"></div>
                        <div class="input-group"><label>차량 번호</label><input type="text" id="vehicle_no" placeholder="없을 시 비워두세요"></div>
                    </div>

                    <div class="input-row-group">
                        <div class="input-group"><label>방문 예정시간 <span class="req-star">*</span></label>${timeSelectHtml('expectedCheckin', roundUpToTenKst())}</div>
                        <div class="input-group"><label>퇴실 예정시간 <span class="req-star">*</span></label>${timeSelectHtml('expectedCheckout')}</div>
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
                    <div class="no-data-box empty-comp-msg" id="empty-companion-msg"><p>하단 버튼을 눌러 동반 일행을 추가하세요.</p></div>
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
    const vehicleNoEl = document.getElementById('vehicle_no');
    const managerTextEl = document.getElementById('manager_text');
    const purposeEl = document.getElementById('purpose');

    const guestRegionEl = document.getElementById('guestRegionSelect');
    const finalRegion = guestRegionEl ? guestRegionEl.value : (typeof currentRegion !== 'undefined' ? currentRegion : null);

    if (!finalRegion) {
        return alert('현재 방문하신 센터(거점)를 꼭 선택해 주세요!');
    }

    if (!nameEl || !companyEl || !managerTextEl) return;

    const name = nameEl.value.trim();
    const company = companyEl.value.trim();
    const contact = readPhone('contact');
    const vehicle_no = vehicleNoEl ? (vehicleNoEl.value.trim() || '없음') : '없음';
    const manager_text = managerTextEl.value.trim();
    const purpose = purposeEl.value;

    const expected_checkin = readTimeSelect('expectedCheckin');
    const expected_checkout = readTimeSelect('expectedCheckout');
    
    if (!name || !company || !contact || !manager_text || !purpose) return alert('필수 항목(* 표시)을 모두 입력해 주세요.');
    if (!expected_checkin || !expected_checkout) return alert('방문 예정시간과 퇴실 예정시간을 입력해 주세요.');

    let visitorsArray = [{
        name, company, contact, vehicle_no, manager_text, purpose, expected_checkin, expected_checkout
    }];

    const compBoxes = document.querySelectorAll('.companion-box');
    for (let i = 0; i < compBoxes.length; i++) {
        const row = compBoxes[i];
        const cName = row.querySelector('.comp-name').value.trim();
        const cContact = readPhoneIn(row);
        const cCompany = row.querySelector('.comp-company').value.trim() || company;
        const cVehicle = row.querySelector('.comp-vehicle').value.trim() || '없음';

        if (!cName && !cContact) continue;  // 완전히 빈 동반인 행은 건너뜀
        if (!cName || !cContact) return alert(`동반 방문객 ${i + 1}의 성명과 연락처를 모두 입력해 주세요.`);
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
            <p class="poll-live-hint">🔄 승인되면 자동으로 갱신됩니다. 이 화면을 열어두세요.</p>
        </div>
        ${qrListHtml}
        <div class="action-buttons visitor-btn-margin"><button onclick="goGuestHome()" class="btn-guest-sub">처음 화면으로</button></div>
    `;

    // ⏱️ 입실 승인 대기 폴링: 경비가 승인하면(입실완료) 자동으로 퇴실 화면으로 전환
    const repId = (Array.isArray(members) && members[0]) ? members[0].id : null;
    if (repId) {
        startVisitorPolling(() => fetchStatusById(repId), (v) => {
            if (v && v.status === '입실완료') showCheckoutPage(v);
            else showPrecheckStatus(repId);
        });
    }
}

function showCheckoutPage(visitor) {
    resetWideLayout();
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    const qrHtml = visitor.token
        ? `<div class="guest-qr-box">
               <img src="/api/qr?token=${encodeURIComponent(visitor.token)}" alt="내 방문 QR" class="guest-qr-img">
               <p class="guest-qr-hint">이 QR을 저장해 두면 다음부터 스캔만으로 확인·퇴실할 수 있습니다.</p>
           </div>`
        : '';
    const groupBtn = (visitor.group_size && visitor.group_size >= 2)
        ? `<div class="action-buttons"><button onclick="showGroupQr(${visitor.id})" class="btn-guest-sub">👥 일행 전체 QR 보기</button></div>`
        : '';
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">방문종료 (퇴실)</h2>
        <div class="visitor-info-box">
            <p class="greet"><strong>${visitor.name}</strong> 님</p>
            <span class="badge-company">${visitor.company}</span>
            <p class="time-info">입실 처리 시간: ${visitor.checkin_time || '승인 대기 중'}</p>
        </div>
        ${qrHtml}
        ${groupBtn}
        <div class="action-buttons">
            <button onclick="submitCheckout(${visitor.id})" class="btn-guest-main">네, 지금 퇴실 요청합니다</button>
            <button onclick="showSearchForm()" class="btn-guest-sub">제 정보가 아닙니다 (다시 검색)</button>
        </div>
    `;

    // ⏱️ 5초 폴링: 데스크 스캔으로 퇴실대기가 되거나(요청 접수), 경비 승인으로 상태가 바뀌면
    //   상태 화면으로 자동 전환(그 화면이 승인→완료까지 이어서 갱신).
    stopVisitorPolling();
    visitorPollTimer = setInterval(async () => {
        try {
            const v = await fetchStatusById(visitor.id);
            if (!v) return;
            if (v.status !== '입실완료') {   // 입실완료가 아니게 됨 → 상황 변화
                stopVisitorPolling();
                showPrecheckStatus(visitor.id);
            }
        } catch (e) {}
    }, 5000);
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
            // 퇴실 요청 접수(퇴실대기) → 상태 화면에 인라인 안내로 표시 (alert 팝업 제거)
            guestFlash = result.message || '퇴실 요청이 접수되었습니다.';
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
                ${phoneInputHtml('searchContact')}
            </div>
        </div>
        <div class="action-buttons">
            <button onclick="searchVisitor()" class="btn-guest-main">조회하기</button>
            <button onclick="initVisitorPage()" class="btn-guest-sub">처음 화면으로</button>
        </div>
        <div id="searchResult"></div>
    `;
}

// 🎫 이용권 QR 을 손님이 직접 열었을 때의 입실 요청.
//    성공하면 접수된 방문 건의 상태 화면으로 다시 그린다(true 반환).
//    거점 세션이 없어 거절되면 사유를 담아두고 false 를 반환한다.
let passSelfCheckinBlocked = '';

async function tryPassSelfCheckin(token) {
    passSelfCheckinBlocked = '';
    try {
        const res = await fetch('/api/pass/self-checkin', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const d = await res.json();
        if (d.success) {
            if (d.id) localStorage.setItem('my_visitor_id', d.id);
            guestFlash = d.message;
            await showScanStatus(token, true);    // 접수 결과 반영해 다시 조회
            startVisitorPolling(() => fetchStatusByToken(token), () => showScanStatus(token, true));
            return true;
        }
        passSelfCheckinBlocked = d.message || '';
        return false;
    } catch (e) {
        return false;
    }
}

// 상태별 안내 정보 (배지 문구/색 클래스/설명)
function getStatusView(status) {
    switch (status) {
        case '입실대기': return { label: '🟡 입실 승인 대기중', desc: '경비실의 입실 승인을 기다리고 있습니다. 승인 완료 후 퇴실 요청이 가능합니다.', canCheckout: false };
        case '입실완료': return { label: '🟢 재실중', desc: '정상 입실 상태입니다. 나가실 때 아래 버튼으로 퇴실 요청을 해주세요.', canCheckout: true };
        case '퇴실대기': return { label: '🟠 퇴실 승인 대기중', desc: '퇴실 요청이 접수되었습니다. 경비실 최종 승인 후 마감됩니다.', canCheckout: false };
        case '퇴실완료': return { label: '✅ 퇴실 완료', desc: '이미 퇴실 처리가 완료된 방문입니다.', canCheckout: false };
        case '만료':     return { label: '⛔ 만료됨', desc: '입실하지 않아 만료된 예약입니다. 방문하시려면 처음 화면에서 다시 등록해 주세요.', canCheckout: false };
        // 🎫 정기 출입증 QR 을 본인이 열어본 경우 (오늘 출입 기록이 아직 없는 상태)
        case '정기권':   return { label: '🎫 출입 이용권', desc: '유효한 출입 이용권입니다. 정문에서 이 QR을 보여주시면 입실 처리됩니다.', canCheckout: false };
        case '정기권거점필요': return { label: '📍 사업장 확인 필요', desc: '정문에 비치된 사업장 QR을 먼저 스캔한 뒤 이 QR을 다시 열어 주세요. 현장 확인 후 입실 요청이 접수됩니다.', canCheckout: false };
        case '정기권사용불가': return { label: '⛔ 사용할 수 없는 이용권', desc: '유효기간이 지났거나 사용이 정지된 이용권입니다. 안내 데스크(경비실)로 문의해 주세요.', canCheckout: false };
        default:         return { label: `ℹ️ ${status || '상태 미상'}`, desc: '현재 상태 정보를 확인해 주세요.', canCheckout: false };
    }
}

async function searchVisitor() {
    const nameEl = document.getElementById('searchName');
    const resultDiv = document.getElementById('searchResult');
    if (!resultDiv) return;

    const name = nameEl ? nameEl.value.trim() : '';
    const contact = readPhone('searchContact');
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
        // 🔖 조회로 확인된 내 방문 건을 이 기기에도 기억 (재접속 시 자동 복원용)
        if (v.status !== '퇴실완료' && v.status !== '만료') localStorage.setItem('my_visitor_id', v.id);
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


// ====================================================================
// 🎫 출입 이용권 발급 신청 (손님 화면)
//   - 접수만 하는 화면이다. 실제 발급은 경비실·최고관리자 승인 후 이뤄진다.
//   - 유효기간·이용 요일은 '희망 사항'으로 받고, 승인자가 최종 확정한다.
// ====================================================================
const PASS_REQ_WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
let passReqType = '정기';      // 화면에서 고른 이용권 종류

function passReqTodayStr() {
    const now = new Date();
    const kst = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 3600 * 1000));
    const p = (n) => String(n).padStart(2, '0');
    return `${kst.getFullYear()}-${p(kst.getMonth() + 1)}-${p(kst.getDate())}`;
}

// 손님이 고른 이용 기간 단위 (1일 / 1주일 / 1개월)
let passReqPeriod = '1개월';

// 손님이 고른 이용 시작일 (미선택 시 오늘)
function passReqStartDate() {
    const el = document.getElementById('passReqFrom');
    return (el && el.value) ? el.value : passReqTodayStr();
}

// 유효기간 종료일: 시작일 + 선택 단위 (계산 규칙은 공용 헬퍼 = 서버와 동일)
function passReqEndDate() {
    return window.passPeriodEnd(passReqStartDate(), passReqPeriod);
}

// 시작일·단위 중 무엇이 바뀌든 표시되는 기간을 다시 계산한다.
function refreshPassReqRange() {
    const el = document.getElementById('passReqRangeText');
    if (el) el.textContent = `${passReqStartDate()} ~ ${passReqEndDate()}`;
}

function showPassRequestForm() {
    stopVisitorPolling();
    resetWideLayout();
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    passReqType = '정기';
    passReqPeriod = window.PASS_DEFAULT_PERIOD || '1개월';

    // 거점: 정문 QR 로 들어오면 확정(확인 문구), 직접 접속이면 손님이 선택. (입실 등록 화면과 같은 규칙)
    const regionBlock = (typeof currentRegion !== 'undefined' && currentRegion)
        ? `<div class="input-group mb-15">
               <div class="region-confirm-box">📍 ${currentRegion} 이용권으로 신청됩니다.</div>
               <input type="hidden" id="passReqRegion" value="${currentRegion}">
           </div>`
        : `<div class="input-group mb-15 warning-box">
               <label class="warning-text">📍 이용하실 사업장을 선택해주세요 <span class="req-star">*</span></label>
               <select id="passReqRegion">
                   <option value="">-- 사업장을 선택하세요 --</option>
                   <option value="테크센터">동탄 (테크센터)</option>
                   <option value="에코센터">부산 (에코센터)</option>
                   <option value="평택공장">평택공장</option>
                   <option value="거제 오션센터">거제 오션센터</option>
               </select>
           </div>`;

    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">🎫 출입 이용권 신청</h2>
        <p class="guest-pass-guide">
            <b>QR 한 장</b>으로 출입 · 매번 등록 불필요 — <b>경비실 승인</b> 후 사용
        </p>

        <div class="pass-req-types">
            <button type="button" id="passReqTypeRegular" class="pass-req-type active" onclick="selectPassReqType('정기')">
                <b>정기 이용권</b>
                <span>거의 매일 출입해요</span>
            </button>
            <button type="button" id="passReqTypeOccasional" class="pass-req-type" onclick="selectPassReqType('수시')">
                <b>수시 출입권</b>
                <span>매일은 아니지만 자주 와요</span>
            </button>
        </div>

        <div class="form-container">
            ${regionBlock}
            <div class="input-row-group">
                <div class="input-group"><label>성명 <span class="req-star">*</span></label>
                    <input type="text" id="passReqName" placeholder="본인 성명" autocomplete="off"></div>
                <div class="input-group"><label>연락처 <span class="req-star">*</span></label>${phoneInputHtml('passReqContact')}</div>
            </div>
            <div class="input-row-group">
                <div class="input-group"><label>소속 업체 <span class="req-star">*</span></label>
                    <input type="text" id="passReqCompany" placeholder="예: OO물류" autocomplete="off"></div>
                <div class="input-group"><label>차량 번호</label>
                    <input type="text" id="passReqVehicle" placeholder="없을 시 비워둠" autocomplete="off"></div>
            </div>
            <div class="input-row-group">
                <div class="input-group">
                    <label>이용 목적 <span class="req-star">*</span></label>
                    <input type="text" id="passReqPurpose" placeholder="예: 제품 납품 / 시설 점검" autocomplete="off">
                </div>
                <div class="input-group">
                    <label>이용 시작일 <span class="req-star">*</span></label>
                    <input type="date" id="passReqFrom" value="${passReqTodayStr()}" min="${passReqTodayStr()}"
                           onchange="refreshPassReqRange()">
                </div>
            </div>
            <div class="input-group">
                <label>이용 기간 <span class="req-star">*</span></label>
                <div class="pass-req-periods" id="passReqPeriodBox">
                    ${(window.PASS_PERIODS || ['1일', '1주일', '1개월']).map(x =>
                        `<button type="button" class="pass-req-period-btn${x === passReqPeriod ? ' active' : ''}"
                                 data-period="${x}" onclick="selectPassReqPeriod('${x}')">${x}</button>`).join('')}
                </div>
                <div class="pass-req-period">
                    <b id="passReqRangeText">${passReqTodayStr()} ~ ${window.passPeriodEnd(passReqTodayStr(), passReqPeriod)}</b>
                    <span>선택하신 시작일부터 적용됩니다 · 기간이 끝나면 다시 신청해 주세요</span>
                </div>
            </div>
            <div class="input-group">
                <label>주로 방문하는 요일</label>
                <div class="pass-req-weekdays" id="passReqWeekdays">
                    ${PASS_REQ_WEEKDAYS.map((d, i) =>
                        `<label class="pass-req-day"><input type="checkbox" data-day="${i}" ${i < 5 ? 'checked' : ''}><span>${d}</span></label>`
                    ).join('')}
                </div>
            </div>
            <div class="input-group">
                <label>신청 사유 / 남길 말</label>
                <input type="text" id="passReqMemo" placeholder="예: 매주 화·목 자재 납품 예정" autocomplete="off">
            </div>
        </div>

        <div class="action-buttons">
            <button onclick="submitPassRequest()" class="btn-guest-main">신청서 제출</button>
            <button onclick="showMainPage()" class="btn-guest-sub">취소</button>
        </div>
    `;
}

// 이용 기간 단위 선택 → 표시되는 기간을 즉시 갱신
function selectPassReqPeriod(period) {
    passReqPeriod = period;
    document.querySelectorAll('#passReqPeriodBox .pass-req-period-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.period === period);
    });
    refreshPassReqRange();
}

function selectPassReqType(type) {
    passReqType = type;
    const reg = document.getElementById('passReqTypeRegular');
    const occ = document.getElementById('passReqTypeOccasional');
    if (reg) reg.classList.toggle('active', type === '정기');
    if (occ) occ.classList.toggle('active', type === '수시');
    // 정기는 평일 상주가 일반적, 수시는 언제 올지 모르니 전 요일 기본
    const preset = (type === '수시') ? '1111111' : '1111100';
    document.querySelectorAll('#passReqWeekdays input[type="checkbox"]').forEach(cb => {
        cb.checked = preset[parseInt(cb.dataset.day, 10)] === '1';
    });
}

async function submitPassRequest() {
    const get = (id) => (document.getElementById(id) || {}).value || '';
    let weekdays = '';
    document.querySelectorAll('#passReqWeekdays input[type="checkbox"]').forEach(cb => {
        weekdays += cb.checked ? '1' : '0';
    });
    if (!weekdays.includes('1')) weekdays = '1111111';

    const payload = {
        pass_type: passReqType,
        name: get('passReqName').trim(),
        contact: readPhone('passReqContact'),
        company: get('passReqCompany').trim(),
        vehicle_no: get('passReqVehicle').trim(),
        purpose: get('passReqPurpose').trim(),
        weekdays: weekdays,
        valid_from: passReqStartDate(),
        period: passReqPeriod,
        memo: get('passReqMemo').trim(),
        region: (document.getElementById('passReqRegion') || {}).value || '',
    };
    if (!payload.name) return alert('성명을 입력해 주세요.');
    if (!payload.contact) return alert('연락처를 입력해 주세요.');
    if (!payload.company) return alert('소속 업체를 입력해 주세요.');
    if (!payload.purpose) return alert('이용 목적을 입력해 주세요.');
    if (!payload.region) return alert('이용하실 사업장을 선택해 주세요.');

    try {
        const res = await fetch('/api/pass/request', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const d = await res.json();
        if (!d.success) return alert(d.message || '신청 처리에 실패했습니다.');
        showPassRequestDone(payload, d.message);
    } catch (e) {
        alert('신청 처리 중 통신 오류가 발생했습니다.');
    }
}

function showPassRequestDone(payload, message) {
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">신청이 접수되었습니다</h2>
        <div class="visitor-info-box">
            <p class="greet"><strong>${payload.name}</strong> 님</p>
            <span class="badge-company">${payload.company}</span>
            <p class="status-line"><b>🟡 ${payload.pass_type} 이용권 승인 대기</b></p>
            <p class="status-desc">${message}</p>
            <p class="time-info">이용 기간: ${payload.valid_from} ~ ${window.passPeriodEnd(payload.valid_from, payload.period)} (${payload.period})</p>
        </div>
        <p class="guest-pass-note">
            승인 결과는 <b>내 이용권 · 신청 결과 조회</b>에서 성명·연락처로 확인하실 수 있습니다.<br>
            승인 전에도 방문이 필요하시면 <b>처음 왔습니다(입실 등록)</b>로 평소처럼 방문하실 수 있습니다.
        </p>
        <div class="action-buttons">
            <button onclick="showPassStatusForm()" class="btn-guest-main">신청 결과 조회</button>
            <button onclick="showMainPage()" class="btn-guest-sub">처음 화면으로</button>
        </div>
    `;
}

// ── 내 이용권 / 신청 결과 조회 ────────────────────────────────────
function showPassStatusForm() {
    stopVisitorPolling();
    resetWideLayout();
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">🎫 내 이용권 조회</h2>
        <div class="form-container form-container-verify-margin">
            <div class="input-group">
                <label>성명</label>
                <input type="text" id="passStatusName" placeholder="신청 시 입력한 성명" autocomplete="off">
            </div>
            <div class="input-group">
                <label>연락처</label>
                ${phoneInputHtml('passStatusContact')}
            </div>
        </div>
        <div class="action-buttons">
            <button onclick="lookupMyPass()" class="btn-guest-main">조회하기</button>
            <button onclick="showMainPage()" class="btn-guest-sub">취소</button>
        </div>
        <div id="passStatusResult"></div>
    `;
}

function passStatusView(status) {
    switch (status) {
        case '신청': return { label: '🟡 승인 대기중', desc: '경비실 승인을 기다리고 있습니다.' };
        case '활성': return { label: '🟢 사용 가능', desc: '정문에서 이 QR을 보여주세요.' };
        case '정지': return { label: '⛔ 일시 정지', desc: '안내 데스크(경비실)로 문의해 주세요.' };
        case '만료': return { label: '⌛ 기간 만료', desc: '계속 이용하시려면 다시 신청해 주세요.' };
        case '해지': return { label: '⛔ 해지됨', desc: '안내 데스크(경비실)로 문의해 주세요.' };
        case '반려': return { label: '🔴 신청 반려', desc: '사유를 확인하시고 필요하면 다시 신청해 주세요.' };
        default:     return { label: `ℹ️ ${status || '상태 미상'}`, desc: '' };
    }
}

let myPassCache = [];      // 조회 결과 (이미지 저장에 사용)

// 내 이용권 카드를 PNG 로 저장 (경비실에서 발급 시 저장하는 이미지와 동일한 결과물)
function saveMyPassImage(passId) {
    const p = myPassCache.find(x => x.id === passId);
    if (!p) return;
    window.downloadPassCardPng(p, window.passWeekdayText(p.weekdays));
}

async function lookupMyPass() {
    const name = (document.getElementById('passStatusName') || {}).value.trim();
    const contact = readPhone('passStatusContact');
    const box = document.getElementById('passStatusResult');
    if (!box) return;
    if (!name) return alert('성명을 입력해 주세요.');
    if (!contact) return alert('연락처를 입력해 주세요.');

    box.innerHTML = `<div class="shimmer-loader"><div class="spinner"></div><p>조회하고 있습니다...</p></div>`;
    try {
        const res = await fetch('/api/pass/request/status', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, contact })
        });
        const d = await res.json();
        if (!d.success) {
            box.innerHTML = `<div class="no-data-box"><span class="icon">⚠️</span><p>${d.message || '조회에 실패했습니다.'}</p></div>`;
            return;
        }
        if (!d.list.length) {
            box.innerHTML = `<div class="no-data-box"><span class="icon">🔍</span><p>신청 내역이 없습니다. 성명과 연락처를 확인해 주세요.</p></div>`;
            return;
        }
        // 카드 구성은 경비실 QR 창(sec-qr-dialog)과 동일하게 맞춘다 —
        //   머리말(종류·사업장) → QR → 이름 → 소속 → 유효기간·이용 요일·차량 번호.
        //   승인된 건만 QR 을 표시한다 (서버도 활성 건에만 토큰을 내려준다).
        myPassCache = d.list;
        // 저장 버튼을 눌렀을 때 곧바로 공유·저장되도록 카드 이미지를 미리 만들어 둔다.
        //   (iOS 는 사용자 조작 직후에만 공유 시트를 허용한다)
        d.list.filter(p => p.status === '활성' && p.token)
              .forEach(p => window.preparePassCardImage(p, window.passWeekdayText(p.weekdays)));
        box.innerHTML = d.list.map(p => {
            const v = passStatusView(p.status);
            const kind = p.pass_type === '수시' ? '수시 출입권' : '정기 이용권';
            const active = (p.status === '활성' && p.token);
            const qr = active
                ? `<img class="pass-my-qr" src="/api/qr?token=${encodeURIComponent(p.token)}" alt="이용권 QR">`
                : '';
            const saveBtn = active
                ? `<div class="pass-my-actions">
                       <button onclick="saveMyPassImage(${p.id})" class="btn-guest-sub pass-my-save">📥 이용권 이미지 저장</button>
                   </div>`
                : '';
            const memo = (p.status === '반려' && p.memo) ? `<p class="pass-my-memo">${p.memo}</p>` : '';
            return `
                <div class="pass-my-card">
                    <div class="pass-my-head">
                        <span class="pass-my-type ${p.pass_type === '수시' ? 'type-occasional' : 'type-regular'}">${kind}</span>
                        <span class="pass-my-region">${p.region}</span>
                    </div>
                    ${qr}
                    <div class="pass-my-name">${p.name}</div>
                    <div class="pass-my-company">${p.company}</div>
                    <div class="pass-my-meta">
                        <span>유효기간</span><b>${p.valid_from} ~ ${p.valid_to}${p.period ? ` (${p.period})` : ''}</b>
                        <span>이용 요일</span><b>${window.passWeekdayText(p.weekdays)}</b>
                        <span>차량 번호</span><b>${p.vehicle_no || '없음'}</b>
                    </div>
                    <p class="status-line"><b>${v.label}</b></p>
                    <p class="status-desc">${v.desc}</p>
                    ${memo}
                    ${saveBtn}
                </div>`;
        }).join('');
    } catch (e) {
        box.innerHTML = `<div class="no-data-box"><span class="icon">⚠️</span><p>통신 오류가 발생했습니다.</p></div>`;
    }
}
