// ============================================================================
// VERICLAIM MULTI-TENANT SAAS
// TEST SUITE: tests/phase5/investigation_evidence_pwa_gates.test.ts
// PHASE 5: Investigation, evidence, files, PWA offline GATES
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { EvidenceService, UserScopeContext } from '@/modules/evidence/service';
import { R2StorageService } from '@/modules/evidence/storage';
import { OfflineUploadQueue, StorageAdapter } from '@/modules/evidence/offline-queue';
import { computeSha256 } from '@/modules/evidence/image-compressor';
import crypto from 'crypto';

// ============================================================================
// IN-MEMORY MOCK SUPABASE DATABASE FOR PHASE 5 GATES
// ============================================================================
class MockDatabase {
  agencies: any[] = [];
  users: any[] = [];
  cases: any[] = [];
  case_investigators: any[] = [];
  investigators: any[] = [];
  investigation_activities: any[] = [];
  documents: any[] = [];
  audit_logs: any[] = [];

  createClient(currentUserId?: string, currentAgencyId?: string) {
    const db = this;

    const client: any = {
      auth: {
        getUser: async () => ({
          data: { user: currentUserId ? { id: currentUserId } : null },
          error: null,
        }),
      },
      from: (table: string) => {
        let rows = (db as any)[table] || [];

        return {
          select: (columns = '*') => {
            let working = [...rows];

            const queryObj: any = {
              eq: (col: string, val: any) => {
                working = working.filter((r) => r[col] === val);
                return queryObj;
              },
              neq: (col: string, val: any) => {
                working = working.filter((r) => r[col] !== val);
                return queryObj;
              },
              in: (col: string, vals: any[]) => {
                working = working.filter((r) => vals.includes(r[col]));
                return queryObj;
              },
              is: (col: string, val: any) => {
                if (val === null) {
                  working = working.filter((r) => r[col] === null || r[col] === undefined);
                } else {
                  working = working.filter((r) => r[col] === val);
                }
                return queryObj;
              },
              lt: (col: string, val: any) => {
                working = working.filter((r) => r[col] < val);
                return queryObj;
              },
              gt: (col: string, val: any) => {
                working = working.filter((r) => r[col] > val);
                return queryObj;
              },
              or: (conditionString: string) => {
                const parts = conditionString.split(',').map((p) => p.trim());
                working = working.filter((r) => {
                  return parts.some((p) => {
                    const [field, op, expected] = p.split('.');
                    if (op === 'eq') return String(r[field]) === String(expected);
                    return false;
                  });
                });
                return queryObj;
              },
              order: (_col: string, _opts?: any) => queryObj,
              single: async () => {
                if (working.length === 0) {
                  return { data: null, error: { message: 'Row not found' } };
                }
                return { data: { ...working[0] }, error: null };
              },
              maybeSingle: async () => {
                return { data: working.length > 0 ? { ...working[0] } : null, error: null };
              },
              then: (resolve: any) => {
                resolve({ data: working.map((w) => ({ ...w })), error: null });
              },
            };
            return queryObj;
          },
          insert: (itemOrItems: any) => {
            const items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
            const inserted: any[] = [];
            for (const item of items) {
              const newRow = {
                id: item.id || crypto.randomUUID(),
                created_at: item.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
                ...item,
              };
              rows.push(newRow);
              inserted.push(newRow);
            }
            return {
              select: () => ({
                single: async () => ({ data: inserted[0], error: null }),
                then: (resolve: any) => resolve({ data: inserted, error: null }),
              }),
              then: (resolve: any) => resolve({ data: inserted, error: null }),
            };
          },
          update: (updates: any) => {
            let working = [...rows];
            return {
              eq: (col: string, val: any) => {
                working = working.filter((r) => r[col] === val);
                for (const row of working) {
                  Object.assign(row, updates, { updated_at: new Date().toISOString() });
                }
                return {
                  select: () => ({
                    single: async () => ({ data: working[0], error: null }),
                    then: (resolve: any) => resolve({ data: working, error: null }),
                  }),
                  then: (resolve: any) => resolve({ data: working, error: null }),
                };
              },
            };
          },
          delete: () => {
            return {
              eq: (col: string, val: any) => {
                const prevCount = rows.length;
                const remaining = rows.filter((r: any) => r[col] !== val);
                (db as any)[table] = remaining;
                return {
                  then: (resolve: any) => resolve({ data: null, error: null }),
                };
              },
            };
          },
        };
      },
    };

    return client;
  }
}

