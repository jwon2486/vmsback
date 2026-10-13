/**
 * js/emp-modal.js
 * 🧑‍💼 임직원 화면 모달 두 가지
 *   1) 방문 예약 수정 — 방문일자·예정시간 변경, 인원 추가/수정/삭제
 *   2) 장기 출입권 신청 — 손님 화면과 같은 접수 창구를 직원이 대신 연다
 *
 * 서버 API 는 손님 화면과 공유한다(/api/visit/*, /api/pass/request).
 *   손님은 QR 토큰으로, 임직원은 로그인 세션으로 권한을 증명한다. 규칙은 서버 한 곳에 있다.
 *   → 화면이 둘이어도 '무엇을 바꿀 수 있는가'는 한 군데서만 결정된다.
 *
 * 이 화면은 내부 직원(한국어) 전용이라 다국어 대상이 아니다.
 */

/* ── 공통 틀 ─────────────────────────────────────────────────────── */

function empCloseModal() {
    document.getElementById('empModalHost')?.remove();
}

function empOpenModal(title, bodyHtml) {
    empCloseModal();
    const ov = document.createElement('div');
    ov.id = 'empModalHost';
    ov.className = 'emp-modal-overlay';
    ov.innerHTML = `
        <div class="emp-modal" role="dialog" aria-modal="true">
            <div class="emp-modal-head">
                <h3 class="emp-modal-title">${title}</h3>
                <button type="button" class="emp-modal-x" onclick="empCloseModal()" aria-label="닫기">×</button>
            </div>
            <div class="emp-modal-body" id="empModalBody">${bodyHtml}</div>
        </div>`;
    // 배경을 눌러도 닫히게 하되, 모달 안쪽 클릭은 통과시키지 않는다
    ov.addEventListener('click', (e) => { if (e.target === ov) empCloseModal(); });
    document.body.appendChild(ov);
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') empCloseModal();
});

/* ── 1) 방문 예약 수정 ───────────────────────────────────────────── */

let empEditTargetId = null;

async function openVisitEdit(logId) {
    empEditTargetId = logId;
    empOpenModal('방문 예약 수정', '<p class="text-center text-muted">불러오는 중...</p>');
    await renderVisitEditBody();
}

