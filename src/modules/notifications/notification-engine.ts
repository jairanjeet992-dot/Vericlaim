import crypto from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  DispatchedNotificationResult,
  EmailProvider,
  NotificationChannel,
  NotificationRecord,
  SendNotificationPayload,
  SmsProvider,
  WhatsAppProvider,
} from './types';

export class MockEmailProvider implements EmailProvider {
  public sentEmails: Array<{ to: string; subject: string; body: string; timestamp: string }> = [];

  async sendEmail(to: string, subject: string, body: string, htmlBody?: string) {
    this.sentEmails.push({
      to,
      subject,
      body: htmlBody || body,
      timestamp: new Date().toISOString(),
    });
    return { success: true, messageId: `msg_${crypto.randomUUID()}` };
  }
}

/**
 * Stub SMS Provider complying with Rule A11:
 * "SMS/WhatsApp channel interface + stub only (Do not build yet)".
 */
export class StubSmsProvider implements SmsProvider {
  public sentMessages: Array<{ to: string; message: string; timestamp: string }> = [];

  async sendSms(to: string, message: string): Promise<{ success: boolean; stubbed: true }> {
    this.sentMessages.push({
      to,
      message,
      timestamp: new Date().toISOString(),
    });
    return { success: true, stubbed: true };
  }
}

/**
 * Stub WhatsApp Provider complying with Rule A11:
 * "SMS/WhatsApp channel interface + stub only (Do not build yet)".
 */
export class StubWhatsAppProvider implements WhatsAppProvider {
  public sentMessages: Array<{ to: string; template: string; params: Record<string, any>; timestamp: string }> = [];

  async sendWhatsApp(
    to: string,
    template: string,
    params: Record<string, any>
  ): Promise<{ success: boolean; stubbed: true }> {
    this.sentMessages.push({
      to,
      template,
      params,
      timestamp: new Date().toISOString(),
    });
    return { success: true, stubbed: true };
  }
}

export class NotificationEngine {
  public emailProvider: EmailProvider;
  public smsProvider: SmsProvider;
  public whatsAppProvider: WhatsAppProvider;
  private inMemoryNotifications: NotificationRecord[] = [];

  constructor(
    private supabase?: SupabaseClient,
    providers?: {
      email?: EmailProvider;
      sms?: SmsProvider;
      whatsApp?: WhatsAppProvider;
    }
  ) {
    this.emailProvider = providers?.email || new MockEmailProvider();
    this.smsProvider = providers?.sms || new StubSmsProvider();
    this.whatsAppProvider = providers?.whatsApp || new StubWhatsAppProvider();
  }

  /**
   * Dispatches a notification across all requested channels.
   * GATES: Gate 5 Multi-channel notifications dispatched on lifecycle events.
   */
  async dispatch(payload: SendNotificationPayload): Promise<DispatchedNotificationResult[]> {
    const channels = payload.channels && payload.channels.length > 0 ? payload.channels : ['IN_APP'];
    const results: DispatchedNotificationResult[] = [];

    for (const channel of channels) {
      const notificationId = crypto.randomUUID();

      if (channel === 'IN_APP') {
        const record: NotificationRecord = {
          id: notificationId,
          agency_id: payload.agency_id,
          user_id: payload.user_id,
          title: payload.title,
          message: payload.message,
          notification_type: payload.notification_type,
          channel: 'IN_APP',
          priority: payload.priority || 'NORMAL',
          is_read: false,
          read_at: null,
          action_url: payload.action_url || null,
          metadata: payload.metadata || {},
          created_at: new Date().toISOString(),
        };

        if (this.supabase) {
          await this.supabase.from('notifications').insert(record);
        } else {
          this.inMemoryNotifications.push(record);
        }

        results.push({
          notification_id: notificationId,
          channel: 'IN_APP',
          status: 'DELIVERED',
          details: 'Recorded in user notification ledger',
        });
      } else if (channel === 'EMAIL') {
        const recipient = payload.recipient_email || 'investigator@agency.com';
        const res = await this.emailProvider.sendEmail(recipient, payload.title, payload.message);
        results.push({
          notification_id: notificationId,
          channel: 'EMAIL',
          status: res.success ? 'DELIVERED' : 'FAILED',
          details: res.messageId,
        });
      } else if (channel === 'SMS_STUB') {
        const recipient = payload.recipient_phone || '+919876543210';
        await this.smsProvider.sendSms(recipient, `${payload.title}: ${payload.message}`);
        results.push({
          notification_id: notificationId,
          channel: 'SMS_STUB',
          status: 'STUBBED',
          details: 'Rule A11 Stub: SMS logged without external gateway call',
        });
      } else if (channel === 'WHATSAPP_STUB') {
        const recipient = payload.recipient_phone || '+919876543210';
        await this.whatsAppProvider.sendWhatsApp(recipient, 'lifecycle_alert', {
          title: payload.title,
          message: payload.message,
        });
        results.push({
          notification_id: notificationId,
          channel: 'WHATSAPP_STUB',
          status: 'STUBBED',
          details: 'Rule A11 Stub: WhatsApp logged without external gateway call',
        });
      }
    }

    return results;
  }

