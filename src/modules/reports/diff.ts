/**
 * Pure Diff Engine for Report Versions (Rule A3: Zero DB, Zero UI Imports)
 * Compares two report versions and computes structured additions, deletions,
 * modifications, evidence diffs, and text changes.
 */

import { ReportContent, ReportDiff, SectionDiff } from './types';

export function calculateReportDiff(
  fromVersionNumber: number,
  toVersionNumber: number,
  fromContent: ReportContent,
  toContent: ReportContent
): ReportDiff {
  const summaryChanged = (fromContent.summary || '').trim() !== (toContent.summary || '').trim();
  const summaryChange = {
    oldSummary: fromContent.summary,
    newSummary: toContent.summary,
    hasChanged: summaryChanged,
  };

  const outcomeChanged = (fromContent.outcome || '') !== (toContent.outcome || '');
  const outcomeChange = {
    oldOutcome: fromContent.outcome,
    newOutcome: toContent.outcome,
    hasChanged: outcomeChanged,
  };

  const allKeys = new Set([
    ...Object.keys(fromContent.sections || {}),
    ...Object.keys(toContent.sections || {}),
  ]);

  const sectionDiffs: SectionDiff[] = [];
  let hasSectionChanges = false;

  for (const key of allKeys) {
    const fromSec = fromContent.sections?.[key];
    const toSec = toContent.sections?.[key];

    if (!fromSec && toSec) {
      hasSectionChanges = true;
      sectionDiffs.push({
        sectionKey: key,
        sectionTitle: toSec.title || key,
        changeType: 'ADDED',
        newText: toSec.text,
        newEvidenceIds: toSec.evidence_ids || [],
      });
    } else if (fromSec && !toSec) {
      hasSectionChanges = true;
      sectionDiffs.push({
        sectionKey: key,
        sectionTitle: fromSec.title || key,
        changeType: 'REMOVED',
        oldText: fromSec.text,
        oldEvidenceIds: fromSec.evidence_ids || [],
      });
    } else if (fromSec && toSec) {
      const textDiffers = (fromSec.text || '').trim() !== (toSec.text || '').trim();
      const titleDiffers = (fromSec.title || '').trim() !== (toSec.title || '').trim();
      const verifiedDiffers = !!fromSec.verified !== !!toSec.verified;

      const fromEv = (fromSec.evidence_ids || []).slice().sort();
      const toEv = (toSec.evidence_ids || []).slice().sort();
      const evidenceDiffers =
        fromEv.length !== toEv.length || fromEv.some((id, idx) => id !== toEv[idx]);

      const customFieldsDiffers =
        JSON.stringify(fromSec.custom_fields || {}) !== JSON.stringify(toSec.custom_fields || {});

      const isModified =
        textDiffers || titleDiffers || verifiedDiffers || evidenceDiffers || customFieldsDiffers;

      if (isModified) {
        hasSectionChanges = true;
      }

      sectionDiffs.push({
        sectionKey: key,
        sectionTitle: toSec.title || fromSec.title || key,
        changeType: isModified ? 'MODIFIED' : 'UNCHANGED',
        oldText: fromSec.text,
        newText: toSec.text,
        oldEvidenceIds: fromSec.evidence_ids || [],
        newEvidenceIds: toSec.evidence_ids || [],
      });
    }
  }

  const hasChanges = summaryChanged || outcomeChanged || hasSectionChanges;

  return {
    fromVersionNumber,
    toVersionNumber,
    summaryChange,
    outcomeChange,
    sectionDiffs,
    hasChanges,
  };
}
