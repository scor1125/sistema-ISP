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
- Login + AuthContext + rutas protegidas. Branding **CRM Jupiter** (gradiente ámbar→rosa) en login y sidebar. Footer "Creado por EnlaceHR".
- Layout con sidebar (15 módulos) y header sticky glass.
- Dashboard con 8 KPIs y 2 charts (línea de crecimiento, distribución de estados).
- **Panel de control** con KPIs financieros, 12 meses de ingresos, últimos pagos y dispositivos online.
- **Arqueo de caja**: filtros por rango/mes/cobrador/método, selección múltiple de pagos, total en vivo, confirmación con notas y pestaña Historial (fecha, hora, responsable, detalle).
- **Script vinculación Mikrotik**: botón por router genera .rsc listo para pegar (WireGuard/L2TP/OpenVPN) con pasos numerados, copiar y descargar.
- **Buscador en todas las listas** (Planes, Extras, Usuarios, Pagos, Tareas, Desconectados, OLT, Mikrotik, NAPs, WhatsApp, Clientes).
- **CRUD completo**: Users con edit + reset password, NAP boxes con edit/delete en tarjeta, Clients, Plans, Payments, Leads, Extras, Tasks, Devices, VPN.
- Ciclo de pago: `payment_day` configurable por cliente; al registrar pago se avanza `next_due_date` y se reactiva al cliente.
- Promesas de pago: no avanzan la fecha.
- Validación de capacidad NAP (bloquea añadir si está llena).
- Panel OLT/ONUs con datos derivados (potencia dBm, RX/TX, IP) por cliente + umbrales configurables.
- Panel Mikrotik con sesiones vinculadas y días restantes de servicio.
- Mapa NAP interactivo (leaflet dark tiles) con markers de cajas y clientes coloreados por estado.
- WhatsApp: bandeja bidireccional simulada + endpoint `/simulate-incoming` + buscador de conversaciones.
- Desconectados: lista + botón directo a chat WhatsApp del cliente.
- Tareas: Kanban 4 stages con drag por botones + buscador.
- Configuración del negocio: nombre, RFC, moneda, logo, umbrales ONU, minutos para alerta.
- Seed automático del admin owner benjahr1993@gmail.com.
- ThemePicker con wallpapers, gradientes y combos.
- Detalle cliente en drawer con tráfico en vivo (recharts) y datos ONU.
- VPN Panel con generador de perfiles WireGuard/OpenVPN descargables.

## Backlog (P1/P2)
- Integración real Mikrotik/OLT (SNMP/API) — P1
- Facturación automática y suspensiones por cron — P1
- Integración real WhatsApp/Telegram (Meta Cloud / Bot API) — P2
- Export PDF de arqueo con firma — P2
- Bloqueo de pagos ya incluidos en un arqueo — P2

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
