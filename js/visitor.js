/**
 * js/visitor.js
 * 방문객(외부인) 현장 입/퇴실 프로세스 (인라인 CSS 완벽 제거 및 동반객 로직 추가)
 */

async function initVisitorPage() {
    stopVisitorPolling();
    // 🌐 사전을 먼저 받아 둔다. (화면을 그리기 전이라 문구가 한 번에 제 언어로 나온다)
    if (typeof initGuestI18n === 'function') {
        await initGuestI18n();
        renderGuestLangSelector();
        const sub = document.getElementById('guest-brand-sub');
        if (sub) sub.textContent = t('app.sub');
    }
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
    markGuestView(showScanStatus, token);
    stopVisitorPolling();
    resetWideLayout();
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    if (!fromPoll) appCard.innerHTML = `<div class="shimmer-loader"><div class="spinner"></div><p>${t('scan.loading')}</p></div>`;

    let data = null;
    try {
        const res = await fetch(`/api/visitor/by-token?token=${encodeURIComponent(token)}`);
        data = await res.json();
    } catch (e) {}

    if (!data || !data.success) {
        appCard.innerHTML = `
            <h2 class="guest-title-bold-style">${t('scan.title')}</h2>
            <div class="no-data-box"><span class="icon">⚠️</span><p>${srvMsg(data, 'scan.invalid')}</p></div>
            <div class="action-buttons visitor-btn-margin"><button onclick="goGuestHome()" class="btn-guest-sub">${t('btn.home')}</button></div>`;
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
        ? `<div class="action-buttons"><button onclick="submitCheckout(${v.id})" class="btn-guest-main">${t('checkout.now')}</button></div>`
        : '';
    const waitingHint = isWaitingStatus(v.status)
        ? `<p class="poll-live-hint">🔄 ${t('poll.hint')}</p>`
        : '';
    // 직원이 대신 등록해 주고 링크만 받은 손님도 여기서 자기 QR 을 보고 저장할 수 있어야 한다.
    const qrHtml = v.token
        ? `<div class="guest-qr-box">
               <img src="/api/qr?token=${encodeURIComponent(v.token)}" alt="${t('qr.altMine')}" class="guest-qr-img">
               <p class="guest-qr-hint">${t('qr.saveHint')}</p>
           </div>`
        : '';
    const groupBtn = (v.group_size && v.group_size >= 2)
        ? `<div class="action-buttons"><button onclick="showGroupQr(${v.id})" class="btn-guest-sub">👥 ${t('qr.groupBtn')}</button></div>`
        : '';
    const flashHtml = guestFlash ? `<div class="guest-flash">✅ ${guestFlash}</div>` : '';
    guestFlash = '';   // 1회 표시 후 소비
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">${t('status.title')}</h2>
        ${flashHtml}
        <div class="visitor-info-box">
            <p class="greet">${t('greet.person', {name: `<strong>${v.name}</strong>`})}</p>
            <span class="badge-company">${v.company || '-'}</span>
            <p class="status-line"><b>${sv.label}</b></p>
            <p class="status-desc">${sv.desc}</p>
            <p class="time-info">${t('time.inout', {in: v.checkin_time || '-', out: v.checkout_time || '-'})}</p>
            ${waitingHint}
        </div>
        ${qrHtml}
        ${groupBtn}
        ${checkoutBtn}
        <div class="action-buttons visitor-btn-margin"><button onclick="goGuestHome()" class="btn-guest-sub">${t('btn.home')}</button></div>
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
    markGuestView(showMainPage);   // 🌐 언어 전환 시 이 화면을 다시 그리도록 기억
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    appCard.innerHTML = `
        <div class="welcome-text">
            <!-- 인사말은 강조(<span>) 위치가 언어마다 달라 문장 통째로 번역문에 둔다.
                 조각내면(안녕하세요 / 방문 등록 / 을 진행해 주세요) 어순이 다른 언어에서 깨진다. -->
            <h2>${t('main.greet')}</h2>
            <p>${t('main.desc')}</p>
        </div>
        <div class="action-buttons">
            <button onclick="showNameVerifyForm()" class="btn-guest-main">
                <span class="guest-emoji-header">👋</span>
                ${t('main.first')}<br><span class="guest-btn-sub-label">${t('main.first.sub')}</span>
            </button>
            <button onclick="showSearchForm()" class="btn-guest-sub">
                <span class="guest-emoji-header">🏃</span>
                ${t('main.leave')}<br><span class="guest-btn-sub-label">${t('main.leave.sub')}</span>
            </button>
        </div>
        <!-- 🎫 반복 방문자용: 매번 입실 등록하지 않도록 이용권을 신청받는다.
             신청·조회 두 동선을 같은 크기의 버튼으로 나란히 둔다(조회가 문구처럼 묻히지 않게). -->
        <div class="guest-pass-entry">
            <div class="guest-pass-title">🎫 ${t('main.pass.title')}</div>
            <div class="guest-pass-btns">
                <button onclick="showPassRequestForm()" class="btn-guest-pass">
                    <span class="guest-emoji-header">📝</span>
                    ${t('main.pass.req')}<br><span class="guest-btn-sub-label">${t('main.pass.req.sub')}</span>
                </button>
                <button onclick="showPassStatusForm()" class="btn-guest-pass btn-guest-pass-outline">
                    <span class="guest-emoji-header">🔍</span>
                    ${t('main.pass.my')}<br><span class="guest-btn-sub-label">${t('main.pass.my.sub')}</span>
                </button>
            </div>
        </div>
    `;
}

function showNameVerifyForm() {
    stopVisitorPolling();
    resetWideLayout();
    markGuestView(showNameVerifyForm);
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">${t('verify.title')}</h2>
        <div class="form-container form-container-verify-margin">
            <div class="input-group">
                <label>${t('label.name')}</label>
                <input type="text" id="checkName" placeholder="${t('ph.name')}" autocomplete="off">
            </div>
            <div class="input-group">
                <label>${t('label.phone')}</label>
                ${phoneInputHtml('checkContact')}
            </div>
        </div>
        <div class="action-buttons">
            <button onclick="verifyVisitorName()" class="btn-guest-main">${t('btn.search')}</button>
            <button onclick="showMainPage()" class="btn-guest-sub">${t('btn.cancel')}</button>
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
    if (!name) return alert(t('alert.needName'));
    if (!contact) return alert(t('alert.needPhone'));

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
    markGuestView(showPreMatchSelection, list, originalName, originalContact);
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    let listHtml = '';
    list.forEach(v => {
        const managerInfo = v.emp_name ? `${v.emp_name} (${v.emp_dept})` : t('prematch.unassigned');
        const isWaiting = (v.status === '입실대기');
        const statusNote = isWaiting ? `<span class="match-status-wait">🟡 ${t('prematch.waiting')}</span>` : '';
        // 입실대기(이미 접수됨) → 입실 트리거 없이 상태 안내. 사전예약(레거시) → 기존 입실 처리.
        const clickHandler = isWaiting ? `showPrecheckStatus(${v.id})` : `submitConfirmPrecheck(${v.id})`;
        listHtml += `
            <div class="match-item" onclick="${clickHandler}">
                <span class="match-manager">📋 ${t('prematch.manager', {name: managerInfo})}</span>
                <strong class="match-title">${v.name} <span class="match-corp">(${v.company})</span></strong>
                <p class="match-purpose">${t('prematch.purpose', {purpose: purposeLabel(v.purpose)})}</p>
                ${statusNote}
            </div>
        `;
    });
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">${t('prematch.title')}</h2>
        <div class="results-container">${listHtml}</div>
        <button onclick="showCheckinForm('${originalName}', '${originalContact}')" class="btn-guest-sub direct-register-btn-margin">${t('prematch.direct')}</button>
    `;
}

// 이미 접수된(입실대기) 건: 입실 트리거 없이 현재 상태만 안내
async function showPrecheckStatus(id, fromPoll = false) {
    markGuestView(showPrecheckStatus, id);
    stopVisitorPolling();
    resetWideLayout();
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    if (!fromPoll) appCard.innerHTML = `<div class="shimmer-loader"><div class="spinner"></div><p>${t('precheck.loading')}</p></div>`;

    let s = null;
    try {
        const res = await fetch(`/api/check-status/${id}`);
        s = await res.json();
    } catch (e) {}

    if (!s || !s.visitor) {
        appCard.innerHTML = `
            <h2 class="guest-title-bold-style">${t('precheck.title')}</h2>
            <div class="no-data-box"><span class="icon">⚠️</span><p>${t('precheck.fail')}</p></div>
            <div class="action-buttons visitor-btn-margin"><button onclick="showNameVerifyForm()" class="btn-guest-sub">${t('btn.prev')}</button></div>`;
        return;
    }

    const v = s.visitor;
    // 🔖 조회로 확인된 내 방문 건을 이 기기에도 기억 (다른 사람이 대신 등록해준 건도 내 폰에 저장)
    if (v.status !== '퇴실완료' && v.status !== '만료') localStorage.setItem('my_visitor_id', v.id);
    const sv = getStatusView(v.status);
    const checkoutBtn = sv.canCheckout
        ? `<div class="action-buttons"><button onclick="submitCheckout(${v.id})" class="btn-guest-main">${t('checkout.now')}</button></div>`
        : '';
    const qrHtml = v.token
        ? `<div class="guest-qr-box">
               <img src="/api/qr?token=${encodeURIComponent(v.token)}" alt="${t('qr.altMine')}" class="guest-qr-img">
               <p class="guest-qr-hint">${t('qr.saveHint')}</p>
           </div>`
        : '';
    const waitingHint = isWaitingStatus(v.status)
        ? `<p class="poll-live-hint">🔄 ${t('poll.hint')}</p>`
        : '';
    const groupBtn = (v.group_size && v.group_size >= 2)
        ? `<div class="action-buttons"><button onclick="showGroupQr(${v.id})" class="btn-guest-sub">👥 ${t('qr.groupBtn')}</button></div>`
        : '';
    const flashHtml = guestFlash ? `<div class="guest-flash">✅ ${guestFlash}</div>` : '';
    guestFlash = '';   // 1회 표시 후 소비
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">${t('status.title')}</h2>
        ${flashHtml}
        <div class="visitor-info-box">
            <p class="greet">${t('greet.person', {name: `<strong>${v.name}</strong>`})}</p>
            <span class="badge-company">${v.company || '-'}</span>
            <p class="status-line"><b>${sv.label}</b></p>
            <p class="status-desc">${sv.desc}</p>
            <p class="time-info">${t('time.inout', {in: v.checkin_time || '-', out: v.checkout_time || '-'})}</p>
            ${waitingHint}
        </div>
        ${qrHtml}
        ${groupBtn}
        ${checkoutBtn}
        <div class="action-buttons visitor-btn-margin"><button onclick="showNameVerifyForm()" class="btn-guest-sub">${t('btn.prev')}</button></div>
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
            if (confirm(srvMsg(result))) {
                return submitConfirmPrecheck(id, true);
            }
            return;
        }

        if (result.success) {
            localStorage.setItem('my_visitor_id', result.id);
            alert(srvMsg(result));
            initVisitorPage();
        } else {
            alert(srvMsg(result));
        }
    } catch (e) {
        alert(t('alert.failed'));
    }
}

function updateCompanionNumbers() {
    const container = document.getElementById('companion-container');
    if (!container) return;
    const titles = container.querySelectorAll('.comp-dynamic-title');
    titles.forEach((titleEl, index) => {
        titleEl.innerHTML = `👤 ${t('comp.numbered', {n: index + 1})}`;
    });
}

function clearAllCompanions() {
    const container = document.getElementById('companion-container');
    if (!container) return;
    const boxes = container.querySelectorAll('.companion-box');
    if (boxes.length === 0) return; 
    
    if (!confirm(t('comp.confirmClear'))) return;

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
        <button type="button" onclick="removeCompanionField('${id}')" class="btn-comp-delete">${t('btn.delete')}</button>
        <h4 class="comp-title-blue mb-15 comp-dynamic-title">👤 ${t('comp.heading')}</h4>
        <div class="input-row-group mb-10">
            <div class="input-group"><label class="fs-8">${t('label.name.self')} <span class="req-star">*</span></label><input type="text" class="comp-name comp-input-style" placeholder="${t('comp.ph.name')}"></div>
            <div class="input-group"><label class="fs-8">${t('label.contact')} <span class="req-star">*</span></label>${phoneInputHtml(id + '_ct')}</div>
        </div>
        <div class="input-row-group mb-0">
            <div class="input-group"><label class="fs-8">${t('label.company')}</label><input type="text" class="comp-company comp-input-style" value="${defaultCompany}" placeholder="${t('comp.ph.company')}"></div>
            <div class="input-group"><label class="fs-8">${t('label.vehicle')}</label><input type="text" class="comp-vehicle comp-input-style" placeholder="${t('ph.vehicle')}"></div>
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

/* 🔢/🔎 담당자 지정 — 칸 하나로 번호와 이름을 모두 받는다.
     숫자만 입력: 담당자 고유번호. 전사 유일이라 다른 센터 담당자도 지정된다.
     글자 입력  : 이름으로 본다. 접속 거점 안에서만 찾고, 같은 거점에 동명이인이
                  있을 때만 부서를 함께 보여주고 고르게 한다. 없으면 부서를 노출하지 않는다. */
function managerIsCode(v) {
    return /^\d+$/.test((v || '').trim());
}

let mgrSearchTimer = null;

/** 입력이 멈추면 이름일 때만 조회한다. 매 글자마다 때리지 않도록 잠깐 기다린다. */
function onManagerInput() {
    const el = document.getElementById('manager_q');
    const box = document.getElementById('mgrResult');
    const raw = el ? el.value.trim() : '';
    // 입력이 바뀌면 앞서 고른 담당자는 무효
    const set = (id, v) => { const x = document.getElementById(id); if (x) x.value = v; };
    set('manager_name', '');
    set('manager_dept', '');

    if (mgrSearchTimer) clearTimeout(mgrSearchTimer);
    if (!box) return;
    if (managerIsCode(raw) || raw.length < 2) { box.innerHTML = ''; return; }
    mgrSearchTimer = setTimeout(searchManager, 400);
}

async function searchManager() {
    const q = (document.getElementById('manager_q') || {}).value || '';
    const box = document.getElementById('mgrResult');
    if (!box) return;
    if (managerIsCode(q) || q.trim().length < 2) { box.innerHTML = ''; return; }

    box.innerHTML = `<p class="mgr-hint">${t('passmy.loading')}</p>`;
    let list;
    try {
        const res = await fetch('/api/manager/search', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: q.trim() })
        });
        const d = await res.json();
        if (!d.success) { box.innerHTML = `<p class="mgr-hint">${srvMsg(d, 'mgr.none')}</p>`; return; }
        list = d.list || [];
    } catch (e) {
        box.innerHTML = `<p class="mgr-hint">${t('passmy.netError')}</p>`;
        return;
    }

    if (!list.length) { box.innerHTML = `<p class="mgr-hint">${t('mgr.none')}</p>`; return; }

    // 후보가 하나면 부서가 비어 온다 → 이름만 보여주고 바로 고른 상태로 둔다.
    box.innerHTML = list.map((x, i) => `
        <button type="button" class="mgr-pick" data-i="${i}"
                onclick="pickManager(${i}, this)">${x.name}${x.dept ? ` <span class="mgr-dept">(${x.dept})</span>` : ''}</button>`).join('');
    window.__mgrCandidates = list;
    if (list.length === 1) {
        const only = box.querySelector('.mgr-pick');
        if (only) pickManager(0, only);
    }
}

function pickManager(i, btn) {
    const x = (window.__mgrCandidates || [])[i];
    if (!x) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('manager_name', x.name);
    set('manager_dept', x.dept || '');
    document.querySelectorAll('#mgrResult .mgr-pick').forEach(b => b.classList.remove('picked'));
    if (btn) btn.classList.add('picked');
}

function showCheckinForm(passedName = '', passedContact = '') {
    markGuestView(showCheckinForm, passedName, passedContact);
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
                    📍 ${t('region.fixed', {region: regionLabel(currentRegion)})}
                </div>
                <input type="hidden" id="guestRegionSelect" value="${currentRegion}">
            </div>
        `;
    } else {
        // QR 없이 직접 접속한 경우: 손님이 직접 사업장 선택 (value=사내 거점명, 표시=지명 병기)
        regionSelectorHtml = `
            <div class="input-group mb-15 warning-box">
                <label class="warning-text">📍 ${t('region.pick')} <span class="req-star">*</span></label>
                <select id="guestRegionSelect">
                    <option value="">${t('region.pick.ph')}</option>
                    <option value="테크센터">${t('region.tech')}</option>
                    <option value="에코센터">${t('region.eco')}</option>
                    <option value="평택공장">${t('region.pyeongtaek')}</option>
                    <option value="거제 오션센터">${t('region.geoje')}</option>
                </select>
            </div>
        `;
    }
    
    appCard.innerHTML = `
        <div class="dashboard-split-wrapper">
            <div class="dashboard-form-zone" id="guest-form-zone">
                <h2 class="guest-title-heavy-style desktop-only-title">${t('checkin.title')}</h2>
                
                <div class="form-container form-container-verify-margin">
                    ${regionSelectorHtml}

                    <div class="input-row-group">
                        <div class="input-group"><label>${t('label.name.self')} <span class="req-star">*</span></label><input type="text" id="name" value="${passedName}" placeholder="${t('ph.name.ex')}"></div>
                        <div class="input-group"><label>${t('label.contact.self')} <span class="req-star">*</span></label>${phoneInputHtml('contact', passedContact)}</div>
                    </div>
                    
                    <div class="input-row-group">
                        <div class="input-group"><label>${t('label.company')} <span class="req-star">*</span></label><input type="text" id="company" placeholder="${t('ph.company')}"></div>
                        <div class="input-group"><label>${t('label.vehicle')}</label><input type="text" id="vehicle_no" placeholder="${t('ph.vehicle')}"></div>
                    </div>

                    <div class="input-row-group">
                        <div class="input-group"><label>${t('label.expectIn')} <span class="req-star">*</span></label>${timeSelectHtml('expectedCheckin', roundUpToTenKst())}</div>
                        <div class="input-group"><label>${t('label.expectOut')} <span class="req-star">*</span></label>${timeSelectHtml('expectedCheckout')}</div>
                    </div>

                    <!-- 🔢 담당자 지정은 고유번호로만 한다.
                         이름 매칭은 폐지: 외국인 방문객은 한글을 칠 수 없고, 동명이인이면 특정도 안 된다.
                         담당자명은 서버가 번호로 찾아 채운다. -->
                    <div class="input-group">
                        <label>${t('label.manager')} <span class="req-star">*</span></label>
                        <!-- 번호든 이름이든 이 칸 하나로 받는다. 숫자만 넣으면 번호,
                             글자를 넣으면 이름으로 보고 후보를 찾아 보여준다. -->
                        <input type="text" id="manager_q" autocomplete="off"
                               placeholder="${t('ph.manager')}" oninput="onManagerInput()">
                        <div id="mgrResult" class="mgr-result"></div>
                        <!-- 고른 담당자. 서버는 이름(+동명이인이면 부서)으로 다시 특정한다. -->
                        <input type="hidden" id="manager_name">
                        <input type="hidden" id="manager_dept">
                    </div>

                    <div class="input-group mb-20">
                        <label>${t('label.purpose')} <span class="req-star">*</span></label>
                        <input type="hidden" id="purpose" value="회의/미팅">
                        <div class="purpose-button-group">
                            <button type="button" class="btn-choice active" onclick="selectPurpose(this, '회의/미팅', 'purpose')">🤝 ${t('purpose.meeting')}</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '제품 납품', 'purpose')">📦 ${t('purpose.delivery')}</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '상차/하차', 'purpose')">🚚 ${t('purpose.loading')}</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '품질 검사', 'purpose')">🔍 ${t('purpose.quality')}</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '시설 점검', 'purpose')">🛠️ ${t('purpose.facility')}</button>
                            <button type="button" class="btn-choice" onclick="selectPurpose(this, '기타 업무', 'purpose')">📁 ${t('purpose.etc')}</button>
                        </div>
                    </div>
                    
                    <button type="button" onclick="openSheetAndAddFirst('guest')" class="btn-guest-sub mt-15 mobile-only-btn">
                        ➕ ${t('checkin.addCompanion')}
                    </button>

                    <div class="privacy-consent-box mt-15">
                        <p class="privacy-text">
                            <strong>${t('privacy.title')}</strong><br>
                            - ${t('privacy.items')}: <strong>${t('privacy.items.val')}</strong><br>
                            - ${t('privacy.purpose')}: ${t('privacy.purpose.val')}<br>
                            - ${t('privacy.keep')}: <strong>${t('privacy.keep.val')}</strong>
                        </p>
                        <div class="remember-me-box remember-checkbox-layout-style mt-10">
                            <input type="checkbox" id="privacyConsent" class="remember-checkbox-size">
                            <label for="privacyConsent" class="remember-label-pointer" style="color: #b91c1c; font-weight: 700;">
                                ${t('privacy.agree')}
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
                    <h3 class="my-title-color" style="margin-bottom:0; font-size:1.2rem;">👥 ${t('comp.title')}</h3>
                    <button type="button" onclick="clearAllCompanions()" class="btn-list-action bg-orange" style="padding:4px 10px; font-size:0.8rem;">${t('comp.clearAll')}</button>
                </div>

                <div id="companion-container" class="results-container schedule-list-scroll-box guest-comp-scroll-box">
                    <div class="no-data-box empty-comp-msg" id="empty-companion-msg"><p>${t('comp.empty')}</p></div>
                </div>
                <button type="button" onclick="addCompanionField()" class="btn-guest-sub btn-add-comp-outline mt-15">
                    ➕ ${t('comp.addMore')}
                </button>
                <button type="button" onclick="closeCompanionSheet()" class="btn-emp-main mobile-bs-close mt-15">${t('comp.done')}</button>
            </div>
        </div>

        <div class="action-buttons action-buttons-margin">
            <button onclick="submitCheckin()" class="btn-guest-main">${t('checkin.submit')}</button>
            <button onclick="showMainPage()" class="btn-guest-sub">${t('btn.cancel')}</button>
        </div>
    `;
}

