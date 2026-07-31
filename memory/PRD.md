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
- **Sidebar reagrupado** en 3 secciones: Operación (Panel de control, Clientes, Pagos, Promesas, Arqueo, WhatsApp), Red (Planes, Extras, Mapa, OLT/ONUs, ONUs Online/Offline, Mikrotik), Sistema (Tareas, Usuarios, Configuración).
- **Auto-billing cron**: `POST /api/cron/suspend-overdue` autenticado con `WEBHOOK_CRON_SECRET`, corre cada día a las 09:00 UTC via `.emergent/crons.yml`, suspende clientes con `next_due_date` vencido, historial en `GET /api/cron/runs`.
- **Módulo ONUs Online/Offline** (/onus): diagrama de tarjetas con potencia dBm, RX/TX Mb, tiempo de conexión, feed de alarmas > 60min, ordenamiento por estado/nombre/IP/tiempo, auto-refresh 20s.
- **Módulo Arqueo de caja**: filtros por rango/mes/cobrador/método, selección múltiple con total en vivo, historial con detalle expandible.
- **Módulo Mikrotik rediseñado**: dropdown "+ Nuevo Mikrotik" con opción "VPN/Túnel" → wizard con selector WireGuard/L2TP, credenciales VPN + API autogeneradas, checkboxes PPP/Queues, script RouterOS en vivo (copiar/descargar .rsc).
- **Diagnóstico Mikrotik** ("Probar" por router): checklist 8 items con TCP real + tráfico simulado (AreaChart) y auto-refresh 4s.
- **Datos del servidor CRM** (ServerInfoPanel): IP pública, puertos WG/L2TP/OpenVPN, Public Key, red del túnel con botones copiar + editar en `/api/vpn/server-info`.
- Login + AuthContext + rutas protegidas. Branding **CRM Jupiter** (gradiente ámbar→rosa) en login y sidebar. Footer "Creado por EnlaceHR".
- Buscador universal en las 11 listas (Planes, Extras, Usuarios, Pagos, Tareas, OLT, Mikrotik, NAPs, WhatsApp, Clientes, Leads).
- CRUD completo: Users con edit + reset password, NAP boxes con edit/delete, Payments con PATCH whitelisted, Tasks con edit + detalle, Promises con edit.
- Panel de control con KPIs financieros, 12 meses de ingresos, últimos pagos y dispositivos online.
- Panel OLT/ONUs con datos derivados (potencia dBm, RX/TX, IP) + umbrales configurables.
- Mapa NAP interactivo (leaflet dark tiles) con markers de cajas y clientes coloreados por estado.
- WhatsApp: bandeja bidireccional simulada + endpoint `/simulate-incoming` + buscador de conversaciones.
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
- Integración real WhatsApp (Twilio Business API o similar).
- Vínculo real con OLT (SNMP/Telnet/API) y Mikrotik (RouterOS API) por VPN/IP pública.
- Heartbeat automático + marcar `last_seen` y disparar alerta cuando > umbral.
- Job programado para suspender clientes vencidos automáticamente.
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
