// Parse command-line options for the buyer load-testing client.
'use strict';
const defaults = { url: 'http://localhost:3000', tickets: 100, total: 50000, concurrency: 1000, dupRate: 0 };
const optionNames = { '--url': 'url', '--tickets': 'tickets', '--total': 'total', '--concurrency': 'concurrency', '--dup-rate': 'dupRate' };
const config = { ...defaults };
for (let index = 2; index < process.argv.length; index += 1) {
  const key = optionNames[process.argv[index]];
  if (!key || process.argv[index + 1] === undefined) continue;
  const value = process.argv[index + 1];
  config[key] = key === 'url' ? value : Number(value);
  index += 1;
}
module.exports = Object.freeze(config);
