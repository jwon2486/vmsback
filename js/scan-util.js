/**
 * js/scan-util.js
 * 📷 QR 리더기 스캔 공용 유틸 (경비실 대시보드 + 데스크 스캐너 페이지 공용)
 *
 * 하드웨어 리더기는 '키보드처럼 QR 내용을 타이핑하고 Enter' 를 보내는 장치다.
 * 여기서 두 가지 문제가 생기는데, 이 파일이 둘 다 처리한다.
 *
 *  ① 포커스 문제 — 글자를 받아줄 입력칸에 포커스가 없으면 입력이 어디에도 안 들어간다.
 *     → 문서 전체에서 키 입력을 감시하는 캡처 리스너로 해결.
 *
 *  ② 한글 IME 문제 — 입력기가 한글이면 리더기가 보낸 영문이 두벌식 규칙대로 한글이 된다.
 *       예) v → ㅍ,  scan → ㄴㅊ무,  token → 새ㅏ두
 *     → 1차: e.key(입력된 문자) 대신 e.code(눌린 물리 키)로 문자를 복원. e.code 는
 *            IME·키보드 레이아웃과 무관해 한글 상태에서도 정확하다.
 *       2차: 그래도 한글이 들어오면 hangulToQwerty() 로 되돌린다(두벌식은 1:1 대응).
 *
 * ※ 브라우저 주소창에 포커스가 있으면 페이지 밖이라 어떤 방법으로도 가로챌 수 없다.
 */

// 버퍼 초기화 간격. '리더기 속도(수 ms)'로 좁게 잡으면 브라우저가 잠깐 바쁜 순간
// 키 전달이 늦어져 스캔 문자열이 중간에 끊긴다. 넉넉히 잡되, 오탐은 형태 검증으로 막는다.
window.SCAN_RESET_GAP_MS = 500;
window.SCAN_MIN_LENGTH = 6;

// 물리 키(e.code) → 문자. shift 여부에 따라 [기본, Shift] 중 선택.
window.SCAN_KEY_MAP = {
    Digit1: ['1', '!'], Digit2: ['2', '@'], Digit3: ['3', '#'], Digit4: ['4', '$'], Digit5: ['5', '%'],
    Digit6: ['6', '^'], Digit7: ['7', '&'], Digit8: ['8', '*'], Digit9: ['9', '('], Digit0: ['0', ')'],
    Minus: ['-', '_'], Equal: ['=', '+'], BracketLeft: ['[', '{'], BracketRight: [']', '}'],
    Backslash: ['\\', '|'], Semicolon: [';', ':'], Quote: ["'", '"'], Backquote: ['`', '~'],
    Comma: [',', '<'], Period: ['.', '>'], Slash: ['/', '?'], Space: [' ', ' '],
};

window.scanCharFromCode = function (e) {
    const c = e.code || '';
    if (/^Key[A-Z]$/.test(c)) {
        const ch = c.slice(3);
        return e.shiftKey ? ch : ch.toLowerCase();
    }
    if (/^Numpad\d$/.test(c)) return c.slice(6);
    if (c === 'NumpadDecimal') return '.';
    if (c === 'NumpadDivide') return '/';
    if (c === 'NumpadSubtract') return '-';
    const pair = window.SCAN_KEY_MAP[c];
    return pair ? pair[e.shiftKey ? 1 : 0] : null;
};

// 스캔 내용으로 인정할 형태인지 (오탐 방지의 핵심).
//  QR 은 '.../v/scan?token=XXXX' URL 이거나 토큰 문자열 그 자체다.
window.looksLikeScanPayload = function (s) {
    if (/token=[A-Za-z0-9]+/.test(s)) return true;
    return /^[A-Za-z0-9]{8,}$/.test(s);
};