/** cached 를 주면 서버를 다시 부르지 않는다 (수정 모드 전환처럼 화면만 다시 그릴 때). */
async function renderVisitEditBody(cached) {
    const body = document.getElementById('empModalBody');
    if (!body) return;

    let d = cached || null;
    if (!d) {
        try {
            d = await (await fetch(`/api/visit/group?target_id=${empEditTargetId}`)).json();
        } catch (e) {}
    }
    if (!d || !d.success) {
        body.innerHTML = `<p class="text-center text-danger">${(d && d.message) || '불러오지 못했습니다.'}</p>`;
        return;
    }

    const esc = (v) => String(v == null ? '' : v).replace(/'/g, '').replace(/"/g, '');
    const rows = d.list.map(m => `
        <div class="vm-row-emp">
            <div class="vm-who-emp">
                <span class="vm-corp-emp">회사: ${m.company || '-'}</span>
                <span class="vm-name-line-emp"><b>${m.name}</b>${m.is_me ? '<span class="vm-me-emp">대표</span>' : ''}</span>
                <span class="vm-sub-emp">${formatPhone(m.contact) || '-'}</span>
            </div>
            ${m.can_cancel
                ? `<span class="vm-row-btns-emp">
                       ${m.id === empPersonEditId
                           ? `<button class="vm-cancel-emp" onclick="empCancelPersonEdit()">취소</button>
                              <button class="btn-list-action bg-blue" onclick="empSavePerson()">저장</button>`
                           : `<button class="btn-list-action bg-emp-sub" onclick="empEditPerson(${m.id})">수정</button>`}
                       <button class="vm-del-emp" onclick="empRemoveVisitor(${m.id}, '${esc(m.name)}')">삭제</button>
                   </span>`
                : `<span class="vm-locked-emp">${m.status}</span>`}
        </div>`).join('');

    // 수정 모드 전환 때 서버를 다시 부르지 않도록 보관해 둔다
    window.__empGroupData = d;
    window.__empPeople = d.list;

    const editable = d.can_add;
    // '인원 추가' 버튼은 목록 끝 행의 버튼 칸(수정·삭제와 같은 열)에 둔다. 입력은 아래 폼에서 한다.
    const addRowHtml = editable ? `
        <div class="vm-row-emp vm-add-row-emp" id="empCompAddRow">
            <div class="vm-who-emp"><span class="vm-sub-emp">아래 칸에 입력 후 추가</span></div>
            <span class="vm-row-btns-emp">
                <button type="button" class="btn-list-action bg-blue" id="empCompAddBtn"
                        onclick="empAddCompanion()">+ 인원 추가</button>
            </span>
        </div>` : '';
    body.innerHTML = `
        <div class="vm-panel-emp">
            <p class="vm-title-emp">방문자 · 일행</p>
            ${rows}
            ${addRowHtml}
        </div>
        ${editable ? `
        <div class="emp-field" style="margin-top:1rem">
            <label>방문일자</label>
            <input type="date" id="empVisitDate" value="${d.visit_date || ''}">
        </div>
        <!-- 시간은 다른 화면과 같은 선택기(timeSelectHtml)를 쓴다 — 10분 단위로만 고를 수 있다.
             네이티브 <input type="time"> 은 1분 단위라 여기서만 분 단위가 달라졌다. -->
        <div class="emp-field">
            <label>방문 예정시간 ~ 퇴실 예정시간</label>
            <div class="emp-field-row">
                <div>${timeSelectHtml('empVisitIn', hhmmToTimeDef(d.expected_checkin))}</div>
                <span class="emp-tilde">~</span>
                <div>${timeSelectHtml('empVisitOut', hhmmToTimeDef(d.expected_checkout))}</div>
            </div>
        </div>
        <!-- 추가·수정 겸용 폼 — 연락처는 다른 화면과 같은 3박스 입력(phoneInputHtml)을 쓴다.
             '수정'을 누르면 같은 칸에 그 사람 값이 채워지고 버튼만 바뀐다.
             (추가용·수정용 폼을 따로 두면 칸 구성이 어긋날 때 한쪽만 고치게 된다) -->
        <div class="emp-field" style="margin-top:1rem">
            <label id="empCompLabel">인원 추가</label>
            <div class="emp-field-row emp-row-comp">
                <div class="emp-field">
                    <input type="text" id="empCompName" placeholder="성명" maxlength="20">
                </div>
                <div class="emp-field">
                    ${phoneInputHtml('empComp', '')}
                </div>
            </div>
            <div class="emp-field-row">
                <div class="emp-field">
                    <input type="text" id="empCompCompany" placeholder="회사명 (비우면 대표자와 동일)" maxlength="30">
                </div>
                <div class="emp-field">
                    <input type="text" id="empCompVehicle" placeholder="차량 번호" maxlength="20">
                </div>
            </div>
        </div>

        <div class="emp-modal-actions">
            <button type="button" class="emp-btn-ghost" onclick="empCloseModal()">닫기</button>
            <button type="button" class="emp-btn-primary" onclick="empSaveVisitSchedule()">변경 저장</button>
        </div>`
        : `<p class="vm-note-emp">이미 입실 처리된 건은 수정할 수 없습니다.</p>
           <div class="emp-modal-actions">
               <button type="button" class="emp-btn-ghost" onclick="empCloseModal()">닫기</button>
           </div>`}
    `;

    // 수정 모드면 아래 폼을 그 사람 값으로 채운다. 폼은 추가용과 같은 칸을 쓴다.
    const editing = empPersonEditId && d.list.find(x => x.id === empPersonEditId);
    const label = document.getElementById('empCompLabel');
    const addRow = document.getElementById('empCompAddRow');
    if (editing) {
        empFillCompForm(editing);
        if (label) label.textContent = `방문자 정보 수정 — ${editing.name}`;
        if (addRow) addRow.style.display = 'none';   // 수정 중에는 '추가'를 숨긴다(저장은 행에서 한다)
        document.getElementById('empCompName')?.focus();
    } else {
        empFillCompForm(null);
        if (label) label.textContent = '인원 추가';
        if (addRow) addRow.style.display = '';
    }
}

async function empRemoveVisitor(targetId, name) {
    if (!confirm(`${name} 님의 신청을 취소하시겠습니까?`)) return;
    const d = await empPost('/api/visit/cancel', { target_id: targetId });
    if (!d) return;
    // 대표 건을 지우면 더 볼 대상이 없다 → 모달을 닫고 목록을 새로 고친다
    if (targetId === empEditTargetId) { empCloseModal(); fetchFilteredMySchedule(); return; }
    renderVisitEditBody();
}

/* ── 방문자 한 명 고치기 ─────────────────────────────────────────
   아래 '인원 추가' 폼을 그대로 재사용한다. 값만 채우고 행 버튼을 바꾼다. */
let empPersonEditId = null;

function empFillCompForm(p) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('empCompName', p ? p.name : '');
    set('empCompCompany', p ? p.company : '');
    set('empCompVehicle', (p && p.vehicle_no !== '없음') ? p.vehicle_no : '');
    const digits = ((p && p.contact) || '').replace(/\D/g, '');
    const boxes = document.querySelectorAll('#empModalBody .phone-box');
    if (boxes.length >= 3) {
        boxes[0].value = digits.slice(0, 3);
        boxes[1].value = digits.slice(3, 7);
        boxes[2].value = digits.slice(7, 11);
    }
}

