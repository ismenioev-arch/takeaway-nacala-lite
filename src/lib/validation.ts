import { z } from 'zod';

// Message validation schema
export const messageSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, { message: "Mensagem não pode estar vazia" })
    .max(2000, { message: "Mensagem deve ter no máximo 2000 caracteres" })
    .refine(
      (val) => !/[<>]/.test(val), 
      { message: "Mensagem contém caracteres inválidos" }
    ),
});

// Auth validation schemas
export const emailSchema = z
  .string()
  .trim()
  .email({ message: "Email inválido" })
  .max(255, { message: "Email deve ter no máximo 255 caracteres" });

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+258)?[89]\d{8}$/, { message: "Número de telefone inválido (formato: 84/85/86/87 + 8 dígitos)" })
  .transform((val) => val.startsWith('+258') ? val : `+258${val}`);

export const passwordSchema = z
  .string()
  .min(6, { message: "Senha deve ter no mínimo 6 caracteres" })
  .max(72, { message: "Senha deve ter no máximo 72 caracteres" });

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, { message: "Nome deve ter no mínimo 2 caracteres" })
  .max(100, { message: "Nome deve ter no máximo 100 caracteres" });

// Registration schema with phone
export const signUpWithPhoneSchema = z.object({
  phone: phoneSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
});

// Registration schema with email
export const signUpWithEmailSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
});

// Login schemas
export const loginWithPhoneSchema = z.object({
  phone: phoneSchema,
  password: passwordSchema,
});

export const loginWithEmailSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

// Validate and sanitize message
export function validateMessage(message: string): { success: boolean; error?: string; data?: string } {
  try {
    const result = messageSchema.parse({ message });
    return { success: true, data: result.message };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0]?.message || 'Mensagem inválida' };
    }
    return { success: false, error: 'Erro de validação' };
  }
}
