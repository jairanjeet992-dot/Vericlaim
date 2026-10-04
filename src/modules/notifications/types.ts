export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'SMS_STUB' | 'WHATSAPP_STUB';

export type NotificationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type NotificationEventType =
  | 'CASE_ASSIGNED'
  | 'REWORK_REQUESTED'
  | 'REPORT_APPROVED'
  | 'SLA_WARNING'
  | 'PAYMENT_RECEIVED'
  | 'EXPENSE_APPROVED'
  | 'EXPENSE_REJECTED'
  | 'PAYOUT_FINALIZED'
  | 'CUSTOM';

export interface NotificationRecord {
  id: string;
  agency_id: string;
  user_id: string;
  title: string;
  message: string;
  notification_type: NotificationEventType;
  channel: NotificationChannel;
  priority: NotificationPriority;
  is_read: boolean;
  read_at?: string | null;
  action_url?: string | null;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface SendNotificationPayload {
  agency_id: string;
  user_id: string;
  title: string;
  message: string;
  notification_type: NotificationEventType;
  channels?: NotificationChannel[];
  priority?: NotificationPriority;
  action_url?: string;
  metadata?: Record<string, any>;
  recipient_email?: string;
  recipient_phone?: string;
}

export interface DispatchedNotificationResult {
  notification_id: string;
  channel: NotificationChannel;
  status: 'DELIVERED' | 'STUBBED' | 'FAILED';
  details?: string;
}

export interface EmailProvider {
  sendEmail(to: string, subject: string, body: string, htmlBody?: string): Promise<{ success: boolean; messageId?: string }>;
}

export interface SmsProvider {
  sendSms(to: string, message: string): Promise<{ success: boolean; stubbed: true }>;
}

export interface WhatsAppProvider {
  sendWhatsApp(to: string, template: string, params: Record<string, any>): Promise<{ success: boolean; stubbed: true }>;
}
