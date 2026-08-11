# NetOps CRM (Wispro-style ISP CRM) — PRD

## Original Problem Statement (resumen)
CRM para negocio ISP tipo Wispro: dashboard, clientes con fecha de pago flexible, pagos (efectivo/transferencia/promesas/facturas manuales), WhatsApp secundario para recordatorios y bandeja, configuración del negocio, usuarios de sistema por rol (dueño, técnico, secretaria, admin), OLT/ONUs (potencias, IP, umbrales), Mikrotik (vía VPN o IP pública), planes, leads (instalación/lentitud/cambio contraseña/domicilio), servicios extras (IPTV, telefonía, megas, energía), mapa NAP con capacidad, desconectados > 30 min con acción WhatsApp, tareas/embudos.

## User personas
- **Dueño (owner)**: acceso total, configura negocio, crea usuarios, ve reportes.
- **Admin**: gestiona clientes/planes/pagos y usuarios operativos.
- **Técnico**: campo y red — leads, ONUs, mapa, WhatsApp.
- **Secretaria**: cobranza, pagos, WhatsApp.

## User Choices (Feb 2026)
- Auth: JWT propio (email + password, bcrypt, cookie httpOnly + Bearer).
- WhatsApp: **simulado** (guardado en DB; enviar luego con proveedor real).
- OLT / Mikrotik: **mockeado** con estructura lista para vincular por VPN / IP pública.
- Pagos: registro manual (efectivo/transferencia/promesas). Stripe **diferido**.
- Alcance MVP acotado.

## Arquitectura
- Backend: FastAPI + Motor (Mongo) + PyJWT + bcrypt. Todas las rutas bajo `/api`.
- Frontend: React 19 + Tailwind + Shadcn + Recharts + react-leaflet + sonner.
- Auth: cookie httpOnly `access_token` + fallback Bearer; RBAC vía `require_roles`.
- Mongo con `id` UUID string (sin ObjectId leak).

