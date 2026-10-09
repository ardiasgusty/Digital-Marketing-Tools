const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');
const code = html.slice(html.indexOf('        function parseSafeDate('), html.indexOf('        function switchReportTabToKreator('));
const context = { contentDB: [], publishedDraftDB: [], getAutoKreator: () => 'Rizky' };
vm.createContext(context);
vm.runInContext(code, context);
context.contentDB = [
    { datePub:'2026-09-29', evalDateRaw:'2026-10-06', month:'Oktober', week:'5', kreator:'Rizky' },
    { datePub:'2026-10-01', month:'September', week:'4', kreator:'Wafie' },
    { datePub:'2026-10-08', month:'Oktober', week:'5', kreator:'Wafie' },
    { datePub:'invalid', evalDateRaw:'2026-10-01', month:'Oktober', week:'4' }
];
let items = context.getUnifiedCreatorDataset();
assert.equal(items[0].month, 'September');
assert.equal(items[0].week, 'W5');
assert.equal(items[1].month, 'Oktober');
assert.equal(items[1].week, 'W1');
assert.equal(items[2].week, 'W2');
assert.equal(items[3].month, 'Unknown');
assert.equal(items[3].week, 'Unknown');
context.contentDB = JSON.parse(fs.readFileSync('json/2026/report-content-performance-2026.json', 'utf8'));
context.publishedDraftDB = JSON.parse(fs.readFileSync('json/2026/publish-log-2026.json', 'utf8'));
items = context.getUnifiedCreatorDataset();
const october = items.filter(item => item.month === 'Oktober');
assert(october.length > 0);
assert(october.every(item => item.datePub.startsWith('2026-10')));
assert(october.every(item => item.week === 'W' + Math.ceil(Number(item.datePub.slice(8,10))/7)));
assert(october.filter(item => item.datePub <= '2026-10-09').every(item => !['W4','W5'].includes(item.week)));
console.log('PASS: publication month/week, cross-month evaluations, invalid dates and saved October data');
