/**
 * `/api/contacts` — cadastro de contactos (especificação, secção 13).
 *
 * O controlador só faz três coisas: validar a entrada, chamar o serviço e
 * escolher o código HTTP. Nenhuma regra de negócio vive aqui.
 *
 * A validação usa `.parse()`: um `ZodError` sobe até ao tratador central de
 * erros, que o converte num 400 com a lista de campos inválidos.
 */
import type { FastifyInstance } from 'fastify';
import { actorFromRequest } from '../auth/actor.js';
import { idParamSchema } from '../validators/common.validators.js';
import {
  createContactSchema,
  listContactsQuerySchema,
  updateContactSchema,
} from '../validators/contact.validators.js';
import * as contactsService from '../services/contacts.service.js';

export function registerContactRoutes(app: FastifyInstance): void {
  app.get('/api/contacts', async (request) => {
    const query = listContactsQuerySchema.parse(request.query);
    return contactsService.listContacts(query);
  });

  app.get('/api/contacts/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return contactsService.getContact(id);
  });

  app.post('/api/contacts', async (request, reply) => {
    const input = createContactSchema.parse(request.body);
    const contact = await contactsService.createContact(input, actorFromRequest(request));

    return reply.status(201).send(contact);
  });

  app.patch('/api/contacts/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const input = updateContactSchema.parse(request.body);

    return contactsService.updateContact(id, input, actorFromRequest(request));
  });

  app.delete('/api/contacts/:id', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await contactsService.deleteContact(id, actorFromRequest(request));

    return reply.status(204).send();
  });
}