async function submitCheckin() {
    const privacyConsentEl = document.getElementById('privacyConsent');
    if (privacyConsentEl && !privacyConsentEl.checked) {
        alert(t('alert.needPrivacy'));
        privacyConsentEl.focus();
        return;
    }

    const nameEl = document.getElementById('name');
    const companyEl = document.getElementById('company');
    const vehicleNoEl = document.getElementById('vehicle_no');
    const managerCodeEl = document.getElementById('manager_q');
    const purposeEl = document.getElementById('purpose');

    const guestRegionEl = document.getElementById('guestRegionSelect');
    const finalRegion = guestRegionEl ? guestRegionEl.value : (typeof currentRegion !== 'undefined' ? currentRegion : null);

    if (!finalRegion) {
        return alert(t('alert.needRegion'));
    }

    if (!nameEl || !companyEl || !managerCodeEl) return;

    const name = nameEl.value.trim();
    const company = companyEl.value.trim();
    const contact = readPhone('contact');
    const vehicle_no = vehicleNoEl ? (vehicleNoEl.value.trim() || '없음') : '없음';
    // 숫자만 남긴다 (공백·하이픈을 넣어 전달받는 경우가 있다)
    const managerRaw = managerCodeEl ? managerCodeEl.value.trim() : '';
    const byCode = managerIsCode(managerRaw);
    const manager_code = byCode ? managerRaw.replace(/\D/g, '') : '';
    const manager_name = byCode ? '' : ((document.getElementById('manager_name') || {}).value || '');
    const manager_dept = byCode ? '' : ((document.getElementById('manager_dept') || {}).value || '');
    const purpose = purposeEl.value;

    const expected_checkin = readTimeSelect('expectedCheckin');
    const expected_checkout = readTimeSelect('expectedCheckout');
    
    if (!name || !company || !contact || !purpose) return alert(t('alert.needRequired'));
    // 담당자는 번호 또는 이름 중 하나면 된다 (외국인 방문객은 한글 이름 입력이 불가)
    if (!managerRaw) return alert(t('alert.needManager'));
    if (!byCode && !manager_name) return alert(t('alert.pickManager'));
    if (!expected_checkin || !expected_checkout) return alert(t('alert.needTimes'));

    let visitorsArray = [{
        name, company, contact, vehicle_no,
        manager_code, manager_name, manager_dept,      // 번호로 골랐으면 이름·부서가 빈 값
        purpose, expected_checkin, expected_checkout
    }];

    const compBoxes = document.querySelectorAll('.companion-box');
    for (let i = 0; i < compBoxes.length; i++) {
        const row = compBoxes[i];
        const cName = row.querySelector('.comp-name').value.trim();
        const cContact = readPhoneIn(row);
        const cCompany = row.querySelector('.comp-company').value.trim() || company;
        const cVehicle = row.querySelector('.comp-vehicle').value.trim() || '없음';

        if (!cName && !cContact) continue;  // 완전히 빈 동반인 행은 건너뜀
        if (!cName || !cContact) return alert(t('alert.needCompanion', {n: i + 1}));
        visitorsArray.push({
            name: cName,
            company: cCompany,
            contact: cContact,
            vehicle_no: cVehicle,
            manager_code: manager_code,
            manager_name: manager_name,
            manager_dept: manager_dept,
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
            showRegistrationComplete(result.members, srvMsg(result));
        } else {
            alert(srvMsg(result, 'alert.error'));
        }
    } catch (e) {
        alert(t('alert.network'));
    }
}

// 🔳 등록 완료 화면: 그룹 전원의 개인 QR을 각자 이름과 함께 표시
//    (대표자 폰 방전/분실 대비 — 각자 자기 QR을 저장; 직접 조회 백업도 병행 가능)
function showRegistrationComplete(members, message) {
    markGuestView(showRegistrationComplete, members, message);
    resetWideLayout();
    const appCard = document.getElementById('app-card');
    if (!appCard) return;

    let qrListHtml = '';
    if (Array.isArray(members) && members.length > 0) {
        qrListHtml = members.map(m => m.token ? `
            <div class="guest-qr-box">
                <p class="guest-qr-name">${t('greet.person', {name: m.name})}</p>
                <img src="/api/qr?token=${encodeURIComponent(m.token)}" alt="${t('qr.altPerson', {name: m.name})}" class="guest-qr-img">
            </div>` : '').join('');
        if (qrListHtml) {
            qrListHtml = `
                <p class="guest-qr-guide">${t('done.qrGuide')}</p>
                <div class="guest-qr-grid">${qrListHtml}</div>`;
        }
    }

    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">✅ ${t('done.heading')}</h2>
        <div class="visitor-info-box">
            <p class="status-line"><b>🟡 ${t('status.waitIn')}</b></p>
            <p class="status-desc">${message || t('status.waitIn.desc')}</p>
            <p class="poll-live-hint">🔄 ${t('poll.hint')}</p>
        </div>
        ${qrListHtml}
        <div class="action-buttons visitor-btn-margin"><button onclick="goGuestHome()" class="btn-guest-sub">${t('btn.home')}</button></div>
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
    markGuestView(showCheckoutPage, visitor);
    resetWideLayout();
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    const qrHtml = visitor.token
        ? `<div class="guest-qr-box">
               <img src="/api/qr?token=${encodeURIComponent(visitor.token)}" alt="${t('qr.altMine')}" class="guest-qr-img">
               <p class="guest-qr-hint">${t('qr.saveHint')}</p>
           </div>`
        : '';
    const groupBtn = (visitor.group_size && visitor.group_size >= 2)
        ? `<div class="action-buttons"><button onclick="showGroupQr(${visitor.id})" class="btn-guest-sub">👥 ${t('qr.groupBtn')}</button></div>`
        : '';
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">${t('checkout.pageTitle')}</h2>
        <div class="visitor-info-box">
            <p class="greet">${t('greet.person', {name: `<strong>${visitor.name}</strong>`})}</p>
            <span class="badge-company">${visitor.company}</span>
            <p class="time-info">${t('checkout.checkinTime', {time: visitor.checkin_time || t('checkout.pending')})}</p>
        </div>
        ${qrHtml}
        ${groupBtn}
        <div class="action-buttons">
            <button onclick="submitCheckout(${visitor.id})" class="btn-guest-main">${t('checkout.yes')}</button>
            <button onclick="showSearchForm()" class="btn-guest-sub">${t('checkout.notMe')}</button>
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
            guestFlash = srvMsg(result, 'checkout.done');
            showPrecheckStatus(id);
        }
    } catch (e) {}
}

