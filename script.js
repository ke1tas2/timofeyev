/* openAuthScreen — глобальная функция, доступна отовсюду */
window.openAuthScreen = function() {
    var screen = document.getElementById('authScreen');
    if (!screen) return;
    screen.classList.add('is-open');
    // Закрываем drawer если открыт
    if (window.closeHsMenu) window.closeHsMenu();
};

window.closeAuthScreen = function() {
    var screen = document.getElementById('authScreen');
    if (screen) screen.classList.remove('is-open');
};

// Version: 3.2.0 - Admin mode via drawer only, no auto-redirect
// ── Восстановление сессии при загрузке страницы ──────────────
// ★ НИКАКОГО авторедиректа для администраторов или водителей!
//   Все переключения режимов выполняются вручную через боковое меню.
(function() {
    document.addEventListener('DOMContentLoaded', async function() {
        // ★ Защита: admin_token ВСЕГДА очищаем при загрузке index.html.
        //   Он устанавливается только прямо перед редиректом в admin.html через кнопку
        //   в боковом меню, поэтому не должен «живать» дольше одного перехода.
        //   Это исключает авто-вход в admin.html если пользователь закрыл браузер
        //   находясь в панели администратора без явного выхода.
        localStorage.removeItem('admin_token');
        localStorage.removeItem('tf_left_admin');

        if (typeof TF === 'undefined' || !TF.auth.isLoggedIn()) return;
        try {
            var me = await TF.auth.me();
            if (!me) return;
            // ★★ КРИТИЧНО: role='admin' или is_admin=true — только показываем кнопку в drawer.
            //    НИКАКОГО авторедиректа на admin.html при загрузке страницы. Никогда.
            localStorage.setItem('tf_user', JSON.stringify(me));
            // Обновляем drawer: показываем нужные кнопки (клиент/водитель/админ)
            if (typeof updateDrawerModeBlock === 'function') updateDrawerModeBlock(me);
            // Проверяем наличие активного заказа при перезагрузке страницы
            if (me.role === 'client' || me.role === 'driver' || !me.role) {
                try {
                    var active = await TF.orders.active();
                    if (active && !['completed','cancelled'].includes(active.status)) {
                        // Восстанавливаем поллинг и открываем трекинг сразу
                        _trackingOrderId = active.id;
                        _lastTrackedStatus = null;
                        _pollFailCount = 0;
                        // Открываем экран трекинга сразу, в свёрнутом состоянии
                        openOrderTracking(active.id, {
                            from: active.from_address,
                            to:   active.to_address,
                            price: active.price ? Number(active.price).toLocaleString('ru-RU') : '—',
                            payment: active.payment_method,
                        });
                        // Слегка задерживаем сворачивание чтобы карта успела инициализироваться
                        setTimeout(() => window.collapseOrderSheet && window.collapseOrderSheet(), 800);
                    }
                } catch(e2) {}
            }
        } catch(e) {
            if (e && (e.status === 401 || e.status === 403)) {
                localStorage.removeItem('tf_token');
                localStorage.removeItem('tf_user');
                localStorage.removeItem('tf_is_admin');
                localStorage.removeItem('tf_is_driver');
            }
        }
    });
})();

