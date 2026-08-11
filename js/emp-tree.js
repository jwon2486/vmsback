// VMS 권한(level) 표시용. 방문객 시스템 전용 개념이라 전산장비 원본에는 없다.
const VMS_LEVELS = { 1: '일반', 3: '최고관리자', 4: '경비실', 5: '전체기록' };
function vmsLevelBadge(level) {
    const n = parseInt(level || 1);
    const label = VMS_LEVELS[n] || ('Lv' + n);
    const cls = n === 3 ? 'bg-red-100 text-red-700'
              : n === 4 ? 'bg-amber-100 text-amber-700'
              : n === 5 ? 'bg-indigo-100 text-indigo-700'
              : 'bg-gray-100 text-gray-600';
    return `<span class="px-2 py-0.5 rounded text-xs font-bold ${cls}">${label}</span>`;
}

let currentDeptId = null;
let currentDeptName = '';
let allDepartments = [];

document.addEventListener('DOMContentLoaded', () => {
    fetchDepartments();
});

async function fetchDepartments() {
    try {
        const response = await fetch('/api/tree/departments');
        const departments = await response.json();
        allDepartments = departments; 
        buildTree(departments);
    } catch (error) {
        alert('조직도를 불러오지 못했습니다.');
    }
}

function buildTree(list) {
    const treeContainer = document.getElementById('orgTree');
    treeContainer.innerHTML = '';
    const roots = list.filter(node => node.parent_id === null || node.parent_id === 0);
    const childrenMap = {};
    
    list.forEach(node => {
        if (node.parent_id) {
            if (!childrenMap[node.parent_id]) childrenMap[node.parent_id] = [];
            childrenMap[node.parent_id].push(node);
        }
    });

    // 각 부서의 총원 = 직속 인원 + 모든 하위 부서 인원 (재귀 합산)
    const totalMap = {};
    function computeTotal(node) {
        let sum = node.member_count || 0;
        (childrenMap[node.id] || []).forEach(ch => { sum += computeTotal(ch); });
        totalMap[node.id] = sum;
        return sum;
    }
    roots.forEach(computeTotal);

    function renderNode(node, container) {
        const div = document.createElement('div');
        div.className = 'my-1';
        const hasChildren = childrenMap[node.id] && childrenMap[node.id].length > 0;

        const rowDiv = document.createElement('div');
        rowDiv.className = 'tree-row';

        const leftDiv = document.createElement('div');
        leftDiv.className = 'flex-1 cursor-pointer truncate font-medium';
        leftDiv.innerHTML = `📁 ${node.dept_name} <span class="text-gray-400 font-normal">(${totalMap[node.id] || 0})</span>`;
        leftDiv.onclick = (e) => {
            e.stopPropagation();
            selectDepartment(node.id, node.dept_name);
            if (hasChildren) {
                const childDiv = div.querySelector('.tree-children');
                childDiv.classList.toggle('hidden');
            }
        };

        const rightDiv = document.createElement('div');
        rightDiv.className = 'tree-actions';
        rightDiv.innerHTML = `
            <button onclick="openDeptModal('add_sub', ${node.id}, '${node.dept_name}')" class="btn-tiny" title="하위 부서 추가">➕</button>
            <button onclick="openDeptModal('edit', ${node.id}, '${node.dept_name}', ${node.parent_id})" class="btn-tiny" title="부서 수정">✏️</button>
            <button onclick="deleteDept(${node.id}, '${node.dept_name}')" class="btn-tiny btn-tiny-del" title="부서 삭제">🗑️</button>
        `;

        rowDiv.appendChild(leftDiv);
        rowDiv.appendChild(rightDiv);
        div.appendChild(rowDiv);

        if (hasChildren) {
            const childContainer = document.createElement('div');
            childContainer.className = 'tree-children hidden';
            childrenMap[node.id].forEach(child => renderNode(child, childContainer));
            div.appendChild(childContainer);
        }
        container.appendChild(div);
    }
    roots.forEach(root => renderNode(root, treeContainer));
}

