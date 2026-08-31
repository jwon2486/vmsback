/**
 * js/i18n.js
 * 손님(방문객) 화면 다국어 — 한국어 / English / 中文
 *
 * 설계 메모
 *  - 적용 범위는 '손님 화면'뿐이다. 경비실·임직원·관리자 화면은 대상이 아니다.
 *  - 문자열은 키로만 참조한다(t('key')). 화면 코드에 한글을 직접 박지 않는다.
 *  - 사전은 lang/{code}.json 으로 분리돼 있고, 필요한 언어만 받아온다.
 *    → 언어를 추가할 때 lang/xx.json 을 만들고 GUEST_LANGS 에 한 줄만 넣으면 된다.
 *      (화면 코드는 손대지 않는다)
 *  - 번역이 없으면 한국어로 폴백한다. 그래서 ko 는 항상 함께 불러 둔다.
 *  - 선택한 언어는 localStorage 에 남겨 다음 방문에도 유지한다.
 */

const GUEST_LANGS = [
    { code: 'ko', label: '한국어' },
    { code: 'en', label: 'English' },
    { code: 'zh', label: '中文' },
];

const GUEST_LANG_KEY = 'guest_lang';

// 저장값 → 브라우저 언어 → 한국어 순으로 결정한다.
function getGuestLang() {
    const saved = localStorage.getItem(GUEST_LANG_KEY);
    if (saved && GUEST_LANGS.some(l => l.code === saved)) return saved;
    const nav = (navigator.language || '').toLowerCase();
    if (nav.startsWith('zh')) return 'zh';
    if (nav.startsWith('en')) return 'en';
    return 'ko';
}

const I18N_FALLBACK = 'ko';

// 받아온 사전 캐시. { ko: {...}, en: {...} } — 한 번 받은 언어는 다시 받지 않는다.
const I18N = {};

/**
 * 사전 파일을 받아 캐시에 넣는다. 이미 있으면 그대로 둔다.
 * 실패해도 예외를 던지지 않는다 — 폴백(ko)이 있으면 화면은 그려진다.
 */