document.addEventListener('DOMContentLoaded', function() {
            const allRecords = document.getElementById('allrecords');
            if (allRecords) {
                const allBlocks = allRecords.querySelectorAll('.t-rec');
                const currentBlock = document.querySelector('.t-rec:has(#tilda-calculator-wrapper)');

                allBlocks.forEach(block => {
                    if (block !== currentBlock) {
                        block.style.display = 'none';
                        block.style.visibility = 'hidden';
                        block.style.height = '0';
                        block.style.overflow = 'hidden';
                    }
                });
            }

            const footer = document.getElementById('footer');
            if (footer) {
                footer.style.display = 'none';
            }
        });

        let map;
        let route;
        let fromMarker, toMarker;
        let fromCoords = null;
        let toCoords = null;
        let selectedTariff    = 'sedan';
        let selectedCar       = null;
        let _selectedDriverId = null;
        let selectingPoint = null;
        let currentPayment = 'cash';
        let mapClickHandler = null;
        let geocoder = null;
        let selectedTransportClass = 'comfort';
        let stops = []; // [{coords, address, marker}]
        const MAX_STOPS = 3;

        const tariffs = [
            { id: 'sedan',      get name() { return window.t ? window.t('sedan')      : 'Sedan';        }, price: 10000,    perKm: 200,     image: './assets/sedan.png',
              cars: [ { id: 'camry', name: 'Toyota Camry', seats: 3 }, { id: 'e_class', name: 'Mercedes E-Class', seats: 3 }, { id: 'bmw5', name: 'BMW 5 Series', seats: 3 }, { id: 'a6', name: 'Audi A6', seats: 3 }, { id: 'genesis', name: 'Genesis G80', seats: 3 } ] },
            { id: 'suv',        get name() { return window.t ? window.t('suv')        : 'SUV';          }, price: 15000,    perKm: 260,     image: './assets/suv.png',
              cars: [ { id: 'lc200', name: 'Toyota Land Cruiser 200', seats: 6 }, { id: 'lc300', name: 'Toyota Land Cruiser 300', seats: 6 }, { id: 'gclass', name: 'Mercedes G-Class', seats: 4 }, { id: 'x7', name: 'BMW X7', seats: 6 }, { id: 'lx570', name: 'Lexus LX570', seats: 6 }, { id: 'escalade', name: 'Cadillac Escalade', seats: 6 }, { id: 'prado', name: 'Toyota Prado', seats: 6 }, { id: 'patrol', name: 'Nissan Patrol', seats: 6 } ] },
            { id: 'sport',      get name() { return window.t ? window.t('sport')      : 'Sportscar';    }, price: 30000,    perKm: 400,     image: './assets/sportcar.png',
              cars: [ { id: 'porsche', name: 'Porsche 911', seats: 2 }, { id: 'amg_gt', name: 'Mercedes-AMG GT', seats: 2 }, { id: 'bmw_m8', name: 'BMW M8', seats: 2 }, { id: 'audi_r8', name: 'Audi R8', seats: 2 } ] },
            { id: 'limousine',  get name() { return window.t ? window.t('limousine')  : 'Limousine';    }, price: 50000,    perKm: 350,     image: './assets/limousine-black.png',
              cars: [ { id: 'rr_phantom', name: 'Rolls-Royce Phantom', seats: 4 }, { id: 'bentley', name: 'Bentley Flying Spur', seats: 4 }, { id: 'limo_merc', name: 'Mercedes S-Class Limo', seats: 6 }, { id: 'limo_linc', name: 'Lincoln Town Car', seats: 8 } ] },
            { id: 'bus',        get name() { return window.t ? window.t('bus')        : 'Bus';          }, price: 40000,    perKm: 350,     image: './assets/bus.png',
              cars: [ { id: 'sprinter_xl', name: 'Mercedes Sprinter 20', seats: 20 }, { id: 'hyundai_bus', name: 'Hyundai County', seats: 30 }, { id: 'man_bus', name: "MAN Lion's Coach", seats: 50 } ] },
            { id: 'minibus',    get name() { return window.t ? window.t('minibus')    : 'Minibus';      }, price: 30000,    perKm: 300,     image: './assets/microbus.png',
              cars: [ { id: 'vito', name: 'Mercedes Vito', seats: 7 }, { id: 'vclass', name: 'Mercedes V-Class', seats: 7 }, { id: 'caravelle', name: 'VW Caravelle', seats: 8 }, { id: 'sprinter_m', name: 'Mercedes Sprinter 8', seats: 8 } ] },
            { id: 'helicopter', get name() { return window.t ? window.t('helicopter') : 'Helicopter';   }, price: 2160000,  perKm: 500000,  image: './assets/helicopter-black.png',
              cars: [ { id: 'bell_407', name: 'Bell 407', seats: 6 }, { id: 'aw109', name: 'AgustaWestland AW109', seats: 7 }, { id: 'ec135', name: 'Airbus EC135', seats: 7 } ] },
            { id: 'jet',        get name() { return window.t ? window.t('jet')        : 'Private jet';  }, price: 10000000, perKm: 1500000, image: './assets/plane.png',
              cars: [ { id: 'citation', name: 'Cessna Citation XLS', seats: 8 }, { id: 'global6000', name: 'Bombardier Global 6000', seats: 12 }, { id: 'gulfstream', name: 'Gulfstream G650', seats: 14 } ] },
            { id: 'trailer',    get name() { return window.t ? window.t('trailer')    : 'Car delivery'; }, price: 20000,    perKm: 200,     image: './assets/car-keys.png', cars: [] },
        ];

        let paymentMethods = [
            { id: 'cash', get name() { return window.t ? window.t('cash') : 'Cash'; }, icon: 'money-bill-wave', type: 'cash' }
        ];

        let savedCards = JSON.parse(localStorage.getItem('taxi_saved_cards')) || [];

        function updatePaymentMethods() {
            paymentMethods = [
                { id: 'cash', get name() { return window.t ? window.t('cash') : 'Cash'; }, icon: 'money-bill-wave', type: 'cash' }
            ];

            savedCards.forEach((card, index) => {
                paymentMethods.push({
                    id: 'card_' + index,
                    name: (window.t ? window.t('card') : 'Card') + ' •••• ' + card.number.slice(-4),
                    icon: 'credit-card',
                    type: 'card',
                    cardIndex: index,
                    cardDetails: card
                });
            });

            renderPaymentMethods();
        }

        // Кастомные layout'ы для маркеров (точки А/Б и остановки)
        let customPointLayout = null;
        let customStopLayout = null;

        ymaps.ready(function() {
            map = new ymaps.Map('map', {
                center: [43.238949, 76.889709],
                zoom: 12,
                controls: []
            }, {
                balloonPanelMaxMapArea: 0,
                suppressMapOpenBlock: true,
                balloon: {
                    autoPan: false
                },
                openBalloonOnClick: false,
                // Темная тема карты
                copyrightLogoVisible: false,
                copyrightProvidersVisible: false,
                copyrightUaVisible: false
            });

            // Инициализируем HTML‑layout'ы для маркеров после создания карты
            customPointLayout = ymaps.templateLayoutFactory.createClass(
                '<div class="custom-point-marker"><span class="cpm-stick"></span></div>'
            );
            customStopLayout = ymaps.templateLayoutFactory.createClass(
                '<div class="custom-stop-marker"><span class="cpm-stick"></span></div>'
            );

            map.options.set('balloonAutoPan', false);
            map.options.set('openBalloonOnClick', false);
            map.behaviors.disable('scrollZoom');

            const centerMarkerEl = document.getElementById('mapMarker');
            let moveEndTimer = null;

            map.events.add('actionbegin', function() {
                if (centerMarkerEl) {
                    centerMarkerEl.classList.add('moving');
                }
            });

            map.events.add('actionend', function() {
                if (!centerMarkerEl) return;
                if (moveEndTimer) clearTimeout(moveEndTimer);
                moveEndTimer = setTimeout(function() {
                    centerMarkerEl.classList.remove('moving');
                }, 150);
            });

            let centerGeocodeTimer = null;
            map.events.add('boundschange', function() {
                if (selectingPoint) {
                    // Режим выбора точки на карте — обновляем превью адреса в баре
                    var coords = getMarkerGeoCoords();
                    previewMpbAddr(coords);
                } else if (!(fromCoords && toCoords)) {
                    // Обычный режим БЕЗ построенного маршрута —
                    // обновляем точку А при перемещении карты (как в Яндекс GO)
                    if (centerGeocodeTimer) clearTimeout(centerGeocodeTimer);
                    centerGeocodeTimer = setTimeout(function() {
                        var coords = getMarkerGeoCoords();
                        geocodeCoords('from', coords, false);
                    }, 1000);
                }
                // Если маршрут построен (fromCoords && toCoords) и не в режиме выбора —
                // карта просто прокручивается без изменения адресов (поведение Яндекс GO)
            });

            // Кнопки зума удалены (оставлена только геолокация)

            function goToUserLocation() {
                if (!navigator.geolocation) return;
                navigator.geolocation.getCurrentPosition(
                    function(position) {
                        const coords = [position.coords.latitude, position.coords.longitude];

                        // Смещаем center карты так, чтобы GPS оказался ровно под кончиком маркера.
                        // dy = расстояние от кончика маркера до геометрического центра #map (в пикселях).
                        // Маркер обычно выше центра (dy < 0), значит центр карты должен быть
                        // южнее GPS на |dy| пикселей, чтобы GPS визуально встал под маркер.
                        try {
                            const markerEl = document.getElementById('mapMarker');
                            const mapEl    = document.getElementById('map');
                            let dy = 0;
                            if (markerEl && mapEl) {
                                const mr = markerEl.getBoundingClientRect();
                                const mp = mapEl.getBoundingClientRect();
                                dy = mr.bottom - (mp.top + mp.height / 2);
                            }
                            const zoom           = 15;
                            const projection     = map.options.get('projection');
                            const gpsGlobalPx    = projection.toGlobalPixels(coords, zoom);
                            // Сдвигаем центр на -dy по Y: если маркер выше (dy<0), центр едет вверх
                            const shiftedGlobalPx = [gpsGlobalPx[0], gpsGlobalPx[1] - dy];
                            const shiftedCoords   = projection.fromGlobalPixels(shiftedGlobalPx, zoom);
                            map.setCenter(shiftedCoords, zoom, { duration: 300 });
                        } catch (e) {
                            map.setCenter(coords, 15, { duration: 300 });
                        }

                        // Отменяем boundschange-таймер: адрес ставим сами по точным GPS coords
                        if (centerGeocodeTimer) clearTimeout(centerGeocodeTimer);
                        geocodeCoords('from', coords, false);
                        // Страховка на время анимации (300мс + запас)
                        setTimeout(function() {
                            if (centerGeocodeTimer) clearTimeout(centerGeocodeTimer);
                        }, 500);
                    },
                    function() {
                        alert(window.t ? window.t('loc_error') : 'Could not detect location. Please allow location access.');
                    },
                    { enableHighAccuracy: true, timeout: 10000 }
                );
            }

            document.getElementById('geoBtn').addEventListener('click', goToUserLocation);

            function updatePanelOverlayHeights() {
                const topEl = document.querySelector('.panel-top');
                const bottomEl = document.querySelector('.panel-bottom');
                const tariffSectionEl = document.querySelector('.tariff-section');
                if (!topEl || !bottomEl) return;

                const topH = Math.ceil(topEl.getBoundingClientRect().height);
                const bottomH = Math.ceil(bottomEl.getBoundingClientRect().height);
                document.documentElement.style.setProperty('--panel-top-h', `${topH}px`);
                document.documentElement.style.setProperty('--panel-bottom-h', `${bottomH}px`);

                // Для мобильной свернутой панели: верхний блок + тарифы + нижний блок + отступ.
                let collapsedH = topH + bottomH + 24;
                if (tariffSectionEl && window.innerWidth <= 768) {
                    const tariffH = Math.ceil(tariffSectionEl.getBoundingClientRect().height);
                    collapsedH = topH + tariffH + bottomH + 24;
                }
                document.documentElement.style.setProperty('--panel-collapsed-height', `${collapsedH}px`);
            }

            updatePanelOverlayHeights();
            requestAnimationFrame(updatePanelOverlayHeights);
            window.addEventListener('resize', updatePanelOverlayHeights);

            map.events.add('click', function(e) {
                if (!selectingPoint) {
                    e.preventDefault();
                }
            });

            geocoder = ymaps.geocode;

            initInterface();

            requestUserLocation();
        });

        function initInterface() {
            // ── Инициализация анимации цен (нужна для calculatePrice) ──
            tariffs.forEach(t => initTariffAnimState(t.id, t.price));

            // ── Строим табы категорий ──
            const tabsEl = document.getElementById('tariffTabs');
            if (tabsEl) {
                tariffs.forEach(tariff => {
                    const tab = document.createElement('button');
                    tab.className = 'tariff-tab' + (tariff.id === selectedTariff ? ' active' : '');
                    tab.dataset.id = tariff.id;
                    tab.textContent = (window.t ? window.t(tariff.id) : null) || tariff.name;
                    tab.addEventListener('click', () => selectTariff(tariff.id));
                    tabsEl.appendChild(tab);
                });
            }

            // ── Рендерим карточки машин для первого тарифа ──
            renderTariffCars(selectedTariff);

            // Применяем текущий язык к сгенерированным табам
            if (typeof window.setLanguage === 'function') {
                window.setLanguage(localStorage.getItem('tf_lang') || 'ru');
            }

            setupInputFields();

            document.getElementById('clearFrom').addEventListener('click', () => {
                clearPoint('from');
            });

            document.getElementById('clearTo').addEventListener('click', () => {
                clearPoint('to');
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    if (document.getElementById('searchOverlay').classList.contains('srch-open')) {
                        closeSearchOverlay();
                    } else if (selectingPoint) {
                        closeMapPickMode();
                    }
                }
            });

            updateClearButtons();
            updatePaymentMethods();
            setupCardInputFormatting();
            updatePrice();
            setupBottomSheet();
            setupSearchOverlay();
            setupMapPickBar();
        }

        function setupCardInputFormatting() {
            const cardNumberInput = document.getElementById('cardNumber');
            const cardExpiryInput = document.getElementById('cardExpiry');
            const cardCvcInput = document.getElementById('cardCvc');

            cardNumberInput.addEventListener('input', function(e) {
                let value = e.target.value.replace(/\D/g, '');
                if (value.length > 16) value = value.substring(0, 16);

                let formatted = '';
                for (let i = 0; i < value.length; i++) {
                    if (i > 0 && i % 4 === 0) formatted += ' ';
                    formatted += value[i];
                }

                e.target.value = formatted;
            });

            cardExpiryInput.addEventListener('input', function(e) {
                let value = e.target.value.replace(/\D/g, '');
                if (value.length > 4) value = value.substring(0, 4);

                if (value.length >= 2) {
                    let month = value.substring(0, 2);
                    if (parseInt(month) > 12) month = '12';
                    if (parseInt(month) < 1) month = '01';

                    let year = value.substring(2);
                    e.target.value = month + (year ? '/' + year : '');
                } else {
                    e.target.value = value;
                }
            });

            cardCvcInput.addEventListener('input', function(e) {
                e.target.value = e.target.value.replace(/\D/g, '').substring(0, 3);
            });
        }

        function setupInputFields() {
            // Инпуты readonly — тап открывает оверлей поиска
            var fromField = document.getElementById('fromField');
            var toField   = document.getElementById('toField');

            function fieldTap(e, pt) {
                if (e.target.closest('.map-select-button') || e.target.closest('.clear-button')) return;
                openSearchOverlay(pt);
            }
            fromField.addEventListener('click', function(e){ fieldTap(e,'from'); });
            toField.addEventListener('click',   function(e){ fieldTap(e,'to'); });

            // Кнопки карты → режим выбора на карте
            document.getElementById('fromMapButton').onclick = function(){ openMapPickMode('from'); };
            document.getElementById('toMapButton').onclick   = function(){ openMapPickMode('to'); };
        }

        function updateClearButtons() {
            document.getElementById('clearFrom').style.display =
                document.getElementById('fromInput').value ? 'flex' : 'none';
            document.getElementById('clearTo').style.display =
                document.getElementById('toInput').value ? 'flex' : 'none';
        }

        /* ===================================================
           SEARCH OVERLAY — поиск с подсказками (Яндекс-стиль)
           =================================================== */
        var _srchPt = null;
        var _srchTimer = null;
        var _srchQuery = '';
        var _srchSheetInited = false;
        var _srchDragging = false;
        var _srchDragStartY = 0;
        var _srchDragStartH = 0;

        function openSearchOverlay(pointType) {
            _srchPt = pointType;

            var labelAEl = document.getElementById('srchLabelA');
            if (labelAEl) {
                const _tf = window.t || (k=>k);
                if (pointType === 'to') {
                    labelAEl.textContent = document.getElementById('fromInput').value || _tf('from_label');
                } else if (pointType === 'from') {
                    labelAEl.textContent = document.getElementById('toInput').value || _tf('to_label');
                } else if (pointType && pointType.startsWith('stop_')) {
                    labelAEl.textContent = document.getElementById('fromInput').value || _tf('from_label');
                }
            }

            var cur = '';
            if (pointType === 'to') {
                cur = document.getElementById('toInput').value;
            } else if (pointType === 'from') {
                cur = document.getElementById('fromInput').value;
            } else if (pointType && pointType.startsWith('stop_')) {
                var sIdx3 = parseInt(pointType.split('_')[1]);
                cur = (stops[sIdx3] && stops[sIdx3].address) || '';
            }

            var input = document.getElementById('srchInput');
            const _srchT = window.t || (k=>k);
            input.placeholder = (pointType === 'to') ? _srchT('search_placeholder')
                : (pointType === 'from') ? _srchT('from_placeholder')
                : _srchT('stop_placeholder').replace('{n}', '');
            input.value = cur || '';
            _srchQuery = input.value;

            updateSrchClearBtn();
            document.getElementById('srchResults').innerHTML = '';

            var overlay = document.getElementById('searchOverlay');
            // Убираем все inline стили перед открытием
            overlay.style.height = '';
            overlay.style.transform = '';
            // Просто добавляем класс - CSS сделает плавную анимацию
            overlay.classList.add('srch-open');

            setTimeout(function() {
                input.focus();
                input.setSelectionRange(0, input.value.length);
                if (cur && cur.length >= 1) triggerSuggest(cur);
            }, 150);
        }

        function closeSearchOverlay() {
            var overlay = document.getElementById('searchOverlay');
            // Просто убираем класс - CSS сделает плавную анимацию
            overlay.classList.remove('srch-open');
            
            document.getElementById('srchInput').blur();
            if (_srchTimer) { clearTimeout(_srchTimer); _srchTimer = null; }
            _srchPt = null;
            _srchQuery = '';
        }

        function getViewportHeight() {
            return window.visualViewport ? window.visualViewport.height : document.documentElement.clientHeight;
        }

        function collapseSearchSheet(animate) {
            // Просто закрываем панель с плавной анимацией
            closeSearchOverlay();
        }

        function expandSearchSheet(animate) {
            // Не нужно ничего делать - панель управляется через класс srch-open
            return;
        }
        

        function updateSrchClearBtn() {
            var val = document.getElementById('srchInput').value;
            document.getElementById('srchClear').style.display = val ? 'flex' : 'none';
        }

        function triggerSuggest(query) {
            query = (query || '').trim();
            if (!query) {
                document.getElementById('srchResults').innerHTML = '';
                return;
            }

            // Показываем загрузку
            var list = document.getElementById('srchResults');
            list.innerHTML = '<div class="srch-loading"><div class="srch-dot"></div><div class="srch-dot"></div><div class="srch-dot"></div></div>';

            // Получаем текущие границы карты для ограничения поиска
            var mapBounds = map ? map.getBounds() : null;
            var mapCenter = map ? map.getCenter() : null;
            
            var geocodeOptions = {
                results: 20,  // Увеличено до 20 для большего выбора
                // Убрали kind - теперь ищем ВСЁ: дома, организации, POI, улицы, metro, district
            };
            
            // Ограничиваем поиск областью карты (приоритет ближайшим результатам)
            if (mapBounds) {
                geocodeOptions.boundedBy = mapBounds;
            }

            // Используем geocode вместо suggest для API 2.1
            ymaps.geocode(query, geocodeOptions).then(function(res) {
                // Игнорируем устаревший ответ
                if (document.getElementById('srchInput').value.trim() !== query) return;
                
                var geoObjects = res.geoObjects;
                var items = [];
                
                // Преобразуем результаты geocode в формат suggest
                for (var i = 0; i < geoObjects.getLength(); i++) {
                    var obj = geoObjects.get(i);
                    var coords = obj.geometry.getCoordinates();
                    
                    // Получаем тип объекта и метаданные
                    var objKind = obj.properties.get('metaDataProperty.GeocoderMetaData.kind');
                    var objName = obj.properties.get('name') || '';
                    var objDescription = obj.properties.get('description') || '';
                    var addressLine = obj.getAddressLine();
                    
                    // Вычисляем расстояние от центра карты
                    var distance = mapCenter ? getDistance(mapCenter, coords) : 0;
                    
                    // Формируем displayName в зависимости от типа объекта
                    var displayName = addressLine;
                    
                    // Если это организация/POI/станция метро - показываем название + адрес
                    if (objKind === 'metro' || objKind === 'other' || (objName && objName !== addressLine)) {
                        displayName = objName + ', ' + addressLine;
                    }
                    
                    // Проверяем релевантность для приоритизации
                    var relevance = 0;
                    var queryLower = query.toLowerCase();
                    var nameLower = objName.toLowerCase();
                    var addressLower = addressLine.toLowerCase();
                    
                    // Высокий приоритет если:
                    // - Название точно совпадает с запросом
                    if (nameLower === queryLower) relevance += 1000;
                    // - Название начинается с запроса
                    else if (nameLower.indexOf(queryLower) === 0) relevance += 500;
                    // - Адрес содержит точный запрос (для номеров домов)
                    if (addressLower.indexOf(queryLower) !== -1) relevance += 300;
                    // - Это дом (house) - приоритет для точных адресов
                    if (objKind === 'house') relevance += 200;
                    // - Это организация - приоритет для POI
                    if (objKind === 'other' && objName) relevance += 150;
                    // - Это метро
                    if (objKind === 'metro') relevance += 100;
                    
                    items.push({
                        value: addressLine,
                        displayName: displayName,
                        coords: coords,
                        distance: distance,
                        kind: objKind,
                        name: objName,
                        relevance: relevance
                    });
                }
                
                // Умная сортировка: сначала по релевантности, потом по расстоянию
                items.sort(function(a, b) {
                    // Если разница в релевантности > 50 - сортируем по релевантности
                    if (Math.abs(a.relevance - b.relevance) > 50) {
                        return b.relevance - a.relevance;
                    }
                    // Иначе сортируем по расстоянию
                    return a.distance - b.distance;
                });
                
                // Ограничиваем до 10 лучших результатов для показа
                var topItems = items.slice(0, 10);
                
                renderSuggestions(topItems.filter(function(i) { return i.value; }), query);
            }).catch(function(e) {
                console.warn('geocode error:', e);
                document.getElementById('srchResults').innerHTML = '<div class="srch-empty">' + (window.t ? window.t('search_empty') : 'Ничего не найдено') + '</div>';
            });
        }
        
        // Функция для вычисления расстояния между двумя точками (в метрах)
        function getDistance(coords1, coords2) {
            var R = 6371000; // Радиус Земли в метрах
            var lat1 = coords1[0] * Math.PI / 180;
            var lat2 = coords2[0] * Math.PI / 180;
            var deltaLat = (coords2[0] - coords1[0]) * Math.PI / 180;
            var deltaLng = (coords2[1] - coords1[1]) * Math.PI / 180;
            
            var a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
                    Math.cos(lat1) * Math.cos(lat2) *
                    Math.sin(deltaLng/2) * Math.sin(deltaLng/2);
            var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            
            return R * c;
        }
        
        // Функция для форматирования расстояния
        function formatDistance(meters) {
            if (!meters && meters !== 0) return '';
            
            if (meters < 1000) {
                // Less than 1 km - show metres
                return Math.round(meters) + ' ' + (window.t ? window.t('dist_m') : 'm');
            } else {
                // 1 km and more - show km
                var km = meters / 1000;
                if (km < 10) {
                    return km.toFixed(1) + ' ' + (window.t ? window.t('dist_km') : 'km');
                } else {
                    return Math.round(km) + ' ' + (window.t ? window.t('dist_km') : 'km');
                }
            }
        }

        function renderSuggestions(items, query) {
            var list = document.getElementById('srchResults');
            list.innerHTML = '';

            if (!items.length) {
                list.innerHTML = '<div class="srch-empty">' + (window.t ? window.t('search_empty') : 'Nothing found') + '</div>';
                return;
            }

            items.forEach(function(item) {
                var name = item.displayName || item.value || '';
                
                // Разбиваем адрес на части по запятым
                var parts = name.split(',').map(function(p) { return p.trim(); });
                
                // Ищем части с улицей/проспектом/переулком (конкретный адрес)
                var streetParts = [];
                var locationParts = [];
                
                var streetKeywords = ['улица', 'проспект', 'переулок', 'шоссе', 'бульвар', 'площадь', 'набережная', 'тупик', 'аллея', 'дорога'];
                
                for (var i = 0; i < parts.length; i++) {
                    var part = parts[i];
                    var hasStreetKeyword = streetKeywords.some(function(kw) {
                        return part.toLowerCase().indexOf(kw) !== -1;
                    });
                    
                    // Если это часть с улицей или номер дома (содержит только цифры/буквы)
                    if (hasStreetKeyword) {
                        streetParts.push(part);
                        // Добавляем следующую часть если это похоже на номер дома
                        if (i + 1 < parts.length) {
                            var nextPart = parts[i + 1];
                            // Если короткая часть (вероятно номер дома)
                            if (nextPart.length < 20 && /\d/.test(nextPart)) {
                                streetParts.push(nextPart);
                                i++; // Пропускаем следующую часть
                            }
                        }
                    } else if (streetParts.length === 0) {
                        // Это город/область/страна (до улицы)
                        locationParts.push(part);
                    } else {
                        // Это после улицы (тоже город/область)
                        locationParts.push(part);
                    }
                }
                
                // Если не нашли улицу, берем последнюю часть как адрес
                if (streetParts.length === 0 && parts.length > 0) {
                    streetParts = [parts[parts.length - 1]];
                    locationParts = parts.slice(0, -1);
                }
                
                var main = streetParts.join(', ');
                var sub = locationParts.join(', ');
                
                // Подсветка совпадений синим (только в главном тексте)
                var mainHL = buildHighlightedText(main, item.hl, query);
                
                // Форматируем расстояние
                var distanceText = formatDistance(item.distance);

                var el = document.createElement('div');
                el.className = 'srch-item';
                el.innerHTML =
                    '<div class="srch-item-ico">' + getSuggestIcon(name, item.kind) + '</div>' +
                    '<div class="srch-item-body">' +
                        '<div class="srch-item-main">' + mainHL + '</div>' +
                        (sub ? '<div class="srch-item-sub">' + esc(sub) + '</div>' : '') +
                    '</div>' +
                    (distanceText ? '<div class="srch-item-distance">' + distanceText + '</div>' : '');

                var used = false;
                el.addEventListener('touchstart', function() {}, { passive: true });
                el.addEventListener('touchend', function(e) {
                    e.preventDefault();
                    used = true;
                    pickSuggestion(item);
                });
                el.addEventListener('click', function() {
                    if (!used) pickSuggestion(item);
                    used = false;
                });
                list.appendChild(el);
            });
        }

        // Подсветка совпадающих символов синим
        function buildHighlightedText(text, hlRanges, query) {
            // Строим set позиций для подсветки
            var hlPos = {};

            // API может вернуть hlRanges как массив [start, len, start, len, ...]
            if (hlRanges && hlRanges.length) {
                var arr = Array.isArray(hlRanges[0]) ? hlRanges : [];
                if (!arr.length) {
                    for (var i = 0; i < hlRanges.length - 1; i += 2) {
                        arr.push([hlRanges[i], hlRanges[i + 1]]);
                    }
                }
                arr.forEach(function(r) {
                    for (var j = r[0]; j < r[0] + r[1] && j < text.length; j++) {
                        hlPos[j] = true;
                    }
                });
            }

            // Если hlRanges не дали результата — fallback: ищем query в тексте
            if (!Object.keys(hlPos).length && query) {
                var re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                var m;
                while ((m = re.exec(text)) !== null) {
                    for (var k = m.index; k < m.index + m[0].length; k++) {
                        hlPos[k] = true;
                    }
                }
            }

            // Строим HTML
            var result = '';
            var open = false;
            for (var idx = 0; idx < text.length; idx++) {
                var ch = text[idx].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                if (hlPos[idx]) {
                    if (!open) { result += '<span class="srch-hl">'; open = true; }
                    result += ch;
                } else {
                    if (open) { result += '</span>'; open = false; }
                    result += ch;
                }
            }
            if (open) result += '</span>';
            return result;
        }

        // Иконка по типу заведения
        function getSuggestIcon(name, kind) {
            var l = name.toLowerCase();
            
            // По типу объекта (kind)
            if (kind === 'metro') return '<i class="fas fa-subway"></i>';
            if (kind === 'railway') return '<i class="fas fa-train"></i>';
            if (kind === 'airport') return '<i class="fas fa-plane"></i>';
            
            // Транспорт
            if (/аэропорт|airport/.test(l)) return '<i class="fas fa-plane"></i>';
            if (/вокзал|станция|метро/.test(l)) return '<i class="fas fa-train"></i>';
            if (/автостанция|автовокзал/.test(l)) return '<i class="fas fa-bus"></i>';
            if (/парковка|parking/.test(l)) return '<i class="fas fa-parking"></i>';
            if (/азс|заправка|газпром|лукойл/.test(l)) return '<i class="fas fa-gas-pump"></i>';
            
            // Размещение
            if (/гостиница|отель|hotel|хостел/.test(l)) return '<i class="fas fa-hotel"></i>';
            
            // Медицина
            if (/больница|клиника|медцентр|поликлиника|аптека/.test(l)) return '<i class="fas fa-hospital"></i>';
            
            // Питание
            if (/ресторан|кафе|кофе|бар|паб|пиццерия|макдональдс|kfc|бургер/.test(l)) return '<i class="fas fa-utensils"></i>';
            
            // Магазины
            if (/магазин|маркет|торговый|рынок|супермаркет|магнит|пятёрочка|перекрёсток/.test(l)) return '<i class="fas fa-shopping-bag"></i>';
            if (/mall|тц|трц|молл/.test(l)) return '<i class="fas fa-shopping-cart"></i>';
            
            // Образование
            if (/школа|университет|гимназия|институт|колледж|лицей/.test(l)) return '<i class="fas fa-graduation-cap"></i>';
            
            // Развлечения и спорт
            if (/кинотеатр|театр|музей|галерея/.test(l)) return '<i class="fas fa-film"></i>';
            if (/спортзал|фитнес|бассейн|стадион/.test(l)) return '<i class="fas fa-dumbbell"></i>';
            if (/парк|сквер|сад/.test(l)) return '<i class="fas fa-tree"></i>';
            
            // Услуги
            if (/банк|bank|сбербанк/.test(l)) return '<i class="fas fa-university"></i>';
            if (/почта|post/.test(l)) return '<i class="fas fa-envelope"></i>';
            if (/салон красоты|парикмахерская/.test(l)) return '<i class="fas fa-cut"></i>';
            
            // По умолчанию - маркер
            return '<i class="fas fa-map-marker-alt"></i>';
        }

        function pickSuggestion(item) {
            var pt = _srchPt;
            var displayName = item.displayName || item.value || '';
            closeSearchOverlay();
            
            if (item.coords) {
                if (pt === 'from') setFromPoint(item.coords, displayName, true);
                else if (pt === 'to') setToPoint(item.coords, displayName);
                else if (pt && pt.startsWith('stop_')) {
                    var idx = parseInt(pt.split('_')[1]);
                    setStopPoint(idx, item.coords, displayName);
                }
                return;
            }
            
            ymaps.geocode(item.value, { results: 1 }).then(function(res) {
                var obj = res.geoObjects.get(0);
                if (!obj) return;
                var coords = obj.geometry.getCoordinates();
                if (pt === 'from') setFromPoint(coords, displayName, true);
                else if (pt === 'to') setToPoint(coords, displayName);
                else if (pt && pt.startsWith('stop_')) {
                    var idx = parseInt(pt.split('_')[1]);
                    setStopPoint(idx, coords, displayName);
                }
            }).catch(function() {});
        }

        function esc(str) {
            if (!str) return '';
            return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
        }

        function setupSearchOverlay() {
            var input  = document.getElementById('srchInput');
            var clearB = document.getElementById('srchClear');
            var mapBtn = document.getElementById('srchMapBtn');
            var handle = document.getElementById('srchSheetHandle');
            var overlay = document.getElementById('searchOverlay');

            input.addEventListener('input', function() {
                updateSrchClearBtn();
                if (_srchTimer) clearTimeout(_srchTimer);
                var q = input.value;
                _srchQuery = q;
                if (!q.trim()) {
                    document.getElementById('srchResults').innerHTML = '';
                    return;
                }
                _srchTimer = setTimeout(function() { triggerSuggest(q); }, 200);
            });

            input.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') { closeSearchOverlay(); return; }
                if (e.key === 'Enter') {
                    var first = document.querySelector('.srch-item');
                    if (first) first.click();
                }
            });

            clearB.addEventListener('click', function() {
                input.value = '';
                _srchQuery = '';
                updateSrchClearBtn();
                document.getElementById('srchResults').innerHTML = '';
                input.focus();
            });

            mapBtn.addEventListener('click', function() {
                var pt = _srchPt || 'to';
                closeSearchOverlay();
                setTimeout(function() { openMapPickMode(pt); }, 80);
            });

            // Инициализация поведения шторки (drag + tap)
            if (!_srchSheetInited && overlay && handle) {
                _srchSheetInited = true;

                // Клик по handle — закрываем панель
                handle.addEventListener('click', function() {
                    if (!overlay.classList.contains('srch-open')) return;
                    closeSearchOverlay();
                });

                // Свайп вниз по handle — закрываем панель
                var touchStartY = 0;
                handle.addEventListener('touchstart', function(e) {
                    if (!overlay.classList.contains('srch-open')) return;
                    if (!e.touches || !e.touches[0]) return;
                    touchStartY = e.touches[0].clientY;
                }, { passive: true });

                handle.addEventListener('touchend', function(e) {
                    if (!overlay.classList.contains('srch-open')) return;
                    if (!e.changedTouches || !e.changedTouches[0]) return;
                    var touchEndY = e.changedTouches[0].clientY;
                    var deltaY = touchEndY - touchStartY;
                    
                    // Если свайп вниз больше 30px - закрываем
                    if (deltaY > 30) {
                        closeSearchOverlay();
                    }
                }, { passive: true });
            }
        }


        /* ===================================================
           MAP PICK MODE — выбор точки перемещением карты
           =================================================== */
        var _mpbPreviewTimer = null;

        function openMapPickMode(pointType) {
            selectingPoint = pointType;

            // Скрываем основную панель
            document.getElementById('panel').style.display = 'none';

            // Скрываем кнопки карты (геолокация, зум и т.д.)
            var mc = document.getElementById('mapControls');
            if (mc) { mc.style.opacity = '0'; mc.style.pointerEvents = 'none'; mc.style.visibility = 'hidden'; }

            // Показываем маркер (даже если маршрут был построен — в режиме выбора он нужен)
            updateMarkerVisibility();

            // Заголовок панели: Точка отправления / Точка назначения
            var titleEl = document.querySelector('.mpb-panel-title');
            if (titleEl) {
                const _tt = window.t || (k=>k);
                if (pointType === 'from') titleEl.textContent = _tt('mpb_from_title');
                else if (pointType === 'to') titleEl.textContent = _tt('mpb_to_title');
                else if (pointType && pointType.startsWith('stop_')) {
                    var sIdx = parseInt(pointType.split('_')[1]);
                    titleEl.textContent = _tt('mpb_stop_title').replace('{n}', sIdx + 1);
                }
            }

            // Заполняем текст в ячейке "Точка назначения"
            var addrB = document.getElementById('mpbAddrB');
            if (addrB) {
                var curAddr = '';
                if (pointType === 'to') {
                    curAddr = document.getElementById('toInput').value;
                } else if (pointType === 'from') {
                    curAddr = document.getElementById('fromInput').value;
                } else if (pointType && pointType.startsWith('stop_')) {
                    var sIdx2 = parseInt(pointType.split('_')[1]);
                    curAddr = (stops[sIdx2] && stops[sIdx2].address) || '';
                }
                if (curAddr) {
                    addrB.textContent = curAddr;
                    addrB.classList.add('mpb-has-addr');
                } else {
                    addrB.textContent = (window.t ? window.t('mpb_moving') : 'Move the map...');
                    addrB.classList.remove('mpb-has-addr');
                }
            }

            // Показываем бар
            document.getElementById('mapPickBar').classList.add('mpb-open');

            // Убираем старый clickHandler если был
            if (mapClickHandler) {
                map.events.remove('click', mapClickHandler);
                mapClickHandler = null;
            }

            // Сразу preview адреса текущего положения маркера
            previewMpbAddr(getMarkerGeoCoords());
        }

        function closeMapPickMode() {
            selectingPoint = null;
            document.getElementById('panel').style.display = '';
            document.getElementById('mapPickBar').classList.remove('mpb-open');
            document.getElementById('mapSelectMode').classList.remove('active');
            if (_mpbPreviewTimer) { clearTimeout(_mpbPreviewTimer); _mpbPreviewTimer = null; }

            // Возвращаем кнопки карты
            var mc = document.getElementById('mapControls');
            if (mc) { mc.style.opacity = ''; mc.style.pointerEvents = ''; mc.style.visibility = ''; }

            // Скрываем маркер если маршрут уже построен (оба адреса выбраны)
            updateMarkerVisibility();

            // Возвращаем bottomsheet в нормальное состояние на мобиле
            if (window.innerWidth <= 768) {
                setTimeout(function(){ window.dispatchEvent(new Event('resize')); }, 60);
            }
        }

        // Геокод координат → обновление строки Б в баре (без маркеров)
        function previewMpbAddr(coords) {
            if (_mpbPreviewTimer) clearTimeout(_mpbPreviewTimer);
            _mpbPreviewTimer = setTimeout(function() {
                if (!selectingPoint) return;
                ymaps.geocode(coords, { results: 1 }).then(function(res) {
                    if (!selectingPoint) return;
                    var obj = res.geoObjects.get(0);
                    if (!obj) return;
                    var full = obj.getAddressLine ? obj.getAddressLine() : obj.properties.get('text') || '';
                    // Убираем страну + город
                    var parts = full.split(',').map(function(s){ return s.trim(); });
                    var addr = parts.length > 2 ? parts.slice(-2).join(', ') : full;

                    var el = document.getElementById('mpbAddrB');
                    el.textContent = addr || (window.t ? window.t('mpb_moving') : 'Move the map...');
                    el.classList.toggle('mpb-has-addr', !!addr);
                }).catch(function(){});
            }, 600);
        }

        function setupMapPickBar() {
            const confirmBtn = document.getElementById('mpbConfirmBtn');
            const backBtn = document.getElementById('mpbBackBtn');
            const navBtn = document.getElementById('mpbNavBtn');

            if (backBtn) {
                backBtn.addEventListener('click', function() {
                    // Кнопка "назад" просто отменяет выбор точки
                    cancelSelection();
                });
            }

            // Правая круглая кнопка — как кнопка геолокации на карте
            if (navBtn) {
                navBtn.addEventListener('click', function() {
                    if (typeof goToUserLocation === 'function') {
                        goToUserLocation();
                    }
                });
            }

            if (!confirmBtn) return;

            confirmBtn.addEventListener('click', function() {
                if (!selectingPoint) return;
                var coords = getMarkerGeoCoords();
                var pt = selectingPoint;
                closeMapPickMode();
                ymaps.geocode(coords, { results: 1 }).then(function(res) {
                    var obj = res.geoObjects.get(0);
                    var addr = obj
                        ? (function() {
                            var full = obj.getAddressLine ? obj.getAddressLine() : '';
                            var parts = full.split(',').map(function(s){ return s.trim(); });
                            return parts.length > 2 ? parts.slice(-2).join(', ') : full;
                        })()
                        : ('Координаты: ' + coords[0].toFixed(5) + ', ' + coords[1].toFixed(5));

                    if (pt === 'from') setFromPoint(coords, addr, false);
                    else if (pt === 'to') setToPoint(coords, addr);
                    else if (pt && pt.startsWith('stop_')) {
                        var idx = parseInt(pt.split('_')[1]);
                        setStopPoint(idx, coords, addr);
                    }
                }).catch(function() {
                    geocodeCoords(pt, coords, pt === 'from');
                });
            });
        }

        function requestUserLocation() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    function(position) {
                        const coords = [position.coords.latitude, position.coords.longitude];
                        // Первый автозапрос геопозиции: обновляем только адрес и координаты,
                        // маркер А при этом не ставим
                        geocodeCoords('from', coords, false);
                        hideLoading();
                    },
                    function(error) {
                        console.log('Геолокация не разрешена:', error);
                        hideLoading();
                    },
                    {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 0
                    }
                );
            } else {
                console.log('Геолокация не поддерживается');
                hideLoading();
            }
        }

        function hideLoading() {
            document.getElementById('locationLoading').style.display = 'none';
        }

        function startSelectingPoint(pointType) {
            openMapPickMode(pointType);
        }

        /* ===================================================
           STOPS — добавление/удаление промежуточных остановок
           =================================================== */

        function addStop() {
            if (stops.length >= MAX_STOPS) return;
            var newIdx = stops.length;
            stops.push({ coords: null, address: '', marker: null });
            renderStopFields();
            openSearchOverlay('stop_' + newIdx);
        }

        function removeStop(idx) {
            if (stops[idx] && stops[idx].marker) {
                map.geoObjects.remove(stops[idx].marker);
            }
            stops.splice(idx, 1);

            // Пересоздаём маркеры с правильными индексами в колбэке dragend
            stops.forEach(function(stop, i) {
                if (stop.marker) {
                    map.geoObjects.remove(stop.marker);
                    stop.marker = null;
                }
                if (stop.coords) {
                    var m = new ymaps.Placemark(stop.coords, {
                        hintContent: (window.t ? window.t('map_stop_hint').replace('{n}', i+1) : 'Stop ' + (i + 1)),
                        balloonContent: stop.address
                    }, {
                        iconLayout: customStopLayout,
                        iconOffset: [-13, -42],
                        draggable: true,
                        openBalloonOnClick: false
                    });
                    (function(stopIdx, marker) {
                        marker.events.add('dragend', function() {
                            var nc = marker.geometry.getCoordinates();
                            stops[stopIdx].coords = nc;
                            geocodeStopCoords(stopIdx, nc);
                        });
                    })(i, m);
                    map.geoObjects.add(m);
                    stop.marker = m;
                }
            });

            renderStopFields();
            updateRoute();
        }

        function setStopPoint(idx, coords, address) {
            while (stops.length <= idx) {
                stops.push({ coords: null, address: '', marker: null });
            }
            if (stops[idx].marker) {
                map.geoObjects.remove(stops[idx].marker);
            }
            stops[idx].coords = coords;
            stops[idx].address = address;

            var m = new ymaps.Placemark(coords, {
                hintContent: (window.t ? window.t('map_stop_hint').replace('{n}', idx+1) : 'Stop ' + (idx + 1)),
                balloonContent: address
            }, {
                iconLayout: customStopLayout,
                iconOffset: [-13, -42],
                draggable: true,
                openBalloonOnClick: false
            });
            (function(stopIdx, marker) {
                marker.events.add('dragend', function() {
                    var nc = marker.geometry.getCoordinates();
                    stops[stopIdx].coords = nc;
                    geocodeStopCoords(stopIdx, nc);
                });
            })(idx, m);
            map.geoObjects.add(m);
            stops[idx].marker = m;

            renderStopFields();
            updateRoute();
        }

        function geocodeStopCoords(idx, coords) {
            ymaps.geocode(coords, { results: 1, kind: 'house' }).then(function(res) {
                var obj = res.geoObjects.get(0);
                if (obj && stops[idx]) {
                    var full = obj.getAddressLine ? obj.getAddressLine() : '';
                    var parts = full.split(',').map(function(s){ return s.trim(); });
                    var addr = parts.length > 2 ? parts.slice(-2).join(', ') : full;
                    stops[idx].address = addr;
                    var inp = document.getElementById('stopInput_' + idx);
                    if (inp) inp.value = addr;
                    updateRoute();
                }
            }).catch(function(){});
        }

        function renderStopFields() {
            var container = document.getElementById('stopsContainer');
            if (!container) return;
            container.innerHTML = '';

            stops.forEach(function(stop, idx) {
                var field = document.createElement('div');
                field.className = 'address-field stop-field';
                field.id = 'stopField_' + idx;
                field.innerHTML =
                    '<div class="address-icon stop-icon" onclick="openSearchOverlay(\'stop_' + idx + '\')">' +
                        '<span class="stop-number">' + (idx + 1) + '</span>' +
                    '</div>' +
                    '<div class="address-input-container" onclick="openSearchOverlay(\'stop_' + idx + '\')">' +
                        '<input type="text" class="address-input" id="stopInput_' + idx + '" ' +
                            'placeholder="' + (window.t ? window.t('stop_placeholder').replace('{n}', idx+1) : 'Stop ' + (idx+1)) + '" autocomplete="off" readonly ' +
                            'value="' + (stop.address || '') + '">' +
                        '<span class="address-hint">' + (window.t ? window.t('stop_placeholder').replace('{n}', idx+1) : 'Stop ' + (idx+1)) + '</span>' +
                    '</div>' +
                    '<button class="clear-button" style="display:flex;" onclick="removeStop(' + idx + ')" title="' + (window.t ? window.t('remove_stop') : 'Remove stop') + '">' +
                        '<i class="fas fa-times"></i>' +
                    '</button>' +
                    '<button class="map-select-button" onclick="startSelectingPoint(\'stop_' + idx + '\')" title="' + (window.t ? window.t('map_select') : 'Select on map') + '">' +
                        '<i class="fas fa-map-marker-alt"></i>' +
                    '</button>';
                container.appendChild(field);
            });

            // Скрываем кнопку "добавить" если достигнут лимит
            var addBtn = document.getElementById('addStopField');
            if (addBtn) {
                addBtn.style.display = stops.length >= MAX_STOPS ? 'none' : '';
            }
        }

        // Возвращает гео-координаты кончика пина маркера.
        // Берём getBoundingClientRect() именно .marker-pin (после rotate(-45deg))
        // — его нижняя граница соответствует визуальному острому кончику.
        // Возвращает высоту панели, перекрывающей карту снизу (pick-bar или основная панель)
        function getMapBottomOverlap() {
            const pickBar = document.getElementById('mapPickBar');
            if (pickBar && pickBar.classList.contains('mpb-open')) {
                return pickBar.getBoundingClientRect().height;
            }
            const panel = document.getElementById('panel');
            if (panel && panel.style.display !== 'none') {
                return panel.getBoundingClientRect().height;
            }
            return 0;
        }

        function getMarkerGeoCoords() {
            // syncUI сдвигает marker.style.top в визуальный центр видимой карты.
            // map.getCenter() — это центр ВСЕГО #map (50% высоты экрана), он НЕ совпадает
            // с позицией маркера. Читаем реальный экранный пиксель кончика маркера.
            const markerEl = document.getElementById('mapMarker');
            const mapEl    = document.getElementById('map');
            if (!markerEl || markerEl.classList.contains('hidden') || !mapEl) {
                return map.getCenter();
            }
            try {
                const markerRect = markerEl.getBoundingClientRect();
                const mapRect    = mapEl.getBoundingClientRect();

                // Кончик маркера = нижний центр элемента (transform: translate(-50%,-100%))
                const tipX = markerRect.left + markerRect.width  / 2;
                const tipY = markerRect.bottom;

                // Смещение от геометрического центра #map
                const mapCenterX = mapRect.left + mapRect.width  / 2;
                const mapCenterY = mapRect.top  + mapRect.height / 2;
                const dx = tipX - mapCenterX;
                const dy = tipY - mapCenterY;   // < 0 когда маркер выше центра экрана

                // Проекция: пиксели → гео
                const projection     = map.options.get('projection');
                const zoom           = map.getZoom();
                const centerGlobalPx = projection.toGlobalPixels(map.getCenter(), zoom);
                return projection.fromGlobalPixels(
                    [centerGlobalPx[0] + dx, centerGlobalPx[1] + dy], zoom
                );
            } catch (e) {
                console.error('getMarkerGeoCoords error:', e);
                return map.getCenter();
            }
        }

        function confirmPointSelection() {
            if (!selectingPoint) return;
            var coords = getMarkerGeoCoords();
            var pt = selectingPoint;
            closeMapPickMode();
            geocodeCoords(pt, coords, pt === 'from');
        }

        function finishSelection() {
            closeMapPickMode();
        }

        function cancelSelection() {
            closeMapPickMode();
        }

        function setFromPoint(coords, address, centerMap = true) {
            fromCoords = coords;
            document.getElementById('fromInput').value = address;
            updateClearButtons();

            if (fromMarker) {
                map.geoObjects.remove(fromMarker);
            }

            fromMarker = new ymaps.Placemark(coords, {
                hintContent: (window.t ? window.t('map_pickup_hint') : 'Departure'),
                balloonContent: address
            }, {
                iconLayout: customPointLayout,
                iconOffset: [-13, -42],
                draggable: true,
                balloonCloseButton: false,
                hideIconOnBalloonOpen: false,
                openBalloonOnClick: false
            });

            fromMarker.events.add('dragend', function(e) {
                const newCoords = fromMarker.geometry.getCoordinates();
                fromCoords = newCoords;
                geocodeCoords('from', newCoords, false);
            });

            map.geoObjects.add(fromMarker);

            if (centerMap && !toCoords) {
                map.setCenter(coords, 15);
            }

            // Обновляем видимость маркера (скрываем если маршрут уже построен)
            updateMarkerVisibility();

            updateRoute();
        }

        // ── Управление видимостью центрального маркера (поведение Яндекс GO) ──
        // Маркер виден только когда маршрут ещё не построен (нет обеих точек).
        // Когда маршрут построен — маркер скрыт, карта просто прокручивается.
        // При входе в режим выбора точки (openMapPickMode) маркер снова показывается.
        function updateMarkerVisibility() {
            const markerEl = document.getElementById('mapMarker');
            if (!markerEl) return;
            if (selectingPoint) {
                // Режим выбора точки — маркер всегда виден
                markerEl.classList.remove('hidden');
            } else if (fromCoords && toCoords) {
                // Маршрут построен — скрываем маркер, карта свободно прокручивается
                markerEl.classList.add('hidden');
            } else {
                // Маршрут не построен — маркер виден (drag = обновление точки А)
                markerEl.classList.remove('hidden');
            }
        }


        let geocodeTimerFrom = null;
        let geocodeTimerTo = null;
        // ID последнего запроса для каждой точки — чтобы отбрасывать устаревшие ответы
        let geocodeReqFrom = 0;
        let geocodeReqTo = 0;

        function geocodeCoords(pointType, coords, updateMap = true) {
            if (pointType === 'from') {
                if (geocodeTimerFrom) clearTimeout(geocodeTimerFrom);
                var reqId = ++geocodeReqFrom;
                geocodeTimerFrom = setTimeout(function() {
                    if (reqId !== geocodeReqFrom) return; // устаревший запрос
                    performGeocode(pointType, coords, updateMap, reqId);
                }, 100); // Минимальная задержка для дебаунса
            } else {
                if (geocodeTimerTo) clearTimeout(geocodeTimerTo);
                var reqIdTo = ++geocodeReqTo;
                geocodeTimerTo = setTimeout(function() {
                    if (reqIdTo !== geocodeReqTo) return; // устаревший запрос
                    performGeocode(pointType, coords, updateMap, reqIdTo);
                }, 100); // Минимальная задержка для дебаунса
            }
        }

        function performGeocode(pointType, coords, updateMap, reqId) {
            console.log('=== Начало геокодирования ===');
            console.log('Координаты:', coords);
            console.log('Тип точки:', pointType);
            console.log('Request ID:', reqId);

            const lat = coords[0];
            const lon = coords[1];

            // Используем Yandex Geocoder напрямую - надежнее чем OSM
            if (typeof ymaps === 'undefined' || !ymaps.geocode) {
                showCoordinates(pointType, coords, updateMap);
                return;
            }

            // ВАЖНО: kind: 'house' заставляет искать конкретные адреса (дома/улицы) рядом с точкой
            // Без этого параметра Yandex может вернуть город/область/страну
            ymaps.geocode(coords, { 
                results: 1,
                kind: 'house'  // Ищем только конкретные адреса рядом с пользователем
            }).then(function(res) {
                // Проверяем актуальность запроса
                var currentReqId = pointType === 'from' ? geocodeReqFrom : geocodeReqTo;
                if (reqId !== currentReqId) {
                    console.log('Игнорируем устаревший ответ geocode. ReqId:', reqId, 'Current:', currentReqId);
                    return; // Игнорируем устаревший ответ
                }
                
                const firstGeoObject = res.geoObjects.get(0);
                if (firstGeoObject) {
                    let address = firstGeoObject.getAddressLine();
                    
                    // Убираем страну если она есть, оставляем город и улицу
                    const parts = address.split(',').map(s => s.trim());
                    if (parts.length > 2) {
                        // Берем последние 2 части (обычно это улица и город)
                        address = parts.slice(-2).join(', ');
                    }
                    
                    console.log('=== ИТОГОВЫЙ АДРЕС:', address, '===');
                    
                    if (pointType === 'from') {
                        document.getElementById('fromInput').value = address;
                        if (updateMap) {
                            // Явный выбор точки А (поиск / клик на карте) — ставим маркер
                            setFromPoint(coords, address);
                        } else {
                            // Простой сдвиг карты: обновляем только координаты и текст,
                            // маркер А не показываем
                            fromCoords = coords;
                            updateClearButtons();
                        }
                    } else {
                        setToPoint(coords, address);
                    }
                } else {
                    showCoordinates(pointType, coords, updateMap);
                }
            }, function(err) {
                // Игнорируем ошибки от устаревших запросов
                var currentReqId = pointType === 'from' ? geocodeReqFrom : geocodeReqTo;
                if (reqId !== currentReqId) {
                    console.log('Игнорируем ошибку от устаревшего запроса');
                    return;
                }
                console.error('Yandex Geocoder error:', err);
                // Не показываем координаты при ошибках - просто игнорируем
            });
        }

        // updateMarkerWithAddress всегда делегирует в setFromPoint —
        // там гарантированно удаляется старый маркер перед созданием нового
        function updateMarkerWithAddress(coords, address) {
            setFromPoint(coords, address, false);
        }

        function showCoordinates(pointType, coords, updateMap) {
            const address = `Координаты: ${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}`;
            console.log('Показываем координаты:', address);

            if (pointType === 'from') {
                document.getElementById('fromInput').value = address;
                if (updateMap) {
                    setFromPoint(coords, address);
                } else {
                    fromCoords = coords;
                    updateClearButtons();
                }
            } else {
                setToPoint(coords, address);
            }
        }

        function setToPoint(coords, address) {
            toCoords = coords;
            document.getElementById('toInput').value = address;
            updateClearButtons();

            if (toMarker) {
                map.geoObjects.remove(toMarker);
            }

            toMarker = new ymaps.Placemark(coords, {
                hintContent: (window.t ? window.t('map_dest_hint') : 'Destination'),
                balloonContent: address
            }, {
                iconLayout: customPointLayout,
                iconOffset: [-13, -42],
                draggable: true,
                balloonCloseButton: false,
                hideIconOnBalloonOpen: false,
                openBalloonOnClick: false
            });

            toMarker.events.add('dragend', function(e) {
                const newCoords = toMarker.geometry.getCoordinates();
                toCoords = newCoords;
                geocodeCoords('to', newCoords, false);
            });

            map.geoObjects.add(toMarker);

            // Маршрут построен — скрываем центральный маркер (поведение Яндекс GO)
            updateMarkerVisibility();

            updateRoute(true);
        }

        function searchAddress(pointType, address) {
            if (!address.trim()) return;

            geocoder(address).then(function(res) {
                const firstGeoObject = res.geoObjects.get(0);
                if (firstGeoObject) {
                    const coords = firstGeoObject.geometry.getCoordinates();

                    if (pointType === 'from') {
                        setFromPoint(coords, address);
                    } else {
                        setToPoint(coords, address);
                    }
                }
            });
        }

        function clearPoint(pointType) {
            if (pointType === 'from') {
                fromCoords = null;
                document.getElementById('fromInput').value = '';
                if (fromMarker) {
                    map.geoObjects.remove(fromMarker);
                    fromMarker = null;
                }
            } else {
                toCoords = null;
                document.getElementById('toInput').value = '';
                if (toMarker) {
                    map.geoObjects.remove(toMarker);
                    toMarker = null;
                }
            }
            updateClearButtons();
            // Маршрут сброшен — возвращаем маркер (снова можно выбирать точку А драгом)
            updateMarkerVisibility();
            updateRoute();
        }

        function updateRoute(centerOnRoute = false) {
            console.log('=== updateRoute вызван ===');
            console.log('fromCoords:', fromCoords);
            console.log('toCoords:', toCoords);
            console.log('stops:', stops);
            
            if (route) {
                map.geoObjects.remove(route);
                route = null;
            }

            if (fromCoords && toCoords) {
                // Помечаем что идёт пересчёт — блокируем кнопку заказа
                _priceIsCalculating = true;
                updateOrderButtonState();

                var waypoints = [fromCoords];
                stops.forEach(function(s){ 
                    if (s.coords) {
                        console.log('Добавляем остановку в waypoints:', s.coords);
                        waypoints.push(s.coords); 
                    }
                });
                waypoints.push(toCoords);
                
                console.log('Итоговые waypoints для маршрута:', waypoints);

                function fallbackDistance() {
                    var total = 0;
                    for (var i = 0; i < waypoints.length - 1; i++) {
                        total += calculateDirectDistance(waypoints[i], waypoints[i + 1]);
                    }
                    return total;
                }

                ymaps.route(waypoints, {
                    mapStateAutoApply: false,
                    boundsAutoApply: false
                }).then(function(router) {
                    route = router;

                    if (!route || typeof route.options !== 'object') {
                        console.warn('Route object not fully loaded');
                        calculatePrice(fallbackDistance());
                        return;
                    }

                    route.options.set({
                        routeActiveStrokeWidth: 5,
                        routeActiveStrokeColor: '#fc3f1e',
                        routeStrokeWidth: 4,
                        routeStrokeColor: '#fc3f1e',
                        pinVisible: false
                    });

                    // Прячем стандартные синие маркеры точек маршрута (1, 2, и т.п.)
                    if (typeof route.getWayPoints === 'function') {
                        try {
                            const wayPoints = route.getWayPoints();
                            wayPoints.each(function (point) {
                                point.options.set('visible', false);
                            });
                        } catch (e) {
                            console.warn('Не удалось скрыть маркеры waypointов:', e);
                        }
                    }

                    map.geoObjects.add(route);
                    console.log('Маршрут добавлен на карту');

                    if (centerOnRoute && typeof route.getBounds === 'function') {
                        const bounds = route.getBounds();
                        if (bounds) {
                            map.setBounds(bounds, {
                                checkZoomRange: true,
                                zoomMargin: 50
                            });
                        }
                    }

                    if (typeof route.getActiveRoute === 'function') {
                        const activeRoute = route.getActiveRoute();
                        if (activeRoute && activeRoute.properties) {
                            const distance = activeRoute.properties.get("distance");
                            if (distance && distance.value) {
                                calculatePrice(distance.value / 1000);
                            } else {
                                calculatePrice(fallbackDistance());
                            }
                        } else {
                            calculatePrice(fallbackDistance());
                        }
                    } else {
                        calculatePrice(fallbackDistance());
                    }
                }).catch(function(error) {
                    console.log('Ошибка построения маршрута:', error);
                    calculatePrice(fallbackDistance());
                });
            } else {
                console.log('Не хватает координат для построения маршрута');
                console.log('fromCoords отсутствует:', !fromCoords);
                console.log('toCoords отсутствует:', !toCoords);
                updatePrice();
            }
        }

        function calculateDirectDistance(coord1, coord2) {
            const R = 6371;
            const dLat = (coord2[0] - coord1[0]) * Math.PI / 180;
            const dLon = (coord2[1] - coord1[1]) * Math.PI / 180;
            const a =
                Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(coord1[0] * Math.PI / 180) * Math.cos(coord2[0] * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            return R * c;
        }

        function selectTariff(tariffId) {
            selectedTariff    = tariffId;
            selectedCar       = null;
            _selectedDriverId = null;

            // Активный таб
            document.querySelectorAll('.tariff-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.id === tariffId);
            });

            // Рендерим карточки машин
            renderTariffCars(tariffId);

            // Цена: берём рассчитанную если есть, иначе ждём маршрута
            const tariff      = tariffs.find(t => t.id === tariffId);
            const calcPrice   = _tariffPrices[tariffId];
            const priceAmount = document.getElementById('priceAmount');
            _finalCalculatedPrice = calcPrice !== undefined ? calcPrice : 0;
            if (priceAmount) {
                if (calcPrice !== undefined) {
                    animateCounter(priceAmount, calcPrice, 400, updateOrderButtonState);
                } else {
                    priceAmount.textContent = '—';
                    currentAnimatedPrice = 0;
                }
            }
            updatePrice();
        }

        // ── Рендер карточек машин ──────────────────────────────
        function renderTariffCars(tariffId) {
            const carsEl = document.getElementById('tariffCars');
            if (!carsEl) return;

            const tariff = tariffs.find(t => t.id === tariffId);
            if (!tariff) return;

            // Скелетон-загрузка пока грузим с API
            carsEl.innerHTML = [1,2,3].map(() =>
                '<div class="tariff-car-skeleton"></div>'
            ).join('');

            // Загружаем реальных водителей из базы
            TF.drivers.availableByTariff(tariffId)
                .then(realCars => _buildCarCards(carsEl, tariff, realCars))
                .catch(() => _buildCarCards(carsEl, tariff, []));
        }

        function _buildCarCards(carsEl, tariff, realCars) {
            carsEl.innerHTML = '';

            // Цена: рассчитанная или базовая
            const price    = _tariffPrices[tariff.id] !== undefined ? _tariffPrices[tariff.id] : tariff.price;
            const isCalc   = _tariffPrices[tariff.id] !== undefined;
            const priceStr = formatPrice(price) + ' ₸';

            // Реальные водители из базы — первыми
            if (realCars && realCars.length > 0) {
                realCars.forEach(driver => {
                    const carId = 'driver_' + driver.driver_id;
                    const card  = document.createElement('div');
                    card.className = 'tariff-car-card' + (selectedCar === carId ? ' active' : '');
                    card.dataset.carId    = carId;
                    card.dataset.driverId = driver.driver_id;

                    card.innerHTML = `
                        ${driver.is_online ? '<div class="tariff-car-online"></div>' : ''}
                        <div class="tariff-car-img"><img src="${tariff.image}" alt="${driver.name}"></div>
                        <div class="tariff-car-eta">— ${window.t ? window.t('min') : 'мин'}</div>
                        <div class="tariff-car-name">${driver.name}</div>
                        ${driver.rating ? `<div class="tariff-car-rating"><i class="fas fa-star"></i> ${driver.rating}</div>` : ''}
                        <div class="tariff-car-price ${isCalc ? 'has-value' : ''}">${priceStr}</div>
                    `;
                    card.addEventListener('click', () => _selectCarCard(card, carId, driver.name, driver.driver_id));
                    carsEl.appendChild(card);
                });
            }

            // Хардкод машины тарифа
            if (tariff.cars && tariff.cars.length > 0) {
                tariff.cars.forEach(car => {
                    const card = document.createElement('div');
                    card.className = 'tariff-car-card' + (selectedCar === car.id ? ' active' : '');
                    card.dataset.carId = car.id;

                    card.innerHTML = `
                        <div class="tariff-car-img"><img src="${tariff.image}" alt="${car.name}"></div>
                        <div class="tariff-car-eta">— ${window.t ? window.t('min') : 'мин'}</div>
                        <div class="tariff-car-name">${car.name}</div>
                        <div class="tariff-car-price ${isCalc ? 'has-value' : ''}">${priceStr}</div>
                    `;
                    card.addEventListener('click', () => _selectCarCard(card, car.id, car.name, null));
                    carsEl.appendChild(card);
                });
            }

            if (carsEl.children.length === 0) {
                const msg = window.t ? window.t('no_cars') : 'Нет доступных автомобилей';
                carsEl.innerHTML = `<div style="padding:16px;color:rgba(255,255,255,0.3);font-size:13px;">${msg}</div>`;
            }
        }

        function _selectCarCard(card, carId, carName, driverId) {
            selectedCar       = carId;
            _selectedDriverId = driverId || null;

            document.querySelectorAll('.tariff-car-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
        }

        // ── Обновление цен в карточках машин ──────────────────
        function updateCarCardPrices(price, isBase) {
            document.querySelectorAll('.tariff-car-card').forEach(card => {
                const priceEl = card.querySelector('.tariff-car-price');
                if (priceEl) {
                    priceEl.textContent = formatPrice(price) + ' ₸';
                    if (!isBase) priceEl.classList.add('has-value');
                    else priceEl.classList.remove('has-value');
                }
            });
        }

        // Хранилище рассчитанных цен по тарифу (заполняется после расчёта маршрута)
        const _tariffPrices = {};

        function calculatePrice(distanceKm = 0) {
            let extras = 0;

            let selectedPrice = 0;

            tariffs.forEach(tariff => {
                let price = tariff.price + (distanceKm * tariff.perKm) + extras;
                price = Math.round(price / 100) * 100;
                _tariffPrices[tariff.id] = price;
                if (tariff.id === selectedTariff) selectedPrice = price;
            });

            // Обновляем цены на карточках текущего тарифа
            updateCarCardPrices(selectedPrice);

            const priceElement = document.getElementById('priceAmount');
            _finalCalculatedPrice = selectedPrice;
            _priceIsCalculating = false;
            if (priceElement) {
                if (currentAnimatedPrice === 0 && priceElement.textContent === '—') {
                    currentAnimatedPrice = selectedPrice;
                    priceElement.textContent = formatPrice(selectedPrice);
                    updateOrderButtonState();
                } else {
                    animateCounter(priceElement, selectedPrice, 800, updateOrderButtonState);
                }
            }
        }

        function resetTariffPrices() {
            Object.keys(_tariffPrices).forEach(k => delete _tariffPrices[k]);
            const tariff = tariffs.find(t => t.id === selectedTariff);
            if (tariff) updateCarCardPrices(tariff.price, true);
            const priceElement = document.getElementById('priceAmount');
            if (priceElement) priceElement.textContent = '—';
            currentAnimatedPrice  = 0;
            _finalCalculatedPrice = 0;
            _priceIsCalculating   = false;
            if (animationFrame) { cancelAnimationFrame(animationFrame); animationFrame = null; }
            updateOrderButtonState();
        }

        function updatePrice() {
            if (fromCoords && toCoords) {
                if (route && typeof route.getActiveRoute === 'function') {
                    const activeRoute = route.getActiveRoute();
                    if (activeRoute && activeRoute.properties) {
                        const distance = activeRoute.properties.get("distance");
                        if (distance && distance.value) {
                            calculatePrice(distance.value / 1000);
                            return;
                        }
                    }
                }
                const directDistance = calculateDirectDistance(fromCoords, toCoords);
                calculatePrice(directDistance);
            } else {
                resetTariffPrices();
            }
        }

        function openPaymentModal() {
            renderPaymentMethods();
            document.getElementById('paymentOverlay').classList.add('active');
        }

        function closePaymentModal() {
            document.getElementById('paymentOverlay').classList.remove('active');
        }

        function openAddCardModal() {
            document.getElementById('cardNumber').value = '';
            document.getElementById('cardExpiry').value = '';
            document.getElementById('cardCvc').value = '';

            document.getElementById('addCardOverlay').classList.add('active');
        }

        function closeAddCardModal() {
            document.getElementById('addCardOverlay').classList.remove('active');
        }

        function renderPaymentMethods() {
            const paymentMethodsList = document.getElementById('paymentMethodsList');
            paymentMethodsList.innerHTML = '';

            paymentMethods.forEach(method => {
                const item = document.createElement('div');
                item.className = 'payment-method-item';
                if (method.id === currentPayment) {
                    item.classList.add('active');
                }

                let details = '';
                if (method.type === 'card' && method.cardDetails) {
                    const expiry = method.cardDetails.expiry || '';
                    details = `До ${expiry}`;
                }

                item.innerHTML = `
                    <div class="payment-method-left">
                        <div class="payment-method-icon ${method.type}">
                            <i class="fas fa-${method.icon}"></i>
                        </div>
                        <div class="payment-method-info">
                            <div class="payment-method-name">${method.name}</div>
                            ${details ? `<div class="payment-method-details">${details}</div>` : ''}
                        </div>
                    </div>
                    ${method.id === currentPayment ? '<div class="payment-method-check"><i class="fas fa-check"></i></div>' : ''}
                    ${method.type === 'card' ? '<button class="card-delete" onclick="deleteCard(event, ' + method.cardIndex + ')">Удалить</button>' : ''}
                `;

                item.addEventListener('click', function(e) {
                    if (!e.target.closest('.card-delete')) {
                        selectPaymentMethod(method.id);
                    }
                });

                paymentMethodsList.appendChild(item);
            });

            const addButton = document.createElement('div');
            addButton.className = 'add-card-button';
            addButton.innerHTML = `
                <div class="add-card-icon">
                    <i class="fas fa-plus"></i>
                </div>
                <div class="add-card-text">Добавить карту</div>
            `;
            addButton.addEventListener('click', openAddCardModal);

            paymentMethodsList.appendChild(addButton);
        }

        function selectPaymentMethod(methodId) {
            currentPayment = methodId;
            const method = paymentMethods.find(m => m.id === methodId);
            document.getElementById('paymentValue').textContent = method.name;
            closePaymentModal();
        }

        function saveCard() {
            const cardNumber = document.getElementById('cardNumber').value.replace(/\s/g, '');
            const cardExpiry = document.getElementById('cardExpiry').value;
            const cardCvc = document.getElementById('cardCvc').value;

            if (cardNumber.length !== 16) {
                alert(window.t ? window.t('card_num_error') : 'Card number must be 16 digits');
                return;
            }

            if (!cardExpiry.match(/^\d{2}\/\d{2}$/)) {
                alert(window.t ? window.t('card_exp_error') : 'Enter expiry date in MM/YY format');
                return;
            }

            if (cardCvc.length !== 3) {
                alert('CVC должен содержать 3 цифры');
                return;
            }

            savedCards.push({
                number: cardNumber,
                expiry: cardExpiry,
                cvc: cardCvc,
                lastFour: cardNumber.slice(-4)
            });

            localStorage.setItem('taxi_saved_cards', JSON.stringify(savedCards));

            updatePaymentMethods();

            closeAddCardModal();

            const newCardId = 'card_' + (savedCards.length - 1);
            selectPaymentMethod(newCardId);
        }

        function deleteCard(event, cardIndex) {
            event.stopPropagation();

            if (confirm(window.t ? window.t('card_delete_confirm') : 'Delete card?')) {
                savedCards.splice(cardIndex, 1);
                localStorage.setItem('taxi_saved_cards', JSON.stringify(savedCards));

                if (currentPayment === 'card_' + cardIndex) {
                    currentPayment = 'cash';
                    const cashMethod = paymentMethods.find(m => m.id === 'cash');
                    document.getElementById('paymentValue').textContent = cashMethod.name;
                }

                updatePaymentMethods();
            }
        }


        const phoneInput = document.getElementById('phoneInput');
        if (phoneInput) {
            phoneInput.addEventListener('input', function(e) {
                let value = e.target.value.replace(/\D/g, '');
                if (!value) {
                    e.target.value = '';
                    return;
                }

                if (value.startsWith('8')) {
                    value = '7' + value.slice(1);
                }

                if (value.startsWith('7')) {
                    value = value.slice(1);
                }

                let formatted = '+7';
                if (value.length > 0) {
                    formatted += ' (' + value.substring(0, 3);
                }
                if (value.length >= 4) {
                    formatted += ') ' + value.substring(3, 6);
                }
                if (value.length >= 7) {
                    formatted += '-' + value.substring(6, 8);
                }
                if (value.length >= 9) {
                    formatted += '-' + value.substring(8, 10);
                }

                e.target.value = formatted;
            });
        }

        // ─── Маппинг тарифов: id → порядковый номер в БД ──────────────────
        const TARIFF_ID_MAP = {
            'sedan':     1,
            'suv':       2,
            'sport':     3,
            'limousine': 4,
            'bus':       5,
            'minibus':   6,
            'helicopter':7,
            'jet':       8,
        };

        async function orderTaxi() {
            const from = document.getElementById('fromInput').value;
            const to   = document.getElementById('toInput').value;
            const rawPrice = document.getElementById('priceAmount').textContent;

            if (!from || !to) {
                showOrderError(window.t ? window.t('order_error_address') : 'Please enter pickup and destination addresses');
                return;
            }
            if (rawPrice === '—' || _finalCalculatedPrice === 0) {
                showOrderError(window.t ? window.t('order_error_price') : 'Please wait for price calculation');
                return;
            }
            // Защита от нажатия во время пересчёта маршрута или анимации счётчика
            if (_priceIsCalculating || animationFrame !== null) {
                showOrderError(window.t ? window.t('order_error_calculating') : 'Please wait for price calculation to finish');
                return;
            }

            // Требуем авторизацию
            if (!TF.auth.isLoggedIn()) {
                openAuthScreen();
                return;
            }

            const btn = document.getElementById('orderButton');
            btn.disabled = true;
            document.getElementById('orderButtonText').textContent = window.t ? window.t('order_creating') : 'Creating order…';

            const tariff = tariffs.find(t => t.id === selectedTariff);
            const tariffDbId = TARIFF_ID_MAP[selectedTariff] || 1;
            const transportClass = selectedTransportClass || 'comfort';
            // Используем итоговую рассчитанную цену, а не анимированное значение
            const priceNum = _finalCalculatedPrice;

            const comment = (document.getElementById('driverComment')?.value || '').trim();

            const orderPayload = {
                tariff_id:            tariffDbId,
                transport_class:      transportClass,
                from_address:         from,
                from_lat:             fromCoords ? fromCoords[0] : 0,
                from_lng:             fromCoords ? fromCoords[1] : 0,
                to_address:           to,
                to_lat:               toCoords ? toCoords[0] : 0,
                to_lng:               toCoords ? toCoords[1] : 0,
                distance_km:          window._lastDistanceKm || null,
                duration_min:         window._lastDurationMin || null,
                price:                priceNum,
                payment_method:       currentPayment || 'cash',
                options:              [],
                comment:              comment || null,
                preferred_driver_id:  _selectedDriverId || null,
                scheduled_at:         window.getScheduledDatetime ? window.getScheduledDatetime() : null,
            };

            try {
                const result = await TF.orders.create(orderPayload);
                btn.disabled = false;
                document.getElementById('orderButtonText').textContent = window.t ? window.t('order_btn') : 'Book transfer';
                openOrderTracking(result.order_id, {
                    from, to, tariff: tariff ? tariff.name : (window.t ? window.t('order_transfer_label') : 'Transfer'),
                    price: rawPrice, transportClass, payment: currentPayment || 'cash'
                });
            } catch (err) {
                btn.disabled = false;
                document.getElementById('orderButtonText').textContent = window.t ? window.t('order_btn') : 'Book transfer';
                showOrderError(err.message || (window.t ? window.t('order_error_failed') : 'Could not create order. Please try again.'));
            }
        }

        function showOrderError(msg) {
            let box = document.getElementById('orderErrorBox');
            if (!box) {
                box = document.createElement('div');
                box.id = 'orderErrorBox';
                box.style.cssText = 'background:#ff4444;color:#fff;padding:10px 16px;border-radius:12px;font-size:13px;margin:8px 0;text-align:center;';
                const section = document.querySelector('.order-section');
                if (section) section.insertAdjacentElement('beforebegin', box);
            }
            box.textContent = msg;
            box.style.display = 'block';
            setTimeout(() => { box.style.display = 'none'; }, 4000);
        }




        // ══════════════════════════════════════════════════════════════════
        // ЭКРАН ОТСЛЕЖИВАНИЯ ЗАКАЗА — стиль Яндекс GO (v2.0 — точная копия)
        // ══════════════════════════════════════════════════════════════════
        let _trackingInterval  = null;
        let _trackingOrderId   = null;
        let _trackingMap       = null;
        let _driverPlacemark   = null;
        let _trackingRouteObj  = null;
        let _lastTrackedStatus = null;
        let _etaMinutes        = null;
        let _pollFailCount     = 0;
        let _lastDriverPos     = null;   // предыдущая позиция (для расчёта bearing)
        let _lastDriverHeading = 0;      // угол поворота машины
        let _routeRedrawTimer  = null;   // таймер перерисовки маршрута

        const ORDER_STATUS_CFG = {
            pending:     { key: 'status_pending',     subKey: 'status_pending_sub',     icon: 'fa-circle-notch fa-spin', color: '#ffd84d' },
            accepted:    { key: 'status_accepted',    subKey: 'status_accepted_sub',    icon: 'fa-car',                  color: '#1c1c1e' },
            arriving:    { key: 'status_arriving',    subKey: 'status_arriving_sub',    icon: 'fa-map-marker-alt',        color: '#ffd84d' },
            in_progress: { key: 'status_in_progress', subKey: 'status_in_progress_sub', icon: 'fa-route',                 color: '#007aff' },
            completed:   { key: 'status_completed',   subKey: 'status_completed_sub',   icon: 'fa-check-circle',          color: '#34c759' },
            cancelled:   { key: 'status_cancelled',   subKey: '',                        icon: 'fa-times-circle',          color: '#ff3b30' },
        };

        // ── SVG-иконка машины (точно как в Яндекс Go) ──────────────────────
        function buildCarSvg(heading) {
            return `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 52 52"
                style="transform:rotate(${heading}deg);transition:transform 0.6s cubic-bezier(.25,.8,.25,1);display:block">
              <filter id="ds"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.45)"/></filter>
              <g filter="url(#ds)">
                <!-- тень под машиной -->
                <ellipse cx="26" cy="44" rx="11" ry="3" fill="rgba(0,0,0,0.22)"/>
                <!-- кузов -->
                <rect x="10" y="18" width="32" height="20" rx="6" fill="#fff"/>
                <!-- крыша -->
                <rect x="15" y="12" width="22" height="12" rx="5" fill="#fff"/>
                <!-- лобовое стекло -->
                <rect x="16" y="13" width="20" height="9" rx="3" fill="#b8d4f0" opacity=".85"/>
                <!-- левая фара -->
                <rect x="10" y="19" width="6" height="4" rx="2" fill="#ffe066"/>
                <!-- правая фара -->
                <rect x="36" y="19" width="6" height="4" rx="2" fill="#ffe066"/>
                <!-- левый стоп-сигнал -->
                <rect x="10" y="31" width="5" height="4" rx="2" fill="#ff453a"/>
                <!-- правый стоп-сигнал -->
                <rect x="37" y="31" width="5" height="4" rx="2" fill="#ff453a"/>
                <!-- левое колесо -->
                <rect x="7" y="26" width="6" height="10" rx="3" fill="#333"/>
                <!-- правое колесо -->
                <rect x="39" y="26" width="6" height="10" rx="3" fill="#333"/>
                <!-- жёлтая полоска-акцент -->
                <rect x="10" y="22" width="32" height="3" rx="1.5" fill="#ffd84d" opacity=".7"/>
              </g>
            </svg>`;
        }

        const OTR_STYLES = `
        <style id="otrStyles">
        /* ══════════════════════════════════════════
           ORDER TRACKING — Yandex Go точная копия
           Тёмная и светлая темы + Draggable sheet
           ══════════════════════════════════════════ */

        #orderTrackingOverlay {
            --otr-bg:          #f0eff4;
            --otr-sheet-bg:    #ffffff;
            --otr-text:        #1c1c1e;
            --otr-text-muted:  rgba(60,60,67,.55);
            --otr-sep:         rgba(60,60,67,.10);
            --otr-row-bg:      #f2f2f7;
            --otr-handle:      rgba(60,60,67,.18);
            --otr-btn-bg:      #f2f2f7;
            --otr-plate-bg:    #f2f2f7;
            --otr-plate-border:#d1d1d6;
            --otr-back-bg:     rgba(255,255,255,.92);
            --otr-back-shadow: 0 2px 12px rgba(0,0,0,.18);
            --otr-back-color:  #1c1c1e;
            --otr-badge-bg:    rgba(255,255,255,.96);
            --otr-badge-text:  #1c1c1e;
            --otr-cancel-color:#ff3b30;
            --otr-toggle-off:  #e5e5ea;
            --otr-chevron:     #c7c7cc;
            --otr-search-bg:   #fff9e0;
            --otr-search-ring: rgba(255,216,77,.3);
            --otr-shadow:      0 -2px 20px rgba(0,0,0,.12);
        }
        body:not(.light-theme) #orderTrackingOverlay {
            --otr-bg:          #1c1c1c;
            --otr-sheet-bg:    #2a2a2a;
            --otr-text:        #f0f0f0;
            --otr-text-muted:  rgba(255,255,255,.48);
            --otr-sep:         rgba(255,255,255,.08);
            --otr-row-bg:      #333333;
            --otr-handle:      rgba(255,255,255,.3);
            --otr-btn-bg:      #3a3a3a;
            --otr-plate-bg:    rgba(255,255,255,.1);
            --otr-plate-border:rgba(255,255,255,.2);
            --otr-back-bg:     rgba(28,28,28,.88);
            --otr-back-shadow: 0 2px 12px rgba(0,0,0,.5);
            --otr-back-color:  #f0f0f0;
            --otr-badge-bg:    rgba(28,28,28,.92);
            --otr-badge-text:  #f0f0f0;
            --otr-cancel-color:#ff453a;
            --otr-toggle-off:  rgba(255,255,255,.18);
            --otr-chevron:     rgba(255,255,255,.28);
            --otr-search-bg:   rgba(255,216,77,.08);
            --otr-search-ring: rgba(255,216,77,.18);
            --otr-shadow:      0 -4px 30px rgba(0,0,0,.5);
        }

        /* ── OVERLAY ── */
        #orderTrackingOverlay {
            position:fixed;inset:0;z-index:9000;
            font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text',Helvetica,sans-serif;
            animation:otrSlideUp .3s cubic-bezier(.2,.8,.2,1);
        }
        @keyframes otrSlideUp{from{opacity:0;transform:translateY(50px)}to{opacity:1;transform:none}}

        /* ── MAP — весь экран как фон (как основная карта) ── */
        #otrMapWrap {
            position:absolute;
            inset:0;
            overflow:hidden;
        }
        #otrMapEl {position:absolute;inset:0;}

        /* ── Маркер машины ── */
        .otr-car-marker {position:relative;width:52px;height:52px;cursor:default;}
        .otr-car-pulse {
            position:absolute;inset:-12px;border-radius:50%;
            background:rgba(0,122,255,.18);
            animation:otrCarPulse 2s ease-in-out infinite;
        }
        @keyframes otrCarPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.45);opacity:0}}

        /* ── ETA BADGE ── */
        .otr-eta-badge {
            position:absolute;bottom:16px;left:50%;transform:translateX(-50%);
            background:var(--otr-badge-bg);border-radius:24px;padding:9px 22px;
            font-size:14px;font-weight:700;color:var(--otr-badge-text);
            white-space:nowrap;pointer-events:none;display:none;
            box-shadow:var(--otr-back-shadow);
        }
        .otr-eta-badge .otr-eta-car{display:inline-block;margin-right:6px;}

        /* ── TOP BAR ── */
        .otr-map-topbar {
            position:absolute;top:0;left:0;right:0;z-index:10;
            padding:16px 16px 12px;display:flex;align-items:center;gap:10px;
            pointer-events:none;
        }
        .otr-back {
            width:40px;height:40px;border-radius:50%;
            background:var(--otr-back-bg);box-shadow:var(--otr-back-shadow);border:none;
            cursor:pointer;color:var(--otr-back-color);font-size:16px;
            display:flex;align-items:center;justify-content:center;
            transition:opacity .15s;pointer-events:auto;
        }
        .otr-back:active{opacity:.65;}
        .otr-map-order-num {
            background:var(--otr-back-bg);box-shadow:var(--otr-back-shadow);
            border-radius:20px;padding:0 14px;height:40px;
            display:flex;align-items:center;
            font-size:13px;font-weight:600;color:var(--otr-text-muted);
            pointer-events:auto;
        }

        /* ══════════════════════════════════════════
           НИЖНИЙ ЛИСТ — DRAGGABLE (поверх карты)
           ══════════════════════════════════════════ */
        .otr-sheet {
            position:absolute;
            left:0;right:0;bottom:0;
            background:var(--otr-sheet-bg);
            border-radius:20px 20px 0 0;
            overflow:hidden;
            box-shadow:0 -4px 32px rgba(0,0,0,.22);
            transition:height .38s cubic-bezier(.4,0,.2,1);
            height:auto;
            max-height:86vh;
            z-index:10;
        }
        /* СВЁРНУТОЕ состояние — только ручка + статус строка */
        .otr-sheet.otr-collapsed {
            height:88px !important;
            cursor:pointer;
            overflow:hidden !important;
        }

        /* Скроллируемая часть */
        #otrSheetScroll {
            overflow-y:auto;overflow-x:hidden;
            max-height:calc(52vh - 150px);
            -webkit-overflow-scrolling:touch;
        }
        .otr-sheet.otr-collapsed #otrSheetScroll {
            overflow:hidden;max-height:0;
            pointer-events:none;
        }
        .otr-sheet.otr-collapsed .otr-footer {
            display:none;
        }
        .otr-sheet.otr-collapsed .otr-status-row {
            border-bottom:none;
            pointer-events:none; /* клик обрабатывает весь sheet */
        }

        /* Мини-полоска в свёрнутом состоянии */
        .otr-sheet.otr-collapsed .otr-handle-zone {
            cursor:pointer;
        }

        /* Стрелка-шеврон в статус-строке (показывает раскрытие/сворачивание) */
        .otr-chevron-btn {
            width:36px;height:36px;border-radius:50%;
            background:var(--otr-btn-bg);
            display:flex;align-items:center;justify-content:center;
            flex-shrink:0;margin-left:10px;
            color:var(--otr-text-muted);
            border:none;cursor:pointer;
            transition:transform .35s cubic-bezier(.4,0,.2,1), background .2s;
            -webkit-tap-highlight-color:transparent;
        }
        .otr-chevron-btn:active { background:var(--otr-row-bg); }
        /* Когда лист развёрнут — стрелка смотрит ВНИЗ (чтобы свернуть) */
        .otr-sheet:not(.otr-collapsed) .otr-chevron-btn {
            transform: rotate(180deg);
        }
        /* Когда свёрнут — стрелка смотрит ВВЕРХ (чтобы развернуть) */
        .otr-sheet.otr-collapsed .otr-chevron-btn {
            transform: rotate(0deg);
        }

        /* ── РУЧКА ПЕРЕТАСКИВАНИЯ ── */
        .otr-handle-zone {
            padding:12px 0 6px;
            display:flex;align-items:center;justify-content:center;
            cursor:pointer;user-select:none;
            position:relative;
            -webkit-user-select:none;
            -webkit-tap-highlight-color:transparent;
        }
        .otr-sheet-handle {
            width:40px;height:4px;
            background:var(--otr-handle);border-radius:2px;
            transition:width .2s, opacity .2s;
        }


        /* ── КНОПКА EXPAND — убрана, свайп только через ручку ── */
        .otr-expand-btn {display:none;}

        /* ── СТАТУС (заголовок) ── */
        .otr-status-row {
            display:flex;align-items:center;
            padding:6px 20px 14px;
            border-bottom:1px solid var(--otr-sep);
            cursor:pointer;
            -webkit-tap-highlight-color:transparent;
            user-select:none;
        }
        .otr-status-left  {flex:1;min-width:0;}
        .otr-status-label {display:none;}
        .otr-status-main  {
            font-size:22px;font-weight:700;color:var(--otr-text);
            line-height:1.25;letter-spacing:-.3px;
        }
        .otr-status-sub {
            font-size:13px;color:var(--otr-text-muted);margin-top:2px;
        }
        .otr-eta-right {display:none;}

        /* ── РАЗДЕЛИТЕЛЬ ── */
        .otr-sep {height:1px;background:var(--otr-sep);margin:14px 0 0;}

        /* ── ВОДИТЕЛЬ ── */
        .otr-driver-section {padding:14px 20px 0;}
        .otr-driver-row {display:flex;align-items:center;gap:12px;}
        .otr-driver-avatar {
            width:52px;height:52px;border-radius:50%;flex-shrink:0;
            background:var(--otr-row-bg);
            display:flex;align-items:center;justify-content:center;
            font-size:22px;font-weight:700;color:var(--otr-text-muted);overflow:hidden;
        }
        .otr-driver-info   {flex:1;min-width:0;}
        .otr-driver-name   {font-size:17px;font-weight:700;color:var(--otr-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .otr-driver-stars  {display:flex;align-items:center;gap:2px;margin-top:2px;}
        .otr-star-full     {color:#ffd84d;font-size:13px;}
        .otr-star-empty    {color:var(--otr-chevron);font-size:13px;}
        .otr-rating-num    {font-size:13px;font-weight:700;color:var(--otr-text);margin-left:4px;}
        .otr-driver-car-photo-wrap {display:flex;align-items:flex-end;flex-shrink:0;}
        .otr-driver-photo  {
            width:44px;height:44px;border-radius:50%;
            background:var(--otr-row-bg);border:3px solid var(--otr-sheet-bg);
            overflow:hidden;display:flex;align-items:center;justify-content:center;
            font-size:18px;font-weight:700;color:var(--otr-text-muted);
        }

        /* ── НОМЕР АВТО ── */
        .otr-plate-big {
            display:inline-flex;align-items:center;
            font-size:22px;font-weight:800;letter-spacing:.06em;
            color:var(--otr-text);
            background:var(--otr-plate-bg);border:2px solid var(--otr-plate-border);
            border-radius:10px;padding:6px 16px;margin-top:12px;
            font-family:-apple-system,BlinkMacSystemFont,monospace;
        }

        /* ── 3 КНОПКИ ДЕЙСТВИЙ ── */
        .otr-action-row {display:flex;gap:10px;margin-top:14px;}
        .otr-action-btn {
            flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
            gap:5px;padding:13px 8px;border-radius:14px;
            font-size:12px;font-weight:600;color:var(--otr-text);
            background:var(--otr-btn-bg);border:none;cursor:pointer;
            transition:opacity .15s,transform .1s;text-decoration:none;
        }
        .otr-action-btn:active {transform:scale(.95);opacity:.7;}
        .otr-action-btn i   {font-size:20px;}
        .otr-btn-call   i   {color:#34c759;}
        .otr-btn-safety i   {color:var(--otr-text);}
        .otr-btn-share  i   {color:#007aff;}

        /* ── АВТО ── */
        .otr-car-row       {display:flex;align-items:center;gap:8px;margin-top:3px;padding:0;}
        .otr-car-color-dot {width:12px;height:12px;border-radius:50%;flex-shrink:0;border:1.5px solid var(--otr-sep);}
        .otr-car-model     {font-size:14px;color:var(--otr-text-muted);font-weight:500;flex:1;}
        .otr-car-plate     {display:none;}

        /* ── МАРШРУТ ── */
        .otr-route-section {padding:0 16px;}
        .otr-route-title   {display:none;}
        .otr-route-item {
            display:flex;gap:14px;align-items:center;
            padding:13px 0;border-bottom:1px solid var(--otr-sep);cursor:pointer;
        }
        .otr-route-item:last-child {border-bottom:none;}
        .otr-route-icon-wrap {
            width:36px;height:36px;border-radius:50%;flex-shrink:0;
            display:flex;align-items:center;justify-content:center;font-size:15px;
        }
        .otr-route-icon-from {background:#e5f9ee;color:#34c759;}
        .otr-route-icon-to   {background:var(--otr-row-bg);color:var(--otr-text-muted);}
        .otr-route-text-wrap {flex:1;min-width:0;}
        .otr-route-label {font-size:11px;color:var(--otr-text-muted);font-weight:500;margin-bottom:2px;}
        .otr-route-addr  {font-size:15px;font-weight:500;color:var(--otr-text);line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .otr-route-chevron {color:var(--otr-chevron);font-size:11px;flex-shrink:0;opacity:.6;}

        /* ── ДОБАВИТЬ ОСТАНОВКУ ── */
        .otr-add-stop {
            display:flex;gap:14px;align-items:center;
            padding:13px 16px;border-top:1px solid var(--otr-sep);cursor:pointer;
        }
        .otr-add-stop-icon {
            width:36px;height:36px;border-radius:50%;
            background:var(--otr-btn-bg);
            display:flex;align-items:center;justify-content:center;
            font-size:15px;color:var(--otr-text-muted);
            flex-shrink:0;
        }
        .otr-add-stop-text    {font-size:15px;font-weight:500;color:var(--otr-text);flex:1;}
        .otr-add-stop-chevron {color:var(--otr-chevron);font-size:11px;opacity:.6;}

        /* ── НУЖНА ПОМОЩЬ ── */
        .otr-help-row {
            display:flex;align-items:center;gap:14px;
            padding:13px 16px;border-top:1px solid var(--otr-sep);cursor:pointer;
        }
        .otr-help-icon   {width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--otr-text);flex-shrink:0;}
        .otr-help-text   {font-size:15px;font-weight:500;color:var(--otr-text);flex:1;}
        .otr-help-chevron{color:var(--otr-chevron);font-size:11px;opacity:.6;}

        /* ── ОПЛАТА ── */
        .otr-payment-row {
            display:flex;align-items:center;gap:14px;
            padding:13px 16px;border-top:1px solid var(--otr-sep);
        }
        .otr-payment-logo   {width:36px;height:36px;background:var(--otr-btn-bg);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
        .otr-payment-text   {flex:1;min-width:0;}
        .otr-payment-main   {font-size:15px;font-weight:500;color:var(--otr-text);}
        .otr-payment-sub    {font-size:12px;color:var(--otr-text-muted);margin-top:1px;}
        .otr-payment-change {
            font-size:14px;font-weight:600;color:var(--otr-text);
            background:var(--otr-btn-bg);border:none;border-radius:10px;
            padding:7px 14px;cursor:pointer;flex-shrink:0;
        }

        /* ── ПОКАЗАТЬ ВОДИТЕЛЮ ГДЕ Я ── */
        .otr-share-loc-row {
            display:flex;align-items:center;gap:14px;
            padding:13px 16px;border-top:1px solid var(--otr-sep);
        }
        .otr-share-loc-icon {width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--otr-text);flex-shrink:0;}
        .otr-share-loc-text {font-size:15px;font-weight:500;color:var(--otr-text);flex:1;}
        .otr-toggle {
            width:51px;height:31px;background:var(--otr-toggle-off);
            border-radius:16px;border:none;cursor:pointer;
            position:relative;transition:background .25s;flex-shrink:0;
            -webkit-appearance:none;appearance:none;
        }
        .otr-toggle.on {background:#34c759;}
        .otr-toggle::after {
            content:'';position:absolute;top:2px;left:2px;
            width:27px;height:27px;border-radius:50%;
            background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.25);
            transition:transform .25s cubic-bezier(.26,1,.5,1);
        }
        .otr-toggle.on::after {transform:translateX(20px);}

        /* ── ПЕРЕВОЗЧИК ── */
        .otr-carrier-row {
            display:flex;align-items:center;gap:14px;
            padding:13px 16px;border-top:1px solid var(--otr-sep);cursor:pointer;
        }
        .otr-carrier-icon    {width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--otr-text-muted);flex-shrink:0;}
        .otr-carrier-wrap    {flex:1;min-width:0;}
        .otr-carrier-label   {font-size:11px;color:var(--otr-text-muted);}
        .otr-carrier-name    {font-size:15px;font-weight:500;color:var(--otr-text);}
        .otr-carrier-chevron {color:var(--otr-chevron);font-size:11px;opacity:.6;flex-shrink:0;}

        /* ── ПОИСК ВОДИТЕЛЯ ── */
        .otr-search-wrap {
            display:flex;flex-direction:column;align-items:center;padding:18px 24px 8px;
        }
        .otr-search-ring {
            width:76px;height:76px;border-radius:50%;
            background:var(--otr-search-bg);
            display:flex;align-items:center;justify-content:center;
            position:relative;margin-bottom:14px;
        }
        .otr-search-ring::before,.otr-search-ring::after {
            content:'';position:absolute;inset:-16px;border-radius:50%;
            border:2px solid var(--otr-search-ring);
            animation:otrSearchRing 2.2s ease-in-out infinite;
        }
        .otr-search-ring::after {animation-delay:.9s;}
        @keyframes otrSearchRing{0%{transform:scale(.7);opacity:.8}100%{transform:scale(1.5);opacity:0}}
        .otr-search-car   {font-size:28px;color:#ffd84d;animation:otrSearchCar 1.6s ease-in-out infinite;display:inline-block;}
        @keyframes otrSearchCar{0%,100%{transform:translateX(-4px)}50%{transform:translateX(4px)}}
        .otr-search-title {font-size:17px;font-weight:700;color:var(--otr-text);margin-bottom:6px;}
        .otr-search-sub   {font-size:13px;color:var(--otr-text-muted);text-align:center;line-height:1.5;}

        /* ── FOOTER / ОТМЕНА ── */
        .otr-footer {padding:8px 16px 44px;}
        .otr-cancel-btn {
            width:100%;padding:14px 0;background:transparent;border:none;
            border-top:1px solid var(--otr-sep);
            color:var(--otr-cancel-color);
            font-size:16px;font-weight:500;cursor:pointer;
            display:block;text-align:center;
            transition:opacity .15s;
            letter-spacing:-.1px;
            margin-top:4px;
        }
        .otr-cancel-btn:active {opacity:.5;}
        .otr-done-btn {
            width:100%;padding:16px;background:#ffd84d;border:none;border-radius:14px;
            color:#141414;font-size:16px;font-weight:700;cursor:pointer;margin-top:4px;
        }

        /* ── РЕЙТИНГ ── */
        .otr-rating-card {
            background:var(--otr-row-bg);border-radius:18px;
            padding:20px;margin:10px 20px 0;text-align:center;
        }
        .otr-rating-title {font-size:16px;font-weight:700;color:var(--otr-text);margin-bottom:16px;}
        .otr-stars-input  {display:flex;gap:8px;justify-content:center;margin-bottom:18px;}
        .otr-star-btn {
            font-size:38px;cursor:pointer;color:var(--otr-chevron);
            transition:all .15s;background:none;border:none;padding:0;
        }
        .otr-star-btn.lit {color:#ffd84d;transform:scale(1.12);}
        .otr-rate-btn {
            padding:13px 48px;background:var(--otr-text);border:none;border-radius:14px;
            color:var(--otr-sheet-bg);font-size:15px;font-weight:700;cursor:pointer;
        }

        /* ── FLASH ── */
        .otr-flash-overlay {
            position:fixed;inset:0;z-index:9100;
            display:flex;align-items:center;justify-content:center;
            background:rgba(0,0,0,.45);backdrop-filter:blur(8px);
            animation:otrFlashBg .25s ease;
        }
        @keyframes otrFlashBg{from{opacity:0}to{opacity:1}}
        .otr-flash-card {
            background:var(--otr-sheet-bg);border-radius:26px;
            padding:36px 28px;text-align:center;max-width:310px;width:88%;
            animation:otrFlashCard .35s cubic-bezier(.34,1.56,.64,1);
        }
        @keyframes otrFlashCard{from{transform:scale(.65) translateY(30px);opacity:0}to{transform:none;opacity:1}}
        .otr-flash-ico   {width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:30px;}
        .otr-flash-title {font-size:21px;font-weight:800;color:var(--otr-text);margin-bottom:8px;}
        .otr-flash-sub   {font-size:14px;color:var(--otr-text-muted);line-height:1.5;}

        /* ── ARRIVING PULSE ── */
        @keyframes otrArrivingPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,216,77,.6)}60%{box-shadow:0 0 0 20px rgba(255,216,77,0)}}
        .otr-arriving-pulse{animation:otrArrivingPulse 1.6s ease-in-out infinite;}

        /* ── МИНИ-КАРТОЧКА ── */
        #activeOrderCard {
            position:fixed;left:0;right:0;bottom:0;z-index:8900;
            padding:0 12px 16px;pointer-events:none;
            transform:translateY(130%);
            transition:transform .4s cubic-bezier(.34,1.26,.64,1);
        }
        #activeOrderCard.aoc-visible {transform:translateY(0);pointer-events:auto;}
        .aoc-inner {
            background:var(--otr-sheet-bg, #fff);border-radius:20px;overflow:hidden;
            box-shadow:0 4px 30px rgba(0,0,0,.18);
        }
        .aoc-status-bar {height:3px;background:#ffd84d;transition:background .4s;}
        .aoc-body   {display:flex;align-items:center;gap:14px;padding:14px 16px;}
        .aoc-icon   {width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;transition:background .4s;}
        .aoc-info   {flex:1;min-width:0;}
        .aoc-status {font-size:14px;font-weight:700;color:var(--otr-text, #1c1c1e);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .aoc-sub    {font-size:12px;color:var(--otr-text-muted, rgba(60,60,67,.55));margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .aoc-right  {display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;}
        .aoc-eta    {font-size:14px;font-weight:700;color:var(--otr-text, #1c1c1e);}
        .aoc-chevron{color:var(--otr-chevron, #c7c7cc);opacity:.6;}
        .aoc-pulse  {animation:aocPulse 1.8s ease-in-out infinite;}
        @keyframes aocPulse{0%,100%{opacity:1}50%{opacity:.45}}

        /* ── ОШИБКА СЕТИ ── */
        .otr-net-error {
            position:fixed;bottom:130px;left:50%;transform:translateX(-50%);
            background:rgba(255,59,48,.92);color:#fff;padding:10px 20px;
            border-radius:22px;font-size:13px;font-weight:600;z-index:9999;
            backdrop-filter:blur(8px);display:none;white-space:nowrap;
        }

        </style>`; 

        // ── Определяем цвет машины из строки ─────────────────────────────────
        function carColorFromString(str) {
            if (!str) return '#aaa';
            const s = str.toLowerCase();
            if (s.includes('бел') || s.includes('white')) return '#f0f0f0';
            if (s.includes('чер') || s.includes('black')) return '#222';
            if (s.includes('сер') || s.includes('grey') || s.includes('gray') || s.includes('silver')) return '#999';
            if (s.includes('крас') || s.includes('red'))  return '#ff453a';
            if (s.includes('син') || s.includes('blue'))  return '#007aff';
            if (s.includes('зел') || s.includes('green')) return '#34c759';
            if (s.includes('жёлт') || s.includes('желт') || s.includes('yellow')) return '#ffd84d';
            return '#aaa';
        }

        // ── Рендер звёзд рейтинга ─────────────────────────────────────────────
        function renderStars(rating) {
            const r = parseFloat(rating) || 0;
            let s = '';
            for (let i=1; i<=5; i++) {
                s += `<i class="fas fa-star ${i <= Math.round(r) ? 'otr-star-full' : 'otr-star-empty'}"></i>`;
            }
            return s;
        }

        // ── Начальный HTML оверлея (Яндекс Go точная копия) ──────────────────
        function buildOverlayHtml(orderId, info) {
            const _t = window.t || (k=>k);
            const payLabel = (info.payment === 'cash') ? _t('cash') : (info.payment ? _t('card') : _t('cash'));
            const price = info.price ? info.price + ' ₸' : '—';
            return `
            <div id="otrMapWrap">
                <div id="otrMapEl"></div>
                <div class="otr-map-topbar">
                    <button class="otr-back" onclick="collapseOrderSheet()"><i class="fas fa-chevron-left"></i></button>
                </div>
                <div class="otr-eta-badge" id="otrEtaBadge">
                    <span class="otr-eta-car">🚗</span><span id="otrEtaText"></span>
                </div>
            </div>
            <div class="otr-sheet" id="otrSheet">
                <!-- РУЧКА ПЕРЕТАСКИВАНИЯ -->
                <div class="otr-handle-zone" id="otrHandleZone" >
                    <div class="otr-sheet-handle"></div>
                </div>
                <!-- СТАТУС ЗАКАЗА -->
                <div id="otrStatusRow" class="otr-status-row" >
                    <div class="otr-status-left">
                        <div class="otr-status-label">${_t('otr_status_label')}</div>
                        <div class="otr-status-main" id="otrStatusMain">${_t('otr_searching')}</div>
                        <div class="otr-status-sub" id="otrStatusSub"></div>
                    </div>
                    <div class="otr-eta-right" id="otrEtaRight">
                        <div class="otr-eta-mins" id="otrEtaMins">—</div>
                        <div class="otr-eta-unit">${_t('min')}</div>
                    </div>
                </div>
                <!-- СКРОЛЛИРУЕМОЕ ТЕЛО -->
                <div id="otrSheetScroll">
                    <div id="otrSheetBody">
                        <div class="otr-search-wrap">
                            <div class="otr-search-ring"><i class="fas fa-taxi otr-search-car"></i></div>
                            <div class="otr-search-title">${_t('otr_searching')}</div>
                            <div class="otr-search-sub">${_t('otr_searching_sub')}</div>
                        </div>
                        <div class="otr-sep"></div>
                        <div class="otr-route-section">
                            <div class="otr-route-item">
                                <div class="otr-route-icon-wrap otr-route-icon-from"><i class="fas fa-person-walking"></i></div>
                                <div class="otr-route-text-wrap">
                                    <div class="otr-route-label">${_t('otr_pickup')}</div>
                                    <div class="otr-route-addr">${info.from || '—'}</div>
                                </div>
                                <div class="otr-route-chevron"><svg width="8" height="13" viewBox="0 0 8 13" fill="none"><path d="M1 1l6 5.5L1 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
                            </div>
                            <div class="otr-route-item">
                                <div class="otr-route-icon-wrap otr-route-icon-to"><i class="fas fa-flag"></i></div>
                                <div class="otr-route-text-wrap">
                                    <div class="otr-route-label">${_t('otr_arrival')}</div>
                                    <div class="otr-route-addr">${info.to || '—'}</div>
                                </div>
                                <div class="otr-route-chevron"><svg width="8" height="13" viewBox="0 0 8 13" fill="none"><path d="M1 1l6 5.5L1 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
                            </div>
                        </div>
                        <div class="otr-add-stop">
                            <div class="otr-add-stop-icon"><i class="fas fa-plus"></i></div>
                            <div class="otr-add-stop-text">${_t('add_stop')}</div>
                            <div class="otr-add-stop-chevron"><svg width="8" height="13" viewBox="0 0 8 13" fill="none"><path d="M1 1l6 5.5L1 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
                        </div>
                        <div class="otr-help-row">
                            <div class="otr-help-icon"><i class="fas fa-headset"></i></div>
                            <div class="otr-help-text">${_t('otr_need_help')}</div>
                            <div class="otr-help-chevron"><svg width="8" height="13" viewBox="0 0 8 13" fill="none"><path d="M1 1l6 5.5L1 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
                        </div>
                        <div class="otr-payment-row">
                            <div class="otr-payment-logo">
                                ${(info.payment === 'cash' || !info.payment) ? '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="1" y="4" width="18" height="12" rx="2" stroke="#34c759" stroke-width="1.5"/><path d="M1 8h18" stroke="#34c759" stroke-width="1.5"/><rect x="3" y="11" width="5" height="2" rx="1" fill="#34c759"/></svg>' : '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="1" y="4" width="18" height="12" rx="2" stroke="#007aff" stroke-width="1.5"/><path d="M1 7h18" stroke="#007aff" stroke-width="2"/></svg>'}
                            </div>
                            <div class="otr-payment-text">
                                <div class="otr-payment-main" id="otrPayMain">${_t('payment_label')}: ${payLabel} · ${price}</div>
                                <div class="otr-payment-sub" id="otrPaySub"></div>
                            </div>
                            <button class="otr-payment-change">${_t('otr_change')}</button>
                        </div>
                        <div class="otr-share-loc-row">
                            <div class="otr-share-loc-icon"><i class="fas fa-location-crosshairs"></i></div>
                            <div class="otr-share-loc-text">${_t('otr_share_location')}</div>
                            <button class="otr-toggle" id="otrShareToggle" onclick="this.classList.toggle('on')"></button>
                        </div>
                        <div class="otr-carrier-row">
                            <div class="otr-carrier-icon"><i class="fas fa-circle-info"></i></div>
                            <div class="otr-carrier-wrap">
                                <div class="otr-carrier-label">${_t('otr_carrier_label')}</div>
                                <div class="otr-carrier-name">Timofeyev Transfer</div>
                            </div>
                            <div class="otr-carrier-chevron"><svg width="8" height="13" viewBox="0 0 8 13" fill="none"><path d="M1 1l6 5.5L1 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
                        </div>
                    </div>
                </div>
                <!-- FOOTER: отмена -->
                <div class="otr-footer" id="otrFooter">
                    <button class="otr-cancel-btn" onclick="cancelActiveOrder(${orderId})">${_t('otr_cancel_trip')}</button>
                </div>
            </div>`;
        }

        // ── DRAGGABLE SHEET ───────────────────────────────────────────────────
        window._sheetExpanded = true;

        window.expandOrderSheet = function() {
            if (window._expandOrderSheet) { window._expandOrderSheet(); return; }
            const sheet = document.getElementById('otrSheet');
            if (!sheet) return;
            window._sheetExpanded = true;
            sheet.classList.remove('otr-collapsed');
            sheet.style.height = '';
            const backBtn = document.querySelector('.otr-back');
            if (backBtn) backBtn.style.display = '';
            setTimeout(() => { if (typeof _trackingMap !== 'undefined' && _trackingMap) _trackingMap.container.fitToViewport(); }, 350);
        };

        window.toggleSheetExpand = function() {
            const sheet = document.getElementById('otrSheet');
            if (!sheet) return;
            if (sheet.classList.contains('otr-collapsed')) window.expandOrderSheet();
            else window.collapseOrderSheet();
        };

        window.collapseOrderSheet = function() {
            if (window._collapseOrderSheet) { window._collapseOrderSheet(); return; }
            const sheet = document.getElementById('otrSheet');
            if (!sheet) return;
            window._sheetExpanded = false;
            sheet.classList.add('otr-collapsed');
            sheet.style.height = '';
            const backBtn = document.querySelector('.otr-back');
            if (backBtn) backBtn.style.display = 'none';
            setTimeout(() => { if (typeof _trackingMap !== 'undefined' && _trackingMap) _trackingMap.container.fitToViewport(); }, 350);
        };

        function initSheetDrag(sheet) {
            // Простой toggle как в Яндекс Go — без drag, только кнопки
            if (!sheet) return;

            function expandSheet() {
                window._sheetExpanded = true;
                sheet.classList.remove('otr-collapsed');
                sheet.style.height = '';
                sheet.style.transition = '';
                const backBtn = document.querySelector('.otr-back');
                if (backBtn) backBtn.style.display = '';
                const chevron = document.getElementById('otrStatusChevron');
                if (chevron) chevron.setAttribute('data-open','1');
                setTimeout(() => {
                    if (typeof _trackingMap !== 'undefined' && _trackingMap) _trackingMap.container.fitToViewport();
                }, 350);
            }

            function collapseSheet() {
                window._sheetExpanded = false;
                sheet.classList.add('otr-collapsed');
                sheet.style.height = '';
                sheet.style.transition = '';
                const backBtn = document.querySelector('.otr-back');
                if (backBtn) backBtn.style.display = 'none';
                const chevron = document.getElementById('otrStatusChevron');
                if (chevron) chevron.removeAttribute('data-open');
                setTimeout(() => {
                    if (typeof _trackingMap !== 'undefined' && _trackingMap) _trackingMap.container.fitToViewport();
                }, 350);
            }

            // Кнопка chevron (^) — сворачивает
            const chevron = document.getElementById('otrStatusChevron');
            if (chevron) {
                chevron.style.cursor = 'pointer';
                chevron.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (sheet.classList.contains('otr-collapsed')) expandSheet();
                    else collapseSheet();
                });
            }

            // Ручка + статус-строка — тогглят
            const handleZone = sheet.querySelector('.otr-handle-zone');
            const statusRow  = sheet.querySelector('.otr-status-row');

            [handleZone, statusRow].forEach(el => {
                if (!el) return;
                el.style.cursor = 'pointer';
                el.addEventListener('click', function(e) {
                    if (sheet.classList.contains('otr-collapsed')) expandSheet();
                    else collapseSheet();
                });
            });

            // Тап по свёрнутому листу (любое место) — разворачивает
            sheet.addEventListener('click', function(e) {
                if (!sheet.classList.contains('otr-collapsed')) return;
                expandSheet();
            });

            // Экспортируем для внешнего использования
            window._expandOrderSheet  = expandSheet;
            window._collapseOrderSheet = collapseSheet;
        }

                function openOrderTracking(orderId, info) {
            _trackingOrderId   = orderId;
            _lastTrackedStatus = null;

            let overlay = document.getElementById('orderTrackingOverlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'orderTrackingOverlay';
                document.body.appendChild(overlay);
            }
            if (!document.getElementById('otrStyles')) {
                document.head.insertAdjacentHTML('beforeend', OTR_STYLES);
            }

            overlay.style.display = 'block';
            overlay.style.flexDirection = '';
            overlay.innerHTML = buildOverlayHtml(orderId, info);
            window._sheetExpanded = true;
            setTimeout(() => initSheetDrag(document.getElementById('otrSheet')), 50);
            // fitToViewport после того как карта инициализируется
            setTimeout(() => { if (_trackingMap) _trackingMap.container.fitToViewport(); }, 600);

            if (_trackingInterval) clearInterval(_trackingInterval);
            _pollFailCount = 0;
            const _oid = String(orderId);
            _trackingInterval = setInterval(() => pollOrderStatus(_oid), 2000);
            pollOrderStatus(_oid);
        }

        async function pollOrderStatus(orderId) {
            try {
                const order = await TF.orders.active();
                _pollFailCount = 0;
                hidePollError();

                if (order && String(order.id) === String(orderId)) {
                    if (_lastTrackedStatus && _lastTrackedStatus !== order.status) {
                        onStatusChanged(order);
                    }
                    _lastTrackedStatus = order.status;
                    const overlay = document.getElementById('orderTrackingOverlay');
                    if (!overlay || overlay.style.display === 'none') {
                        updateActiveOrderCard(order);
                    } else {
                        renderTrackingInfo(orderId, order);
                    }
                    if (order.driver_lat && order.driver_lng) updateDriverOnMap(order);
                    if (['completed','cancelled'].includes(order.status)) {
                        clearInterval(_trackingInterval); _trackingInterval = null;
                    }
                } else if (!order) {
                    // Активного заказа нет — значит завершён или отменён
                    clearInterval(_trackingInterval); _trackingInterval = null;
                    try {
                        const full = await TF.orders.get(String(orderId));
                        if (_lastTrackedStatus !== full.status) onStatusChanged(full);
                        _lastTrackedStatus = full.status;
                        renderTrackingInfo(orderId, full);
                        if (['cancelled','completed'].includes(full.status)) {
                            resetOrderButton();
                            hideActiveOrderCard();
                        }
                    } catch {
                        // Заказ вообще не найден — просто разблокируем кнопку
                        resetOrderButton();
                        hideActiveOrderCard();
                        setTimeout(() => window.closeOrderTracking && window.closeOrderTracking(), 500);
                    }
                }
            } catch (e) {
                _pollFailCount++;
                if (_pollFailCount >= 3) showPollError();
            }
        }

        function showPollError() {
            let el = document.getElementById('otrNetError');
            if (!el) {
                el = document.createElement('div');
                el.id = 'otrNetError';
                el.className = 'otr-net-error';
                el.textContent = window.t ? window.t('no_server') : '⚠️ No server connection…';
                document.body.appendChild(el);
            }
            el.style.display = 'block';
        }
        function hidePollError() {
            const el = document.getElementById('otrNetError');
            if (el) el.style.display = 'none';
        }

        // Сбрасывает кнопку "Заказать" в исходное состояние
        function resetOrderButton() {
            const btn = document.getElementById('orderButton');
            if (btn) {
                btn.disabled = false;
                const txt = document.getElementById('orderButtonText');
                if (txt) txt.textContent = window.t ? window.t('order_btn') : 'Book transfer';
            }
        }

        function onStatusChanged(order) {
            const overlay = document.getElementById('orderTrackingOverlay');
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

            if (order.status === 'accepted') {
                showDriverFoundFlash(order);
                setTimeout(() => {
                    const sh = document.getElementById('otrSheet');
                    if (sh) {
                        sh.classList.remove('otr-state-mini','otr-collapsed');
                        if (!sh.classList.contains('otr-state-mid') && !sh.classList.contains('otr-state-full')) {
                            sh.classList.add('otr-state-mid');
                            window._sheetState = 'mid';
                        }
                    }
                    if (overlay && overlay.style.display === 'none') window.reopenOrderTracking();
                }, 700);
            }
            if (order.status === 'arriving') {
                showArrivingFlash();
                setTimeout(() => {
                    if (overlay && overlay.style.display === 'none') window.reopenOrderTracking();
                }, 700);
            }
            if (order.status === 'in_progress') {
                showInProgressFlash();
            }
            if (order.status === 'completed') {
                showCompletedFlash();
                resetOrderButton();
            }
            if (order.status === 'cancelled') {
                // Заказ отменён (водителем или пассажиром) — закрываем трекинг и разблокируем кнопку
                clearInterval(_trackingInterval); _trackingInterval = null;
                _trackingOrderId = null;
                _lastTrackedStatus = null;
                hideActiveOrderCard();
                resetOrderButton();
                setTimeout(() => window.closeOrderTracking(), 1500);
            }
        }

        function _showFlash(iconHtml, title, sub, borderColor) {
            const isLight = document.body.classList.contains('light-theme');
            const bgColor   = isLight ? '#ffffff'              : '#1e1e1e';
            const textColor = isLight ? '#1c1c1e'              : '#f0f0f0';
            const subColor  = isLight ? 'rgba(60,60,67,.55)'   : 'rgba(255,255,255,.5)';
            const flash = document.createElement('div');
            flash.className = 'otr-flash-overlay';
            flash.innerHTML = `
            <div class="otr-flash-card" style="background:${bgColor};border:1px solid ${borderColor};box-shadow:0 8px 40px rgba(0,0,0,0.55)">
                <div class="otr-flash-ico">${iconHtml}</div>
                <div class="otr-flash-title" style="color:${textColor}">${title}</div>
                <div class="otr-flash-sub"   style="color:${subColor}">${sub}</div>
            </div>`;
            document.body.appendChild(flash);
            flash.addEventListener('click', () => flash.remove());
            setTimeout(() => { flash.style.transition='opacity .3s'; flash.style.opacity='0'; setTimeout(()=>flash.remove(),300); }, 3500);
        }

        function showDriverFoundFlash(order) {
            const _t = window.t || (k=>k);
            const carStr = [order.car_make,order.car_model,order.car_color].filter(Boolean).join(' ');
            const driverName = order.driver_name || _t('driver_default');
            _showFlash(
                `<i class="fas fa-check" style="color:#34c759;font-size:32px"></i>`,
                _t('driver_found_title'),
                `${_t('driver_on_way').replace('{name}', driverName)}${carStr ? '<br><span style="font-size:13px;color:rgba(60,60,67,.6)">' + carStr + '</span>' : ''}`,
                'rgba(52,199,89,.2)'
            );
        }

        function showArrivingFlash() {
            const _t = window.t || (k=>k);
            _showFlash(
                `<i class="fas fa-map-marker-alt" style="color:#ffd84d;font-size:32px"></i>`,
                _t('driver_arrived_title'),
                _t('driver_arrived_sub'),
                'rgba(255,216,77,.2)'
            );
        }

        function showInProgressFlash() {
            const _t = window.t || (k=>k);
            _showFlash(
                `<i class="fas fa-route" style="color:#007aff;font-size:32px"></i>`,
                _t('trip_started_title'),
                _t('trip_started_sub'),
                'rgba(0,122,255,.2)'
            );
        }

        function showCompletedFlash() {
            const _t = window.t || (k=>k);
            _showFlash(
                `<i class="fas fa-flag-checkered" style="color:#34c759;font-size:32px"></i>`,
                _t('status_completed'),
                _t('status_completed_sub'),
                'rgba(52,199,89,.2)'
            );
        }

        // ── Рендер тела листа в зависимости от статуса ────────────────────────
        function renderTrackingInfo(orderId, order) {
            const statusMain = document.getElementById('otrStatusMain');
            const statusSub  = document.getElementById('otrStatusSub');
            const etaRight   = document.getElementById('otrEtaRight');
            const etaMins    = document.getElementById('otrEtaMins');
            const body       = document.getElementById('otrSheetBody');
            const footer     = document.getElementById('otrFooter');
            if (!body) return;

            const cfg = ORDER_STATUS_CFG[order.status] || { key: order.status, subKey: '', icon:'fa-circle', color:'#ffd84d' };
            // Статус в заголовке
            let statusText = window.t ? window.t(cfg.key) : cfg.key;
            if (order.status === 'accepted' && _etaMinutes) {
                statusText = _etaMinutes <= 1
                    ? (window.t ? window.t('status_arriving') : 'Driver nearby!')
                    : (window.t ? window.t('status_accepted_eta').replace('{n}', _etaMinutes) : `~${_etaMinutes} min`);
            }
            if (statusMain) statusMain.textContent = statusText;
            if (statusSub)  statusSub.textContent  = order.status === 'cancelled'
                ? (order.cancel_reason || (window.t ? window.t('status_cancelled_reason') : 'Order was cancelled'))
                : (window.t ? window.t(cfg.subKey) : cfg.subKey);

            // ETA справа — скрываем (Яндекс Go встраивает ETA в заголовок)
            if (etaRight) {
                etaRight.style.display = 'none';
            }

            // ETA badge на карте
            const etaBadge = document.getElementById('otrEtaBadge');
            const etaText  = document.getElementById('otrEtaText');
            if (etaBadge && etaText) {
                if (_etaMinutes && ['accepted','arriving'].includes(order.status)) {
                    etaText.textContent = _etaMinutes <= 1 ? (window.t ? window.t('driver_near') : 'Driver nearby!') : (window.t ? window.t('arriving_eta').replace('{n}', _etaMinutes) : `Arriving in ~${_etaMinutes} min`);
                    etaBadge.style.display = 'block';
                } else {
                    etaBadge.style.display = 'none';
                }
            }

            // Карта: показываем когда водитель назначен
            const mapWrap = document.getElementById('otrMapWrap');
            if (mapWrap) {
                const showMap = ['accepted','arriving','in_progress'].includes(order.status);
                if (showMap && !_trackingMap) {
                    setTimeout(() => initTrackingMap(order), 200);
                }
            }

            // Синхронизируем мини-карточку
            updateActiveOrderCard(order);

            // Тело перерисовываем только при смене статуса
            if (body.dataset.lastStatus === order.status) return;
            body.dataset.lastStatus = order.status;

            const price    = order.price ? Number(order.price).toLocaleString('ru-RU') + ' ₸' : '—';
            const payLabel = order.payment_method === 'cash' ? (window.t ? window.t('pay_cash_label') : 'cash') : (window.t ? window.t('pay_card_label') : 'card');

            // ── Блок водителя (Яндекс Go стиль) ──
            let driverBlock = '';
            if (order.driver_name || order.car_make) {
                const r      = parseFloat(order.driver_rating) || 0;
                const carStr = [order.car_make, order.car_model].filter(Boolean).join(' ');
                const carColor = carColorFromString(order.car_color);
                const initial = (order.driver_name || (window.t ? window.t('driver_default') : 'D')).charAt(0).toUpperCase();
                const starsFull = Math.round(r);

                let starsHtml = '';
                for (let i=1;i<=5;i++) {
                    starsHtml += `<i class="fas fa-star ${i<=starsFull?'otr-star-full':'otr-star-empty'}"></i>`;
                }

                driverBlock = `
                <div class="otr-sep" style="margin-bottom:0"></div>
                <div class="otr-driver-section">
                    <div class="otr-driver-row">
                        <div class="otr-driver-avatar">${initial}</div>
                        <div class="otr-driver-info">
                            <div class="otr-driver-name">${order.driver_name || (window.t?window.t('driver_default'):'Driver')} ${r ? '<span class="otr-rating-num">★' + r.toFixed(2) + '</span>' : ''}</div>
                            ${(carStr || order.car_color) ? `<div class="otr-car-row" style="margin-top:3px;padding:0;">
                                <div class="otr-car-color-dot" style="background:${carColor}"></div>
                                <div class="otr-car-model">${carStr}${order.car_color ? ', ' + order.car_color : ''}</div>
                            </div>` : ''}
                        </div>
                        <div class="otr-driver-car-photo-wrap">
                            <div class="otr-driver-photo">${initial}</div>
                        </div>
                    </div>
                    ${order.car_number ? `<div class="otr-plate-big">${order.car_number}</div>` : ''}
                    <div class="otr-action-row">
                        ${order.driver_phone ? `<a href="tel:${order.driver_phone}" class="otr-action-btn otr-btn-call"><i class="fas fa-phone"></i><span>${window.t?window.t('otr_contact'):'Contact'}</span></a>` : `<button class="otr-action-btn otr-btn-call" style="opacity:.4" disabled><i class="fas fa-phone"></i><span>${window.t?window.t('otr_contact'):'Contact'}</span></button>`}
                        <button class="otr-action-btn otr-btn-safety"><i class="fas fa-shield-halved"></i><span>${window.t?window.t('otr_safety'):'Safety'}</span></button>
                        <button class="otr-action-btn otr-btn-share" onclick="if(navigator.share)navigator.share({title:'Timofeyev Transfer',text:'${window.t?window.t('otr_share_text'):'Tracking ride'} №${orderId}'})"><i class="fas fa-share-nodes"></i><span>${window.t?window.t('otr_share'):'Share'}</span></button>
                    </div>
                </div>`;
            }

            // ── Поиск (только pending) ──
            const _t = window.t || (k=>k);
            const searchBlock = order.status === 'pending' ? `
                <div class="otr-search-wrap">
                    <div class="otr-search-ring"><i class="fas fa-taxi otr-search-car"></i></div>
                    <div class="otr-search-title">${_t('otr_searching')}</div>
                    <div class="otr-search-sub">${_t('otr_searching_sub')}</div>
                </div>` : '';

            // ── Рейтинг (completed) ──
            const ratingBlock = order.status === 'completed' ? `
                <div class="otr-sep" style="margin-bottom:0"></div>
                <div class="otr-rating-card">
                    <div class="otr-rating-title">${_t('otr_rating_title')}</div>
                    <div class="otr-stars-input" id="otrStarsInput">
                        ${[1,2,3,4,5].map(i=>`<button class="otr-star-btn" onclick="selectRatingStar(${i})">★</button>`).join('')}
                    </div>
                    <button class="otr-rate-btn" onclick="submitOrderRating(${orderId})">${_t('otr_rate_btn')}</button>
                </div>` : '';

            // ── ETA label ──
            const etaLabel = _etaMinutes && ['accepted','arriving'].includes(order.status)
                ? _t('otr_pickup_eta').replace('{n}', _etaMinutes)
                : _t('otr_pickup');

            const payMethodLabel = order.payment_method === 'cash' ? _t('cash') : _t('card');

            body.innerHTML = `
            ${searchBlock}
            ${driverBlock}
            <div class="otr-sep" style="margin-bottom:0"></div>
            <!-- МАРШРУТ -->
            <div class="otr-route-section">
                <div class="otr-route-item">
                    <div class="otr-route-icon-wrap otr-route-icon-from">
                        <i class="fas fa-person-walking"></i>
                    </div>
                    <div class="otr-route-text-wrap">
                        <div class="otr-route-label">${etaLabel}</div>
                        <div class="otr-route-addr">${order.from_address || '—'}</div>
                    </div>
                    <div class="otr-route-chevron"><svg width="8" height="13" viewBox="0 0 8 13" fill="none"><path d="M1 1l6 5.5L1 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
                </div>
                <div class="otr-route-item">
                    <div class="otr-route-icon-wrap otr-route-icon-to">
                        <i class="fas fa-flag"></i>
                    </div>
                    <div class="otr-route-text-wrap">
                        <div class="otr-route-label">${_t('otr_arrival')}</div>
                        <div class="otr-route-addr">${order.to_address || '—'}</div>
                    </div>
                    <div class="otr-route-chevron"><svg width="8" height="13" viewBox="0 0 8 13" fill="none"><path d="M1 1l6 5.5L1 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
                </div>
            </div>
            <!-- ДОБАВИТЬ ОСТАНОВКУ -->
            <div class="otr-add-stop">
                <div class="otr-add-stop-icon"><i class="fas fa-plus"></i></div>
                <div class="otr-add-stop-text">${_t('add_stop')}</div>
                <div class="otr-add-stop-chevron"><svg width="8" height="13" viewBox="0 0 8 13" fill="none"><path d="M1 1l6 5.5L1 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            </div>
            <!-- НУЖНА ПОМОЩЬ -->
            <div class="otr-help-row">
                <div class="otr-help-icon"><i class="fas fa-headset"></i></div>
                <div class="otr-help-text">${_t('otr_need_help')}</div>
                <div class="otr-help-chevron"><svg width="8" height="13" viewBox="0 0 8 13" fill="none"><path d="M1 1l6 5.5L1 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            </div>
            <!-- ОПЛАТА -->
            <div class="otr-payment-row">
                <div class="otr-payment-logo">
                    ${order.payment_method === 'cash' ? '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="1" y="4" width="18" height="12" rx="2" stroke="#34c759" stroke-width="1.5"/><path d="M1 8h18" stroke="#34c759" stroke-width="1.5"/><rect x="3" y="11" width="5" height="2" rx="1" fill="#34c759"/></svg>' : '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="1" y="4" width="18" height="12" rx="2" stroke="#007aff" stroke-width="1.5"/><path d="M1 7h18" stroke="#007aff" stroke-width="2"/></svg>'}
                </div>
                <div class="otr-payment-text">
                    <div class="otr-payment-main">${_t('payment_label')}: ${payMethodLabel} · ${price}</div>
                    <div class="otr-payment-sub"></div>
                </div>
                <button class="otr-payment-change">${_t('otr_change')}</button>
            </div>
            <!-- ПОКАЗАТЬ ВОДИТЕЛЮ ГДЕ Я -->
            <div class="otr-share-loc-row">
                <div class="otr-share-loc-icon"><i class="fas fa-location-crosshairs"></i></div>
                <div class="otr-share-loc-text">${_t('otr_share_location')}</div>
                <button class="otr-toggle" id="otrShareToggle" onclick="this.classList.toggle('on')"></button>
            </div>
            <!-- ПЕРЕВОЗЧИК -->
            <div class="otr-carrier-row">
                <div class="otr-carrier-icon"><i class="fas fa-circle-info"></i></div>
                <div class="otr-carrier-wrap">
                    <div class="otr-carrier-label">${_t('otr_carrier_label')}</div>
                    <div class="otr-carrier-name">Timofeyev Transfer</div>
                </div>
                <div class="otr-carrier-chevron"><svg width="8" height="13" viewBox="0 0 8 13" fill="none"><path d="M1 1l6 5.5L1 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            </div>
            ${ratingBlock}`;

            // Footer
            if (footer) {
                if (['completed','cancelled'].includes(order.status)) {
                    footer.innerHTML = `<button class="otr-done-btn" onclick="closeOrderTracking()">${_t('otr_close')}</button>`;
                    hideActiveOrderCard();
                } else if (['pending','accepted'].includes(order.status)) {
                    footer.innerHTML = `<button class="otr-cancel-btn" onclick="cancelActiveOrder(${orderId})">${_t('otr_cancel_trip')}</button>`;
                } else {
                    footer.innerHTML = '';
                }
            }
        }

        // ── КАРТА — инициализация ──────────────────────────────────────────────
        function initTrackingMap(order) {
            if (_trackingMap) { updateDriverOnMap(order); return; }
            if (typeof ymaps === 'undefined') return;

            const lat = parseFloat(order.driver_lat) || parseFloat(order.from_lat) || 43.238;
            const lng = parseFloat(order.driver_lng) || parseFloat(order.from_lng) || 76.889;

            ymaps.ready(function() {
                if (_trackingMap) return;
                _trackingMap = new ymaps.Map('otrMapEl', {
                    center: [lat, lng], zoom: 15, controls: []
                }, { suppressMapOpenBlock: true, openBalloonOnClick: false });
                _trackingMap.behaviors.disable('scrollZoom');
                // Принудительно пересчитываем размер карты
                setTimeout(() => { try { _trackingMap.container.fitToViewport(); } catch(e){} }, 100);

                // Маркер точки подачи (зелёный)
                if (order.from_lat) {
                    _trackingMap.geoObjects.add(new ymaps.Placemark(
                        [parseFloat(order.from_lat), parseFloat(order.from_lng)],
                        { hintContent: (window.t ? window.t('map_pickup_point') : 'Pickup point') },
                        { preset: 'islands#greenCircleDotIcon' }
                    ));
                }

                // Маркер машины (кастомный SVG)
                if (order.driver_lat) {
                    const driverPos = [parseFloat(order.driver_lat), parseFloat(order.driver_lng)];
                    _lastDriverPos  = driverPos;

                    const carLayout = ymaps.templateLayoutFactory.createClass(
                        `<div class="otr-car-marker" id="otrCarIcon">
                            <div class="otr-car-pulse"></div>
                            ${buildCarSvg(0)}
                         </div>`
                    );
                    _driverPlacemark = new ymaps.Placemark(driverPos, {}, {
                        iconLayout: carLayout,
                        iconShape: { type:'Rectangle', coordinates:[[-26,-26],[26,26]] },
                        iconOffset: [-26, -26]
                    });
                    _trackingMap.geoObjects.add(_driverPlacemark);
                    drawDriverRoute(driverPos, [parseFloat(order.from_lat), parseFloat(order.from_lng)]);
                }
            });
        }

        // ── Маршрут водитель → точка подачи ───────────────────────────────────
        function drawDriverRoute(from, to) {
            if (!_trackingMap) return;
            if (_trackingRouteObj) {
                _trackingMap.geoObjects.remove(_trackingRouteObj);
                _trackingRouteObj = null;
            }
            ymaps.route([from, to], { mapStateAutoApply: false }).then(function(route) {
                if (!_trackingMap) return;
                _trackingRouteObj = route;
                route.options.set({
                    routeActiveStrokeWidth: 5,
                    routeActiveStrokeColor: '#34c759',
                    routeStrokeColor: '#34c759',
                    routeStrokeWidth: 4,
                    pinVisible: false
                });
                if (route.getWayPoints) {
                    try { route.getWayPoints().each(p => p.options.set('visible', false)); } catch {}
                }
                _trackingMap.geoObjects.add(route);

                // ETA из маршрута
                const ar = route.getActiveRoute && route.getActiveRoute();
                if (ar && ar.properties) {
                    const dur = ar.properties.get('duration');
                    if (dur) {
                        _etaMinutes = Math.max(1, Math.ceil(dur.value / 60));
                        // обновляем значения ETA в UI
                        const etaMins = document.getElementById('otrEtaMins');
                        if (etaMins) etaMins.textContent = _etaMinutes;
                        const etaRight = document.getElementById('otrEtaRight');
                        if (etaRight) etaRight.style.display = 'block';
                        const etaText = document.getElementById('otrEtaText');
                        if (etaText) etaText.textContent = _etaMinutes <= 1 ? (window.t ? window.t('driver_near') : 'Driver nearby!') : (window.t ? window.t('arriving_eta').replace('{n}', _etaMinutes) : `Arriving in ~${_etaMinutes} min`);
                        const etaBadge = document.getElementById('otrEtaBadge');
                        if (etaBadge) etaBadge.style.display = 'block';
                    }
                }

                if (route.getBounds) {
                    try { _trackingMap.setBounds(route.getBounds(), { checkZoomRange: true, zoomMargin: [80,60,200,60] }); } catch {}
                }
            }).catch(() => {});
        }

        // ── Вычисляем угол между двумя координатами ───────────────────────────
        function calcBearing(from, to) {
            const toRad = d => d * Math.PI / 180;
            const toDeg = r => r * 180 / Math.PI;
            const dLng  = toRad(to[1] - from[1]);
            const lat1  = toRad(from[0]);
            const lat2  = toRad(to[0]);
            const y = Math.sin(dLng) * Math.cos(lat2);
            const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
            return (toDeg(Math.atan2(y, x)) + 360) % 360;
        }

        // ── Обновление маркера с поворотом — пересоздаём layout
        //    (единственный надёжный способ ротации в Яндекс Maps API 2.1) ────
        function updateMarkerLayout(placemark, heading) {
            if (!placemark) return;
            const newLayout = ymaps.templateLayoutFactory.createClass(
                `<div class="otr-car-marker">
                    <div class="otr-car-pulse"></div>
                    ${buildCarSvg(heading)}
                 </div>`
            );
            placemark.options.set('iconLayout', newLayout);
        }

        // ── Обновление маркера водителя (вызывается при каждом poll) ──────────
        function updateDriverOnMap(order) {
            if (!order.driver_lat) return;
            const newPos = [parseFloat(order.driver_lat), parseFloat(order.driver_lng)];

            if (!_trackingMap) {
                // Карта ещё не создана — инициализируем
                const overlay = document.getElementById('orderTrackingOverlay');
                if (overlay && overlay.style.display !== 'none') {
                    setTimeout(() => initTrackingMap(order), 300);
                }
                return;
            }

            if (_driverPlacemark) {
                const prevPos = _lastDriverPos || newPos;

                // Вычисляем направление
                const dist = Math.sqrt(
                    Math.pow(newPos[0]-prevPos[0],2) + Math.pow(newPos[1]-prevPos[1],2)
                );
                if (dist > 0.00001) {
                    _lastDriverHeading = calcBearing(prevPos, newPos);
                }

                updateMarkerLayout(_driverPlacemark, _lastDriverHeading);
                _driverPlacemark.geometry.setCoordinates(newPos);
                _lastDriverPos = newPos;

                // Перерисовываем маршрут при движении (не чаще 1 раза в 10 сек)
                if (!_routeRedrawTimer && order.status === 'accepted' && order.from_lat) {
                    _routeRedrawTimer = setTimeout(() => {
                        drawDriverRoute(newPos, [parseFloat(order.from_lat), parseFloat(order.from_lng)]);
                        _routeRedrawTimer = null;
                    }, 10000);
                }

            } else {
                // Создаём маркер впервые
                _lastDriverPos = newPos;
                _lastDriverHeading = 0;
                const carLayout = ymaps.templateLayoutFactory.createClass(
                    `<div class="otr-car-marker" id="otrCarIcon">
                        <div class="otr-car-pulse"></div>
                        ${buildCarSvg(0)}
                     </div>`
                );
                _driverPlacemark = new ymaps.Placemark(newPos, {}, {
                    iconLayout: carLayout,
                    iconShape: { type:'Rectangle', coordinates:[[-26,-26],[26,26]] },
                    iconOffset: [-26, -26]
                });
                _trackingMap.geoObjects.add(_driverPlacemark);
                if (order.from_lat) {
                    drawDriverRoute(newPos, [parseFloat(order.from_lat), parseFloat(order.from_lng)]);
                }
            }
        }

        // ── Свернуть: лист уменьшается до мини-полоски, карта остаётся видна ──
        window.minimizeOrderTracking = function() {
            window.collapseOrderSheet();
        };

        // ── Закрыть полностью (заказ завершён) ────────────────────────────────
        window.closeOrderTracking = function() {
            if (_trackingInterval) { clearInterval(_trackingInterval); _trackingInterval = null; }
            if (_routeRedrawTimer) { clearTimeout(_routeRedrawTimer);  _routeRedrawTimer = null; }
            if (_trackingMap)      { _trackingMap.destroy(); _trackingMap = null; _driverPlacemark = null; _trackingRouteObj = null; }
            _lastTrackedStatus = null;
            _trackingOrderId   = null;
            _etaMinutes        = null;
            _lastDriverPos     = null;
            _pollFailCount     = 0;
            hidePollError();
            hideActiveOrderCard();
            resetOrderButton();
            const overlay = document.getElementById('orderTrackingOverlay');
            if (overlay) overlay.style.display = 'none';
        };

        // ── Развернуть из свёрнутого состояния ───────────────────────────────
        window.reopenOrderTracking = function() {
            if (!_trackingOrderId) return;
            const overlay = document.getElementById('orderTrackingOverlay');
            if (overlay) {
                overlay.style.display = 'block';
                overlay.style.flexDirection = '';
                window._sheetExpanded = true;
                const sh = overlay.querySelector('#otrSheet');
                if (sh) { sh.classList.remove('otr-collapsed'); sh.style.height = ''; }
                const backBtn = overlay.querySelector('.otr-back');
                if (backBtn) backBtn.style.display = '';
                setTimeout(() => initSheetDrag(document.getElementById('otrSheet')), 50);
                if (!_trackingInterval) {
                    const _oid = String(_trackingOrderId);
                    _pollFailCount = 0;
                    _trackingInterval = setInterval(() => pollOrderStatus(_oid), 2000);
                    pollOrderStatus(_oid);
                }
            }
        };

        // ── Мини-карточка (показывается поверх ДРУГИХ экранов, не трекинга) ──
        // Теперь показывается только если пользователь ушёл из трекинг-экрана
        function showActiveOrderCard() {
            // Если оверлей трекинга открыт — не показываем отдельную карточку
            const overlay = document.getElementById('orderTrackingOverlay');
            if (overlay && overlay.style.display !== 'none') return;
            let card = document.getElementById('activeOrderCard');
            if (!card) {
                card = document.createElement('div');
                card.id = 'activeOrderCard';
                card.innerHTML =
                    '<div class="aoc-inner">' +
                        '<div class="aoc-status-bar" id="aocBar"></div>' +
                        '<div class="aoc-body">' +
                            '<div class="aoc-icon" id="aocIcon"><i class="fas fa-circle-notch fa-spin" id="aocIco"></i></div>' +
                            '<div class="aoc-info">' +
                                '<div class="aoc-status" id="aocStatus">Заказ активен</div>' +
                                '<div class="aoc-sub"    id="aocSub">Нажмите чтобы открыть</div>' +
                            '</div>' +
                            '<div class="aoc-right">' +
                                '<div class="aoc-eta" id="aocEta"></div>' +
                                '<div class="aoc-chevron"><svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 5l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
                            '</div>' +
                        '</div>' +
                    '</div>';
                card.addEventListener('click', window.reopenOrderTracking);
                document.body.appendChild(card);
            }
            requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('aoc-visible')));
        }

        function hideActiveOrderCard() {
            const card = document.getElementById('activeOrderCard');
            if (card) {
                card.classList.remove('aoc-visible');
                setTimeout(() => { if (card.parentNode) card.parentNode.removeChild(card); }, 400);
            }
        }

        function updateActiveOrderCard(order) {
            const card = document.getElementById('activeOrderCard');
            if (!card) return;
            const cfg = ORDER_STATUS_CFG[order.status] || { text: order.status, sub:'', icon:'fa-circle', color:'#ffd84d' };

            const bar  = document.getElementById('aocBar');
            const icon = document.getElementById('aocIcon');
            const ico  = document.getElementById('aocIco');
            const stat = document.getElementById('aocStatus');
            const sub  = document.getElementById('aocSub');
            const eta  = document.getElementById('aocEta');

            if (bar)  bar.style.background  = cfg.color;
            if (icon) icon.style.background = cfg.color + '22';
            if (ico)  { ico.className = 'fas ' + cfg.icon; ico.style.color = cfg.color; }
            if (stat) stat.textContent = cfg.text;
            if (sub) {
                if (order.driver_name) {
                    sub.textContent = order.driver_name +
                        (order.car_make   ? ' · ' + order.car_make   : '') +
                        (order.car_number ? ' · ' + order.car_number : '');
                } else {
                    sub.textContent = cfg.sub || (window.t ? window.t('notif_tap_open') : 'Tap to open');
                }
            }
            if (eta) eta.textContent = _etaMinutes && _etaMinutes > 0 ? (window.t ? window.t('eta_min').replace('{n}', _etaMinutes) : '~' + _etaMinutes + ' min') : '';
            if (ico) ico.classList.toggle('aoc-pulse', order.status === 'pending');
            if (['completed','cancelled'].includes(order.status)) {
                setTimeout(hideActiveOrderCard, 1500);
            }
        }

        // ── Рейтинг ───────────────────────────────────────────────────────────
        window._selectedOrderRating = 0;
        window.selectRatingStar = function(val) {
            window._selectedOrderRating = val;
            document.querySelectorAll('#otrStarsInput .otr-star-btn')
                .forEach((b,i) => b.classList.toggle('lit', i < val));
        };
        window.submitOrderRating = async function(orderId) {
            const rating = window._selectedOrderRating;
            if (!rating) { alert(window.t ? window.t('rating_required') : 'Please select a rating'); return; }
            try {
                await TF.orders.rate(orderId, rating, '');
                const sec = document.querySelector('.otr-rating-card');
                if (sec) sec.innerHTML = '<div style="color:#34c759;text-align:center;padding:20px;font-size:15px;font-weight:600"><i class="fas fa-check-circle" style="font-size:28px;display:block;margin-bottom:10px;color:#34c759"></i>Спасибо за оценку!</div>';
            } catch(e) { alert(e.message || (window.t ? window.t('auth_error_generic') : 'Error')); }
        };

        window.cancelActiveOrder = async function(orderId) {
            if (!confirm(window.t ? window.t('cancel_order_confirm') : 'Cancel this order?')) return;
            try {
                await TF.orders.cancel(orderId, window.t ? window.t('cancel_order_reason') : 'Cancelled by client');
                if (_trackingInterval) { clearInterval(_trackingInterval); _trackingInterval = null; }
                _trackingOrderId = null;
                _lastTrackedStatus = null;
                resetOrderButton();
                hideActiveOrderCard();
                setTimeout(() => window.closeOrderTracking && window.closeOrderTracking(), 1000);
            } catch(e) { alert(e.message || (window.t ? window.t('cancel_order_failed') : 'Could not cancel order')); }
        };

        function formatPrice(price) {
            return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        }
        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }
        let currentAnimatedPrice = 0;
        let animationFrame = null;
        let _finalCalculatedPrice = 0; // Итоговая цена (не анимированная) — используется при создании заказа
        let _priceIsCalculating = false; // true пока идёт пересчёт маршрута или анимация цены

        // Блокирует/разблокирует кнопку заказа в зависимости от состояния пересчёта
        function updateOrderButtonState() {
            const btn = document.getElementById('orderButton');
            if (!btn) return;
            if (_priceIsCalculating || animationFrame !== null) {
                btn.disabled = true;
                btn.style.opacity = '0.6';
                btn.title = window.t ? window.t('price_recalc_wait') : 'Please wait, recalculating price…';
            } else {
                btn.disabled = false;
                btn.style.opacity = '';
                btn.title = '';
            }
        }

        // Per-tariff animation state
        const tariffAnimStates = {};
        function initTariffAnimState(tariffId, initialValue) {
            tariffAnimStates[tariffId] = {
                currentValue: initialValue,
                frameId: null
            };
        }
        function animateTariffPrice(tariffId, targetValue, duration = 700) {
            const priceEl = document.getElementById('tariff-price-' + tariffId);
            if (!priceEl) return;

            if (!tariffAnimStates[tariffId]) {
                initTariffAnimState(tariffId, targetValue);
                priceEl.textContent = formatPrice(targetValue) + ' ₸';
                return;
            }

            const state = tariffAnimStates[tariffId];
            if (state.frameId) {
                cancelAnimationFrame(state.frameId);
                state.frameId = null;
            }

            const startValue = state.currentValue;
            if (startValue === targetValue) return;

            const startTime = performance.now();
            function easeOutQuart(x) { return 1 - Math.pow(1 - x, 4); }

            function tick(now) {
                const elapsed = now - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = easeOutQuart(progress);
                const val = startValue + (targetValue - startValue) * eased;
                state.currentValue = val;
                priceEl.textContent = formatPrice(Math.round(val)) + ' ₸';
                if (progress < 1) {
                    state.frameId = requestAnimationFrame(tick);
                } else {
                    state.currentValue = targetValue;
                    state.frameId = null;
                }
            }
            state.frameId = requestAnimationFrame(tick);
        }

        function animateCounter(element, targetValue, duration = 800, onComplete = null) {
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
            }

            const startValue = currentAnimatedPrice;
            const startTime = performance.now();

            // Кнопка заблокирована пока идёт анимация
            updateOrderButtonState();

            function easeOutQuart(x) {
                return 1 - Math.pow(1 - x, 4);
            }
            function updateCounter(currentTime) {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);

                const easedProgress = easeOutQuart(progress);

                const currentValue = startValue + (targetValue - startValue) * easedProgress;
                currentAnimatedPrice = currentValue;

                element.textContent = formatPrice(Math.round(currentValue));

                if (progress < 1) {
                    animationFrame = requestAnimationFrame(updateCounter);
                } else {
                    animationFrame = null;
                    currentAnimatedPrice = targetValue;
                    updateOrderButtonState(); // анимация завершена — разблокируем кнопку
                    if (onComplete) onComplete();
                }
            }

            animationFrame = requestAnimationFrame(updateCounter);
        }
        function setupBottomSheet() {
            const panel      = document.getElementById('panel');
            const header     = document.getElementById('panelHeader');
            const mapControls = document.getElementById('mapControls');
            if (!panel || !header) return;

            const isMobile = () => window.innerWidth <= 768;

            // Реальная видимая высота экрана (учитывает Safari toolbar и всё прочее)
            function realVH() {
                return window.visualViewport ? window.visualViewport.height
                                             : document.documentElement.clientHeight;
            }

            // Высота свёрнутой панели — меряем реальный scrollHeight содержимого
            function measureCollapsedH() {
                // Временно снимаем overflow:hidden и height чтобы panel показала реальную высоту
                const prevH          = panel.style.height;
                const prevOverflow   = panel.style.overflow;
                const prevTransition = panel.style.transition;
                panel.style.transition = 'none';
                panel.style.height     = 'auto';
                panel.style.overflow   = 'visible';
                const h = panel.scrollHeight;
                panel.style.height     = prevH;
                panel.style.overflow   = prevOverflow;
                panel.style.transition = prevTransition;
                return h + 2; // +2px запас
            }

            function getExpandedH() {
                return Math.floor(realVH() * 0.88);
            }

            // Пересчёт высоты без изменения состояния панели
            window._panelRecalcHeight = function(animate) {
                if (!isMobile()) return;
                if (panel.classList.contains('collapsed')) {
                    applyCollapsed(animate);
                } else {
                    applyExpanded(animate);
                }
            };
            function applyCollapsed(animate) {
                panel.classList.add('collapsed');
                // Немедленно скрываем transition у кнопок и прячем их в правильную позицию
                // чтобы не было "прыжка" с CSS-дефолта
                if (mapControls && isMobile()) {
                    mapControls.style.transition = 'none';
                    // Используем текущий offsetHeight панели как приблизительный — rAF уточнит
                    const approxH = panel.getBoundingClientRect().height || 200;
                    mapControls.style.bottom = (approxH + 16) + 'px';
                }
                // Нужно два rAF: first — браузер применяет collapsed CSS (normal flow),
                // second — высоты элементов пересчитаны
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    const h = measureCollapsedH();
                    panel.style.transition = animate
                        ? 'height 0.3s cubic-bezier(0.25,0.8,0.25,1)'
                        : 'none';
                    panel.style.height = h + 'px';
                    syncUI(h, true, !animate); // instant=true если не анимируем (первая загрузка)
                    if (!animate) requestAnimationFrame(() => { panel.style.transition = ''; });
                }));
            }

            function applyExpanded(animate) {
                panel.classList.remove('collapsed');
                const h = getExpandedH();
                panel.style.transition = animate
                    ? 'height 0.3s cubic-bezier(0.25,0.8,0.25,1)'
                    : 'none';
                panel.style.height = h + 'px';
                syncUI(h, false, !animate);
                if (!animate) requestAnimationFrame(() => { panel.style.transition = ''; });
            }

            function syncUI(panelH, isCollapsed, instant) {
                const phone      = document.querySelector('.phone-panel');
                const marker     = document.getElementById('mapMarker');
                const mapElement = document.getElementById('map');
                const calculator = document.getElementById('calculator');
                
                if (mapControls) {
                    if (isMobile()) {
                        if (instant) {
                            mapControls.style.transition = 'none';
                        } else {
                            mapControls.style.transition = '';
                        }
                        mapControls.style.bottom        = (panelH + 16) + 'px';
                        mapControls.style.opacity       = isCollapsed ? '1' : '0';
                        mapControls.style.visibility    = isCollapsed ? 'visible' : 'hidden';
                        mapControls.style.pointerEvents = isCollapsed ? 'auto' : 'none';
                    } else {
                        mapControls.style.transition    = '';
                        mapControls.style.opacity       = '1';
                        mapControls.style.visibility    = 'visible';
                        mapControls.style.pointerEvents = 'auto';
                        mapControls.style.bottom        = '';
                    }
                }
                if (phone) {
                    phone.style.opacity       = isCollapsed ? '1' : '0';
                    phone.style.visibility    = isCollapsed ? 'visible' : 'hidden';
                    phone.style.pointerEvents = isCollapsed ? 'auto' : 'none';
                }

                // Центр маркера считаем как середину между нижней границей верхнего блока
                // (телефонная плашка или просто верх карты) и верхней границей нижней панели.
                if (marker && calculator && isMobile()) {
                    if (isCollapsed) {
                        const calcRect  = calculator.getBoundingClientRect();
                        const panelRect = panel.getBoundingClientRect();
                        const phoneRect = phone ? phone.getBoundingClientRect() : null;

                        const topObstruction    = phoneRect ? phoneRect.bottom : calcRect.top;
                        const bottomObstruction = panelRect.top;

                        const centerY  = (topObstruction + bottomObstruction) / 2;
                        const markerY  = centerY - calcRect.top; // координата относительно calculator

                        marker.style.top = `${markerY}px`;
                    } else {
                        // В развернутом состоянии — обычный центр экрана.
                        marker.style.top = '50%';
                    }
                }

                // Карту не двигаем transform'ом — она всегда заполняет экран,
                // а «виртуальный центр» задаём положением маркера.
                if (mapElement) {
                    mapElement.style.transform = 'translateY(0)';
                }
            }

            // Инициализация
            if (isMobile()) {
                applyCollapsed(false);
            } else {
                panel.classList.remove('collapsed');
                panel.style.height = '';
                panel.style.transition = '';
                syncUI(0, false);
            }

            const onResize = debounce(() => {
                if (!isMobile()) {
                    panel.classList.remove('collapsed');
                    panel.style.height = '';
                    syncUI(0, false);
                    return;
                }
                if (panel.classList.contains('collapsed')) applyCollapsed(false);
                else applyExpanded(false);
            }, 80);
            window.addEventListener('resize', onResize);
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', onResize);
            }

            // --- Touch drag ---
            let sy = 0, sh = 0, cy = 0;
            let dragging = false, moved = false, wasCollapsed = true;
            let cachedCollapsedH = 0;

            header.addEventListener('click', () => {
                if (moved) { moved = false; return; }
                if (!isMobile()) return;
                if (panel.classList.contains('collapsed')) applyExpanded(true);
                else applyCollapsed(true);
            });

            header.addEventListener('touchstart', (e) => {
                if (!isMobile() || !e.touches[0]) return;
                dragging = true; moved = false;
                sy = cy = e.touches[0].clientY;
                sh = panel.getBoundingClientRect().height;
                wasCollapsed = panel.classList.contains('collapsed');
                cachedCollapsedH = wasCollapsed ? sh : measureCollapsedH();
                panel.style.transition = 'none';
                // Если свёрнута — временно переводим в absolute-flow для перетяжки
                if (wasCollapsed) {
                    panel.style.display = '';
                }
            }, { passive: true });

            header.addEventListener('touchmove', (e) => {
                if (!dragging || !e.touches[0]) return;
                e.preventDefault();
                cy = e.touches[0].clientY;
                const dy = cy - sy;
                if (Math.abs(dy) > 8) moved = true;
                const minH = cachedCollapsedH;
                const maxH = getExpandedH();
                const newH = Math.max(minH, Math.min(maxH, sh - dy));
                panel.style.height = newH + 'px';
                // Синхронизируем кнопки: без transition (instant), opacity пропорционально положению
                if (mapControls && isMobile()) {
                    mapControls.style.transition = 'none';
                    mapControls.style.bottom = (newH + 16) + 'px';
                    // Плавно скрываем по мере раскрытия панели
                    const ratio = Math.max(0, Math.min(1, (maxH - newH) / Math.max(1, maxH - minH)));
                    const opacity = 1 - ratio;
                    mapControls.style.opacity = opacity.toFixed(3);
                    mapControls.style.visibility = opacity > 0.01 ? 'visible' : 'hidden';
                    mapControls.style.pointerEvents = opacity > 0.5 ? 'auto' : 'none';
                }
            }, { passive: false });

            header.addEventListener('touchend', () => {
                if (!dragging) return;
                dragging = false;
                if (!moved) return;
                const dy = cy - sy;
                if      (dy < -40) applyExpanded(true);
                else if (dy >  40) applyCollapsed(true);
                else wasCollapsed ? applyCollapsed(true) : applyExpanded(true);
            });
        }
        document.getElementById('paymentOverlay').addEventListener('click', function(e) {
            if (e.target === this) {
                closePaymentModal();
            }
        });
        document.getElementById('addCardOverlay').addEventListener('click', function(e) {
            if (e.target === this) {
                closeAddCardModal();
            }
        });
    
