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

    window.openVisitorHistory = function (name, contact) {
        contact = contact || '';
        const exist = document.getElementById('vh-overlay');
        if (exist) exist.remove();

        const overlay = document.createElement('div');
        overlay.id = 'vh-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;';
        overlay.innerHTML =
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

        ['1주', '1달', '3달', '6달', '1년', '전체'].forEach(key => {
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
                    '<td style="padding:0.5rem 0.4rem;white-space:nowrap;color:#059669;">' + esc(v.checkin_time || '-') + '</td>' +
                    '<td style="padding:0.5rem 0.4rem;white-space:nowrap;color:#dc2626;">' + esc(v.checkout_time || '-') + '</td>' +
                    '<td style="padding:0.5rem 0.4rem;white-space:nowrap;font-weight:700;">' + esc(v.status || '-') + '</td>' +
                    '</tr>';
            }).join('');
            bodyEl.innerHTML =
                '<p style="margin:0.6rem 0;color:#334155;font-weight:700;">총 ' + list.length + '건</p>' +
                '<div style="overflow-x:auto;">' +
                    '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;min-width:34rem;">' +
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

        // 기본: 전체 이력
        startEl.value = '';
        endEl.value = '';
        highlight(rangesEl.querySelector('button:last-child'));   // '전체' 강조
        load();
    };
})();
