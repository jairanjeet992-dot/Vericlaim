import { z } from 'zod';

export const CustomFieldTypeSchema = z.enum(['text', 'number', 'date', 'select', 'boolean']);
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;

export const CustomFieldDefinitionSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_]+$/, 'Field name must be lowercase alphanumeric with underscores'),
  label: z.string().min(1),
  type: CustomFieldTypeSchema,
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(), // For 'select' type
  default_value: z.any().optional(),
});

export type CustomFieldDefinition = z.infer<typeof CustomFieldDefinitionSchema>;

export const CaseTypeSchema = z.object({
  code: z.string().min(2).max(32).transform((v) => v.trim().toUpperCase()),
  name: z.string().min(2),
  default_sla_hours: z.number().int().positive().default(48),
  default_fee_rule: z.object({
    base_fee: z.number().nonnegative(),
    extra_km_rate: z.number().nonnegative().optional(),
  }).default({ base_fee: 1500 }),
  custom_field_definitions: z.array(CustomFieldDefinitionSchema).default([]),
});

export type CaseTypeInput = z.infer<typeof CaseTypeSchema>;

/**
 * Dynamically compiles a Zod schema from JSON custom field definitions
 * to validate arbitrary case intake payloads.
 */
export function compileCustomFieldsSchema(fieldDefs: CustomFieldDefinition[]) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const def of fieldDefs) {
    let fieldSchema: z.ZodTypeAny;

    switch (def.type) {
      case 'number':
        fieldSchema = z.coerce.number();
        break;
      case 'boolean':
        fieldSchema = z.boolean();
        break;
      case 'date':
        fieldSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');
        break;
      case 'select':
        if (def.options && def.options.length > 0) {
          fieldSchema = z.enum(def.options as [string, ...string[]]);
        } else {
          fieldSchema = z.string();
        }
        break;
      case 'text':
      default:
        fieldSchema = z.string();
        break;
    }

    if (!def.required) {
      fieldSchema = fieldSchema.optional().nullable();
    }

    shape[def.name] = fieldSchema;
  }

  return z.object(shape);
}

/**
 * Validates dynamic case custom fields data against field definitions
 */
export function validateCaseCustomFields(
  fieldDefs: CustomFieldDefinition[],
  data: Record<string, any>
) {
  const schema = compileCustomFieldsSchema(fieldDefs);
  return schema.safeParse(data);
}
