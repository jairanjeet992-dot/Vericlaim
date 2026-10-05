import {
  EntityType,
  LegacyCaseRow,
  UnresolvedEntityReport,
  EntityApprovalDecision
} from './types';

export const KNOWN_COMPANY_ALIASES: Record<string, string> = {
  'STAR': 'STAR HEALTH',
  'STAR HEALTH AND ALLIED': 'STAR HEALTH',
  'CARE HEALTH': 'CARE',
  'RELIGARE': 'CARE',
  'SBI GENERAL': 'SBI',
  'TATA AIA LIFE': 'TATA AIA',
  'TATA AIG GENERAL': 'TATA AIG',
  'ADITYA BIRLA HEALTH': 'ADITYA BIRLA',
  'IFFCO-TOKIO': 'IFFCO TOKIO',
  'CHOLAMANDALAM': 'CHOLA',
  'VIDAL': 'VIDAL HEALTH',
  'BRAIN BIRD': 'BRAINBIRD'
};

export const KNOWN_INVESTIGATOR_NORMALIZATION: Record<string, string> = {
  'ANIL RAJPUT KANOD': 'Anil Rajput',
  'ARUN BARFA': 'Arun Barfa',
  'DHEERAJ JAGADHALE': 'Dheeraj Jagadhale',
  'PAVAN PRAJAPATI': 'Pavan Prajapati',
  'NA': '__UNASSIGNED__',
  'DNA': '__INTERNAL_DNA__'
};

export interface KnownEntityRecord {
  id: string;
  name: string;
  aliases?: string[];
}

export interface EntityRegistry {
  clients: KnownEntityRecord[];
  investigators: KnownEntityRecord[];
  hospitals: KnownEntityRecord[];
  caseTypes: KnownEntityRecord[];
}

/**
 * Normalizes text for matching: uppercase, trims, strips special punctuation except hyphens/spaces.
 */
export function normalizeEntityText(rawText: string | null | undefined): string {
  if (!rawText) return '';
  return rawText
    .toUpperCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Standard Levenshtein distance calculation
 */
export function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

/**
 * Normalized Levenshtein similarity score between 0.0 and 1.0
 */
export function levenshteinSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(s1, s2);
  return Math.max(0, 1.0 - dist / maxLen);
}

/**
 * Jaro distance between two strings
 */
