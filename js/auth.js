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