/**
 * 통합 admin.js (인라인 스타일 제로 및 클래스 제어 기반)
 * 🛡️ [주소창 수동 우회 진입 및 브라우저 캐시 부활 방어 로직 탑재]
 */

const empBaseUrl = "/admin/employees";
const ITEMS_PER_PAGE = 10;
const PAGE_BLOCK_SIZE = 5;

let allEmployees = [];
let filteredEmployeesList = [];
let currentEmpPage = 1;
let isEditMode = false;

const GROUP_PRIORITY = (emp) => {
    if (emp.type === "경영진" || emp.dept === "경영진") return 1;
    if (emp.region === "에코센터" && emp.type === "직영") return 2;
    if (emp.region === "테크센터" && emp.type === "직영") return 3;
    if (emp.dept && emp.dept.includes("식당")) return 4;
    if (emp.type === "협력사") return 5;
    return 6; 
};

const RANK_PRIORITY = {
    "회장": 1, "사장": 2, "부사장": 3, "전무": 4, "상무": 5, "이사": 6,
    "부장": 7, "차장": 8, "과장": 9, "대리": 10, "주임": 11, "사원": 12
};

// ====================================================================
// 🗺️ 한국 표준시(KST) 기준 이번 주 월요일 ~ 금요일 날짜 계산 함수
// ====================================================================
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

// ====================================================================
// 🚨 [최전방 세션 가드 인터셉터]
// ====================================================================
function verifyAdminSessionGate() {
    const empData = sessionStorage.getItem('emp_session');
    
    if (!empData) {
        alert("보안 세션이 없거나 만료되었습니다. 인증 후 진입하세요.");
        window.location.replace('/emp'); 
        return false;
    }
    
    try {
        const emp = JSON.parse(empData);
        if (!emp.level || parseInt(emp.level) !== 3) {
            alert("최고 관리자(Level 3) 전용 구역입니다. 접근 권한이 없습니다.");
            window.location.replace('/emp');
            return false;
        }
    } catch (e) {
        window.location.replace('/emp');
        return false;
    }
    return true;
}

verifyAdminSessionGate();

document.addEventListener("DOMContentLoaded", () => {
    const startEl = document.getElementById('adminStartDate');
    const endEl = document.getElementById('adminEndDate');
    if (startEl && endEl) {
        const weekRange = getKstThisWeekRange();
        startEl.value = weekRange.todayKst;
        endEl.value = weekRange.todayKst;
    }

    if (sessionStorage.getItem('emp_session')) {
        loadAdminLogs();
    }
});

window.addEventListener("pageshow", (event) => {
    if (event.persisted || (window.performance && window.performance.navigation.type === 2)) {
        verifyAdminSessionGate();
    }
});

