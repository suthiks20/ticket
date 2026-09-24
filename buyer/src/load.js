// buyer/src/load.js
const http = require('http');

const BASE_URL = 'http://localhost:3000';
const TICKETS = 100;
const TOTAL_REQUESTS = 500; // We will fire 500 requests for only 100 tickets
const CONCURRENCY = 500;    // All at the exact same time

function sendRequest(path, method, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: new URL(BASE_URL).hostname,
      port: new URL(BASE_URL).port || 80,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data ? Buffer.byteLength(data) : 0,
      },
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => (responseData += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(responseData) });
        } catch (e) {
          resolve({ status: res.statusCode, body: responseData });
        }
      });
    });

    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`\n🎯 TARGET: ${TICKETS} tickets`);
  console.log(`⚔️  ATTACK: ${TOTAL_REQUESTS} concurrent requests\n`);

  // 1. Reset the seller
  console.log('1. Resetting seller...');
  const resetRes = await sendRequest('/reset', 'POST', { ticket_count: TICKETS });
  if (resetRes.status !== 200) {
    console.error('❌ Failed to reset:', resetRes);
    process.exit(1);
  }
  console.log('✅ Seller reset.\n');

  // 2. Fire concurrent requests
  console.log('2. Firing concurrent requests...');
  const promises = [];
  for (let i = 0; i < TOTAL_REQUESTS; i++) {
    promises.push(
      sendRequest('/buy', 'POST', {
        user_id: `user-${i}`,
        request_id: `req-${i}`,
      })
    );
  }

  const results = await Promise.all(promises);
  console.log('✅ All requests completed.\n');

  // 3. Analyze results
  const successfulBuys = results.filter((r) => r.status === 200);
  const soldOuts = results.filter((r) => r.status === 409);
  
  const ticketNumbers = successfulBuys.map((r) => r.body.ticket_number);
  const uniqueTickets = new Set(ticketNumbers);

  console.log('📊 RESULTS:');
  console.log(`   Total Requests:      ${results.length}`);
  console.log(`   Successful (200 OK): ${successfulBuys.length}`);
  console.log(`   Sold Out (409):      ${soldOuts.length}`);
  console.log(`   Unique Tickets Issued: ${uniqueTickets.size}`);
  console.log(`   Max Allowed:         ${TICKETS}\n`);

  // 4. Check Invariants
  console.log('🔍 INVARIANT CHECKS:');
  
  const invariant1Pass = successfulBuys.length <= TICKETS;
  console.log(`   [${invariant1Pass ? '✅ PASS' : '❌ FAIL'}] Invariant 1: Never oversell (Sold ${successfulBuys.length} <= ${TICKETS})`);

  const invariant2Pass = uniqueTickets.size === successfulBuys.length;
  console.log(`   [${invariant2Pass ? '✅ PASS' : '❌ FAIL'}] Invariant 2: No duplicate ticket numbers`);

  // 5. Check /status truth
  console.log('\n3. Verifying /status truth...');
  const statusRes = await sendRequest('/status', 'GET');
  const serverSold = statusRes.body.sold;
  const serverTickets = statusRes.body.tickets;

  const invariant4Pass = serverSold === successfulBuys.length && serverTickets.length === successfulBuys.length;
  console.log(`   [${invariant4Pass ? '✅ PASS' : '❌ FAIL'}] Invariant 4: /status matches issued tickets (Server says ${serverSold}, we got ${successfulBuys.length})`);

  console.log('\n🏁 TEST COMPLETE. If you see ❌ FAIL, the naive implementation is successfully broken!');
}

main().catch(console.error);