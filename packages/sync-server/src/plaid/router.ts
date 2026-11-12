import type { Request, Response } from 'express';
import express from 'express';

import { getAccountDb } from '#account-db';
import { canAccessActiveFile } from '#services/user-service';
import { validateSessionMiddleware } from '#util/middlewares';
import { isValidFileId } from '#util/paths';

import { createPlaidClient } from './client';
import { readPlaidConfig } from './config';
import { createPlaidService, plaidErrorCode } from './service';
import { createPlaidStore } from './store';
import type { RecordKind } from './store';
import { receivePlaidWebhook } from './webhook';

const recordKinds: RecordKind[] = [
  'account',
  'transaction',
  'security',
  'holding',
  'investment_transaction',
  'liability',
  'auth',
  'identity',
];
let runtime: ReturnType<typeof createRuntime> | undefined;
function createRuntime() {
  const config = readPlaidConfig();
  if (!config) return null;
  const client = createPlaidClient(config);
  const store = createPlaidStore(
    getAccountDb().db,
    config.encryptionKey,
    config.environment,
  );
  return {
    config,
    client,
    store,
    service: createPlaidService(client, store, config),
  };
}
function getRuntime() {
  if (runtime === undefined) runtime = createRuntime();
  return runtime;
}
function failure(error: unknown, res: Response) {
  const message = error instanceof Error ? error.message : '';
  const code = plaidErrorCode(error);
  // Never serialize SDK errors: their request config includes Plaid secrets.
  if (
    message.startsWith('invalid-') ||
    message === 'plaid-product-not-configured'
  ) {
    res.status(400).send({ status: 'error', reason: message });
  } else if (code) {
    res
      .status(502)
      .send({ status: 'error', reason: 'plaid-provider-error', code });
  } else if (
    message === 'plaid-item-not-found' ||
    message === 'plaid-session-not-found'
  ) {
    res.status(404).send({ status: 'error', reason: message });
  } else if (
    message === 'plaid-link-pending' ||
    message === 'plaid-sync-conflict'
  ) {
    res.status(409).send({ status: 'error', reason: message });
  } else {
    res.status(500).send({ status: 'error', reason: 'plaid-operation-failed' });
  }
}

export const webhookHandlers = express.Router();
webhookHandlers.post(
  '/',
  express.raw({ type: 'application/json', limit: '256kb' }),
  async (req, res) => {
    try {
      const current = getRuntime();
      if (!current) {
        res.sendStatus(503);
        return;
      }
      const jwt = req.get('Plaid-Verification');
      if (!jwt || !Buffer.isBuffer(req.body)) {
        res.sendStatus(401);
        return;
      }
      await receivePlaidWebhook(current.client, current.store, jwt, req.body);
      res.sendStatus(200);
    } catch {
      res.sendStatus(401);
    }
  },
);

export function createPlaidRouter(resolveRuntime = getRuntime) {
  const router = express.Router();
  router.use(validateSessionMiddleware);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/status', (_req, res) => {
    try {
      const current = resolveRuntime();
      res.send({
        status: 'ok',
        data: {
          configured: !!current,
          environment: current?.config.environment ?? null,
          products: current?.config.products ?? [],
          optionalProducts: current?.config.optionalProducts ?? [],
        },
      });
    } catch {
      res
        .status(503)
        .send({ status: 'error', reason: 'plaid-invalid-configuration' });
    }
  });
  router.use((req, res, next) => {
    const fileId = req.get('X-Actual-File-Id');
    if (!fileId || !isValidFileId(fileId)) {
      res.status(400).send({ status: 'error', reason: 'invalid-file-id' });
      return;
    }
    if (!canAccessActiveFile(fileId, res.locals.user_id)) {
      res.status(403).send({ status: 'error', reason: 'file-access-denied' });
      return;
    }
    res.locals.plaidFileId = fileId;
    next();
  });
  function route(
    method: 'get' | 'post' | 'delete',
    path: string,
    action: (
      req: Request,
      service: NonNullable<ReturnType<typeof createRuntime>>['service'],
      fileId: string,
      userId: string,
    ) => unknown,
  ) {
    router[method](path, async (req, res) => {
      try {
        const current = resolveRuntime();
        if (!current) {
          res
            .status(503)
            .send({ status: 'error', reason: 'plaid-not-configured' });
          return;
        }
        const data = await action(
          req,
          current.service,
          res.locals.plaidFileId,
          res.locals.user_id,
        );
        res.send({ status: 'ok', data: data ?? null });
      } catch (error) {
        failure(error, res);
      }
    });
  }
  route('get', '/items', (_req, service, fileId) => service.list(fileId));
  route('post', '/link', (req, service, fileId, userId) => {
    const itemId: unknown = req.body?.itemId;
    if (
      itemId !== undefined &&
      (typeof itemId !== 'string' || itemId.length > 200)
    ) {
      throw new Error('invalid-item-id');
    }
    const product: unknown = req.body?.product;
    if (product !== undefined && typeof product !== 'string') {
      throw new Error('invalid-product');
    }
    return service.createLink(
      fileId,
      userId,
      typeof itemId === 'string' ? itemId : undefined,
      typeof product === 'string' ? product : undefined,
    );
  });
  route('post', '/sessions/:id/complete', (req, service, fileId, userId) =>
    service.complete(fileId, userId, String(req.params.id)),
  );
  route('post', '/items/:id/accounts', (req, service, fileId) =>
    service.refreshAccounts(fileId, String(req.params.id)),
  );
  route('post', '/items/:id/transactions', (req, service, fileId) =>
    service.syncTransactions(fileId, String(req.params.id)),
  );
  route('post', '/items/:id/snapshot/:product', (req, service, fileId) => {
    const product = req.params.product;
    if (
      product !== 'investments' &&
      product !== 'liabilities' &&
      product !== 'auth' &&
      product !== 'identity'
    ) {
      throw new Error('invalid-product');
    }
    return service.snapshot(fileId, String(req.params.id), product);
  });
  route(
    'post',
    '/items/:id/investment-transactions',
    (req, service, fileId) => {
      const start: unknown = req.body?.startDate;
      const end: unknown = req.body?.endDate;
      function date(value: unknown): value is string {
        return (
          typeof value === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          !Number.isNaN(Date.parse(value)) &&
          new Date(value).toISOString().slice(0, 10) === value
        );
      }
      if (!date(start) || !date(end) || start > end) {
        throw new Error('invalid-date-range');
      }
      return service.investmentTransactions(
        fileId,
        String(req.params.id),
        start,
        end,
      );
    },
  );
  route('get', '/items/:id/records/:kind', (req, service, fileId) => {
    const kind = recordKinds.find(kind => kind === req.params.kind);
    const limit = Number(req.query.limit ?? 100);
    const offset = Number(req.query.offset ?? 0);
    if (
      !kind ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 500 ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new Error('invalid-record-query');
    }
    return service.records(fileId, String(req.params.id), kind, limit, offset);
  });
  route('delete', '/items/:id', (req, service, fileId) =>
    service.remove(fileId, String(req.params.id)),
  );
  return router;
}
export const handlers = createPlaidRouter();
