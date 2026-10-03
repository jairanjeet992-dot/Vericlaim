/**
 * Indian Goods and Services Tax Identification Number (GSTIN) Validator
 * Implements format check, state code validation, and MOD 36 checksum calculation.
 */

export const INDIAN_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
};

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface GstinValidationResult {
  isValid: boolean;
  stateCode?: string;
  stateName?: string;
  pan?: string;
  expectedCheckChar?: string;
  actualCheckChar?: string;
  error?: string;
}

/**
 * Calculates the expected 15th checksum character for a 14-character GSTIN prefix
 * using the standard Indian GSTN Luhn MOD 36 algorithm.
 */
export function calculateGstinChecksum(gstin14: string): string {
  if (gstin14.length < 14) {
    throw new Error('Input must be at least 14 characters');
  }

  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const char = gstin14[i].toUpperCase();
    const codePoint = GST_CHARS.indexOf(char);
    if (codePoint === -1) {
      throw new Error(`Invalid character '${char}' in GSTIN`);
    }

    // Alternating factor: 1 for odd positions (index 0, 2, 4...), 2 for even positions (index 1, 3, 5...)
    const factor = i % 2 === 0 ? 1 : 2;
    const product = codePoint * factor;
    const quotient = Math.floor(product / 36);
    const remainder = product % 36;
    sum += quotient + remainder;
  }

  const checkCodePoint = (36 - (sum % 36)) % 36;
  return GST_CHARS[checkCodePoint];
}

/**
 * Validates full 15-character GSTIN including format, state code, and check digit.
 */
export function validateGstin(gstin: string, expectedStateCode?: string): GstinValidationResult {
  if (!gstin || typeof gstin !== 'string') {
    return { isValid: false, error: 'GSTIN is required' };
  }

  const clean = gstin.trim().toUpperCase();

  // 1. Length & Regex Format Check
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (clean.length !== 15 || !gstinRegex.test(clean)) {
    return {
      isValid: false,
      error: 'Invalid GSTIN format. Expected: 2 digits state + 10 chars PAN + 1 entity + Z + 1 check character',
    };
  }

  // 2. State Code Check
  const stateCode = clean.substring(0, 2);
  const stateName = INDIAN_STATE_CODES[stateCode];
  if (!stateName) {
    return {
      isValid: false,
      stateCode,
      error: `Invalid GST state code '${stateCode}'. Must be a valid Indian state/UT code (01-38, 97).`,
    };
  }

  if (expectedStateCode && expectedStateCode !== stateCode) {
    return {
      isValid: false,
      stateCode,
      stateName,
      error: `GSTIN state code '${stateCode}' does not match expected state '${expectedStateCode}'.`,
    };
  }

  // 3. Checksum Verification
  const gstinPrefix = clean.substring(0, 14);
  const actualCheckChar = clean[14];
  const expectedCheckChar = calculateGstinChecksum(gstinPrefix);

  if (actualCheckChar !== expectedCheckChar) {
    return {
      isValid: false,
      stateCode,
      stateName,
      pan: clean.substring(2, 12),
      expectedCheckChar,
      actualCheckChar,
      error: `GSTIN checksum failed. Expected '${expectedCheckChar}', got '${actualCheckChar}'.`,
    };
  }

  return {
    isValid: true,
    stateCode,
    stateName,
    pan: clean.substring(2, 12),
    expectedCheckChar,
    actualCheckChar,
  };
}
