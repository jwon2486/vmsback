/**
 * js/visitor-history.js
 * 방문 이력 팝업 (관리자/경비실 공용) — 자립형, 인라인 스타일이라 어느 페이지 CSS에도 의존하지 않음.
 * 사용: openVisitorHistory(name, contact)
 */
(function () {
    function fmt(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function rangeStart(key) {
        const t = new Date();
        const d = new Date(t.getFullYear(), t.getMonth(), t.getDate());
        if (key === '오늘') return fmt(d);
        if (key === '1주') d.setDate(d.getDate() - 7);
        else if (key === '1달') d.setMonth(d.getMonth() - 1);
        else if (key === '3달') d.setMonth(d.getMonth() - 3);
        else if (key === '6달') d.setMonth(d.getMonth() - 6);
        else if (key === '1년') d.setFullYear(d.getFullYear() - 1);
        else return '';   // 전체
        return fmt(d);
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    // 'YYYY-MM-DD HH:MM:SS' → 'HH:MM:SS' 만. 방문일 컬럼에 날짜가 있어 입·퇴실은 시간만 표시.
    function timeOnly(val) {
        if (!val) return '-';
        const p = String(val).trim().split(' ');
        return p.length > 1 ? p[p.length - 1] : val;
    }

    // 연락처 표시용 포맷: 숫자만 저장된 번호에 하이픈을 넣어 가독성을 높인다. (표시 전용)
    //  - 관리자/경비실/손님/임직원 모든 화면 공용. admin.html·guest.html 양쪽이 이 파일을 로드한다.
    //  - 조회 매칭 키(openVisitorHistory 등)로 쓰는 값은 원본(숫자)을 그대로 사용해야 한다.
    //  - 예상 밖 길이는 원본을 그대로 반환(깨지 않음), 값이 없으면 '-'.
    window.formatPhone = function (raw) {
        if (!raw) return '-';
        const d = String(raw).replace(/\D/g, '');
        if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;      // 010-1234-5678
        if (d.length === 10) {
            return d.startsWith('02')
                ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`                          // 02-1234-5678
                : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;                          // 031-123-4567
        }
        if (d.length === 9 && d.startsWith('02')) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`; // 02-123-4567
        return raw;
    };

    window.openVisitorHistory = function (name, contact) {
        contact = contact || '';
        const exist = document.getElementById('vh-overlay');
        if (exist) exist.remove();

        const overlay = document.createElement('div');
        overlay.id = 'vh-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;';
        overlay.innerHTML =
            // 🛡️ 방어 스타일: 자립형 팝업이 어느 페이지의 표 변환(예: admin.css 의 ≤768px 카드형
            //    'table/td{display:block}', 'thead tr{position:absolute}', 'td::before{content:라벨}')에도
            //    영향받지 않도록 팝업 내부 표를 항상 정상 테이블로 강제하고 주입 라벨(::before)을 제거한다.
            '<style>' +
                '#vh-overlay table{display:table !important;width:100% !important;}' +
                '#vh-overlay thead{display:table-header-group !important;}' +
                '#vh-overlay tbody{display:table-row-group !important;}' +
                '#vh-overlay tr{display:table-row !important;position:static !important;margin:0 !important;padding:0 !important;border:none !important;box-shadow:none !important;background:transparent !important;}' +
                '#vh-overlay thead tr{position:static !important;top:auto !important;left:auto !important;}' +
                '#vh-overlay th,#vh-overlay td{display:table-cell !important;width:auto !important;}' +
                '#vh-overlay td::before,#vh-overlay th::before{content:none !important;display:none !important;}' +
                // 색상·굵기·정렬·구분선 누수 중화(예: admin.css td:nth-of-type 색/굵기). 두 ID 스코프로 우선하되
                // non-important 라서 셀 자체 인라인 색(입실 초록/퇴실 빨강)은 그대로 유지된다.
                '#vh-overlay #vh-body td{color:#334155;font-weight:400;font-size:1rem;text-align:left;vertical-align:middle;border:none;border-bottom:1px solid #f1f5f9;}' +
                '#vh-overlay #vh-body th{color:#475569;font-weight:700;text-align:left;border:none;}' +
            '</style>' +
            '<div style="background:#fff;border-radius:14px;width:100%;max-width:680px;max-height:86vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,0.3);font-family:inherit;">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid #e2e8f0;">' +
                    '<h3 style="margin:0;font-size:1.1rem;font-weight:800;color:#0f172a;">🧾 방문 이력 — ' + esc(name) + '</h3>' +
                    '<button id="vh-close" style="border:none;background:transparent;font-size:1.3rem;cursor:pointer;color:#64748b;line-height:1;">✖</button>' +
                '</div>' +
                '<div style="padding:0.9rem 1.25rem;border-bottom:1px solid #f1f5f9;">' +
                    '<div id="vh-ranges" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:0.6rem;"></div>' +
                    '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;">' +
                        '<input type="date" id="vh-start" style="padding:0.4rem 0.5rem;border:1px solid #cbd5e1;border-radius:8px;font-size:0.9rem;">' +
                        '<span style="color:#94a3b8;">~</span>' +
                        '<input type="date" id="vh-end" style="padding:0.4rem 0.5rem;border:1px solid #cbd5e1;border-radius:8px;font-size:0.9rem;">' +
                        '<button id="vh-search" style="padding:0.45rem 0.9rem;border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.9rem;">조회</button>' +
                    '</div>' +
                '</div>' +
                '<div id="vh-body" style="padding:0.5rem 1.25rem 1.25rem;overflow:auto;flex:1;"></div>' +
            '</div>';
        document.body.appendChild(overlay);

        const startEl = overlay.querySelector('#vh-start');
        const endEl = overlay.querySelector('#vh-end');
        const bodyEl = overlay.querySelector('#vh-body');
        const rangesEl = overlay.querySelector('#vh-ranges');
        const today = fmt(new Date());

        ['오늘', '1주', '1달', '1년', '전체'].forEach(key => {
            const b = document.createElement('button');
            b.textContent = key;
            b.style.cssText = 'padding:0.4rem 0.7rem;border:1px solid #cbd5e1;background:#fff;border-radius:20px;cursor:pointer;font-size:0.85rem;color:#475569;';
            b.onclick = () => {
                startEl.value = rangeStart(key);
                endEl.value = (key === '전체') ? '' : today;
                highlight(b);
                load();
            };
            rangesEl.appendChild(b);
        });
        function highlight(active) {
            rangesEl.querySelectorAll('button').forEach(x => { x.style.background = '#fff'; x.style.color = '#475569'; x.style.borderColor = '#cbd5e1'; });
            if (active) { active.style.background = '#2563eb'; active.style.color = '#fff'; active.style.borderColor = '#2563eb'; }
        }

        async function load() {
            bodyEl.innerHTML = '<p style="color:#64748b;padding:1.2rem 0;text-align:center;">불러오는 중...</p>';
            const params = new URLSearchParams({ name: name, contact: contact });
            if (startEl.value) params.set('start_date', startEl.value);
            if (endEl.value) params.set('end_date', endEl.value);
            try {
                const res = await fetch('/api/visitor/history?' + params.toString());
                const d = await res.json();
                if (!d || !d.success) { bodyEl.innerHTML = '<p style="color:#ef4444;padding:1.2rem 0;text-align:center;">조회 권한이 없거나 실패했습니다.</p>'; return; }
                renderRows(d.list || []);
            } catch (e) {
                bodyEl.innerHTML = '<p style="color:#ef4444;padding:1.2rem 0;text-align:center;">통신 오류가 발생했습니다.</p>';
            }
        }

        function renderRows(list) {
            if (!list.length) {
                bodyEl.innerHTML = '<p style="color:#64748b;padding:1.5rem 0;text-align:center;">해당 기간에 방문 이력이 없습니다.</p>';
                return;
            }
            const rows = list.map(v => {
                const mgr = v.emp_name ? (esc(v.emp_name) + ' <span style="color:#94a3b8;">(' + esc(v.emp_dept || '-') + ')</span>') : '-';
                return '<tr style="border-bottom:1px solid #f1f5f9;">' +
                    '<td style="padding:0.5rem 0.4rem;white-space:nowrap;">' + esc(v.visit_date) + '</td>' +
                    '<td style="padding:0.5rem 0.4rem;">' + esc(v.company || '-') + '</td>' +
                    '<td style="padding:0.5rem 0.4rem;white-space:nowrap;">' + esc(v.purpose || '-') + '</td>' +
                    '<td style="padding:0.5rem 0.4rem;white-space:nowrap;">' + mgr + '</td>' +
                    '<td style="padding:0.5rem 0.4rem;white-space:nowrap;color:#059669;">' + esc(timeOnly(v.checkin_time)) + '</td>' +
                    '<td style="padding:0.5rem 0.4rem;white-space:nowrap;color:#dc2626;">' + esc(timeOnly(v.checkout_time)) + '</td>' +
                    '<td style="padding:0.5rem 0.4rem;white-space:nowrap;font-weight:700;">' + esc(v.status || '-') + '</td>' +
                    '</tr>';
            }).join('');
            bodyEl.innerHTML =
                '<p style="margin:0.6rem 0;color:#334155;font-weight:700;">총 ' + list.length + '건</p>' +
                '<div style="overflow-x:auto;">' +
                    '<table style="width:100%;border-collapse:collapse;font-size:1rem;min-width:34rem;">' +
                        '<thead><tr style="background:#f8fafc;color:#475569;">' +
                            '<th style="padding:0.55rem 0.4rem;text-align:left;">방문일</th>' +
                            '<th style="padding:0.55rem 0.4rem;text-align:left;">소속</th>' +
                            '<th style="padding:0.55rem 0.4rem;text-align:left;">목적</th>' +
                            '<th style="padding:0.55rem 0.4rem;text-align:left;">담당자</th>' +
                            '<th style="padding:0.55rem 0.4rem;text-align:left;">입실</th>' +
                            '<th style="padding:0.55rem 0.4rem;text-align:left;">퇴실</th>' +
                            '<th style="padding:0.55rem 0.4rem;text-align:left;">상태</th>' +
                        '</tr></thead><tbody>' + rows + '</tbody>' +
                    '</table>' +
                '</div>';
        }

        overlay.querySelector('#vh-close').onclick = () => overlay.remove();
        overlay.querySelector('#vh-search').onclick = () => { highlight(null); load(); };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.addEventListener('keydown', function onEsc(e) { if (e.key === 'Escape') { const o = document.getElementById('vh-overlay'); if (o) o.remove(); document.removeEventListener('keydown', onEsc); } });

        // 기본: 오늘
        startEl.value = today;
        endEl.value = today;
        highlight(rangesEl.querySelector('button'));   // 첫 버튼('오늘') 강조
        load();
    };
})();