async function selectDepartment(id, name) {
    currentDeptId = id;
    currentDeptName = name;
    
    document.getElementById('selectedAreaName').innerText = `👥 [${name}] 소속 직원 명단`;
    document.getElementById('selectedAreaType').innerText = `이 부서에 직속으로 소속된 직원 명단입니다. (하위 부서는 좌측에서 별도로 선택하세요.)`;
    document.getElementById('btnAddEmployee').classList.remove('hidden');
    loadDeptManager(id);

    try {
        const response = await fetch(`/api/tree/departments/${id}/employees`);
        const employees = await response.json();
        const tbody = document.getElementById('employeeTableBody');
        tbody.innerHTML = '';

        if (employees && employees.length > 0) {
            employees.forEach(emp => {
                const row = document.createElement('tr');
                row.className = 'table-row hover:bg-gray-50';
                
                let actionButtons = `
                    <button onclick="openEmployeeModal('edit', '${emp.id}', '${emp.emp_name}', '${emp.position}', ${emp.dept_id}, '${emp.dept_name}', '${emp.region || ''}', '${emp.type || ''}', ${emp.level || 1})" class="btn-outline text-xs px-2 py-1">
                        ✏️ 수정
                    </button>
                `;
                if (emp.dept_name === '퇴사자') {
                    actionButtons += `
                        <button onclick="deleteEmployee('${emp.id}', '${emp.emp_name}')" class="btn-outline text-gray-500 border-gray-200 hover:bg-gray-50 text-xs px-2 py-1">
                            🗑️ 삭제
                        </button>
                    `;
                }
                else {
                    actionButtons += `
                        <button onclick="retireEmployee('${emp.id}', '${emp.emp_name}')" class="btn-outline text-red-600 border-red-200 hover:bg-red-50 text-xs px-2 py-1">
                            🚪 퇴사
                        </button>
                    `;
                }

                row.innerHTML = `
                    <td class="table-td font-mono text-gray-500">${emp.id}</td>
                    <td class="table-td font-bold text-gray-900">${emp.emp_name}</td>
                    <td class="table-td text-gray-600">${emp.position || '일반'}</td>
                    <td class="table-td text-gray-600">${emp.dept_name}</td>
                    <td class="table-td text-gray-600">${emp.region || '-'}</td>
                    <td class="table-td">${vmsLevelBadge(emp.level)}</td>
                    <td class="table-td-center flex gap-1 justify-center">
                        ${actionButtons}
                    </td>
                `;
                tbody.appendChild(row);
            });
        } else {
            await renderVacantManagerRow(id, tbody);
        }
    } catch (error) {
        console.error("직원 데이터 로드 에러:", error);
    }
}

// 직속 인원이 0명인 부서: 겸임 부서장(직접/상위겸임)을 한 줄 표시. 인원수 집계에는 미포함.
async function renderVacantManagerRow(deptId, tbody) {
    const emptyMsg = `<tr><td colspan="7" class="table-td-center py-10 text-gray-400">해당 부서에 등록된 직원이 없습니다.</td></tr>`;
    try {
        const res = await fetch(`/api/tree/departments/${deptId}/manager`);
        const data = await res.json();
        if (data && data.manager) {
            const m = data.manager;
            tbody.innerHTML = `
                <tr class="table-row">
                    <td class="table-td font-mono text-gray-400">${m.id}</td>
                    <td class="table-td font-bold text-slate-700">${m.name}</td>
                    <td class="table-td text-gray-500">${m.rank || '-'}</td>
                    <td class="table-td text-gray-500">${m.dept_name} <span class="text-[10px] text-gray-400">(원소속)</span></td>
                    <td class="table-td-center text-xs text-gray-400">직속 인원 없음 · 인원수 미집계</td>
                </tr>`;
        } else {
            tbody.innerHTML = emptyMsg;
        }
    } catch (e) {
        tbody.innerHTML = emptyMsg;
    }
}

