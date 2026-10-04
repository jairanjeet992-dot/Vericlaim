import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  SearchEngine,
  calculateTrigramSimilarity,
  IndexedCaseRecord,
} from '@/modules/search';
import {
  calculateOperationalMetrics,
  calculateFinancialMetrics,
  calculatePhysicalLogisticsMetrics,
  ExportService,
  CaseReportingRecord,
  InvoiceReportingRecord,
  PaymentReportingRecord,
  DirectCostReportingRecord,
} from '@/modules/reports';
import {
  NotificationEngine,
  MockEmailProvider,
  StubSmsProvider,
  StubWhatsAppProvider,
} from '@/modules/notifications';
import { computeBlindIndex } from '@/lib/security/encryption';

describe('Phase 9A Verification Gates: Search, Reports, Exports, Notifications', () => {
  const AGENCY_A = '11111111-1111-1111-1111-111111111111';
  const AGENCY_B = '22222222-2222-2222-2222-222222222222';

  const MANAGER_1 = 'm1111111-1111-1111-1111-111111111111';
  const MANAGER_2 = 'm2222222-2222-2222-2222-222222222222';
  const DATA_ENTRY_USER = 'd1111111-1111-1111-1111-111111111111';
  const INVESTIGATOR_1 = 'i1111111-1111-1111-1111-111111111111';

  let emailProvider: MockEmailProvider;
  let smsProvider: StubSmsProvider;
  let whatsAppProvider: StubWhatsAppProvider;
  let notificationEngine: NotificationEngine;
  let exportService: ExportService;

  beforeEach(() => {
    emailProvider = new MockEmailProvider();
    smsProvider = new StubSmsProvider();
    whatsAppProvider = new StubWhatsAppProvider();
    notificationEngine = new NotificationEngine(undefined, {
      email: emailProvider,
      sms: smsProvider,
      whatsApp: whatsAppProvider,
    });
    exportService = new ExportService();
  });

  // =========================================================================
  // GATE 1: SEARCH UNDER 300MS ON 100K SIMULATED INDEXED CASES
  // =========================================================================
  describe('Gate 1: High-Performance Global Search Benchmark', () => {
    it('executes search across 100,000 indexed cases in strictly under 300ms', () => {
      // 1. Generate 100,000 simulated indexed cases
      const dataset: IndexedCaseRecord[] = [];
      const indexMap = new Map<string, IndexedCaseRecord[]>();

      const cities = ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Ujjain', 'Rewa', 'Satna', 'Sagar'];
      const hospitals = ['Bansal Hospital', 'Chirayu Hospital', 'AIIMS Bhopal', 'Bombay Hospital', 'Care Hospital'];

      for (let i = 0; i < 100000; i++) {
        const docCode = `OCT26-${String(i).padStart(6, '0')}`;
        const claimNo = `CLM-2026-${String(i).padStart(6, '0')}`;
        const policyNo = `POL-99-${String(i).padStart(6, '0')}`;
        const phone = `9826${String(i).padStart(6, '0')}`;
        const phoneBlindIndex = computeBlindIndex(phone);

        const rec: IndexedCaseRecord = {
          id: `case-${i}`,
          agency_id: AGENCY_A,
          doc_code: docCode,
          claim_no: claimNo,
          normalized_claim_no: claimNo,
          policy_no: policyNo,
          insured_name: `Insured Patient ${i}`,
          location_city: cities[i % cities.length],
          location_state: 'Madhya Pradesh',
          hospital_name: hospitals[i % hospitals.length],
          status: i % 2 === 0 ? 'ASSIGNED' : 'APPROVED',
          outcome: 'GENUINE',
          owner_manager_id: i % 2 === 0 ? MANAGER_1 : MANAGER_2,
          data_entry_user_id: DATA_ENTRY_USER,
          assigned_investigator_ids: [INVESTIGATOR_1],
          insured_phone_blind_index: phoneBlindIndex,
          created_at: new Date().toISOString(),
        };

        dataset.push(rec);

        // Fast hash index map on claim_no, doc_code & phone_blind_index
        if (!indexMap.has(claimNo)) indexMap.set(claimNo, []);
        indexMap.get(claimNo)!.push(rec);
        if (!indexMap.has(docCode)) indexMap.set(docCode, []);
        indexMap.get(docCode)!.push(rec);
        if (!indexMap.has(phoneBlindIndex)) indexMap.set(phoneBlindIndex, []);
        indexMap.get(phoneBlindIndex)!.push(rec);
      }

      expect(dataset.length).toBe(100000);

      const searchEngine = new SearchEngine();

      // Test Query 1: Exact Claim Number lookup
      const t1Start = performance.now();
      const res1 = searchEngine.searchIndexedDataset(
        dataset,
        {
          agency_id: AGENCY_A,
          query: 'CLM-2026-054321',
          actor_user_id: MANAGER_1,
          caller_scope: 'ALL',
        },
        indexMap
      );
      const t1Duration = performance.now() - t1Start;

      expect(res1.results.length).toBeGreaterThan(0);
      expect(res1.results[0].subtitle).toContain('CLM-2026-054321');
      expect(t1Duration).toBeLessThan(300); // GATE 1 PASSED: strictly < 300ms!

      // Test Query 2: Exact Doc Code lookup
      const t2Start = performance.now();
      const res2 = searchEngine.searchIndexedDataset(
        dataset,
        {
          agency_id: AGENCY_A,
          query: 'OCT26-099999',
          actor_user_id: MANAGER_1,
          caller_scope: 'ALL',
        },
        indexMap
      );
      const t2Duration = performance.now() - t2Start;

      expect(res2.results.length).toBeGreaterThan(0);
      expect(res2.results[0].doc_code).toBe('OCT26-099999');
      expect(t2Duration).toBeLessThan(300); // GATE 1 PASSED

      // Test Query 3: Phone Blind Index lookup
      const targetPhone = '9826012345';
      const t3Start = performance.now();
      const res3 = searchEngine.searchIndexedDataset(
        dataset,
        {
          agency_id: AGENCY_A,
          query: targetPhone,
          actor_user_id: MANAGER_1,
          caller_scope: 'ALL',
        },
        indexMap
      );
      const t3Duration = performance.now() - t3Start;

      expect(res3.results.length).toBeGreaterThan(0);
      expect(res3.results[0].entity_id).toBe('case-12345');
      expect(t3Duration).toBeLessThan(300); // GATE 1 PASSED
    });

    it('accurately computes character trigram similarity scores', () => {
      const sim1 = calculateTrigramSimilarity('NATIONAL INSURANCE', 'NATIONAL INSURANCE');
      expect(sim1).toBe(1.0);

      const sim2 = calculateTrigramSimilarity('HDFC ERGO', 'HDFC ERGO GENERAL');
      expect(sim2).toBeGreaterThan(0.5);

      const sim3 = calculateTrigramSimilarity('BHOPAL', 'MUMBAI');
      expect(sim3).toBeLessThan(0.3);
    });
  });

  // =========================================================================
  // GATE 2: NO OUT-OF-SCOPE LEAKAGE (TWO MANAGERS WITH SEPARATE SCOPES TEST)
  // =========================================================================
  describe('Gate 2: Strict Scope Isolation on Global Search', () => {
    const testCases: IndexedCaseRecord[] = [
      {
        id: 'c1',
        agency_id: AGENCY_A,
        doc_code: 'OCT26-0001',
        claim_no: 'CLM-M1-001',
        normalized_claim_no: 'CLM-M1-001',
        policy_no: 'POL-100',
        insured_name: 'Rajesh Sharma',
        location_city: 'Bhopal',
        location_state: 'MP',
        hospital_name: 'Bansal Hospital',
        status: 'ASSIGNED',
        outcome: 'PENDING',
        owner_manager_id: MANAGER_1, // Manager 1
        data_entry_user_id: DATA_ENTRY_USER,
        assigned_investigator_ids: [INVESTIGATOR_1],
        created_at: new Date().toISOString(),
      },
      {
        id: 'c2',
        agency_id: AGENCY_A,
        doc_code: 'OCT26-0002',
        claim_no: 'CLM-M1-002',
        normalized_claim_no: 'CLM-M1-002',
        policy_no: 'POL-101',
        insured_name: 'Amit Verma',
        location_city: 'Indore',
        location_state: 'MP',
        hospital_name: 'Care Hospital',
        status: 'IN_PROGRESS',
        outcome: 'PENDING',
        owner_manager_id: MANAGER_1, // Manager 1
        data_entry_user_id: DATA_ENTRY_USER,
        assigned_investigator_ids: [INVESTIGATOR_1],
        created_at: new Date().toISOString(),
      },
      {
        id: 'c3',
        agency_id: AGENCY_A,
        doc_code: 'OCT26-0003',
        claim_no: 'CLM-M2-003',
        normalized_claim_no: 'CLM-M2-003',
        policy_no: 'POL-200',
        insured_name: 'Sunil Gupta',
        location_city: 'Jabalpur',
        location_state: 'MP',
        hospital_name: 'City Hospital',
        status: 'APPROVED',
        outcome: 'GENUINE',
        owner_manager_id: MANAGER_2, // Manager 2
        data_entry_user_id: 'other-data-entry',
        assigned_investigator_ids: ['other-investigator'],
        created_at: new Date().toISOString(),
      },
      {
        id: 'c4',
        agency_id: AGENCY_A,
        doc_code: 'OCT26-0004',
        claim_no: 'CLM-M2-004',
        normalized_claim_no: 'CLM-M2-004',
        policy_no: 'POL-201',
        insured_name: 'Vikram Patel',
        location_city: 'Gwalior',
        location_state: 'MP',
        hospital_name: 'Apollo Hospital',
        status: 'CLOSED',
        outcome: 'FRAUD',
        owner_manager_id: MANAGER_2, // Manager 2
        data_entry_user_id: 'other-data-entry',
        assigned_investigator_ids: ['other-investigator'],
        created_at: new Date().toISOString(),
      },
    ];

    it('ensures Manager 1 sees ONLY Manager 1 cases under TEAM scope (Zero leakage of Manager 2 cases)', () => {
      const searchEngine = new SearchEngine();

      const m1Search = searchEngine.searchIndexedDataset(testCases, {
        agency_id: AGENCY_A,
        query: 'CLM', // Matches all 4 claims
        actor_user_id: MANAGER_1,
        caller_scope: 'TEAM',
        subordinate_user_ids: [],
      });

      // M1 must only see c1 and c2!
      expect(m1Search.results.length).toBe(2);
      expect(m1Search.results.map((r) => r.entity_id)).toEqual(['c1', 'c2']);
      expect(m1Search.results.find((r) => r.entity_id === 'c3')).toBeUndefined();
      expect(m1Search.results.find((r) => r.entity_id === 'c4')).toBeUndefined();
    });

    it('ensures Manager 2 sees ONLY Manager 2 cases under TEAM scope (Zero leakage of Manager 1 cases)', () => {
      const searchEngine = new SearchEngine();

      const m2Search = searchEngine.searchIndexedDataset(testCases, {
        agency_id: AGENCY_A,
        query: 'CLM', // Matches all 4 claims
        actor_user_id: MANAGER_2,
        caller_scope: 'TEAM',
        subordinate_user_ids: [],
      });

      // M2 must only see c3 and c4!
      expect(m2Search.results.length).toBe(2);
      expect(m2Search.results.map((r) => r.entity_id)).toEqual(['c3', 'c4']);
      expect(m2Search.results.find((r) => r.entity_id === 'c1')).toBeUndefined();
      expect(m2Search.results.find((r) => r.entity_id === 'c2')).toBeUndefined();
    });

    it('ensures Investigator sees ONLY assigned cases under ASSIGNED scope', () => {
      const searchEngine = new SearchEngine();

      const invSearch = searchEngine.searchIndexedDataset(testCases, {
        agency_id: AGENCY_A,
        query: 'MP', // Location match
        actor_user_id: INVESTIGATOR_1,
        caller_scope: 'ASSIGNED',
      });

      // Only c1 and c2 are assigned to INVESTIGATOR_1
      expect(invSearch.results.length).toBe(2);
      expect(invSearch.results.map((r) => r.entity_id)).toEqual(['c1', 'c2']);
    });

    it('ensures Data Entry user sees ONLY own entered cases under OWN_ENTERED scope', () => {
      const searchEngine = new SearchEngine();

      const deSearch = searchEngine.searchIndexedDataset(testCases, {
        agency_id: AGENCY_A,
        query: 'Hospital',
        actor_user_id: DATA_ENTRY_USER,
        caller_scope: 'OWN_ENTERED',
      });

      expect(deSearch.results.length).toBe(2);
      expect(deSearch.results.map((r) => r.entity_id)).toEqual(['c1', 'c2']);
    });

    it('rejects cross-tenant data across separate agency IDs', () => {
      const searchEngine = new SearchEngine();

      const crossTenantSearch = searchEngine.searchIndexedDataset(testCases, {
        agency_id: AGENCY_B, // Agency B caller
        query: 'Sharma',
        actor_user_id: 'some-user',
        caller_scope: 'ALL',
      });

      expect(crossTenantSearch.results.length).toBe(0);
    });
  });

  // =========================================================================
  // GATE 3: EXPORTS STRICTLY RESPECT USER SCOPE
  // =========================================================================
  describe('Gate 3: Scope-Filtered Exports', () => {
    const rawExportRows = [
      { doc_code: 'OCT26-001', claim_no: 'CLM-1', owner_manager_id: MANAGER_1, data_entry_user_id: DATA_ENTRY_USER, assigned_investigator_id: INVESTIGATOR_1 },
      { doc_code: 'OCT26-002', claim_no: 'CLM-2', owner_manager_id: MANAGER_1, data_entry_user_id: DATA_ENTRY_USER, assigned_investigator_id: INVESTIGATOR_1 },
      { doc_code: 'OCT26-003', claim_no: 'CLM-3', owner_manager_id: MANAGER_2, data_entry_user_id: 'other-de', assigned_investigator_id: 'other-inv' },
      { doc_code: 'OCT26-004', claim_no: 'CLM-4', owner_manager_id: MANAGER_2, data_entry_user_id: 'other-de', assigned_investigator_id: 'other-inv' },
    ];

    it('filters out-of-scope rows when Manager 1 exports data', async () => {
      const result = await exportService.export({
        agency_id: AGENCY_A,
        user_id: MANAGER_1,
        user_permissions: ['reports.export'],
        user_scope: 'TEAM',
        subordinate_user_ids: [],
        export_type: 'CASES_LIST',
        format: 'CSV',
        data: {
          title: 'Cases Export',
          columns: [
            { header: 'Doc Code', key: 'doc_code' },
            { header: 'Claim No', key: 'claim_no' },
          ],
          rows: rawExportRows,
        },
      });

      expect(result.row_count).toBe(2);
      const csvContent = result.buffer.toString('utf-8');
      expect(csvContent).toContain('OCT26-001');
      expect(csvContent).toContain('OCT26-002');
      expect(csvContent).not.toContain('OCT26-003');
      expect(csvContent).not.toContain('OCT26-004');
    });

    it('filters out-of-scope rows when Investigator exports data', async () => {
      const result = await exportService.export({
        agency_id: AGENCY_A,
        user_id: INVESTIGATOR_1,
        user_permissions: ['reports.export'],
        user_scope: 'ASSIGNED',
        export_type: 'CASES_LIST',
        format: 'CSV',
        data: {
          title: 'Assigned Cases',
          columns: [{ header: 'Doc Code', key: 'doc_code' }],
          rows: rawExportRows,
        },
      });

      expect(result.row_count).toBe(2);
      const csvContent = result.buffer.toString('utf-8');
      expect(csvContent).toContain('OCT26-001');
      expect(csvContent).not.toContain('OCT26-003');
    });

    it('exports all rows when Agency Admin with ALL scope exports data', async () => {
      const result = await exportService.export({
        agency_id: AGENCY_A,
        user_id: 'admin-user',
        user_permissions: ['reports.export'],
        user_scope: 'ALL',
        export_type: 'CASES_LIST',
        format: 'EXCEL',
        data: {
          title: 'All Agency Cases',
          columns: [{ header: 'Doc Code', key: 'doc_code' }],
          rows: rawExportRows,
        },
      });

      expect(result.row_count).toBe(4);
      expect(result.sha256).toBeDefined();
      expect(result.sha256.length).toBe(64);
    });
  });

  // =========================================================================
  // GATE 4: EXPORT ATTEMPTS AUDITED IN EXPORT_LOGS (SUCCESS & DENIAL)
  // =========================================================================
  describe('Gate 4: Export Auditing & Permission Enforcement', () => {
    it('strictly denies export and audits unauthorized attempt when user lacks reports.export permission', async () => {
      let loggedAudit: any = null;
      const auditedExportService = new ExportService();
      auditedExportService.logExportAttempt = async (entry: any) => {
        loggedAudit = entry;
        return 'audit-log-123';
      };

      await expect(
        auditedExportService.export({
          agency_id: AGENCY_A,
          user_id: 'unauthorized-user',
          user_permissions: ['cases.view'], // Missing reports.export!
          user_scope: 'ALL',
          export_type: 'FINANCIAL',
          format: 'EXCEL',
          data: {
            title: 'Financial Summary',
            columns: [{ header: 'Col', key: 'col' }],
            rows: [],
          },
        })
      ).rejects.toThrow('Unauthorized: User lacks required reports.export permission');

      // Verify audit trail recorded denial!
      expect(loggedAudit).not.toBeNull();
      expect(loggedAudit.status).toBe('DENIED');
      expect(loggedAudit.denial_reason).toBe('User lacks reports.export permission');
      expect(loggedAudit.row_count).toBe(0);
      expect(loggedAudit.export_type).toBe('FINANCIAL');
      expect(loggedAudit.format).toBe('EXCEL');
    });

    it('audits successful export with row count, format, and SHA-256 integrity hash', async () => {
      let loggedAudit: any = null;
      const auditedExportService = new ExportService();
      auditedExportService.logExportAttempt = async (entry: any) => {
        loggedAudit = entry;
        return 'audit-log-456';
      };

      const result = await auditedExportService.export({
        agency_id: AGENCY_A,
        user_id: MANAGER_1,
        user_permissions: ['reports.export'],
        user_scope: 'ALL',
        export_type: 'INVOICES_LIST',
        format: 'PDF',
        data: {
          title: 'Invoices Export',
          columns: [
            { header: 'Invoice #', key: 'inv_no' },
            { header: 'Amount', key: 'amount' },
          ],
          rows: [
            { inv_no: 'INV-001', amount: '₹10,000' },
            { inv_no: 'INV-002', amount: '₹15,000' },
          ],
        },
      });

      expect(result.log_id).toBe('audit-log-456');
      expect(loggedAudit).not.toBeNull();
      expect(loggedAudit.status).toBe('COMPLETED');
      expect(loggedAudit.row_count).toBe(2);
      expect(loggedAudit.sha256).toBe(result.sha256);
      expect(loggedAudit.format).toBe('PDF');
    });
  });

  // =========================================================================
  // GATE 5: MULTI-CHANNEL NOTIFICATIONS DISPATCHED ON LIFECYCLE EVENTS
  // =========================================================================
  describe('Gate 5: Multi-Channel Lifecycle Notifications', () => {
    it('dispatches multi-channel notification for CASE_ASSIGNED', async () => {
      const results = await notificationEngine.notifyCaseAssigned({
        agency_id: AGENCY_A,
        investigator_user_id: INVESTIGATOR_1,
        case_id: 'case-999',
        doc_code: 'OCT26-0999',
        insured_name: 'Priya Sharma',
        location_city: 'Indore',
      });

      expect(results.length).toBe(3); // IN_APP, EMAIL, SMS_STUB
      expect(results.find((r) => r.channel === 'IN_APP')?.status).toBe('DELIVERED');
      expect(results.find((r) => r.channel === 'EMAIL')?.status).toBe('DELIVERED');
      expect(results.find((r) => r.channel === 'SMS_STUB')?.status).toBe('STUBBED'); // Rule A11 Stub

      // Verify email was captured by EmailProvider
      expect(emailProvider.sentEmails.length).toBe(1);
      expect(emailProvider.sentEmails[0].subject).toContain('New Case Assigned: OCT26-0999');

      // Verify SMS was logged by StubSmsProvider
      expect(smsProvider.sentMessages.length).toBe(1);
      expect(smsProvider.sentMessages[0].message).toContain('OCT26-0999');

      // Verify In-App unread notification
      const unread = await notificationEngine.getUserNotifications(AGENCY_A, INVESTIGATOR_1, true);
      expect(unread.length).toBe(1);
      expect(unread[0].title).toContain('OCT26-0999');
      expect(unread[0].is_read).toBe(false);
    });

    it('dispatches escalated rework notification when rework_count >= 3', async () => {
      const results = await notificationEngine.notifyReworkRequested({
        agency_id: AGENCY_A,
        assignee_user_id: INVESTIGATOR_1,
        case_id: 'case-777',
        doc_code: 'OCT26-0777',
        rework_count: 3, // Escalated threshold!
        reason_category: 'INCOMPLETE_FINDINGS',
        instructions: 'Hospital indoor patient case sheet is missing stamps',
      });

      expect(results.length).toBe(3); // IN_APP, EMAIL, WHATSAPP_STUB
      const inApp = (await notificationEngine.getUserNotifications(AGENCY_A, INVESTIGATOR_1, false))[0];
      expect(inApp.priority).toBe('URGENT'); // Rule A8/A12 Auto-escalation priority!
      expect(inApp.title).toContain('🚨 ESCALATED Rework Requested');

      // Verify WhatsApp Stub logged
      expect(whatsAppProvider.sentMessages.length).toBe(1);
      expect(whatsAppProvider.sentMessages[0].template).toBe('lifecycle_alert');
    });

    it('dispatches SLA warning notification with URGENT priority on SLA breach', async () => {
      const results = await notificationEngine.notifySlaWarning({
        agency_id: AGENCY_A,
        user_id: MANAGER_1,
        case_id: 'case-555',
        doc_code: 'OCT26-0555',
        sla_status: 'BREACHED',
      });

      expect(results.length).toBe(3);
      const inApp = (await notificationEngine.getUserNotifications(AGENCY_A, MANAGER_1, false))[0];
      expect(inApp.priority).toBe('URGENT');
      expect(inApp.title).toContain('⚠️ SLA BREACHED');
    });

    it('manages read / unread states and mark-all-read', async () => {
      // Dispatch 2 notifications
      await notificationEngine.dispatch({
        agency_id: AGENCY_A,
        user_id: MANAGER_2,
        title: 'Notif 1',
        message: 'Message 1',
        notification_type: 'CUSTOM',
      });
      await notificationEngine.dispatch({
        agency_id: AGENCY_A,
        user_id: MANAGER_2,
        title: 'Notif 2',
        message: 'Message 2',
        notification_type: 'CUSTOM',
      });

      let unread = await notificationEngine.getUserNotifications(AGENCY_A, MANAGER_2, true);
      expect(unread.length).toBe(2);

      // Mark single read
      await notificationEngine.markAsRead(AGENCY_A, MANAGER_2, [unread[0].id]);
      unread = await notificationEngine.getUserNotifications(AGENCY_A, MANAGER_2, true);
      expect(unread.length).toBe(1);

      // Mark all read
      await notificationEngine.markAllAsRead(AGENCY_A, MANAGER_2);
      unread = await notificationEngine.getUserNotifications(AGENCY_A, MANAGER_2, true);
      expect(unread.length).toBe(0);
    });
  });

  // =========================================================================
  // GATE 6: STATUTORY GST SEPARATION & PROFIT ENGINE (Q-CA-01, RULE A1/A6/A12)
  // =========================================================================
  describe('Gate 6: Statutory GST Separation & Profit Engine', () => {
    it('strictly separates output GST from service revenue and calculates gross profit correctly', () => {
      // Golden Test Scenario:
      // Invoice 1: Taxable ₹10,000, 18% IGST ₹1,800, Total Gross ₹11,800.
      // Invoice 2: Taxable ₹20,000, 9% CGST ₹1,800 + 9% SGST ₹1,800, Total Gross ₹23,600.
      // Direct Costs: Investigator Fees ₹12,000, Approved TA/Expenses ₹3,000 = Total ₹15,000.
      // Overhead: ₹5,000.
      const invoices: InvoiceReportingRecord[] = [
        {
          id: 'inv-1',
          agency_id: AGENCY_A,
          invoice_number: 'INV-2026-001',
          status: 'ISSUED',
          issue_date: '2026-10-01',
          taxable_amount: 10000.0,
          cgst_amount: 0.0,
          sgst_amount: 0.0,
          igst_amount: 1800.0,
          total_amount: 11800.0,
          outstanding_amount: 11800.0,
        },
        {
          id: 'inv-2',
          agency_id: AGENCY_A,
          invoice_number: 'INV-2026-002',
          status: 'PAID',
          issue_date: '2026-09-15',
          taxable_amount: 20000.0,
          cgst_amount: 1800.0,
          sgst_amount: 1800.0,
          igst_amount: 0.0,
          total_amount: 23600.0,
          outstanding_amount: 0.0,
        },
      ];

      const directCosts: DirectCostReportingRecord[] = [
        { investigator_id: INVESTIGATOR_1, case_fees_payable: 12000.0, approved_expenses: 3000.0 },
      ];

      const payments: PaymentReportingRecord[] = [
        { id: 'pay-1', agency_id: AGENCY_A, amount: 23600.0, unapplied_amount: 0.0, payment_date: '2026-09-20' },
      ];

      const finMetrics = calculateFinancialMetrics(invoices, payments, directCosts, 5000.0);

      // Gross Invoiced: 11,800 + 23,600 = 35,400
      expect(finMetrics.total_billed_gross).toBe(35400.0);

      // Taxable Base (Service Revenue): 10,000 + 20,000 = 30,000 (NOT 35,400!)
      expect(finMetrics.total_billed_taxable).toBe(30000.0);
      expect(finMetrics.profitability.net_service_revenue).toBe(30000.0);

      // Output GST Collected: 1,800 IGST + 1,800 CGST + 1,800 SGST = 5,400
      expect(finMetrics.statutory_gst.total_output_gst_collected).toBe(5400.0);
      expect(finMetrics.statutory_gst.igst_collected).toBe(1800.0);
      expect(finMetrics.statutory_gst.cgst_collected).toBe(1800.0);
      expect(finMetrics.statutory_gst.sgst_collected).toBe(1800.0);

      // Direct Costs: 12,000 + 3,000 = 15,000
      expect(finMetrics.direct_costs.total_direct_costs).toBe(15000.0);

      // Gross Operating Profit: Taxable Service Base (30,000) - Direct Costs (15,000) = 15,000 (50.0%)
      expect(finMetrics.profitability.gross_profit).toBe(15000.0);
      expect(finMetrics.profitability.gross_margin_percentage).toBe(50.0);

      // Net Profit: Gross Profit (15,000) - Overhead (5,000) = 10,000 (33.3%)
      expect(finMetrics.profitability.net_profit).toBe(10000.0);
      expect(finMetrics.profitability.net_margin_percentage).toBe(33.3);

      // Outstanding Receivables: 11,800
      expect(finMetrics.total_outstanding).toBe(11800.0);
    });
  });

  // =========================================================================
  // GATE 7: PHYSICAL LOGISTICS & TRANSIT TELEMETRY
  // =========================================================================
  describe('Gate 7: Physical Logistics & Hardcopy Custody Metrics', () => {
    it('computes packet distribution and courier partner transit times accurately', () => {
      const packets: any[] = [
        { id: 'p1', status: 'ARCHIVED', inwarded_at: '2026-10-01' },
        { id: 'p2', status: 'ARCHIVED', inwarded_at: '2026-10-01' },
        { id: 'p3', status: 'DISPATCHED', inwarded_at: '2026-10-02' },
        { id: 'p4', status: 'DELIVERED', inwarded_at: '2026-10-02', delivered_at: '2026-10-04' },
      ];

      const dockets: any[] = [
        {
          id: 'd1',
          courier_partner: 'BlueDart',
          delivery_status: 'DELIVERED',
          dispatched_at: '2026-10-01T10:00:00Z',
          delivered_at: '2026-10-03T10:00:00Z', // 2 days
        },
        {
          id: 'd2',
          courier_partner: 'DTDC',
          delivery_status: 'IN_TRANSIT',
          dispatched_at: '2026-10-03T10:00:00Z',
        },
      ];

      const logMetrics = calculatePhysicalLogisticsMetrics(packets, dockets);

      expect(logMetrics.total_packets_inwarded).toBe(4);
      expect(logMetrics.packets_in_archive).toBe(2);
      expect(logMetrics.packets_in_transit).toBe(1);
      expect(logMetrics.packets_delivered).toBe(1);
      expect(logMetrics.delivery_acknowledgment_rate).toBe(25.0);
      expect(logMetrics.avg_transit_time_days).toBe(2.0);

      const bd = logMetrics.courier_performance.find((c) => c.courier_partner === 'BlueDart');
      expect(bd).toBeDefined();
      expect(bd?.docket_count).toBe(1);
      expect(bd?.delivered_count).toBe(1);
      expect(bd?.avg_delivery_days).toBe(2.0);
    });
  });
});
