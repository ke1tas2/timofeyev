/* =============================================================
   api.js — Клиент для Timofeyev Transfer API
   Подключать ПЕРЕД script.js в index.html:
   <script src="api.js?v=1.0.0"></script>
   ============================================================= */

const TF = (function () {

    // ── Конфигурация ──────────────────────────────────────────
    const API_BASE = 'https://calc.timofeev.kz/api';  // ← адрес API
    const TOKEN_KEY = 'tf_token';
    const USER_KEY  = 'tf_user';

    // ── Утилиты ───────────────────────────────────────────────
    function getToken()  { return localStorage.getItem(TOKEN_KEY); }
    function getUser()   {
        try { return JSON.parse(localStorage.getItem(USER_KEY)); }
        catch { return null; }
    }
    function setSession(token, user) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
    function clearSession() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
    }
    function isLoggedIn() { return !!getToken(); }
    function isDriver()   { return getUser()?.role === 'driver'; }
    function isAdmin()    { return getUser()?.role === 'admin'; }

    // ── HTTP-клиент ──────────────────────────────────────────
    async function request(method, endpoint, data = null) {
        const url = `${API_BASE}/${endpoint.replace(/^\//, '')}`;
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        const token = getToken();
        if (token) opts.headers['Authorization'] = `Bearer ${token}`;
        if (data)  opts.body = JSON.stringify(data);

        try {
            const res = await fetch(url, opts);
            const json = await res.json();
            if (!json.success) throw { status: res.status, message: json.message, errors: json.errors };
            return json.data;
        } catch (err) {
            if (err.status === 401) {
                clearSession();
                updateHeaderAuth();
            }
            throw err;
        }
    }

    const GET    = (ep, params) => request('GET',    ep + (params ? '?' + new URLSearchParams(params) : ''));
    const POST   = (ep, data)   => request('POST',   ep, data);
    const PUT    = (ep, data)   => request('PUT',    ep, data);
    const PATCH  = (ep, data)   => request('PATCH',  ep, data);
    const DELETE = (ep, data)   => request('DELETE', ep, data);

    // ═══════════════════════════════════════════════════════════
    // AUTH
    // ═══════════════════════════════════════════════════════════
    const auth = {
        sendOtp: (phone) => POST('auth/send-otp', { phone }),
        verifyOtp: async (phone, code) => {
            const data = await POST('auth/verify-otp', { phone, code });
            setSession(data.token, data.user);
            updateHeaderAuth(data.user);
            return data;
        },
        me: () => GET('auth/me'),
        updateProfile: (data) => PUT('auth/me', data),
        logout: async () => {
            try { await POST('auth/logout'); } catch {}
            clearSession();
            updateHeaderAuth(null);
        },
        getUser,
        getToken,
        isLoggedIn,
        isDriver,
        isAdmin,
    };

    // ═══════════════════════════════════════════════════════════
    // ORDERS
    // ═══════════════════════════════════════════════════════════
    const orders = {
        create:  (data)     => POST('orders', data),
        list:    (params)   => GET('orders', params),
        get:     (id)       => GET(`orders/${id}`),
        cancel:  (id, reason) => DELETE(`orders/${id}`, { reason }),
        setStatus: (id, status, extra = {}) => PATCH(`orders/${id}`, { status, ...extra }),
        rate:    (id, rating, comment) => POST(`orders/${id}/rate`, { rating, comment }),
        active:  () => GET('orders/active'),
    };

    // ═══════════════════════════════════════════════════════════
    // DRIVERS
    // ═══════════════════════════════════════════════════════════
    const drivers = {
        apply:          (data) => POST('drivers/apply', data),
        me:             ()     => GET('drivers/me'),
        update:         (data) => PUT('drivers/me', data),
        updateLocation: (lat, lng) => PATCH('drivers/location', { lat, lng }),
        setOnline:      (online)   => PATCH('drivers/status', { is_online: online }),
        availableOrders: () => GET('drivers/orders'),
    };

    // ═══════════════════════════════════════════════════════════
    // PROFILE
    // ═══════════════════════════════════════════════════════════
    const profile = {
        addresses: {
            list:   ()          => GET('profile/addresses'),
            add:    (data)      => POST('profile/addresses', data),
            remove: (id)        => DELETE(`profile/addresses/${id}`),
        },
        payments: {
            list:   ()          => GET('profile/payments'),
            add:    (cardData)  => POST('profile/payments', cardData),
            remove: (id)        => DELETE(`profile/payments/${id}`),
        },
        applyPromo: (code) => POST('profile/promo', { code }),
        notifications: () => GET('profile/notifications'),
    };

    // ═══════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════
    const admin = {
        stats:   () => GET('admin/stats'),
        users:   (params) => GET('admin/users', params),
        setUser: (id, data) => PATCH(`admin/users/${id}`, data),
        drivers: (status) => GET('admin/drivers', status ? { status } : {}),
        approveDriver: (id, status) => PATCH(`admin/drivers/${id}`, { status }),
        allOrders: (params) => GET('admin/orders', params),
        createPromo: (data) => POST('admin/promo', data),
    };

    // ═══════════════════════════════════════════════════════════
    // UI: обновить шапку после входа/выхода
    // ═══════════════════════════════════════════════════════════
    function updateHeaderAuth(user) {
        user = user || getUser();

        // Кнопка "Войти" в топбаре
        const loginBtn = document.querySelector('.hs-login-btn');
        if (loginBtn) {
            if (user) {
                loginBtn.innerHTML = `<i class="fas fa-user-circle"></i> ${user.name || user.phone}`;
                loginBtn.onclick = () => openProfilePanel();
            } else {
                loginBtn.innerHTML = `<i class="fas fa-arrow-right-to-bracket"></i> Войти`;
                loginBtn.onclick = () => window.openAuthScreen();
            }
        }

        // Drawer: имя / кнопка входа
        const drawerAuth = document.querySelector('.hs-drawer-auth');
        if (drawerAuth) {
            if (user) {
                drawerAuth.innerHTML = `
                    <div class="hs-drawer-user-name">${user.name || user.phone}</div>
                    <div class="hs-drawer-user-phone" style="color:var(--clr-hint);font-size:13px;">${user.phone || ''}</div>
                    <button class="hs-drawer-login-btn" style="margin-top:8px;background:#ff4444;" onclick="TF.auth.logout().then(() => window.closeHsMenu())">
                        Выйти
                    </button>
                `;
            } else {
                drawerAuth.innerHTML = `
                    <button class="hs-drawer-login-btn" onclick="window.openAuthScreen()">
                        Войти или зарегистрироваться
                    </button>
                    <p class="hs-drawer-auth-hint">У вас будет доступ к заказам и избранному</p>
                `;
            }
        }

        // Показываем кнопку "Профиль водителя" если нужно
        if (user?.role === 'driver') {
            const drvBtn = document.querySelector('[onclick="openDriverScreen()"]');
            if (drvBtn) drvBtn.style.display = 'none'; // уже водитель
        }
    }

    function openProfilePanel() {
        // Открываем drawer с профилем
        window.toggleHsMenu && window.toggleHsMenu();
    }

    // ═══════════════════════════════════════════════════════════
    // Инициализация: восстанавливаем сессию при загрузке
    // ═══════════════════════════════════════════════════════════
    document.addEventListener('DOMContentLoaded', function () {
        if (isLoggedIn()) updateHeaderAuth();
    });

    // Публичный API модуля
    return { auth, orders, drivers, profile, admin, updateHeaderAuth };

})();

