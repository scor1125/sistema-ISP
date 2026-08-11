import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calculator as CalcIcon, Delete, X } from "lucide-react";

/**
 * Calculadora rápida en la barra superior.
 * Soporta suma, resta, multiplicación, división, porcentaje,
 * decimales, signo, borrar (⌫), limpiar (C), historial de 6 ítems
 * y teclado físico (0-9, + - * / = Enter Backspace Escape).
 */

const OP_LABEL = { "+": "+", "-": "−", "*": "×", "/": "÷" };

const compute = (a, b, op) => {
  const x = Number(a); const y = Number(b);
  switch (op) {
    case "+": return x + y;
    case "-": return x - y;
    case "*": return x * y;
    case "/": return y === 0 ? NaN : x / y;
    default: return y;
  }
};

const format = (v) => {
  if (v === "" || v === null || v === undefined) return "0";
  if (Number.isNaN(v)) return "Error";
  const n = Number(v);
  if (!Number.isFinite(n)) return "Error";
  // Preserve trailing "." while typing
  if (typeof v === "string" && v.endsWith(".")) return v;
  if (typeof v === "string" && v.endsWith(".0")) return v;
  // Up to 10 significant digits, strip trailing zeros
  const s = Math.abs(n) >= 1e10 || (Math.abs(n) > 0 && Math.abs(n) < 1e-6)
    ? n.toExponential(6)
    : n.toLocaleString("es-MX", { maximumFractionDigits: 8 });
  return s;
};