function jaroDistance(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;

  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (
    (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3.0
  );
}

/**
 * Jaro-Winkler similarity calculation with standard prefix scale 0.1
 */
export function jaroWinklerSimilarity(s1: string, s2: string): number {
  const jaro = jaroDistance(s1, s2);
  let prefix = 0;
  const maxPrefix = 4;
  for (let i = 0; i < Math.min(maxPrefix, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1.0 - jaro);
}

/**
 * Blended composite similarity: max of Jaro-Winkler and Levenshtein
 */
export function calculateSimilarity(s1: string, s2: string): number {
  const clean1 = normalizeEntityText(s1);
  const clean2 = normalizeEntityText(s2);
  if (clean1 === clean2) return 1.0;
  if (!clean1 || !clean2) return 0.0;

  // Exact substring containment boost
  if (clean1.includes(clean2) || clean2.includes(clean1)) {
    const minLen = Math.min(clean1.length, clean2.length);
    const maxLen = Math.max(clean1.length, clean2.length);
    const coverage = minLen / maxLen;
    if (coverage >= 0.7) {
      return Math.max(0.88, jaroWinklerSimilarity(clean1, clean2));
    }
  }

  const jw = jaroWinklerSimilarity(clean1, clean2);
  const lev = levenshteinSimilarity(clean1, clean2);
  return Math.round(Math.max(jw, lev) * 100) / 100;
}

export class EntityResolver {
  private registry: EntityRegistry;
  private customAliases: Map<string, string>; // normalized raw_text -> canonical_name or target_id

  constructor(registry: EntityRegistry, customAliases?: Map<string, string>) {
    this.registry = registry;
    this.customAliases = customAliases || new Map();
  }

  /**
   * Resolve a single company/client text to an entity ID and canonical name
   */
  public resolveCompany(rawText: string): {
    id: string | null;
    canonicalName: string | null;
    score: number;
    status: 'EXACT' | 'ALIAS' | 'FUZZY_FLAGGED' | 'UNRESOLVED';
  } {
    const norm = normalizeEntityText(rawText);
    if (!norm) return { id: null, canonicalName: null, score: 0, status: 'UNRESOLVED' };

    // 1. Exact match against known clients
    for (const c of this.registry.clients) {
      if (normalizeEntityText(c.name) === norm) {
        return { id: c.id, canonicalName: c.name, score: 1.0, status: 'EXACT' };
      }
    }

    // 2. Custom approved aliases
    if (this.customAliases.has(norm)) {
      const target = this.customAliases.get(norm)!;
      const matched = this.registry.clients.find(c => c.id === target || normalizeEntityText(c.name) === normalizeEntityText(target));
      if (matched) {
        return { id: matched.id, canonicalName: matched.name, score: 1.0, status: 'ALIAS' };
      }
    }

    // 3. Known dictionary alias
    const aliasTarget = KNOWN_COMPANY_ALIASES[norm];
    if (aliasTarget) {
      const aliasNorm = normalizeEntityText(aliasTarget);
      for (const c of this.registry.clients) {
        if (normalizeEntityText(c.name) === aliasNorm || normalizeEntityText(c.name).includes(aliasNorm)) {
          return { id: c.id, canonicalName: c.name, score: 1.0, status: 'ALIAS' };
        }
      }
    }

    // 4. Fuzzy match against registered clients
    let bestScore = 0;
    let bestMatch: KnownEntityRecord | null = null;

    for (const c of this.registry.clients) {
      const score = calculateSimilarity(norm, c.name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = c;
      }
    }

    if (bestMatch && bestScore >= 0.85) {
      return { id: bestMatch.id, canonicalName: bestMatch.name, score: bestScore, status: 'FUZZY_FLAGGED' };
    }

    return { id: null, canonicalName: bestMatch?.name || null, score: bestScore, status: 'UNRESOLVED' };
  }

  /**
   * Resolve an investigator text string
   */
  public resolveInvestigator(rawText: string | null | undefined): {
    id: string | null;
    canonicalName: string | null;
    score: number;
    status: 'EXACT' | 'ALIAS' | 'UNASSIGNED' | 'FUZZY_FLAGGED' | 'UNRESOLVED';
  } {
    if (!rawText) return { id: null, canonicalName: null, score: 0, status: 'UNASSIGNED' };
    const norm = normalizeEntityText(rawText);
    if (!norm || norm === 'NA' || norm === 'NONE' || norm === 'NULL') {
      return { id: null, canonicalName: null, score: 1.0, status: 'UNASSIGNED' };
    }

    // 1. Exact match
    for (const inv of this.registry.investigators) {
      if (normalizeEntityText(inv.name) === norm) {
        return { id: inv.id, canonicalName: inv.name, score: 1.0, status: 'EXACT' };
      }
    }

    // 2. Custom approved aliases
    if (this.customAliases.has(norm)) {
      const target = this.customAliases.get(norm)!;
      const matched = this.registry.investigators.find(inv => inv.id === target || normalizeEntityText(inv.name) === normalizeEntityText(target));
      if (matched) {
        return { id: matched.id, canonicalName: matched.name, score: 1.0, status: 'ALIAS' };
      }
    }

    // 3. Known normalization dictionary
    const normTarget = KNOWN_INVESTIGATOR_NORMALIZATION[norm];
    if (normTarget) {
      if (normTarget === '__UNASSIGNED__' || normTarget === '__INTERNAL_DNA__') {
        return { id: null, canonicalName: normTarget, score: 1.0, status: 'UNASSIGNED' };
      }
      const targetNorm = normalizeEntityText(normTarget);
      for (const inv of this.registry.investigators) {
        if (normalizeEntityText(inv.name) === targetNorm) {
          return { id: inv.id, canonicalName: inv.name, score: 1.0, status: 'ALIAS' };
        }
      }
    }

    // 4. Fuzzy match
    let bestScore = 0;
    let bestMatch: KnownEntityRecord | null = null;

    for (const inv of this.registry.investigators) {
      const score = calculateSimilarity(norm, inv.name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = inv;
      }
    }

    if (bestMatch && bestScore >= 0.85) {
      return { id: bestMatch.id, canonicalName: bestMatch.name, score: bestScore, status: 'FUZZY_FLAGGED' };
    }

    return { id: null, canonicalName: bestMatch?.name || null, score: bestScore, status: 'UNRESOLVED' };
  }

  /**
   * Generates the formal UnresolvedEntityReport matching Section 3 of docs/LEGACY_DATA_MAP.md
   */
  public generateUnresolvedReport(
    agencyId: string,
    batchId: string,
    rows: LegacyCaseRow[]
  ): UnresolvedEntityReport {
    let companyExact = 0;
    let companyFuzzy = 0;
    let companyUnresolved = 0;
    let invExact = 0;
    let invFuzzy = 0;
    let invUnresolved = 0;

    const exceptionMap = new Map<string, {
      exception_id: string;
      entity_type: string;
      legacy_field: string;
      raw_text: string;
      occurrences: number;
      suggested_match: {
        entity_id: string | null;
        canonical_name: string | null;
        similarity_score: number;
      };
      affected_doc_codes: string[];
      resolution_status: 'pending_admin_action' | 'unresolved_new_entity_required' | 'resolved';
    }>();

    let excCounter = 1;

    for (const row of rows) {
      // Analyze Company
      if (row.company) {
        const compRes = this.resolveCompany(row.company);
        if (compRes.status === 'EXACT' || compRes.status === 'ALIAS') {
          companyExact++;
        } else if (compRes.status === 'FUZZY_FLAGGED') {
          companyFuzzy++;
          const key = `company:${normalizeEntityText(row.company)}`;
          if (!exceptionMap.has(key)) {
            exceptionMap.set(key, {
              exception_id: `EXC-${String(excCounter++).padStart(3, '0')}`,
              entity_type: 'company',
              legacy_field: 'company',
              raw_text: row.company,
              occurrences: 0,
              suggested_match: {
                entity_id: compRes.id,
                canonical_name: compRes.canonicalName,
                similarity_score: compRes.score
              },
              affected_doc_codes: [],
              resolution_status: 'pending_admin_action'
            });
          }
          const exc = exceptionMap.get(key)!;
          exc.occurrences++;
          if (row.doc_code && !exc.affected_doc_codes.includes(row.doc_code)) {
            exc.affected_doc_codes.push(row.doc_code);
          }
        } else {
          companyUnresolved++;
          const key = `company:${normalizeEntityText(row.company)}`;
          if (!exceptionMap.has(key)) {
            exceptionMap.set(key, {
              exception_id: `EXC-${String(excCounter++).padStart(3, '0')}`,
              entity_type: 'company',
              legacy_field: 'company',
              raw_text: row.company,
              occurrences: 0,
              suggested_match: {
                entity_id: null,
                canonical_name: null,
                similarity_score: compRes.score
              },
              affected_doc_codes: [],
              resolution_status: 'unresolved_new_entity_required'
            });
          }
          const exc = exceptionMap.get(key)!;
          exc.occurrences++;
          if (row.doc_code && !exc.affected_doc_codes.includes(row.doc_code)) {
            exc.affected_doc_codes.push(row.doc_code);
          }
        }
      }

      // Analyze Investigator 1
      const invFields: Array<{ field: 'inv1' | 'inv2'; val?: string }> = [
        { field: 'inv1', val: row.inv1 },
        { field: 'inv2', val: row.inv2 }
      ];

      for (const item of invFields) {
        if (!item.val) continue;
        const norm = normalizeEntityText(item.val);
        if (!norm || norm === 'NA' || norm === 'NONE' || norm === '__UNASSIGNED__') continue;

        const invRes = this.resolveInvestigator(item.val);
        if (invRes.status === 'EXACT' || invRes.status === 'ALIAS') {
          invExact++;
        } else if (invRes.status === 'FUZZY_FLAGGED') {
          invFuzzy++;
          const key = `investigator:${norm}`;
          if (!exceptionMap.has(key)) {
            exceptionMap.set(key, {
              exception_id: `EXC-${String(excCounter++).padStart(3, '0')}`,
              entity_type: 'investigator',
              legacy_field: item.field,
              raw_text: item.val,
              occurrences: 0,
              suggested_match: {
                entity_id: invRes.id,
                canonical_name: invRes.canonicalName,
                similarity_score: invRes.score
              },
              affected_doc_codes: [],
              resolution_status: 'pending_admin_action'
            });
          }
          const exc = exceptionMap.get(key)!;
          exc.occurrences++;
          if (row.doc_code && !exc.affected_doc_codes.includes(row.doc_code)) {
            exc.affected_doc_codes.push(row.doc_code);
          }
        } else if (invRes.status === 'UNRESOLVED') {
          invUnresolved++;
          const key = `investigator:${norm}`;
          if (!exceptionMap.has(key)) {
            exceptionMap.set(key, {
              exception_id: `EXC-${String(excCounter++).padStart(3, '0')}`,
              entity_type: 'investigator',
              legacy_field: item.field,
              raw_text: item.val,
              occurrences: 0,
              suggested_match: {
                entity_id: null,
                canonical_name: null,
                similarity_score: invRes.score
              },
              affected_doc_codes: [],
              resolution_status: 'unresolved_new_entity_required'
            });
          }
          const exc = exceptionMap.get(key)!;
          exc.occurrences++;
          if (row.doc_code && !exc.affected_doc_codes.includes(row.doc_code)) {
            exc.affected_doc_codes.push(row.doc_code);
          }
        }
      }
    }

    return {
      agency_id: agencyId,
      batch_id: batchId,
      generated_at: new Date().toISOString(),
      summary: {
        total_cases_analyzed: rows.length,
        company_names_matched_exact: companyExact,
        company_names_fuzzy_flagged: companyFuzzy,
        company_names_unresolved: companyUnresolved,
        investigator_names_matched_exact: invExact,
        investigator_names_fuzzy_flagged: invFuzzy,
        investigator_names_unresolved: invUnresolved
      },
      exceptions: Array.from(exceptionMap.values())
    };
  }
}
