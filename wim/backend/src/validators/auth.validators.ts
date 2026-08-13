import { z } from 'zod';
import { USER_ROLES } from '../models/enums.js';
import { passwordSchema } from '../auth/password.js';
import { requiredText } from './common.validators.js';

/**
 * No login a password não é validada contra as regras de complexidade: quem
 * está a entrar tem a password que tem, e aplicar as regras aqui revelaria,
 * pela mensagem de erro, que formato o sistema aceita.
 */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('deve ser um e-mail válido'),
  password: z.string().min(1, 'a password é obrigatória').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: requiredText(500, 'o token de sessão'),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'a password actual é obrigatória').max(200),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('deve ser um e-mail válido'),
  password: passwordSchema,
  name: requiredText(200, 'o nome'),
  role: z.enum(USER_ROLES).default('AGENT'),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;