function openEmployeeModal(mode, empId = '', empName = '', empRank = '', deptId = null, deptName = '', empRegion = '', empType = '', empLevel = 1) {
    const modal = document.getElementById('employeeModal');
    const idInput = document.getElementById('empId');
    document.getElementById('modalMode').value = mode;
    
    if (mode === 'add') {
        document.getElementById('modalTitle').innerText = '➕ 새 직원 추가';
        idInput.value = '';
        idInput.readOnly = false; 
        idInput.classList.remove('bg-gray-100', 'text-gray-500');
        document.getElementById('empName').value = '';
        document.getElementById('empRank').value = '';
        document.getElementById('empRegion').value = '기타';
        document.getElementById('empType').value = '직영';
        document.getElementById('empLevel').value = '1';
        document.getElementById('transferNewDeptId').value = currentDeptId;
        document.getElementById('selectedTransferDeptName').innerText = currentDeptName;
    } else {
        document.getElementById('modalTitle').innerText = '✏️ 직원 정보 수정 및 부서이동';
        idInput.value = empId;
        idInput.readOnly = true; 
        idInput.classList.add('bg-gray-100', 'text-gray-500');
        document.getElementById('empName').value = empName;
        document.getElementById('empRank').value = empRank;
        document.getElementById('empRegion').value = empRegion || '기타';
        document.getElementById('empType').value = empType || '직영';
        document.getElementById('empLevel').value = String(empLevel || 1);
        document.getElementById('transferNewDeptId').value = deptId;
        document.getElementById('selectedTransferDeptName').innerText = deptName;
    }
    
    buildTransferTree(allDepartments);
    modal.classList.remove('hidden');
}

function closeEmployeeModal() {
    document.getElementById('employeeModal').classList.add('hidden');
}

function buildTransferTree(list) {
    const treeContainer = document.getElementById('transferOrgTree');
    treeContainer.innerHTML = '';
    const roots = list.filter(node => node.parent_id === null || node.parent_id === 0);
    const childrenMap = {};
    
    list.forEach(node => {
        if (node.parent_id) {
            if (!childrenMap[node.parent_id]) childrenMap[node.parent_id] = [];
            childrenMap[node.parent_id].push(node);
        }
    });

    // 각 부서의 총원 = 직속 인원 + 모든 하위 부서 인원 (재귀 합산)
    const totalMap = {};
    function computeTotal(node) {
        let sum = node.member_count || 0;
        (childrenMap[node.id] || []).forEach(ch => { sum += computeTotal(ch); });
        totalMap[node.id] = sum;
        return sum;
    }
    roots.forEach(computeTotal);

    function renderNode(node, container) {
        const div = document.createElement('div');
        div.className = 'my-1';
        const hasChildren = childrenMap[node.id] && childrenMap[node.id].length > 0;
        const titleSpan = document.createElement('span');
        titleSpan.className = 'transfer-tree-node';
        titleSpan.innerHTML = `📁 <span class="font-medium">${node.dept_name}</span> <span class="text-gray-400">(${totalMap[node.id] || 0})</span>`;
        
        titleSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.transfer-tree-node').forEach(el => {
                el.classList.remove('bg-indigo-100', 'text-indigo-700', 'font-bold');
            });
            titleSpan.classList.add('bg-indigo-100', 'text-indigo-700', 'font-bold');
            document.getElementById('transferNewDeptId').value = node.id;
            document.getElementById('selectedTransferDeptName').innerText = node.dept_name;
            if (hasChildren) {
                const childDiv = div.querySelector('.transfer-tree-children');
                if (childDiv) childDiv.classList.toggle('hidden');
            }
        });

        div.appendChild(titleSpan);
        if (hasChildren) {
            const childContainer = document.createElement('div');
            childContainer.className = 'transfer-tree-children hidden';
            childrenMap[node.id].forEach(child => renderNode(child, childContainer));
            div.appendChild(childContainer);
        }
        container.appendChild(div);
    }
    roots.forEach(root => renderNode(root, treeContainer));
}

async function submitEmployee() {
    const mode = document.getElementById('modalMode').value;
    const empId = document.getElementById('empId').value.trim();
    const empName = document.getElementById('empName').value.trim();
    const empRank = document.getElementById('empRank').value.trim();
    const deptId = document.getElementById('transferNewDeptId').value;
    
    if (!empId || !empName || !deptId) {
        alert('사번, 이름, 소속 부서는 필수 입력/선택 사항입니다.');
        return;
    }
    
    const payload = {
        id: empId, name: empName, rank: empRank, dept_id: parseInt(deptId),
        region: document.getElementById('empRegion').value,
        type:   document.getElementById('empType').value,
        level:  parseInt(document.getElementById('empLevel').value || '1')
    };

    try {
        let url = mode === 'add' ? '/api/tree/employees' : `/api/tree/employees/${empId}`;
        let method = mode === 'add' ? 'POST' : 'PUT';

        const response = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await response.json();
        
        if (result.success) {
            alert(result.message);
            closeEmployeeModal();
            fetchDepartments().then(() => {
                if (currentDeptId) selectDepartment(currentDeptId, currentDeptName);
            });
        } else {
            alert('오류 발생: ' + result.message);
        }
    } catch (error) {
        alert('통신 에러가 발생했습니다.');
    }
}