// ==========================================
// [구역 1] 방문객 출입 기록 처리 파트 (달력 연동)
// ==========================================
async function loadAdminLogs() {
    const startEl = document.getElementById('adminStartDate');
    const endEl = document.getElementById('adminEndDate');
    
    const startDate = startEl ? startEl.value : '';
    const endDate = endEl ? endEl.value : '';
    
    const tbody = document.getElementById('adminLogBody');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted">기록 내역을 불러오는 중입니다...</td></tr>';
    
    try {
        const res = await fetch(`/api/admin/logs?start_date=${startDate}&end_date=${endDate}`);
        
        if (res.status === 401 || res.status === 403) {
            alert("관리자 권한 인증 세션이 없거나 만료되었습니다.");
            sessionStorage.removeItem('emp_session');
            window.location.href = '/emp';
            return;
        }

        const logs = await res.json();

        // 순번: 서버가 계산한 '그 달 절대 순번'(month_seq) 사용 (경비실·엑셀과 동일 규칙).
        //  - 날짜 필터와 무관하게 매달 1일부터의 절대 위치. 표시는 오래된순(방문일→id) 정렬.
        const sorted = [...logs].sort((a, b) => {
            if (a.visit_date !== b.visit_date) return a.visit_date < b.visit_date ? -1 : 1;
            return (a.id || 0) - (b.id || 0);
        });

        let html = '';
        if (sorted.length === 0) {
            html = '<tr><td colspan="11" class="text-center text-muted">조회 범위 내 출입 데이터가 존재하지 않습니다.</td></tr>';
        } else {
            sorted.forEach(v => {
                const managerDisplay = v.emp_name
                    ? `${v.emp_name} <span class="manager-dept-info">(${v.emp_dept || '부서없음'})</span>`
                    : '<span class="no-manager-dash">-</span>';
                const visitCountDisplay = v.visit_count != null
                    ? (v.visit_count >= 2 ? `<b>${v.visit_count}회</b>` : `${v.visit_count}회`)
                    : '-';

                html += `
                    <tr>
                        <td>${v.month_seq != null ? v.month_seq : '-'}</td>
                        <td>${v.visit_date}</td>
                        <td class="text-bold">${v.name}</td>
                        <td>${v.contact || '-'}</td>
                        <td>${visitCountDisplay}</td>
                        <td>${v.company}</td>
                        <td><span class="purpose-tag">${v.purpose}</span></td>
                        <td>${managerDisplay}</td>
                        <td>${v.checkin_time || '-'}</td>
                        <td>${v.checkout_time || '-'}</td>
                        <td><b>${v.status}</b></td>
                    </tr>
                `;
            });
        }
        tbody.innerHTML = html;
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center text-danger">네트워크 통신 에러가 발생했습니다.</td></tr>';
    }
}

function downloadExcel() {
    const startEl = document.getElementById('adminStartDate');
    const endEl = document.getElementById('adminEndDate');
    
    const startDate = startEl ? startEl.value : '';
    const endDate = endEl ? endEl.value : '';
    
    window.location.href = `/api/admin/excel-download?start_date=${startDate}&end_date=${endDate}`;
}

// ==========================================
// [구역 2] 식수 연동 임직원 인사 데이터 관리 파트 (CRUD)
// ==========================================
async function loadEmployees() {
    const tbody = document.getElementById("employeeTableBody");
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">직원 목록 동기화 중...</td></tr>';

    try {
        const res = await fetch(empBaseUrl);
        
        if (res.status === 401 || res.status === 403) {
            alert("관리자 권한 인증 세션이 없거나 만료되었습니다.");
            sessionStorage.removeItem('emp_session');
            window.location.href = '/emp';
            return;
        }

        const data = await res.json();
        allEmployees = data || [];

        allEmployees.sort((a, b) => {
            const pA = GROUP_PRIORITY(a);
            const pB = GROUP_PRIORITY(b);
            if (pA !== pB) return pA - pB;

            const rA = RANK_PRIORITY[a.rank] || 99;
            const rB = RANK_PRIORITY[b.rank] || 99;
            if (rA !== rB) return rA - rB;

            return a.name.localeCompare(b.name, "ko");
        });

        filteredEmployeesList = [...allEmployees];
        currentEmpPage = 1;
        renderEmployeeTable();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">⚠️ 직원 목록 조회 중 연동 에러가 발생했습니다.</td></tr>';
    }
}

function renderEmployeeTable() {
    const tbody = document.getElementById("employeeTableBody");
    tbody.innerHTML = "";

    if (filteredEmployeesList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">일치하는 임직원 정보가 없습니다.</td></tr>';
        document.getElementById("employeePagination").innerHTML = "";
        return;
    }

    const startIndex = (currentEmpPage - 1) * ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredEmployeesList.length);
    const pageData = filteredEmployeesList.slice(startIndex, endIndex);

    pageData.forEach(emp => {
        const tr = document.createElement("tr");
        
        // 💡 [수정됨] Level 2 폐지 및 Level 4(보안관제) 표시 로직
        let lvlBadge = '';
        if (emp.level === 3) {
            lvlBadge = '<span class="badge badge-lv3">최고관리자 (Lv.3)</span>';
        } else if (emp.level === 4) {
            lvlBadge = '<span class="badge badge-lv4">보안관제 (Lv.4)</span>';
        } else {
            lvlBadge = '<span class="badge badge-lv1">일반임직원 (Lv.1)</span>';
        }

        tr.innerHTML = `
            <td><b>${emp.id}</b></td>
            <td class="text-bold">${emp.name}</td>
            <td>${emp.region || '-'}</td>
            <td><span class="dept-tag emp-dept-label">${emp.dept || '부서없음'}</span></td> 
            <td>${emp.type || '-'}</td>
            <td>${emp.rank || '-'}</td>
            <td>${lvlBadge}</td>
            <td>
                <button class="btn btn-secondary btn-action-sm" onclick="openEditModal('${emp.id}')">수정</button> 
                <button class="btn btn-danger btn-action-sm" onclick="deleteEmployee('${emp.id}')">삭제</button> 
            </td>
        `;
        tbody.appendChild(tr);
    });

    renderEmployeePagination();
}