function empEditPerson(personId) {
    empPersonEditId = personId;
    // 행 버튼이 [취소][저장] 로 바뀌어야 하므로 화면을 다시 그린다. 서버는 다시 부르지 않는다.
    renderVisitEditBody(window.__empGroupData);
}

function empCancelPersonEdit() {
    empPersonEditId = null;
    renderVisitEditBody(window.__empGroupData);
}

async function empSavePerson() {
    const get = (id) => (document.getElementById(id) || {}).value || '';
    const d = await empPost('/api/visit/person', {
        target_id: empEditTargetId,
        person_id: empPersonEditId,
        name: get('empCompName').trim(),
        contact: readPhone('empComp'),
        company: get('empCompCompany').trim(),
        vehicle_no: get('empCompVehicle').trim(),
    });
    if (!d) return;
    empPersonEditId = null;
    renderVisitEditBody();     // 바뀐 값을 받아와야 하므로 여기서는 다시 조회한다
}

async function empAddCompanion() {
    const get = (id) => (document.getElementById(id) || {}).value || '';
    const d = await empPost('/api/visit/companion', {
        target_id: empEditTargetId,
        name: get('empCompName').trim(),
        contact: readPhone('empComp'),
        company: get('empCompCompany').trim(),
        vehicle_no: get('empCompVehicle').trim(),
    });
    if (!d) return;
    renderVisitEditBody();
}

async function empSaveVisitSchedule() {
    const get = (id) => (document.getElementById(id) || {}).value || '';
    const d = await empPost('/api/visit/update', {
        target_id: empEditTargetId,
        visit_date: get('empVisitDate'),
        expected_checkin: readTimeSelect('empVisitIn'),
        expected_checkout: readTimeSelect('empVisitOut'),
    });
    if (!d) return;
    alert(d.message || '수정되었습니다.');
    empCloseModal();
    fetchFilteredMySchedule();
}

/* ── 2) 장기 출입권 ──────────────────────────────────────────────
   한 모달 안에 '신청 하기'와 '신청 현황' 두 탭을 둔다.
   낸 뒤에 확인·수정하려고 다른 화면을 찾아다니지 않아도 되게 한 곳에 모은다.
   승인 전(상태 '신청')에만 고치거나 지울 수 있고, 그 판단은 서버가 can_edit 로 내려 준다. */

let passEditId = null;      // null = 새 신청, 숫자 = 그 신청을 수정 중

function openPassRequest() {
    passEditId = null;
    empOpenModal('장기 출입권', `
        <div class="emp-tabs">
            <button type="button" class="emp-tab-btn active" id="passTabForm"
                    onclick="switchPassTab('form')">📝 신청 하기</button>
            <button type="button" class="emp-tab-btn" id="passTabList"
                    onclick="switchPassTab('list')">📋 신청 현황</button>
        </div>
        <div id="passTabBody"></div>`);
    switchPassTab('form');
}

function switchPassTab(which) {
    document.getElementById('passTabForm')?.classList.toggle('active', which === 'form');
    document.getElementById('passTabList')?.classList.toggle('active', which === 'list');
    if (which === 'form') {
        passEditId = null;
        document.getElementById('passTabBody').innerHTML = passFormHtml(null);
    } else {
        passEditId = null;
        renderMyPassList();
    }
}

/** 저장된 유효기간에서 '이용 기간'을 되짚는다. 서버는 시작일+기간으로 끝일을 다시 계산한다. */
function passPeriodFromRange(from, to) {
    if (!from || !to || typeof window.passPeriodEnd !== 'function') return null;
    const periods = window.PASS_PERIODS || ['1일', '1주일', '1개월'];
    return periods.find(p => window.passPeriodEnd(from, p) === to) || null;
}

