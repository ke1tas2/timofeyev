// Version: 3.1.0 - New point B selection mode: drag map, confirm location
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
                // Обновляем адрес динамически при движении карты:
                // - для точки А всегда (когда не выбираем точку Б)
                // - для точки Б только в режиме выбора (point-selection-mode)
                if (selectingPoint === 'to') {
                    // В режиме выбора точки Б - обновляем адрес точки Б
                    if (centerGeocodeTimer) clearTimeout(centerGeocodeTimer);
                    centerGeocodeTimer = setTimeout(function() {
                        const center = map.getCenter();
                        geocodeCoords('to', center, false);
                    }, 800);
                } else if (!selectingPoint || selectingPoint === 'from') {
                    // Для точки А - обновляем всегда (включая режим выбора)
                    if (centerGeocodeTimer) clearTimeout(centerGeocodeTimer);
                    centerGeocodeTimer = setTimeout(function() {
                        const center = map.getCenter();
                        geocodeCoords('from', center, false);
                    }, 800);
                }
            });

            document.getElementById('zoomIn').addEventListener('click', function() {
                map.setZoom(map.getZoom() + 1, { duration: 200 });
            });
            document.getElementById('zoomOut').addEventListener('click', function() {
                map.setZoom(map.getZoom() - 1, { duration: 200 });
            });

            document.getElementById('geoBtn').addEventListener('click', function() {
                if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                        function(position) {
                            const coords = [position.coords.latitude, position.coords.longitude];
                            geocodeCoords('from', coords);
                            map.setCenter(coords, 15, { duration: 300 });
                        },
                        function() {
                            alert('Не удалось определить местоположение. Разрешите доступ к геолокации.');
                        },
                        { enableHighAccuracy: true, timeout: 10000 }
                    );
                }
            });

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

            document.getElementById('toField').addEventListener('click', () => {
                document.getElementById('toInput').focus();
            });

            document.getElementById('fromField').addEventListener('click', () => {
                document.getElementById('fromInput').focus();
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && selectingPoint) {
                    cancelSelection();
                }
            });

            updateClearButtons();

            updatePaymentMethods();

            setupCardInputFormatting();

            updatePrice();

            setupBottomSheet();
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
            const fromInput = document.getElementById('fromInput');
            const toInput = document.getElementById('toInput');

            [fromInput, toInput].forEach(input => {
                input.addEventListener('input', function() {
                    updateClearButtons();
                });
            });

            [fromInput, toInput].forEach(input => {
                input.addEventListener('focus', function() {
                    this.parentElement.parentElement.classList.add('focused');
                });

                input.addEventListener('blur', function() {
                    this.parentElement.parentElement.classList.remove('focused');
                });
            });

            toInput.addEventListener('input', debounce((e) => {
                if (e.target.value.length > 2) {
                    searchAddress('to', e.target.value);
                }
            }, 300));

            toInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    searchAddress('to', e.target.value);
                }
            });
        }

        function updateClearButtons() {
            document.getElementById('clearFrom').style.display =
                document.getElementById('fromInput').value ? 'flex' : 'none';
            document.getElementById('clearTo').style.display =
                document.getElementById('toInput').value ? 'flex' : 'none';
        }

        function requestUserLocation() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    function(position) {
                        const coords = [position.coords.latitude, position.coords.longitude];
                        geocodeCoords('from', coords);
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
            selectingPoint = pointType;

            // НОВЫЙ РЕЖИМ для обеих точек: перетаскивание карты с маркером в центре
            if (pointType === 'to' || pointType === 'from') {
                // Предотвращаем фокус на input (блокируем клавиатуру)
                const input = document.getElementById(pointType === 'to' ? 'toInput' : 'fromInput');
                if (input) {
                    input.blur();
                }
                
                // Скрываем весь интерфейс кроме кнопки заказа
                const panel = document.getElementById('panel');
                if (panel) {
                    panel.classList.add('point-selection-mode');
                }
                
                // Меняем текст и обработчик кнопки
                const orderBtn = document.getElementById('orderButton');
                const orderBtnText = document.getElementById('orderButtonText');
                
                if (orderBtnText) {
                    orderBtnText.textContent = 'Подтвердить';
                }
                
                if (orderBtn) {
                    orderBtn.onclick = function() {
                        confirmPointSelection();
                    };
                }
                
                // Показываем маркер в центре карты
                document.getElementById('mapMarker').classList.remove('hidden');
                
                // Удаляем обработчик клика по карте (не нужен в новом режиме)
                if (mapClickHandler) {
                    map.events.remove('click', mapClickHandler);
                    mapClickHandler = null;
                }
                
                // Для точки А сразу обновляем адрес по текущему центру карты
                if (pointType === 'from') {
                    const center = map.getCenter();
                    geocodeCoords('from', center, false);
                }
                
                return; // Выходим, не выполняя старую логику
            }

            // СТАРАЯ ЛОГИКА (fallback для других случаев)
            document.getElementById('mapSelectMode').classList.add('active');
            document.getElementById('mapMarker').classList.add('hidden');

            const fromBtn = document.getElementById('fromSelectButton');
            if (fromBtn) fromBtn.classList.add('active');
            document.getElementById('fromMapButton').classList.add('active');

            if (mapClickHandler) {
                map.events.remove('click', mapClickHandler);
            }

            mapClickHandler = function(e) {
                const coords = e.get('coords');
                geocodeCoords(pointType, coords);
                finishSelection();
            };

            map.events.add('click', mapClickHandler);
        }

        function confirmPointSelection() {
            if (selectingPoint !== 'to' && selectingPoint !== 'from') return;
            
            // Берём координаты центра карты (где маркер)
            const coords = map.getCenter();
            
            // Устанавливаем как выбранную точку (не двигая карту)
            geocodeCoords(selectingPoint, coords, false);
            
            // Выходим из режима выбора
            finishSelection();
        }

        function finishSelection() {
            const wasSelectingPoint = selectingPoint === 'to' || selectingPoint === 'from';
            
            selectingPoint = null;
            
            // Возвращаем UI если был режим выбора точки (А или Б)
            if (wasSelectingPoint) {
                const panel = document.getElementById('panel');
                const orderBtn = document.getElementById('orderButton');
                const orderBtnText = document.getElementById('orderButtonText');
                
                if (panel) {
                    panel.classList.remove('point-selection-mode');
                }
                
                if (orderBtnText) {
                    orderBtnText.textContent = 'Заказать трансфер';
                }
                
                if (orderBtn) {
                    orderBtn.onclick = orderTaxi;
                }
            }
            
            // Старая логика для точки А
            document.getElementById('mapSelectMode').classList.remove('active');
            const fromBtn = document.getElementById('fromSelectButton');
            const toBtn = document.getElementById('toSelectButton');
            if (fromBtn) fromBtn.classList.remove('active');
            if (toBtn) toBtn.classList.remove('active');
            document.getElementById('fromMapButton').classList.remove('active');
            document.getElementById('toMapButton').classList.remove('active');

            document.getElementById('mapMarker').classList.remove('hidden');

            if (mapClickHandler) {
                map.events.remove('click', mapClickHandler);
                mapClickHandler = null;
            }
        }

        function cancelSelection() {
            finishSelection();
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
                preset: 'islands#redCircleDotIcon',
                iconColor: '#fc3f1e',
                iconOpacity: 0,
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

        let geocodeTimer = null;
        let geocodeRequestCounter = 0;

        function geocodeCoords(pointType, coords, updateMap = true) {
            if (geocodeTimer) {
                clearTimeout(geocodeTimer);
            }

            geocodeTimer = setTimeout(function() {
                performGeocode(pointType, coords, updateMap);
            }, 500);
        }

        function performGeocode(pointType, coords, updateMap) {
            console.log('=== Начало геокодирования ===');
            console.log('Координаты:', coords);
            console.log('Тип точки:', pointType);

            const lat = coords[0];
            const lon = coords[1];

            const callbackName = 'geocodeCallback_' + (++geocodeRequestCounter);
            let timeoutId = null;
            let scriptElement = null;

            // Функция очистки
            function cleanup() {
                if (timeoutId) clearTimeout(timeoutId);
                if (window[callbackName]) delete window[callbackName];
                if (scriptElement && scriptElement.parentNode) {
                    scriptElement.parentNode.removeChild(scriptElement);
                }
            }

            // Fallback на Yandex Geocoder если OSM не работает
            function fallbackToYandex() {
                console.warn('OSM недоступен, используем Yandex Geocoder');
                cleanup();
                
                if (typeof ymaps === 'undefined' || !ymaps.geocode) {
                    showCoordinates(pointType, coords, updateMap);
                    return;
                }

                ymaps.geocode(coords, { results: 1 }).then(function(res) {
                    const firstGeoObject = res.geoObjects.get(0);
                    if (firstGeoObject) {
                        let address = firstGeoObject.getAddressLine();
                        
                        // Убираем страну и город если они есть
                        const parts = address.split(',').map(s => s.trim());
                        if (parts.length > 2) {
                            address = parts.slice(-2).join(', ');
                        }
                        
                        if (pointType === 'from') {
                            document.getElementById('fromInput').value = address;
                            if (updateMap) {
                                setFromPoint(coords, address);
                            } else {
                                fromCoords = coords;
                                updateMarkerWithAddress(coords, address);
                            }
                        } else {
                            setToPoint(coords, address);
                        }
                    } else {
                        showCoordinates(pointType, coords, updateMap);
                    }
                }, function(err) {
                    console.error('Yandex Geocoder error:', err);
                    showCoordinates(pointType, coords, updateMap);
                });
            }

            // Таймаут 8 секунд для OSM
            timeoutId = setTimeout(function() {
                console.warn('OSM timeout, переключаемся на Yandex');
                fallbackToYandex();
            }, 8000);

            window[callbackName] = function(data) {
                console.log('Получен ответ от Nominatim:', data);
                cleanup();

                if (!data || !data.address) {
                    console.warn('Адрес не найден в ответе');
                    fallbackToYandex();
                    return;
                }

                let address = '';
                const addr = data.address;

                console.log('Компоненты адреса:', addr);

                if (addr.road && addr.house_number) {
                    address = `${addr.road}, ${addr.house_number}`;
                } else if (addr.road) {
                    address = addr.road;
                } else if (addr.neighbourhood) {
                    address = addr.neighbourhood;
                } else if (addr.suburb) {
                    address = addr.suburb;
                } else if (addr.city || addr.town || addr.village) {
                    address = addr.city || addr.town || addr.village;
                } else if (data.display_name) {
                    const parts = data.display_name.split(',');
                    address = parts.slice(0, 2).join(',').trim();
                }

                if (!address || address.trim().length === 0) {
                    console.warn('Не удалось сформировать адрес');
                    fallbackToYandex();
                    return;
                }

                console.log('=== ИТОГОВЫЙ АДРЕС:', address, '===');

                if (pointType === 'from') {
                    document.getElementById('fromInput').value = address;
                    if (updateMap) {
                        setFromPoint(coords, address);
                    } else {
                        fromCoords = coords;
                        updateMarkerWithAddress(coords, address);
                    }
                } else {
                    setToPoint(coords, address);
                }
            };

            scriptElement = document.createElement('script');
            scriptElement.id = callbackName;
            scriptElement.src = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=ru&json_callback=${callbackName}`;

            scriptElement.onerror = function() {
                console.error('!!! Ошибка при загрузке скрипта геокодирования OSM');
                fallbackToYandex();
            };

            document.head.appendChild(scriptElement);
        }

        function updateMarkerWithAddress(coords, address) {
            if (!fromMarker) {
                fromMarker = new ymaps.Placemark(coords, {
                    hintContent: 'Отправление',
                    balloonContent: address
                }, {
                    preset: 'islands#redCircleDotIcon',
                    iconColor: '#fc3f1e',
                    iconOpacity: 0,
                    draggable: true,
                    balloonCloseButton: false,
                    hideIconOnBalloonOpen: false,
                    openBalloonOnClick: false
                });

                fromMarker.events.add('dragend', function() {
                    const newCoords = fromMarker.geometry.getCoordinates();
                    fromCoords = newCoords;
                    geocodeCoords('from', newCoords, false);
                });

                map.geoObjects.add(fromMarker);
            } else {
                fromMarker.geometry.setCoordinates(coords);
                fromMarker.properties.set('balloonContent', address);
            }
            updateRoute();
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
                    updateMarkerWithAddress(coords, address);
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
                preset: 'islands#blackCircleDotIcon',
                iconColor: '#000000',
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
            if (route) {
                map.geoObjects.remove(route);
                route = null;
            }

            if (fromCoords && toCoords) {
                ymaps.route([
                    fromCoords,
                    toCoords
                ], {
                    mapStateAutoApply: false,
                    boundsAutoApply: false
                }).then(function(router) {
                    route = router;

                    // Проверка что route полностью загружен (важно для iframe в Tilda)
                    if (!route || typeof route.options !== 'object') {
                        console.warn('Route object not fully loaded');
                        const directDistance = calculateDirectDistance(fromCoords, toCoords);
                        calculatePrice(directDistance);
                        return;
                    }

                    route.options.set({
                        routeActiveStrokeWidth: 5,
                        routeActiveStrokeColor: '#fc3f1e',
                        routeStrokeWidth: 4,
                        routeStrokeColor: '#fc3f1e',
                        pinVisible: false
                    });

                    map.geoObjects.add(route);

                    if (centerOnRoute && typeof route.getBounds === 'function') {
                        const bounds = route.getBounds();
                        if (bounds) {
                            map.setBounds(bounds, {
                                checkZoomRange: true,
                                zoomMargin: 50
                            });
                        }
                    }

                    // Безопасное получение активного маршрута
                    if (typeof route.getActiveRoute === 'function') {
                        const activeRoute = route.getActiveRoute();
                        if (activeRoute && activeRoute.properties) {
                            const distance = activeRoute.properties.get("distance");
                            if (distance && distance.value) {
                                calculatePrice(distance.value / 1000);
                            } else {
                                const directDistance = calculateDirectDistance(fromCoords, toCoords);
                                calculatePrice(directDistance);
                            }
                        } else {
                            const directDistance = calculateDirectDistance(fromCoords, toCoords);
                            calculatePrice(directDistance);
                        }
                    } else {
                        // Fallback: прямая дистанция если метод недоступен
                        const directDistance = calculateDirectDistance(fromCoords, toCoords);
                        calculatePrice(directDistance);
                    }
                }).catch(function(error) {
                    console.log('Ошибка построения маршрута:', error);
                    const directDistance = calculateDirectDistance(fromCoords, toCoords);
                    calculatePrice(directDistance);
                });
            } else {
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
                }
            });

            // Обновляем скрытый элемент для orderTaxi()
            const priceElement = document.getElementById('priceAmount');
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

        function orderTaxi() {
            const from = document.getElementById('fromInput').value;
            const to = document.getElementById('toInput').value;
            const price = document.getElementById('priceAmount').textContent;
            const phoneNumber = document.getElementById('phoneInput').value;

            if (!from || !to) {
                alert('Пожалуйста, укажите точки отправления и назначения');
                return;
            }

            if (price === '—') {
                alert('Пожалуйста, дождитесь расчета стоимости');
                return;
            }

            const phoneDigits = phoneNumber.replace(/\D/g, '');
            if (phoneDigits.length !== 11) {
                alert('Пожалуйста, введите корректный номер телефона');
                document.getElementById('phoneInput').focus();
                return;
            }

            const fromCoordsStr = fromCoords ? `${fromCoords[0]}, ${fromCoords[1]}` : from;
            const toCoordsStr = toCoords ? `${toCoords[0]}, ${toCoords[1]}` : to;

            const averageCoords = '';

            const tariff = tariffs.find(t => t.id === selectedTariff);
            const transportType = tariff ? tariff.name : 'Седан';
            const transportClass = selectedTransportClass || 'comfort';

            const options = [];
            if (document.getElementById('animalOption') && document.getElementById('animalOption').checked)
                options.push('Перевозка животного');
            if (document.getElementById('skiOption') && document.getElementById('skiOption').checked)
                options.push('Лыжи/сноуборд');
            if (document.getElementById('wheelchairOption') && document.getElementById('wheelchairOption').checked)
                options.push('Инвалидное кресло');
            if (document.getElementById('childSeatOption') && document.getElementById('childSeatOption').checked)
                options.push('Детское кресло');
            if (document.getElementById('findCarOption') && document.getElementById('findCarOption').checked)
                options.push('Помогите найти машину');
            if (document.getElementById('textOnlyOption') && document.getElementById('textOnlyOption').checked)
                options.push('Общаюсь только текстом');
            if (document.getElementById('dontSpeakOption') && document.getElementById('dontSpeakOption').checked)
                options.push('Не говорю, но слышу');
            if (document.getElementById('allowOrderRidesOption') && document.getElementById('allowOrderRidesOption').checked)
                options.push('Разрешить поездки по заказу');
            if (document.getElementById('bicycleOption') && document.getElementById('bicycleOption').checked)
                options.push('Велосипед');

            const comment = options.length > 0 ? options.join(', ') : '';

            submitToTildaForm({
                from: fromCoordsStr,
                average: averageCoords,
                to: toCoordsStr,
                name: transportType,
                class: transportClass,
                price: price.replace(/\s/g, '') + ' ₸',
                comment: comment,
                number: phoneNumber
            });
        }

        function submitToTildaForm(data) {
            const tildaFormBlock = document.getElementById('rec1770122941');

            if (!tildaFormBlock) {
                console.error('❌ Блок формы Tilda не найден (ID: rec1770122941)');
                console.log('Доступные элементы с rec:', 
                    Array.from(document.querySelectorAll('[id^="rec"]')).map(el => el.id)
                );
                alert('Ошибка: форма отправки не найдена. Проверьте ID блока формы в Tilda.');
                return;
            }
            

            const form = tildaFormBlock.querySelector('form');

            if (!form) {
                console.error('❌ Тег <form> не найден внутри блока');
                alert('Ошибка: элемент формы не найден внутри блока Tilda.');
                return;
            }
            

            function findAndFillField(fieldName, value) {
                const selectors = [
                    `input[name="${fieldName}"]`,
                    `textarea[name="${fieldName}"]`,
                    `select[name="${fieldName}"]`,
                    `input[data-name="${fieldName}"]`,
                    `textarea[data-name="${fieldName}"]`,
                    `input[placeholder*="${fieldName}"]`,
                    `#${fieldName}`,
                    `input.${fieldName}`
                ];
                
                let field = null;
                
                for (const selector of selectors) {
                    field = form.querySelector(selector);
                    
                }
                
                if (field) {
                    field.value = value;
                    
                    const event = new Event('input', { bubbles: true });
                    field.dispatchEvent(event);
                    const changeEvent = new Event('change', { bubbles: true });
                    field.dispatchEvent(changeEvent);
                    
                    console.log(`   Значение установлено: "${value}"`);
                    return true;
                } else {
                    console.warn(`⚠️ Поле "${fieldName}" не найдено. Попробуйте проверить имена полей в Tilda.`);
                    return false;
                }
            }

          
            findAndFillField('from', data.from);
            findAndFillField('average', data.average);
            findAndFillField('to', data.to);
            findAndFillField('name', data.name);
            findAndFillField('class', data.class);
            findAndFillField('price', data.price);
            findAndFillField('comment', data.comment);
            findAndFillField('number', data.number);
            
          
            
            setTimeout(() => {
                const submitButton = form.querySelector('button[type="submit"]') || 
                                   form.querySelector('input[type="submit"]') ||
                                   form.querySelector('.t-submit') ||
                                   form.querySelector('button.t-submit');
                
                if (submitButton) {
                    console.log('✅ Кнопка отправки найдена:', submitButton);
                    console.log('Нажимаем на кнопку...');
                    
                    submitButton.click();
                    
                    console.log('✅ Форма отправлена!');
                    
                    
                } else {
                    console.warn('⚠️ Кнопка отправки не найдена, пробуем form.submit()');
                    
                    try {
                        form.submit();
                        console.log('✅ Форма отправлена через submit()');
                    } catch (error) {
                        console.error('❌ Ошибка при отправке:', error);
                        alert('Не удалось отправить форму. Пожалуйста, проверьте настройки формы в Tilda или обратитесь к администратору.');
                    }
                }
            }, 100);
            
        }
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
                // Нужно два rAF: first — браузер применяет collapsed CSS (normal flow),
                // second — высоты элементов пересчитаны
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    const h = measureCollapsedH();
                    panel.style.transition = animate
                        ? 'height 0.3s cubic-bezier(0.25,0.8,0.25,1)'
                        : 'none';
                    panel.style.height = h + 'px';
                    syncUI(h, true);
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
                syncUI(h, false);
                if (!animate) requestAnimationFrame(() => { panel.style.transition = ''; });
            }

            function syncUI(panelH, isCollapsed) {
                const phone      = document.querySelector('.phone-panel');
                const marker     = document.getElementById('mapMarker');
                const mapElement = document.getElementById('map');
                const calculator = document.getElementById('calculator');
                
                if (mapControls) {
                    if (isMobile()) {
                        mapControls.style.opacity       = isCollapsed ? '1' : '0';
                        mapControls.style.visibility    = isCollapsed ? 'visible' : 'hidden';
                        mapControls.style.pointerEvents = isCollapsed ? 'auto' : 'none';
                        mapControls.style.bottom        = (panelH + 16) + 'px';
                    } else {
                        // На ПК кнопки карты всегда видимы
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
                if (mapControls) mapControls.style.bottom = (newH + 16) + 'px';
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
    const themeIcon = document.querySelector('.theme-icon');
    if (!themeIcon) return;

    body.classList.toggle('light-theme');

    if (body.classList.contains('light-theme')) {
        themeIcon.classList.remove('fa-moon');
        themeIcon.classList.add('fa-sun');
        localStorage.setItem('theme', 'light');
    } else {
        themeIcon.classList.remove('fa-sun');
        themeIcon.classList.add('fa-moon');
        localStorage.setItem('theme', 'dark');
    }
}

// Загружаем сохраненную тему при старте
document.addEventListener('DOMContentLoaded', function() {
    const savedTheme = localStorage.getItem('theme');
    const themeIcon = document.querySelector('.theme-icon');
    if (!themeIcon) return;

    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        themeIcon.classList.remove('fa-moon');
        themeIcon.classList.add('fa-sun');
    } else {
        themeIcon.classList.remove('fa-sun');
        themeIcon.classList.add('fa-moon');
    }
});