// ========== ПЕРЕКЛЮЧЕНИЕ ТЕМЫ ==========
function toggleTheme() {
    const body = document.body;
    body.classList.toggle('light-theme');
    const isLight = body.classList.contains('light-theme');

    // Обновляем все иконки темы (в топбаре, домашнем экране и drawer)
    document.querySelectorAll('.theme-icon, .hs-theme-icon').forEach(function(icon) {
        icon.classList.toggle('fa-moon', !isLight);
        icon.classList.toggle('fa-sun',  isLight);
    });

    // Синхронизируем чекбокс и подпись в drawer
    var chk = document.getElementById('hsThemeToggleCheck');
    if (chk) chk.checked = isLight;
    var label = document.getElementById('hsDrawerThemeLabel');
    if (label) label.textContent = isLight ? (window.t ? window.t('theme_light_on') : 'Light mode on') : (window.t ? window.t('theme_dark_on') : 'Dark mode on');

    localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

// Загружаем сохраненную тему при старте
document.addEventListener('DOMContentLoaded', function() {
    const savedTheme = localStorage.getItem('theme');
    const isLight = savedTheme === 'light';
    if (isLight) document.body.classList.add('light-theme');

    document.querySelectorAll('.theme-icon, .hs-theme-icon').forEach(function(icon) {
        icon.classList.toggle('fa-moon', !isLight);
        icon.classList.toggle('fa-sun',  isLight);
    });

    // Синхронизируем drawer при загрузке
    var chk = document.getElementById('hsThemeToggleCheck');
    if (chk) chk.checked = isLight;
    // Тема-лейбл — устанавливается через applyTranslations после load
    // Здесь ставим заглушку на основе языка из localStorage
    var label = document.getElementById('hsDrawerThemeLabel');
    if (label) {
        const lang = localStorage.getItem('tf_lang') || 'ru';
        const themeTexts = {
            ru: { light: 'Светлая тема включена', dark: 'Тёмная тема включена' },
            en: { light: 'Light mode on',          dark: 'Dark mode on' },
        };
        const texts = themeTexts[lang] || themeTexts.ru;
        label.textContent = isLight ? texts.light : texts.dark;
    }
});
/* ================================================================
   ГЛАВНЫЙ ЭКРАН — логика
   ================================================================ */
(function() {
    const hs = document.getElementById('homeScreen');
    const calc = document.getElementById('calculator');
    const topbar = document.querySelector('.topbar-wrap');
    const calcMenuBtn = document.querySelector('.calc-menu-btn');

    // При загрузке — НЕ скрываем calculator через display:none!
    // Карта должна инициализироваться нормально. Домашний экран (position:fixed, z-index:9999)
    // просто перекрывает всё сверху. Кнопку меню скрываем до перехода в калькулятор.
    if (topbar) {
        topbar.style.opacity = '0';
        topbar.style.pointerEvents = 'none';
        topbar.style.transition = 'opacity 0.3s ease';
    }
    if (calcMenuBtn) {
        calcMenuBtn.style.display = 'none';
    }

    // Пагинация — анимируется по скроллу ленты тарифов
    var tariffStrip = document.getElementById('hsTariffStrip');
    var hsDots = document.querySelectorAll('.hs-dot');
    if (tariffStrip && hsDots.length) {
        tariffStrip.addEventListener('scroll', function() {
            var total = tariffStrip.scrollWidth - tariffStrip.clientWidth;
            var pos = total > 0 ? tariffStrip.scrollLeft / total : 0;
            var idx = Math.round(pos * (hsDots.length - 1));
            hsDots.forEach(function(d, i) { d.classList.toggle('active', i === idx); });
        });
    }
    // Активный чип
    var tariffChips = document.querySelectorAll('.hs-tariff-chip');
    tariffChips.forEach(function(chip) {
        chip.addEventListener('click', function() {
            tariffChips.forEach(function(c) { c.classList.remove('active'); });
            chip.classList.add('active');
        });
    });

    // ЗАГЛУШКИ (были нужны для старой логики страниц)
    var _calcHideTimer = null; // отслеживаем таймер скрытия чтобы отменить при возврате

    // Открыть калькулятор (такси)
    window.openCalculator = function() {
        if (!hs) return;
        if (_calcHideTimer) { clearTimeout(_calcHideTimer); _calcHideTimer = null; }
        // postMessage → Тильда меняет URL на /order/map
        try {
            if (window.self !== window.top) {
                window.parent.postMessage({ tfNavigate: 'order/map' }, '*');
                console.log('[TF] postMessage → order/map');
            }
        } catch(e) { console.warn('[TF] postMessage error', e); }
        hs.classList.add('hs-hidden');
        // Показываем кнопку меню в калькуляторе (плавно)
        if (topbar) {
            topbar.style.opacity = '1';
            topbar.style.pointerEvents = 'auto';
        }
        if (calcMenuBtn) {
            calcMenuBtn.style.display = 'flex';
        }
        _calcHideTimer = setTimeout(function() {
            _calcHideTimer = null;
            hs.style.display = 'none';
            // После скрытия домашнего экрана — перезапускаем layout панели
            // чтобы она корректно пересчитала высоту
            window.dispatchEvent(new Event('resize'));
        }, 360);
    };

    // Кнопка "назад" для возврата на главный экран
    window.returnToHomeScreen = function() {
        if (!hs) return;

        // postMessage → Тильда меняет URL на /order
        try {
            if (window.self !== window.top) {
                window.parent.postMessage({ tfNavigate: 'order' }, '*');
                console.log('[TF] postMessage → order');
            }
        } catch(e) { console.warn('[TF] postMessage error', e); }

        // Отменяем таймер скрытия из openCalculator (если ещё не сработал)
        if (_calcHideTimer) { clearTimeout(_calcHideTimer); _calcHideTimer = null; }

        // Скрываем кнопку меню калькулятора
        if (calcMenuBtn) {
            calcMenuBtn.style.display = 'none';
        }

        // Скрываем кнопки карты при возврате
        var mc = document.getElementById('mapControls');
        if (mc) {
            mc.style.opacity = '0';
            mc.style.visibility = 'hidden';
            mc.style.pointerEvents = 'none';
        }

        // Скрываем topbar
        if (topbar) {
            topbar.style.opacity = '0';
            topbar.style.pointerEvents = 'none';
        }

        // Ставим начальное состояние: снизу и прозрачный — без анимации
        hs.style.opacity = '0';
        hs.style.transform = 'translateY(30px)';
        hs.style.transition = 'none';
        hs.style.display = '';
        // Убираем hs-hidden если вдруг остался
        hs.classList.remove('hs-hidden');

        // Двойной rAF: гарантирует что браузер отрисовал начальный кадр,
        // потом включаем transition и сбрасываем стили → плавный вход снизу
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                hs.style.transition = '';
                hs.style.opacity = '';
                hs.style.transform = '';
            });
        });
    };

    // ── Открыть боковое меню ──
    window.toggleHsMenu = function() {
        var drawer  = document.getElementById('hsDrawer');
        var overlay = document.getElementById('hsDrawerOverlay');
        if (!drawer) return;
        if (drawer.classList.contains('is-open')) {
            closeHsMenu();
        } else {
            // Определяем с какого экрана открывается меню
            var homeScreen = document.getElementById('homeScreen');
            var fromMap = homeScreen && homeScreen.style.display === 'none';
            if (fromMap) {
                drawer.classList.add('from-map');
            } else {
                drawer.classList.remove('from-map');
            }
            drawer.classList.add('is-open');
            overlay.classList.add('is-open');
            document.body.style.overflow = 'hidden';
            // Синхронизируем чекбокс темы
            var chk = document.getElementById('hsThemeToggleCheck');
            if (chk) chk.checked = document.body.classList.contains('light-theme');
            updateDrawerThemeLabel();
            // Обновляем видимость кнопок меню при каждом открытии
            if (typeof TF !== 'undefined' && TF.auth.isLoggedIn()) {
                TF.auth.me().then(function(me) {
                    if (me) {
                        localStorage.setItem('tf_user', JSON.stringify(me));
                        if (typeof updateDrawerModeBlock === 'function') updateDrawerModeBlock(me);
                    }
                }).catch(function() {
                    // Если API недоступен — используем закешированные данные
                    var cached = TF.auth.getUser();
                    if (cached && typeof updateDrawerModeBlock === 'function') {
                        updateDrawerModeBlock(cached);
                    }
                });
            } else {
                // Не авторизован — показываем только "Работа водителем"
                var sg = document.getElementById('hsModeSwitcherGroup');
                var wg = document.getElementById('hsDriverWorkGroup');
                if (sg) sg.style.display = 'none';
                if (wg) wg.style.display = '';
            }
        }
    };

    window.closeHsMenu = function() {
        var drawer  = document.getElementById('hsDrawer');
        var overlay = document.getElementById('hsDrawerOverlay');
        if (!drawer) return;
        drawer.classList.remove('is-open');
        overlay.classList.remove('is-open');
        document.body.style.overflow = '';
    };

    function updateDrawerThemeLabel() {
        var label = document.getElementById('hsDrawerThemeLabel');
        if (!label) return;
        const _t = window.t || (k=>k);
        label.textContent = document.body.classList.contains('light-theme')
            ? _t('theme_light_on')
            : _t('theme_dark_on');
        var chk = document.getElementById('hsThemeToggleCheck');
        if (chk) chk.checked = document.body.classList.contains('light-theme');
    }

    // Закрытие свайпом влево
    (function() {
        var drawer = document.getElementById('hsDrawer');
        if (!drawer) return;
        var startX = 0, startY = 0, dragging = false;
        drawer.addEventListener('touchstart', function(e) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            dragging = true;
        }, { passive: true });
        drawer.addEventListener('touchend', function(e) {
            if (!dragging) return;
            dragging = false;
            var dx = e.changedTouches[0].clientX - startX;
            var dy = Math.abs(e.changedTouches[0].clientY - startY);
            var fromMap = drawer.classList.contains('from-map');
            // Слева — свайп влево закрывает; справа — свайп вправо закрывает
            if (!fromMap && dx < -60 && dy < 60) closeHsMenu();
            if (fromMap  && dx >  60 && dy < 60) closeHsMenu();
        }, { passive: true });
    })();

    // Загрузка темы
    document.addEventListener('DOMContentLoaded', function() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'light') {
            document.body.classList.add('light-theme');
        }
    });
})();
/* ================================================================
   ЭКРАН «РАБОТА ВОДИТЕЛЕМ»
   ================================================================ */


