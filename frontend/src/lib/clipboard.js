/**
 * Copiar al portapapeles funcionando también fuera de HTTPS.
 *
 * `navigator.clipboard` solo existe en contextos seguros (HTTPS o localhost).
 * Servido por HTTP contra una IP — como el CRM hoy — es `undefined` y todos
 * los botones de copiar fallan. Por eso el respaldo con un textarea temporal
 * y `document.execCommand`, que está obsoleto pero es lo único disponible ahí.
 */
export async function copyToClipboard(text) {
  const value = String(text ?? "");
  if (!value) return false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Puede fallar por permisos aunque el contexto sea seguro; seguimos abajo.
    }
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    // Fuera de la vista, pero enfocable: si no está en el DOM no se puede copiar.
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
