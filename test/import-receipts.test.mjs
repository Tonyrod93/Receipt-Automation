import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceKey, sourceMatch, referenceMatch, validateReceipt, columnValuesFor, setRoute, isBusinessVendor } from '../src/import-receipts.mjs';

const message = {id:'message-one', internetMessageId:'<one@vendor.example>', receivedDateTime:'2026-10-14T12:00:00Z', folderPath:'Inbox/Capernaum Receipts', body:{content:'Example Vendor Receipt INV-42 paid on October 3, 2026. Total $89.00.'}, webLink:'https://outlook.office365.com/mail/id/message-one'};
const receipt = {is_receipt:true,is_statement:false,vendor:'Example Vendor',transaction_date:'2026-10-03',total_amount:89,reference:'INV-42',amount_evidence:'$89.00',date_evidence:'October 3, 2026',confidence:'high'};
const item = notes => ({id:'existing',column_values:[{id:'text_mm148sys',text:notes},{id:'text_mm14q95',text:'Example Vendor'}]});

test('source identity survives moved email IDs and edited business fields',()=>{
  assert.equal(sourceKey(message), sourceKey({...message,id:'moved-message'}));
  assert.equal(sourceMatch([item(`Receipt source key: ${sourceKey(message)}`)],{...message,id:'moved-message'}).id,'existing');
});
test('legacy encoded Outlook links are recognized',()=>{
  assert.equal(sourceMatch([item('Outlook link: '+encodeURIComponent(message.webLink))],message).id,'existing');
});
test('reference duplicate survives changed amount and date',()=>{
  assert.equal(referenceMatch([item('Invoice INV-42')],{...receipt,total_amount:0,transaction_date:'2026-01-01'}).id,'existing');
  assert.equal(referenceMatch([item('Invoice INV-42')],{...receipt,vendor:'Different Vendor'}),undefined);
});
test('evidenced receipt accepted; guessed amount, email date, zero, statement and invalid date held',()=>{
  assert.equal(validateReceipt(receipt,message),true);
  for(const patch of [{total_amount:99},{transaction_date:'2026-10-14'},{total_amount:0},{is_statement:true},{transaction_date:'2026-02-30'},{amount_evidence:''},{reference:'MADE-UP'},{confidence:'medium'}]) assert.equal(validateReceipt({...receipt,...patch},message),false);
});
test('creation remains pending and saves source identity atomically',()=>{
  const values=columnValuesFor({...receipt,category:'Other'},message);
  assert.deepEqual(values.status,{label:'New Submission'});
  assert.equal(values.date4.date,'2026-10-03');
  assert.equal(values.numeric_mm14k06a,'89');
  assert.equal(values.dropdown_mm14nmdm,undefined);
  assert.ok(values.text_mm148sys.includes(`Receipt source key: ${sourceKey(message)}`));
  assert.ok(values.text_mm148sys.includes('Receipt reference: INV-42'));
});
test('business mapping never inherits marketing category or approved/posting state',()=>{
  setRoute('business');
  const values=columnValuesFor(receipt,message);
  assert.deepEqual(values.color_mm80n393,{label:'New Submission'});
  assert.deepEqual(values.color_mm80easp,{label:'Not Posted'});
  assert.equal(values.date_mm80yp4n.date,'2026-10-03');
  assert.equal(values.numeric_mm808466,'89');
  assert.equal(values.text_mm802hxn,undefined);
  assert.ok(values.long_text_mm80py8x.text.includes('Receipt source key:'));
  setRoute('marketing');
});
test('named business vendors are held out of marketing without conflating other sign companies',()=>{
  assert.equal(isBusinessVendor({sender:{emailAddress:{address:'us607@alphagraphics.com'}}}),true);
  assert.equal(isBusinessVendor({},'Signs2Go'),true);
  assert.equal(isBusinessVendor({},'Signs.com'),false);
  assert.equal(isBusinessVendor({},'FASTSIGNS'),false);
});
