const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' }
});
const text = (data, status = 200, type = 'text/plain; charset=utf-8') => new Response(data, { status, headers: { 'content-type': type }});
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const nitClean = (v) => String(v || '').replace(/\D/g, '');
async function sha256(s){ const b=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
async function hashPassword(password){ const salt=id(); return salt+':'+await sha256(salt+password); }
async function verifyPassword(password, stored){ const [salt,digest]=String(stored||'').split(':'); return !!salt && await sha256(salt+password) === digest; }
function tagText(xml, tag){ const re=new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`,'i'); const m=String(xml||'').match(re); return m ? strip(m[1]) : ''; }
function strip(s){ return String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim(); }
function num(v){ const n=Number(String(v||'0').replace(/[^0-9.-]/g,'')); return Number.isFinite(n)?n:0; }
function innerUbl(src){ for(const tag of ['Invoice','CreditNote','DebitNote']){ const re=new RegExp(`<(?:\\w+:)?${tag}\\b[\\s\\S]*?<\\/(?:\\w+:)?${tag}>`,'i'); const m=String(src||'').match(re); if(m) return m[0]; } return null; }
function extractInvoiceXml(input){ let raw=String(input||'').trim(); if(!raw) throw new Error('Archivo vacío'); if(/^(<\?xml[\s\S]*?\?>\s*)?<(?:\w+:)?(Invoice|CreditNote|DebitNote)\b/i.test(raw)) return raw; raw=raw.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'); const inner=innerUbl(raw); if(inner) return inner; throw new Error('No encontré Invoice/CreditNote/DebitNote dentro del archivo'); }
function u16(bytes,pos){ return bytes[pos] | (bytes[pos+1] << 8); }
function u32(bytes,pos){ return (bytes[pos] | (bytes[pos+1] << 8) | (bytes[pos+2] << 16) | (bytes[pos+3] << 24)) >>> 0; }
async function inflateRaw(bytes){
  if(typeof DecompressionStream === 'undefined') throw new Error('Este entorno no soporta descompresión ZIP automática. Sube el XML descomprimido.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function extractZipEntries(arrayBuffer){
  const bytes = new Uint8Array(arrayBuffer);
  let eocd = -1;
  for(let i=bytes.length-22; i>=0 && i>bytes.length-66000; i--){ if(u32(bytes,i)===0x06054b50){ eocd=i; break; } }
  if(eocd < 0) throw new Error('No pude leer el ZIP. Puede estar dañado o protegido.');
  const total = u16(bytes,eocd+10);
  let cdOffset = u32(bytes,eocd+16);
  const decoder = new TextDecoder('utf-8');
  const entries=[];
  for(let n=0; n<total; n++){
    if(u32(bytes,cdOffset)!==0x02014b50) break;
    const method=u16(bytes,cdOffset+10), compSize=u32(bytes,cdOffset+20), nameLen=u16(bytes,cdOffset+28), extraLen=u16(bytes,cdOffset+30), commentLen=u16(bytes,cdOffset+32), localOffset=u32(bytes,cdOffset+42);
    const name=decoder.decode(bytes.slice(cdOffset+46, cdOffset+46+nameLen));
    cdOffset += 46 + nameLen + extraLen + commentLen;
    if(name.endsWith('/')) continue;
    const lower=name.toLowerCase();
    if(!lower.endsWith('.xml') && !lower.endsWith('.html') && !lower.endsWith('.htm') && !lower.endsWith('.txt')) continue;
    if(u32(bytes,localOffset)!==0x04034b50) continue;
    const ln=u16(bytes,localOffset+26), le=u16(bytes,localOffset+28);
    const dataStart=localOffset+30+ln+le;
    const compressed=bytes.slice(dataStart, dataStart+compSize);
    let contentBytes;
    if(method===0) contentBytes=compressed;
    else if(method===8) contentBytes=await inflateRaw(compressed);
    else throw new Error(`El archivo ${name} usa compresión ZIP no soportada: ${method}`);
    entries.push({name, text:decoder.decode(contentBytes)});
  }
  return entries;
}

function party(xml, partyTag){ const re=new RegExp(`<(?:\\w+:)?${partyTag}\\b[\\s\\S]*?<\/(?:\\w+:)?${partyTag}>`,'i'); const block=(xml.match(re)||[''])[0]; let name=tagText(block,'RegistrationName') || tagText(block,'Name'); let nit=tagText(block,'CompanyID') || tagText(block,'ID'); return {name,nit}; }
async function parseInvoice(input){ const xml=extractInvoiceXml(input); const root=(xml.match(/<(?:\w+:)?(Invoice|CreditNote|DebitNote)\b/i)||[])[1] || 'Invoice'; const supplier=party(xml,'AccountingSupplierParty'); const customer=party(xml,'AccountingCustomerParty'); const invoiceNumber=tagText(xml,'ID'); const cufe=tagText(xml,'UUID') || await sha256(xml); const issueDate=tagText(xml,'IssueDate'); const currency=tagText(xml,'DocumentCurrencyCode') || 'COP'; const monetary=(xml.match(/<(?:\w+:)?LegalMonetaryTotal\b[\s\S]*?<\/(?:\w+:)?LegalMonetaryTotal>/i)||[''])[0]; const subtotal=num(tagText(monetary,'TaxExclusiveAmount') || tagText(monetary,'LineExtensionAmount')); const payable=num(tagText(monetary,'PayableAmount') || tagText(monetary,'TaxInclusiveAmount')) || subtotal; let tax=0; for(const m of xml.matchAll(/<(?:\w+:)?TaxTotal\b[\s\S]*?<\/(?:\w+:)?TaxTotal>/gi)){ tax += num(tagText(m[0],'TaxAmount')); } let withholding=0; for(const m of xml.matchAll(/<(?:\w+:)?WithholdingTaxTotal\b[\s\S]*?<\/(?:\w+:)?WithholdingTaxTotal>/gi)){ withholding += num(tagText(m[0],'TaxAmount')); } const lineTag=root==='CreditNote'?'CreditNoteLine':root==='DebitNote'?'DebitNoteLine':'InvoiceLine'; const qtyTag=root==='CreditNote'?'CreditedQuantity':root==='DebitNote'?'DebitedQuantity':'InvoicedQuantity'; const items=[]; const lineRe=new RegExp(`<(?:\\w+:)?${lineTag}\\b[\\s\\S]*?<\\/(?:\\w+:)?${lineTag}>`,'gi'); for(const m of xml.matchAll(lineRe)){ items.push({description:tagText(m[0],'Description'), quantity:num(tagText(m[0],qtyTag)), line_amount:num(tagText(m[0],'LineExtensionAmount'))}); } return {invoice_xml:xml, invoice_number:invoiceNumber, cufe, issue_date:issueDate, document_type:root==='Invoice'?'Factura compra':root==='CreditNote'?'Nota crédito':'Nota débito', supplier_name:supplier.name, supplier_nit:supplier.nit, customer_name:customer.name, customer_nit:customer.nit, currency, subtotal, tax_amount:tax, withholding_amount:withholding, payable_amount:payable, items}; }
async function auth(env, request){ const h=request.headers.get('authorization')||''; if(!h.toLowerCase().startsWith('bearer ')) throw new Response(JSON.stringify({detail:'Falta token Authorization: Bearer'}),{status:401}); const token=h.split(' ')[1]; const row=await env.DB.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=?').bind(token).first(); if(!row) throw new Response(JSON.stringify({detail:'Sesión inválida'}),{status:401}); return row; }
async function ensureCompany(env,userId,companyId){ const c=await env.DB.prepare('SELECT * FROM companies WHERE id=? AND owner_user_id=?').bind(companyId,userId).first(); if(!c) throw new Response(JSON.stringify({detail:'Empresa no encontrada'}),{status:404}); return c; }
async function getSettings(env, companyId){ return await env.DB.prepare('SELECT * FROM accounting_settings WHERE company_id=?').bind(companyId).first(); }
async function ensureExtraSchema(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS import_logs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    file_name TEXT,
    status TEXT NOT NULL,
    imported_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    message TEXT,
    created_at TEXT NOT NULL
  )`).run();
}
async function chooseRule(env, companyId, inv){ const rules=(await env.DB.prepare('SELECT * FROM accounting_rules WHERE company_id=? AND active=1 ORDER BY priority').bind(companyId).all()).results || []; const text=((inv.supplier_name||'')+' '+(inv.descriptions||'')).toUpperCase(); let fallback=null; for(const r of rules){ if(r.match_type==='default'){fallback=r; continue;} if(text.includes(String(r.match_value||'').toUpperCase())) return r; } return fallback; }
async function generateEntry(env, invoiceId){ const inv=await env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(invoiceId).first(); if(!inv) throw new Error('Factura no encontrada'); const settings=await getSettings(env, inv.company_id); const items=(await env.DB.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').bind(invoiceId).all()).results||[]; inv.descriptions=items.map(i=>i.description||'').join(' '); const rule=await chooseRule(env, inv.company_id, inv); let entry=await env.DB.prepare('SELECT * FROM accounting_entries WHERE invoice_id=?').bind(invoiceId).first(); let entryId=entry?.id || id(); if(entry){ await env.DB.prepare('DELETE FROM accounting_entry_lines WHERE entry_id=?').bind(entryId).run(); await env.DB.prepare("UPDATE accounting_entries SET status='suggested', confidence=?, created_at=?, approved_at=NULL WHERE id=?").bind(.88, now(), entryId).run(); } else { await env.DB.prepare('INSERT INTO accounting_entries VALUES (?,?,?,?,?,?)').bind(entryId, invoiceId, 'suggested', .88, now(), null).run(); }
  const add=(account,description,debit,credit,cost='')=>env.DB.prepare('INSERT INTO accounting_entry_lines VALUES (?,?,?,?,?,?,?)').bind(id(), entryId, account, description, Number(debit||0), Number(credit||0), cost).run();
  await add(rule?.account || settings.default_expense_account, rule?.description || settings.default_expense_description, inv.subtotal, 0, rule?.cost_center || settings.default_cost_center);
  if(inv.tax_amount) await add(settings.vat_account, settings.vat_description, inv.tax_amount, 0, '');
  if(inv.withholding_amount) await add(settings.withholding_account, settings.withholding_description, 0, inv.withholding_amount, '');
  await add(settings.payable_account, `${settings.payable_description} - ${inv.supplier_name||''}`, 0, inv.payable_amount, '');
  await env.DB.prepare("UPDATE invoices SET status='accounted', updated_at=? WHERE id=?").bind(now(), invoiceId).run();
  const lines=(await env.DB.prepare('SELECT * FROM accounting_entry_lines WHERE entry_id=?').bind(entryId).all()).results||[]; entry=await env.DB.prepare('SELECT * FROM accounting_entries WHERE id=?').bind(entryId).first(); return {entry,lines}; }
async function handleApi(request, env){ const url=new URL(request.url); const p=url.pathname.replace(/^\/api/,'') || '/'; try{
  if(request.method==='OPTIONS') return new Response(null,{status:204});
  if(p==='/health') return json({ok:true, service:'contapilot-cloudflare', time:now()});
  if(p==='/auth/register' && request.method==='POST'){ const d=await request.json(); const userId=id(); const token=id()+id(); await env.DB.prepare('INSERT INTO users VALUES (?,?,?,?,?)').bind(userId,d.name||'Contador Demo',String(d.email||'').toLowerCase(),await hashPassword(d.password||''),now()).run(); await env.DB.prepare('INSERT INTO sessions VALUES (?,?,?)').bind(token,userId,now()).run(); return json({token,user:{id:userId,name:d.name||'Contador Demo',email:String(d.email||'').toLowerCase()}}); }
  if(p==='/auth/login' && request.method==='POST'){ const d=await request.json(); const u=await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(String(d.email||'').toLowerCase()).first(); if(!u || !(await verifyPassword(d.password||'', u.password_hash))) return json({detail:'Correo o contraseña inválidos'},401); const token=id()+id(); await env.DB.prepare('INSERT INTO sessions VALUES (?,?,?)').bind(token,u.id,now()).run(); return json({token,user:{id:u.id,name:u.name,email:u.email}}); }
  const user=await auth(env,request);
  if(p==='/companies' && request.method==='GET'){ const rows=(await env.DB.prepare('SELECT * FROM companies WHERE owner_user_id=? ORDER BY created_at DESC').bind(user.id).all()).results||[]; return json(rows); }
  if(p==='/companies' && request.method==='POST'){ const d=await request.json(); const companyId=id(); await env.DB.prepare('INSERT INTO companies VALUES (?,?,?,?,?)').bind(companyId,user.id,d.name,nitClean(d.nit),now()).run(); await env.DB.prepare('INSERT INTO accounting_settings (company_id) VALUES (?)').bind(companyId).run(); for(const r of [['supplier','CLARO','513535','Gasto telecomunicaciones','Administración',10],['supplier','CLASSIC JEANS','519525','Vestuario / dotación','Administración',35],['default','*','519595','Gastos diversos','Administración',999]]) await env.DB.prepare('INSERT INTO accounting_rules VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id(),companyId,r[0],r[1],r[2],r[3],r[4],r[5],1,now()).run(); return json(await env.DB.prepare('SELECT * FROM companies WHERE id=?').bind(companyId).first()); }
  let m=p.match(/^\/companies\/([^/]+)\/settings$/); if(m && request.method==='GET'){ await ensureCompany(env,user.id,m[1]); return json(await getSettings(env,m[1])); }
  if(m && request.method==='PUT'){ await ensureCompany(env,user.id,m[1]); const d=await request.json(); await env.DB.prepare('UPDATE accounting_settings SET vat_account=?, vat_description=?, payable_account=?, payable_description=?, withholding_account=?, withholding_description=?, default_cost_center=?, default_expense_account=?, default_expense_description=? WHERE company_id=?').bind(d.vat_account,d.vat_description,d.payable_account,d.payable_description,d.withholding_account,d.withholding_description,d.default_cost_center,d.default_expense_account,d.default_expense_description,m[1]).run(); return json(await getSettings(env,m[1])); }
  m=p.match(/^\/companies\/([^/]+)\/rules$/); if(m && request.method==='GET'){ await ensureCompany(env,user.id,m[1]); return json((await env.DB.prepare('SELECT * FROM accounting_rules WHERE company_id=? ORDER BY priority').bind(m[1]).all()).results||[]); }
  if(m && request.method==='POST'){ await ensureCompany(env,user.id,m[1]); const d=await request.json(); const rid=id(); await env.DB.prepare('INSERT INTO accounting_rules VALUES (?,?,?,?,?,?,?,?,?,?)').bind(rid,m[1],d.match_type,d.match_value,d.account,d.description,d.cost_center||'',d.priority||100,1,now()).run(); return json(await env.DB.prepare('SELECT * FROM accounting_rules WHERE id=?').bind(rid).first()); }
  m=p.match(/^\/companies\/([^/]+)\/invoices$/); if(m && request.method==='GET'){ await ensureCompany(env,user.id,m[1]); return json((await env.DB.prepare('SELECT * FROM invoices WHERE company_id=? ORDER BY issue_date DESC').bind(m[1]).all()).results||[]); }
  m=p.match(/^\/companies\/([^/]+)\/upload$/); if(m && request.method==='POST'){
    const company=await ensureCompany(env,user.id,m[1]);
    const fd=await request.formData();
    const imported=[], errors=[];
    async function processOne(name, xml){
      const parsed=await parseInvoice(xml);
      if(nitClean(parsed.customer_nit)!==nitClean(company.nit)) throw new Error(`Factura rechazada: receptor ${parsed.customer_nit} no coincide con empresa ${company.nit}`);
      const invoiceId=id();
      const exists=await env.DB.prepare('SELECT id FROM invoices WHERE company_id=? AND cufe=?').bind(m[1],parsed.cufe).first();
      const finalId=exists?.id||invoiceId;
      if(exists) await env.DB.prepare('DELETE FROM invoice_items WHERE invoice_id=?').bind(finalId).run();
      if(exists) await env.DB.prepare('UPDATE invoices SET invoice_number=?, issue_date=?, document_type=?, supplier_name=?, supplier_nit=?, customer_name=?, customer_nit=?, currency=?, subtotal=?, tax_amount=?, withholding_amount=?, payable_amount=?, status=?, raw_xml=?, updated_at=? WHERE id=?').bind(parsed.invoice_number,parsed.issue_date,parsed.document_type,parsed.supplier_name,parsed.supplier_nit,parsed.customer_name,parsed.customer_nit,parsed.currency,parsed.subtotal,parsed.tax_amount,parsed.withholding_amount,parsed.payable_amount,'received',parsed.invoice_xml,now(),finalId).run();
      else await env.DB.prepare('INSERT INTO invoices VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(finalId,m[1],parsed.invoice_number,parsed.cufe,parsed.issue_date,parsed.document_type,parsed.supplier_name,parsed.supplier_nit,parsed.customer_name,parsed.customer_nit,parsed.currency,parsed.subtotal,parsed.tax_amount,parsed.withholding_amount,parsed.payable_amount,'received',parsed.invoice_xml,now(),now()).run();
      for(const it of parsed.items) await env.DB.prepare('INSERT INTO invoice_items VALUES (?,?,?,?,?)').bind(id(),finalId,it.description,it.quantity,it.line_amount).run();
      imported.push({file:name, invoice_id:finalId, invoice_number:parsed.invoice_number});
    }
    for(const file of fd.getAll('file')){
      try{
        const lower=(file.name||'').toLowerCase();
        if(lower.endsWith('.zip')){
          const entries=await extractZipEntries(await file.arrayBuffer());
          if(!entries.length){ errors.push({file:file.name,error:'El ZIP no contiene XML/HTML/TXT procesable'}); continue; }
          for(const entry of entries){
            try{ await processOne(entry.name, entry.text); }
            catch(e){ errors.push({file:entry.name,error:e.message}); }
          }
        }else{
          await processOne(file.name, await file.text());
        }
      }catch(e){ errors.push({file:file.name,error:e.message}); }
    }
    await ensureExtraSchema(env);
    const status = errors.length && imported.length ? 'partial' : errors.length ? 'error' : 'success';
    const fileNames = [...fd.getAll('file')].map(f=>f.name).join(', ');
    await env.DB.prepare('INSERT INTO import_logs VALUES (?,?,?,?,?,?,?,?)').bind(id(), m[1], fileNames, status, imported.length, errors.length, JSON.stringify({imported,errors}), now()).run();
    return json({imported,errors});
  }
  m=p.match(/^\/invoices\/([^/]+)$/); if(m && request.method==='GET'){
    const inv=await env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(m[1]).first();
    if(!inv) return json({detail:'Factura no encontrada'},404);
    const items=(await env.DB.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').bind(m[1]).all()).results||[];
    const entry=await env.DB.prepare('SELECT * FROM accounting_entries WHERE invoice_id=?').bind(m[1]).first();
    const lines=entry?(await env.DB.prepare('SELECT * FROM accounting_entry_lines WHERE entry_id=?').bind(entry.id).all()).results||[]:[];
    return json({invoice:inv,items,entry,lines});
  }
  m=p.match(/^\/invoices\/([^/]+)\/generate-entry$/); if(m && request.method==='POST') return json(await generateEntry(env,m[1]));
  m=p.match(/^\/invoices\/([^/]+)\/approve$/); if(m && request.method==='POST'){ const entry=await env.DB.prepare('SELECT * FROM accounting_entries WHERE invoice_id=?').bind(m[1]).first(); if(!entry) await generateEntry(env,m[1]); const e=await env.DB.prepare('SELECT * FROM accounting_entries WHERE invoice_id=?').bind(m[1]).first(); await env.DB.prepare("UPDATE accounting_entries SET status='approved', approved_at=? WHERE id=?").bind(now(),e.id).run(); await env.DB.prepare("UPDATE invoices SET status='approved', updated_at=? WHERE id=?").bind(now(),m[1]).run(); return json({ok:true}); }
  m=p.match(/^\/companies\/([^/]+)\/import-logs$/); if(m && request.method==='GET'){
    await ensureCompany(env,user.id,m[1]);
    await ensureExtraSchema(env);
    const rows=(await env.DB.prepare('SELECT * FROM import_logs WHERE company_id=? ORDER BY created_at DESC LIMIT 100').bind(m[1]).all()).results||[];
    return json(rows);
  }
  m=p.match(/^\/companies\/([^/]+)\/mark-exported$/); if(m && request.method==='POST'){
    await ensureCompany(env,user.id,m[1]);
    const result=await env.DB.prepare("UPDATE invoices SET status='exported', updated_at=? WHERE company_id=? AND status IN ('approved','accounted')").bind(now(),m[1]).run();
    return json({ok:true, changed: result.meta?.changes || 0});
  }
  m=p.match(/^\/companies\/([^/]+)\/export\.csv$/); if(m && request.method==='GET'){ await ensureCompany(env,user.id,m[1]); const rows=(await env.DB.prepare('SELECT i.*, l.account, l.description line_description, l.debit, l.credit, l.cost_center FROM invoices i LEFT JOIN accounting_entries e ON e.invoice_id=i.id LEFT JOIN accounting_entry_lines l ON l.entry_id=e.id WHERE i.company_id=? ORDER BY i.issue_date DESC').bind(m[1]).all()).results||[]; const csv=['factura;fecha;proveedor;nit;cufe;cuenta;descripcion;debito;credito;centro_costo;estado',...rows.filter(r=>r.account).map(r=>[r.invoice_number,r.issue_date,r.supplier_name,r.supplier_nit,r.cufe,r.account,r.line_description,r.debit,r.credit,r.cost_center,r.status].map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';'))].join('\n'); return text(csv,200,'text/csv; charset=utf-8'); }
  return json({detail:'Ruta no encontrada'},404);
}catch(e){ if(e instanceof Response) return e; return json({detail:e.message||String(e)},500); }}


export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api')) {
      return handleApi(request, env);
    }
    // Serve static frontend assets from Cloudflare Workers assets
    return env.ASSETS.fetch(request);
  }
};