function renderEmployeePagination() {
    const container = document.getElementById("employeePagination");
    container.innerHTML = "";

    const totalPages = Math.ceil(filteredEmployeesList.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) return;

    const currentBlock = Math.ceil(currentEmpPage / PAGE_BLOCK_SIZE);
    const startPage = (currentBlock - 1) * PAGE_BLOCK_SIZE + 1;
    const endPage = Math.min(startPage + PAGE_BLOCK_SIZE - 1, totalPages);

    const appendBtn = (label, targetPage, disabled) => {
        const btn = document.createElement("button");
        btn.innerHTML = label;
        btn.disabled = disabled;
        btn.onclick = () => { currentEmpPage = targetPage; renderEmployeeTable(); };
        container.appendChild(btn);
    };

    appendBtn("«", 1, currentEmpPage === 1);
    appendBtn("‹", Math.max(1, currentEmpPage - 1), currentEmpPage === 1);

    for (let i = startPage; i <= endPage; i++) {
        const pBtn = document.createElement("button");
        pBtn.innerText = i;
        if (i === currentEmpPage) pBtn.classList.add("active");
        pBtn.onclick = () => { currentEmpPage = i; renderEmployeeTable(); };
        container.appendChild(pBtn);
    }

    appendBtn("›", Math.min(totalPages, currentEmpPage + 1), currentEmpPage === totalPages);
    appendBtn("»", totalPages, currentEmpPage === totalPages);
}

function searchEmployees() {
    const query = document.getElementById("empSearchInput").value.trim().toLowerCase();
    if (!query) {
        filteredEmployeesList = [...allEmployees];
    } else {
        filteredEmployeesList = allEmployees.filter(emp => 
            (emp.id && emp.id.toLowerCase().includes(query)) ||
            (emp.name && emp.name.toLowerCase().includes(query)) ||
            (emp.dept && emp.dept.toLowerCase().includes(query))
        );
    }
    currentEmpPage = 1;
    renderEmployeeTable();
}

function openAddModal() {
    isEditMode = false;
    document.getElementById("modalTitle").innerText = "👥 신규 임직원 정보 추가";
    document.getElementById("empId").value = "";
    document.getElementById("empId").disabled = false;
    document.getElementById("empName").value = "";
    document.getElementById("empRegion").value = "";
    document.getElementById("empDept").value = "";
    document.getElementById("empType").value = "";
    document.getElementById("empRank").value = "";
    document.getElementById("empLevel").value = "1";
    document.getElementById("editModal").classList.add("modal-active"); 
}

function openEditModal(id) {
    const emp = allEmployees.find(e => e.id === id);
    if (!emp) return;

    isEditMode = true;
    document.getElementById("modalTitle").innerText = "⚙️ 임직원 정보 수정";
    document.getElementById("empId").value = emp.id;
    document.getElementById("empId").disabled = true; 
    document.getElementById("empName").value = emp.name || "";
    document.getElementById("empRegion").value = emp.region || "";
    document.getElementById("empDept").value = emp.dept || "";
    document.getElementById("empType").value = emp.type || "";
    document.getElementById("empRank").value = emp.rank || "";
    document.getElementById("empLevel").value = emp.level || "1";
    document.getElementById("editModal").classList.add("modal-active"); 
}

