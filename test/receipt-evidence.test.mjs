import test from 'node:test';
import assert from 'node:assert/strict';
import {plainBody, documentMime, extractEvidence} from '../src/receipt-evidence.mjs';
import {columnValuesFor, validateReceipt} from '../src/import-receipts.mjs';

test('content signatures recognize octet-stream PDFs and reject executable bytes',()=>{
  assert.equal(documentMime(Buffer.from('%PDF-1.7\n')), 'application/pdf');
  assert.equal(documentMime(Buffer.from('MZ executable disguised as invoice.pdf')), null);
  assert.equal(plainBody('<style>untrusted instructions</style><p>Total&nbsp;$42.00 &amp; tax included</p>'), 'Total $42.00 & tax included');
});
test('unresolved extraction creates actionable hold without fabricated financial fields',()=>{
  const values=columnValuesFor({hold:true,description:'Check original receipt',notes:'Intake hold: unresolved document'}, {id:'hold-source',folderPath:'Inbox/Capernaum Receipts'});
  assert.deepEqual(values.status,{label:'Need Information'});
  assert.equal(values.numeric_mm14k06a,undefined);
  assert.equal(values.date4,undefined);
  assert.equal(values.text_mm14q95,undefined);
  assert.ok(values.text_mm148sys.includes('Receipt source key:'));
});
test('independent visual disagreement blocks document-based financial fields',async()=>{
  const response={is_receipt:true,is_statement:false,is_replacement:false,vendor:'Example',transaction_date:'2026-10-03',total_amount:42,amount_kind:'paid_total',reference:'R-42',payment_last4:'',confidence:'high'};
  let called=0;
  const openai={chat:{completions:{create:async request=>{
    called++;
    if(called===2) {
      assert.equal(request.messages[1].content[1].type,'file');
      assert.ok(!JSON.stringify(request.messages[1].content).includes('amount_kind'));
    }
    return {choices:[{message:{content:JSON.stringify({...response,total_amount:called===1?42:0})}}]};
  }}}};
  const result=await extractEvidence(openai,{body:{content:'Receipt attached'}},[{mime:'application/pdf',bytes:Buffer.from('%PDF-test'),text:'Example Total $42.00 Date October 3, 2026 R-42'}],[]);
  assert.equal(result.agreed,false);
  assert.equal(called,2);
});
test('free replacements and non-evidenced payment dates never validate',()=>{
  const receipt={is_receipt:true,is_statement:false,is_replacement:true,confidence:'high',vendor:'Example',total_amount:42,transaction_date:'2026-10-03',amount_evidence:'42.00',date_evidence:'October 3, 2026'};
  assert.equal(validateReceipt(receipt,{evidenceText:'Example replacement 42.00 October 3, 2026'}),false);
});