  // --- CORE LIFECYCLE EVENT DISPATCHERS ---

  async notifyCaseAssigned(params: {
    agency_id: string;
    investigator_user_id: string;
    case_id: string;
    doc_code: string;
    insured_name: string;
    location_city: string;
    channels?: NotificationChannel[];
  }) {
    return this.dispatch({
      agency_id: params.agency_id,
      user_id: params.investigator_user_id,
      title: `New Case Assigned: ${params.doc_code}`,
      message: `You have been assigned case ${params.doc_code} for ${params.insured_name} in ${params.location_city}. Please review and accept.`,
      notification_type: 'CASE_ASSIGNED',
      priority: 'HIGH',
      action_url: `/cases/${params.case_id}`,
      channels: params.channels || ['IN_APP', 'EMAIL', 'SMS_STUB'],
      metadata: { case_id: params.case_id, doc_code: params.doc_code },
    });
  }

  async notifyReworkRequested(params: {
    agency_id: string;
    assignee_user_id: string;
    case_id: string;
    doc_code: string;
    rework_count: number;
    reason_category: string;
    instructions: string;
    channels?: NotificationChannel[];
  }) {
    const isEscalated = params.rework_count >= 3;
    return this.dispatch({
      agency_id: params.agency_id,
      user_id: params.assignee_user_id,
      title: `${isEscalated ? '🚨 ESCALATED ' : ''}Rework Requested: ${params.doc_code} (Cycle ${params.rework_count})`,
      message: `Correction requested [${params.reason_category}]: ${params.instructions}`,
      notification_type: 'REWORK_REQUESTED',
      priority: isEscalated ? 'URGENT' : 'HIGH',
      action_url: `/cases/${params.case_id}`,
      channels: params.channels || ['IN_APP', 'EMAIL', 'WHATSAPP_STUB'],
      metadata: { case_id: params.case_id, doc_code: params.doc_code, rework_count: params.rework_count },
    });
  }

  async notifyReportApproved(params: {
    agency_id: string;
    manager_user_id: string;
    case_id: string;
    doc_code: string;
    approver_name: string;
    channels?: NotificationChannel[];
  }) {
    return this.dispatch({
      agency_id: params.agency_id,
      user_id: params.manager_user_id,
      title: `Report Approved: ${params.doc_code}`,
      message: `Case investigation report for ${params.doc_code} has been approved by ${params.approver_name} and sealed immutable. Ready for hardcopy dispatch and billing.`,
      notification_type: 'REPORT_APPROVED',
      priority: 'NORMAL',
      action_url: `/cases/${params.case_id}`,
      channels: params.channels || ['IN_APP', 'EMAIL'],
      metadata: { case_id: params.case_id, doc_code: params.doc_code },
    });
  }

  async notifySlaWarning(params: {
    agency_id: string;
    user_id: string;
    case_id: string;
    doc_code: string;
    sla_status: 'APPROACHING' | 'BREACHED';
    remaining_hours?: number;
    channels?: NotificationChannel[];
  }) {
    const isBreach = params.sla_status === 'BREACHED';
    return this.dispatch({
      agency_id: params.agency_id,
      user_id: params.user_id,
      title: isBreach ? `⚠️ SLA BREACHED: ${params.doc_code}` : `⏰ SLA Approaching: ${params.doc_code}`,
      message: isBreach
        ? `Case ${params.doc_code} has exceeded its SLA resolution deadline! Immediate supervisor intervention required.`
        : `Case ${params.doc_code} is approaching SLA breach with ${params.remaining_hours ?? 4} hours remaining.`,
      notification_type: 'SLA_WARNING',
      priority: isBreach ? 'URGENT' : 'HIGH',
      action_url: `/cases/${params.case_id}`,
      channels: params.channels || ['IN_APP', 'EMAIL', 'SMS_STUB'],
      metadata: { case_id: params.case_id, doc_code: params.doc_code, sla_status: params.sla_status },
    });
  }

