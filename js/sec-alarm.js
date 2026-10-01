/**
 * js/sec-alarm.js
 * 🔔 경비실 경보음 — 처리할 일이 생기면 소리로 알린다.
 *
 * 왜 필요한가
 *   경비실 화면은 3초마다 스스로 갱신되지만, 화면을 보고 있지 않으면 알 수가 없다.
 *   승인 대기·퇴실 지연이 생긴 순간에 소리를 내서 태블릿을 쳐다보게 만든다.
 *
 * 설계
 *   화면 곳곳에서 소리를 내지 않는다. 각 목록 로더는 '지금 몇 건인지'만 보고하고(report),
 *   울릴지 말지는 여기서만 판단한다.
 *     → 감시 대상을 늘릴 때 report() 한 줄만 추가하면 된다.
 *     → '언제 멈추는가' 같은 규칙이 한 곳에 모인다.
 *
 *   건수가 '늘어난 순간'에만 울린다. 계속 N건이면 다시 울리지 않는다.
 *   (대기 건이 남아 있다고 계속 울리면 경비가 소리를 꺼버린다)
 *
 * 음원
 *   audio/sec-alert.mp3 가 있으면 그 소리로, 없으면 코드로 만든 합성음으로 울린다.
 *   파일만 넣으면 교체되므로 운영 중 음원 변경에 서버 수정이 필요 없다.
 */
