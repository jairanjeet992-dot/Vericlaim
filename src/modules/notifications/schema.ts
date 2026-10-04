import { z } from 'zod';

export const NotificationChannelSchema = z.enum(['IN_APP', 'EMAIL', 'SMS_STUB', 'WHATSAPP_STUB']);
export const NotificationPrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export const NotificationEventTypeSchema = z.enum([
  'CASE_ASSIGNED',
  'REWORK_REQUESTED',
  'REPORT_APPROVED',
  'SLA_WARNING',
  'PAYMENT_RECEIVED',
  'EXPENSE_APPROVED',
  'EXPENSE_REJECTED',
  'PAYOUT_FINALIZED',
  'CUSTOM',
]);

export const SendNotificationSchema = z.object({
  user_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  notification_type: NotificationEventTypeSchema,
  channels: z.array(NotificationChannelSchema).default(['IN_APP']),
  priority: NotificationPrioritySchema.default('NORMAL'),
  action_url: z.string().max(500).optional(),
  metadata: z.record(z.any()).default({}),
  recipient_email: z.string().email().optional(),
  recipient_phone: z.string().optional(),
});

export type SendNotificationInput = z.infer<typeof SendNotificationSchema>;

export const MarkNotificationReadSchema = z.object({
  notification_ids: z.array(z.string().uuid()).min(1),
});

export type MarkNotificationReadInput = z.infer<typeof MarkNotificationReadSchema>;