  async notifyPaymentReceived(params: {
    agency_id: string;
    user_id: string;
    client_name: string;
    amount: number;
    utr_number: string;
    channels?: NotificationChannel[];
  }) {
    return this.dispatch({
      agency_id: params.agency_id,
      user_id: params.user_id,
      title: `Client Remittance Received: ₹${params.amount.toLocaleString('en-IN')}`,
      message: `Payment of ₹${params.amount.toLocaleString('en-IN')} received from ${params.client_name} (UTR: ${params.utr_number}). Ready for invoice allocation.`,
      notification_type: 'PAYMENT_RECEIVED',
      priority: 'NORMAL',
      action_url: `/payments`,
      channels: params.channels || ['IN_APP', 'EMAIL'],
      metadata: { utr: params.utr_number, amount: params.amount },
    });
  }

  async notifyExpenseDecision(params: {
    agency_id: string;
    investigator_user_id: string;
    expense_id: string;
    amount: number;
    decision: 'APPROVED' | 'REJECTED';
    reason?: string;
    channels?: NotificationChannel[];
  }) {
    const isApproved = params.decision === 'APPROVED';
    return this.dispatch({
      agency_id: params.agency_id,
      user_id: params.investigator_user_id,
      title: isApproved ? `Expense Claim Approved: ₹${params.amount}` : `Expense Claim Rejected: ₹${params.amount}`,
      message: isApproved
        ? `Your expense claim of ₹${params.amount} has been approved for monthly payout.`
        : `Your expense claim of ₹${params.amount} was rejected. Reason: ${params.reason || 'Insufficient receipts'}`,
      notification_type: isApproved ? 'EXPENSE_APPROVED' : 'EXPENSE_REJECTED',
      priority: 'NORMAL',
      action_url: `/investigator`,
      channels: params.channels || ['IN_APP', 'EMAIL', 'SMS_STUB'],
      metadata: { expense_id: params.expense_id, decision: params.decision },
    });
  }

  async notifyPayoutDisbursed(params: {
    agency_id: string;
    investigator_user_id: string;
    payout_month: string;
    net_payable: number;
    utr_reference?: string;
    channels?: NotificationChannel[];
  }) {
    return this.dispatch({
      agency_id: params.agency_id,
      user_id: params.investigator_user_id,
      title: `Monthly Payout Disbursed: ₹${params.net_payable.toLocaleString('en-IN')}`,
      message: `Your investigation payout for ${params.payout_month} (Net: ₹${params.net_payable.toLocaleString('en-IN')}) has been processed and disbursed.${params.utr_reference ? ` UTR: ${params.utr_reference}` : ''}`,
      notification_type: 'PAYOUT_FINALIZED',
      priority: 'HIGH',
      action_url: `/investigator`,
      channels: params.channels || ['IN_APP', 'EMAIL', 'SMS_STUB', 'WHATSAPP_STUB'],
      metadata: { payout_month: params.payout_month, net_payable: params.net_payable },
    });
  }

  // --- QUERY & STATE HELPERS ---

  async getUserNotifications(agencyId: string, userId: string, unreadOnly: boolean = false): Promise<NotificationRecord[]> {
    if (this.supabase) {
      let query = this.supabase
        .from('notifications')
        .select('*')
        .eq('agency_id', agencyId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (unreadOnly) {
        query = query.eq('is_read', false);
      }

      const { data, error } = await query;
      if (error) throw new Error(`Failed to query notifications: ${error.message}`);
      return (data || []) as NotificationRecord[];
    }

    return this.inMemoryNotifications
      .filter((n) => n.agency_id === agencyId && n.user_id === userId && (!unreadOnly || !n.is_read))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  async markAsRead(agencyId: string, userId: string, notificationIds: string[]): Promise<void> {
    const now = new Date().toISOString();
    if (this.supabase) {
      await this.supabase
        .from('notifications')
        .update({ is_read: true, read_at: now })
        .eq('agency_id', agencyId)
        .eq('user_id', userId)
        .in('id', notificationIds);
    } else {
      this.inMemoryNotifications.forEach((n) => {
        if (n.agency_id === agencyId && n.user_id === userId && notificationIds.includes(n.id)) {
          n.is_read = true;
          n.read_at = now;
        }
      });
    }
  }

  async markAllAsRead(agencyId: string, userId: string): Promise<void> {
    const now = new Date().toISOString();
    if (this.supabase) {
      await this.supabase
        .from('notifications')
        .update({ is_read: true, read_at: now })
        .eq('agency_id', agencyId)
        .eq('user_id', userId)
        .eq('is_read', false);
    } else {
      this.inMemoryNotifications.forEach((n) => {
        if (n.agency_id === agencyId && n.user_id === userId) {
          n.is_read = true;
          n.read_at = now;
        }
      });
    }
  }
}
