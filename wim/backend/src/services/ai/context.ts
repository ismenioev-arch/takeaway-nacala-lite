/**
 * Reunir tudo o que a IA precisa de saber — e nada mais.
 *
 * O prompt não tem factos escritos lá dentro. Os horários, os serviços, os
 * preços autorizados e o histórico do cliente vêm todos da base de dados,
 * em cada chamada. É isso que permite ao dono do negócio mudar o que a IA
 * responde sem ninguém tocar em código.
 */
import { getEnv } from '../../config/env.js';
import { getPool, type Queryable } from '../../database/pool.js';
import type { ContactRow, ConversationRow, MessageRow } from '../../models/domain.js';
import * as companyRepo from '../../repositories/company.repository.js';
import type {
  CompanyFaqRow,
  CompanyPriceRow,
  CompanyProfileRow,
  CompanyServiceRow,
} from '../../repositories/company.repository.js';
import * as messagesRepo from '../../repositories/messages.repository.js';
import * as settingsRepo from '../../repositories/settings.repository.js';
import { DEFAULT_CONFIDENCE_THRESHOLD } from './automation.js';

export interface AnalysisContext {
  message: MessageRow;
  conversation: ConversationRow;
  contact: ContactRow;
  /** Mensagens anteriores, da mais antiga para a mais recente. */
  history: MessageRow[];
  company: CompanyProfileRow | null;
  services: CompanyServiceRow[];
  /** Apenas os preços com `is_authorized_for_ai = true`. */
  prices: CompanyPriceRow[];
  faqs: CompanyFaqRow[];
  /** Hora a que a análise corre, para a IA avaliar «amanhã» e «hoje». */
  now: Date;
  /** Das definições, não do ambiente: o dono pode mudá-las sem deploy. */
  confidenceThreshold: number;
  globalAutomationEnabled: boolean;
}

/**
 * Há factos registados suficientes para uma resposta poder ser automática?
 *
 * Um sistema recém-instalado, sem FAQs nem serviços, não tem nada em que
 * fundamentar uma resposta — e, nesse estado, nenhuma resposta deve sair
 * sozinha. A verificação está aqui, e não no prompt, porque é uma garantia
 * e não um pedido.
 */
export function hasRegisteredFacts(context: AnalysisContext): boolean {
  if (context.faqs.length > 0) return true;
  if (context.services.length > 0) return true;

  const hours = context.company?.business_hours;
  return Boolean(hours && Object.keys(hours).length > 0);
}

export async function loadAnalysisContext(
  message: MessageRow,
  db: Queryable = getPool(),
): Promise<AnalysisContext> {
  const env = getEnv();

  const [conversationResult, contactResult, history, company, services, prices, faqs] =
    await Promise.all([
      db.query<ConversationRow>(`SELECT * FROM conversations WHERE id = $1`, [
        message.conversation_id,
      ]),
      db.query<ContactRow>(`SELECT * FROM contacts WHERE id = $1`, [message.contact_id]),
      messagesRepo.listConversationHistory(
        message.conversation_id,
        env.AI_HISTORY_LIMIT,
        { excludeMessageId: message.id },
        db,
      ),
      companyRepo.findCompanyProfile(db),
      companyRepo.listActiveServices(db),
      companyRepo.listAiAuthorizedPrices(db),
      companyRepo.listActiveFaqs(db),
    ]);

  const conversation = conversationResult.rows[0];
  const contact = contactResult.rows[0];

  if (!conversation || !contact) {
    // Só acontece com apagamento concorrente. Melhor dizê-lo do que
    // mandar uma análise sem destinatário para a Claude.
    throw new Error(`Mensagem ${message.id} sem conversa ou contacto associado.`);
  }

  // A definição manda sobre a variável de ambiente, que é apenas o valor
  // por omissão de quem ainda não decidiu.
  const confidenceThreshold = await settingsRepo.getNumberSetting(
    'ai.confidence_threshold',
    env.AI_CONFIDENCE_THRESHOLD ?? DEFAULT_CONFIDENCE_THRESHOLD,
    db,
  );

  const settingEnabled = await settingsRepo.getBooleanSetting('ai.automation_enabled', false, db);

  return {
    message,
    conversation,
    contact,
    history,
    company,
    services,
    prices,
    faqs,
    now: new Date(),
    confidenceThreshold,
    // Dois interruptores, ambos têm de estar ligados. O da empresa é o que
    // o dono vê no painel; o das definições é o global do sistema.
    globalAutomationEnabled: settingEnabled && Boolean(company?.auto_reply_enabled),
  };
}