function showSearchForm() {
    markGuestView(showSearchForm);
    stopVisitorPolling();
    resetWideLayout(); 
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">${t('search.myTitle')}</h2>
        <div class="form-container form-container-verify-margin">
            <div class="input-group">
                <label>${t('label.name.self')}</label>
                <input type="text" id="searchName" placeholder="${t('search.phName')}" autocomplete="off">
            </div>
            <div class="input-group">
                <label>${t('label.phone')}</label>
                ${phoneInputHtml('searchContact')}
            </div>
        </div>
        <div class="action-buttons">
            <button onclick="searchVisitor()" class="btn-guest-main">${t('btn.search')}</button>
            <button onclick="initVisitorPage()" class="btn-guest-sub">${t('btn.home')}</button>
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
            guestFlash = srvMsg(d);
            await showScanStatus(token, true);    // 접수 결과 반영해 다시 조회
            startVisitorPolling(() => fetchStatusByToken(token), () => showScanStatus(token, true));
            return true;
        }
        passSelfCheckinBlocked = srvMsg(d);
        return false;
    } catch (e) {
        return false;
    }
}

// 상태별 안내 정보 (배지 문구/색 클래스/설명)
function getStatusView(status) {
    switch (status) {
        case '입실대기': return { label: t('sv.waitIn.label'), desc: t('sv.waitIn.desc'), canCheckout: false };
        case '입실완료': return { label: t('sv.in.label'), desc: t('sv.in.desc'), canCheckout: true };
        case '퇴실대기': return { label: t('sv.waitOut.label'), desc: t('sv.waitOut.desc'), canCheckout: false };
        case '퇴실완료': return { label: t('sv.out.label'), desc: t('sv.out.desc'), canCheckout: false };
        case '만료':     return { label: t('sv.expired.label'), desc: t('sv.expired.desc'), canCheckout: false };
        // 🎫 정기 출입증 QR 을 본인이 열어본 경우 (오늘 출입 기록이 아직 없는 상태)
        case '정기권':   return { label: t('sv.pass.label'), desc: t('sv.pass.desc'), canCheckout: false };
        case '정기권거점필요': return { label: t('sv.passRegion.label'), desc: t('sv.passRegion.desc'), canCheckout: false };
        case '정기권사용불가': return { label: t('sv.passBlocked.label'), desc: t('sv.passBlocked.desc'), canCheckout: false };
        default:         return { label: `ℹ️ ${status || t('sv.unknown.none')}`, desc: t('sv.unknown.desc'), canCheckout: false };
    }
}