// ── 한글(두벌식) → 영문 역변환 ────────────────────────────────────
const HANGUL_CHO  = ['r','R','s','e','E','f','a','q','Q','t','T','d','w','W','c','z','x','v','g'];
const HANGUL_JUNG = ['k','o','i','O','j','p','u','P','h','hk','ho','hl','y','n','nj','np','nl','b','m','ml','l'];
const HANGUL_JONG = ['','r','R','rt','s','sw','sg','e','f','fr','fa','fq','ft','fx','fv','fg','a','q','qt','t','T','d','w','c','z','x','v','g'];
const HANGUL_JAMO = {
    'ㄱ':'r','ㄲ':'R','ㄳ':'rt','ㄴ':'s','ㄵ':'sw','ㄶ':'sg','ㄷ':'e','ㄸ':'E','ㄹ':'f',
    'ㄺ':'fr','ㄻ':'fa','ㄼ':'fq','ㄽ':'ft','ㄾ':'fx','ㄿ':'fv','ㅀ':'fg','ㅁ':'a','ㅂ':'q',
    'ㅃ':'Q','ㅄ':'qt','ㅅ':'t','ㅆ':'T','ㅇ':'d','ㅈ':'w','ㅉ':'W','ㅊ':'c','ㅋ':'z',
    'ㅌ':'x','ㅍ':'v','ㅎ':'g',
    'ㅏ':'k','ㅐ':'o','ㅑ':'i','ㅒ':'O','ㅓ':'j','ㅔ':'p','ㅕ':'u','ㅖ':'P','ㅗ':'h',
    'ㅘ':'hk','ㅙ':'ho','ㅚ':'hl','ㅛ':'y','ㅜ':'n','ㅝ':'nj','ㅞ':'np','ㅟ':'nl','ㅠ':'b',
    'ㅡ':'m','ㅢ':'ml','ㅣ':'l',
};

window.hangulToQwerty = function (s) {
    let out = '';
    for (const ch of String(s)) {
        const code = ch.charCodeAt(0);
        if (code >= 0xAC00 && code <= 0xD7A3) {          // 완성형 음절 → 초·중·종성 분해
            const i = code - 0xAC00;
            out += HANGUL_CHO[Math.floor(i / 588)]
                 + HANGUL_JUNG[Math.floor((i % 588) / 28)]
                 + HANGUL_JONG[i % 28];
        } else {
            out += (HANGUL_JAMO[ch] !== undefined) ? HANGUL_JAMO[ch] : ch;
        }
    }
    return out;
};

// 한글이 섞여 있으면 영문으로 되돌린다. (전송 직전 마지막 방어선)
window.normalizeScanValue = function (raw) {
    const s = String(raw || '').trim();
    return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(s) ? window.hangulToQwerty(s) : s;
};

/**
 * 전역 스캔 캡처 리스너를 문서에 1회 설치한다.
 * @param {object} opt
 *   opt.key        중복 설치 방지용 식별자
 *   opt.isActive   () => boolean   지금 스캔을 받아야 하는 화면인가
 *   opt.getInput   () => Element   스캔 값이 찍히는 입력칸(있으면 비워 준다)
 *   opt.onScan     (raw) => void   스캔 확정 시 호출
 */
window.installScanCapture = function (opt) {
    const flag = '__scanCaptureBound_' + (opt.key || 'default');
    if (window[flag]) return;
    window[flag] = true;

    let buffer = '';
    let lastTime = 0;

    document.addEventListener('keydown', (e) => {
        if (!opt.isActive()) return;

        const box = opt.getInput ? opt.getInput() : null;
        // 스캔칸 외의 입력칸에 타이핑 중이면 건드리지 않는다.
        //  e.code 로 복원하면 한글 타이핑도 영문처럼 보여, 이름 입력 등이 토큰으로 오인될 수 있다.
        const t = e.target;
        if (t && t !== box &&
            (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
             t.tagName === 'SELECT' || t.isContentEditable)) return;

        const now = Date.now();
        const gap = now - lastTime;
        lastTime = now;

        if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            const raw = buffer.trim();
            buffer = '';
            if (raw.length >= window.SCAN_MIN_LENGTH && window.looksLikeScanPayload(raw)) {
                e.preventDefault();
                e.stopPropagation();          // 입력칸 자체 핸들러 실행 차단(중복 전송 방지)
                if (box) box.value = '';      // 한글로 찍힌 잔여 텍스트 제거
                opt.onScan(raw);
            }
            return;
        }

        const ch = window.scanCharFromCode(e);
        if (ch === null) return;                       // Shift·Tab 등 제어키
        if (gap > window.SCAN_RESET_GAP_MS) buffer = '';   // 한참 만의 입력 = 새 입력 시작
        buffer += ch;
    }, true);   // 캡처 단계: 입력칸 핸들러보다 먼저 실행되어 한글이 찍히기 전에 가로챈다
};
