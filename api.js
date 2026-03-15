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
        // Переключение режима пассажир ↔ водитель
        switchRole: async (targetRole) => {
            const data = await POST('auth/switch-role', { target_role: targetRole });
            // Сохраняем новый токен с обновлённой ролью
            setSession(data.token, data.user);
            return data;
        },
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
        apply:           (data)        => POST('drivers/apply', data),
        me:              ()            => GET('drivers/me'),
        update:          (data)        => PUT('drivers/me', data),
        updateLocation:  (lat, lng)    => PATCH('drivers/location', { lat, lng }),
        setOnline:       (online)      => PATCH('drivers/status', { is_online: online }),
        availableOrders: ()            => GET('drivers/orders'),
        // Список доступных авто по типу тарифа (для клиента)
        availableByTariff: (tariffType) => GET('drivers/available', { tariff_type: tariffType }),
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
        const _t = window.t || ((k) => {
            // Аварийный fallback если вдруг вызов до инициализации переводов
            const lang = localStorage.getItem('tf_lang') || 'ru';
            const fb = {
                ru: { signin_btn: 'Войти', logout_btn: 'Выйти', drawer_login_inline: 'Войти или зарегистрироваться', drawer_hint_inline: 'У вас будет доступ к заказам и избранному' },
                en: { signin_btn: 'Sign in', logout_btn: 'Sign out', drawer_login_inline: 'Sign in or register', drawer_hint_inline: 'Access your orders and favourites' },
            };
            return (fb[lang] || fb.ru)[k] || k;
        });

        // Кнопка "Войти" в топбаре
        const loginBtn = document.querySelector('.hs-login-btn');
        if (loginBtn) {
            if (user) {
                loginBtn.innerHTML = `<i class="fas fa-user-circle"></i> ${user.name || user.phone}`;
                loginBtn.onclick = () => openProfilePanel();
            } else {
                loginBtn.innerHTML = `<i class="fas fa-arrow-right-to-bracket"></i> <span data-i18n="signin_btn">${_t('signin_btn')}</span>`;
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
                        <span data-i18n="logout_btn">${_t('logout_btn')}</span>
                    </button>
                `;
            } else {
                drawerAuth.innerHTML = `
                    <button class="hs-drawer-login-btn" onclick="window.openAuthScreen()">
                        <span data-i18n="drawer_login_inline">${_t('drawer_login_inline')}</span>
                    </button>
                    <p class="hs-drawer-auth-hint"><span data-i18n="drawer_hint_inline">${_t('drawer_hint_inline')}</span></p>
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
    // window.load гарантирует что window.t уже определён (script.js выполнен)
    // ═══════════════════════════════════════════════════════════
    window.addEventListener('load', function () {
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
            const _t = window.t || (k => k);
            if (state === STATE.OTP) {
                title.innerHTML = _t('auth_otp_title');
                sub.textContent = _t('auth_otp_sent').replace('{phone}', _phone);
            } else if (state === STATE.NAME) {
                title.innerHTML = _t('auth_name_title');
                sub.textContent = _t('auth_name_sub');
            } else {
                title.innerHTML = _t('auth_title');
                sub.textContent = _t('auth_subtitle');
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
        if (btn) { btn.disabled = true; btn.textContent = window.t ? window.t('auth_sending') : 'Sending...'; }

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
            showAuthError(err.message || (window.t ? window.t('auth_sms_error') : 'Failed to send SMS'));
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = window.t ? window.t('auth_btn_login') : 'Sign in'; }
        }
    };

    // submitOtp → верифицировать
    window.submitOtp = async function () {
        const code = getOtpValue();
        if (code.length < 6) { shakeWrap('.auth-otp-inputs'); return; }

        const btn = document.getElementById('otpSubmitBtn');
        if (btn) { btn.disabled = true; btn.textContent = window.t ? window.t('auth_checking') : 'Checking...'; }

        try {
            const data = await TF.auth.verifyOtp(_phone, code);
            clearResendTimer();

            if (data.is_new || !data.user.name) {
                showState(STATE.NAME);
            } else {
                finishAuth(data.user);
            }
        } catch (err) {
            showAuthError(err.message || (window.t ? window.t('auth_wrong_code') : 'Invalid code'));
            clearOtpInputs();
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = window.t ? window.t('auth_btn_confirm') : 'Confirm'; }
        }
    };

    // submitName → сохранить имя после первой регистрации
    window.submitName = async function () {
        const input = document.getElementById('authNameInput');
        const name  = input ? input.value.trim() : '';
        if (name) {
            try { await TF.auth.updateProfile({ name }); } catch {}
        }
        // Обновляем объект пользователя и сохраняем в localStorage
        const user = TF.auth.getUser();
        if (user) {
            user.name = name;
            localStorage.setItem('tf_user', JSON.stringify(user));
        }
        finishAuth(user);
    };

    function finishAuth(user) {
        // ★ Все роли остаются на index.html — переключение через боковое меню
        // ★ Никакого авторедиректа в admin.html или driver.html — пользователь
        //   сам выбирает режим через кнопки в боковом меню (drawer).
        window.closeAuthScreen && window.closeAuthScreen();
        TF.updateHeaderAuth(user);

        // Всегда запрашиваем полный профиль (me) после входа:
        // — verifyOtp возвращает краткий user без is_admin/driver
        // — только me() отдаёт is_admin=true, что нужно для кнопки «Панель администратора»
        if (user) {
            TF.auth.me().then(function(me) {
                localStorage.setItem('tf_user', JSON.stringify(me));
                if (window.updateDrawerModeBlock) window.updateDrawerModeBlock(me);
            }).catch(function() {
                // Если API временно недоступен — используем кешированный объект для любой роли
                if (window.updateDrawerModeBlock) window.updateDrawerModeBlock(user);
            });
        }

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
                btn.textContent = (window.t ? window.t('auth_resend_timer') : 'Resend in {n} sec').replace('{n}', left);
                if (left <= 0) {
                    clearResendTimer();
                    btn.disabled    = false;
                    btn.textContent = window.t ? window.t('auth_resend_now') : 'Resend code';
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
            showAuthError(err.message || (window.t ? window.t('auth_error_generic') : 'Error'));
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