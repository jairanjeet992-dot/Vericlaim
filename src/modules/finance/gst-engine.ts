/**
 * Pure GST Calculation & Formatting Engine (Decimal.js)
 * Implements Indian GST place-of-supply resolution, intra/inter-state split,
 * forward & total-inclusive calculations, rounding policy, and amount-in-words.
 *
 * Mark: CA-VERIFY (Legal/tax calculations must be verified by a Chartered Accountant)
 */

import Decimal from 'decimal.js';
import { validateGstin, INDIAN_STATE_CODES } from '../../lib/validation/gstin';

// Configure central precision and rounding policy (Rule A6)
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type CalculationMode = 'FORWARD' | 'TOTAL_INCLUSIVE';

export interface GstLineItemInput {
  itemType?: string;
  description: string;
  sacCode?: string;
  quantity?: number | string | Decimal;
  unitRate?: number | string | Decimal;
  amount: number | string | Decimal;
  taxRate?: number | string | Decimal; // e.g. 18.00
  caseId?: string;
}

export interface ComputedTaxBreakdown {
  taxType: 'CGST' | 'SGST' | 'IGST';
  rate: string;
  taxableBase: string;
  taxAmount: string;
}

export interface ComputedLineItem {
  itemType: string;
  description: string;
  sacCode: string;
  quantity: string;
  unitRate: string;
  taxableAmount: string;
  taxRate: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  totalTaxAmount: string;
  totalAmount: string;
  caseId?: string;
}

export interface GstCalculationResult {
  placeOfSupplyStateCode: string;
  placeOfSupplyStateName: string;
  supplierStateCode: string;
  recipientStateCode: string;
  isIntraState: boolean;
  isReverseCharge: boolean;
  isSez: boolean;
  calculationMode: CalculationMode;
  defaultSacCode: string;
  defaultTaxRate: string;
  items: ComputedLineItem[];
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  totalTaxAmount: string;
  totalAmount: string;
  taxes: ComputedTaxBreakdown[];
  amountInWords: string;
}

export interface GstEngineOptions {
  supplierStateCode: string;
  recipientStateCode: string;
  isReverseCharge?: boolean;
  isSez?: boolean;
  defaultSacCode?: string;
  defaultTaxRate?: number | string;
  calculationMode?: CalculationMode;
  discountAmount?: number | string;
}

/**
 * Rounds any monetary value to exactly 2 decimal places using ROUND_HALF_UP.
 */
