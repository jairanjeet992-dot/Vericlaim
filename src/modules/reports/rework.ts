/**
 * Pure Rework & Escalation Engine (Rule A3: Zero DB, Zero UI Imports)
 * Handles rework cycle thresholds, auto-escalation calculation,
 * recipient resolution, and actionable task instruction generation.
 */

import { ReworkPriority, ReworkRecipientType } from './types';

export const DEFAULT_REWORK_ESCALATION_THRESHOLD = 3;

export interface EvaluateReworkEscalationInput {
  cycleNumber: number;
  priority: ReworkPriority;
  threshold?: number;
}

export interface EvaluateReworkEscalationResult {
  isEscalated: boolean;
  targetCaseStatus: 'REPORT_DRAFTING' | 'ESCALATED_REVIEW';
  escalationReason?: string;
  effectivePriority: ReworkPriority;
}

/**
 * Determines whether a rework cycle triggers automatic executive escalation.
 * Per ADR 008 & WORKFLOW.md: Rework count >= 3 moves case to ESCALATED_REVIEW.
 */
export function evaluateReworkEscalation(
  input: EvaluateReworkEscalationInput
): EvaluateReworkEscalationResult {
  const { cycleNumber, priority, threshold = DEFAULT_REWORK_ESCALATION_THRESHOLD } = input;

  const isEscalated = cycleNumber >= threshold;

  // Escalated cycles automatically upgrade priority to URGENT if not already
  let effectivePriority = priority;
  if (isEscalated) {
    effectivePriority = 'URGENT';
  } else if (cycleNumber >= 2 && priority === 'LOW') {
    effectivePriority = 'MEDIUM';
  }

  return {
    isEscalated,
    targetCaseStatus: isEscalated ? 'ESCALATED_REVIEW' : 'REPORT_DRAFTING',
    escalationReason: isEscalated
      ? `Automatic quality escalation: Docket reached rework cycle #${cycleNumber} (Threshold: ${threshold}). Requires executive management review.`
      : undefined,
    effectivePriority,
  };
}

/**
 * Formats an actionable task title and markdown description for the rework recipient.
 */
export function generateReworkTaskPayload(params: {
  cycleNumber: number;
  recipientType: ReworkRecipientType;
  reasonCategory: string;
  instructions: string;
  targetSections?: string[];
  targetFieldNames?: string[];
  targetEvidenceIds?: string[];
  deadline?: string;
}): { title: string; description: string } {
  const {
    cycleNumber,
    recipientType,
    reasonCategory,
    instructions,
    targetSections = [],
    targetFieldNames = [],
    targetEvidenceIds = [],
    deadline,
  } = params;

  const title = `[Rework #${cycleNumber}] ${reasonCategory} (${recipientType})`;

  let desc = `### Rework Instructions (Cycle #${cycleNumber})\n\n`;
  desc += `**Assigned Role:** ${recipientType}\n`;
  desc += `**Reason Category:** ${reasonCategory}\n`;
  if (deadline) {
    desc += `**Target Deadline:** ${new Date(deadline).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n`;
  }
  desc += `\n#### Specific Instructions:\n${instructions}\n\n`;

  if (targetSections.length > 0) {
    desc += `#### Target Sections to Correct:\n`;
    targetSections.forEach((s) => {
      desc += `- [ ] Section: \`${s}\`\n`;
    });
    desc += `\n`;
  }

  if (targetFieldNames.length > 0) {
    desc += `#### Target Fields to Verify:\n`;
    targetFieldNames.forEach((f) => {
      desc += `- [ ] Field: \`${f}\`\n`;
    });
    desc += `\n`;
  }

  if (targetEvidenceIds.length > 0) {
    desc += `#### Referenced Evidence Documents:\n`;
    targetEvidenceIds.forEach((id) => {
      desc += `- Evidence Document ID: \`${id}\`\n`;
    });
    desc += `\n`;
  }

  return { title, description: desc.trim() };
}
