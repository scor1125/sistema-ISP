/**
 * Utilidades mínimas de CIDR IPv4. Solo lo necesario para sugerir IPs libres
 * dentro de la red configurada en la interfaz de un Mikrotik — no es un
 * reemplazo de una librería completa de manejo de IP.
 */

function ipToInt(ip) {
  const parts = String(ip).trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

/**
 * IPs "host" de una red en notación `ip/prefijo` (ej. "192.168.50.1/24"),
 * excluyendo dirección de red y de broadcast. `cap` limita cuántas se
 * generan — una /16 tiene 65 mil hosts, y no hace falta enumerarlos todos
 * para una lista de sugerencias.
 */
export function cidrHosts(cidrString, { cap = 512 } = {}) {
  if (!cidrString || typeof cidrString !== "string") return [];
  const [ipPart, prefixPart] = cidrString.split("/");
  const prefix = Number(prefixPart);
  const base = ipToInt(ipPart);
  if (base == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return [];

  if (prefix >= 31) return []; // /31 y /32: sin rango de hosts utilizable
  const hostBits = 32 - prefix;
  const size = 2 ** hostBits;
  const network = (base & (0xffffffff << hostBits)) >>> 0;

  const hosts = [];
  // i=0 es la red, i=size-1 es el broadcast — se excluyen ambos.
  for (let i = 1; i < size - 1 && hosts.length < cap; i++) {
    hosts.push(intToIp((network + i) >>> 0));
  }
  return hosts;
}

/** IPs de la red menos las que ya están ocupadas (por cualquier motivo). */
export function cidrAvailableHosts(cidrString, excluded = [], opts) {
  const taken = new Set(excluded);
  return cidrHosts(cidrString, opts).filter((ip) => !taken.has(ip));
}
