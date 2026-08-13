"""Smart Life · asistente conversacional con function calling.

Registra 6 herramientas que Claude puede invocar para gestionar los A/Cs
vinculados a Tuya IoT Cloud:

  1. obtener_dispositivos_proyecto()
  2. controlar_energia(device_id, estado)
  3. ver_detalle_dispositivo(device_id)
  4. editar_dispositivo(device_id, nuevo_nombre)
  5. eliminar_dispositivo(device_id)
  6. crear_automatizacion_horaria(device_id, accion, hora, dias)

Modelo: `claude-sonnet-4-6` (Anthropic) — vía Emergent Universal Key.
Session persistente en memoria por `session_id` (se pierde al restart, es
aceptable para chats efímeros). Historial además persiste en Mongo
(`tuya_chat_messages`) para poder mostrarlo en la UI.
"""
from __future__ import annotations

import json
import logging
import os
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from emergentintegrations.llm.chat import LlmChat, UserMessage

logger = logging.getLogger("tuya_chat")

MODEL_PROVIDER = "anthropic"
MODEL_NAME = "claude-sonnet-4-6"

SYSTEM_PROMPT = """Eres el asistente de administración Smart Life de EnlaceHR ISP.
Tu tarea es gestionar los aires acondicionados y dispositivos IoT vinculados al proyecto Tuya Developer Platform del usuario, sincronizados en tiempo real con la app Smart Life.

Tienes 6 herramientas disponibles:
- obtener_dispositivos_proyecto() — lista todos los dispositivos con su nombre y device_id
- controlar_energia(device_id, estado) — enciende ("on") o apaga ("off")
- ver_detalle_dispositivo(device_id) — muestra el estado actual (temperatura, modo, on/off)
- editar_dispositivo(device_id, nuevo_nombre) — renombra el dispositivo en Tuya
- eliminar_dispositivo(device_id) — borra/desvincula el dispositivo del proyecto Cloud
- crear_automatizacion_horaria(device_id, accion, hora, dias) — programa encendido/apagado automático. accion="on"|"off", hora="HH:MM" formato 24h, dias=lista tipo ["lunes","miércoles","viernes"] o ["todos"] o ["lunes a viernes"]

REGLAS ESTRICTAS:
1. **Sincronización**: cuando el usuario mencione un dispositivo por nombre (ej: "el aire de la oficina"), llama primero a `obtener_dispositivos_proyecto` para encontrar el device_id que coincida. Si hay varios candidatos, muéstraselos y pide que elija.
2. **Automatizaciones**: extrae hora en formato 24h ("las 8am" → "08:00", "8pm" → "20:00", "medianoche" → "00:00"). Convierte días a español ("de lunes a viernes" → ["lunes","martes","miércoles","jueves","viernes"]). Si el usuario dice "todos los días" pasa ["todos"].
3. **Seguridad**: si el usuario pide **eliminar** un dispositivo, JAMÁS llames a `eliminar_dispositivo` de inmediato. Confirma primero mostrando el nombre exacto del dispositivo y pregunta explícitamente "¿Confirmas que quieres eliminar '<nombre>'? Escribe 'sí, eliminar' para continuar". Solo llama a la herramienta cuando el usuario responda afirmativamente.
4. **Claridad**: antes de ejecutar cualquier acción, confirma en una frase lo que vas a hacer. Después de ejecutar, resume el resultado con datos concretos (nombre del dispositivo, valor cambiado).
5. **Idioma**: siempre respondes en español, breve y directo.
6. **Errores**: si una herramienta devuelve error, explica en lenguaje simple qué falló y sugiere cómo solucionarlo (ej: si Tuya devuelve 401/1004, sugiere revisar credenciales en Config).

Empieza cada nueva conversación siendo útil y esperando la petición del usuario.
"""


TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "obtener_dispositivos_proyecto",
            "description": "Lista todos los dispositivos IoT del proyecto Tuya Cloud del usuario, con su nombre asignado en Smart Life, device_id, estado en línea y categoría. Úsala para identificar dispositivos por su nombre.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "controlar_energia",
            "description": "Enciende o apaga un aire acondicionado / dispositivo Tuya.",
            "parameters": {
                "type": "object",
                "properties": {
                    "device_id": {"type": "string", "description": "ID del dispositivo Tuya (obtenido de obtener_dispositivos_proyecto)"},
                    "estado": {"type": "string", "enum": ["on", "off"], "description": "'on' para encender, 'off' para apagar"},
                },
                "required": ["device_id", "estado"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ver_detalle_dispositivo",
            "description": "Muestra el estado actual del dispositivo (encendido/apagado, temperatura fijada, modo, velocidad de ventilador).",
            "parameters": {
                "type": "object",
                "properties": {
                    "device_id": {"type": "string"},
                },
                "required": ["device_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "editar_dispositivo",
            "description": "Cambia el nombre asignado al dispositivo en el proyecto Tuya. El nuevo nombre se sincroniza a la app Smart Life del usuario.",
            "parameters": {
                "type": "object",
                "properties": {
                    "device_id": {"type": "string"},
                    "nuevo_nombre": {"type": "string"},
                },
                "required": ["device_id", "nuevo_nombre"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "eliminar_dispositivo",
            "description": "Elimina/desvincula un dispositivo del proyecto Tuya Cloud. ATENCIÓN: acción destructiva; pide confirmación explícita antes de invocar.",
            "parameters": {
                "type": "object",
                "properties": {
                    "device_id": {"type": "string"},
                },
                "required": ["device_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "crear_automatizacion_horaria",
            "description": "Programa encendido o apagado automático de un dispositivo (o 'todos' los dispositivos) a una hora específica en los días indicados.",
            "parameters": {
                "type": "object",
                "properties": {
                    "device_id": {"type": "string", "description": "ID del dispositivo, o 'todos' para aplicar a todos los dispositivos del proyecto"},
                    "accion": {"type": "string", "enum": ["on", "off"]},
                    "hora": {"type": "string", "description": "Hora en formato 24h HH:MM (ej: '08:00', '23:00')"},
                    "dias": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Lista de días en español: ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'] o ['todos']",
                    },
                },
                "required": ["device_id", "accion", "hora", "dias"],
            },
        },
    },
]


# --- Utilities ---------------------------------------------------------------
def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").lower().strip()


def _parse_days(dias: List[str]) -> List[int]:
    """Convierte lista de días en español a lista de enteros 0=Dom..6=Sáb."""
    map_es = {
        "domingo": 0, "lunes": 1, "martes": 2, "miercoles": 3,
        "jueves": 4, "viernes": 5, "sabado": 6,
    }
    if any(_strip_accents(d) in ("todos", "todos los dias", "diario", "diariamente") for d in dias):
        return [0, 1, 2, 3, 4, 5, 6]
    out = set()
    for d in dias or []:
        k = _strip_accents(d)
        if k in map_es:
            out.add(map_es[k])
    return sorted(out) or [0, 1, 2, 3, 4, 5, 6]


def _parse_hora(hora: str) -> str:
    """Sanea la hora a formato HH:MM."""
    if not hora:
        raise ValueError("hora vacía")
    m = re.match(r"^\s*(\d{1,2}):(\d{2})\s*$", hora)
    if not m:
        raise ValueError(f"formato inválido: {hora}")
    h, mm = int(m.group(1)), int(m.group(2))
    if not (0 <= h <= 23 and 0 <= mm <= 59):
        raise ValueError(f"valores fuera de rango: {hora}")
    return f"{h:02d}:{mm:02d}"


# --- Tool dispatch -----------------------------------------------------------
async def dispatch_tool(name: str, args: dict, db, new_id_fn) -> dict:
    """Ejecuta una tool call llamando a Tuya y/o Mongo. Devuelve un dict JSON-serializable."""
    from tuya import TuyaClient, TuyaError

    # Load stored config
    cfg_doc = await db.tuya_config.find_one({"key": "singleton"}, {"_id": 0}) or {}
    cfg = cfg_doc.get("value", {}) if isinstance(cfg_doc, dict) else {}
    if not cfg.get("access_id") or not cfg.get("access_secret"):
        return {"error": "Tuya no está configurado. Ve a la pestaña 'Config' en el módulo Smart Life y guarda Access ID + Access Secret."}

    try:
        cli = TuyaClient(
            access_id=cfg["access_id"],
            access_secret=cfg["access_secret"],
            region=cfg.get("region", "us"),
            project_code=cfg.get("project_code", ""),
        )
    except Exception as e:
        return {"error": f"No se pudo crear el cliente Tuya: {e}"}

    try:
        if name == "obtener_dispositivos_proyecto":
            devs = await cli.list_devices()
            return {
                "devices": [
                    {
                        "device_id": d.get("id"),
                        "nombre": d.get("name"),
                        "producto": d.get("product_name") or d.get("category") or "",
                        "online": bool(d.get("online")),
                    }
                    for d in devs if d.get("id")
                ]
            }

        if name == "controlar_energia":
            device_id = args["device_id"]
            estado = str(args.get("estado", "")).lower()
            if estado not in ("on", "off"):
                return {"error": "estado debe ser 'on' o 'off'"}
            await cli.send_commands(device_id, [{"code": "switch", "value": estado == "on"}])
            return {"ok": True, "device_id": device_id, "estado": estado}

        if name == "ver_detalle_dispositivo":
            device_id = args["device_id"]
            status_list = await cli.get_status(device_id)
            status_map = {s.get("code"): s.get("value") for s in status_list if isinstance(s, dict)}
            return {
                "device_id": device_id,
                "encendido": bool(status_map.get("switch")),
                "temperatura_fijada": status_map.get("temp_set"),
                "temperatura_ambiente": status_map.get("temp_current"),
                "modo": status_map.get("mode"),
                "ventilador": status_map.get("fan_speed_enum") or status_map.get("fan_speed"),
                "raw": status_map,
            }

        if name == "editar_dispositivo":
            device_id = args["device_id"]
            nuevo_nombre = str(args.get("nuevo_nombre", "")).strip()
            if not nuevo_nombre:
                return {"error": "nuevo_nombre no puede estar vacío"}
            await cli.rename_device(device_id, nuevo_nombre)
            return {"ok": True, "device_id": device_id, "nuevo_nombre": nuevo_nombre}

        if name == "eliminar_dispositivo":
            device_id = args["device_id"]
            await cli.delete_device(device_id)
            return {"ok": True, "device_id": device_id, "eliminado": True}

        if name == "crear_automatizacion_horaria":
            device_id = args["device_id"]
            accion = str(args.get("accion", "")).lower()
            if accion not in ("on", "off"):
                return {"error": "accion debe ser 'on' o 'off'"}
            hora = _parse_hora(args["hora"])
            dias = _parse_days(args.get("dias") or [])

            # Build scene target
            if device_id == "todos":
                target = {"kind": "all", "group_id": None, "device_ids": None}
                target_label = "todos los dispositivos"
            else:
                target = {"kind": "devices", "group_id": None, "device_ids": [device_id]}
                # Get device name for the label
                devs = await cli.list_devices()
                name_by_id = {d.get("id"): d.get("name") for d in devs}
                target_label = name_by_id.get(device_id, device_id)

            scene_name = f"{'Encender' if accion == 'on' else 'Apagar'} {target_label} a las {hora}"
            commands = [{"code": "switch", "value": accion == "on"}]
            doc = {
                "id": new_id_fn(),
                "name": scene_name,
                "time": hora,
                "days": dias,
                "enabled": True,
                "target": target,
                "commands": commands,
                "icon": "sun" if accion == "on" else "moon",
                "color": "#22c55e" if accion == "on" else "#6366f1",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "last_run_date": "",
            }
            await db.tuya_scenes.insert_one(doc)
            doc.pop("_id", None)
            return {
                "ok": True,
                "scene_id": doc["id"],
                "nombre_escena": scene_name,
                "hora": hora,
                "dias": dias,
                "target": target,
            }

        return {"error": f"Herramienta desconocida: {name}"}

    except TuyaError as e:
        return {"error": f"Tuya {e.code}: {e.msg}"}
    except Exception as e:
        logger.exception("dispatch_tool %s failed", name)
        return {"error": f"{type(e).__name__}: {e}"}


# --- Chat session cache ------------------------------------------------------
_chats: Dict[str, LlmChat] = {}


def _get_or_create_chat(session_id: str) -> LlmChat:
    if session_id in _chats:
        return _chats[session_id]
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY no configurada en backend/.env")
    chat = (
        LlmChat(api_key=api_key, session_id=session_id, system_message=SYSTEM_PROMPT)
        .with_model(MODEL_PROVIDER, MODEL_NAME)
        .with_tools(TOOLS, tool_choice="auto")
    )
    _chats[session_id] = chat
    return chat


def reset_chat(session_id: str) -> None:
    _chats.pop(session_id, None)


async def run_turn(session_id: str, user_text: str, db, new_id_fn) -> dict:
    """Send a user message, loop through tool calls, return final assistant text
    plus a per-turn trace of every tool invocation."""
    chat = _get_or_create_chat(session_id)
    trace: List[Dict[str, Any]] = []
    response = await chat.send_message_with_tools(UserMessage(text=user_text))

    # Guard against pathological infinite loops (models chain calls)
    for _ in range(10):
        if not getattr(response, "tool_calls", None):
            break
        for tc in response.tool_calls:
            try:
                raw_args = tc.arguments if isinstance(tc.arguments, dict) else json.loads(tc.arguments or "{}")
            except Exception:
                raw_args = {}
            result = await dispatch_tool(tc.name, raw_args, db, new_id_fn)
            trace.append({
                "tool": tc.name,
                "arguments": raw_args,
                "result": result,
            })
            chat.add_tool_result(tc.id, json.dumps(result, ensure_ascii=False, default=str))
        response = await chat.send_message_with_tools()

    final_text = getattr(response, "content", None) or ""
    return {"text": final_text, "tool_calls": trace}
