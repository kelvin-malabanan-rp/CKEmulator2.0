import { describe, it, expect, afterEach, vi } from 'vitest';
import net from 'net';
import { PosTransport } from './PosTransport';

interface TestServer {
  server: net.Server;
  port: number;
  received: () => string;
  /** Write bytes back to every connected client (simulate the player injecting). */
  push: (data: string) => void;
  /** Force-close the server AND any live client sockets (simulate player going away). */
  drop: () => Promise<void>;
}

function listen(port = 0): Promise<TestServer> {
  return new Promise((resolve) => {
    let buf = '';
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('data', (d) => {
        buf += d.toString('utf-8');
      });
    });
    server.listen(port, '127.0.0.1', () => {
      const actualPort = (server.address() as net.AddressInfo).port;
      const drop = (): Promise<void> => {
        for (const s of sockets) s.destroy();
        return new Promise<void>((r) => server.close(() => r()));
      };
      const push = (data: string): void => {
        for (const s of sockets) s.write(data);
      };
      resolve({ server, port: actualPort, received: () => buf, push, drop });
    });
  });
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let transport: PosTransport | undefined;
const servers: net.Server[] = [];

afterEach(async () => {
  transport?.close();
  transport = undefined;
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
  servers.length = 0;
});

describe('PosTransport', () => {
  it('connects to both ports and reports connected status', async () => {
    const vj = await listen();
    const pole = await listen();
    servers.push(vj.server, pole.server);

    transport = new PosTransport({ host: '127.0.0.1', vjPort: vj.port, polePort: pole.port });
    await transport.connect();
    await wait(50);

    expect(transport.status()).toEqual({ vj: 'connected', pole: 'connected', scanner: 'disconnected' });
  });

  it('sends VJ and pole bytes to the right server byte-for-byte', async () => {
    const vj = await listen();
    const pole = await listen();
    servers.push(vj.server, pole.server);

    transport = new PosTransport({ host: '127.0.0.1', vjPort: vj.port, polePort: pole.port });
    await transport.connect();
    await wait(50);

    transport.send('vj', 'EventId=1001,TerminalNumber=1\r\n');
    transport.send('pole', 'Balance Due    $1.94');
    await wait(50);

    expect(vj.received()).toBe('EventId=1001,TerminalNumber=1\r\n');
    expect(pole.received()).toBe('Balance Due    $1.94');
  });

  it('parses an inbound inject command on the VJ channel and notifies onInject', async () => {
    const vj = await listen();
    const pole = await listen();
    servers.push(vj.server, pole.server);

    transport = new PosTransport({ host: '127.0.0.1', vjPort: vj.port, polePort: pole.port });
    const injects: Array<{ barcode: string; quantity: number }> = [];
    transport.onInject((cmd) => injects.push(cmd));
    await transport.connect();
    await wait(50);

    // Player writes a completer inject back down the VJ socket (may arrive split).
    vj.push('EventId=2001,Barcode=049000000443,Quantity=2\r\nEventId=2001,Barcode=123,Quantity=1\r\n');
    await wait(50);

    expect(injects).toEqual([
      { barcode: '049000000443', quantity: 2 },
      { barcode: '123', quantity: 1 },
    ]);
  });

  it('for the bulloch register type connects pole only and never touches the VJ', async () => {
    const vj = await listen();
    const pole = await listen();
    servers.push(vj.server, pole.server);

    transport = new PosTransport({
      host: '127.0.0.1',
      vjPort: vj.port,
      polePort: pole.port,
      registerType: 'bulloch',
    });
    await transport.connect();
    await wait(50);

    // Pole is up; VJ is intentionally skipped even though a server is listening.
    expect(transport.status()).toEqual({ vj: 'disconnected', pole: 'connected', scanner: 'disconnected' });
    expect(transport.send('vj', 'EventId=1001\r\n')).toBe(false);
    await wait(20);
    expect(vj.received()).toBe('');
  });

  it('for the radiant6-us register type connects the VJ only — US has no pole display', async () => {
    const vj = await listen();
    const pole = await listen();
    servers.push(vj.server, pole.server);

    // Watch for a connect attempt: a dropped send and a disconnected state look
    // the same whether the channel is skipped or stuck retrying.
    const connectLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    transport = new PosTransport({
      host: '127.0.0.1',
      vjPort: vj.port,
      polePort: 0,
      registerType: 'radiant6-us',
      reconnectDelayMs: 10,
    });
    await transport.connect();
    await wait(50);
    // Snapshot before restoring — mockRestore() clears the recorded calls.
    const logged = connectLog.mock.calls.flat().map(String);
    connectLog.mockRestore();

    // Port 0 means "this register type has no such device" — never opened, so
    // the US lane can't sit in an ECONNREFUSED reconnect loop against a pole
    // CK Player 2.0's US plugin never listens on.
    expect(transport.status()).toEqual({ vj: 'connected', pole: 'disconnected', scanner: 'disconnected' });
    expect(logged.some((l) => l.includes('pole: connecting'))).toBe(false);
    expect(transport.send('pole', 'DISPLAY\r\n')).toBe(false);
    await wait(20);
    expect(pole.received()).toBe('');
  });

  it('for the verifone-topaz register type connects VJ, pole AND scanner', async () => {
    const vj = await listen();
    const pole = await listen();
    const scanner = await listen();
    servers.push(vj.server, pole.server, scanner.server);

    transport = new PosTransport({
      host: '127.0.0.1',
      vjPort: vj.port,
      polePort: pole.port,
      scannerPort: scanner.port,
      registerType: 'verifone-topaz',
    });
    await transport.connect();
    await wait(50);

    expect(transport.status()).toEqual({ vj: 'connected', pole: 'connected', scanner: 'connected' });

    transport.send('scanner', '049000000443\r\n');
    await wait(50);
    expect(scanner.received()).toBe('049000000443\r\n');
  });

  it('treats verifone-topaz-lol as Topaz — opens VJ, pole AND scanner', async () => {
    const vj = await listen();
    const pole = await listen();
    const scanner = await listen();
    servers.push(vj.server, pole.server, scanner.server);

    transport = new PosTransport({
      host: '127.0.0.1',
      vjPort: vj.port,
      polePort: pole.port,
      scannerPort: scanner.port,
      registerType: 'verifone-topaz-lol',
    });
    await transport.connect();
    await wait(50);

    expect(transport.status()).toEqual({ vj: 'connected', pole: 'connected', scanner: 'connected' });
  });

  it('skips the scanner channel for non-topaz types even when a scannerPort is given', async () => {
    const vj = await listen();
    const pole = await listen();
    const scanner = await listen();
    servers.push(vj.server, pole.server, scanner.server);

    transport = new PosTransport({
      host: '127.0.0.1',
      vjPort: vj.port,
      polePort: pole.port,
      scannerPort: scanner.port,
      registerType: 'radiant6-canada',
    });
    await transport.connect();
    await wait(50);

    expect(transport.status().scanner).toBe('disconnected');
    expect(transport.send('scanner', '049000000443\r\n')).toBe(false);
    await wait(20);
    expect(scanner.received()).toBe('');
  });

  it('queues sends while the player is down and flushes them in order on reconnect', async () => {
    const vj = await listen();
    const pole = await listen();
    servers.push(pole.server);

    transport = new PosTransport({
      host: '127.0.0.1',
      vjPort: vj.port,
      polePort: pole.port,
      reconnectDelayMs: 30,
    });
    await transport.connect();
    await wait(50);
    expect(transport.status().vj).toBe('connected');

    // Player goes away mid-transaction; sends during the outage must not be lost.
    await vj.drop();
    await wait(60);
    expect(transport.send('vj', 'EventId=1011,Barcode=041594899038\r\n')).toBe(false);
    expect(transport.send('vj', 'EventId=1020,Tax=0.05\r\n')).toBe(false);

    const vj2 = await listen(vj.port);
    servers.push(vj2.server);
    await wait(150);
    expect(transport.status().vj).toBe('connected');
    expect(vj2.received()).toBe('EventId=1011,Barcode=041594899038\r\nEventId=1020,Tax=0.05\r\n');
  });

  it('flushes sends queued before the very first connect (player not up yet)', async () => {
    const scanner = await listen();
    const vj = await listen();
    const pole = await listen();
    servers.push(scanner.server, vj.server, pole.server);

    // Stop the scanner server first so the initial connect attempt fails.
    const scannerPort = scanner.port;
    await scanner.drop();

    transport = new PosTransport({
      host: '127.0.0.1',
      vjPort: vj.port,
      polePort: pole.port,
      scannerPort,
      registerType: 'verifone-topaz',
      reconnectDelayMs: 30,
    });
    await transport.connect();
    await wait(50);
    expect(transport.status().scanner).not.toBe('connected');

    // The scanner echo fired while the scanner socket was still down.
    expect(transport.send('scanner', '041594899038\r\n')).toBe(false);

    const scanner2 = await listen(scannerPort);
    servers.push(scanner2.server);
    await wait(150);
    expect(transport.status().scanner).toBe('connected');
    expect(scanner2.received()).toBe('041594899038\r\n');
  });

  it('caps the pending queue at 100, dropping the oldest messages first', async () => {
    const vj = await listen();
    const pole = await listen();
    servers.push(pole.server);

    transport = new PosTransport({
      host: '127.0.0.1',
      vjPort: vj.port,
      polePort: pole.port,
      reconnectDelayMs: 30,
    });
    await transport.connect();
    await wait(50);
    await vj.drop();
    await wait(60);

    for (let i = 0; i < 105; i++) {
      transport.send('vj', `msg${i}\r\n`);
    }

    const vj2 = await listen(vj.port);
    servers.push(vj2.server);
    await wait(150);
    const lines = vj2.received().split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(100);
    expect(lines[0]).toBe('msg5');
    expect(lines[99]).toBe('msg104');
  });

  it('close() discards the pending queue instead of flushing it later', async () => {
    const vj = await listen();
    const pole = await listen();
    servers.push(pole.server);

    transport = new PosTransport({
      host: '127.0.0.1',
      vjPort: vj.port,
      polePort: pole.port,
      reconnectDelayMs: 30,
    });
    await transport.connect();
    await wait(50);
    await vj.drop();
    await wait(60);
    transport.send('vj', 'EventId=1011\r\n');
    transport.close();

    const vj2 = await listen(vj.port);
    servers.push(vj2.server);
    await wait(100);
    expect(vj2.received()).toBe('');
    // Sends after close() drop rather than queue.
    expect(transport.send('vj', 'EventId=1011\r\n')).toBe(false);
  });

  it('parses an inbound scanner write as a completer inject (US Topaz path)', async () => {
    const vj = await listen();
    const pole = await listen();
    const scanner = await listen();
    servers.push(vj.server, pole.server, scanner.server);

    transport = new PosTransport({
      host: '127.0.0.1',
      vjPort: vj.port,
      polePort: pole.port,
      scannerPort: scanner.port,
      registerType: 'verifone-topaz',
    });
    const injects: Array<{ barcode: string; quantity: number }> = [];
    transport.onInject((cmd) => injects.push(cmd));
    await transport.connect();
    await wait(50);

    // Player writes the completer item code down the scanner socket, one write
    // per unit, POS-formatted (possible prefix/suffix) + line separator.
    scanner.push('041594899038\r\n');
    scanner.push('S041594899038X\r049000000443\n');
    await wait(50);

    expect(injects).toEqual([
      { barcode: '041594899038', quantity: 1 },
      { barcode: '041594899038', quantity: 1 },
      { barcode: '049000000443', quantity: 1 },
    ]);
  });

  it('auto-reconnects after the server drops and comes back', async () => {
    const vj = await listen();
    const pole = await listen();
    servers.push(pole.server);

    transport = new PosTransport({
      host: '127.0.0.1',
      vjPort: vj.port,
      polePort: pole.port,
      reconnectDelayMs: 30,
    });
    await transport.connect();
    await wait(50);
    expect(transport.status().vj).toBe('connected');

    // Drop the VJ server (force-closing the live client socket), then bring a
    // new one up on the same port.
    await vj.drop();
    await wait(60);
    expect(transport.status().vj).not.toBe('connected');

    const vj2 = await listen(vj.port);
    servers.push(vj2.server);
    await wait(150);
    expect(transport.status().vj).toBe('connected');
  });
});