async function searchVisitor() {
    const nameEl = document.getElementById('searchName');
    const resultDiv = document.getElementById('searchResult');
    if (!resultDiv) return;

    const name = nameEl ? nameEl.value.trim() : '';
    const contact = readPhone('searchContact');
    if (!name || !contact) {
        resultDiv.innerHTML = `<div class="no-data-box"><span class="icon">✏️</span><p>${t('search.needBoth')}</p></div>`;
        return;
    }

    try {
        const res = await fetch(`/api/search?name=${encodeURIComponent(name)}&contact=${encodeURIComponent(contact)}`);
        const list = await res.json();

        if (!list || list.length === 0) {
            resultDiv.innerHTML = `<div class="no-data-box"><span class="icon">🔍</span><p>${t('search.none')}</p></div>`;
            return;
        }

        // 이름+전화번호 정확 일치라 사실상 1건. 가장 최근 건 기준으로 상태 표시.
        const v = list[0];
        // 🔖 조회로 확인된 내 방문 건을 이 기기에도 기억 (재접속 시 자동 복원용)
        if (v.status !== '퇴실완료' && v.status !== '만료') localStorage.setItem('my_visitor_id', v.id);
        const sv = getStatusView(v.status);
        const checkoutBtn = sv.canCheckout
            ? `<div class="action-buttons"><button onclick="submitCheckout(${v.id})" class="btn-guest-main">${t('checkout.now')}</button></div>`
            : '';
        const qrHtml = v.token
            ? `<div class="guest-qr-box">
                   <img src="/api/qr?token=${encodeURIComponent(v.token)}" alt="${t('qr.altMine')}" class="guest-qr-img">
                   <p class="guest-qr-hint">${t('qr.saveHint')}</p>
               </div>`
            : '';

        const groupBtn = (v.group_size && v.group_size >= 2)
            ? `<div class="action-buttons"><button onclick="showGroupQr(${v.id})" class="btn-guest-sub">👥 ${t('qr.groupBtn')}</button></div>`
            : '';

        resultDiv.innerHTML = `
            <div class="visitor-info-box">
                <p class="greet">${t('greet.person', {name: `<strong>${v.name}</strong>`})}</p>
                <span class="badge-company">${v.company || '-'}</span>
                <p class="status-line"><b>${sv.label}</b></p>
                <p class="status-desc">${sv.desc}</p>
                <p class="time-info">${t('time.inout', {in: v.checkin_time || '-', out: v.checkout_time || '-'})}</p>
            </div>
            ${qrHtml}
            ${groupBtn}
            ${checkoutBtn}
        `;
    } catch (e) {
        resultDiv.innerHTML = `<div class="no-data-box"><span class="icon">⚠️</span><p>${t('search.error')}</p></div>`;
    }
}

