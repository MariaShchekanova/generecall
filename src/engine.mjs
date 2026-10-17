/** Evidence comparison only: all report text is data, never executable instructions. */
const clean = value => typeof value === 'string' ? value.trim() : '';
const limit = (value, length = 1000) => clean(value).slice(0, length);
const unique = values => [...new Set(values.filter(Boolean))];

/** Returns a numeric ClinVar Variation ID, or null. RCV/SCV and free text are rejected. */
export function normalizeAccession(value) {
  const text = clean(String(value ?? ''));
  let match = text.match(/^VCV0*(\d{1,12})(?:\.\d+)?$/i) ?? text.match(/^(\d{1,12})$/);
  if (!match) {
    try {
      const url = new URL(text);
      if (url.protocol !== 'https:' || !['www.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov'].includes(url.hostname)) return null;
      match = url.pathname.match(/^\/clinvar\/variation\/(?:VCV0*)?(\d{1,12})(?:\.\d+)?\/?$/i);
    } catch { return null; }
  }
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) <= 0) return null;
  return String(Number(match[1]));
}

function canonicalClassification(value) {
  const text = clean(value).replace(/[._-]+/g, ' ').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').toLowerCase();
  if (/^(?:vus|variant of (?:uncertain|unknown) significance|uncertain significance)$/.test(text)) return 'Uncertain significance';
  if (!text || /conflict|not provided|not classified|no classification|unknown|not available|not specified|n\/a/.test(text)) return null;
  const classes = {pathogenic:'Pathogenic', 'likely pathogenic':'Likely pathogenic', benign:'Benign', 'likely benign':'Likely benign', 'pathogenic/likely pathogenic':'Pathogenic/Likely pathogenic', 'benign/likely benign':'Benign/Likely benign', protective:'Protective', 'risk factor':'Risk factor', 'drug response':'Drug response', association:'Association', 'affects':'Affects', 'established risk allele':'Established risk allele', 'likely risk allele':'Likely risk allele', 'uncertain risk allele':'Uncertain risk allele'};
  return classes[text] ?? null;
}

/** Conservative extraction of explicit, labelled fields. Supports pasted text and JSON-like report lines. */
export function parseReport(input) {
  const text = String(input ?? '').slice(0, 100000);
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const evidenceQuotes = [];
  const warnings = [];
  function field(name, pattern) {
    const matches = lines.map(line => ({line, match:line.match(pattern)})).filter(x => x.match);
    const values = unique(matches.map(x => limit(x.match[1], 500)));
    if (values.length > 1) { warnings.push(`Multiple ${name} values found. Confirm the intended value.`); return null; }
    if (matches[0]) { evidenceQuotes.push({field:name, quote:matches[0].line, value:values[0]}); return values[0]; }
    return null;
  }
  const gene = field('gene', /^(?:gene|gene symbol)\s*[:=]\s*([A-Za-z0-9-]+)\s*$/i)?.toUpperCase() ?? null;
  const accessionText = field('accession', /^(?:clinvar(?: (?:accession|id|variation id))?|variation id|accession)\s*[:=]\s*(.+)$/i);
  let accession = accessionText ? normalizeAccession(accessionText) : null;
  if (!accessionText && !warnings.some(warning => warning.startsWith('Multiple accession values found.'))) {
    const accessions = unique((text.match(/\bVCV\d{6,12}(?:\.\d+)?\b/gi) ?? []).map(normalizeAccession));
    if (accessions.length === 1) { accession = accessions[0]; evidenceQuotes.push({field:'accession',quote:text.split(/\r?\n/).find(line => /\bVCV\d{6,12}/i.test(line))?.trim(),value:accession}); }
    else if (accessions.length > 1) warnings.push('Multiple ClinVar accessions found. Confirm the exact variant.');
  }
  if (!accession) warnings.push('An exact ClinVar Variation ID or VCV accession is required.');
  const variant = field('variant', /^(?:variant|hgvs|variant identified|sequence change)\s*[:=]\s*(.+)$/i);
  const classificationRaw = field('classification', /^(?:classification|clinical significance|interpretation|result classification)\s*[:=]\s*(.+)$/i);
  const classification = canonicalClassification(classificationRaw);
  if (!classification) warnings.push('The report classification is missing, conflicting, or not recognized. Confirm it manually.');
  const reportDate = field('reportDate', /^(?:report date|date of report|reported|date)\s*[:=]\s*(.+)$/i);
  const lab = field('lab', /^(?:laboratory|lab|testing lab|testing laboratory)\s*[:=]\s*(.+)$/i);
  if (!reportDate) warnings.push('No report date found.');
  return {gene, accession, variant, classification, classificationRaw, reportDate, lab, evidenceQuotes, warnings, isFictional:/fictional|synthetic|demonstration only/i.test(text)};
}

