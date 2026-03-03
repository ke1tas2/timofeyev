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

// Version: 3.1.0 - New point B selection mode: drag map, confirm location
// ── Редирект по роли при загрузке страницы ───────────────────
(function() {
    document.addEventListener('DOMContentLoaded', async function() {
        if (typeof TF === 'undefined' || !TF.auth.isLoggedIn()) return;
        try {
            var me = await TF.auth.me();
            if (!me) return;
            localStorage.setItem('tf_user', JSON.stringify(me));
            if (me.role === 'admin') {
                window.location.href = 'admin.html';
                return;
            }
            if (me.role === 'driver' && me.driver && me.driver.status === 'approved') {
                window.location.href = 'driver.html';
                return;
            }
            // Проверяем наличие активного заказа при перезагрузке страницы
            if (me.role === 'client' || !me.role) {
                try {
                    var active = await TF.orders.active();
                    if (active && !['completed','cancelled'].includes(active.status)) {
                        // Восстанавливаем поллинг и показываем мини-карточку
                        _trackingOrderId = active.id;
                        _lastTrackedStatus = null;
                        _pollFailCount = 0;
                        showActiveOrderCard();
                        updateActiveOrderCard(active);
                        var _oid = String(active.id);
                        _trackingInterval = setInterval(function() { pollOrderStatus(_oid); }, 2000);
                        // При клике на мини-карточку открываем полный экран восстановленного заказа
                        document.getElementById('activeOrderCard') && (document.getElementById('activeOrderCard').onclick = function() {
                            openOrderTracking(active.id, {
                                from: active.from_address,
                                to:   active.to_address,
                                price: active.price ? Number(active.price).toLocaleString('ru-RU') : '—',
                            });
                        });
                    }
                } catch(e2) {}
            }
        } catch(e) {
            if (e && (e.status === 401 || e.status === 403)) {
                localStorage.removeItem('tf_token');
                localStorage.removeItem('tf_user');
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
        let selectedTariff = 'sedan';
        let selectingPoint = null;
        let currentPayment = 'cash';
        let mapClickHandler = null;
        let geocoder = null;
        let selectedTransportClass = 'comfort';
        let stops = []; // [{coords, address, marker}]
        const MAX_STOPS = 3;

        const tariffs = [
            {
                id: 'sedan',
                name: 'Седан',
                price: 10000,
                perKm: 200,
                image: './assets/sedan.png'
            },

            {
                id: 'suv',
                name: 'Внедорожник',
                price: 15000,
                perKm: 260,
                image: './assets/suv.png'
            },

            {
                id: 'sport',
                name: 'Спорткар',
                price: 30000,
                perKm: 400,
                image: './assets/sportcar.png'
            },
            {
                id: 'limousine',
                name: 'Лимузин',
                price: 50000,
                perKm: 350,
                image: './assets/limousine-black.png'
            },
            {
                id: 'bus',
                name: 'Автобус',
                price: 40000,
                perKm: 350,
                image: './assets/bus.png'
            },
            {
                id: 'minibus',
                name: 'Микроавтобус',
                price: 30000,
                perKm: 300,
                image: './assets/microbus.png'
            },
            {
                id: 'helicopter',
                name: 'Вертолёт',
                price: 2160000,
                perKm: 500000,
                image: './assets/helicopter-black.png'
            },
            {
                id: 'jet',
                name: 'Бизнес джет',
                price: 10000000,
                perKm: 1500000,
                image: './assets/plane.png'
            },
            {
                id: 'trailer',
                name: 'Перегон авто',
                price: 20000,
                perKm: 200,
                image: './assets/car-keys.png'
            }
        ];

        let paymentMethods = [
            { id: 'cash', name: 'Наличными', icon: 'money-bill-wave', type: 'cash' }
        ];

        let savedCards = JSON.parse(localStorage.getItem('taxi_saved_cards')) || [];

        function updatePaymentMethods() {
            paymentMethods = [
                { id: 'cash', name: 'Наличными', icon: 'money-bill-wave', type: 'cash' }
            ];

            savedCards.forEach((card, index) => {
                paymentMethods.push({
                    id: 'card_' + index,
                    name: 'Карта •••• ' + card.number.slice(-4),
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
                    // Любой режим выбора на карте (from / to / stop_N) — только превью в баре
                    var coords = getMarkerGeoCoords();
                    previewMpbAddr(coords);
                } else {
                    // В обычном режиме — обновляем точку А при перемещении карты.
                    // updateMap=false чтобы НЕ вызывать setCenter и не создавать бесконечный цикл
                    if (centerGeocodeTimer) clearTimeout(centerGeocodeTimer);
                    centerGeocodeTimer = setTimeout(function() {
                        var coords = getMarkerGeoCoords();
                        geocodeCoords('from', coords, false);
                    }, 1000);
                }
            });

            // Кнопки зума удалены (оставлена только геолокация)

            function goToUserLocation() {
                if (!navigator.geolocation) return;
                navigator.geolocation.getCurrentPosition(
                    function(position) {
                        const coords = [position.coords.latitude, position.coords.longitude];
                        // При ручном нажатии на кнопку геопозиции:
                        // только обновляем адрес и центрируем карту, маркер А не ставим
                        geocodeCoords('from', coords, false);
                        map.setCenter(coords, 15, { duration: 300 });
                    },
                    function() {
                        alert('Не удалось определить местоположение. Разрешите доступ к геолокации.');
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
            const tariffGrid = document.getElementById('tariffGrid');
            tariffs.forEach(tariff => {
                const card = document.createElement('div');
                card.className = 'tariff-card';
                // Добавляем модификатор по ID тарифа, чтобы можно было тонко настраивать стили
                card.classList.add(`tariff-card-${tariff.id}`);
                if (tariff.id === selectedTariff) card.classList.add('active');

                const imageUrl = tariff.image || '';

                card.innerHTML = `
                    ${tariff.id === 'suv' ? '<div class="tariff-badge">Популярный</div>' : ''}
                    <div class="tariff-image-box">
                        ${imageUrl ? `<img src="${imageUrl}" alt="${tariff.name}" class="tariff-image">` : ''}
                    </div>
                    <div class="tariff-name">${tariff.name}</div>
                    <div class="tariff-price" id="tariff-price-${tariff.id}">${formatPrice(tariff.price)} ₸</div>
                `;

                card.addEventListener('click', () => selectTariff(tariff.id));
                tariffGrid.appendChild(card);
                // init animation state with base price
                initTariffAnimState(tariff.id, tariff.price);
            });

            document.querySelectorAll('.transport-class-option').forEach(option => {
                option.addEventListener('click', () => {
                    const cls = option.getAttribute('data-class');
                    if (!cls) return;
                    selectedTransportClass = cls;

                    // Синхронизируем активное состояние для всех одинаковых классов
                    document.querySelectorAll('.transport-class-option').forEach(o => {
                        o.classList.toggle('active', o.getAttribute('data-class') === cls);
                    });
                });
            });

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
                if (pointType === 'to') {
                    labelAEl.textContent = document.getElementById('fromInput').value || 'Откуда';
                } else if (pointType === 'from') {
                    labelAEl.textContent = document.getElementById('toInput').value || 'Куда';
                } else if (pointType && pointType.startsWith('stop_')) {
                    labelAEl.textContent = document.getElementById('fromInput').value || 'Откуда';
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
            input.placeholder = (pointType === 'to') ? 'Куда поедете?'
                : (pointType === 'from') ? 'Откуда поедете?'
                : 'Адрес остановки?';
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
                document.getElementById('srchResults').innerHTML = '<div class="srch-empty">Ничего не найдено</div>';
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
                // Менее 1 км - показываем метры
                return Math.round(meters) + ' м';
            } else {
                // 1 км и более - показываем километры
                var km = meters / 1000;
                if (km < 10) {
                    // До 10 км - показываем 1 знак после запятой
                    return km.toFixed(1) + ' км';
                } else {
                    // 10 км и более - округляем до целых
                    return Math.round(km) + ' км';
                }
            }
        }

        function renderSuggestions(items, query) {
            var list = document.getElementById('srchResults');
            list.innerHTML = '';

            if (!items.length) {
                list.innerHTML = '<div class="srch-empty">Ничего не найдено</div>';
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

            // Показываем маркер
            document.getElementById('mapMarker').classList.remove('hidden');

            // Заголовок панели: Точка отправления / Точка назначения
            var titleEl = document.querySelector('.mpb-panel-title');
            if (titleEl) {
                if (pointType === 'from') titleEl.textContent = 'Точка отправления';
                else if (pointType === 'to') titleEl.textContent = 'Точка назначения';
                else if (pointType && pointType.startsWith('stop_')) {
                    var sIdx = parseInt(pointType.split('_')[1]);
                    titleEl.textContent = 'Остановка ' + (sIdx + 1);
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
                    addrB.textContent = 'Переместите карту...';
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
                    el.textContent = addr || 'Переместите карту...';
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
                        hintContent: 'Остановка ' + (i + 1),
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
                hintContent: 'Остановка ' + (idx + 1),
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
                            'placeholder="Остановка ' + (idx + 1) + '" autocomplete="off" readonly ' +
                            'value="' + (stop.address || '') + '">' +
                        '<span class="address-hint">Остановка ' + (idx + 1) + '</span>' +
                    '</div>' +
                    '<button class="clear-button" style="display:flex;" onclick="removeStop(' + idx + ')" title="Удалить остановку">' +
                        '<i class="fas fa-times"></i>' +
                    '</button>' +
                    '<button class="map-select-button" onclick="startSelectingPoint(\'stop_' + idx + '\')" title="Выбрать на карте">' +
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
        function getMarkerGeoCoords() {
            const markerEl = document.getElementById('mapMarker');
            const mapEl = document.getElementById('map');
            if (!markerEl || markerEl.classList.contains('hidden') || !mapEl) {
                return map.getCenter();
            }
            try {
                const mapRect = mapEl.getBoundingClientRect();
                const markerRect = markerEl.getBoundingClientRect();

                // map-marker уже позиционирован с translate(-50%, -100%)
                // Так что его нижний край и есть кончик маркера
                const tipX = markerRect.left + markerRect.width / 2;
                const tipY = markerRect.bottom;
                
                // Смещение от центра div'а карты
                const mapCenterX = mapRect.left + mapRect.width / 2;
                const mapCenterY = mapRect.top + mapRect.height / 2;
                const dx = tipX - mapCenterX;
                const dy = tipY - mapCenterY;

                // Проекция Яндекс.Карт: пиксели → гео
                const projection = map.options.get('projection');
                const zoom = map.getZoom();
                const center = map.getCenter();
                const centerGlobalPx = projection.toGlobalPixels(center, zoom);
                const tipGlobalPx = [centerGlobalPx[0] + dx, centerGlobalPx[1] + dy];
                return projection.fromGlobalPixels(tipGlobalPx, zoom);
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
                hintContent: 'Отправление',
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

            updateRoute();
        }

        // Отдельные таймеры для каждой точки — не отменяют друг друга
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
                hintContent: 'Назначение',
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
            selectedTariff = tariffId;

            document.querySelectorAll('.tariff-card').forEach(card => {
                card.classList.remove('active');
            });

            const tariffIndex = tariffs.findIndex(t => t.id === tariffId);
            if (tariffIndex !== -1) {
                const cards = document.querySelectorAll('.tariff-card');
                if (cards[tariffIndex]) {
                    cards[tariffIndex].classList.add('active');
                }
            }

            // Синхронизируем скрытый priceAmount с ценой выбранного тарифа
            const priceEl = document.getElementById('tariff-price-' + tariffId);
            const priceAmount = document.getElementById('priceAmount');
            if (priceEl && priceAmount) {
                if (priceEl.classList.contains('calculated')) {
                    const numericText = priceEl.textContent.replace(/[^\d]/g, '');
                    const numericValue = parseInt(numericText) || 0;
                    currentAnimatedPrice = numericValue;
                    priceAmount.textContent = formatPrice(numericValue);
                } else {
                    priceAmount.textContent = '—';
                    currentAnimatedPrice = 0;
                }
            }

            updatePrice();
        }

        function calculatePrice(distanceKm = 0) {
            let extras = 0;
            if (document.getElementById('animalOption').checked) extras += 5000;
            if (document.getElementById('skiOption').checked) extras += 3000;
            if (document.getElementById('childSeatOption').checked) extras += 2000;
            if (document.getElementById('bicycleOption').checked) extras += 3000;

            let selectedPrice = 0;

            tariffs.forEach(tariff => {
                let price = tariff.price + (distanceKm * tariff.perKm) + extras;
                price = Math.round(price / 100) * 100;

                const priceEl = document.getElementById('tariff-price-' + tariff.id);
                if (priceEl) {
                    priceEl.classList.add('calculated');
                    animateTariffPrice(tariff.id, price);
                }

                if (tariff.id === selectedTariff) {
                    selectedPrice = price;
                }            });

            // Обновляем скрытый элемент для orderTaxi()
            const priceElement = document.getElementById('priceAmount');
            _finalCalculatedPrice = selectedPrice; // сохраняем итоговую цену ДО анимации
            if (priceElement) {
                if (currentAnimatedPrice === 0 && priceElement.textContent === '—') {
                    currentAnimatedPrice = selectedPrice;
                    priceElement.textContent = formatPrice(selectedPrice);
                } else {
                    animateCounter(priceElement, selectedPrice);
                }
            }
        }

        function resetTariffPrices() {
            tariffs.forEach(tariff => {
                const priceEl = document.getElementById('tariff-price-' + tariff.id);
                if (priceEl) {
                    priceEl.classList.remove('calculated');
                    animateTariffPrice(tariff.id, tariff.price);
                }
            });
            const priceElement = document.getElementById('priceAmount');
            if (priceElement) priceElement.textContent = '—';
            currentAnimatedPrice = 0;
            _finalCalculatedPrice = 0;
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }
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
                alert('Номер карты должен содержать 16 цифр');
                return;
            }

            if (!cardExpiry.match(/^\d{2}\/\d{2}$/)) {
                alert('Введите срок действия в формате ММ/ГГ');
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

            if (confirm('Удалить карту?')) {
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
                showOrderError('Пожалуйста, укажите точки отправления и назначения');
                return;
            }
            if (rawPrice === '—' || _finalCalculatedPrice === 0) {
                showOrderError('Пожалуйста, дождитесь расчёта стоимости');
                return;
            }

            // Требуем авторизацию
            if (!TF.auth.isLoggedIn()) {
                openAuthScreen();
                return;
            }

            const btn = document.getElementById('orderButton');
            btn.disabled = true;
            document.getElementById('orderButtonText').textContent = 'Создаём заказ…';

            const tariff = tariffs.find(t => t.id === selectedTariff);
            const tariffDbId = TARIFF_ID_MAP[selectedTariff] || 1;
            const transportClass = selectedTransportClass || 'comfort';
            // Используем итоговую рассчитанную цену, а не анимированное значение
            const priceNum = _finalCalculatedPrice;

            const options = [];
            ['animalOption','skiOption','wheelchairOption','childSeatOption',
             'findCarOption','textOnlyOption','dontSpeakOption','bicycleOption'].forEach(id => {
                const el = document.getElementById(id);
                const labels = {
                    animalOption:'Перевозка животного', skiOption:'Лыжи/сноуборд',
                    wheelchairOption:'Инвалидное кресло', childSeatOption:'Детское кресло',
                    findCarOption:'Помогите найти машину', textOnlyOption:'Общаюсь только текстом',
                    dontSpeakOption:'Не говорю, но слышу', bicycleOption:'Велосипед',
                };
                if (el && el.checked) options.push(labels[id]);
            });

            const orderPayload = {
                tariff_id:       tariffDbId,
                transport_class: transportClass,
                from_address:    from,
                from_lat:        fromCoords ? fromCoords[0] : 0,
                from_lng:        fromCoords ? fromCoords[1] : 0,
                to_address:      to,
                to_lat:          toCoords ? toCoords[0] : 0,
                to_lng:          toCoords ? toCoords[1] : 0,
                distance_km:     window._lastDistanceKm || null,
                duration_min:    window._lastDurationMin || null,
                price:           priceNum,
                payment_method:  currentPayment || 'cash',
                options:         options,
                comment:         options.join(', '),
            };

            try {
                const result = await TF.orders.create(orderPayload);
                btn.disabled = false;
                document.getElementById('orderButtonText').textContent = 'Заказать трансфер';
                openOrderTracking(result.order_id, {
                    from, to, tariff: tariff ? tariff.name : 'Трансфер',
                    price: rawPrice, transportClass, payment: currentPayment || 'cash'
                });
            } catch (err) {
                btn.disabled = false;
                document.getElementById('orderButtonText').textContent = 'Заказать трансфер';
                showOrderError(err.message || 'Не удалось создать заказ. Попробуйте ещё раз.');
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
            pending:     { text: 'Ищем водителя…',        sub: 'Ожидайте — назначаем водителя',         icon: 'fa-circle-notch fa-spin', color: '#ffd84d' },
            accepted:    { text: 'Водитель едет к вам',   sub: 'Водитель выехал к точке подачи',         icon: 'fa-car',                  color: '#34c759' },
            arriving:    { text: 'Водитель на месте!',    sub: 'Выходите — водитель ждёт вас',            icon: 'fa-map-marker-alt',        color: '#ffd84d' },
            in_progress: { text: 'Поездка началась',      sub: 'Хорошей поездки!',                       icon: 'fa-route',                 color: '#007aff' },
            completed:   { text: 'Поездка завершена',     sub: 'Надеемся, поездка понравилась',           icon: 'fa-check-circle',          color: '#34c759' },
            cancelled:   { text: 'Заказ отменён',         sub: '',                                        icon: 'fa-times-circle',          color: '#ff4444' },
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
        /* ── OVERLAY ── */
        #orderTrackingOverlay{
            position:fixed;inset:0;z-index:9000;
            background:#000;
            display:flex;flex-direction:column;
            animation:otrSlideUp .32s cubic-bezier(.25,.8,.25,1);
        }
        @keyframes otrSlideUp{from{opacity:0;transform:translateY(60px)}to{opacity:1;transform:none}}

        /* ── MAP ── */
        #otrMapWrap{
            flex:1;position:relative;overflow:hidden;
            transition:flex .5s cubic-bezier(.4,0,.2,1);
            min-height:0;
        }
        #otrMapEl{position:absolute;inset:0;}

        /* Маркер машины */
        .otr-car-marker{
            position:relative;
            width:52px;height:52px;
            cursor:default;
        }

        /* ── ПУЛЬС вокруг машины ── */
        .otr-car-pulse{
            position:absolute;inset:-12px;
            border-radius:50%;
            background:rgba(52,199,89,0.18);
            animation:otrCarPulse 2s ease-in-out infinite;
        }
        @keyframes otrCarPulse{
            0%,100%{transform:scale(1);opacity:1}
            50%{transform:scale(1.45);opacity:0}
        }

        /* ── ETA BADGE на карте ── */
        .otr-eta-badge{
            position:absolute;bottom:16px;left:50%;transform:translateX(-50%);
            background:rgba(10,10,10,.88);
            backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
            border:1px solid rgba(255,255,255,.12);
            border-radius:24px;
            padding:9px 22px;
            font-size:14px;font-weight:700;color:#fff;
            white-space:nowrap;pointer-events:none;
            display:none;
            box-shadow:0 4px 20px rgba(0,0,0,.5);
        }
        .otr-eta-badge .otr-eta-car{
            display:inline-block;margin-right:6px;
        }

        /* ── ШАПКА (кнопка назад) ── */
        .otr-map-topbar{
            position:absolute;top:0;left:0;right:0;
            z-index:10;
            padding:12px 16px;
            display:flex;align-items:center;gap:10px;
            pointer-events:none;
        }
        .otr-back{
            width:40px;height:40px;border-radius:50%;
            background:rgba(10,10,10,.7);
            backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
            border:1px solid rgba(255,255,255,.1);
            cursor:pointer;color:#f0f0f0;font-size:15px;
            display:flex;align-items:center;justify-content:center;
            transition:background .2s;pointer-events:auto;
        }
        .otr-back:active{background:rgba(10,10,10,.9);}
        .otr-map-order-num{
            background:rgba(10,10,10,.7);
            backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
            border:1px solid rgba(255,255,255,.1);
            border-radius:20px;padding:0 14px;height:40px;
            display:flex;align-items:center;
            font-size:13px;color:rgba(255,255,255,.6);
            pointer-events:auto;
        }

        /* ── НИЖНИЙ ЛИСТ (как в Яндекс Go) ── */
        .otr-sheet{
            background:#1c1c1e;
            border-radius:22px 22px 0 0;
            flex-shrink:0;
            overflow:hidden;
            box-shadow:0 -8px 40px rgba(0,0,0,.6);
        }
        .otr-sheet-handle{
            width:36px;height:4px;
            background:rgba(255,255,255,.18);
            border-radius:2px;
            margin:12px auto 0;
        }

        /* ── СТАТУС СЕКЦИЯ ── */
        .otr-status-row{
            display:flex;align-items:center;gap:0;
            padding:14px 20px 0;
        }
        .otr-status-left{flex:1;min-width:0;}
        .otr-status-label{
            font-size:11px;font-weight:600;letter-spacing:.08em;
            text-transform:uppercase;
            color:rgba(255,255,255,.35);
            margin-bottom:3px;
        }
        .otr-status-main{
            font-size:20px;font-weight:800;color:#f0f0f0;
            line-height:1.2;letter-spacing:-.3px;
        }
        .otr-status-sub{
            font-size:13px;color:rgba(255,255,255,.45);
            margin-top:3px;
        }
        /* ETA справа (большой) */
        .otr-eta-right{
            text-align:right;flex-shrink:0;
            padding-left:16px;
        }
        .otr-eta-mins{
            font-size:36px;font-weight:800;color:#34c759;
            line-height:1;letter-spacing:-1px;
        }
        .otr-eta-unit{
            font-size:12px;color:rgba(255,255,255,.4);
            font-weight:500;margin-top:1px;
        }

        /* ── МАШИНА КЛИЕНТ-ИКОНКА (ищем водителя анимация) ── */
        .otr-search-wrap{
            display:flex;flex-direction:column;align-items:center;
            padding:20px 24px 16px;
        }
        .otr-search-ring{
            width:80px;height:80px;border-radius:50%;
            background:rgba(255,216,77,.08);
            display:flex;align-items:center;justify-content:center;
            position:relative;margin-bottom:16px;
        }
        .otr-search-ring::before,.otr-search-ring::after{
            content:'';position:absolute;inset:-16px;
            border-radius:50%;
            border:2px solid rgba(255,216,77,.18);
            animation:otrSearchRing 2.2s ease-in-out infinite;
        }
        .otr-search-ring::after{animation-delay:.9s;}
        @keyframes otrSearchRing{
            0%{transform:scale(.7);opacity:.8}
            100%{transform:scale(1.5);opacity:0}
        }
        .otr-search-car{font-size:32px;color:#ffd84d;animation:otrSearchCar 1.6s ease-in-out infinite;}
        @keyframes otrSearchCar{0%,100%{transform:translateX(-4px)}50%{transform:translateX(4px)}}
        .otr-search-title{font-size:17px;font-weight:700;color:#f0f0f0;margin-bottom:6px;}
        .otr-search-sub{font-size:13px;color:rgba(255,255,255,.4);text-align:center;line-height:1.5;}

        /* ── РАЗДЕЛИТЕЛЬ ── */
        .otr-sep{height:1px;background:rgba(255,255,255,.07);margin:14px 20px 0;}

        /* ── КАРТОЧКА ВОДИТЕЛЯ ── */
        .otr-driver-section{padding:14px 20px 0;}
        .otr-driver-row{display:flex;align-items:center;gap:14px;}
        .otr-driver-avatar{
            width:54px;height:54px;border-radius:50%;flex-shrink:0;
            background:linear-gradient(135deg,#2c3e2c,#1e2a1e);
            border:2px solid rgba(52,199,89,.3);
            display:flex;align-items:center;justify-content:center;
            font-size:22px;font-weight:700;color:#34c759;
            overflow:hidden;
        }
        .otr-driver-info{flex:1;min-width:0;}
        .otr-driver-name{
            font-size:17px;font-weight:700;color:#f0f0f0;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        }
        .otr-driver-stars{
            display:flex;align-items:center;gap:3px;margin-top:3px;
        }
        .otr-star-full{color:#ffd84d;font-size:12px;}
        .otr-star-empty{color:rgba(255,255,255,.2);font-size:12px;}
        .otr-rating-num{
            font-size:12px;color:rgba(255,255,255,.45);margin-left:5px;
        }
        .otr-driver-call{
            width:48px;height:48px;border-radius:50%;
            background:rgba(52,199,89,.12);
            border:1.5px solid rgba(52,199,89,.25);
            display:flex;align-items:center;justify-content:center;
            font-size:18px;color:#34c759;
            text-decoration:none;transition:background .2s;flex-shrink:0;
        }
        .otr-driver-call:active{background:rgba(52,199,89,.25);}

        /* ── АВТО ── */
        .otr-car-row{
            display:flex;align-items:center;gap:10px;
            padding:10px 20px 0;
        }
        .otr-car-color-dot{
            width:14px;height:14px;border-radius:50%;
            flex-shrink:0;
            border:2px solid rgba(255,255,255,.15);
        }
        .otr-car-model{
            font-size:14px;color:rgba(255,255,255,.75);font-weight:500;flex:1;
        }
        .otr-car-plate{
            display:inline-flex;align-items:center;
            font-size:13px;font-weight:800;letter-spacing:.1em;
            color:#f0f0f0;
            background:rgba(255,255,255,.1);
            border:1.5px solid rgba(255,255,255,.18);
            border-radius:7px;
            padding:4px 10px;
            font-family:monospace;
        }

        /* ── МАРШРУТ ── */
        .otr-route-section{padding:14px 20px 0;}
        .otr-route-title{
            font-size:10px;font-weight:700;letter-spacing:.08em;
            text-transform:uppercase;color:rgba(255,255,255,.3);
            margin-bottom:10px;
        }
        .otr-route-row{
            display:flex;gap:14px;align-items:flex-start;
            padding:6px 0;
        }
        .otr-route-left{display:flex;flex-direction:column;align-items:center;padding-top:4px;}
        .otr-route-dot{
            width:10px;height:10px;border-radius:50%;flex-shrink:0;
        }
        .otr-route-connector{
            width:2px;flex:1;min-height:18px;
            background:linear-gradient(to bottom,rgba(255,255,255,.1),rgba(255,255,255,.1));
            margin:3px 0;
        }
        .otr-route-addr-block{}
        .otr-route-label{font-size:11px;color:rgba(255,255,255,.3);margin-bottom:2px;}
        .otr-route-addr{font-size:14px;color:#e0e0e0;line-height:1.4;}

        /* ── ЦЕНА ── */
        .otr-price-section{
            display:flex;align-items:center;justify-content:space-between;
            padding:12px 20px 0;
        }
        .otr-price-label{font-size:13px;color:rgba(255,255,255,.4);}
        .otr-price-val{
            font-size:24px;font-weight:800;color:#ffd84d;letter-spacing:-.5px;
        }
        .otr-pay-chip{
            font-size:12px;color:rgba(255,255,255,.4);
            background:rgba(255,255,255,.07);
            border-radius:8px;padding:4px 10px;margin-left:8px;
            font-weight:500;
        }

        /* ── КНОПКИ ── */
        .otr-footer{
            padding:14px 20px 36px;
        }
        .otr-actions{display:flex;gap:10px;margin-bottom:10px;}
        .otr-action-btn{
            flex:1;
            display:flex;align-items:center;justify-content:center;gap:8px;
            padding:14px;
            border-radius:14px;
            font-size:15px;font-weight:600;
            cursor:pointer;transition:opacity .2s,transform .1s;
            text-decoration:none;
        }
        .otr-action-btn:active{transform:scale(.97);}
        .otr-btn-call{
            background:rgba(52,199,89,.12);
            border:1.5px solid rgba(52,199,89,.2);
            color:#34c759;
        }
        .otr-btn-msg{
            background:rgba(255,255,255,.07);
            border:1.5px solid rgba(255,255,255,.12);
            color:#f0f0f0;
        }
        .otr-cancel-btn{
            width:100%;padding:14px;
            background:transparent;
            border:1.5px solid rgba(255,68,68,.25);
            border-radius:14px;
            color:rgba(255,100,100,.9);
            font-size:14px;font-weight:500;
            cursor:pointer;transition:background .2s;
        }
        .otr-cancel-btn:active{background:rgba(255,68,68,.08);}
        .otr-done-btn{
            width:100%;padding:15px;
            background:#ffd84d;border:none;border-radius:14px;
            color:#141414;font-size:15px;font-weight:700;cursor:pointer;
        }

        /* ── РЕЙТИНГ ── */
        .otr-rating-card{
            background:#1c1c1e;border-radius:18px;
            padding:20px;margin:10px 20px 0;
            border:1px solid rgba(255,255,255,.07);
            text-align:center;
        }
        .otr-rating-title{font-size:16px;font-weight:700;color:#f0f0f0;margin-bottom:16px;}
        .otr-stars-input{display:flex;gap:8px;justify-content:center;margin-bottom:18px;}
        .otr-star-btn{
            font-size:38px;cursor:pointer;
            color:rgba(255,255,255,.15);
            transition:all .15s;background:none;border:none;padding:0;
        }
        .otr-star-btn.lit{color:#ffd84d;transform:scale(1.12);}
        .otr-rate-btn{
            padding:13px 48px;
            background:#ffd84d;border:none;border-radius:14px;
            color:#141414;font-size:15px;font-weight:700;cursor:pointer;
        }

        /* ── FLASH УВЕДОМЛЕНИЯ ── */
        .otr-flash-overlay{
            position:fixed;inset:0;z-index:9100;
            display:flex;align-items:center;justify-content:center;
            background:rgba(0,0,0,.55);
            backdrop-filter:blur(5px);
            animation:otrFlashBg .25s ease;
        }
        @keyframes otrFlashBg{from{opacity:0}to{opacity:1}}
        .otr-flash-card{
            background:#1c1c1e;border-radius:26px;
            padding:36px 28px;text-align:center;
            max-width:310px;width:88%;
            animation:otrFlashCard .35s cubic-bezier(.34,1.56,.64,1);
        }
        @keyframes otrFlashCard{from{transform:scale(.65) translateY(30px);opacity:0}to{transform:none;opacity:1}}
        .otr-flash-ico{
            width:72px;height:72px;border-radius:50%;
            display:flex;align-items:center;justify-content:center;
            margin:0 auto 18px;font-size:30px;
        }
        .otr-flash-title{font-size:21px;font-weight:800;color:#f0f0f0;margin-bottom:8px;}
        .otr-flash-sub{font-size:14px;color:rgba(255,255,255,.45);line-height:1.5;}

        /* ── ARRIVING PULSE ── */
        @keyframes otrArrivingPulse{
            0%,100%{box-shadow:0 0 0 0 rgba(255,216,77,.5)}
            60%{box-shadow:0 0 0 20px rgba(255,216,77,0)}
        }
        .otr-arriving-pulse{animation:otrArrivingPulse 1.6s ease-in-out infinite;}

        /* ── МИНИ-КАРТОЧКА (Яндекс Go floating card) ── */
        #activeOrderCard{
            position:fixed;left:0;right:0;bottom:0;z-index:8900;
            padding:0 12px 16px;pointer-events:none;
            transform:translateY(130%);
            transition:transform .4s cubic-bezier(.34,1.26,.64,1);
        }
        #activeOrderCard.aoc-visible{transform:translateY(0);pointer-events:auto;}
        .aoc-inner{
            background:#1c1c1e;border-radius:20px;overflow:hidden;
            box-shadow:0 -2px 30px rgba(0,0,0,.5);
            border:1px solid rgba(255,255,255,.08);
        }
        .aoc-status-bar{height:3px;background:#ffd84d;transition:background .4s;}
        .aoc-body{display:flex;align-items:center;gap:14px;padding:14px 16px;}
        .aoc-icon{
            width:46px;height:46px;border-radius:50%;
            display:flex;align-items:center;justify-content:center;
            font-size:18px;flex-shrink:0;transition:background .4s;
        }
        .aoc-info{flex:1;min-width:0;}
        .aoc-status{font-size:14px;font-weight:700;color:#f0f0f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .aoc-sub{font-size:12px;color:rgba(255,255,255,.4);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .aoc-right{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;}
        .aoc-eta{font-size:14px;font-weight:700;color:#ffd84d;}
        .aoc-chevron{color:rgba(255,255,255,.2);font-size:14px;}
        .aoc-pulse{animation:aocPulse 1.8s ease-in-out infinite;}
        @keyframes aocPulse{0%,100%{opacity:1}50%{opacity:.45}}

        /* ── ИНДИКАТОР ОШИБКИ СЕТИ ── */
        .otr-net-error{
            position:fixed;bottom:130px;left:50%;transform:translateX(-50%);
            background:rgba(255,68,68,.92);color:#fff;
            padding:10px 20px;border-radius:22px;
            font-size:13px;font-weight:600;z-index:9999;
            backdrop-filter:blur(8px);
            display:none;white-space:nowrap;
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

        // ── Начальный HTML оверлея ─────────────────────────────────────────────
        function buildOverlayHtml(orderId, info) {
            return `
            <div id="otrMapWrap">
                <div id="otrMapEl"></div>
                <div class="otr-map-topbar">
                    <button class="otr-back" onclick="minimizeOrderTracking()"><i class="fas fa-arrow-left"></i></button>
                    <div class="otr-map-order-num">Заказ №${orderId}</div>
                </div>
                <div class="otr-eta-badge" id="otrEtaBadge">
                    <span class="otr-eta-car">🚗</span><span id="otrEtaText"></span>
                </div>
            </div>
            <div class="otr-sheet" id="otrSheet">
                <div class="otr-sheet-handle"></div>
                <div id="otrStatusRow" class="otr-status-row">
                    <div class="otr-status-left">
                        <div class="otr-status-label">Статус заказа</div>
                        <div class="otr-status-main" id="otrStatusMain">Создаём заказ…</div>
                        <div class="otr-status-sub" id="otrStatusSub"></div>
                    </div>
                    <div class="otr-eta-right" id="otrEtaRight" style="display:none">
                        <div class="otr-eta-mins" id="otrEtaMins">—</div>
                        <div class="otr-eta-unit">мин</div>
                    </div>
                </div>
                <div id="otrSheetBody">
                    <!-- Поиск водителя -->
                    <div class="otr-search-wrap">
                        <div class="otr-search-ring">
                            <i class="fas fa-car otr-search-car"></i>
                        </div>
                        <div class="otr-search-title">Ищем водителя…</div>
                        <div class="otr-search-sub">Обычно это занимает меньше минуты</div>
                    </div>
                    <div class="otr-sep"></div>
                    <!-- Маршрут -->
                    <div class="otr-route-section">
                        <div class="otr-route-title">Маршрут</div>
                        <div class="otr-route-row">
                            <div class="otr-route-left">
                                <div class="otr-route-dot" style="background:#34c759"></div>
                                <div class="otr-route-connector"></div>
                            </div>
                            <div class="otr-route-addr-block">
                                <div class="otr-route-label">Откуда</div>
                                <div class="otr-route-addr">${info.from || '—'}</div>
                            </div>
                        </div>
                        <div class="otr-route-row">
                            <div class="otr-route-left">
                                <div class="otr-route-dot" style="background:#ffd84d"></div>
                            </div>
                            <div class="otr-route-addr-block">
                                <div class="otr-route-label">Куда</div>
                                <div class="otr-route-addr">${info.to || '—'}</div>
                            </div>
                        </div>
                    </div>
                    <div class="otr-sep"></div>
                    <!-- Цена -->
                    <div class="otr-price-section">
                        <div class="otr-price-label">Стоимость</div>
                        <div style="display:flex;align-items:baseline;gap:0">
                            <div class="otr-price-val">${info.price || '—'} ₸</div>
                        </div>
                    </div>
                </div>
                <div class="otr-footer" id="otrFooter">
                    <button class="otr-cancel-btn" onclick="cancelActiveOrder(${orderId})">Отменить заказ</button>
                </div>
            </div>`;
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

            overlay.style.display = 'flex';
            overlay.style.flexDirection = 'column';
            overlay.innerHTML = buildOverlayHtml(orderId, info);

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
                    try {
                        const full = await TF.orders.get(String(orderId));
                        if (_lastTrackedStatus !== full.status) onStatusChanged(full);
                        _lastTrackedStatus = full.status;
                        renderTrackingInfo(orderId, full);
                        clearInterval(_trackingInterval);
                    } catch {}
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
                el.textContent = '⚠️ Нет связи с сервером…';
                document.body.appendChild(el);
            }
            el.style.display = 'block';
        }
        function hidePollError() {
            const el = document.getElementById('otrNetError');
            if (el) el.style.display = 'none';
        }

        function onStatusChanged(order) {
            const overlay = document.getElementById('orderTrackingOverlay');
            const overlayHidden = !overlay || overlay.style.display === 'none';
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

            if (order.status === 'accepted') {
                showDriverFoundFlash(order);
                if (overlayHidden) setTimeout(window.reopenOrderTracking, 700);
            }
            if (order.status === 'arriving') {
                showArrivingFlash();
                if (overlayHidden) setTimeout(window.reopenOrderTracking, 700);
            }
            if (order.status === 'in_progress') {
                showInProgressFlash();
            }
            if (order.status === 'completed') {
                showCompletedFlash();
            }
        }

        function _showFlash(iconHtml, title, sub, borderColor) {
            const flash = document.createElement('div');
            flash.className = 'otr-flash-overlay';
            flash.innerHTML = `
            <div class="otr-flash-card" style="border:1px solid ${borderColor}">
                <div class="otr-flash-ico">${iconHtml}</div>
                <div class="otr-flash-title">${title}</div>
                <div class="otr-flash-sub">${sub}</div>
            </div>`;
            document.body.appendChild(flash);
            flash.addEventListener('click', () => flash.remove());
            setTimeout(() => { flash.style.transition='opacity .3s'; flash.style.opacity='0'; setTimeout(()=>flash.remove(),300); }, 3500);
        }

        function showDriverFoundFlash(order) {
            const carStr = [order.car_make,order.car_model,order.car_color].filter(Boolean).join(' ');
            _showFlash(
                `<i class="fas fa-check" style="color:#34c759;font-size:32px"></i>`,
                'Водитель найден!',
                `${order.driver_name || 'Водитель'} едет к вам${carStr ? '<br><span style="font-size:13px">' + carStr + '</span>' : ''}`,
                'rgba(52,199,89,.25)'
            );
        }

        function showArrivingFlash() {
            _showFlash(
                `<i class="fas fa-map-marker-alt" style="color:#ffd84d;font-size:32px"></i>`,
                'Водитель на месте!',
                'Выходите — водитель ждёт вас',
                'rgba(255,216,77,.25)'
            );
        }

        function showInProgressFlash() {
            _showFlash(
                `<i class="fas fa-route" style="color:#007aff;font-size:32px"></i>`,
                'Поездка началась!',
                'Хорошей дороги 🚗',
                'rgba(0,122,255,.25)'
            );
        }

        function showCompletedFlash() {
            _showFlash(
                `<i class="fas fa-flag-checkered" style="color:#34c759;font-size:32px"></i>`,
                'Поездка завершена!',
                'Надеемся, вам понравилось путешествие',
                'rgba(52,199,89,.25)'
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

            const cfg = ORDER_STATUS_CFG[order.status] || { text: order.status, sub: '', icon:'fa-circle', color:'#ffd84d' };
            if (statusMain) statusMain.textContent = cfg.text;
            if (statusSub)  statusSub.textContent  = order.status === 'cancelled'
                ? (order.cancel_reason || 'Заказ был отменён') : cfg.sub;

            // ETA справа — показываем только когда водитель едет
            if (etaRight) {
                const showEta = ['accepted','arriving'].includes(order.status) && _etaMinutes;
                etaRight.style.display = showEta ? 'block' : 'none';
                if (showEta && etaMins) etaMins.textContent = _etaMinutes;
            }

            // Показываем ETA badge на карте
            const etaBadge = document.getElementById('otrEtaBadge');
            const etaText  = document.getElementById('otrEtaText');
            if (etaBadge && etaText) {
                if (_etaMinutes && ['accepted','arriving'].includes(order.status)) {
                    etaText.textContent = _etaMinutes <= 1 ? 'Водитель рядом!' : `Прибудет через ~${_etaMinutes} мин`;
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
            const payLabel = order.payment_method === 'cash' ? 'Наличными' : 'Картой';

            // Блок водителя
            let driverBlock = '';
            if (order.driver_name || order.car_make) {
                const r      = parseFloat(order.driver_rating) || 0;
                const carStr = [order.car_make, order.car_model].filter(Boolean).join(' ');
                const carColor = carColorFromString(order.car_color);
                const initial = (order.driver_name || 'В').charAt(0).toUpperCase();

                driverBlock = `
                <div class="otr-sep"></div>
                <div class="otr-driver-section">
                    <div class="otr-route-title">Водитель</div>
                    <div class="otr-driver-row">
                        <div class="otr-driver-avatar">${initial}</div>
                        <div class="otr-driver-info">
                            <div class="otr-driver-name">${order.driver_name || 'Водитель'}</div>
                            <div class="otr-driver-stars">
                                ${renderStars(r)}
                                ${r ? `<span class="otr-rating-num">${r.toFixed(1)}</span>` : ''}
                            </div>
                        </div>
                        ${order.driver_phone ? `<a href="tel:${order.driver_phone}" class="otr-driver-call"><i class="fas fa-phone"></i></a>` : ''}
                    </div>
                    ${(carStr || order.car_number || order.car_color) ? `
                    <div class="otr-car-row">
                        <div class="otr-car-color-dot" style="background:${carColor}"></div>
                        <div class="otr-car-model">${carStr}${order.car_color ? ', ' + order.car_color : ''}</div>
                        ${order.car_number ? `<div class="otr-car-plate">${order.car_number}</div>` : ''}
                    </div>` : ''}
                    ${order.driver_phone ? `
                    <div class="otr-actions" style="margin-top:14px">
                        <a href="tel:${order.driver_phone}" class="otr-action-btn otr-btn-call"><i class="fas fa-phone"></i> Позвонить</a>
                        <button class="otr-action-btn otr-btn-msg"><i class="fas fa-comment"></i> Написать</button>
                    </div>` : ''}
                </div>`;
            }

            // Поиск (только pending)
            const searchBlock = order.status === 'pending' ? `
                <div class="otr-search-wrap">
                    <div class="otr-search-ring"><i class="fas fa-car otr-search-car"></i></div>
                    <div class="otr-search-title">Ищем водителя…</div>
                    <div class="otr-search-sub">Обычно это занимает меньше минуты</div>
                </div>` : '';

            // Рейтинг (completed)
            const ratingBlock = order.status === 'completed' ? `
                <div class="otr-sep" style="margin-top:14px"></div>
                <div class="otr-rating-card">
                    <div class="otr-rating-title">Как прошла поездка?</div>
                    <div class="otr-stars-input" id="otrStarsInput">
                        ${[1,2,3,4,5].map(i=>`<button class="otr-star-btn" onclick="selectRatingStar(${i})">★</button>`).join('')}
                    </div>
                    <button class="otr-rate-btn" onclick="submitOrderRating(${orderId})">Оценить</button>
                </div>` : '';

            body.innerHTML = `
            ${searchBlock}
            ${driverBlock}
            <div class="otr-sep"></div>
            <div class="otr-route-section">
                <div class="otr-route-title">Маршрут</div>
                <div class="otr-route-row">
                    <div class="otr-route-left">
                        <div class="otr-route-dot" style="background:#34c759"></div>
                        <div class="otr-route-connector"></div>
                    </div>
                    <div class="otr-route-addr-block">
                        <div class="otr-route-label">Откуда</div>
                        <div class="otr-route-addr">${order.from_address || '—'}</div>
                    </div>
                </div>
                <div class="otr-route-row">
                    <div class="otr-route-left">
                        <div class="otr-route-dot" style="background:#ffd84d"></div>
                    </div>
                    <div class="otr-route-addr-block">
                        <div class="otr-route-label">Куда</div>
                        <div class="otr-route-addr">${order.to_address || '—'}</div>
                    </div>
                </div>
            </div>
            <div class="otr-price-section">
                <div class="otr-price-label">Стоимость</div>
                <div style="display:flex;align-items:baseline">
                    <div class="otr-price-val">${price}</div>
                    <div class="otr-pay-chip">${payLabel}</div>
                </div>
            </div>
            ${ratingBlock}`;

            // Footer
            if (footer) {
                if (['completed','cancelled'].includes(order.status)) {
                    footer.innerHTML = `<button class="otr-done-btn" onclick="closeOrderTracking()">Закрыть</button>`;
                    hideActiveOrderCard();
                } else if (['pending','accepted'].includes(order.status)) {
                    footer.innerHTML = `<button class="otr-cancel-btn" onclick="cancelActiveOrder(${orderId})">Отменить заказ</button>`;
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

                // Маркер точки подачи (зелёный)
                if (order.from_lat) {
                    _trackingMap.geoObjects.add(new ymaps.Placemark(
                        [parseFloat(order.from_lat), parseFloat(order.from_lng)],
                        { hintContent: 'Точка подачи' },
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
                        if (etaText) etaText.textContent = _etaMinutes <= 1 ? 'Водитель рядом!' : `Прибудет через ~${_etaMinutes} мин`;
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

        // ── Свернуть в мини-карточку ──────────────────────────────────────────
        window.minimizeOrderTracking = function() {
            const overlay = document.getElementById('orderTrackingOverlay');
            if (overlay) {
                overlay.style.transition = 'opacity .25s,transform .25s';
                overlay.style.opacity    = '0';
                overlay.style.transform  = 'translateY(60px)';
                setTimeout(() => {
                    overlay.style.display    = 'none';
                    overlay.style.opacity    = '';
                    overlay.style.transform  = '';
                    overlay.style.transition = '';
                }, 260);
            }
            showActiveOrderCard();
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
            const overlay = document.getElementById('orderTrackingOverlay');
            if (overlay) overlay.style.display = 'none';
        };

        // ── Открыть из мини-карточки ──────────────────────────────────────────
        window.reopenOrderTracking = function() {
            if (!_trackingOrderId) return;
            hideActiveOrderCard();
            const overlay = document.getElementById('orderTrackingOverlay');
            if (overlay) {
                overlay.style.display = 'flex';
                overlay.style.flexDirection = 'column';
                if (!_trackingInterval) {
                    const _oid = String(_trackingOrderId);
                    _pollFailCount = 0;
                    _trackingInterval = setInterval(() => pollOrderStatus(_oid), 2000);
                    pollOrderStatus(_oid);
                }
            }
        };

        // ── Мини-карточка (Яндекс GO стиль — всегда снизу) ───────────────────
        function showActiveOrderCard() {
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
                                '<div class="aoc-chevron"><i class="fas fa-chevron-up"></i></div>' +
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
                    sub.textContent = cfg.sub || 'Нажмите чтобы открыть';
                }
            }
            if (eta) eta.textContent = _etaMinutes && _etaMinutes > 0 ? '~' + _etaMinutes + ' мин' : '';
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
            if (!rating) { alert('Пожалуйста, выберите оценку'); return; }
            try {
                await TF.orders.rate(orderId, rating, '');
                const sec = document.querySelector('.otr-rating-card');
                if (sec) sec.innerHTML = '<div style="color:#34c759;text-align:center;padding:20px;font-size:15px;font-weight:600"><i class="fas fa-check-circle" style="font-size:28px;display:block;margin-bottom:10px;color:#34c759"></i>Спасибо за оценку!</div>';
            } catch(e) { alert(e.message || 'Ошибка'); }
        };

        window.cancelActiveOrder = async function(orderId) {
            if (!confirm('Отменить заказ?')) return;
            try {
                await TF.orders.cancel(orderId, 'Отменён клиентом');
                if (_trackingInterval) { clearInterval(_trackingInterval); _trackingInterval = null; }
                pollOrderStatus(orderId);
            } catch(e) { alert(e.message || 'Не удалось отменить заказ'); }
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

        function animateCounter(element, targetValue, duration = 800) {
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
            }

            const startValue = currentAnimatedPrice;
            const startTime = performance.now();

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
                syncUI(h, false, false); // анимация скрытия кнопок через CSS transition
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
    if (label) label.textContent = isLight ? 'Светлая тема включена' : 'Тёмная тема включена';

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
    var label = document.getElementById('hsDrawerThemeLabel');
    if (label) label.textContent = isLight ? 'Светлая тема включена' : 'Тёмная тема включена';
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
        label.textContent = document.body.classList.contains('light-theme')
            ? 'Светлая тема включена'
            : 'Тёмная тема включена';
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

window.openDriverApplication = async function() {
    // 1. Проверяем авторизацию
    if (!TF.auth.isLoggedIn()) {
        closeDriverScreen();
        setTimeout(function() { openAuthScreen(); }, 300);
        return;
    }

    var user = TF.auth.getUser();

    // 2. Если уже водитель — открываем приложение водителя
    if (user.role === 'driver') {
        window.location.href = 'driver.html';
        return;
    }

    // 3. Блокируем кнопку
    var btn = document.querySelector('.drv-cta-btn');
    if (btn) { btn.disabled = true; btn.querySelector('.drv-cta-main').textContent = 'Отправляем...'; }

    try {
        // 4. Отправляем заявку на API (данные авто менеджер уточнит по звонку)
        await TF.drivers.apply({});

        // 5. Показываем успех
        var overlay = document.getElementById('drvModalOverlay');
        if (overlay) overlay.classList.add('is-open');

        // 6. Обновляем кнопку — заявка отправлена
        if (btn) {
            btn.disabled = true;
            btn.querySelector('.drv-cta-main').textContent = 'Заявка на рассмотрении';
            btn.querySelector('.drv-cta-sub').textContent = 'Мы вам перезвоним';
            btn.style.opacity = '0.6';
        }
    } catch (err) {
        // Если уже подавал заявку — тоже показываем статус
        if (err.status === 400 || err.message && err.message.includes('заявка')) {
            if (btn) {
                btn.disabled = true;
                btn.querySelector('.drv-cta-main').textContent = 'Заявка уже отправлена';
                btn.querySelector('.drv-cta-sub').textContent = 'Ожидайте звонка менеджера';
                btn.style.opacity = '0.6';
            }
        } else {
            alert(err.message || 'Ошибка. Попробуйте позже.');
            if (btn) {
                btn.disabled = false;
                btn.querySelector('.drv-cta-main').textContent = 'Оставить заявку';
                btn.querySelector('.drv-cta-sub').textContent = 'Вам перезвонят';
            }
        }
    }
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

        // Если пользователь уже водитель — сразу редиректим
        if (TF.auth.isLoggedIn()) {
            var user = TF.auth.getUser();
            if (user.role === 'driver') {
                try {
                    // Актуализируем данные с сервера
                    var me = await TF.auth.me();
                    if (me.driver && me.driver.status === 'approved') {
                        window.location.href = 'driver.html';
                        return;
                    }
                    // Статус заявки — обновляем кнопку
                    var btn = document.querySelector('.drv-cta-btn');
                    if (btn && me.driver) {
                        var statusMap = {
                            pending:  { main: 'Заявка на рассмотрении', sub: 'Мы вам перезвоним' },
                            approved: { main: 'Открыть приложение водителя', sub: '' },
                            rejected: { main: 'Подать заявку повторно', sub: 'Обратитесь в поддержку' }
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