function closeModal() {
    document.getElementById("editModal").classList.remove("modal-active"); 
}

async function saveEmployee() {
    const empData = {
        id: document.getElementById("empId").value.trim(),
        name: document.getElementById("empName").value.trim(),
        region: document.getElementById("empRegion").value.trim(),
        dept: document.getElementById("empDept").value.trim(),
        type: document.getElementById("empType").value.trim(),
        rank: document.getElementById("empRank").value.trim(),
        level: parseInt(document.getElementById("empLevel").value)
    };

    if (!empData.id || !empData.name) return alert("사번과 성명은 필수 입력값입니다.");

    const url = isEditMode ? `${empBaseUrl}/${empData.id}` : empBaseUrl;
    const method = isEditMode ? "PUT" : "POST";

    try {
        const res = await fetch(url, {
            method: method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(empData)
        });

        if (res.status === 401 || res.status === 403) {
            alert("수정 권한 세션이 만료되었습니다.");
            sessionStorage.removeItem('emp_session');
            window.location.href = '/emp';
            return;
        }

        const result = await res.json();
        if (result.success || result.id) {
            alert("✅ 사원 정보가 완벽하게 저장되었습니다.");
            loadEmployees();
            closeModal();
        }
    } catch (e) {
        alert("통신 중 오류가 발생했습니다.");
    }
}

async function deleteEmployee(id) {
    if (!confirm("해당 직원을 정말 삭제하시겠습니까?")) return;
    try {
        const res = await fetch(`${empBaseUrl}/${id}`, { method: "DELETE" });
        
        if (res.status === 401 || res.status === 403) {
            alert("삭제 권한 세션이 만료되었습니다.");
            sessionStorage.removeItem('emp_session');
            window.location.href = '/emp';
            return;
        }

        alert("🗑️ 사원 정보가 삭제되었습니다.");
        loadEmployees();
    } catch (e) {
        alert("삭제 실패");
    }
}

async function uploadEmployeeFile() {
    const fileInput = document.getElementById("uploadFile");
    const file = fileInput.files[0];
    if (!file) return alert("업로드할 엑셀 파일을 선택해 주세요.");

    const formData = new FormData();
    formData.append("file", file);

    try {
        const res = await fetch("/api/admin/upload-employees", { method: "POST", body: formData });
        
        if (res.status === 401 || res.status === 403) {
            alert("일괄 등록 권한 세션이 만료되었습니다.");
            sessionStorage.removeItem('emp_session');
            window.location.href = '/emp';
            return;
        }

        alert("📊 엑셀 일괄 업로드가 성공적으로 완료되었습니다.");
        loadEmployees();
        fileInput.value = "";
    } catch(e) {
        alert("업로드 실패");
    }
}

function switchTab(tabType) {
    const btnVisitor = document.getElementById('menuVisitor');
    const btnEmployee = document.getElementById('menuEmployee');
    const contentVisitor = document.getElementById('tabContentVisitor');
    const contentEmployee = document.getElementById('tabContentEmployee');
    const excelBox = document.getElementById('sidebarExcelBox');

    if (tabType === 'visitor') {
        btnVisitor.classList.add('active');
        btnEmployee.classList.remove('active');
        
        contentVisitor.classList.remove('section-hidden'); 
        contentEmployee.classList.add('section-hidden');
        excelBox.classList.remove('excel-sidebar-active'); 
        loadAdminLogs();
    } else if (tabType === 'employee') {
        btnVisitor.classList.remove('active');
        btnEmployee.classList.add('active');
        
        contentVisitor.classList.add('section-hidden');
        contentEmployee.classList.remove('section-hidden');
        excelBox.classList.add('excel-sidebar-active'); 
        loadEmployees();
    }

    const sidebar = document.getElementById('erpSidebar');
    if (sidebar && sidebar.classList.contains('open')) {
        toggleMobileSidebar();
    }
}

function toggleMobileSidebar() {
    const sidebar = document.getElementById('erpSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!sidebar || !overlay) return;

    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
}