window.closeDriverScreen = function() {
    var screen = document.getElementById('driverScreen');
    if (screen) screen.classList.remove('is-open');
};

        // ─── Driver Application Modal ─────────────────────────
        let _drvSelectedTariffType = 'sedan';

        function openDrvAppModal() {
            document.getElementById('drvAppOverlay').classList.add('active');
            document.getElementById('drvAppSheet').classList.add('active');
            document.body.style.overflow = 'hidden';
            // Выбор тарифа чипами
            document.querySelectorAll('.drvapp-tariff-chip').forEach(chip => {
                chip.addEventListener('click', function() {
                    document.querySelectorAll('.drvapp-tariff-chip').forEach(c => c.classList.remove('active'));
                    this.classList.add('active');
                    _drvSelectedTariffType = this.dataset.type;
                });
            });
        }
        function closeDrvAppModal() {
            document.getElementById('drvAppOverlay').classList.remove('active');
            document.getElementById('drvAppSheet').classList.remove('active');
            document.body.style.overflow = '';
        }
        window.closeDrvAppModal = closeDrvAppModal;

        window.submitDriverApplication = async function() {
            const make    = document.getElementById('drvCarMake').value.trim();
            const model   = document.getElementById('drvCarModel').value.trim();
            const year    = document.getElementById('drvCarYear').value.trim();
            const color   = document.getElementById('drvCarColor').value.trim();
            const number  = document.getElementById('drvCarNumber').value.trim().toUpperCase();
            const license = document.getElementById('drvLicense').value.trim();
            const errEl   = document.getElementById('drvAppError');

            if (!make || !model) {
                errEl.textContent = window.t ? window.t('drv_error_fields') : 'Please enter car make and model';
                errEl.style.display = 'block';
                return;
            }
            errEl.style.display = 'none';

            const btn = document.getElementById('drvAppSubmitBtn');
            btn.disabled = true; btn.textContent = window.t ? window.t('drv_submitting') : 'Submitting...';

            try {
                await TF.drivers.apply({
                    car_make:         make,
                    car_model:        model,
                    car_year:         year || null,
                    car_color:        color || null,
                    car_number:       number || null,
                    car_class:        'comfort',
                    car_tariff_type:  _drvSelectedTariffType,
                    car_display_name: make + ' ' + model,
                    license_number:   license || null,
                });
                closeDrvAppModal();
                // Показываем успех
                const overlay = document.getElementById('drvModalOverlay');
                if (overlay) overlay.classList.add('is-open');
                // Обновляем кнопку на экране водителя
                const ctaBtn = document.querySelector('.drv-cta-btn');
                if (ctaBtn) {
                    ctaBtn.disabled = true;
                    ctaBtn.querySelector('.drv-cta-main').textContent = window.t ? window.t('drv_pending_main') : 'Application under review';
                    ctaBtn.querySelector('.drv-cta-sub').textContent = window.t ? window.t('drv_pending_sub_text') : "We'll call you back";
                    ctaBtn.style.opacity = '0.6';
                }
            } catch(err) {
                if (err.message && err.message.includes('заявка')) {
                    errEl.textContent = window.t ? window.t('drv_already_sent') : 'Application already submitted';
                } else {
                    errEl.textContent = err.message || (window.t ? window.t('drv_error_later') : 'Error. Please try again later.');
                }
                errEl.style.display = 'block';
                btn.disabled = false; btn.textContent = window.t ? window.t('drvapp_submit') : 'Submit application';
            }
        };

        window.openDriverApplication = async function() {
            if (!TF.auth.isLoggedIn()) {
                closeDriverScreen();
                setTimeout(function() { openAuthScreen(); }, 300);
                return;
            }
            var user = TF.auth.getUser();
            if (user.role === 'driver') {
                try {
                    var me = await TF.auth.me();
                    if (me.driver && me.driver.status === 'approved') {
                        closeDriverScreen();
                        if (typeof switchAppMode === 'function') switchAppMode('driver');
                        return;
                    }
                } catch(e) {}
            }
            openDrvAppModal();
        };