/** 신청·수정이 같은 폼을 쓴다. p 가 있으면 그 값으로 채운 '수정' 모드. */
function passFormHtml(p) {
    const emp = JSON.parse(sessionStorage.getItem('emp_session') || '{}');
    const today = new Date();
    const ymd = today.getFullYear() + '-'
              + String(today.getMonth() + 1).padStart(2, '0') + '-'
              + String(today.getDate()).padStart(2, '0');
    const periods = window.PASS_PERIODS || ['1일', '1주일', '1개월'];
    const def = window.PASS_DEFAULT_PERIOD || periods[periods.length - 1];

    const v = p || {};
    const region = v.region || emp.region || '테크센터';
    const purpose = v.purpose || '회의/미팅';
    const from = v.valid_from || ymd;
    const curPeriod = p ? (passPeriodFromRange(v.valid_from, v.valid_to) || def) : def;
    const vehicle = (v.vehicle_no && v.vehicle_no !== '없음') ? v.vehicle_no : '';

    const PURPOSES = [
        ['회의/미팅', '🤝'], ['제품 납품', '📦'], ['상차/하차', '🚚'],
        ['품질 검사', '🔍'], ['시설 점검', '🛠️'], ['기타 업무', '📁'],
    ];
    const opt = (val, label, sel) =>
        '<option value="' + val + '"' + (val === sel ? ' selected' : '') + '>' + label + '</option>';

    return `
        ${p ? '<p class="vm-note-emp" style="margin:0 0 .7rem">신청 내용을 수정합니다. 승인 전까지만 고칠 수 있습니다.</p>' : ''}
        <div class="emp-field-row">
            <div class="emp-field">
                <label>방문객 성명 <span class="emp-req-star">*</span></label>
                <input type="text" id="prName" maxlength="20" placeholder="예) 홍길동" value="${v.name || ''}">
            </div>
            <div class="emp-field">
                <label>연락처 <span class="emp-req-star">*</span></label>
                <input type="tel" id="prContact" maxlength="13" inputmode="numeric"
                       placeholder="010-1234-5678" value="${v.contact || ''}">
            </div>
        </div>

        <div class="emp-field-row">
            <div class="emp-field">
                <label>소속 회사명 <span class="emp-req-star">*</span></label>
                <input type="text" id="prCompany" maxlength="30" value="${v.company || ''}">
            </div>
            <div class="emp-field">
                <label>차량 번호</label>
                <input type="text" id="prVehicle" maxlength="20" placeholder="없으면 비워두세요" value="${vehicle}">
            </div>
        </div>

        <div class="emp-field-row emp-row-3">
            <div class="emp-field">
                <label>사업장 <span class="emp-req-star">*</span></label>
                <select id="prRegion">
                    ${opt('테크센터', '화성 테크센터', region)}
                    ${opt('에코센터', '부산 에코센터', region)}
                    ${opt('평택공장', '평택공장', region)}
                    ${opt('거제 오션센터', '거제 오션센터', region)}
                </select>
            </div>
            <div class="emp-field">
                <label>이용 시작일 <span class="emp-req-star">*</span></label>
                <input type="date" id="prFrom" value="${from}" min="${ymd}">
            </div>
            <div class="emp-field">
                <label>기간 <span class="emp-req-star">*</span></label>
                <select id="prPeriod">${periods.map(x => opt(x, x, curPeriod)).join('')}</select>
            </div>
        </div>

        <div class="emp-field">
            <label>이용 목적 <span class="emp-req-star">*</span></label>
            <input type="hidden" id="prPurpose" value="${purpose}">
            <div class="purpose-button-group">
                ${PURPOSES.map(([val, ico]) =>
                    '<button type="button" class="btn-choice' + (val === purpose ? ' active' : '') + '" onclick="selectPurpose(this, \'' + val + '\', \'prPurpose\')">' + ico + ' ' + val + '</button>'
                ).join('')}
            </div>
        </div>

        <div class="emp-modal-actions">
            <button type="button" class="emp-btn-ghost"
                    onclick="${p ? 'switchPassTab(\'list\')' : 'empCloseModal()'}">${p ? '뒤로' : '취소'}</button>
            <button type="button" class="emp-btn-primary" onclick="empSubmitPassRequest()">${p ? '수정 저장' : '신청 접수'}</button>
        </div>`;
}