export default function CalculatorWidget() {
  const [open, setOpen] = useState(false);
  const [display, setDisplay] = useState("0");   // raw string user is typing
  const [prev, setPrev] = useState(null);         // previous operand (number)
  const [op, setOp] = useState(null);             // pending operator
  const [justEval, setJustEval] = useState(false); // last action was "="
  const [history, setHistory] = useState([]);     // [{expr, result}]
  const rootRef = useRef(null);

  const inputDigit = (d) => {
    setDisplay((cur) => {
      if (justEval) { setJustEval(false); return d; }
      if (cur === "0") return d;
      if (cur.length >= 15) return cur;
      return cur + d;
    });
  };

  const inputDot = () => {
    setDisplay((cur) => {
      if (justEval) { setJustEval(false); return "0."; }
      if (cur.includes(".")) return cur;
      return cur + ".";
    });
  };

  const backspace = () => {
    if (justEval) return;
    setDisplay((cur) => {
      if (cur.length <= 1 || (cur.length === 2 && cur.startsWith("-"))) return "0";
      return cur.slice(0, -1);
    });
  };

  const clearAll = () => {
    setDisplay("0"); setPrev(null); setOp(null); setJustEval(false);
  };

  const toggleSign = () => {
    setDisplay((cur) => {
      if (cur === "0" || cur === "Error") return cur;
      return cur.startsWith("-") ? cur.slice(1) : "-" + cur;
    });
    setJustEval(false);
  };

  const percent = () => {
    setDisplay((cur) => {
      const n = Number(cur);
      if (Number.isNaN(n)) return cur;
      // If we have a pending op, "percent" means "N% of prev"
      if (prev !== null && op) return String((prev * n) / 100);
      return String(n / 100);
    });
    setJustEval(false);
  };

  const setOperator = (nextOp) => {
    const cur = Number(display);
    if (prev === null) {
      setPrev(cur);
    } else if (!justEval && op) {
      const result = compute(prev, cur, op);
      setPrev(result);
      setDisplay(String(result));
    }
    setOp(nextOp);
    setJustEval(true); // next digit starts new operand
  };

  const equals = () => {
    if (op === null || prev === null) return;
    const cur = Number(display);
    const result = compute(prev, cur, op);
    const expr = `${format(prev)} ${OP_LABEL[op]} ${format(cur)}`;
    setHistory((h) => [{ expr, result: format(result) }, ...h].slice(0, 6));
    setDisplay(String(result));
    setPrev(null);
    setOp(null);
    setJustEval(true);
  };

  // Keyboard input while popover is open
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      const t = e.target;
      // Don't hijack typing in inputs elsewhere
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (/^[0-9]$/.test(e.key)) { inputDigit(e.key); e.preventDefault(); }
      else if (e.key === "." || e.key === ",") { inputDot(); e.preventDefault(); }
      else if (["+", "-", "*", "/"].includes(e.key)) { setOperator(e.key); e.preventDefault(); }
      else if (e.key === "Enter" || e.key === "=") { equals(); e.preventDefault(); }
      else if (e.key === "Backspace") { backspace(); e.preventDefault(); }
      else if (e.key === "Escape") { clearAll(); e.preventDefault(); }
      else if (e.key === "%") { percent(); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, display, prev, op, justEval]);

  const shown = useMemo(() => format(display), [display]);
  const line1 = useMemo(() => {
    if (prev === null || !op) return "";
    return `${format(prev)} ${OP_LABEL[op]}`;
  }, [prev, op]);

  const btn = (label, onClick, opts = {}) => (
    <Button
      type="button"
      variant={opts.variant || "outline"}
      onClick={onClick}
      data-testid={opts.testId}
      className={`h-11 text-sm font-medium ${opts.className || ""}`}
    >
      {label}
    </Button>
  );

  const copyResult = async () => {
    try { await navigator.clipboard.writeText(shown.replace(/[^\d.\-eE+]/g, "")); } catch { /* ignore */ }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2 h-8 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border border-transparent hover:border-border"
          title="Calculadora rápida (0-9, + − × ÷ = Enter)"
          data-testid="calculator-trigger"
        >
          <CalcIcon className="w-4 h-4" />
          <span className="hidden md:inline">Calculadora</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[280px] p-3 z-[1200]"
        data-testid="calculator-popover"
        ref={rootRef}
      >
        <div className="rounded-md border border-border bg-muted/30 p-2 mb-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono flex items-center justify-between">
            <span>Calculadora</span>
            {op && <span className="text-primary">{OP_LABEL[op]}</span>}
          </div>
          <div className="h-4 text-[11px] text-muted-foreground text-right font-mono truncate" data-testid="calc-line1">
            {line1}
          </div>
          <div
            className="text-right font-mono text-2xl leading-tight truncate select-all cursor-copy"
            onClick={copyResult}
            title="Click para copiar"
            data-testid="calc-display"
          >
            {shown}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {btn("C", clearAll, { testId: "calc-clear", className: "text-destructive" })}
          {btn("±", toggleSign, { testId: "calc-sign" })}
          {btn("%", percent, { testId: "calc-percent" })}
          {btn(<X className="w-4 h-4 mx-auto" />, () => setOperator("*"), { testId: "calc-mul", variant: "secondary" })}

          {btn("7", () => inputDigit("7"), { testId: "calc-7" })}
          {btn("8", () => inputDigit("8"), { testId: "calc-8" })}
          {btn("9", () => inputDigit("9"), { testId: "calc-9" })}
          {btn("÷", () => setOperator("/"), { testId: "calc-div", variant: "secondary" })}

          {btn("4", () => inputDigit("4"), { testId: "calc-4" })}
          {btn("5", () => inputDigit("5"), { testId: "calc-5" })}
          {btn("6", () => inputDigit("6"), { testId: "calc-6" })}
          {btn("−", () => setOperator("-"), { testId: "calc-sub", variant: "secondary" })}

          {btn("1", () => inputDigit("1"), { testId: "calc-1" })}
          {btn("2", () => inputDigit("2"), { testId: "calc-2" })}
          {btn("3", () => inputDigit("3"), { testId: "calc-3" })}
          {btn("+", () => setOperator("+"), { testId: "calc-add", variant: "secondary" })}

          {btn(<Delete className="w-4 h-4 mx-auto" />, backspace, { testId: "calc-back" })}
          {btn("0", () => inputDigit("0"), { testId: "calc-0" })}
          {btn(".", inputDot, { testId: "calc-dot" })}
          {btn("=", equals, { testId: "calc-eq", variant: "default", className: "bg-primary text-primary-foreground hover:bg-primary/90" })}
        </div>

        {history.length > 0 && (
          <div className="mt-3 pt-2 border-t border-border">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">Historial</div>
            <ul className="space-y-0.5 max-h-32 overflow-auto" data-testid="calc-history">
              {history.map((h, i) => (
                <li
                  key={i}
                  className="text-[11px] font-mono flex justify-between hover:bg-accent px-1 py-0.5 rounded cursor-pointer"
                  onClick={() => { setDisplay(String(Number(h.result.replace(/[^\d.\-eE+]/g, "")))); setJustEval(true); }}
                  title="Click para usar este resultado"
                >
                  <span className="text-muted-foreground truncate">{h.expr}</span>
                  <span className="text-primary">= {h.result}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
