/**
 * js/auth.js
 * 임직원 로그인, 로그아웃, 인증 관리
 */

function renderEmpNavbar() {
    const emp = JSON.parse(sessionStorage.getItem('emp_session'));
    const utilityNav = document.getElementById('utility-nav');
    if (!utilityNav) return;
    
    let adminBtnHtml = '';
    if (emp && parseInt(emp.level) === 3) {
        adminBtnHtml = `<a href="/admin" class="btn-nav-link btn-link-admin">관리자</a>`;
    }
    
    let allLogsBtnHtml = '';
    if (emp && [3, 5].includes(parseInt(emp.level))) {
        allLogsBtnHtml = `<button onclick="openVisitorLogModal()" class="btn-nav-link btn-all-logs">전체기록</button>`;
    }
    
    // 🎫 장기 출입권 신청 — 방문 예약과 성격이 다른 별도 신청이라 전역 동작으로 둔다.
    //    경비실(4)은 '출입 이용권' 탭에서 직접 발급하므로 신청 창구가 필요 없다.
    let passBtnHtml = '';
    if (emp && parseInt(emp.level) !== 4) {
        passBtnHtml = `<button onclick="openPassRequest()" class="btn-nav-link btn-pass-req">장기 출입권</button>`;
    }

    /* 📱 모바일에서는 버튼이 한 줄에 다 안 들어간다. 두 묶음으로 나눈다.
         - 상시 노출: 전체기록·관리자·로그아웃 — 자주 쓰거나 바로 닿아야 하는 것
         - 메뉴 안:  장기 출입권·거점 QR 안내 — 가끔 쓰는 신청·안내 창구
       데스크톱에서는 토글이 숨고 두 묶음이 한 줄에 이어 붙는다(기존 순서 그대로). */
    utilityNav.innerHTML = `
        <div class="nav-profile-info">
            <span class="user-text"><b>${emp.name}<span class="nav-rank"> ${emp.rank || ''}</span></b> <span class="dept-tag">${emp.dept}</span></span>
        </div>
        <div class="nav-actions nav-actions-more" id="navActionsMore">
            ${passBtnHtml}
            <button onclick="openRegionQrModal()" class="btn-nav-link btn-region-qr">거점 QR 안내</button>
        </div>
        <div class="nav-actions nav-actions-primary">
            ${allLogsBtnHtml}
            ${adminBtnHtml}
            <button onclick="handleEmpLogout()" class="btn-nav-link btn-link-danger">로그아웃</button>
        </div>
        <button type="button" class="nav-toggle" onclick="toggleUtilityNav()"
                aria-expanded="false" aria-controls="navActionsMore">메뉴 <span class="nav-caret">▾</span></button>
    `;
}

/** 모바일 유틸리티 바 접기/펴기. 데스크톱에서는 토글 자체가 보이지 않는다. */
function toggleUtilityNav() {
    const nav = document.getElementById('utility-nav');
    const btn = nav?.querySelector('.nav-toggle');
    if (!nav) return;
    const open = nav.classList.toggle('nav-open');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
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
                    <input type="text" id="empName" placeholder="본인 이름 입력" value="${savedName}">
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