export function round2(val: Decimal.Value): Decimal {
  return new Decimal(val).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Formats a Decimal value to a standard 2-decimal string.
 */
export function format2(val: Decimal.Value): string {
  return round2(val).toFixed(2);
}

/**
 * Calculates Indian Financial Year string (e.g., '2026-27') from a date.
 * Financial Year runs April 1 to March 31.
 */
export function getFinancialYear(date: Date = new Date()): string {
  const month = date.getMonth(); // 0-indexed: 0 = Jan, 2 = Mar, 3 = Apr
  const year = date.getFullYear();

  if (month >= 3) {
    // April (3) to December (11)
    const nextYearShort = String((year + 1) % 100).padStart(2, '0');
    return `${year}-${nextYearShort}`;
  } else {
    // January (0) to March (2)
    const curYearShort = String(year % 100).padStart(2, '0');
    return `${year - 1}-${curYearShort}`;
  }
}

/**
 * Resolves place of supply and determines if transaction is intra-state (CGST + SGST) or inter-state (IGST).
 * Rule: Intra-state when supplier state code === recipient (client branch) state code.
 * Exception: SEZ units/developers are treated as inter-state supplies with IGST or zero-rated.
 */
export function resolvePlaceOfSupply(
  supplierStateCode: string,
  recipientStateCode: string,
  isSez: boolean = false
): { isIntraState: boolean; placeOfSupplyStateCode: string; placeOfSupplyStateName: string } {
  const supp = supplierStateCode.trim().padStart(2, '0');
  const recip = recipientStateCode.trim().padStart(2, '0');

  const placeOfSupplyStateCode = recip;
  const placeOfSupplyStateName = INDIAN_STATE_CODES[recip] || 'Unknown State';

  if (isSez) {
    return {
      isIntraState: false,
      placeOfSupplyStateCode,
      placeOfSupplyStateName,
    };
  }

  const isIntraState = supp === recip;
  return {
    isIntraState,
    placeOfSupplyStateCode,
    placeOfSupplyStateName,
  };
}

/**
 * Pure calculation engine for invoice line items and GST split.
 */
export function calculateGst(
  rawItems: GstLineItemInput[],
  options: GstEngineOptions
): GstCalculationResult {
  const defaultSac = options.defaultSacCode || '998311'; // Management consulting / investigation services
  const defaultRate = new Decimal(options.defaultTaxRate ?? 18.0);
  const calculationMode = options.calculationMode || 'FORWARD';
  const isReverseCharge = !!options.isReverseCharge;
  const isSez = !!options.isSez;
  const discountDecimal = round2(options.discountAmount || 0);

  const { isIntraState, placeOfSupplyStateCode, placeOfSupplyStateName } = resolvePlaceOfSupply(
    options.supplierStateCode,
    options.recipientStateCode,
    isSez
  );

  let totalTaxable = new Decimal(0);
  let totalCgst = new Decimal(0);
  let totalSgst = new Decimal(0);
  let totalIgst = new Decimal(0);
  let totalGross = new Decimal(0);

  const computedItems: ComputedLineItem[] = [];

  for (const item of rawItems) {
    const rawAmt = new Decimal(item.amount);
    const sac = item.sacCode || defaultSac;
    const rate = item.taxRate !== undefined ? new Decimal(item.taxRate) : defaultRate;
    const qty = new Decimal(item.quantity ?? 1);
    const unitRate = item.unitRate !== undefined ? new Decimal(item.unitRate) : rawAmt.dividedBy(qty);

    let taxable: Decimal;
    let itemCgst = new Decimal(0);
    let itemSgst = new Decimal(0);
    let itemIgst = new Decimal(0);
    let itemTotalTax = new Decimal(0);
    let itemTotalGross: Decimal;

    if (calculationMode === 'TOTAL_INCLUSIVE') {
      // Backward calculation from total gross (TEST-08 parity)
      // taxable = round(gross / (1 + rate / 100))
      itemTotalGross = round2(rawAmt);
      const divisor = new Decimal(1).plus(rate.dividedBy(100));
      taxable = round2(itemTotalGross.dividedBy(divisor));
      itemTotalTax = round2(itemTotalGross.minus(taxable));

      if (rate.isZero() || isReverseCharge) {
        // Zero-rated or Reverse Charge: tax not added to total
        itemCgst = new Decimal(0);
        itemSgst = new Decimal(0);
        itemIgst = new Decimal(0);
      } else if (isIntraState) {
        itemCgst = round2(itemTotalTax.dividedBy(2));
        itemSgst = round2(itemTotalTax.minus(itemCgst)); // ensures exact balance
      } else {
        itemIgst = itemTotalTax;
      }
    } else {
      // Standard FORWARD calculation
      taxable = round2(rawAmt);

      if (rate.isZero() || isReverseCharge) {
        itemCgst = new Decimal(0);
        itemSgst = new Decimal(0);
        itemIgst = new Decimal(0);
        itemTotalTax = new Decimal(0);
      } else if (isIntraState) {
        const halfRate = rate.dividedBy(2);
        itemCgst = round2(taxable.times(halfRate).dividedBy(100));
        itemSgst = round2(taxable.times(halfRate).dividedBy(100));
        itemTotalTax = itemCgst.plus(itemSgst);
      } else {
        itemIgst = round2(taxable.times(rate).dividedBy(100));
        itemTotalTax = itemIgst;
      }

      itemTotalGross = taxable.plus(itemTotalTax);
    }

    totalTaxable = totalTaxable.plus(taxable);
    totalCgst = totalCgst.plus(itemCgst);
    totalSgst = totalSgst.plus(itemSgst);
    totalIgst = totalIgst.plus(itemIgst);
    totalGross = totalGross.plus(itemTotalGross);

    computedItems.push({
      itemType: item.itemType || 'PROFESSIONAL_FEE',
      description: item.description,
      sacCode: sac,
      quantity: qty.toFixed(2),
      unitRate: format2(unitRate),
      taxableAmount: format2(taxable),
      taxRate: rate.toFixed(2),
      cgstAmount: format2(itemCgst),
      sgstAmount: format2(itemSgst),
      igstAmount: format2(itemIgst),
      totalTaxAmount: format2(itemTotalTax),
      totalAmount: format2(itemTotalGross),
      caseId: item.caseId,
    });
  }

  // Adjust for discount if provided
  const netTaxable = totalTaxable.minus(discountDecimal);
  const totalTax = totalCgst.plus(totalSgst).plus(totalIgst);
  const netTotal = netTaxable.plus(totalTax);

  // Group Tax Summaries by Tax Type
  const taxes: ComputedTaxBreakdown[] = [];
  if (isIntraState) {
    if (!totalCgst.isZero()) {
      taxes.push({
        taxType: 'CGST',
        rate: defaultRate.dividedBy(2).toFixed(2),
        taxableBase: format2(netTaxable),
        taxAmount: format2(totalCgst),
      });
    }
    if (!totalSgst.isZero()) {
      taxes.push({
        taxType: 'SGST',
        rate: defaultRate.dividedBy(2).toFixed(2),
        taxableBase: format2(netTaxable),
        taxAmount: format2(totalSgst),
      });
    }
  } else {
    if (!totalIgst.isZero()) {
      taxes.push({
        taxType: 'IGST',
        rate: defaultRate.toFixed(2),
        taxableBase: format2(netTaxable),
        taxAmount: format2(totalIgst),
      });
    }
  }

  const amountInWords = convertNumberToIndianWords(netTotal);

  return {
    placeOfSupplyStateCode,
    placeOfSupplyStateName,
    supplierStateCode: options.supplierStateCode,
    recipientStateCode: options.recipientStateCode,
    isIntraState,
    isReverseCharge,
    isSez,
    calculationMode,
    defaultSacCode: defaultSac,
    defaultTaxRate: defaultRate.toFixed(2),
    items: computedItems,
    subtotalAmount: format2(totalTaxable),
    discountAmount: format2(discountDecimal),
    taxableAmount: format2(netTaxable),
    cgstAmount: format2(totalCgst),
    sgstAmount: format2(totalSgst),
    igstAmount: format2(totalIgst),
    totalTaxAmount: format2(totalTax),
    totalAmount: format2(netTotal),
    taxes,
    amountInWords,
  };
}

/**
 * Converts a numeric or decimal currency value into Indian English Words.
 * Format: "Indian Rupees [Amount In Words] and [Paise In Words] Paise Only"
 * Follows Indian numbering system: Crores, Lakhs, Thousands, Hundreds.
 */
export function convertNumberToIndianWords(amount: Decimal.Value): string {
  const dec = round2(amount);
  if (dec.isZero()) {
    return 'Indian Rupees Zero Only';
  }

  const isNegative = dec.isNegative();
  const absDec = dec.abs();

  const rupeesPart = absDec.floor().toNumber();
  const paisePart = absDec.minus(absDec.floor()).times(100).round().toNumber();

  const words = convertWholeNumberToWords(rupeesPart);
  let result = `Indian Rupees ${words}`;

  if (paisePart > 0) {
    const paiseWords = convertWholeNumberToWords(paisePart);
    result += ` and ${paiseWords} Paise`;
  }

  result += ' Only';

  return isNegative ? `Minus ${result}` : result;
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

function convertBelowThousand(n: number): string {
  let str = '';
  if (n >= 100) {
    str += `${ONES[Math.floor(n / 100)]} Hundred `;
    n %= 100;
  }
  if (n >= 20) {
    str += `${TENS[Math.floor(n / 10)]} `;
    n %= 10;
  }
  if (n > 0) {
    str += `${ONES[n]} `;
  }
  return str.trim();
}

function convertWholeNumberToWords(num: number): string {
  if (num === 0) return 'Zero';

  let remaining = num;
  let result = '';

  // Crores (1,00,00,000)
  const crores = Math.floor(remaining / 10000000);
  if (crores > 0) {
    result += `${convertWholeNumberToWords(crores)} Crore `;
    remaining %= 10000000;
  }

  // Lakhs (1,00,000)
  const lakhs = Math.floor(remaining / 100000);
  if (lakhs > 0) {
    result += `${convertBelowThousand(lakhs)} Lakh `;
    remaining %= 100000;
  }

  // Thousands (1,000)
  const thousands = Math.floor(remaining / 1000);
  if (thousands > 0) {
    result += `${convertBelowThousand(thousands)} Thousand `;
    remaining %= 1000;
  }

  // Hundreds & Below
  if (remaining > 0) {
    result += convertBelowThousand(remaining);
  }

  return result.trim();
}

/**
 * Validates GSTIN consistency with state codes.
 */
export function verifyGstinWithState(gstin: string, stateCode: string) {
  return validateGstin(gstin, stateCode);
}