async function loadGuestDict(code) {
    if (I18N[code]) return I18N[code];
    try {
        const res = await fetch(`/lang/${code}.json`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(res.status);
        I18N[code] = await res.json();
    } catch (e) {
        console.warn(`[i18n] '${code}' 사전을 불러오지 못했습니다.`, e);
        I18N[code] = {};
    }
    return I18N[code];
}

/** 화면을 그리기 전에 호출한다. 폴백(ko) + 현재 언어를 함께 준비한다. */
async function initGuestI18n() {
    const lang = getGuestLang();
    await Promise.all([loadGuestDict(I18N_FALLBACK), loadGuestDict(lang)]);
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
}

async function setGuestLang(code) {
    if (!GUEST_LANGS.some(l => l.code === code)) return;
    localStorage.setItem(GUEST_LANG_KEY, code);
    document.documentElement.lang = code === 'zh' ? 'zh-CN' : code;
    await loadGuestDict(code);      // 처음 고른 언어면 여기서 받아온다
    rerenderGuestView();
}

/**
 * 번역 조회. t('key') 또는 t('key', {name: '홍길동'})
 *  - {name} 자리표시자를 치환한다.
 *  - 키가 없으면 한국어 → 그래도 없으면 키 자체를 돌려준다(빈 화면 방지).
 */
function t(key, vars) {
    const lang = getGuestLang();
    const cur = I18N[lang] || {};
    const fb = I18N[I18N_FALLBACK] || {};
    let s = cur[key] || fb[key] || key;
    if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
}

/**
 * 거점(사업장) 저장값 → 화면 표시용 문구.
 *  - 저장·전송 값은 서버·경비실이 쓰는 한글 거점명('테크센터' 등)을 그대로 두고,
 *    손님에게 보일 때만 번역한다.
 *  - QR 로 거점이 확정된 경우 currentRegion 이 한글 원본이라 그대로 쓰면 문장에 한글이 섞인다.
 *  - 목록에 없는 값이면 원문을 그대로 보여 준다(거점이 추가돼도 깨지지 않게).
 */
function regionLabel(v) {
    const map = {
        '테크센터': 'region.tech',
        '에코센터': 'region.eco',
        '평택공장': 'region.pyeongtaek',
        '거제 오션센터': 'region.geoje',
    };
    return map[v] ? t(map[v]) : v;
}

/**
 * 서버 응답의 안내 문구를 손님 언어로 돌려준다.
 *  - 서버는 message(한국어)와 함께 message_key(+message_vars)를 보낸다.
 *    경비실·임직원 화면은 message 를 그대로 쓰므로 서버는 언어를 몰라도 된다.
 *  - 키가 없거나 사전에 없으면 서버가 준 한국어 문구를 그대로 쓴다(문구 유실 방지).
 */
function srvMsg(d, fallbackKey) {
    if (!d) return fallbackKey ? t(fallbackKey) : '';
    if (d.message_key) {
        const s = t(d.message_key, srvVars(d.message_vars));
        if (s !== d.message_key) return s;      // 사전에 있으면 번역문
    }
    return d.message || (fallbackKey ? t(fallbackKey) : '');
}

/**
 * 서버가 보낸 치환값 중 '저장값(한글)'인 것을 화면 표시용으로 바꾼다.
 * 서버는 언어를 모르므로 거점명을 저장값 그대로 보낸다
 * → 번역문에 그대로 끼워 넣으면 문장 안에 한글만 남는다.
 * 여기 없는 이름(detail 등)은 손대지 않는다.
 */
function srvVars(vars) {
    if (!vars) return vars;
    const out = Object.assign({}, vars);
    if (out.region) out.region = regionLabel(out.region);
    return out;
}

/* ── 현재 화면 기억 → 언어 전환 시 같은 화면을 다시 그린다 ──────────────
   손님 화면은 각 함수가 #app-card 를 통째로 다시 그리는 구조라,
   '마지막에 그린 함수와 인자'만 들고 있으면 그대로 재호출할 수 있다.
   (새로고침을 쓰면 입력 중이던 폼 값이 날아가고 QR 토큰 화면도 다시 타야 한다) */
let guestCurrentView = null;

function markGuestView(fn, ...args) {
    guestCurrentView = { fn, args };
}

function rerenderGuestView() {
    renderGuestLangSelector();
    // 헤더 부제도 함께 바꾼다 (제품명 'S&SYS VMS' 는 고유명이라 번역하지 않는다)
    const sub = document.getElementById('guest-brand-sub');
    if (sub) sub.textContent = t('app.sub');
    if (guestCurrentView && typeof guestCurrentView.fn === 'function') {
        guestCurrentView.fn(...guestCurrentView.args);
    }
}

/* ── 언어 선택 UI ────────────────────────────────────────────────────
   손님 화면 헤더 아래에 붙인다. 세 언어뿐이라 드롭다운 대신 버튼으로 두어
   한 번에 눌러 바꿀 수 있게 한다(외국인 방문객이 메뉴를 찾지 않아도 되게). */
function guestLangSelectorHtml() {
    const cur = getGuestLang();
    return `<div class="guest-lang-bar">
        <label class="guest-lang-label" for="guestLangSelect">🌐</label>
        <select id="guestLangSelect" class="guest-lang-select"
                aria-label="Language / 언어 / 语言"
                onchange="setGuestLang(this.value)">
            ${GUEST_LANGS.map(l =>
                `<option value="${l.code}"${l.code === cur ? ' selected' : ''}>${l.label}</option>`).join('')}
        </select>
    </div>`;
}

// 헤더 영역에 선택 바를 넣거나 갱신한다. (손님 화면에서만 호출)
function renderGuestLangSelector() {
    const host = document.getElementById('guest-lang-host');
    if (host) host.innerHTML = guestLangSelectorHtml();
}