async function renderMyPassList() {
    const body = document.getElementById('passTabBody');
    if (!body) return;
    body.innerHTML = '<p class="vm-note-emp" style="text-align:center">불러오는 중...</p>';

    let d = null;
    try { d = await (await fetch('/api/pass/mine')).json(); } catch (e) {}
    if (!d || !d.success) {
        body.innerHTML = '<p class="vm-note-emp" style="text-align:center">불러오지 못했습니다.</p>';
        return;
    }
    if (!d.list.length) {
        body.innerHTML = '<p class="vm-note-emp" style="text-align:center">신청한 장기 출입권이 없습니다.</p>';
        return;
    }

    body.innerHTML = d.list.map(x => `
        <div class="pass-my-item">
            <div class="pass-my-top">
                <div class="vm-who-emp">
                    <b>${x.name}</b>
                    <span class="vm-sub-emp">${x.company || '-'} · ${x.region}</span>
                </div>
                <span class="pass-my-state pass-state-${x.status}">${x.status}</span>
            </div>
            <div class="pass-my-info">${x.valid_from} ~ ${x.valid_to} · ${x.purpose}</div>
            ${x.can_edit ? `
                <div class="pass-my-btns">
                    <button type="button" class="btn-list-action bg-emp-sub" onclick="editMyPass(${x.id})">수정</button>
                    <button type="button" class="vm-del-emp" onclick="deleteMyPass(${x.id}, '${String(x.name).replace(/'/g, '')}')">신청 취소</button>
                </div>` : ''}
        </div>`).join('');
}

async function editMyPass(id) {
    let d = null;
    try { d = await (await fetch('/api/pass/mine')).json(); } catch (e) {}
    const p = d && d.success && d.list.find(x => x.id === id);
    if (!p) { alert('신청 내역을 찾을 수 없습니다.'); return; }
    passEditId = id;
    document.getElementById('passTabForm').classList.add('active');
    document.getElementById('passTabList').classList.remove('active');
    document.getElementById('passTabBody').innerHTML = passFormHtml(p);
}

async function deleteMyPass(id, name) {
    if (!confirm(name + ' 님의 출입권 신청을 취소하시겠습니까?')) return;
    try {
        const d = await (await fetch('/api/pass/mine/' + id, { method: 'DELETE' })).json();
        if (!d.success) { alert(d.message || '취소에 실패했습니다.'); return; }
    } catch (e) { alert('통신 오류가 발생했습니다.'); return; }
    renderMyPassList();
}

// 이름에 emp 접두어 필수 — 같은 페이지에 손님용 submitPassRequest(visitor.js)가 있어,
// 이름이 같으면 나중에 로드된 이 함수가 덮어써 손님 신청서가 빈 값으로 검사된다.
async function empSubmitPassRequest() {
    const get = (id) => (document.getElementById(id) || {}).value || '';
    const payload = {
        name: get('prName').trim(),
        contact: get('prContact'),
        company: get('prCompany').trim(),
        vehicle_no: get('prVehicle').trim(),
        region: get('prRegion'),
        purpose: get('prPurpose'),
        valid_from: get('prFrom'),
        period: get('prPeriod'),
    };
    if (!payload.name || !payload.contact || !payload.company || !payload.purpose) {
        alert('성명·연락처·소속·이용 목적은 필수 입력입니다.');
        return;
    }

    // 수정 모드면 본인 신청 전용 경로로 보낸다 (승인 전 건만 서버가 받아 준다)
    if (passEditId) {
        try {
            const d = await (await fetch('/api/pass/mine/' + passEditId, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })).json();
            if (!d.success) { alert(d.message || '수정에 실패했습니다.'); return; }
            alert(d.message);
        } catch (e) { alert('통신 오류가 발생했습니다.'); return; }
        switchPassTab('list');
        return;
    }

    const d = await empPost('/api/pass/request', payload);
    if (!d) return;
    alert(d.message || '출입권 신청이 접수되었습니다.');
    switchPassTab('list');   // 접수 결과를 바로 확인할 수 있게 현황 탭으로 넘긴다
}

/* ── 공통 전송 ───────────────────────────────────────────────────── */

/** 성공하면 응답을, 실패하면 알림을 띄우고 null 을 돌려준다. */
async function empPost(url, payload) {
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const d = await res.json();
        if (!d || !d.success) {
            alert((d && d.message) || '처리에 실패했습니다.');
            return null;
        }
        return d;
    } catch (e) {
        alert('통신 오류가 발생했습니다.');
        return null;
    }
}
