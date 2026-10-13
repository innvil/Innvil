const DECIMAL_RE = /^-?\d+(?:\.\d+)?$/;

function parseParts(raw: string): { negative: boolean; intPart: string; fracPart: string } {
  const value = String(raw ?? "").trim();
  if (!DECIMAL_RE.test(value)) {
    throw new Error(`Invalid decimal value: ${raw}`);
  }
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const [rawInt, rawFrac = ""] = body.split(".");
  const intPart = rawInt.replace(/^0+(?=\d)/, "") || "0";
  return { negative, intPart, fracPart: rawFrac };
}

export function decimalToUnits(raw: string | number, scale = 4): number {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new Error(`Invalid scale: ${scale}`);
  }
  const { negative, intPart, fracPart } = parseParts(String(raw));
  if (fracPart.length > scale) {
    throw new Error(`Decimal exceeds scale ${scale}: ${raw}`);
  }
  const paddedFrac = fracPart.padEnd(scale, "0");
  const scaleFactor = 10 ** scale;
  const whole = Number(intPart);
  const frac = Number(paddedFrac || "0");
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(frac)) {
    throw new Error(`Amount is out of safe integer range: ${raw}`);
  }
  const abs = whole * scaleFactor + frac;
  if (!Number.isSafeInteger(abs)) {
    throw new Error(`Amount is out of safe integer range: ${raw}`);
  }
  return negative ? -abs : abs;
}

export function unitsToDecimal(units: number, scale = 4, trim = true): string {
  if (!Number.isSafeInteger(units)) {
    throw new Error(`Units are out of safe integer range: ${units}`);
  }
  const negative = units < 0;
  const abs = negative ? -units : units;
  const div = 10 ** scale;
  const whole = Math.floor(abs / div);
  const frac = abs % div;
  if (scale === 0) {
    return `${negative ? "-" : ""}${whole.toString()}`;
  }
  let fracText = frac.toString().padStart(scale, "0");
  if (trim) fracText = fracText.replace(/0+$/, "");
  if (!fracText) {
    return `${negative ? "-" : ""}${whole.toString()}`;
  }
  return `${negative ? "-" : ""}${whole.toString()}.${fracText}`;
}

export function addDecimalExact(a: string | number, b: string | number, scale = 4): string {
  const sum = decimalToUnits(a, scale) + decimalToUnits(b, scale);
  return unitsToDecimal(sum, scale, true);
}

export function subtractDecimalExact(a: string | number, b: string | number, scale = 4): string {
  const diff = decimalToUnits(a, scale) - decimalToUnits(b, scale);
  return unitsToDecimal(diff, scale, true);
}

export function asNonNegativeDecimal(raw: string | number, scale = 4): string {
  const units = decimalToUnits(raw, scale);
  if (units < 0) throw new Error(`Negative amount not allowed: ${raw}`);
  return unitsToDecimal(units, scale, true);
}

export function toNumberFromDecimal(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid numeric conversion: ${raw}`);
  }
  return n;
}
