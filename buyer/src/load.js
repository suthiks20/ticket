  // 4. Check In-Doubt against /status & Invariant 4
  const statusRes = await sendRequest('/status', 'GET');
  
  if (statusRes.status === 200 && statusRes.body && statusRes.body.tickets) {
    if (inDoubtRequests.length > 0) {
      console.log('🔍 Checking In-Doubt requests against /status...');
      const soldRequestIds = new Set(statusRes.body.tickets.map(t => t.request_id));
      const recovered = inDoubtRequests.filter(rid => soldRequestIds.has(rid)).length;
      console.log(`   Recovered ${recovered} / ${inDoubtRequests.length} in-doubt requests.\n`);
    }

    console.log('🔍 INVARIANT CHECKS:');
    console.log(`   [${successes.length <= TICKETS ? '✅ PASS' : '❌ FAIL'}] Invariant 1: No overselling`);
    console.log(`   [${uniqueTickets.size === successes.length ? '✅ PASS' : '❌ FAIL'}] Invariant 2: No duplicate tickets`);
    console.log(`   [${statusRes.body.sold === successes.length ? '✅ PASS' : '❌ FAIL'}] Invariant 4: /status truth (Server says ${statusRes.body.sold}, we got ${successes.length})\n`);
  } else {
    console.log(`⚠️ /status returned status ${statusRes.status} or invalid body.`);
    console.log(`The DB might still be recovering. Run 'curl http://localhost:3000/status' manually to verify Invariant 4.\n`);
    
    console.log('🔍 INVARIANT CHECKS (Partial):');
    console.log(`   [${successes.length <= TICKETS ? '✅ PASS' : '❌ FAIL'}] Invariant 1: No overselling`);
    console.log(`   [${uniqueTickets.size === successes.length ? '✅ PASS' : '❌ FAIL'}] Invariant 2: No duplicate tickets`);
  }