async function retireEmployee(empId, empName) {
    if (!confirm(`[${empName}] 직원을 퇴사 처리하시겠습니까?\n\n시스템 상에서 '퇴사자' 그룹으로 자동 이동됩니다.`)) return;
    try {
        const response = await fetch(`/api/tree/employees/${empId}/retire`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const result = await response.json();
        if (result.success) {
            alert(result.message);
            fetchDepartments().then(() => {
                if (currentDeptId) selectDepartment(currentDeptId, currentDeptName);
            });
        } else {
            alert('오류 발생: ' + result.message);
        }
    } catch (error) { alert('통신 에러가 발생했습니다.'); }
}

async function deleteEmployee(empId, empName) {
    if (!confirm(`[${empName}] 직원을 영구 삭제하시겠습니까?\n\n주의: 되돌릴 수 없습니다.`)) return;
    try {
        const response = await fetch(`/api/tree/employees/${empId}`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) selectDepartment(currentDeptId, currentDeptName);
        else alert('오류 발생: ' + result.message);
    } catch (error) { alert('통신 에러가 발생했습니다.'); }
}

function updateDeptSelectOptions() {
    const select = document.getElementById('parentDeptSelect');
    select.innerHTML = '<option value="">-- 최상위 부서 (독립) --</option>';
    allDepartments.forEach(dept => {
        const option = document.createElement('option');
        option.value = dept.id;
        option.innerText = `[${dept.id}] ${dept.dept_name}`;
        select.appendChild(option);
    });
}

function openDeptModal(mode, deptId = null, deptName = '', parentId = null) {
    const modal = document.getElementById('deptModal');
    document.getElementById('deptModalMode').value = mode;
    document.getElementById('targetDeptId').value = deptId || '';
    updateDeptSelectOptions();
    const nameInput = document.getElementById('deptNameInput');
    const parentSelect = document.getElementById('parentDeptSelect');

    if (mode === 'add_root') {
        document.getElementById('deptModalTitle').innerText = '➕ 최상위 본부 추가';
        nameInput.value = '';
        parentSelect.value = '';
    } 
    else if (mode === 'add_sub') {
        document.getElementById('deptModalTitle').innerText = `➕ [${deptName}] 산하 부서 추가`;
        nameInput.value = '';
        parentSelect.value = deptId;
    } 
    else if (mode === 'edit') {
        document.getElementById('deptModalTitle').innerText = '✏️ 부서 정보 편집';
        nameInput.value = deptName;
        parentSelect.value = parentId || '';
    }
    modal.classList.remove('hidden');
}

function closeDeptModal() {
    document.getElementById('deptModal').classList.add('hidden');
}

async function submitDept() {
    const mode = document.getElementById('deptModalMode').value;
    const deptId = document.getElementById('targetDeptId').value;
    const deptName = document.getElementById('deptNameInput').value.trim();
    const parentId = document.getElementById('parentDeptSelect').value;

    if (!deptName) { alert('부서 명칭을 입력하세요.'); return; }
    const payload = { dept_name: deptName, parent_id: parentId ? parseInt(parentId) : null };
    let url = mode === 'edit' ? `/api/tree/departments/${deptId}` : '/api/tree/departments';
    let method = mode === 'edit' ? 'PUT' : 'POST';

    try {
        const response = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await response.json();
        if (result.success) {
            closeDeptModal();
            fetchDepartments();
        } else { alert('오류: ' + result.message); }
    } catch (error) { alert('통신 중 오류가 발생했습니다.'); }
}

async function deleteDept(deptId, deptName) {
    if (!confirm(`정말로 [${deptName}] 부서를 삭제하시겠습니까?`)) return;
    try {
        const response = await fetch(`/api/tree/departments/${deptId}`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) {
            fetchDepartments();
            if (currentDeptId === deptId) {
                currentDeptId = null;
                document.getElementById('selectedAreaName').innerText = '선택된 부서가 없습니다.';
                document.getElementById('employeeTableBody').innerHTML = '<tr><td colspan="7" class="table-td-center py-10 text-gray-400">부서를 선택해주세요.</td></tr>';
            }
        } else { alert('삭제 불가: ' + result.message); }
    } catch (error) { alert('통신 중 오류가 발생했습니다.'); }
}

// ===============================================
// 부서장 임명 / 해제 / 상위 겸임 표시
// ===============================================
async function loadDeptManager(deptId) {
    const bar = document.getElementById('deptManagerBar');
    bar.classList.remove('hidden');
    const info = document.getElementById('deptManagerInfo');
    const dismissBtn = document.getElementById('btnDismissManager');
    const fallbackToggle = document.getElementById('fallbackToggle');

    try {
        const response = await fetch(`/api/tree/departments/${deptId}/manager`);
        const data = await response.json();

        fallbackToggle.checked = !!data.use_fallback;

        if (data.manager) {
            const m = data.manager;
            const rank = m.rank || '-';
            if (data.is_inherited) {
                // 직접 임명자가 없어 상위 부서장을 대체 표시
                info.innerHTML = `[${rank}] <b>${m.name}</b> <span class="text-amber-600 text-xs">(상위 겸임 · ${data.source_dept_name})</span>`;
                dismissBtn.classList.add('hidden');
            } else {
                info.innerHTML = `[${rank}] <b class="text-indigo-700">${m.name}</b>`;
                dismissBtn.classList.remove('hidden');
            }
        } else {
            info.innerHTML = `<span class="text-gray-400">미지정</span>`;
            dismissBtn.classList.add('hidden');
        }
    } catch (e) {
        info.innerHTML = `<span class="text-red-400">조회 실패</span>`;
    }
}

async function openManagerModal() {
    if (!currentDeptId) return;
    const select = document.getElementById('managerCandidateSelect');
    select.innerHTML = '<option value="">-- 직원 선택 --</option>';
    try {
        const response = await fetch(`/api/tree/departments/${currentDeptId}/manager-candidates`);
        const candidates = await response.json();
        if (candidates.length === 0) {
            alert('이 부서 및 하위 부서에 소속된 직원이 없어 부서장을 지정할 수 없습니다.');
            return;
        }
        candidates.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.innerText = `${c.name} [${c.rank || '-'}] - ${c.dept_name}`;
            select.appendChild(opt);
        });
        document.getElementById('managerModal').classList.remove('hidden');
    } catch (e) {
        alert('후보 직원 목록을 불러오지 못했습니다.');
    }
}