window.closeDrvModal = function() {
    var overlay = document.getElementById('drvModalOverlay');
    if (overlay) overlay.classList.remove('is-open');
};

// При открытии экрана водителя — проверяем текущий статус заявки
window.openDriverScreen = function() {
    closeHsMenu();
    setTimeout(async function() {
        var screen = document.getElementById('driverScreen');
        if (screen) screen.classList.add('is-open');

        if (TF.auth.isLoggedIn()) {
            var user = TF.auth.getUser();
            if (user.role === 'driver') {
                try {
                    var me = await TF.auth.me();
                    if (me.driver && me.driver.status === 'approved') {
                        // ★ Вместо редиректа — закрываем экран и открываем переключатель в меню
                        if (screen) screen.classList.remove('is-open');
                        if (typeof updateDrawerModeBlock === 'function') updateDrawerModeBlock(me);
                        toggleHsMenu();
                        return;
                    }
                    // Статус заявки — обновляем кнопку
                    var btn = document.querySelector('.drv-cta-btn');
                    if (btn && me.driver) {
                        var statusMap = {
                            pending:  { main: window.t ? window.t('drv_pending_main') : 'Application under review',   sub: window.t ? window.t('drv_pending_sub_text') : "We'll call you back" },
                            approved: { main: window.t ? window.t('drv_approved_main') : 'Switch to driver mode',     sub: '' },
                            rejected: { main: window.t ? window.t('drv_rejected_main') : 'Submit again',              sub: window.t ? window.t('drv_rejected_sub') : 'Contact support' }
                        };
                        var s = statusMap[me.driver.status];
                        if (s) {
                            btn.querySelector('.drv-cta-main').textContent = s.main;
                            btn.querySelector('.drv-cta-sub').textContent  = s.sub;
                            if (me.driver.status === 'pending') {
                                btn.disabled = true;
                                btn.style.opacity = '0.6';
                            }
                        }
                    }
                } catch(e) {}
            }
        }
    }, 200);
};

