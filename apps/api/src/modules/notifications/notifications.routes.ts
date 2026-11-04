import type { FastifyPluginAsync } from 'fastify';
import { authenticate, authorize } from '../auth/auth.middleware';
import { requireMfa } from '../auth/auth.middleware';
import * as controller from './notifications.controller';
import { notifDocs as d } from './notifications.docs';

const notificationsRoutes: FastifyPluginAsync = async (fastify) => {
  const anyAuth = { preHandler: [authenticate, authorize('STUDENT', 'GUARDIAN', 'TUTOR', 'ADMIN')] };
  const adminMfa = { preHandler: [authenticate, authorize('ADMIN'), requireMfa] };

  // Chave pública VAPID (necessária para o cliente registar subscrições Web Push)
  fastify.get('/vapid', { schema: d.vapidKey }, controller.getVapidKey);

  // Preferências de notificação
  fastify.get('/preferences',   { ...anyAuth, schema: d.getPreferences },    controller.getPreferences);
  fastify.patch('/preferences', { ...anyAuth, schema: d.updatePreferences }, controller.updatePreferences);

  // Tokens de push
  fastify.post('/push/tokens',        { ...anyAuth, schema: d.registerToken },   controller.registerToken);
  fastify.delete('/push/tokens/:token', { ...anyAuth, schema: d.unregisterToken }, controller.unregisterToken);

  // Admin — gestão de canais
  fastify.get('/admin/channels',             { ...adminMfa, schema: d.adminGetChannels }, controller.adminGetChannels);
  fastify.patch('/admin/channels/:channel', { ...adminMfa, schema: d.adminSetChannel },  controller.adminSetChannel);
};

export default notificationsRoutes;