(function () {
    'use strict';

    // 음원 후보 — 앞에서부터 재생해 보고 되는 것을 쓴다.
    const ALARM_SOURCES = ['/audio/sec-alert.mp3', '/audio/sec-alert.wav'];

    const REPEAT_MS = 3000;     // 반복 간격. 확인할 때까지 계속 울린다.
    const LS_ENABLED = 'sec_alarm_enabled';
    const LS_VOLUME  = 'sec_alarm_volume';

    // 감시 대상. key → 화면에 띄울 이름.
    const WATCH_LABELS = {
        queue:   '승인 대기',
        overdue: '퇴실 지연',
        pass:    '출입권 신청',
    };

    const counts = {};          // 마지막으로 보고받은 건수
    let repeatTimer = null;
    let ringing = false;
    let reasons = [];           // 이번에 울린 이유(여러 개가 동시에 생길 수 있다)
    let audioEl = null;
    let audioCtx = null;
    let unlocked = false;       // 브라우저 자동재생 차단이 풀렸는가
    let acked = false;          // '정지'를 눌러 수동으로 끈 상태

    /* ── 설정 ───────────────────────────────────────────────────────── */

    function isEnabled() {
        return localStorage.getItem(LS_ENABLED) !== '0';   // 기본 켜짐
    }
    function setEnabled(on) {
        localStorage.setItem(LS_ENABLED, on ? '1' : '0');
        if (!on) stop();
        renderBar();
    }
    function getVolume() {
        const v = parseFloat(localStorage.getItem(LS_VOLUME));
        return (isNaN(v) || v < 0 || v > 1) ? 1 : v;
    }
    function setVolume(v) {
        localStorage.setItem(LS_VOLUME, String(v));
        if (audioEl) audioEl.volume = v;
        renderBar();
    }

    /* ── 소리 ───────────────────────────────────────────────────────── */

    /* 음원 후보를 순서대로 '실제로 있는지' 확인해 첫 번째로 존재하는 파일을 쓴다.
       new Audio(src) 는 파일이 없어도 객체가 만들어지고 error 는 나중에 비동기로 뜬다.
       그래서 만들어 보고 판단하면 다음 후보로 못 넘어간다 → HEAD 로 먼저 확인한다.
       결과는 한 번만 구하고 캐시한다(audioEl: Audio=파일사용 / false=합성음). */
    let audioResolving = null;
    function resolveAudio() {
        if (audioResolving) return audioResolving;
        audioResolving = (async function () {
            for (const src of ALARM_SOURCES) {
                try {
                    const res = await fetch(src, { method: 'HEAD', cache: 'no-store' });
                    if (!res.ok) continue;
                    const a = new Audio(src);
                    a.preload = 'auto';
                    a.volume = getVolume();
                    audioEl = a;
                    renderBar();
                    return a;
                } catch (e) { /* 다음 후보로 */ }
            }
            audioEl = false;        // 전부 없음 → 합성음
            renderBar();
            return false;
        })();
        return audioResolving;
    }

    /** 음원 파일이 없을 때 쓰는 합성 경보음 — 파일 없이도 소리는 반드시 나게 한다. */
    function beep() {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const vol = getVolume();
            // 삐- 삐- 두 번. 경비실 소음 속에서도 들리도록 고음(880/1175Hz)을 쓴다.
            [0, 0.35].forEach((offset, i) => {
                const t0 = audioCtx.currentTime + offset;
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'square';
                osc.frequency.setValueAtTime(i === 0 ? 880 : 1175, t0);
                gain.gain.setValueAtTime(0.0001, t0);
                gain.gain.exponentialRampToValueAtTime(0.35 * vol, t0 + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
                osc.connect(gain); gain.connect(audioCtx.destination);
                osc.start(t0); osc.stop(t0 + 0.3);
            });
            return true;
        } catch (e) {
            return false;
        }
    }

    function playOnce() {
        resolveAudio();                 // 아직이면 백그라운드로 확인 시작
        const a = audioEl;
        if (a) {                        // null(확인 전)·false(파일 없음)면 합성음
            try {
                a.currentTime = 0;
                a.volume = getVolume();
                const p = a.play();
                if (p && p.catch) p.catch(() => { beep(); });   // 재생 차단 시 합성음
                return;
            } catch (e) { /* 아래 합성음으로 */ }
        }
        beep();
    }

    /* ── 자동재생 차단 해제 ─────────────────────────────────────────── */

    /* 브라우저는 사용자가 한 번이라도 조작하기 전에는 소리를 막는다.
       경비실 화면은 로그인 후 어딘가는 누르게 되므로, 첫 조작에서 조용히 풀어 둔다.
       (풀어 두지 않으면 정작 울려야 할 때 차단당한다) */
    function unlock() {
        if (unlocked) return;
        unlocked = true;
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
        } catch (e) { /* 무시 */ }
        resolveAudio().then(function (a) {
            if (!a) return;
            const v = a.volume;
            a.volume = 0;                      // 소리 없이 한 번 틀어 권한만 얻는다
            const p = a.play();
            if (p && p.then) p.then(() => { a.pause(); a.currentTime = 0; a.volume = v; })
                             .catch(() => { a.volume = v; });
            else { a.pause(); a.volume = v; }
        });
        renderBar();
    }
    ['click', 'keydown', 'touchstart'].forEach(ev =>
        document.addEventListener(ev, unlock, { once: true, capture: true }));

    /* ── 울리기 / 멈추기 ────────────────────────────────────────────── */

    function start(why) {
        if (!isEnabled()) return;
        reasons = why;
        if (ringing) { renderBar(); return; }
        ringing = true;
        acked = false;
        playOnce();
        repeatTimer = setInterval(playOnce, REPEAT_MS);
        renderBar();
    }

    function stop() {
        ringing = false;
        reasons = [];
        if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
        if (audioEl) { try { audioEl.pause(); audioEl.currentTime = 0; } catch (e) {} }
        renderBar();
    }

    /** '정지' 버튼 — 지금 소리만 끈다. 새 건이 들어오면 다시 울린다. */
    function acknowledge() {
        acked = true;
        stop();
    }

    /* ── 각 목록이 건수를 알려주는 입구 ─────────────────────────────── */

    /**
     * @param {string} key   WATCH_LABELS 의 키
     * @param {number} value 현재 건수
     */
    function report(key, value) {
        const n = Number(value) || 0;
        const prev = counts[key];
        counts[key] = n;

        // 첫 보고는 기준값만 잡는다. (화면을 열자마자 쌓여 있던 건으로 울리면 곤란하다)
        if (prev === undefined) { renderBar(); return; }

        if (n > prev) {
            // 늘어났다 → 새 일거리. 수동 정지 상태였어도 다시 울린다.
            acked = false;
            start(pendingReasons());
        } else if (totalPending() === 0) {
            // 전부 처리됨 → 자동으로 멈춘다
            stop();
        } else {
            renderBar();
        }
    }

    function totalPending() {
        return Object.keys(WATCH_LABELS).reduce((s, k) => s + (counts[k] || 0), 0);
    }
    function pendingReasons() {
        return Object.keys(WATCH_LABELS)
            .filter(k => (counts[k] || 0) > 0)
            .map(k => `${WATCH_LABELS[k]} ${counts[k]}건`);
    }


    /* ═══════════════════════════════════════════════════════════════
       🔔 웹 푸시 — 브라우저를 닫아 둬도 알림이 오게 한다.
       화면 경보음은 이 화면이 떠 있을 때만 울린다. PC 로 다른 업무를 보거나
       태블릿을 꺼둔 상황은 푸시가 담당한다. 둘은 역할이 다르므로 함께 쓴다.

       ⚠️ HTTPS 에서만 동작한다(localhost 는 예외). 사내망 HTTP 로 접속하면
          브라우저가 서비스워커 등록을 막는다 → 상태 바에 그 사실을 표시한다.
       ═══════════════════════════════════════════════════════════════ */

    let pushState = 'init';   // init | unsupported | insecure | off | on | denied | error
    let pushReg = null;

    function b64ToU8(base64) {
        const pad = '='.repeat((4 - base64.length % 4) % 4);
        const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
        return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
    }

    /** 구독이 어떤 서버 공개키로 만들어졌는지 — 서버 키가 바뀌었는지 판별하는 데 쓴다. */
    function subKeyOf(sub) {
        try {
            const raw = sub.options && sub.options.applicationServerKey;
            if (!raw) return '';
            return btoa(String.fromCharCode(...new Uint8Array(raw)))
                .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        } catch (e) { return ''; }
    }

    async function pushInit() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            pushState = 'unsupported'; renderBar(); return;
        }
        if (!window.isSecureContext) {
            // HTTP 사내망 → 푸시 불가. 조용히 넘어가면 '왜 알림이 안 오지'로 이어진다.
            pushState = 'insecure'; renderBar(); return;
        }
        try {
            pushReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            let sub = await pushReg.pushManager.getSubscription();

            /* 🔑 서버 키가 바뀌었으면 기존 구독은 못 쓴다.
               구독은 '구독할 때의 서버 공개키'에 묶여 있어, 키가 바뀌면 전송이 403 으로 거부된다.
               그런데 브라우저 쪽 구독은 멀쩡해 보여서 '푸시 켜짐'인 채로 알림만 안 온다.
               → 접속할 때마다 서버 키와 대조해, 다르면 조용히 다시 구독한다. */
            if (sub) {
                try {
                    const srv = await (await fetch('/api/push/key')).json();
                    if (srv.enabled && srv.key && subKeyOf(sub) !== srv.key) {
                        console.info('[푸시] 서버 키가 바뀌어 구독을 갱신합니다.');
                        await fetch('/api/push/unsubscribe', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ endpoint: sub.endpoint }),
                        });
                        await sub.unsubscribe();
                        sub = await pushReg.pushManager.subscribe({
                            userVisibleOnly: true,
                            applicationServerKey: b64ToU8(srv.key),
                        });
                    }
                } catch (e) { /* 키 확인 실패 → 기존 구독 유지 */ }
            }

            pushState = sub ? 'on' : (Notification.permission === 'denied' ? 'denied' : 'off');
            if (sub) await sendSubscription(sub);   // 서버 재시작·DB 교체 대비 재등록
        } catch (e) {
            pushState = 'error';
            console.warn('[푸시] 초기화 실패', e);
        }
        renderBar();

        // 서비스워커가 푸시를 받으면 이 탭에도 알려 준다 → 큰 경보음은 여기서 울린다
        navigator.serviceWorker.addEventListener('message', function (ev) {
            const m = ev.data || {};
            if (m.type === 'sec-push') start([(m.data && m.data.body) || '새 알림']);
            if (m.type === 'sec-push-click') acknowledge();
        });
    }

    async function sendSubscription(sub) {
        try {
            await fetch('/api/push/subscribe', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription: sub.toJSON() }),
            });
        } catch (e) { /* 다음 접속 때 다시 보낸다 */ }
    }

    async function pushEnable() {
        try {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') { pushState = 'denied'; renderBar(); return; }

            const res = await (await fetch('/api/push/key')).json();
            if (!res.enabled || !res.key) {
                alert('서버에서 푸시가 비활성 상태입니다. 관리자에게 문의해 주세요.');
                return;
            }
            const sub = await pushReg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: b64ToU8(res.key),
            });
            await sendSubscription(sub);
            pushState = 'on';
        } catch (e) {
            pushState = 'error';
            console.warn('[푸시] 구독 실패', e);
        }
        renderBar();
    }

    async function pushDisable() {
        try {
            const sub = pushReg && await pushReg.pushManager.getSubscription();
            if (sub) {
                await fetch('/api/push/unsubscribe', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: sub.endpoint }),
                });
                await sub.unsubscribe();
            }
            pushState = 'off';
        } catch (e) { pushState = 'error'; }
        renderBar();
    }

    async function pushTest() {
        const r = await (await fetch('/api/push/test', { method: 'POST' })).json();
        alert(r.sent ? `${r.sent}개 기기로 테스트 알림을 보냈습니다.`
                     : '전송 대상이 없습니다. 먼저 "푸시 켜기"를 눌러 주세요.');
    }

    const PUSH_TEXT = {
        on:          ['푸시 켜짐',            'ok'],
        off:         ['푸시 꺼짐',            'warn'],
        denied:      ['푸시 차단됨(브라우저 설정)', 'warn'],
        insecure:    ['푸시 불가(HTTPS 아님)',  'warn'],
        unsupported: ['푸시 미지원 브라우저',    'warn'],
        error:       ['푸시 오류',            'warn'],
        init:        ['', ''],
    };

    /* ── 상태 표시줄 UI ─────────────────────────────────────────────── */

    function renderBar() {
        const host = document.getElementById('secAlarmHost');
        if (!host) return;
        const on = isEnabled();
        const total = totalPending();

        let state, cls;
        if (!on)            { state = '알림음 꺼짐';  cls = 'off'; }
        else if (ringing)   { state = pendingReasons().join(' · '); cls = 'ring'; }
        else if (acked && total > 0) { state = `정지됨 · 대기 ${total}건`; cls = 'acked'; }
        else if (!unlocked) { state = '화면을 한 번 누르면 소리가 켜집니다'; cls = 'locked'; }
        else                { state = '알림음 대기 중'; cls = 'idle'; }

        // 푸시 상태 — 소리(이 화면)와 푸시(화면 밖)는 역할이 달라 따로 표시한다
        const [pTxt, pCls] = PUSH_TEXT[pushState] || ['', ''];
        const canToggle = (pushState === 'on' || pushState === 'off');
        const pushHtml = !pTxt ? '' : `
            <span class="sec-alarm-sep">|</span>
            <span class="sec-alarm-push sec-alarm-push-${pCls}">${pTxt}</span>
            ${canToggle ? `<button type="button" class="sec-alarm-btn sec-alarm-btn-sub"
                    onclick="secAlarm.${pushState === 'on' ? 'pushDisable' : 'pushEnable'}()"
                    >${pushState === 'on' ? '푸시 끄기' : '푸시 켜기'}</button>` : ''}
            ${pushState === 'on' ? `<button type="button" class="sec-alarm-btn sec-alarm-btn-sub"
                    onclick="secAlarm.pushTest()">알림 테스트</button>` : ''}`;

        host.className = 'sec-alarm-bar sec-alarm-' + cls;
        host.innerHTML = `
            <span class="sec-alarm-dot"></span>
            <span class="sec-alarm-text">${state}</span>
            ${ringing ? '<button type="button" class="sec-alarm-btn" onclick="secAlarm.acknowledge()">정지</button>' : ''}
            <button type="button" class="sec-alarm-btn sec-alarm-btn-sub"
                    onclick="secAlarm.setEnabled(${on ? 'false' : 'true'})">${on ? '끄기' : '켜기'}</button>
            <button type="button" class="sec-alarm-btn sec-alarm-btn-sub"
                    onclick="secAlarm.test()">소리 확인</button>
            ${pushHtml}`;
    }

    /* ── 공개 API ───────────────────────────────────────────────────── */

    resolveAudio();     // 미리 확인해 두면 첫 경보부터 음원 파일로 울린다
    pushInit();         // 서비스워커 등록 + 기존 구독 확인

    window.secAlarm = {
        report: report,
        acknowledge: acknowledge,
        setEnabled: setEnabled,
        setVolume: setVolume,
        isEnabled: isEnabled,
        test: function () { unlock(); playOnce(); },
        render: renderBar,
        pushEnable: pushEnable,
        pushDisable: pushDisable,
        pushTest: pushTest,
        pushState: function () { return pushState; },
        // 점검용
        _state: function () {
            return { counts: Object.assign({}, counts), ringing, acked, unlocked,
                     usingFile: audioEl !== false };
        },
    };
})();