## What's been implemented (2026-02)
- **Multi-planta Growatt (2026-02-13)**: soporte para varias plantas (Casa, Oficina, taller…). Nueva colección `energy_plants` con CRUD, seed automático desde `GROWATT_PLANT_ID` env al primer arranque. Endpoint `GET /api/energia/estado?plant=<id>` — cachea por planta (`current-<plant_id>` en Mongo). Frontend con tabs (una por planta, punto de color), botones editar/eliminar por planta, botón "Nueva planta" con Dialog (nombre + plant_id Growatt + device_sn opcional + color + orden). Metadatos de la planta activa incluidos en cada respuesta (`plant_name`, `plant_color`, `plant_ref`) y mostrados abajo de las tarjetas.
- **Energía de respaldo · Growatt (2026-02-12)**: nuevo módulo `/energia` en sidebar Operación conectado a Growatt Open API v1 (Global/EU host). Auto-descubrimiento del dispositivo storage vía `/device/list`, lectura de `/device/storage/storage_last_data`, mapeo `capacity → SOC`, `pacToUser → load_w`, `pCharge - pDischarge → charge_w` (positivo=cargando, negativo=descargando). Caché en Mongo con TTL 240s para respetar el poll cada 5 min del frontend. Endpoint `GET /api/energia/estado` con `?force=true`. Frontend con 3 tarjetas visuales (batería con progress bar coloreada según SOC, consumo, flujo carga/descarga con iconos Sun/Zap), auto-refresh cada 5 min + botón Actualizar manual, timestamp + badge caché, banner de error con guía a `.env` si Growatt falla. Env vars: `GROWATT_API_KEY`, `GROWATT_PLANT_ID`, `GROWATT_BASE_URL`, `GROWATT_DEVICE_SN` (opcional).
- **Pagos a revisar (2026-02-12)**: nuevo módulo `/pagos-revisar` en sidebar Operación que sincroniza los comprobantes que suben los clientes desde su portal. Muestra thumbnail del recibo, cliente, monto, método, nota. 3 acciones (Aceptar / Pendiente / Rechazar) — cada acción sincroniza el estado hacia el portal del cliente en tiempo real (badge "Aceptado" verde / "Rechazado" rojo / "Por revisar" ámbar). Al rechazar hay un checkbox opcional "Revertir extensión de servicio" que retrocede 1 ciclo el `next_due_date` (y suspende si queda vencido). Nueva nota opcional del admin visible para el cliente. Backend endpoints: `GET /api/payments/pending-review` (con receipt_url completo + datos del cliente) y `PATCH /api/payments/{id}/review`. Actualiza `/api/portal/payments` para exponer `review_notes` + `reviewed_by_name` + `reviewed_at`. El portal del cliente ahora muestra un badge tricolor por pago con la nota del admin.
- **Login del portal solo con PIN (2026-02-11)**: eliminado el campo teléfono en la pantalla de acceso del portal cliente. `POST /portal/login` acepta solo `{pin}` — como los PINs son únicos globalmente, el backend hace el match con `verify_password` iterando todos los `portal_pin_hash`. `phone` sigue aceptado para compatibilidad pero es opcional. UI: input único centrado grande (h-14, text-2xl, autofocus, filtro numérico).
- **PIN de portal único garantizado (2026-02-11)**: `generate_portal_pin()` es ahora async y verifica cada candidato contra el `portal_pin_hash` de todos los clientes existentes (bcrypt verify) — cero colisiones posibles. Aplicado tanto en la creación de clientes (`POST /clients`) como en la regeneración (`POST /clients/{id}/regenerate-pin`). El botón de llave en la tabla ahora tiene tooltip "Generar PIN único para el portal del cliente".
- **Cajas NAP con tipo 1x8 / 1x16 (2026-02-11)**: `NapBoxIn` ahora tiene `port_type: Literal["1x8","1x16"]` (default `1x16`). Capacidad derivada automáticamente (1x8 = 8, 1x16 = 16) vía `model_validator` en el create y `_nap_capacity()` helper para lectura. Nuevo endpoint `GET /api/nap-boxes/status` devuelve `{capacity, used, available, status: "empty"|"partial"|"full"}` por cada caja. `_check_nap_capacity()` respeta el port_type — el backend bloquea al 9° cliente en 1x8 y al 17° en 1x16 con 400 "La caja NAP 'X' está llena". Frontend `NapMap.jsx` reemplaza el input de capacidad por un select `1x8 / 1x16`, muestra badge de port_type + estado tricolor (Vacía / X/Y / Llena rojo). `Clients.jsx` deshabilita las cajas NAP llenas en el select del cliente y muestra `nombre · 1xN · used/cap · LLENA`.
- **Módulo Lugares (2026-02-10)**: nuevo catálogo `/lugares` (Red) con CRUD (agregar/editar/eliminar), color por lugar, KPIs de uso, y **rename en cascada**: renombrar un lugar actualiza automáticamente el campo `community` de todos los clientes vinculados. El campo "Lugar" del formulario de clientes (antes text libre "Comunidad") ahora es un select de tamaño compacto que se llena desde este catálogo.
- **Técnicos que instalaron desde Colaboradores (2026-02-10)**: el multi-select ahora pobla las opciones desde el módulo Colaboradores en lugar de Usuarios del sistema — muestra sólo los colaboradores activos y filtra por rol.
- **Colaboradores · acciones en semanal (2026-02-10)**: la pestaña "Días trabajados" ahora expone editar/eliminar por colaborador directamente sin cambiar a Roster.
- **Módulo Colaboradores (2026-02-09)**: renombrado desde "Trabajadores". Nueva tab "Días trabajados" con tabla semanal Domingo→Sábado (corte los sábados), toggle por día trabajado, sueldo diario × días trabajados = total semanal por colaborador, gran total semanal en KPI, navegación entre semanas. Backend agrega `work_days: List[str]` a trabajadores + endpoints `POST /trabajadores/{id}/work-days/toggle` y `GET /trabajadores/week-summary?anchor=YYYY-MM-DD`.
- **MAC picker con lupa (2026-02-09)**: nuevo tipo de campo `mac-picker` en FormDialog. Botón "Buscar" al lado del input abre un Dialog con lista de MACs detectadas por la OLT (11 mostradas), filtro por Sin asignar/Todas/Solo activas, buscador por MAC/serial/cliente/IP, click auto-agrega la MAC al campo con validación de formato.
- **Multi-select inline (2026-02-09)**: reescritura del multi-select — antes usaba Radix Popover dentro de Dialog (nested buttons + z-index conflict = no se desplegaba). Ahora es un panel inline expandable con búsqueda + checkboxes. Se aplica a "Técnicos que instalaron".
- **Fix z-index Select/Popover (2026-02-09)**: `SelectContent` y `PopoverContent` subidos a `z-[1200]` para desplegarse encima del Dialog (z-[1101]).
- **Portal del Cliente (2026-02-08)**: portal público `/portal` protegido por PIN (6 dígitos, hash bcrypt en `clients.portal_pin_hash`, cookie httpOnly `portal_token` con JWT type=`portal`). Mobile-first, muestra estado, próximo pago, consumo en vivo (RX/TX/dBm + gráfica 30 min con Recharts), historial de pagos y subida de comprobante que **reactiva el servicio al instante** (+1 ciclo de pago, marca `pending_review` para revisión posterior). Nuevos clientes reciben PIN al crearlos; toast con botón "Copiar PIN". Admins pueden regenerar el PIN desde la fila de Clientes con `KeyRound` icon.
- **Recordatorios automáticos (2026-02-08)**: nuevo módulo `/recordatorios` en sidebar Operación con editor de plantilla + vista previa live, variables `{{name}} {{amount}} {{due_date}} {{plan}} {{portal_url}} {{phone}}`, selector de días antes (0–30, editable, default 3), tabla filtrable de clientes con vencimiento próximo con checkbox por fila, "Enviar a seleccionados" y "Enviar a todos". Config en `db.reminder_config`. Cron `send-reminders` en `.emergent/crons.yml` (15 UTC diario) respeta horario activo 9–19 hs y envía por WhatsApp (queued para el proveedor configurado, si hay uno).
- **ThemePicker rediseñado (2026-02-07)**: sección "Modo" con dos tarjetas grandes Día (Papel) + Noche (Medianoche, por defecto), personalización de color primario, tintes de sidebar, wallpapers, y botón "Reestablecer por defecto" que limpia color/wallpaper/tint y regresa al tema Medianoche (oscuro).
- **WhatsApp v2 — QR + Embudos (2026-02-05)**: nuevo módulo con Kanban de embudos personalizables (`Nuevos / En proceso / Esperando pago / Cerrado` como seed), etiquetado automático del respondedor en cada mensaje saliente (`responded_by_name`), diálogo QR con status en vivo (conectado/desconectado/simulado), diálogo de configuración multi-proveedor (Baileys / Evolution / WAHA / WasenderAPI / custom) con base_url + api_key + instance + webhook_token, endpoint `/api/whatsapp/webhook` con validación por `X-Webhook-Token` + idempotencia via `provider_message_id`, envío real vía proveedor cuando configurado (Evolution/WAHA/Baileys), CRUD completo de embudos con default protegido, y asignación de conversaciones a usuarios operadores. UI en Kanban con drawer de chat, mover con select, y drag por dropdown per-card. 15 pytest cubriendo funnels/webhooks/idempotencia/tagging.
- **Trabajadores (2026-02-05)**: nuevo módulo bajo Sistema. Nómina operativa con rol (técnico / instalador / secretaria / supervisor / otro), zona/comunidad, teléfono, email, sueldo diario, fecha de ingreso, vínculo opcional a usuario del sistema. KPIs (total/activos/campo), tabla con edit + delete, badges de rol coloreados, pytest CRUD.
- **Sidebar reagrupado** en 3 secciones: Operación (Panel de control, Clientes, Pagos, Promesas, Arqueo, WhatsApp), Red (Planes, Extras, Mapa, OLT/ONUs, ONUs Online/Offline, Mikrotik), Sistema (Tareas, Trabajadores, Usuarios, Configuración).
- **Auto-billing cron**: `POST /api/cron/suspend-overdue` autenticado con `WEBHOOK_CRON_SECRET`, corre cada día a las 09:00 UTC via `.emergent/crons.yml`, suspende clientes con `next_due_date` vencido, historial en `GET /api/cron/runs`.
- **Módulo ONUs Online/Offline** (/onus): diagrama de tarjetas con potencia dBm, RX/TX Mb, tiempo de conexión, feed de alarmas > 60min, ordenamiento por estado/nombre/IP/tiempo, auto-refresh 20s.
- **Módulo Arqueo de caja**: filtros por rango/mes/cobrador/método, selección múltiple con total en vivo, historial con detalle expandible.
- **Módulo Mikrotik rediseñado**: dropdown "+ Nuevo Mikrotik" con opción "VPN/Túnel" → wizard con selector WireGuard/L2TP, credenciales VPN + API autogeneradas, checkboxes PPP/Queues, script RouterOS en vivo (copiar/descargar .rsc).
- **Diagnóstico Mikrotik** ("Probar" por router): checklist 8 items con TCP real + tráfico simulado (AreaChart) y auto-refresh 4s.
- **Datos del servidor CRM** (ServerInfoPanel): IP pública, puertos WG/L2TP/OpenVPN, Public Key, red del túnel con botones copiar + editar en `/api/vpn/server-info`.
- Login + AuthContext + rutas protegidas. Branding **EnlaceHR ISP** (gradiente ámbar→rosa) en login y sidebar. Footer "Creado por EnlaceHR".
- Buscador universal en las 11 listas (Planes, Extras, Usuarios, Pagos, Tareas, OLT, Mikrotik, NAPs, WhatsApp, Clientes, Leads).
- CRUD completo: Users con edit + reset password, NAP boxes con edit/delete, Payments con PATCH whitelisted, Tasks con edit + detalle, Promises con edit.
- Panel de control con KPIs financieros, 12 meses de ingresos, últimos pagos y dispositivos online.
- Panel OLT/ONUs con datos derivados (potencia dBm, RX/TX, IP) + umbrales configurables.
- Mapa NAP interactivo (leaflet dark tiles) con markers de cajas y clientes coloreados por estado.
- WhatsApp: bandeja bidireccional con Kanban de embudos personalizables, QR/status/webhook por proveedor externo (Baileys/Evolution/WAHA), tag del respondedor y buscador de conversaciones.
- Tareas: Kanban 4 stages con drag por botones + buscador + detalle modal.
- Configuración del negocio: nombre, RFC, moneda, logo, umbrales ONU, minutos para alerta.
- Seed automático del admin owner benjahr1993@gmail.com.
- ThemePicker con wallpapers, gradientes y combos.
- Detalle cliente en drawer con tráfico en vivo (recharts) y datos ONU.
- VPN Panel con generador de perfiles WireGuard/OpenVPN descargables + test real TCP + reconfiguración.

## Backlog (P1/P2)
- Integración real Mikrotik/OLT (SNMP/API) — P1
- Integración real WhatsApp/Telegram (Meta Cloud / Bot API) — P2
- Export PDF de arqueo con firma — P2
- Bloqueo de pagos ya incluidos en un arqueo — P2
- Historic uptime graph 24h por ONU — P2
- Sidebar labels en tooltip cuando está colapsado — P3

## Backlog (P0)
- Integración Stripe (checkout + webhook para pagos por transferencia/tarjeta que activen cliente automáticamente).
- Vínculo real con OLT (SNMP/Telnet/API) y Mikrotik (RouterOS API) por VPN/IP pública.
- Heartbeat automático + marcar `last_seen` y disparar alerta cuando > umbral.
- Facturación PDF descargable (facturas manuales).

## Backlog (P1)
- Reportes: ingresos por mes, cartera vencida, ranking técnicos.
- Notificaciones automáticas de recordatorio 3 días antes del vencimiento.
- Auditoría / bitácora por usuario.
- Búsqueda global y filtros avanzados en clientes.
- Exportar CSV.

## Backlog (P2)
- App móvil para técnicos.
- Firma de contrato digital.
- Portal cliente self-service.