// Свайп вправо чтобы закрыть экран водителя
(function() {
    var screen = document.getElementById('driverScreen');
    if (!screen) return;
    var startX = 0, startY = 0;
    screen.addEventListener('touchstart', function(e) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });
    screen.addEventListener('touchend', function(e) {
        var dx = e.changedTouches[0].clientX - startX;
        var dy = Math.abs(e.changedTouches[0].clientY - startY);
        if (dx > 80 && dy < 80) closeDriverScreen();
    }, { passive: true });
})();

/* ================================================================
   ЭКРАН АВТОРИЗАЦИИ
   ================================================================ */





// Свайп вправо для закрытия
(function() {
    var screen = document.getElementById('authScreen');
    if (!screen) return;
    var startX = 0, startY = 0;
    screen.addEventListener('touchstart', function(e) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });
    screen.addEventListener('touchend', function(e) {
        var dx = e.changedTouches[0].clientX - startX;
        var dy = Math.abs(e.changedTouches[0].clientY - startY);
        if (dx > 80 && dy < 80) closeAuthScreen();
    }, { passive: true });
})();

window.formatPhone = function(input) {
    var clearBtn = document.getElementById('authClearBtn');
    var val = input.value.replace(/\D/g, '').slice(0, 10);
    var formatted = '';
    if (val.length > 0) formatted = '(' + val.slice(0, 3);
    if (val.length >= 4) formatted += ') ' + val.slice(3, 6);
    if (val.length >= 7) formatted += '-' + val.slice(6, 8);
    if (val.length >= 9) formatted += '-' + val.slice(8, 10);
    input.value = formatted;
    if (clearBtn) clearBtn.style.display = val.length > 0 ? 'flex' : 'none';
};
window.clearPhone = function() {
    var input = document.getElementById('authPhoneInput');
    var clearBtn = document.getElementById('authClearBtn');
    if (input) { input.value = ''; input.focus(); }
    if (clearBtn) clearBtn.style.display = 'none';
};
window.toggleCountryPicker = function() {};
/* ================================================================
   ПЕРЕКЛЮЧАТЕЛЬ РЕЖИМОВ: Пассажир ↔ Водитель
   ================================================================ */

