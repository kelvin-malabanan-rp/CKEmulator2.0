import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { OctaneTransport, parseScanRequest } from './OctaneTransport';
import type { InjectCommand } from '../core/injectProtocol';

interface FakePlayer {
  server: http.Server;
  port: number;
  /** Bodies received on POST /add_salesline, in arrival order. */
  journal: () => string[];
  /** Content-Type headers seen on the journal POSTs. */
  contentTypes: () => (string | undefined)[];
  /** Paths+methods seen, including the /health probe. */
  requests: () => string[];
  close: () => Promise<void>;
}

/**
 * Stand-in for CK Player 2.0's Octane virtual journal: an HTTP server that
 * records journal POSTs. `healthStatus: null` makes GET /health 404 — the
 * legacy Java player's behaviour, which must still count as reachable.
 */
function fakePlayer(opts: { healthStatus?: number | null } = {}): Promise<FakePlayer> {
  const journal: string[] = [];
  const contentTypes: (string | undefined)[] = [];
  const requests: string[] = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      if (req.method === 'GET') {
        res.writeHead(opts.healthStatus === null ? 404 : (opts.healthStatus ?? 200));
        res.end();
        return;
      }
      let body = '';
      req.on('data', (c: Buffer) => {
        body += c.toString('utf-8');
      });
      req.on('end', () => {
        journal.push(body);
        contentTypes.push(req.headers['content-type']);
        res.writeHead(200);
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({
        server,
        port,
        journal: () => journal,
        contentTypes: () => contentTypes,
        requests: () => requests,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll until `check` is true or the budget runs out — avoids fixed sleeps. */
async function until(check: () => boolean, budgetMs = 2000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await wait(10);
  }
}

/** POST an inject to the emulator's scan server, the way OctaneScanner does. */
function postScan(port: number, body: string, path = '/function'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let out = '';
        res.on('data', (c: Buffer) => {
          out += c.toString('utf-8');
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: out }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** A free port for the scan server, so parallel test files can't collide. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

let transport: OctaneTransport | undefined;
const players: FakePlayer[] = [];

afterEach(async () => {
  transport?.close();
  transport = undefined;
  for (const p of players) await p.close();
  players.length = 0;
});

describe('parseScanRequest', () => {
  it('reads the barcode and quantity out of function.sale', () => {
    expect(
      parseScanRequest({ version: 1, function: { sale: { articleNo: '1034073', quantity: 2 } } }),
    ).toEqual({ barcode: '1034073', quantity: 2 });
  });

  it('defaults a missing/zero quantity to 1 (legacy ScanServer)', () => {
    expect(parseScanRequest({ function: { sale: { articleNo: '1' } } })).toEqual({ barcode: '1', quantity: 1 });
    expect(parseScanRequest({ function: { sale: { articleNo: '1', quantity: 0 } } })?.quantity).toBe(1);
  });

  it('coerces a numeric articleNo to a string', () => {
    expect(parseScanRequest({ function: { sale: { articleNo: 1034073 } } })?.barcode).toBe('1034073');
  });

  it('rejects a body with no sale, no articleNo, or a blank one', () => {
    expect(parseScanRequest({})).toBeNull();
    expect(parseScanRequest({ function: {} })).toBeNull();
    expect(parseScanRequest({ function: { sale: {} } })).toBeNull();
    expect(parseScanRequest({ function: { sale: { articleNo: '   ' } } })).toBeNull();
    expect(parseScanRequest(null)).toBeNull();
  });
});

describe('OctaneTransport journal (outbound HTTP)', () => {
  it('reports connected once the player answers, then POSTs to /add_salesline', async () => {
    const player = await fakePlayer();
    players.push(player);

    transport = new OctaneTransport({ host: '127.0.0.1', vjPort: player.port, scannerPort: await freePort() });
    await transport.connect();
    await until(() => transport!.status().vj === 'connected');
    expect(transport.status().vj).toBe('connected');

    expect(transport.send('vj', '{"lineId":"6"}\r\n')).toBe(true);
    await until(() => player.journal().length === 1);
    expect(player.journal()).toEqual(['{"lineId":"6"}\r\n']);
    expect(player.requests()).toContain('POST /add_salesline');
  });

  it('sends application/json so the player body-parses the document', async () => {
    const player = await fakePlayer();
    players.push(player);
    transport = new OctaneTransport({ host: '127.0.0.1', vjPort: player.port, scannerPort: await freePort() });
    await transport.connect();
    await until(() => transport!.status().vj === 'connected');

    transport.send('vj', '{"lineId":"1"}\r\n');
    await until(() => player.contentTypes().length === 1);
    expect(player.contentTypes()[0]).toBe('application/json');
  });

  it('sends ONE document per request — never batched', async () => {
    const player = await fakePlayer();
    players.push(player);
    transport = new OctaneTransport({ host: '127.0.0.1', vjPort: player.port, scannerPort: await freePort() });
    await transport.connect();
    await until(() => transport!.status().vj === 'connected');

    transport.send('vj', '{"lineId":"5"}\r\n');
    transport.send('vj', '{"lineId":"55"}\r\n');
    transport.send('vj', '{"lineId":"7"}\r\n');
    await until(() => player.journal().length === 3);
    expect(player.journal()).toHaveLength(3);
    for (const body of player.journal()) expect(() => JSON.parse(body)).not.toThrow();
  });

  it('treats a 404 /health as reachable — the legacy player has no health route', async () => {
    const player = await fakePlayer({ healthStatus: null });
    players.push(player);
    transport = new OctaneTransport({ host: '127.0.0.1', vjPort: player.port, scannerPort: await freePort() });
    await transport.connect();
    await until(() => transport!.status().vj === 'connected');
    expect(transport.status().vj).toBe('connected');
  });

  it('stays disconnected and queues while nothing is listening, then flushes on reconnect', async () => {
    // Claim a port, then release it so the first probes are refused.
    const port = await freePort();
    transport = new OctaneTransport({
      host: '127.0.0.1',
      vjPort: port,
      scannerPort: await freePort(),
      reconnectDelayMs: 50,
    });
    await transport.connect();
    await until(() => transport!.status().vj === 'disconnected');
    expect(transport.status().vj).toBe('disconnected');

    // Queued, not written — nothing is listening yet.
    expect(transport.send('vj', '{"lineId":"6"}\r\n')).toBe(false);
    expect(transport.send('vj', '{"lineId":"1"}\r\n')).toBe(false);

    // Bring the player up on that exact port; the probe should find it.
    const journal: string[] = [];
    const server = http.createServer((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200);
        res.end();
        return;
      }
      let body = '';
      req.on('data', (c: Buffer) => {
        body += c.toString('utf-8');
      });
      req.on('end', () => {
        journal.push(body);
        res.writeHead(200);
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));
    try {
      await until(() => journal.length === 2, 4000);
      // FIFO — the basket-start document must not overtake the item.
      expect(journal).toEqual(['{"lineId":"6"}\r\n', '{"lineId":"1"}\r\n']);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('drops pole and scanner writes — Octane has no outbound endpoint for either', async () => {
    const player = await fakePlayer();
    players.push(player);
    transport = new OctaneTransport({ host: '127.0.0.1', vjPort: player.port, scannerPort: await freePort() });
    await transport.connect();
    await until(() => transport!.status().vj === 'connected');

    expect(transport.send('pole', 'anything')).toBe(false);
    expect(transport.send('scanner', 'anything')).toBe(false);
    await wait(50);
    expect(player.journal()).toHaveLength(0);
  });

  it('never reports a pole channel as connected', async () => {
    const player = await fakePlayer();
    players.push(player);
    transport = new OctaneTransport({ host: '127.0.0.1', vjPort: player.port, scannerPort: await freePort() });
    await transport.connect();
    await until(() => transport!.status().vj === 'connected');
    expect(transport.status().pole).toBe('disconnected');
  });
});

describe('OctaneTransport scan server (inbound HTTP)', () => {
  it('accepts the player OctaneScanner payload and emits an inject', async () => {
    const player = await fakePlayer();
    players.push(player);
    const scanPort = await freePort();
    transport = new OctaneTransport({ host: '127.0.0.1', vjPort: player.port, scannerPort: scanPort });
    const injects: InjectCommand[] = [];
    transport.onInject((cmd) => injects.push(cmd));
    await transport.connect();
    await until(() => transport!.status().scanner === 'connected');

    const res = await postScan(
      scanPort,
      JSON.stringify({
        version: 1,
        transactionId: '',
        validateIdentity: {},
        validateShiftOpen: 1,
        validateTransactionOpen: 1,
        timeout: 5000,
        function: { sale: { articleNo: '1034073', quantity: 2 } },
      }),
    );

    // OctaneScanner only counts 2xx as a successful inject.
    expect(res.status).toBe(200);
    expect(injects).toEqual([{ barcode: '1034073', quantity: 2 }]);
  });

  it('400s a body with no articleNo (legacy ScanServer parity)', async () => {
    const player = await fakePlayer();
    players.push(player);
    const scanPort = await freePort();
    transport = new OctaneTransport({ host: '127.0.0.1', vjPort: player.port, scannerPort: scanPort });
    const injects: InjectCommand[] = [];
    transport.onInject((cmd) => injects.push(cmd));
    await transport.connect();
    await until(() => transport!.status().scanner === 'connected');

    expect((await postScan(scanPort, JSON.stringify({ function: {} }))).status).toBe(400);
    expect((await postScan(scanPort, 'not json at all')).status).toBe(400);
    expect(injects).toEqual([]);
  });

  it('404s a path other than /function', async () => {
    const player = await fakePlayer();
    players.push(player);
    const scanPort = await freePort();
    transport = new OctaneTransport({ host: '127.0.0.1', vjPort: player.port, scannerPort: scanPort });
    await transport.connect();
    await until(() => transport!.status().scanner === 'connected');

    const res = await postScan(scanPort, JSON.stringify({ function: { sale: { articleNo: '1' } } }), '/nope');
    expect(res.status).toBe(404);
  });

  it('stops listening after close()', async () => {
    const player = await fakePlayer();
    players.push(player);
    const scanPort = await freePort();
    transport = new OctaneTransport({ host: '127.0.0.1', vjPort: player.port, scannerPort: scanPort });
    await transport.connect();
    await until(() => transport!.status().scanner === 'connected');

    transport.close();
    await wait(50);
    await expect(postScan(scanPort, JSON.stringify({ function: { sale: { articleNo: '1' } } }))).rejects.toThrow();
    expect(transport.status()).toEqual({ vj: 'disconnected', pole: 'disconnected', scanner: 'disconnected' });
  });
});
