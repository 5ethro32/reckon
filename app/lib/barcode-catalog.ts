import { normalizeGtin } from './receiving';
export type CatalogRow = { supplier: string; supplier_sku: string; gtin: string; description: string; pack_size: string; ampp_id: string | null };
/** CSV with quoted commas/newlines; import never overwrites a conflicting verified mapping. */
export function parseCatalogCsv(text: string): CatalogRow[] {
 if (text.length > 500000) throw Error('Use a CSV smaller than 500 KB.');
 const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false; let closed = false;
 for(let i=0;i<text.length;i++) {
  const c=text[i];
  if(quoted) { if(c==='"') { if(text[i+1]==='"') {cell+='"';i++;} else {quoted=false;closed=true;} } else cell+=c; }
  else if(c==='"') {if(cell || closed) throw Error('Invalid CSV quoting.');quoted=true;}
  else if(c===',' || c==='\n' || c==='\r') { row.push(cell.trim());cell='';closed=false;if(c!==','){if(row.some(Boolean))rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;} }
  else {if(closed && c.trim())throw Error('Unexpected text after a quoted CSV value.');cell+=c;}
 }
 if(quoted)throw Error('Unclosed CSV quote.');row.push(cell.trim());if(row.some(Boolean))rows.push(row);
 const header=rows.shift()?.map(x=>x.replace(/^\uFEFF/,'').toLowerCase()) ?? [];
 const required=['supplier','supplier_sku','gtin','description','pack_size'];
 if(new Set(header).size!==header.length || required.some(x=>!header.includes(x))) throw Error('CSV needs supplier, supplier_sku, gtin, description and pack_size headers; ampp_id is optional.');
 if(!rows.length || rows.length>1000)throw Error('Import between 1 and 1,000 mappings at a time.');
 const seen=new Set<string>();
 return rows.map((values,i)=>{
  if(values.length!==header.length)throw Error(`Row ${i+2}: column count does not match the header.`);
  const entry=Object.fromEntries(header.map((h,j)=>[h,values[j]]));
  for(const key of required)if(!entry[key] || entry[key].length>300)throw Error(`Row ${i+2}: ${key} is missing or too long.`);
  const gtin=normalizeGtin(entry.gtin);
  if(entry.ampp_id && !/^\d{6,18}$/.test(entry.ampp_id))throw Error(`Row ${i+2}: AMPP ID must be a numeric dm+d identifier.`);
  const key=entry.supplier+'\n'+gtin;if(seen.has(key))throw Error(`Row ${i+2}: duplicate supplier and barcode.`);seen.add(key);
  return {supplier:entry.supplier,supplier_sku:entry.supplier_sku,gtin,description:entry.description,pack_size:entry.pack_size,ampp_id:entry.ampp_id||null};
 });
}