function closeManagerModal() {
    document.getElementById('managerModal').classList.add('hidden');
}

async function submitManager() {
    const empId = document.getElementById('managerCandidateSelect').value;
    if (!empId) { alert('임명할 직원을 선택하세요.'); return; }
    try {
        const response = await fetch(`/api/tree/departments/${currentDeptId}/manager`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emp_id: empId })
        });
        const result = await response.json();
        if (result.success) {
            closeManagerModal();
            loadDeptManager(currentDeptId);
        } else { alert('오류: ' + result.message); }
    } catch (e) { alert('통신 중 오류가 발생했습니다.'); }
}

async function dismissManager() {
    if (!confirm('이 부서의 부서장을 해제하시겠습니까?')) return;
    try {
        const response = await fetch(`/api/tree/departments/${currentDeptId}/manager`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) {
            loadDeptManager(currentDeptId);
        } else { alert('오류: ' + result.message); }
    } catch (e) { alert('통신 중 오류가 발생했습니다.'); }
}

async function toggleFallback() {
    const enabled = document.getElementById('fallbackToggle').checked;
    try {
        await fetch(`/api/tree/departments/${currentDeptId}/fallback`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: enabled })
        });
        loadDeptManager(currentDeptId);
    } catch (e) { alert('설정 변경 중 오류가 발생했습니다.'); }
}