/** Normalizes current and legacy NCBI ESummary JSON. Does not infer per-submitter classifications. */
export function normalizeClinvar(json, requestedId) {
  const id = normalizeAccession(requestedId ?? json?.id ?? json?.result?.uids?.[0]);
  if (!id) throw new Error('A valid ClinVar Variation ID is required.');
  const payload = json?.raw ?? json;
  const record = payload?.result?.[id] ?? (payload?.uid || payload?.id ? payload : null);
  if (!record || record.error) throw new Error('ClinVar did not return this exact Variation ID.');
  const identifiers = [record.uid, record.id, record.accession_version, record.accession].filter(value => value !== undefined && value !== null && value !== '');
  if (identifiers.some(value => normalizeAccession(value) !== id)) throw new Error('ClinVar returned a different or invalid Variation ID.');
  const germline = record.germline_classification ?? record.clinical_significance ?? {};
  const classification = clean(typeof germline === 'string' ? germline : germline.description) || clean(record.classification) || 'Not provided';
  const traits = germline.trait_set ?? record.trait_set ?? [];
  const sets = Array.isArray(traits) ? traits : Array.isArray(traits?.traits) ? traits.traits : [];
  const conditions = unique(sets.flatMap(trait => typeof trait === 'string' ? trait : trait?.trait_name ?? trait?.trait_names ?? trait?.name ?? []).map(clean));
  const gene = unique((Array.isArray(record.genes) ? record.genes : []).map(item => clean(item?.symbol))).join(', ') || clean(record.gene) || clean(record.gene_sort) || null;
  const sourceUrl = `https://www.ncbi.nlm.nih.gov/clinvar/variation/${id}/`;
  return {
    id,
    accession: clean(record.accession_version) || clean(record.accession) || `VCV${id.padStart(9,'0')}`,
    title: clean(record.title) || clean(record.variation_set?.[0]?.variation_name) || 'ClinVar variant',
    gene,
    classification,
    reviewStatus: clean(germline.review_status) || clean(record.reviewStatus) || 'Not provided',
    lastEvaluated: clean(germline.last_evaluated) || clean(record.lastEvaluated) || null,
    conditions,
    sourceUrl,
    apiUrl: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=${id}&retmode=json`,
    submissions: record.supporting_submissions?.scv ?? record.submissions ?? [],
    retrievedAt: json?.retrievedAt ?? record.retrievedAt ?? null,
    hasConflicts: /conflict/i.test(classification) && !/no conflicts/i.test(classification),
  };
}

/** A different aggregate value is a follow-up question, never proof of a lab reclassification. */
export function compareReport(report, current) {
  const questions = [
    'Does the ClinVar record refer to the exact variant and transcript in my original report?',
    'Has your laboratory reviewed this variant since my report was issued?',
    'Can you provide an updated interpretation or amended report, and explain any remaining uncertainty?',
  ];
  const oldClass = canonicalClassification(report?.classification);
  const newClass = canonicalClassification(current?.classification);
  const reportId = normalizeAccession(report?.accession);
  const currentId = normalizeAccession(current?.id ?? current?.accession);
  const geneMismatch = report?.gene && current?.gene && !String(current.gene).toUpperCase().split(/,\s*/).includes(clean(report.gene).toUpperCase());
  const hgvs = value => [...String(value ?? '').matchAll(/\b([cgnmr])\.[A-Za-z0-9_+*?>=-]+/gi)].map(match => ({type:match[1].toLowerCase(),value:match[0].toUpperCase()}));
  const reportHgvs = hgvs(report?.variant), currentHgvs = hgvs(current?.title);
  const variantMismatch = reportHgvs.some(left => currentHgvs.some(right => left.type === right.type && left.value !== right.value));
  const transcript = value => String(value ?? '').match(/\b(?:NM|NR|NC|NG|ENST)_?\d+(?:\.\d+)?\b/i)?.[0]?.toUpperCase();
  const reportTranscript = transcript(report?.variant), currentTranscript = transcript(current?.title);
  const transcriptMismatch = reportTranscript && currentTranscript && reportTranscript !== currentTranscript;
  if (!reportId || reportId !== currentId || geneMismatch || variantMismatch || transcriptMismatch) return {status:'uncertain', headline:'Confirm the exact variant first', summary:'The available identifiers do not establish an exact match. Ask the original testing laboratory to confirm the variant and transcript before interpreting a comparison.',questions,needsReview:true};
  if (!oldClass || !newClass || current?.hasConflicts || /conflicting/i.test(current?.classification ?? '')) return {status:'uncertain',headline:'A professional review is needed',summary:'A classification is missing, unrecognized, or conflicting. GeneRecall cannot resolve this uncertainty or determine whether your laboratory changed its interpretation.',questions,needsReview:true};
  if (oldClass === newClass) return {status:'consistent', headline:'The classification labels match',summary:`Your report and this ClinVar aggregate both say “${newClass}.” A matching label does not confirm that the report is current or establish what it means for your health.`,questions,needsReview:true};
  return {status:'difference',headline:'A difference worth following up',summary:`Your report says “${oldClass}”; the ClinVar germline aggregate says “${newClass}.” This is a difference between sources, not proof that your testing laboratory reclassified the variant.`,questions,needsReview:true};
}

/** Creates an unsent, editable administrative request. It does not make a diagnosis. */
export function buildLetter(report, current, comparison, personName = '') {
  const name = limit(personName,120) || '[Your name]';
  const lab = limit(report?.lab,150) || 'the original testing laboratory';
  return `Subject: Request for updated variant interpretation — ${current?.accession ?? '[ClinVar accession]'}\n\nDear ${lab},\n\nI am requesting a review of my genetic test report${report?.reportDate ? ` dated ${limit(report.reportDate,80)}` : ''}.\n\nReport details:\nGene: ${report?.gene ?? '[Confirm gene]'}\nVariant: ${limit(report?.variant,300) || '[Confirm exact variant and transcript]'}\nReport classification: ${report?.classification ?? '[Confirm report classification]'}\nClinVar record: ${current?.accession ?? '[Confirm accession]'}\n\nThe ClinVar germline aggregate is listed as ${current?.classification ?? '[Not available]'}, with review status “${current?.reviewStatus ?? 'Not provided'}”${current?.lastEvaluated ? ` and last evaluated date ${current.lastEvaluated}` : ''}.\nSource: ${current?.sourceUrl ?? '[Source link]'}${current?.retrievedAt ? `\nSource retrieved: ${current.retrievedAt}` : ''}\n\n${comparison?.summary ?? 'Please confirm whether an updated review is available.'}\n\nCould you please address the following?\n${(comparison?.questions ?? []).map((question,index) => `${index+1}. ${question}`).join('\n')}\n\nI understand that ClinVar aggregates submissions from multiple organizations and that this comparison does not establish a diagnosis or show that your laboratory changed my result. Please let me know what information or consent you need to locate my report and whether a genetics professional should discuss the result with me.\n\nThank you,\n${name}\n[Report or order number]\n[Preferred contact details]\n\nPrepared with GeneRecall. Draft for review; not sent.\n${report?.isFictional ? '\nDEMO ONLY: This request uses a fictional report and must not be sent as a real patient request.\n' : ''}`;
}