// 👥 일행(그룹) 전체 QR 보기: 방문 건 id 로 같은 그룹 전원의 QR을 조회해 표시
async function showGroupQr(logId) {
    markGuestView(showGroupQr, logId);
    resetWideLayout();
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    appCard.innerHTML = `<div class="shimmer-loader"><div class="spinner"></div><p>${t('group.loading')}</p></div>`;

    let data = null;
    try {
        const res = await fetch(`/api/group/qr?id=${encodeURIComponent(logId)}`);
        data = await res.json();
    } catch (e) {}

    if (!data || !data.success || !Array.isArray(data.members) || data.members.length === 0) {
        appCard.innerHTML = `
            <h2 class="guest-title-bold-style">${t('group.title')}</h2>
            <div class="no-data-box"><span class="icon">⚠️</span><p>${srvMsg(data, 'group.fail')}</p></div>
            <div class="action-buttons visitor-btn-margin"><button onclick="showSearchForm()" class="btn-guest-sub">${t('btn.prev')}</button></div>`;
        return;
    }

    const qrListHtml = data.members.map(m => m.token ? `
        <div class="guest-qr-box">
            <p class="guest-qr-name">${t('greet.person', {name: m.name})}</p>
            <img src="/api/qr?token=${encodeURIComponent(m.token)}" alt="${t('qr.altPerson', {name: m.name})}" class="guest-qr-img">
        </div>` : '').join('');

    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">👥 ${t('group.titleN', {n: data.members.length})}</h2>
        <p class="guest-qr-guide">${t('group.guide')}</p>
        <div class="guest-qr-grid">${qrListHtml}</div>
        <div class="action-buttons visitor-btn-margin"><button onclick="showSearchForm()" class="btn-guest-sub">${t('btn.prev')}</button></div>
    `;
}


// ====================================================================
// 🎫 출입 이용권 발급 신청 (손님 화면)
//   - 접수만 하는 화면이다. 실제 발급은 경비실·최고관리자 승인 후 이뤄진다.
//   - 유효기간·이용 요일은 '희망 사항'으로 받고, 승인자가 최종 확정한다.
// ====================================================================
// 요일 표시는 언어별로 바뀐다. 서버로 가는 값은 인덱스(data-day)라 영향 없다.
const PASS_REQ_WEEKDAY_KEYS = ['wd.mon', 'wd.tue', 'wd.wed', 'wd.thu', 'wd.fri', 'wd.sat', 'wd.sun'];

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

/* 저장값 → 화면 표시용 문구.
   값 자체는 서버·경비실이 쓰는 한국어 그대로 두고, 손님에게 보일 때만 갈아끼운다.
   (방문객이 번역된 버튼으로 고른 값이라, 되돌아올 때 한국어로 보이면 어색하다)
   사전에 없는 값이면 원문을 그대로 보여 준다 — 서버가 새 값을 주더라도 깨지지 않게. */
function passPeriodLabel(v) {
    const map = { '1일': 'pass.period.1d', '1주일': 'pass.period.1w', '1개월': 'pass.period.1m' };
    return map[v] ? t(map[v]) : v;
}

function purposeLabel(v) {
    const map = {
        '회의/미팅': 'purpose.meeting', '제품 납품': 'purpose.delivery',
        '상차/하차': 'purpose.loading', '품질 검사': 'purpose.quality',
        '시설 점검': 'purpose.facility', '기타 업무': 'purpose.etc',
    };
    return map[v] ? t(map[v]) : v;
}

function showPassRequestForm() {
    markGuestView(showPassRequestForm);
    stopVisitorPolling();
    resetWideLayout();
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    passReqPeriod = window.PASS_DEFAULT_PERIOD || '1개월';

    // 거점: 정문 QR 로 들어오면 확정(확인 문구), 직접 접속이면 손님이 선택. (입실 등록 화면과 같은 규칙)
    const regionBlock = (typeof currentRegion !== 'undefined' && currentRegion)
        ? `<div class="input-group mb-15">
               <div class="region-confirm-box">📍 ${t('passreq.regionFixed', {region: regionLabel(currentRegion)})}</div>
               <input type="hidden" id="passReqRegion" value="${currentRegion}">
           </div>`
        : `<div class="input-group mb-15 warning-box">
               <label class="warning-text">📍 ${t('passreq.regionPick')} <span class="req-star">*</span></label>
               <select id="passReqRegion">
                   <option value="">${t('passreq.regionPh')}</option>
                   <option value="테크센터">${t('region.tech')}</option>
                   <option value="에코센터">${t('region.eco')}</option>
                   <option value="평택공장">${t('region.pyeongtaek')}</option>
                   <option value="거제 오션센터">${t('region.geoje')}</option>
               </select>
           </div>`;

    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">🎫 ${t('pass.req.title')}</h2>

        <div class="form-container">
            ${regionBlock}
            <div class="input-row-group">
                <div class="input-group"><label>${t('label.name.self')} <span class="req-star">*</span></label>
                    <input type="text" id="passReqName" placeholder="${t('ph.name')}" autocomplete="off"></div>
                <div class="input-group"><label>${t('label.contact')} <span class="req-star">*</span></label>${phoneInputHtml('passReqContact')}</div>
            </div>
            <div class="input-row-group">
                <div class="input-group"><label>${t('passreq.company')} <span class="req-star">*</span></label>
                    <input type="text" id="passReqCompany" placeholder="${t('passreq.companyPh')}" autocomplete="off"></div>
                <div class="input-group"><label>${t('label.vehicle')}</label>
                    <input type="text" id="passReqVehicle" placeholder="${t('passreq.vehiclePh')}" autocomplete="off"></div>
            </div>
            <!-- 이용 목적: 일반 방문 등록과 같은 버튼 선택식.
                 직접 타이핑하면 표기가 제각각이라 집계가 안 되고, 외국인 방문객은 한글 입력도 어렵다.
                 저장값은 한국어 그대로 두고(경비실·엑셀이 이 값을 쓴다) 화면 표시만 번역한다. -->
            <div class="input-group">
                <label>${t('passreq.purpose')} <span class="req-star">*</span></label>
                <input type="hidden" id="passReqPurpose" value="회의/미팅">
                <div class="purpose-button-group">
                    <button type="button" class="btn-choice active" onclick="selectPurpose(this, '회의/미팅', 'passReqPurpose')">🤝 ${t('purpose.meeting')}</button>
                    <button type="button" class="btn-choice" onclick="selectPurpose(this, '제품 납품', 'passReqPurpose')">📦 ${t('purpose.delivery')}</button>
                    <button type="button" class="btn-choice" onclick="selectPurpose(this, '상차/하차', 'passReqPurpose')">🚚 ${t('purpose.loading')}</button>
                    <button type="button" class="btn-choice" onclick="selectPurpose(this, '품질 검사', 'passReqPurpose')">🔍 ${t('purpose.quality')}</button>
                    <button type="button" class="btn-choice" onclick="selectPurpose(this, '시설 점검', 'passReqPurpose')">🛠️ ${t('purpose.facility')}</button>
                    <button type="button" class="btn-choice" onclick="selectPurpose(this, '기타 업무', 'passReqPurpose')">📁 ${t('purpose.etc')}</button>
                </div>
            </div>
            <div class="input-group">
                <label>${t('passreq.startDate')} <span class="req-star">*</span></label>
                <input type="date" id="passReqFrom" value="${passReqTodayStr()}" min="${passReqTodayStr()}"
                       onchange="refreshPassReqRange()">
            </div>
            <div class="input-group">
                <label>${t('pass.period')} <span class="req-star">*</span></label>
                <div class="pass-req-periods" id="passReqPeriodBox">
                    ${(window.PASS_PERIODS || ['1일', '1주일', '1개월']).map(x =>
                        `<button type="button" class="pass-req-period-btn${x === passReqPeriod ? ' active' : ''}"
                                 data-period="${x}" onclick="selectPassReqPeriod('${x}')">${passPeriodLabel(x)}</button>`).join('')}
                </div>
                <div class="pass-req-period">
                    <b id="passReqRangeText">${passReqTodayStr()} ~ ${window.passPeriodEnd(passReqTodayStr(), passReqPeriod)}</b>
                    <span>${t('pass.reapply')}</span>
                </div>
            </div>
            <div class="input-group">
                <label>${t('passreq.weekdays')}</label>
                <div class="pass-req-weekdays" id="passReqWeekdays">
                    ${PASS_REQ_WEEKDAY_KEYS.map((k, i) =>
                        `<label class="pass-req-day"><input type="checkbox" data-day="${i}" ${i < 5 ? 'checked' : ''}><span>${t(k)}</span></label>`
                    ).join('')}
                </div>
            </div>
        </div>

        <div class="action-buttons">
            <button onclick="submitPassRequest()" class="btn-guest-main">${t('passreq.submit')}</button>
            <button onclick="showMainPage()" class="btn-guest-sub">${t('btn.cancel')}</button>
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

async function submitPassRequest() {
    const get = (id) => (document.getElementById(id) || {}).value || '';
    let weekdays = '';
    document.querySelectorAll('#passReqWeekdays input[type="checkbox"]').forEach(cb => {
        weekdays += cb.checked ? '1' : '0';
    });
    if (!weekdays.includes('1')) weekdays = '1111111';

    const payload = {
        name: get('passReqName').trim(),
        contact: readPhone('passReqContact'),
        company: get('passReqCompany').trim(),
        vehicle_no: get('passReqVehicle').trim(),
        purpose: get('passReqPurpose').trim(),
        weekdays: weekdays,
        valid_from: passReqStartDate(),
        period: passReqPeriod,
        region: (document.getElementById('passReqRegion') || {}).value || '',
    };
    if (!payload.name) return alert(t('alert.needName'));
    if (!payload.contact) return alert(t('alert.needContact'));
    if (!payload.company) return alert(t('passreq.needCompany'));
    if (!payload.purpose) return alert(t('passreq.needPurpose'));
    if (!payload.region) return alert(t('passreq.needRegion'));

    try {
        const res = await fetch('/api/pass/request', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const d = await res.json();
        if (!d.success) return alert(srvMsg(d, 'passreq.failed'));
        showPassRequestDone(payload, srvMsg(d));
    } catch (e) {
        alert(t('passreq.netError'));
    }
}

function showPassRequestDone(payload, message) {
    markGuestView(showPassRequestDone, payload, message);
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">${t('passdone.title')}</h2>
        <div class="visitor-info-box">
            <p class="greet">${t('greet.person', {name: `<strong>${payload.name}</strong>`})}</p>
            <span class="badge-company">${payload.company}</span>
            <p class="status-line"><b>🟡 ${t('passdone.waiting')}</b></p>
            <p class="status-desc">${message}</p>
            <p class="time-info">${t('passdone.period', {from: payload.valid_from, to: `${window.passPeriodEnd(payload.valid_from, payload.period)} (${passPeriodLabel(payload.period)})`})}</p>
        </div>
        <p class="guest-pass-note">
            ${t('passdone.note1')}<br>
            ${t('passdone.note2')}
        </p>
        <p class="poll-live-hint">🔄 ${t('poll.hint')}</p>
        <div id="passDoneResult"></div>
        <div class="action-buttons">
            <button onclick="showPassStatusForm()" class="btn-guest-main">${t('passdone.check')}</button>
            <button onclick="showMainPage()" class="btn-guest-sub">${t('btn.home')}</button>
        </div>
    `;

    // 승인될 때까지 기다린다. 승인되면 이 화면에서 바로 QR 을 보여준다
    // (예전에는 손님이 '신청 결과 조회'로 들어가 성명·연락처를 다시 입력해야 확인할 수 있었다)
    startPassApprovalPolling(payload);
}

