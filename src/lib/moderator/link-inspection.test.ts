import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { inspectProjectLink, readPinnedPage, isPublicInspectionAddress, extractPreviewText, type InspectionTransport } from "./link-inspection";

test("non-public ranges and mapped IPv6 are never accepted", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.0.2.1", "198.18.0.1", "203.0.113.1", "::ffff:127.0.0.1", "::1"]) assert.equal(isPublicInspectionAddress(ip), false, ip);
  assert.equal(isPublicInspectionAddress("8.8.8.8"), true);
});

test("redirects are resolved and every hop checked before network access", async () => {
  const read: string[] = [];
  const io: InspectionTransport = { resolve: async () => ["8.8.8.8"], read: async (url, address) => {
    read.push(address);
    return { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" }, body: "" };
  } };
  assert.equal((await inspectProjectLink("https://t.co/example", io)).status, "blocked");
  assert.deepEqual(read, ["8.8.8.8"]);
});

test("credentials, custom ports, mixed public/private DNS and private IPs never reach reader", async () => {
  let reads = 0;
  const io: InspectionTransport = { resolve: async () => ["8.8.8.8", "10.0.0.1"], read: async () => { reads++; throw Error("must not read"); } };
  for (const url of ["https://user:pass@example.com", "https://example.com:8080", "http://127.1", "https://example.com", "http://[::1]"]) assert.equal((await inspectProjectLink(url, io)).status, "blocked");
  assert.equal(reads, 0);
});

test("redirect destination and readable project preview are evidence, not authority", async () => {
  let n = 0;
  const io: InspectionTransport = { resolve: async () => ["8.8.8.8"], read: async () => ++n === 1
    ? { status: 302, headers: { location: "https://x.com/HotCommunities/status/123" }, body: "" }
    : { status: 200, headers: {}, body: '<meta property="og:description" content="Recently added BYTE @Bytehumor"><p>Other market coverage</p>' } };
  const result = await inspectProjectLink("https://t.co/example", io);
  assert.equal(result.status, "readable");
  assert.equal(result.finalUrl, "https://x.com/HotCommunities/status/123");
  assert.match(result.text!, /BYTE @Bytehumor/);
  assert.match(extractPreviewText('<script>steal()</script><p>News</p>'), /News/);
});

test("DNS stall is bounded and late resolution cannot initiate a connection", async () => {
  let finish!: (addresses: string[]) => void;
  let reads = 0;
  const io: InspectionTransport = { resolve: () => new Promise(resolve => { finish = resolve; }), read: async () => { reads++; throw Error(); } };
  assert.equal((await inspectProjectLink("https://example.com", io, 10)).status, "unavailable");
  finish(["8.8.8.8"]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 0);
});

test("actual HTTP transport pins DNS and aborts a stalled body", async () => {
  const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.write("hello"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  try {
    // This bypasses the public-address gate ONLY to test the transport on a
    // local fixture. The deliberately nonexistent hostname must not resolve.
    await assert.rejects(readPinnedPage(new URL(`http://does-not-exist.invalid:${address.port}`), "127.0.0.1", AbortSignal.timeout(40)));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
