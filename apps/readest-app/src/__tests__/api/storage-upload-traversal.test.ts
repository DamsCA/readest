import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// GHSA-mfmj-2frf-vhgw: a cross-tenant write via `fileName` path traversal.
// The handler must reject a traversing `fileName` before it ever asks the
// storage backend for a presigned PUT URL.

const validateUserAndTokenMock = vi.fn();
const getUploadSignedUrlMock = vi.fn();
const getDownloadSignedUrlMock = vi.fn();
const createSupabaseAdminClientMock = vi.fn();
const storageUsage = { value: 12345 as number | null };
const deletedIds: string[] = [];

vi.mock('@/utils/cors', () => ({
  corsAllMethods: {},
  runMiddleware: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
  // The token's usage is deliberately stale (0): the route must not trust it.
  getStoragePlanData: vi.fn().mockReturnValue({ usage: 0, quota: 500 * 1024 * 1024 }),
  STORAGE_QUOTA_GRACE_BYTES: 0,
}));
vi.mock('@/utils/object', async (orig) => {
  const actual = await orig<typeof import('@/utils/object')>();
  return {
    ...actual,
    getUploadSignedUrl: (...a: unknown[]) => getUploadSignedUrlMock(...a),
    getDownloadSignedUrl: (...a: unknown[]) => getDownloadSignedUrlMock(...a),
  };
});
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: (...a: unknown[]) => createSupabaseAdminClientMock(...a),
}));

import handler from '@/pages/api/storage/upload';

const makeReqRes = (body: Record<string, unknown>) => {
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer attacker' },
    body,
  } as unknown as NextApiRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as NextApiResponse;
  return { req, res };
};

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockResolvedValue({
    user: { id: 'attacker-id' },
    token: 'tok',
  });
  getUploadSignedUrlMock.mockReset().mockResolvedValue('https://r2/upload');
  getDownloadSignedUrlMock.mockReset().mockResolvedValue('https://r2/download');

  // Minimal chainable Supabase stub: the no-existing-record lookup then the
  // insert, both ending in `.single()`.
  const single = vi
    .fn()
    .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } })
    .mockResolvedValueOnce({ data: { id: 'new-row', file_size: 12345 }, error: null });
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit', 'insert', 'is', 'order']) builder[m] = () => builder;
  builder['single'] = single;
  // The page-by-page fallback, used when the SQL function is missing.
  builder['range'] = async () =>
    storageUsage.value === null
      ? { data: null, error: { message: 'down' } }
      : { data: [{ file_size: storageUsage.value }], error: null };
  builder['delete'] = () => ({
    eq: async (_c: string, id: string) => {
      deletedIds.push(id);
      return { error: null };
    },
  });
  deletedIds.length = 0;
  storageUsage.value = 12345;
  createSupabaseAdminClientMock.mockReset().mockReturnValue({
    from: () => builder,
    // The live total, read from the database (it includes the new row).
    rpc: async () =>
      storageUsage.value === null
        ? { data: null, error: { message: 'down' } }
        : { data: storageUsage.value, error: null },
  });
});

describe('POST /api/storage/upload — fileName traversal guard', () => {
  it('rejects a traversing fileName with 400 and never presigns', async () => {
    const { req, res } = makeReqRes({
      fileName: '../victim-id/Readest/Book/hash/book.epub',
      fileSize: 12345,
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('rejects a traversing fileName on the temp image branch too', async () => {
    const { req, res } = makeReqRes({
      fileName: '../../other/evil.png',
      fileSize: 999,
      temp: true,
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('allows a normal book key through to presigning', async () => {
    const { req, res } = makeReqRes({
      fileName: 'Readest/Books/hash.epub',
      fileSize: 12345,
    });
    await handler(req, res);
    expect(getUploadSignedUrlMock).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('POST /api/storage/upload — storage limits', () => {
  it.each([
    [0],
    [-5],
    ['abc'],
    [1.5],
    [600 * 1024 * 1024],
  ])('refuses a declared size of %s', async (fileSize) => {
    const { req, res } = makeReqRes({ fileName: 'Readest/Books/hash.epub', fileSize });
    await handler(req, res);
    expect([400, 413]).toContain(
      (res.status as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0],
    );
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('caps a temporary upload at a small image', async () => {
    const { req, res } = makeReqRes({
      fileName: 'cover.png',
      fileSize: 5 * 1024 * 1024,
      temp: true,
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('measures the quota on the database total, not on the stale token', async () => {
    storageUsage.value = 600 * 1024 * 1024; // over the free 500 MB, the token says 0
    const { req, res } = makeReqRes({ fileName: 'Readest/Books/big.epub', fileSize: 12345 });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
    // The row recorded for this refused upload is taken back.
    expect(deletedIds).toEqual(['new-row']);
  });

  it('refuses when the usage cannot be read', async () => {
    storageUsage.value = null;
    const { req, res } = makeReqRes({ fileName: 'Readest/Books/hash.epub', fileSize: 12345 });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(getUploadSignedUrlMock).not.toHaveBeenCalled();
  });
});