/* 🎫 출입권 승인 감시
     신청 직후 화면을 열어둔 채 승인을 기다리는 동선이라, 승인되는 순간 QR 이 뜨는 게 자연스럽다.
     - 조회와 같은 API(/api/pass/request/status)를 쓴다. 성명·연락처는 방금 낸 신청서 값을 그대로 쓴다.
     - '활성' 이 되면 QR 카드로 갈아끼우고 감시를 멈춘다. '반려' 도 결과이므로 멈춘다.
     - 타이머는 visitorPollTimer 를 공유한다 → 다른 화면으로 넘어갈 때
       그 화면들이 부르는 stopVisitorPolling() 으로 자동 정리된다. */
function startPassApprovalPolling(payload) {
    stopVisitorPolling();
    const name = (payload.name || '').trim();
    const contact = (payload.contact || '').trim();
    if (!name || !contact) return;

    visitorPollTimer = setInterval(async () => {
        let list;
        try {
            const res = await fetch('/api/pass/request/status', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, contact })
            });
            const d = await res.json();
            if (!d || !d.success || !Array.isArray(d.list)) return;
            list = d.list;
        } catch (e) {
            return;      // 통신이 잠깐 끊겨도 계속 기다린다
        }

        // 결과가 나온 건(활성/반려)만 관심 대상. 신청 상태면 계속 기다린다.
        const done = list.filter(p => p.status === '활성' || p.status === '반려');
        if (!done.length) return;

        stopVisitorPolling();
        const box = document.getElementById('passDoneResult');
        if (!box) return;                       // 이미 다른 화면으로 넘어갔다
        preparePassCards(done);
        box.innerHTML = passCardsHtml(done);

        // 결과가 나왔으니 '대기중' 안내와 자동 갱신 문구는 지운다
        const waiting = document.querySelector('#app-card .visitor-info-box');
        if (waiting) waiting.remove();
        const hint = document.querySelector('#app-card .poll-live-hint');
        if (hint) hint.remove();
        const note = document.querySelector('#app-card .guest-pass-note');
        if (note) note.remove();
    }, 3000);   // 신청 직후 화면을 열어둔 채 기다리는 동선이라 짧게 잡는다
}