// ============================================================
// ПЕРЕКЛЮЧАТЕЛЬ РЕЖИМОВ: Пассажир ↔ Водитель + кнопка Админ
// ============================================================

window._tfPersistCapabilities = function(me) {
    if (!me) return;
    // tf_is_admin хранится ТОЛЬКО для внутреннего использования в switchAppMode('admin').
    // Для видимости кнопки «Панель администратора» используется me.is_admin из API.
    if (me.is_admin) localStorage.setItem('tf_is_admin', '1');
    else localStorage.removeItem('tf_is_admin'); // чистим при входе не-администратора
    if (me.driver && me.driver.status === 'approved') localStorage.setItem('tf_is_driver', '1');
};

window.updateDrawerModeBlock = function(me) {
    if (!me) return;
    window._tfPersistCapabilities(me);

    var switcherGroup = document.getElementById('hsModeSwitcherGroup');
    var workGroup     = document.getElementById('hsDriverWorkGroup');
    var adminGroup    = document.getElementById('hsAdminGroup');
    var tabClient     = document.getElementById('hsModeTabClient');
    var tabDriver     = document.getElementById('hsModeTabDriver');

    var hasDriver = !!(me.driver && me.driver.status === 'approved')
                    || localStorage.getItem('tf_is_driver') === '1';
    // ★ hasAdmin проверяется ТОЛЬКО по полю is_admin из API-ответа.
    //   localStorage.tf_is_admin НЕ используется для показа кнопки —
    //   это исключает показ кнопки «Панель администратора» не-администраторам.
    var hasAdmin  = !!(me.is_admin);

    // Переключатель Пассажир/Водитель — только для одобренных водителей
    if (switcherGroup) switcherGroup.style.display = hasDriver ? '' : 'none';
    // Жёлтая кнопка "Работа водителем" — только если НЕ одобренный водитель И НЕ администратор
    if (workGroup) workGroup.style.display = (!hasDriver && !hasAdmin) ? '' : 'none';
    // Кнопка "Панель администратора" — только для админов
    if (adminGroup) adminGroup.style.display = hasAdmin ? '' : 'none';

    // Активный таб переключателя водитель/пассажир
    if (hasDriver && tabClient && tabDriver) {
        var isDriver = me.role === 'driver';
        tabDriver.style.background = isDriver ? '#fc3f1e' : 'transparent';
        tabDriver.style.color      = isDriver ? '#fff'    : '#8e8e93';
        tabClient.style.background = isDriver ? 'transparent' : '#fc3f1e';
        tabClient.style.color      = isDriver ? '#8e8e93' : '#fff';
    }
};

window.switchAppMode = async function(mode) {
    var tabClient = document.getElementById('hsModeTabClient');
    var tabDriver = document.getElementById('hsModeTabDriver');

    // Переход в админку — копируем tf_token в admin_token и идём на admin.html.
    // admin.html/boot() проверяет ТОЛЬКО admin_token, поэтому без этого шага авто-вход невозможен.
    // ВАЖНО: admin_token устанавливается прямо перед window.location.replace() — это атомарная
    // операция. Если переход не произойдёт (ошибка), index.html при следующей загрузке
    // автоматически очистит admin_token (см. DOMContentLoaded в начале файла).
    if (mode === 'admin') {
        var token = localStorage.getItem('tf_token');
        if (!token) { alert(window.t ? window.t('mode_login_required') : 'Please sign in'); return; }
        localStorage.setItem('tf_is_admin', '1');
        closeHsMenu && closeHsMenu();
        try {
            // Устанавливаем admin_token и сразу же редиректим — не даём ему «зависнуть»
            localStorage.setItem('admin_token', token);
            if (window.self !== window.top) { window.parent.postMessage({ tfNavigate: 'admin' }, '*'); }
            else { window.location.replace('admin.html'); } // replace() — прямой переход без записи в истории
        } catch(e) {
            localStorage.setItem('admin_token', token);
            window.location.replace('admin.html');
        }
        return;
    }

    // Оптимистичное обновление табов (только для driver/client)
    if (tabClient) { tabClient.style.background = mode === 'client' ? '#fc3f1e' : 'transparent'; tabClient.style.color = mode === 'client' ? '#fff' : '#8e8e93'; }
    if (tabDriver) { tabDriver.style.background = mode === 'driver' ? '#fc3f1e' : 'transparent'; tabDriver.style.color = mode === 'driver' ? '#fff' : '#8e8e93'; }

    try {
        await TF.auth.switchRole(mode);

        if (mode === 'driver') {
            try {
                if (window.self !== window.top) { window.parent.postMessage({ tfNavigate: 'driver' }, '*'); }
                else { window.location.replace('driver.html'); }
            } catch(e) { window.location.replace('driver.html'); }
        } else {
            // client — остаёмся, закрываем меню
            if (window.closeHsMenu) window.closeHsMenu();
        }
    } catch (e) {
        // Откатываем табы при ошибке
        var stored = null;
        try { stored = JSON.parse(localStorage.getItem('tf_user') || '{}'); } catch(ex) {}
        var prevRole = stored && stored.role ? stored.role : 'client';
        if (tabClient) { tabClient.style.background = prevRole === 'client' ? '#fc3f1e' : 'transparent'; tabClient.style.color = prevRole === 'client' ? '#fff' : '#8e8e93'; }
        if (tabDriver) { tabDriver.style.background = prevRole === 'driver' ? '#fc3f1e' : 'transparent'; tabDriver.style.color = prevRole === 'driver' ? '#fff' : '#8e8e93'; }
        alert(e.message || (window.t ? window.t('mode_switch_error') : 'Could not switch mode. Please try again.'));
    }
};
// ============================================================
// TILDA BRIDGE v3 — ?screen= автооткрытие
// ============================================================
window.addEventListener('load', function () {
    var inIframe = (window.self !== window.top);
    console.log('[TF Bridge] loaded. inIframe=' + inIframe);

    var params = new URLSearchParams(window.location.search);
    var screen = params.get('screen');
    if (!screen) return;

    console.log('[TF Bridge] ?screen=' + screen);

    setTimeout(function () {
        if (screen === 'map') {
            console.log('[TF Bridge] calling openCalculator()');
            if (typeof window.openCalculator === 'function') {
                window.openCalculator();
            } else {
                console.warn('[TF Bridge] openCalculator not found!');
            }
        } else if (screen === 'account') {
            console.log('[TF Bridge] calling toggleHsMenu()');
            if (typeof window.toggleHsMenu === 'function') {
                window.toggleHsMenu();
            }
        }
    }, 500);
});
/* ================================================================
   ПЕРЕКЛЮЧАТЕЛЬ РЕЖИМОВ: Пассажир ↔ Администратор
   ================================================================ */

// ── Обратная совместимость: updateDrawerAdminBlock → updateDrawerModeBlock ──
window.updateDrawerAdminBlock = function(me) {
    window.updateDrawerModeBlock(me);
};

// ── switchToAdmin: функция для совместимости — требует явного подтверждения ──
// (переименована чтобы предотвратить случайный вызов из старого Tilda-кода)
window._switchToAdmin_legacy = function() {
    window.switchAppMode('admin');
};
// window.switchToAdmin НЕ экспортируется глобально, чтобы старый Tilda-код не вызвал редирект

// ── Патч TF.auth.logout: очищаем флаги ролей при выходе ──
document.addEventListener('DOMContentLoaded', function() {
    if (typeof TF === 'undefined') return;
    var _origLogout = TF.auth.logout.bind(TF.auth);
    TF.auth.logout = async function() {
        await _origLogout();
        localStorage.removeItem('tf_is_admin');
        localStorage.removeItem('tf_is_driver');
        localStorage.removeItem('admin_token');
        // Сбрасываем переключатель режимов
        var switcherGroup = document.getElementById('hsModeSwitcherGroup');
        var workGroup     = document.getElementById('hsDriverWorkGroup');
        if (switcherGroup) switcherGroup.style.display = 'none';
        if (workGroup)     workGroup.style.display = '';
    };
}); 

/* ================================================================
   SOCIAL AUTH — Вход через Google, VK, Apple, Mail.ru
   Добавить в конец script.js
   ================================================================ */
 
(function() {
    'use strict';
 
    // ── Настройка кнопок при загрузке ────────────────────────
    document.addEventListener('DOMContentLoaded', function() {
        bindSocialButtons();
    });
 
    function bindSocialButtons() {
        // Apple
        var appleBtn = document.querySelector('.auth-social-btn[title="Apple"]');
        if (appleBtn) appleBtn.onclick = function() { socialLogin('apple'); };
 
        // VK
        var vkBtn = document.querySelector('.auth-social-vk');
        if (vkBtn) vkBtn.onclick = function() { socialLogin('vk'); };
 
        // Google
        var googleBtn = document.querySelector('.auth-social-google');
        if (googleBtn) googleBtn.onclick = function() { socialLogin('google'); };
 
        // Mail.ru
        var mailBtn = document.querySelector('.auth-social-mail');
        if (mailBtn) mailBtn.onclick = function() { socialLogin('mailru'); };
    }
 
    // ── Основная функция входа через соцсеть ─────────────────
    window.socialLogin = async function(provider) {
        var authError = document.getElementById('authErrorMsg');
 
        // Показываем лоадер
        setSocialBtnLoading(provider, true);
        if (authError) authError.style.display = 'none';
 
        try {
            // Получаем OAuth URL с сервера
            var res = await fetch('/api/auth/social/' + provider + '/url', {
                headers: { 'Content-Type': 'application/json' }
            });
            var json = await res.json();
 
            if (!json.success || !json.data.url) {
                showSocialError(provider, json.message || (window.t ? window.t('social_unavailable') : 'Provider unavailable'));
                return;
            }
 
            // Открываем popup
            openSocialPopup(json.data.url, provider);
 
        } catch (e) {
            showSocialError(provider, window.t ? window.t('social_conn_error') : 'Connection error. Please try again later.');
        } finally {
            setSocialBtnLoading(provider, false);
        }
    };
 
    // ── Открыть popup и ждать результат ──────────────────────
    function openSocialPopup(url, provider) {
        var w = 520, h = 620;
        var left = Math.round(screen.width / 2 - w / 2);
        var top  = Math.round(screen.height / 2 - h / 2);
        var features = 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top +
                       ',menubar=no,toolbar=no,location=no,status=no';
 
        var popup = window.open(url, 'social_auth_' + provider, features);
 
        if (!popup) {
            // Блокировщик попапов — редирект в том же окне
            window.location.href = url;
            return;
        }
 
        // Слушаем postMessage от callback-страницы
        var handler = function(event) {
            // Принимаем только от нашего домена
            if (event.origin && event.origin !== window.location.origin) return;
            if (!event.data || event.data.type !== 'SOCIAL_AUTH') return;
 
            window.removeEventListener('message', handler);
            clearInterval(checkClosed);
            if (!popup.closed) popup.close();
 
            handleSocialResult(event.data);
        };
 
        window.addEventListener('message', handler);
 
        // Если пользователь закрыл popup вручную
        var checkClosed = setInterval(function() {
            if (popup.closed) {
                clearInterval(checkClosed);
                window.removeEventListener('message', handler);
            }
        }, 500);
    }
 
    // ── Обработать результат OAuth ────────────────────────────
    async function handleSocialResult(data) {
        if (data.error || !data.data) {
            showAuthError(data.error || (window.t ? window.t('auth_signin_failed') : 'Sign in failed'));
            return;
        }
 
        var result = data.data;
 
        // Сохраняем токен
        localStorage.setItem('tf_token', result.token);
        if (result.user) localStorage.setItem('tf_user', JSON.stringify(result.user));
 
        // Если новый пользователь — просим ввести имя
        if (result.is_new) {
            showAuthNameBlock(result);
            return;
        }
 
        // Успешный вход
        await onAuthSuccess(result.user);
    }
 
    // ── Показать блок ввода имени для нового пользователя ────
    function showAuthNameBlock(result) {
        var phoneBlock = document.getElementById('authPhoneBlock');
        var otpBlock   = document.getElementById('authOtpBlock');
        var nameBlock  = document.getElementById('authNameBlock');
        var title      = document.querySelector('.auth-title');
 
        if (phoneBlock) phoneBlock.style.display = 'none';
        if (otpBlock)   otpBlock.style.display   = 'none';
        if (nameBlock)  nameBlock.style.display   = '';
        if (title)      title.innerHTML = window.t ? window.t('auth_name_title') : "What's your name?";
 
        // Переопределяем submitName чтобы учесть социальный вход
        window._socialAuthPending = result;
    }
 
    // ── Обработка onAuthSuccess (вызывается после соцвхода) ──
    async function onAuthSuccess(user) {
        try {
            // Перезагружаем данные пользователя с сервера
            if (typeof TF !== 'undefined' && TF.auth) {
                var me = await TF.auth.me().catch(() => user);
                localStorage.setItem('tf_user', JSON.stringify(me));
                if (typeof updateDrawerModeBlock === 'function') updateDrawerModeBlock(me);
            }
        } catch(e) {}
 
        // Закрываем экран авторизации
        if (typeof window.closeAuthScreen === 'function') window.closeAuthScreen();
 
        // Показываем уведомление
        showSocialToast(window.t ? window.t('social_welcome') : 'Welcome! You signed in via social network.');
 
        // Перезагружаем страницу чтобы применить авторизацию
        setTimeout(function() { window.location.reload(); }, 800);
    }
 
    // ── Патч submitName для социального входа ────────────────
    var _origSubmitName = window.submitName;
    window.submitName = async function() {
        if (window._socialAuthPending) {
            var nameInput = document.getElementById('authNameInput');
            var name = nameInput ? nameInput.value.trim() : '';
            var result = window._socialAuthPending;
            window._socialAuthPending = null;
 
            // Сохраняем имя через API
            if (name && typeof TF !== 'undefined') {
                try {
                    await fetch('/api/auth/me', {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + result.token
                        },
                        body: JSON.stringify({ name: name })
                    });
                    if (result.user) result.user.name = name;
                } catch(e) {}
            }
 
            await onAuthSuccess(result.user);
            return;
        }
 
        // Оригинальная логика для OTP-входа
        if (_origSubmitName) _origSubmitName();
    };
 
    // ── UI хелперы ───────────────────────────────────────────
    var PROVIDER_SELECTORS = {
        apple:  '[title="Apple"]',
        vk:     '.auth-social-vk',
        google: '.auth-social-google',
        mailru: '.auth-social-mail',
    };
 
    function setSocialBtnLoading(provider, loading) {
        var btn = document.querySelector('.auth-social-btn' + (PROVIDER_SELECTORS[provider] || ''));
        if (!btn) return;
        btn.disabled = loading;
        btn.style.opacity = loading ? '0.5' : '1';
    }
 
    function showSocialError(provider, msg) {
        setSocialBtnLoading(provider, false);
        showAuthError(msg);
    }
 
    function showAuthError(msg) {
        var el = document.getElementById('authErrorMsg');
        if (el) {
            el.textContent = msg;
            el.style.display = 'block';
        }
    }
 
    function showSocialToast(msg) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg, 'success');
        } else if (typeof window._tfToast === 'function') {
            window._tfToast(msg);
        }
    }

})();

/* ═══════════════════════════════════════════════════════════
   СИСТЕМА ПЕРЕВОДОВ RU / EN — полное покрытие страницы
   ═══════════════════════════════════════════════════════════ */