// In-Memory Persistent Storage Adapter for Offline Queue Testing
class InMemoryPersistentStorage implements StorageAdapter {
  private data = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.data.get(key) || null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.data.delete(key);
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================
describe('PHASE 5: Investigation Activities, Evidence Pipeline (R2), Versioning, PWA Offline Gates', () => {
  let db: MockDatabase;
  let storage: R2StorageService;
  let evidenceService: EvidenceService;

  const AGENCY_A = '11111111-1111-1111-1111-111111111111';
  const AGENCY_B = '22222222-2222-2222-2222-222222222222';

  const MANAGER_A_ID = 'aaaaaaaa-1111-1111-1111-111111111111';
  const INVESTIGATOR_1_ID = 'bbbbbbbb-1111-1111-1111-111111111111';
  const INVESTIGATOR_2_ID = 'cccccccc-1111-1111-1111-111111111111';

  const CASE_1_ID = '33333333-1111-1111-1111-111111111111'; // Assigned to Inv 1
  const CASE_2_ID = '44444444-1111-1111-1111-111111111111'; // Assigned to Inv 2
  const CASE_AGENCY_B_ID = '55555555-2222-2222-2222-222222222222'; // Agency B case

  const contextManagerA: UserScopeContext = {
    agencyId: AGENCY_A,
    userId: MANAGER_A_ID,
    scope: 'ALL',
  };

  const contextInv1: UserScopeContext = {
    agencyId: AGENCY_A,
    userId: INVESTIGATOR_1_ID,
    scope: 'ASSIGNED',
  };

  const contextInv2: UserScopeContext = {
    agencyId: AGENCY_A,
    userId: INVESTIGATOR_2_ID,
    scope: 'ASSIGNED',
  };

  const contextAgencyB: UserScopeContext = {
    agencyId: AGENCY_B,
    userId: '99999999-9999-9999-9999-999999999999',
    scope: 'ALL',
  };

  beforeEach(() => {
    db = new MockDatabase();
    R2StorageService.resetMockStorage();
    storage = new R2StorageService({ isMock: true });
    evidenceService = new EvidenceService(db.createClient(), storage);

    // Seed Agencies
    db.agencies.push(
      { id: AGENCY_A, code: 'DNA', name: 'DNA Investigation Agency', is_active: true },
      { id: AGENCY_B, code: 'OTHER', name: 'Other Agency', is_active: true }
    );

    // Seed Users
    db.users.push(
      { id: MANAGER_A_ID, agency_id: AGENCY_A, username: 'manager_a', scope: 'ALL', is_active: true },
      { id: INVESTIGATOR_1_ID, agency_id: AGENCY_A, username: 'inv_1', scope: 'ASSIGNED', is_active: true },
      { id: INVESTIGATOR_2_ID, agency_id: AGENCY_A, username: 'inv_2', scope: 'ASSIGNED', is_active: true }
    );

    // Seed Cases
    db.cases.push(
      {
        id: CASE_1_ID,
        agency_id: AGENCY_A,
        claim_no: 'CLM-001',
        insured_name: 'Rajesh Kumar',
        owner_manager_id: MANAGER_A_ID,
        status: 'FIELD_INVESTIGATION',
      },
      {
        id: CASE_2_ID,
        agency_id: AGENCY_A,
        claim_no: 'CLM-002',
        insured_name: 'Amit Patel',
        owner_manager_id: MANAGER_A_ID,
        status: 'FIELD_INVESTIGATION',
      },
      {
        id: CASE_AGENCY_B_ID,
        agency_id: AGENCY_B,
        claim_no: 'CLM-B-001',
        insured_name: 'Vikram Singh',
        owner_manager_id: '99999999-9999-9999-9999-999999999999',
        status: 'FIELD_INVESTIGATION',
      }
    );

    // Seed Active Assignments
    db.case_investigators.push(
      {
        id: crypto.randomUUID(),
        agency_id: AGENCY_A,
        case_id: CASE_1_ID,
        investigator_id: INVESTIGATOR_1_ID,
        assignment_scope: 'PRIMARY',
        is_active: true,
        assigned_at: new Date().toISOString(),
      },
      {
        id: crypto.randomUUID(),
        agency_id: AGENCY_A,
        case_id: CASE_2_ID,
        investigator_id: INVESTIGATOR_2_ID,
        assignment_scope: 'PRIMARY',
        is_active: true,
        assigned_at: new Date().toISOString(),
      }
    );
  });

  // ==========================================================================
  // GATE 1: Checksum-Mismatch Rejected
  // ==========================================================================
  it('GATE 1: rejects upload if SHA-256 checksum mismatches expected hash', async () => {
    const mockBuffer = Buffer.from('mock hospital document content');
    const validSha256 = crypto.createHash('sha256').update(mockBuffer).digest('hex');
    const fakeSha256 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    // 1. Initialize upload with expected hash
    const initRes = await evidenceService.initUpload(contextInv1, {
      case_id: CASE_1_ID,
      file_name: 'hospital_admission_sheet.jpg',
      file_size: mockBuffer.length,
      mime_type: 'image/jpeg',
      sha256_hash: validSha256,
      evidence_category: 'HOSPITAL_RECORD',
    });

    expect(initRes.document_id).toBeDefined();
    expect(initRes.storage_key).toContain(CASE_1_ID);

    // 2. Attempt to complete with mismatched SHA-256
    await expect(
      evidenceService.completeUpload(contextInv1, {
        document_id: initRes.document_id,
        actual_sha256: fakeSha256,
        actual_size: mockBuffer.length,
      })
    ).rejects.toThrow(/Checksum mismatch/);

    // 3. Confirm document record is marked REJECTED
    const docRow = db.documents.find((d) => d.id === initRes.document_id);
    expect(docRow?.status).toBe('REJECTED');

    // 4. Verify that complete with matching hash succeeds and marks VERIFIED
    // Seed matching mock storage object
    R2StorageService.setMockObject(
      initRes.storage_key,
      mockBuffer,
      'image/jpeg'
    );

    // Update back to pending for valid retry
    docRow.status = 'PENDING';

    const validComplete = await evidenceService.completeUpload(contextInv1, {
      document_id: initRes.document_id,
      actual_sha256: validSha256,
      actual_size: 1024 * 50,
    });

    expect(validComplete.status).toBe('VERIFIED');
    expect(validComplete.verified_at).toBeDefined();

    // Verify audit log recorded
    const audit = db.audit_logs.find((a) => a.entity_id === initRes.document_id);
    expect(audit).toBeDefined();
    expect(audit.action).toBe('evidence.upload_completed');
  });

  // ==========================================================================
  // GATE 2: Cross-Case and Cross-Agency File Access Denied
  // ==========================================================================
  it('GATE 2: denies cross-agency and out-of-scope cross-case file access', async () => {
    const validSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    // 1. Inv 1 uploads document to Case 1
    const upload = await evidenceService.initUpload(contextInv1, {
      case_id: CASE_1_ID,
      file_name: 'claimant_interview_photo.jpg',
      file_size: 1024 * 100,
      mime_type: 'image/jpeg',
      sha256_hash: validSha256,
      evidence_category: 'FIELD_PHOTO',
    });

    await evidenceService.completeUpload(contextInv1, {
      document_id: upload.document_id,
      actual_sha256: validSha256,
    });

    // 2. Cross-Agency Test: Agency B user tries to access Agency A document
    await expect(
      evidenceService.getDownloadUrl(contextAgencyB, upload.document_id)
    ).rejects.toThrow(/Not Found|Forbidden/);

    // Agency B tries to upload into Agency A's case
    await expect(
      evidenceService.initUpload(contextAgencyB, {
        case_id: CASE_1_ID,
        file_name: 'malicious.jpg',
        file_size: 1024,
        mime_type: 'image/jpeg',
        sha256_hash: validSha256,
      })
    ).rejects.toThrow(/403 Forbidden/);

    // 3. Out-of-Scope Test: Investigator 2 (assigned to Case 2 ONLY) attempts to download Case 1's document
    await expect(
      evidenceService.getDownloadUrl(contextInv2, upload.document_id)
    ).rejects.toThrow(/403 Forbidden/);

    // Investigator 2 attempts to upload into Case 1 (where they are NOT assigned)
    await expect(
      evidenceService.initUpload(contextInv2, {
        case_id: CASE_1_ID,
        file_name: 'unassigned_photo.jpg',
        file_size: 1024,
        mime_type: 'image/jpeg',
        sha256_hash: validSha256,
      })
    ).rejects.toThrow(/403 Forbidden/);

    // 4. Authorized Access: Investigator 1 and Manager A CAN download
    const inv1Download = await evidenceService.getDownloadUrl(contextInv1, upload.document_id);
    expect(inv1Download.download_url).toBeDefined();

    const managerDownload = await evidenceService.getDownloadUrl(contextManagerA, upload.document_id);
    expect(managerDownload.download_url).toBeDefined();
  });

  // ==========================================================================
  // GATE 3: Presigned URLs Expire
  // ==========================================================================
  it('GATE 3: enforces 10-minute expiry for PUT and 5-minute expiry for GET', async () => {
    const validSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    // 1. Presigned PUT URL must expire in 600s (10 min) per Rule A8
    const uploadInit = await evidenceService.initUpload(contextInv1, {
      case_id: CASE_1_ID,
      file_name: 'prescription.pdf',
      file_size: 1024 * 500,
      mime_type: 'application/pdf',
      sha256_hash: validSha256,
    });

    expect(uploadInit.expires_in_seconds).toBe(600);
    expect(uploadInit.upload_url).toContain('expires_in=600');

    await evidenceService.completeUpload(contextInv1, {
      document_id: uploadInit.document_id,
      actual_sha256: validSha256,
    });

    // 2. Presigned GET URL must expire in 300s (5 min) per Rule A8
    const download = await evidenceService.getDownloadUrl(contextInv1, uploadInit.document_id);
    expect(download.expires_in_seconds).toBe(300);
    expect(download.download_url).toContain('expires_in=300');
  });

  // ==========================================================================
  // GATE 4: Investigator Cannot See Unassigned Cases
  // ==========================================================================
  it('GATE 4: ensures investigator with ASSIGNED scope sees strictly assigned cases', async () => {
    // Check Case 1 (assigned to Inv 1)
    const canInv1AccessCase1 = await evidenceService.canUserAccessCase(contextInv1, CASE_1_ID);
    expect(canInv1AccessCase1).toBe(true);

    // Check Case 2 (assigned to Inv 2, NOT Inv 1)
    const canInv1AccessCase2 = await evidenceService.canUserAccessCase(contextInv1, CASE_2_ID);
    expect(canInv1AccessCase2).toBe(false);

    // Check Case 2 access for Inv 2 (should be true)
    const canInv2AccessCase2 = await evidenceService.canUserAccessCase(contextInv2, CASE_2_ID);
    expect(canInv2AccessCase2).toBe(true);

    // Listing documents for Case 2 by Inv 1 MUST throw 403
    await expect(
      evidenceService.listDocumentsForCase(contextInv1, CASE_2_ID)
    ).rejects.toThrow(/403 Forbidden/);

    // Listing activities for Case 2 by Inv 1 MUST throw 403
    await expect(
      evidenceService.listActivitiesForCase(contextInv1, CASE_2_ID)
    ).rejects.toThrow(/403 Forbidden/);
  });

  // ==========================================================================
  // GATE 5: Queue Survives App Restart
  // ==========================================================================
  it('GATE 5: verifies offline upload queue persists across app restarts and resumes', async () => {
    const persistentAdapter = new InMemoryPersistentStorage();

    // 1. Session 1: Enqueue files while offline
    const session1Queue = new OfflineUploadQueue({
      storageAdapter: persistentAdapter,
    });

    await session1Queue.enqueue({
      case_id: CASE_1_ID,
      file_name: 'offline_spot_1.jpg',
      file_size: 1024 * 200,
      mime_type: 'image/jpeg',
      sha256_hash: '1111111111111111111111111111111111111111111111111111111111111111',
      evidence_category: 'FIELD_PHOTO',
      blobData: 'data:image/jpeg;base64,mockdata1',
    });

    await session1Queue.enqueue({
      case_id: CASE_1_ID,
      file_name: 'offline_spot_2.jpg',
      file_size: 1024 * 350,
      mime_type: 'image/jpeg',
      sha256_hash: '2222222222222222222222222222222222222222222222222222222222222222',
      evidence_category: 'FIELD_PHOTO',
      blobData: 'data:image/jpeg;base64,mockdata2',
    });

    const session1Items = await session1Queue.getItems();
    expect(session1Items.length).toBe(2);
    expect(session1Items[0].status).toBe('QUEUED');

    // 2. SIMULATE APP RESTART: Destroy session 1, instantiate fresh Session 2 from same store
    const executedUploads: string[] = [];
    const session2Queue = new OfflineUploadQueue({
      storageAdapter: persistentAdapter,
      uploadExecutor: async (item) => {
        executedUploads.push(item.file_name);
        return { success: true, documentId: crypto.randomUUID() };
      },
    });

    // Verify items survived restart
    const restoredItems = await session2Queue.load();
    expect(restoredItems.length).toBe(2);
    expect(restoredItems[0].file_name).toBe('offline_spot_1.jpg');
    expect(restoredItems[1].file_name).toBe('offline_spot_2.jpg');

    // 3. Process queue in Session 2 (resuming offline queue)
    const result = await session2Queue.processQueue();
    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(executedUploads).toEqual(['offline_spot_1.jpg', 'offline_spot_2.jpg']);

    const finishedItems = await session2Queue.getItems();
    expect(finishedItems[0].status).toBe('COMPLETED');
    expect(finishedItems[0].progress).toBe(100);
    expect(finishedItems[1].status).toBe('COMPLETED');
  });

  // ==========================================================================
  // GATE 6: Cleanup Cron Works
  // ==========================================================================
  it('GATE 6: prunes stale pending uploads older than threshold and preserves verified uploads', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    // 1. Insert 2 stale pending uploads
    const staleDoc1 = {
      id: crypto.randomUUID(),
      agency_id: AGENCY_A,
      case_id: CASE_1_ID,
      uploaded_by: INVESTIGATOR_1_ID,
      storage_key: `a/${AGENCY_A}/c/${CASE_1_ID}/stale_1`,
      file_name: 'stale_abandoned_1.jpg',
      file_size: 1024,
      mime_type: 'image/jpeg',
      sha256_hash: '3333333333333333333333333333333333333333333333333333333333333333',
      status: 'PENDING',
      evidence_category: 'FIELD_PHOTO',
      version: 1,
      is_sensitive: false,
      created_at: threeHoursAgo,
    };

    const staleDoc2 = {
      id: crypto.randomUUID(),
      agency_id: AGENCY_A,
      case_id: CASE_1_ID,
      uploaded_by: INVESTIGATOR_1_ID,
      storage_key: `a/${AGENCY_A}/c/${CASE_1_ID}/stale_2`,
      file_name: 'stale_abandoned_2.jpg',
      file_size: 2048,
      mime_type: 'image/jpeg',
      sha256_hash: '4444444444444444444444444444444444444444444444444444444444444444',
      status: 'PENDING',
      evidence_category: 'FIELD_PHOTO',
      version: 1,
      is_sensitive: false,
      created_at: threeHoursAgo,
    };

    // 2. Insert 1 recent pending upload (10 mins old)
    const recentDoc = {
      id: crypto.randomUUID(),
      agency_id: AGENCY_A,
      case_id: CASE_1_ID,
      uploaded_by: INVESTIGATOR_1_ID,
      storage_key: `a/${AGENCY_A}/c/${CASE_1_ID}/recent`,
      file_name: 'recent_upload.jpg',
      file_size: 1024,
      mime_type: 'image/jpeg',
      sha256_hash: '5555555555555555555555555555555555555555555555555555555555555555',
      status: 'PENDING',
      evidence_category: 'FIELD_PHOTO',
      version: 1,
      is_sensitive: false,
      created_at: tenMinutesAgo,
    };

    // 3. Insert 1 verified upload
    const verifiedDoc = {
      id: crypto.randomUUID(),
      agency_id: AGENCY_A,
      case_id: CASE_1_ID,
      uploaded_by: INVESTIGATOR_1_ID,
      storage_key: `a/${AGENCY_A}/c/${CASE_1_ID}/verified`,
      file_name: 'verified_evidence.jpg',
      file_size: 4096,
      mime_type: 'image/jpeg',
      sha256_hash: '6666666666666666666666666666666666666666666666666666666666666666',
      status: 'VERIFIED',
      evidence_category: 'HOSPITAL_RECORD',
      version: 1,
      is_sensitive: false,
      created_at: threeHoursAgo,
    };

    db.documents.push(staleDoc1, staleDoc2, recentDoc, verifiedDoc);

    // Run cleanup cron (threshold = 2 hours)
    const cleanupResult = await evidenceService.cleanupStalePendingUploads(2);

    expect(cleanupResult.pruned_count).toBe(2);
    expect(cleanupResult.pruned_documents.map((d) => d.id)).toContain(staleDoc1.id);
    expect(cleanupResult.pruned_documents.map((d) => d.id)).toContain(staleDoc2.id);

    // Confirm that recent pending upload is STILL present
    const remainingRecent = db.documents.find((d) => d.id === recentDoc.id);
    expect(remainingRecent).toBeDefined();

    // Confirm that verified upload is STILL present
    const remainingVerified = db.documents.find((d) => d.id === verifiedDoc.id);
    expect(remainingVerified).toBeDefined();
  });

  // ==========================================================================
  // INVESTIGATION ACTIVITIES LIFECYCLE
  // ==========================================================================
  it('manages full investigation activity lifecycle across all activity types', async () => {
    // 1. Create a Hospital Verification activity
    const activity = await evidenceService.createActivity(contextInv1, {
      case_id: CASE_1_ID,
      activity_type: 'HOSPITAL_VERIFICATION',
      task_title: 'Inspect Indoor Patient Register & Billing Ledger',
      instructions: 'Cross-check entry #418 with casualty register; speak to billing clerk.',
      assigned_to_id: INVESTIGATOR_1_ID,
      due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });

    expect(activity.id).toBeDefined();
    expect(activity.status).toBe('PENDING');

    // 2. Update activity to IN_PROGRESS
    const inProgress = await evidenceService.updateActivity(contextInv1, activity.id, {
      status: 'IN_PROGRESS',
      notes: 'Investigator arrived at City Care Hospital.',
    });

    expect(inProgress.status).toBe('IN_PROGRESS');
    expect(inProgress.notes).toContain('City Care Hospital');

    // 3. Mark Activity Completed with mandatory notes
    const completed = await evidenceService.completeActivity(
      contextInv1,
      activity.id,
      'Verified IPD page 12. Admission confirmed genuine; bill receipts matched pharmacy stamp.'
    );

    expect(completed.status).toBe('COMPLETED');
    expect(completed.completed_at).toBeDefined();
    expect(completed.completion_notes).toContain('Verified IPD page 12');

    // 4. Verify list activities for case
    const caseActivities = await evidenceService.listActivitiesForCase(contextInv1, CASE_1_ID);
    expect(caseActivities.length).toBe(1);
    expect(caseActivities[0].status).toBe('COMPLETED');
  });

  // ==========================================================================
  // DOCUMENT VERSIONING & SOFT DELETE
  // ==========================================================================
  it('supports document versioning and enforces soft delete with mandatory reason', async () => {
    const validSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    // 1. Upload initial version 1
    const v1 = await evidenceService.initUpload(contextInv1, {
      case_id: CASE_1_ID,
      file_name: 'claimant_statement.pdf',
      file_size: 1024 * 100,
      mime_type: 'application/pdf',
      sha256_hash: validSha256,
      evidence_category: 'WITNESS_STATEMENT',
    });

    await evidenceService.completeUpload(contextInv1, {
      document_id: v1.document_id,
      actual_sha256: validSha256,
    });

    const docV1 = db.documents.find((d) => d.id === v1.document_id);
    expect(docV1.version).toBe(1);

    // 2. Upload replacement version 2 pointing to parent
    const v2 = await evidenceService.initUpload(contextInv1, {
      case_id: CASE_1_ID,
      file_name: 'claimant_statement_corrected.pdf',
      file_size: 1024 * 120,
      mime_type: 'application/pdf',
      sha256_hash: validSha256,
      evidence_category: 'WITNESS_STATEMENT',
      parent_document_id: v1.document_id,
    });

    const docV2 = db.documents.find((d) => d.id === v2.document_id);
    expect(docV2.version).toBe(2);
    expect(docV2.parent_document_id).toBe(v1.document_id);

    // 3. Soft Delete Document
    const delResult = await evidenceService.deleteDocument(
      contextInv1,
      v2.document_id,
      'Replaced by signed notary affidavit'
    );

    expect(delResult.success).toBe(true);

    const deletedDoc = db.documents.find((d) => d.id === v2.document_id);
    expect(deletedDoc.deleted_at).toBeDefined();
    expect(deletedDoc.deleted_by).toBe(INVESTIGATOR_1_ID);
    expect(deletedDoc.delete_reason).toBe('Replaced by signed notary affidavit');

    // 4. Verify that soft-deleted document does not appear in active case list
    const activeDocs = await evidenceService.listDocumentsForCase(contextInv1, CASE_1_ID);
    expect(activeDocs.some((d) => d.id === v2.document_id)).toBe(false);
  });
});