// ── 내 이용권 / 신청 결과 조회 ────────────────────────────────────
function showPassStatusForm() {
    markGuestView(showPassStatusForm);
    stopVisitorPolling();
    resetWideLayout();
    const appCard = document.getElementById('app-card');
    if (!appCard) return;
    appCard.innerHTML = `
        <h2 class="guest-title-bold-style">🎫 ${t('pass.my.title')}</h2>
        <div class="form-container form-container-verify-margin">
            <div class="input-group">
                <label>${t('label.name.self')}</label>
                <input type="text" id="passStatusName" placeholder="${t('passmy.phName')}" autocomplete="off">
            </div>
            <div class="input-group">
                <label>${t('label.contact')}</label>
                ${phoneInputHtml('passStatusContact')}
            </div>
        </div>
        <div class="action-buttons">
            <button onclick="lookupMyPass()" class="btn-guest-main">${t('btn.search')}</button>
            <button onclick="showMainPage()" class="btn-guest-sub">${t('btn.cancel')}</button>
        </div>
        <div id="passStatusResult"></div>
    `;
}

function passStatusView(status) {
    switch (status) {
        case '신청': return { label: t('ps.req.label'), desc: t('ps.req.desc') };
        case '활성': return { label: t('ps.on.label'), desc: t('ps.on.desc') };
        case '정지': return { label: t('ps.paused.label'), desc: t('ps.desk.desc') };
        case '만료': return { label: t('ps.expired.label'), desc: t('ps.expired.desc') };
        case '해지': return { label: t('ps.ended.label'), desc: t('ps.desk.desc') };
        case '반려': return { label: t('ps.rejected.label'), desc: t('ps.rejected.desc') };
        default:     return { label: `ℹ️ ${status || t('sv.unknown.none')}`, desc: '' };
    }
}