/* =============================================================
   OTP Auth UI — полный цикл: телефон → OTP → профиль
   ============================================================= */
(function () {

    let _phone = '';  // нормализованный телефон
    let _resendTimer = null;

    // Состояния экрана авторизации
    const STATE = {
        PHONE: 'phone',
        OTP: 'otp',
        NAME: 'name',  // первый вход — просим имя
    };
    let _state = STATE.PHONE;

    // Переключаем вид экрана
    function showState(state) {
        _state = state;

        const phoneBlock = document.getElementById('authPhoneBlock');
        const otpBlock   = document.getElementById('authOtpBlock');
        const nameBlock  = document.getElementById('authNameBlock');

        if (phoneBlock) phoneBlock.style.display = state === STATE.PHONE ? '' : 'none';
        if (otpBlock)   otpBlock.style.display   = state === STATE.OTP   ? '' : 'none';
        if (nameBlock)  nameBlock.style.display  = state === STATE.NAME  ? '' : 'none';

        // Заголовок
        const title = document.querySelector('.auth-title');
        const sub   = document.querySelector('.auth-subtitle');
        if (title && sub) {
            if (state === STATE.OTP) {
                title.innerHTML = 'Введите код<br>из SMS';
                sub.textContent = `Отправлен на ${_phone}`;
            } else if (state === STATE.NAME) {
                title.innerHTML = 'Как вас зовут?';
                sub.textContent = 'Чтобы водитель знал, как к вам обращаться';
            } else {
                title.innerHTML = 'Введите номер<br>телефона';
                sub.textContent = 'Чтобы войти или зарегистрироваться';
            }
        }
    }

    // submitPhone → отправить OTP
    window.submitPhone = async function () {
        const input = document.getElementById('authPhoneInput');
        const raw   = input ? input.value.replace(/\D/g, '') : '';
        if (raw.length < 10) {
            shakeWrap('.auth-phone-wrap');
            return;
        }
        _phone = '+7' + raw.slice(-10);

        const btn = document.querySelector('.auth-submit-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Отправка...'; }

        try {
            const data = await TF.auth.sendOtp(_phone);
            showState(STATE.OTP);
            startResendTimer(data?.expires_in || 300);
            // фокус на первый инпут кода
            setTimeout(() => {
                const f = document.getElementById('otpDigit0');
                if (f) f.focus();
            }, 100);
        } catch (err) {
            showAuthError(err.message || 'Ошибка отправки SMS');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Войти'; }
        }
    };

    // submitOtp → верифицировать
    window.submitOtp = async function () {
        const code = getOtpValue();
        if (code.length < 6) { shakeWrap('.auth-otp-inputs'); return; }

        const btn = document.getElementById('otpSubmitBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Проверяем...'; }

        try {
            const data = await TF.auth.verifyOtp(_phone, code);
            clearResendTimer();

            if (data.is_new) {
                showState(STATE.NAME);
            } else {
                finishAuth(data.user);
            }
        } catch (err) {
            showAuthError(err.message || 'Неверный код');
            clearOtpInputs();
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Подтвердить'; }
        }
    };

    // submitName → сохранить имя после первой регистрации
    window.submitName = async function () {
        const input = document.getElementById('authNameInput');
        const name  = input ? input.value.trim() : '';
        if (name) {
            try { await TF.auth.updateProfile({ name }); } catch {}
        }
        const user = TF.auth.getUser();
        if (user) user.name = name;
        finishAuth(user);
    };

    function finishAuth(user) {
        window.closeAuthScreen && window.closeAuthScreen();
        TF.updateHeaderAuth(user);
        showState(STATE.PHONE);
        const pi = document.getElementById('authPhoneInput');
        if (pi) pi.value = '';
    }

    // Таймер повторной отправки
    function startResendTimer(seconds) {
        const btn = document.getElementById('otpResendBtn');
        let left  = seconds;
        clearResendTimer();
        if (btn) {
            btn.disabled = true;
            _resendTimer = setInterval(() => {
                left--;
                btn.textContent = `Повторить через ${left} сек`;
                if (left <= 0) {
                    clearResendTimer();
                    btn.disabled    = false;
                    btn.textContent = 'Отправить ещё раз';
                }
            }, 1000);
        }
    }

    function clearResendTimer() {
        if (_resendTimer) { clearInterval(_resendTimer); _resendTimer = null; }
    }

    window.resendOtp = async function () {
        try {
            const data = await TF.auth.sendOtp(_phone);
            startResendTimer(data?.expires_in || 300);
            clearOtpInputs();
        } catch (err) {
            showAuthError(err.message || 'Ошибка');
        }
    };

    // OTP поля — авто-переход
    window.onOtpInput = function (el, idx) {
        const val = el.value.replace(/\D/, '').slice(-1);
        el.value = val;
        if (val && idx < 5) {
            const next = document.getElementById(`otpDigit${idx + 1}`);
            if (next) next.focus();
        }
        if (getOtpValue().length === 6) {
            setTimeout(window.submitOtp, 100);
        }
    };

    window.onOtpKeydown = function (el, idx, e) {
        if (e.key === 'Backspace' && !el.value && idx > 0) {
            const prev = document.getElementById(`otpDigit${idx - 1}`);
            if (prev) { prev.value = ''; prev.focus(); }
        }
    };

    function getOtpValue() {
        let code = '';
        for (let i = 0; i < 6; i++) {
            const el = document.getElementById(`otpDigit${i}`);
            code += el ? (el.value || '') : '';
        }
        return code;
    }

    function clearOtpInputs() {
        for (let i = 0; i < 6; i++) {
            const el = document.getElementById(`otpDigit${i}`);
            if (el) el.value = '';
        }
        const f = document.getElementById('otpDigit0');
        if (f) f.focus();
    }

    function showAuthError(msg) {
        const el = document.getElementById('authErrorMsg');
        if (el) {
            el.textContent = msg;
            el.style.display = 'block';
            setTimeout(() => { el.style.display = 'none'; }, 4000);
        }
    }

    function shakeWrap(selector) {
        const el = document.querySelector(selector);
        if (!el) return;
        el.classList.add('auth-shake');
        setTimeout(() => el.classList.remove('auth-shake'), 600);
    }

    // Переход назад с экрана OTP
    window.authGoBack = function () {
        if (_state === STATE.OTP || _state === STATE.NAME) {
            clearResendTimer();
            showState(STATE.PHONE);
        } else {
            window.closeAuthScreen && window.closeAuthScreen();
        }
    };

    // Подключаем auth-back-btn
    document.addEventListener('DOMContentLoaded', function () {
        const backBtn = document.querySelector('.auth-back-btn');
        if (backBtn) backBtn.onclick = window.authGoBack;
    });

})();
