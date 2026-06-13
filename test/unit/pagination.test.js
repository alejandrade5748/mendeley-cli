/**
 * Unit tests for the `Page` class.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Page } from '../../src/pagination.js';
import { SessionResponseObject } from '../../src/response.js';

class Sample extends SessionResponseObject {
  static fields() {
    return ['id', 'title'];
  }
}

function rsp(body, opts = {}) {
  const headers = new Headers(opts.headers || {});
  return new Response(JSON.stringify(body), { status: 200, headers });
}

test('Page.items materialises the items', async () => {
  const session = {};
  const r = rsp(
    [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ],
    {
      headers: { 'mendeley-count': '2' },
    },
  );
  const p = new Page(session, r, Sample);
  const items = await p.items;
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'a');
  assert.equal(items[0].title, 'A');
  assert.equal(p.count, 2);
});

test('Page.next_page follows the link header', async () => {
  const session = {
    async get(url) {
      assert.equal(url, '/foo?page=2');
      return rsp([{ id: 'c', title: 'C' }]);
    },
  };
  const r = rsp([{ id: 'a' }, { id: 'b' }], {
    headers: { link: '</foo?page=2>; rel="next"' },
  });
  const p = new Page(session, r, Sample);
  const next = await p.next_page;
  const items = await next.items;
  assert.equal(items[0].id, 'c');
});

test('Page.next_page returns null when there is no next link', async () => {
  const session = {};
  const p = new Page(session, rsp([{ id: 'a' }]), Sample);
  const next = await p.next_page;
  assert.equal(next, null);
});

test('Page.all walks the entire collection', async () => {
  const session = {
    async get(url) {
      if (url === '/p2') return rsp([{ id: 'c' }], { headers: { link: '</p3>; rel="next"' } });
      if (url === '/p3') return rsp([{ id: 'd' }]);
      throw new Error('unexpected ' + url);
    },
  };
  const p = new Page(
    session,
    rsp([{ id: 'a' }, { id: 'b' }], { headers: { link: '</p2>; rel="next"' } }),
    Sample,
  );
  const all = await p.all();
  assert.deepEqual(
    all.map((i) => i.id),
    ['a', 'b', 'c', 'd'],
  );
});

/* ── pagination cross-origin guard (issue #60) ────────────────────────────── */

test('Page.next_page accepts a same-origin absolute link', async () => {
  const session = {
    host: 'https://api.mendeley.com',
    async get(url) {
      assert.equal(url, 'https://api.mendeley.com/foo?page=2');
      return rsp([{ id: 'c' }]);
    },
  };
  const r = rsp([{ id: 'a' }], {
    headers: { link: '<https://api.mendeley.com/foo?page=2>; rel="next"' },
  });
  const p = new Page(session, r, Sample);
  const next = await p.next_page;
  const items = await next.items;
  assert.equal(items[0].id, 'c');
});

test('Page.next_page rejects a cross-origin link (does not call session.get)', async () => {
  let getCalled = false;
  const session = {
    host: 'https://api.mendeley.com',
    async get() {
      getCalled = true;
      throw new Error('session.get must not be called for a cross-origin link');
    },
  };
  const r = rsp([{ id: 'a' }], {
    headers: { link: '<https://attacker.example/steal>; rel="next"' },
  });
  const p = new Page(session, r, Sample);
  await assert.rejects(() => p.next_page, /Refusing to follow next pagination link across origins/);
  assert.equal(getCalled, false, 'session.get must not be called for cross-origin links');
});

test('Page.all stops when a cross-origin link is encountered', async () => {
  // First page is same-origin; second page (the 'next' link) is cross-origin.
  // session.get must never be called for the cross-origin page.
  let getCalls = 0;
  const session = {
    host: 'https://api.mendeley.com',
    async get(url) {
      getCalls += 1;
      return rsp([{ id: 'b' }], {
        headers: { link: '<https://attacker.example/steal>; rel="next"' },
      });
    },
  };
  const p = new Page(
    session,
    rsp([{ id: 'a' }], { headers: { link: '</p2>; rel="next"' } }),
    Sample,
  );
  await assert.rejects(() => p.all(), /Refusing to follow next pagination link across origins/);
  // session.get should have been called exactly once (the legitimate /p2 fetch).
  assert.equal(getCalls, 1);
});

test('Page.previous_page and first_page and last_page also enforce same-origin', async () => {
  for (const rel of ['prev', 'first', 'last']) {
    const session = {
      host: 'https://api.mendeley.com',
      async get() {
        throw new Error(`session.get must not be called for cross-origin ${rel} link`);
      },
    };
    const r = rsp([{ id: 'a' }], {
      headers: { link: `<https://attacker.example/steal>; rel="${rel}"` },
    });
    const p = new Page(session, r, Sample);
    const accessor = {
      prev: () => p.previous_page,
      first: () => p.first_page,
      last: () => p.last_page,
    }[rel];
    await assert.rejects(() => accessor(), new RegExp(`Refusing to follow ${rel} pagination link`));
  }
});

test('Pagination accepts a relative path (always same-origin by construction)', async () => {
  // This is the original, common case: a relative 'next' link. The
  // guard should treat it as safe and pass it through to session.get.
  const session = {
    host: 'https://api.mendeley.com',
    async get(url) {
      assert.equal(url, '/foo?page=2');
      return rsp([{ id: 'b' }]);
    },
  };
  const r = rsp([{ id: 'a' }], {
    headers: { link: '</foo?page=2>; rel="next"' },
  });
  const p = new Page(session, r, Sample);
  const next = await p.next_page;
  const items = await next.items;
  assert.equal(items[0].id, 'b');
});