let myPassCache = [];      // 조회 결과 (이미지 저장에 사용)

// 내 이용권 카드를 PNG 로 저장 (경비실에서 발급 시 저장하는 이미지와 동일한 결과물)
function saveMyPassImage(passId) {
    const p = myPassCache.find(x => x.id === passId);
    if (!p) return;
    window.downloadPassCardPng(p, window.passWeekdayText(p.weekdays));
}

/* 🎫 출입권 카드 묶음 HTML.
     조회 화면과 '신청 접수' 화면의 자동 갱신이 같은 모양을 써야 하므로 함수로 뺀다.
     카드 구성은 경비실 QR 창(sec-qr-dialog)과 동일하게 맞춘다 —
       머리말(종류·사업장) → QR → 이름 → 소속 → 유효기간·이용 요일·차량 번호.
     승인된 건만 QR 을 표시한다 (서버도 활성 건에만 토큰을 내려준다). */
function passCardsHtml(list) {
    return list.map(p => {
        const v = passStatusView(p.status);
        const active = (p.status === '활성' && p.token);
        const qr = active
            ? `<img class="pass-my-qr" src="/api/qr?token=${encodeURIComponent(p.token)}" alt="${t('qr.altPass')}">`
            : '';
        const saveBtn = active
            ? `<div class="pass-my-actions">
                   <button onclick="saveMyPassImage(${p.id})" class="btn-guest-sub pass-my-save">📥 ${t('passmy.saveImg')}</button>
               </div>`
            : '';
        const memo = (p.status === '반려' && p.memo) ? `<p class="pass-my-memo">${p.memo}</p>` : '';
        return `
            <div class="pass-my-card">
                <div class="pass-my-head">
                    <span class="pass-my-type">${t('pass.kind')}</span>
                    <span class="pass-my-region">${regionLabel(p.region)}</span>
                </div>
                ${qr}
                <div class="pass-my-name">${p.name}</div>
                <div class="pass-my-company">${p.company}</div>
                <div class="pass-my-meta">
                    <span>${t('passmy.validity')}</span><b>${p.valid_from} ~ ${p.valid_to}${p.period ? ` (${passPeriodLabel(p.period)})` : ''}</b>
                    <span>${t('passmy.days')}</span><b>${window.passWeekdayText(p.weekdays)}</b>
                    <span>${t('label.vehicle')}</span><b>${p.vehicle_no || t('passmy.noVehicle')}</b>
                </div>
                <p class="status-line"><b>${v.label}</b></p>
                <p class="status-desc">${v.desc}</p>
                ${memo}
                ${saveBtn}
            </div>`;
    }).join('');
}

/* 저장 버튼을 눌렀을 때 곧바로 공유·저장되도록 카드 이미지를 미리 만들어 둔다.
   (iOS 는 사용자 조작 직후에만 공유 시트를 허용한다) */
function preparePassCards(list) {
    myPassCache = list;
    list.filter(p => p.status === '활성' && p.token)
        .forEach(p => window.preparePassCardImage(p, window.passWeekdayText(p.weekdays)));
}

async function lookupMyPass() {
    const name = (document.getElementById('passStatusName') || {}).value.trim();
    const contact = readPhone('passStatusContact');
    const box = document.getElementById('passStatusResult');
    if (!box) return;
    if (!name) return alert(t('alert.needName'));
    if (!contact) return alert(t('alert.needContact'));

    box.innerHTML = `<div class="shimmer-loader"><div class="spinner"></div><p>${t('passmy.loading')}</p></div>`;
    try {
        const res = await fetch('/api/pass/request/status', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, contact })
        });
        const d = await res.json();
        if (!d.success) {
            box.innerHTML = `<div class="no-data-box"><span class="icon">⚠️</span><p>${srvMsg(d, 'passmy.failed')}</p></div>`;
            return;
        }
        if (!d.list.length) {
            box.innerHTML = `<div class="no-data-box"><span class="icon">🔍</span><p>${t('passmy.none')}</p></div>`;
            return;
        }
        preparePassCards(d.list);
        box.innerHTML = passCardsHtml(d.list);
    } catch (e) {
        box.innerHTML = `<div class="no-data-box"><span class="icon">⚠️</span><p>${t('passmy.netError')}</p></div>`;
    }
}