(function() {

    const TRANSLATIONS = {
        ru: {
            // Навигация
            nav_home:            'Главная',
            nav_routes:          'Маршруты',
            nav_history:         'История',
            nav_profile:         'Профиль',
            signin:              'Войти',
            // Главный экран
            home_relay:          'Перегон авто',
            home_transfer:       'Трансфер',
            home_tours:          'Туры',
            home_become_driver:  'Стать водителем',
            home_search:         'Введите ваш адрес',
            recent_title:        'Адреса',
            min:                 'мин',
            // Тарифы (табы) — без эмодзи
            sedan:               'Седан',
            suv:                 'Внедорожник',
            sport:               'Спорткар',
            limousine:           'Лимузин',
            bus:                 'Автобус',
            minibus:             'Микроавтобус',
            helicopter:          'Вертолёт',
            jet:                 'Бизнес джет',
            trailer:             'Перегон авто',
            // Тарифы (главный экран, с эмодзи)
            sedan_short:         'Седан',
            suv_short:           'Внедорожник',
            sport_short:         'Спорткар',
            limousine_short:     'Лимузин',
            bus_short:           'Автобус',
            minibus_short:       'Микроавтобус',
            helicopter_short:    'Вертолёт',
            jet_short:           'Бизнес джет',
            no_cars:             'Нет доступных автомобилей',
            // Панель заказа
            panel_title:         'Заказ трансфера',
            from_placeholder:    'Откуда',
            to_placeholder:      'Куда?',
            address_a:           'Адрес точки А',
            address_b:           'Адрес точки Б',
            add_stop:            '+ Добавить остановку',
            order_btn:           'Заказать трансфер',
            comment_placeholder: 'Комментарий водителю',
            payment_label:       'Оплата',
            cash:                'Наличными',
            phone_label:         'Номер телефона',
            // Дата/время
            now:                 'Прямо сейчас',
            date:                'Дата',
            time:                'Время',
            // Поиск и карта
            search_placeholder:  'Куда поедете?',
            map_btn:             'Карта',
            mpb_title:           'Точка назначения',
            mpb_hint:            'Переместите карту, чтобы выбрать адрес',
            mpb_moving:          'Переместите карту...',
            mpb_confirm:         'Готово',
            loc_loading:         'Определяем ваше местоположение',
            loc_hint:            'Разрешите доступ для автоматического заполнения адреса',
            // Оплата
            payment_modal_title: 'Способ оплаты',
            card_modal_title:    'Добавить карту',
            card_form_title:     'Введите данные карты',
            card_number_label:   'Номер карты',
            card_expiry_label:   'Действует до',
            cancel:              'Отмена',
            // Меню drawer
            drawer_login_btn:    'Войти или зарегистрироваться',
            drawer_auth_hint:    'У вас будет доступ к заказам и избранному',
            menu_notif:          'Включите уведомления',
            menu_notif_sub:      'Нажмите чтобы включить',
            menu_discounts:      'Скидки и подарки',
            menu_promo:          'Ввести промокод',
            menu_payment:        'Способы оплаты',
            menu_support:        'Поддержка',
            menu_work:           'Работа водителем',
            menu_business:       'Бизнес-аккаунт',
            menu_family:         'Семейный аккаунт',
            menu_security:       'Безопасность',
            menu_settings:       'Настройки',
            menu_theme_on:       'Тёмная тема включена',
            menu_theme_off:      'Тёмная тема выключена',
            menu_lang:           'Язык / Language',
            menu_admin:          'Панель администратора',
            mode_label:          'Режим работы',
            mode_passenger:      'Пассажир',
            mode_driver:         'Водитель',
            // Экран водителя
            drv_title:           'Работа водителем<br>с Timofeyev',
            drv_per_month:       'в месяц',
            drv_earn_label:      '— столько получает водитель',
            drv_also:            'А ещё можно:',
            drv_b1:              'Выходить на линию только в удобное время',
            drv_b2:              'Выполнять заказы на своём авто либо взять машину в парке',
            drv_b3:              'Получать деньги сразу в поездках за наличные',
            drv_apply:           'Оставить заявку',
            drv_callback:        'Вам перезвонят',
            drv_login:           'Войти или зарегистрироваться',
            drv_legal:           'Отправляя заявку, вы соглашаетесь с условиями оферты.',
            drv_modal_title:     'Заявка отправлена!',
            drv_modal_text:      'Наш менеджер свяжется с вами в ближайшее время.',
            drv_modal_btn:       'Отлично',
            // Форма заявки водителя
            drvapp_title:        'Заявка водителя',
            drvapp_make:         'Марка авто',
            drvapp_model:        'Модель',
            drvapp_year:         'Год выпуска',
            drvapp_color:        'Цвет',
            drvapp_color_ph:     'Чёрный',
            drvapp_plate:        'Гос. номер',
            drvapp_type:         'Тип транспорта',
            drvapp_license:      'Номер ВУ (необязательно)',
            drvapp_submit:       'Отправить заявку',
            drvapp_hint:         'После проверки данных менеджер свяжется с вами',
            // Авторизация
            auth_title:          'Введите номер<br>телефона',
            auth_subtitle:       'Чтобы войти или зарегистрироваться',
            auth_btn_login:      'Войти',
            auth_btn_confirm:    'Подтвердить',
            auth_resend:         'Повторить через 60 сек',
            auth_name_ph:        'Ваше имя',
            auth_btn_continue:   'Продолжить',
            auth_btn_skip:       'Пропустить',
            auth_biometric:      'По лицу или отпечатку',
            auth_legal_prefix:   'Продолжая, вы соглашаетесь с',
            auth_legal_terms:    'условиями использования',
            auth_legal_and:      'и',
            auth_legal_privacy:  'политикой конфиденциальности',
            // Экран трекинга заказа
            otr_status_label:    'Статус заказа',
            otr_searching:       'Ищем водителя…',
            otr_searching_sub:   'Обычно это занимает меньше минуты',
            otr_pickup:          'Подача',
            otr_pickup_eta:      'Подача в ~{n} мин',
            otr_arrival:         'Прибытие',
            otr_need_help:       'Нужна помощь',
            otr_share_location:  'Показать водителю, где я',
            otr_carrier_label:   'Перевозчик и детали',
            otr_contact:         'Связаться',
            otr_safety:          'Безопасность',
            otr_share:           'Поделиться',
            otr_share_text:      'Слежу за поездкой',
            otr_change:          'Изменить',
            otr_cancel_trip:     'Отменить поездку',
            otr_close:           'Закрыть',
            otr_rating_title:    'Как прошла поездка?',
            otr_rate_btn:        'Оценить поездку',
            driver_default:      'Водитель',
            card:                'Картой',
            // Статусы заказа
            status_pending:          'Ищем водителя…',
            status_pending_sub:      'Ожидайте — назначаем водителя',
            status_accepted:         'Через ~4 мин приедет',
            status_accepted_sub:     'Водитель выехал к точке подачи',
            status_accepted_eta:     'Через ~{n} мин приедет',
            status_arriving:         'Водитель на месте!',
            status_arriving_sub:     'Выходите — водитель ждёт вас',
            status_in_progress:      'Поездка началась',
            status_in_progress_sub:  'Хорошей поездки!',
            status_completed:        'Поездка завершена',
            status_completed_sub:    'Надеемся, поездка понравилась',
            status_cancelled:        'Заказ отменён',
            status_cancelled_reason: 'Заказ был отменён',
            // Рейтинг / отмена / прочее
            rating_required:         'Пожалуйста, выберите оценку',
            cancel_order_confirm:    'Отменить заказ?',
            cancel_order_reason:     'Отменён клиентом',
            cancel_order_failed:     'Не удалось отменить заказ',
            price_recalc_wait:       'Подождите, цена пересчитывается…',
            auth_signin_failed:      'Вход не выполнен',
            // Карта (масштаб расстояния)
            dist_m:                  'м',
            dist_km:                 'км',
            // Кнопки логина/логаута
            signin_btn:              'Войти',
            logout_btn:              'Выйти',
            // Авторизация — динамические состояния
            auth_sending:            'Отправка...',
            auth_checking:           'Проверяем...',
            auth_sms_error:          'Ошибка отправки SMS',
            auth_wrong_code:         'Неверный код',
            auth_otp_title:          'Введите код<br>из SMS',
            auth_otp_sent:           'Отправлен на {phone}',
            auth_name_title:         'Как вас зовут?',
            auth_name_sub:           'Чтобы водитель знал, как к вам обращаться',
            auth_resend_timer:       'Повторить через {n} сек',
            auth_resend_now:         'Отправить ещё раз',
            auth_error_generic:      'Ошибка',
            // Drawer — незалогиненный
            drawer_login_inline:     'Войти или зарегистрироваться',
            drawer_hint_inline:      'У вас будет доступ к заказам и избранному',
            // Поиск
            search_empty:            'Ничего не найдено',
            // Карта — выбор точки
            mpb_from_title:          'Точка отправления',
            mpb_to_title:            'Точка назначения',
            mpb_stop_title:          'Остановка {n}',
            stop_placeholder:        'Остановка {n}',
            remove_stop:             'Удалить остановку',
            map_select:              'Выбрать на карте',
            // Геолокация
            loc_error:               'Не удалось определить местоположение. Разрешите доступ к геолокации.',
            // Адресные поля
            from_label:              'Откуда',
            to_label:                'Куда',
            // Оплата — строки для трекинга
            pay_cash_label:          'наличными',
            pay_card_label:          'картой',
            // Карточки оплаты — ошибки
            card_num_error:          'Номер карты должен содержать 16 цифр',
            card_exp_error:          'Введите срок действия в формате ММ/ГГ',
            card_delete_confirm:     'Удалить карту?',
            // Заказ — ошибки и кнопки
            order_error_address:     'Пожалуйста, укажите точки отправления и назначения',
            order_error_price:       'Пожалуйста, дождитесь расчёта стоимости',
            order_error_calculating: 'Пожалуйста, дождитесь окончания расчёта стоимости',
            order_creating:          'Создаём заказ…',
            order_transfer_label:    'Трансфер',
            order_error_failed:      'Не удалось создать заказ. Попробуйте ещё раз.',
            // Трекинг — уведомления
            driver_found_title:      'Водитель найден!',
            driver_on_way:           '{name} едет к вам',
            driver_arrived_title:    'Водитель на месте!',
            driver_arrived_sub:      'Выходите — водитель ждёт вас',
            trip_started_title:      'Поездка началась!',
            trip_started_sub:        'Хорошей дороги 🚗',
            driver_near:             'Водитель рядом!',
            arriving_eta:            'Прибудет через ~{n} мин',
            no_server:               '⚠️ Нет связи с сервером…',
            notif_tap_open:          'Нажмите чтобы открыть',
            eta_min:                 '~{n} мин',
            // Тема
            theme_dark_on:           'Тёмная тема включена',
            theme_light_on:          'Светлая тема включена',
            // Заявка водителя
            drv_error_fields:        'Укажите марку и модель автомобиля',
            drv_submitting:          'Отправляем...',
            drv_already_sent:        'Заявка уже была отправлена ранее',
            drv_error_later:         'Ошибка. Попробуйте позже.',
            drv_pending_main:        'Заявка на рассмотрении',
            drv_pending_sub_text:    'Мы вам перезвоним',
            drv_approved_main:       'Переключиться в режим водителя',
            drv_rejected_main:       'Подать заявку повторно',
            drv_rejected_sub:        'Обратитесь в поддержку',
            // Переключатель режимов
            mode_login_required:     'Войдите в аккаунт',
            mode_switch_error:       'Не удалось переключить режим. Попробуйте ещё раз.',
            // Соцсеть
            social_welcome:          'Добро пожаловать! Вы вошли через соцсеть.',
            social_unavailable:      'Провайдер недоступен',
            social_conn_error:       'Ошибка соединения. Попробуйте позже.',
            // Маркеры карты
            map_pickup_hint:         'Отправление',
            map_dest_hint:           'Назначение',
            map_pickup_point:        'Точка подачи',
            map_stop_hint:           'Остановка {n}',
            // Телефон
            phone_label:             'Номер телефона',
        },
        en: {
            nav_home:            'Home',
            nav_routes:          'Routes',
            nav_history:         'History',
            nav_profile:         'Profile',
            signin:              'Sign in',
            home_relay:          'Car delivery',
            home_transfer:       'Transfer',
            home_tours:          'Tours',
            home_become_driver:  'Become a driver',
            home_search:         'Enter your address',
            recent_title:        'Addresses',
            min:                 'min',
            sedan:               'Sedan',
            suv:                 'SUV',
            sport:               'Sportscar',
            limousine:           'Limousine',
            bus:                 'Bus',
            minibus:             'Minibus',
            helicopter:          'Helicopter',
            jet:                 'Private jet',
            trailer:             'Car delivery',
            sedan_short:         'Sedan',
            suv_short:           'SUV',
            sport_short:         'Sportscar',
            limousine_short:     'Limousine',
            bus_short:           'Bus',
            minibus_short:       'Minibus',
            helicopter_short:    'Helicopter',
            jet_short:           'Private jet',
            no_cars:             'No available vehicles',
            panel_title:         'Book a transfer',
            from_placeholder:    'Pickup address',
            to_placeholder:      'Destination?',
            address_a:           'Point A',
            address_b:           'Point B',
            add_stop:            '+ Add stop',
            order_btn:           'Book transfer',
            comment_placeholder: 'Comment to driver',
            payment_label:       'Payment',
            cash:                'Cash',
            phone_label:         'Phone number',
            now:                 'Right now',
            date:                'Date',
            time:                'Time',
            search_placeholder:  'Where to?',
            map_btn:             'Map',
            mpb_title:           'Select destination',
            mpb_hint:            'Move the map to select address',
            mpb_moving:          'Move the map...',
            mpb_confirm:         'Done',
            loc_loading:         'Detecting your location',
            loc_hint:            'Allow access to auto-fill your address',
            payment_modal_title: 'Payment method',
            card_modal_title:    'Add card',
            card_form_title:     'Enter card details',
            card_number_label:   'Card number',
            card_expiry_label:   'Expiry date',
            cancel:              'Cancel',
            drawer_login_btn:    'Sign in or register',
            drawer_auth_hint:    'Access your orders and favourites',
            menu_notif:          'Enable notifications',
            menu_notif_sub:      'Tap to enable',
            menu_discounts:      'Discounts & gifts',
            menu_promo:          'Enter promo code',
            menu_payment:        'Payment methods',
            menu_support:        'Support',
            menu_work:           'Drive with us',
            menu_business:       'Business account',
            menu_family:         'Family account',
            menu_security:       'Safety',
            menu_settings:       'Settings',
            menu_theme_on:       'Dark mode on',
            menu_theme_off:      'Dark mode off',
            menu_lang:           'Language / Язык',
            menu_admin:          'Admin panel',
            mode_label:          'Work mode',
            mode_passenger:      'Passenger',
            mode_driver:         'Driver',
            drv_title:           'Drive with<br>Timofeyev',
            drv_per_month:       'per month',
            drv_earn_label:      '— average driver earnings',
            drv_also:            'You can also:',
            drv_b1:              'Go online only when it suits you',
            drv_b2:              'Use your own car or take one from our fleet',
            drv_b3:              'Get paid instantly in cash per ride',
            drv_apply:           'Apply now',
            drv_callback:        'We\'ll call you back',
            drv_login:           'Sign in or register',
            drv_legal:           'By submitting, you agree to the terms of the offer.',
            drv_modal_title:     'Application sent!',
            drv_modal_text:      'Our manager will contact you shortly.',
            drv_modal_btn:       'Great',
            drvapp_title:        'Driver application',
            drvapp_make:         'Car brand',
            drvapp_model:        'Model',
            drvapp_year:         'Year',
            drvapp_color:        'Color',
            drvapp_color_ph:     'Black',
            drvapp_plate:        'Plate number',
            drvapp_type:         'Vehicle type',
            drvapp_license:      'Driver\'s license (optional)',
            drvapp_submit:       'Submit application',
            drvapp_hint:         'After verification our manager will contact you',
            auth_title:          'Enter your<br>phone number',
            auth_subtitle:       'To sign in or register',
            auth_btn_login:      'Sign in',
            auth_btn_confirm:    'Confirm',
            auth_resend:         'Resend in 60 sec',
            auth_name_ph:        'Your name',
            auth_btn_continue:   'Continue',
            auth_btn_skip:       'Skip',
            auth_biometric:      'Face ID or fingerprint',
            auth_legal_prefix:   'By continuing, you agree to our',
            auth_legal_terms:    'terms of use',
            auth_legal_and:      'and',
            auth_legal_privacy:  'privacy policy',
            // Order tracking screen
            otr_status_label:    'Order status',
            otr_searching:       'Looking for a driver…',
            otr_searching_sub:   'This usually takes less than a minute',
            otr_pickup:          'Pickup',
            otr_pickup_eta:      'Pickup in ~{n} min',
            otr_arrival:         'Destination',
            otr_need_help:       'Need help',
            otr_share_location:  'Show driver where I am',
            otr_carrier_label:   'Carrier & details',
            otr_contact:         'Contact',
            otr_safety:          'Safety',
            otr_share:           'Share',
            otr_share_text:      'Tracking ride',
            otr_change:          'Change',
            otr_cancel_trip:     'Cancel ride',
            otr_close:           'Close',
            otr_rating_title:    'How was your ride?',
            otr_rate_btn:        'Rate the ride',
            driver_default:      'Driver',
            card:                'Card',
            // Order statuses
            status_pending:          'Looking for a driver…',
            status_pending_sub:      'Please wait — assigning a driver',
            status_accepted:         'Arriving in ~4 min',
            status_accepted_sub:     'Driver is on the way',
            status_accepted_eta:     'Arriving in ~{n} min',
            status_arriving:         'Driver is here!',
            status_arriving_sub:     'Come out — driver is waiting',
            status_in_progress:      'Ride started',
            status_in_progress_sub:  'Have a great ride!',
            status_completed:        'Ride completed',
            status_completed_sub:    'Hope you enjoyed the ride',
            status_cancelled:        'Order cancelled',
            status_cancelled_reason: 'The order was cancelled',
            // Rating / cancel / misc
            rating_required:         'Please select a rating',
            cancel_order_confirm:    'Cancel this order?',
            cancel_order_reason:     'Cancelled by client',
            cancel_order_failed:     'Could not cancel order',
            price_recalc_wait:       'Please wait, recalculating price…',
            auth_signin_failed:      'Sign in failed',
            // Distance units
            dist_m:                  'm',
            dist_km:                 'km',
            // Login / logout buttons
            signin_btn:              'Sign in',
            logout_btn:              'Sign out',
            // Auth — dynamic states
            auth_sending:            'Sending...',
            auth_checking:           'Checking...',
            auth_sms_error:          'Failed to send SMS',
            auth_wrong_code:         'Invalid code',
            auth_otp_title:          'Enter the<br>SMS code',
            auth_otp_sent:           'Sent to {phone}',
            auth_name_title:         'What\'s your name?',
            auth_name_sub:           'So your driver knows how to address you',
            auth_resend_timer:       'Resend in {n} sec',
            auth_resend_now:         'Resend code',
            auth_error_generic:      'Error',
            // Drawer — logged out
            drawer_login_inline:     'Sign in or register',
            drawer_hint_inline:      'Access your orders and favourites',
            // Search
            search_empty:            'Nothing found',
            // Map — point selection
            mpb_from_title:          'Departure point',
            mpb_to_title:            'Destination point',
            mpb_stop_title:          'Stop {n}',
            stop_placeholder:        'Stop {n}',
            remove_stop:             'Remove stop',
            map_select:              'Select on map',
            // Geolocation
            loc_error:               'Could not detect location. Please allow location access.',
            // Address fields
            from_label:              'From',
            to_label:                'To',
            // Payment labels for tracking
            pay_cash_label:          'cash',
            pay_card_label:          'card',
            // Payment card errors
            card_num_error:          'Card number must be 16 digits',
            card_exp_error:          'Enter expiry date in MM/YY format',
            card_delete_confirm:     'Delete card?',
            // Order — errors and buttons
            order_error_address:     'Please enter pickup and destination addresses',
            order_error_price:       'Please wait for price calculation',
            order_error_calculating: 'Please wait for price calculation to finish',
            order_creating:          'Creating order…',
            order_transfer_label:    'Transfer',
            order_error_failed:      'Could not create order. Please try again.',
            // Tracking — flash notifications
            driver_found_title:      'Driver found!',
            driver_on_way:           '{name} is on the way',
            driver_arrived_title:    'Driver is here!',
            driver_arrived_sub:      'Come out — driver is waiting',
            trip_started_title:      'Ride started!',
            trip_started_sub:        'Have a great ride! 🚗',
            driver_near:             'Driver nearby!',
            arriving_eta:            'Arriving in ~{n} min',
            no_server:               '⚠️ No server connection…',
            notif_tap_open:          'Tap to open',
            eta_min:                 '~{n} min',
            // Theme
            theme_dark_on:           'Dark mode on',
            theme_light_on:          'Light mode on',
            // Driver application
            drv_error_fields:        'Please enter car make and model',
            drv_submitting:          'Submitting...',
            drv_already_sent:        'Application already submitted',
            drv_error_later:         'Error. Please try again later.',
            drv_pending_main:        'Application under review',
            drv_pending_sub_text:    'We\'ll call you back',
            drv_approved_main:       'Switch to driver mode',
            drv_rejected_main:       'Submit again',
            drv_rejected_sub:        'Contact support',
            // Mode switcher
            mode_login_required:     'Please sign in',
            mode_switch_error:       'Could not switch mode. Please try again.',
            // Social auth
            social_welcome:          'Welcome! You signed in via social network.',
            social_unavailable:      'Provider unavailable',
            social_conn_error:       'Connection error. Please try again later.',
            // Map markers
            map_pickup_hint:         'Departure',
            map_dest_hint:           'Destination',
            map_pickup_point:        'Pickup point',
            map_stop_hint:           'Stop {n}',
        }
    };

    let currentLang = localStorage.getItem('tf_lang') || 'ru';
    window.t = (key) => (TRANSLATIONS[currentLang] || TRANSLATIONS.ru)[key] || key;

    function applyTranslations() {
        const T = TRANSLATIONS[currentLang] || TRANSLATIONS.ru;

        // 1. Все [data-i18n] — текстовое содержимое (поддержка innerHTML для <br>)
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            if (!T[key]) return;
            if (T[key].includes('<br>')) {
                el.innerHTML = T[key];
            } else {
                el.textContent = T[key];
            }
        });

        // 2. Все [data-i18n-placeholder] — placeholder
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.dataset.i18nPlaceholder;
            if (T[key]) el.placeholder = T[key];
        });

        // 3. Табы тарифов (генерируются JS, ищем по data-id)
        document.querySelectorAll('.tariff-tab[data-id]').forEach(tab => {
            const key = tab.dataset.id;
            if (T[key]) tab.textContent = T[key];
        });
        // 4. Тёмная тема label
        const themeLabel = document.getElementById('hsDrawerThemeLabel');
        if (themeLabel) {
            const isLight = document.body.classList.contains('light-theme');
            themeLabel.textContent = isLight ? T.theme_light_on : T.theme_dark_on;
        }

        // 5. Поиск
        const srchInput = document.getElementById('srchInput');
        if (srchInput) srchInput.placeholder = T.search_placeholder;

        // 6. Кнопки языка
        document.getElementById('hsLangRu')?.classList.toggle('active', currentLang === 'ru');
        document.getElementById('hsLangEn')?.classList.toggle('active', currentLang === 'en');

        // 7. Дата/время — пилюля если не выбрано расписание
        const pillLabel = document.getElementById('datetimePillLabel');
        if (pillLabel && !pillLabel.classList.contains('has-schedule')) {
            pillLabel.textContent = T.now;
        }
        const dtReset = document.querySelector('.datetime-reset');
        if (dtReset) dtReset.textContent = T.now;

        // 8. Кнопка "Заказать" — обновляем если не в процессе заказа
        const orderBtnTxt = document.getElementById('orderButtonText');
        if (orderBtnTxt && orderBtnTxt.textContent !== T.order_creating) {
            orderBtnTxt.textContent = T.order_btn;
        }

        // 9. Drawer — обновляем auth-блок (logout/login кнопка)
        if (typeof TF !== 'undefined' && typeof TF.updateHeaderAuth === 'function') {
            TF.updateHeaderAuth();
        }
    }

    window.setLanguage = function(lang) {
        if (!TRANSLATIONS[lang]) return;
        currentLang = lang;
        localStorage.setItem('tf_lang', lang);
        applyTranslations();
    };

    // При загрузке и после DOMContentLoaded
    document.addEventListener('DOMContentLoaded', applyTranslations);
    // Повторно после рендера тарифных табов (они создаются JS чуть позже)
    window.addEventListener('load', applyTranslations);

})();

/* ═══════════════════════════════════════════════════════════
   DATETIME PICKER — дата и время подачи
   ═══════════════════════════════════════════════════════════ */
(function() {

    let _pickerOpen = false;

    window.toggleDatetimePicker = function() {
        _pickerOpen = !_pickerOpen;
        const pill   = document.getElementById('datetimePill');
        const picker = document.getElementById('datetimePicker');
        if (!pill || !picker) return;
        pill.classList.toggle('open', _pickerOpen);
        picker.classList.toggle('open', _pickerOpen);

        // Ставим сегодня и текущее время по умолчанию при первом открытии
        if (_pickerOpen) {
            const dateEl = document.getElementById('scheduleDate');
            const timeEl = document.getElementById('scheduleTime');
            if (dateEl && !dateEl.value) {
                const now = new Date();
                dateEl.value = now.toISOString().slice(0, 10);
            }
            if (timeEl && !timeEl.value) {
                const now  = new Date();
                now.setMinutes(now.getMinutes() + 30); // +30 минут от сейчас
                timeEl.value = now.toTimeString().slice(0, 5);
            }
            // Слушаем изменения
            document.getElementById('scheduleDate')?.addEventListener('change', updatePillLabel);
            document.getElementById('scheduleTime')?.addEventListener('change', updatePillLabel);
            updatePillLabel();
        }
    };

    function updatePillLabel() {
        const dateEl  = document.getElementById('scheduleDate');
        const timeEl  = document.getElementById('scheduleTime');
        const labelEl = document.getElementById('datetimePillLabel');
        const resetEl = document.querySelector('.datetime-reset');
        if (!dateEl || !timeEl || !labelEl) return;

        const d = dateEl.value;
        const tt = timeEl.value;

        if (d && tt) {
            const dateObj = new Date(d + 'T' + tt);
            const opts    = { day: 'numeric', month: 'short' };
            const lang    = localStorage.getItem('tf_lang') || 'ru';
            const dateStr = dateObj.toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', opts);
            labelEl.textContent = dateStr + ', ' + tt;
            labelEl.classList.add('has-schedule');
            if (resetEl) resetEl._hasSchedule = true;
        }
    }

    window.resetDatetime = function() {
        const dateEl  = document.getElementById('scheduleDate');
        const timeEl  = document.getElementById('scheduleTime');
        const labelEl = document.getElementById('datetimePillLabel');
        const resetEl = document.querySelector('.datetime-reset');
        if (dateEl)  dateEl.value  = '';
        if (timeEl)  timeEl.value  = '';
        if (labelEl) {
            const lang = localStorage.getItem('tf_lang') || 'ru';
            labelEl.textContent = lang === 'en' ? (TRANSLATIONS.en?.now || 'Right now') : (TRANSLATIONS.ru?.now || 'Прямо сейчас');
            labelEl.classList.remove('has-schedule');
        }
        if (resetEl) resetEl._hasSchedule = false;
        // Закрываем пикер
        _pickerOpen = false;
        document.getElementById('datetimePill')?.classList.remove('open');
        document.getElementById('datetimePicker')?.classList.remove('open');
    };

    // Получить выбранное расписание для передачи в заказ
    window.getScheduledDatetime = function() {
        const d  = document.getElementById('scheduleDate')?.value;
        const tt = document.getElementById('scheduleTime')?.value;
        if (d && tt) return d + 'T' + tt + ':00';
        return null;
    };

})();